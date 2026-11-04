/**
 * phase8-sweep.js — Phase 8 full-matrix regression sweep: cross-phase
 * continuity scenario.
 *
 * Written by the E2E/Integration Testing Agent as the final pre-push proof
 * that the whole state matrix still works as ONE continuous user journey
 * (plans/blurry-photo-cleaner.md Phase 8: "full-matrix regression run
 * returns PASS with visual evidence"). It drives the live served app with
 * the Playwright LIBRARY only — playwright-cli is banned (binding
 * directive). In-process static server, system Chrome headless,
 * per-step timeouts, whole-run watchdog, fresh context per attempt, and the
 * process ALWAYS exits (0 pass / 1 scenario failed / 2 fatal or watchdog).
 *
 * The single journey, in order (every step asserts and screenshots):
 *   C1  Empty state: heading + CTA + drop hint + privacy line; Start over
 *       hidden; horizontal overflow 0 at desktop width.
 *   C2  Pick ONE mixed batch through the real picker: 4 fixtures + 1
 *       fully-transparent PNG + 16 generated 1600x1200 photos + 1 .txt +
 *       1 .heic. Optimistic count + placeholder tiles visible.
 *   C3  Intake resolves: "2 files couldn't be opened" notice + HEIC helper;
 *       store holds only the decodable files; skip ledger exact.
 *   C4  Analyzing: §9b progress card ("N of M", progressbar max == M) while
 *       the worker scores every unscored photo.
 *   C5  Grouped results: bands Blurry -> Needs review -> Sharp + trailing
 *       Skipped section (transparent photo, chip "-", excluded from band
 *       counts); analysis-skip notice replaced the undecodable notice (both
 *       observed in order via a notice-history spy); action bar summary.
 *   C6  Band Select all -> +1 sharp -> deselect one; summary count syncs at
 *       every change; aria-pressed follows.
 *   C7  Download selected: busy "Preparing..." + Add more disabled + live
 *       "Preparing N photos"; N download events counted, every file
 *       byte-identical (sha256) under its original name; live "Saved N
 *       photos".
 *   C8  Detail: open on the first Blurry photo; chevron Next until the band
 *       end (Next self-disables, focus parks inside the dialog); 6x Tab
 *       cycles stay contained.
 *   C9  Escape closes; focus returns to the originating tile; the detail
 *       stage object URL is revoked.
 *   C10 Keyboard: Shift+Tab walk from the grid to the header "Start over",
 *       Enter -> native confirm ("Start over? Photos loaded in this session
 *       will be cleared.") -> accepted -> empty state restored + "Gallery
 *       cleared." announced + every thumbnail object URL revoked.
 *   C11 Hygiene + network: zero console errors/warnings, pageerrors, failed
 *       requests, HTTP>=400; every response same-origin/blob/data.
 *
 * Screenshots: e2e/artifacts/phase8-sweep/
 * Flakiness rule: at most 3 attempts; a scenario that only passes on a retry
 * is reported as flaky, never silently green.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const APP_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(APP_ROOT, "e2e", "fixtures");
const ARTIFACTS_DIR = path.join(__dirname, "artifacts", "phase8-sweep");
const BASE_PORT = 9051;
const STEP_TIMEOUT = 15000;      // one user step / one UI state
const ANALYSIS_TIMEOUT = 60000;  // full batch resolution budget
const DOWNLOAD_WAIT_MS = 25000;  // N sequential downloads
const WATCHDOG_MS = 300000;      // whole-run hard cap
const VIEWPORT = { width: 1280, height: 800 };
const MAX_ATTEMPTS = 3;          // initial + two retries (flakiness rule)

const BIG_PHOTO_COUNT = 16;      // stretches the analysis window so "analyzing" is observable

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".heic": "image/heic",
};

/* ------------------------------------------------------------------ */
/* Run state                                                           */
/* ------------------------------------------------------------------ */

let steps = [];        // [{ id, name, detail }] — reset per attempt
let stepCursor = "C0 boot";
const hygiene = [];    // { tag, kind, text } — across the winning attempt
const netLog = [];     // { tag, url, status }
const dialogs = [];    // { type, message }
const shots = [];      // file names
let server = null;
let browser = null;
let appUrl = null;
let scenarioFailed = null;
let winningAttempt = 0;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function firstLine(error) {
  return String((error && error.message) || error).split("\n")[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shot(page, file) {
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, file), timeout: 10000 });
  shots.push(file);
  console.log(`      shot: e2e/artifacts/phase8-sweep/${file}`);
}

function step(id, name, detail) {
  steps.push({ id, name, detail });
  console.log(`PASS  ${id.padEnd(4)} ${name}${detail ? `\n      ${detail}` : ""}`);
}

async function expectVisible(locator, label, timeout = STEP_TIMEOUT) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch (error) {
    throw new Error(`${label}: not visible (${firstLine(error)})`);
  }
}

async function expectHeading(page, name, label, timeout = STEP_TIMEOUT) {
  await expectVisible(page.getByRole("heading", { name, exact: true }), label || `heading "${name}"`, timeout);
}

async function expectText(page, text, label, timeout = STEP_TIMEOUT) {
  await expectVisible(page.getByText(text, { exact: true }), label || `text "${text}"`, timeout);
}

/** Wait until the polite live region reads exactly `text`. */
async function waitLiveRegion(page, text, timeout = STEP_TIMEOUT) {
  await page
    .waitForFunction(
      (expected) => {
        const el = document.getElementById("live-region");
        return !!el && el.textContent === expected;
      },
      text,
      { timeout, polling: 50 },
    )
    .catch(async () => {
      const actual = await page.evaluate(() => {
        const el = document.getElementById("live-region");
        return el ? el.textContent : "(missing)";
      });
      throw new Error(`live region: expected "${text}", got "${actual}"`);
    });
}

/** Bounded poll on a real condition (never a blind sleep). Handles both
    sync predicates and async ones; a rejected check counts as not-yet. */
async function waitUntil(fn, timeout, label) {
  const deadline = Date.now() + timeout;
  for (;;) {
    let value = false;
    try {
      value = await fn();
    } catch {
      value = false;
    }
    if (value) return;
    if (Date.now() > deadline) throw new Error(`${label}: condition not met within ${timeout}ms`);
    await sleep(100);
  }
}

async function assertNoOverflow(page, label) {
  const over = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  assert(over <= 1, `${label}: horizontal overflow ${over}px at ${VIEWPORT.width}px`);
  return over;
}

async function debugState(page) {
  return page.evaluate(() => window.__debugState?.());
}

/** Grouped-results structure straight from the rendered bands. */
async function bandInfo(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("section.band")].map((section) => ({
      band: section.dataset.band,
      count: section.querySelector(".band__count") ? section.querySelector(".band__count").textContent.trim() : null,
      tiles: [...section.querySelectorAll(".photo-grid .tile")].map((tile) => ({
        name: tile.querySelector(".tile__filename") ? tile.querySelector(".tile__filename").textContent.trim() : null,
        chip: tile.querySelector(".chip__num") ? tile.querySelector(".chip__num").textContent.trim() : null,
      })),
    })),
  );
}

/** Assert focus is inside the open detail panel; returns the focus label. */
async function assertFocusContained(page, label) {
  const info = await page.evaluate(() => {
    const el = document.activeElement;
    const panel = document.querySelector(".detail__panel");
    return {
      inside: !!(el && panel && panel.contains(el)),
      label: el
        ? el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 30) || el.tagName
        : "none",
    };
  });
  assert(info.inside, `${label}: focus escaped the dialog (activeElement "${info.label}")`);
  return info.label;
}

/* ------------------------------------------------------------------ */
/* Spies installed before app scripts (object URLs + notice history)    */
/* ------------------------------------------------------------------ */

const INIT_SPIES = () => {
  // Object URL lifecycle: record every revocation the app performs.
  window.__revokeLog = [];
  const original = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = function revokeObjectURL(url) {
    try {
      window.__revokeLog.push(String(url));
    } catch {
      /* logging must never break the app */
    }
    return original(url);
  };

  // Notice history: record every notice heading ever inserted, so a notice
  // that is replaced later still leaves evidence it appeared (race-free).
  window.__noticeLog = [];
  const record = (node) => {
    if (!node || node.nodeType !== 1) return;
    const found = [];
    if (node.matches && node.matches(".notice__heading")) found.push(node);
    if (node.querySelectorAll) node.querySelectorAll(".notice__heading").forEach((n) => found.push(n));
    for (const n of found) {
      const text = (n.textContent || "").trim();
      if (text && window.__noticeLog.indexOf(text) === -1) window.__noticeLog.push(text);
    }
  };
  new MutationObserver((mutations) => {
    for (const mutation of mutations) mutation.addedNodes.forEach(record);
  }).observe(document, { childList: true, subtree: true });
};

/* ------------------------------------------------------------------ */
/* Static server (in-process; closed in finally)                        */
/* ------------------------------------------------------------------ */

function startServer(root, basePort) {
  return new Promise((resolve, reject) => {
    let port = basePort;
    const handler = (req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        let filePath = path.normalize(path.join(root, urlPath));
        if (!filePath.startsWith(root)) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("Forbidden");
          return;
        }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        fs.createReadStream(filePath).pipe(res);
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Server error");
      }
    };
    const srv = http.createServer(handler);
    srv.once("error", (error) => {
      if (error.code === "EADDRINUSE" && port < basePort + 20) {
        port += 1;
        srv.listen(port, "127.0.0.1");
      } else {
        reject(error);
      }
    });
    srv.listen(port, "127.0.0.1", () => resolve({ server: srv, port }));
  });
}

/* ------------------------------------------------------------------ */
/* Page wiring — hygiene, network log, dialog capture                   */
/* ------------------------------------------------------------------ */

function wirePage(page, tag) {
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      hygiene.push({ tag, kind: `console.${msg.type()}`, text: msg.text() });
    }
  });
  page.on("pageerror", (error) => {
    hygiene.push({ tag, kind: "pageerror", text: String((error && error.message) || error) });
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure() ? req.failure().errorText : "unknown";
    hygiene.push({ tag, kind: "requestfailed", text: `${req.method()} ${req.url()} — ${failure}` });
  });
  page.on("response", (res) => {
    netLog.push({ tag, url: res.url(), status: res.status() });
    if (res.status() >= 400) {
      hygiene.push({ tag, kind: `http.${res.status()}`, text: res.url() });
    }
  });
  page.on("dialog", (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    dialog.accept().catch(() => {});
  });
}

/** Real user path for file selection: activate the button, feed its chooser. */
async function chooseFiles(page, triggerName, files, timeout = STEP_TIMEOUT, setFilesTimeout = 120000) {
  const trigger = page.getByRole("button", { name: triggerName, exact: true });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout }),
    trigger.click({ timeout }),
  ]);
  await chooser.setFiles(files, { timeout: setFilesTimeout });
}

/* ------------------------------------------------------------------ */
/* Batch construction (generated in-page: transparent PNG + big photos) */
/* ------------------------------------------------------------------ */

async function buildBatch(page) {
  // Fully transparent PNG: cleared canvas -> alpha 0 everywhere.
  const transparentB64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 120;
    return canvas.toDataURL("image/png").split(",")[1];
  });

  // Deterministic large photo (gradient + seeded speckle), same generator
  // the Phase 4/6 suites proved lands in the Sharp band.
  const bigB64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1200;
    const ctx = canvas.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 1600, 1200);
    grad.addColorStop(0, "#3a6b8f");
    grad.addColorStop(1, "#e8eef3");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1600, 1200);
    let seed = 123456789;
    const rnd = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 400; i += 1) {
      ctx.fillStyle = `rgba(${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)},0.85)`;
      ctx.fillRect(Math.floor(rnd() * 1592), Math.floor(rnd() * 1192), 8, 8);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 8192) {
      binary += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    }
    return btoa(binary);
  });
  const bigBuffer = Buffer.from(bigB64, "base64");

  const files = [
    { name: "fixture-sharp-text.png", mimeType: "image/png", buffer: readFixture("fixture-sharp-text.png") },
    { name: "fixture-sharp-checkerboard.png", mimeType: "image/png", buffer: readFixture("fixture-sharp-checkerboard.png") },
    { name: "fixture-blurred-text.png", mimeType: "image/png", buffer: readFixture("fixture-blurred-text.png") },
    { name: "fixture-blurred-checkerboard.png", mimeType: "image/png", buffer: readFixture("fixture-blurred-checkerboard.png") },
    { name: "transparent-photo.png", mimeType: "image/png", buffer: Buffer.from(transparentB64, "base64") },
    ...Array.from({ length: BIG_PHOTO_COUNT }, (_, i) => ({
      name: `sweep-photo-${String(i + 1).padStart(2, "0")}.png`,
      mimeType: "image/png",
      buffer: bigBuffer,
    })),
    { name: "fixture-not-an-image.txt", mimeType: "text/plain", buffer: readFixture("fixture-not-an-image.txt") },
    { name: "fixture-fake.heic", mimeType: "image/heic", buffer: readFixture("fixture-fake.heic") },
  ];
  const hashes = new Map(files.map((f) => [f.name, sha256(f.buffer)]));
  return { files, hashes, bigBytes: bigBuffer.length };
}

/* ------------------------------------------------------------------ */
/* The continuous scenario                                             */
/* ------------------------------------------------------------------ */

async function runScenario(page) {
  const origin = new URL(appUrl).origin;
  let thumbSrcs = [];

  /* ---------------- C1 — empty state ---------------- */

  stepCursor = "C1 empty state";
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await expectHeading(page, "Find the blurry photos", "empty-state heading");
  await expectVisible(page.getByRole("button", { name: "Choose photos", exact: true }), "Choose photos CTA");
  await expectText(page, "or drop photos here", "drop hint");
  await expectText(page, "Photos never leave this device.", "privacy line");
  const startOverHidden = await page.evaluate(() => document.getElementById("start-over-btn").hidden);
  assert(startOverHidden === true, "Start over is visible in the empty state");
  await assertNoOverflow(page, "C1");
  await shot(page, "01-empty-state.png");
  step("C1", "Empty state", "heading + CTA + drop hint + privacy visible; Start over hidden; overflow 0");

  /* ---------------- C2 — mixed batch through the real picker ---------------- */

  stepCursor = "C2 pick mixed batch";
  const { files, hashes, bigBytes } = await buildBatch(page);
  const itemCount = files.length;          // decodable + undecodable
  const validCount = itemCount - 2;        // minus the .txt and .heic
  console.log(`      note: batch ${itemCount} files = 4 fixtures + 1 transparent + ${BIG_PHOTO_COUNT} big (${(bigBytes / 1024).toFixed(0)} KB each) + 2 undecodable`);

  await chooseFiles(page, "Choose photos", files);
  await expectText(page, `${itemCount} photos`, `optimistic pending count (${itemCount})`);
  const pendingTileCount = await page.getByRole("listitem").filter({ visible: true }).count();
  assert(
    pendingTileCount >= validCount && pendingTileCount <= itemCount,
    `pending grid shows ${pendingTileCount} tiles, expected ${validCount}–${itemCount} while decoding`,
  );
  const pendingChips = await page.locator(".chip--pending").count();
  assert(pendingChips >= 1, "no pending placeholder chips visible during decode");
  await assertNoOverflow(page, "C2");
  await shot(page, "02-batch-pending.png");
  step("C2", "Mixed batch picked", `${itemCount} files chosen via the picker; count "${itemCount} photos"; ${pendingTileCount} tiles / ${pendingChips} pending chips mid-decode`);

  /* ---------------- C3 — intake resolves, undecodable notice ---------------- */

  stepCursor = "C3 intake resolved";
  await expectHeading(page, "2 files couldn't be opened", "undecodable notice heading");
  await shot(page, "03-intake-resolved-notice.png");
  await expectText(page, "iPhone HEIC photos may need converting to JPEG first.", "HEIC helper line");
  await expectText(page, `${validCount} photos`, `resolved count (${validCount})`);
  const s3 = await debugState(page);
  assert(s3.photos.length === validCount, `store holds ${s3.photos.length} photos, expected ${validCount}`);
  assert(
    s3.skippedFiles.length === 2 &&
      s3.skippedFiles.includes("fixture-not-an-image.txt") &&
      s3.skippedFiles.includes("fixture-fake.heic"),
    `undecodable ledger wrong: ${JSON.stringify(s3.skippedFiles)}`,
  );
  await assertNoOverflow(page, "C3");
  step("C3", "Intake resolved", `"2 files couldn't be opened" + HEIC helper; store ${validCount}; ledger ${JSON.stringify(s3.skippedFiles)}`);

  /* ---------------- C4 — analyzing ---------------- */

  stepCursor = "C4 analyzing";
  await page
    .waitForFunction(() => window.__debugState?.().analysis.phase === "analyzing", null, {
      timeout: ANALYSIS_TIMEOUT,
      polling: 25,
    })
    .catch(() => {
      throw new Error("analysis never entered the 'analyzing' phase");
    });
  const bar = page.getByRole("progressbar", { name: "Analyzing photos" });
  await expectVisible(bar, "§9b progress bar");
  const barVals = await bar.evaluate((el) => ({
    now: Number(el.getAttribute("aria-valuenow")),
    max: Number(el.getAttribute("aria-valuemax")),
    min: Number(el.getAttribute("aria-valuemin")),
  }));
  assert(barVals.max === validCount, `progress max ${barVals.max}, expected ${validCount}`);
  assert(barVals.min === 0, `progress min ${barVals.min}, expected 0`);
  const statusText = (await page.locator(".progress-card__status").textContent()).trim();
  assert(new RegExp(`^\\d+ of ${validCount}$`).test(statusText), `progress status "${statusText}"`);
  await expectHeading(page, "Analyzing photos", "progress card heading");
  await assertNoOverflow(page, "C4");
  await shot(page, "04-analyzing.png");
  step("C4", "Analyzing", `§9b card visible; status "${statusText}"; progressbar ${barVals.now}/${barVals.max} (min ${barVals.min}); pending grid retained`);

  /* ---------------- C5 — grouped results + skip section ---------------- */

  stepCursor = "C5 grouped results";
  await page
    .waitForFunction(
      () => {
        const s = window.__debugState?.();
        return (
          !!s &&
          s.photos.every((p) => p.band !== null) &&
          (s.analysis.phase === "idle" || s.analysis.phase === "failed")
        );
      },
      null,
      { timeout: ANALYSIS_TIMEOUT, polling: 100 },
    )
    .catch(() => {
      throw new Error("analysis did not resolve every photo");
    });
  await expectHeading(page, "Blurry", "band heading: Blurry");
  await expectHeading(page, "Needs review", "band heading: Needs review");
  await expectHeading(page, "Sharp", "band heading: Sharp");
  await expectHeading(page, "1 photo couldn't be analyzed", "analysis-skip notice heading");
  await expectText(
    page,
    "These photos have no visible pixels, so they can't be scored. They were skipped — nothing was changed.",
    "analysis-skip notice body",
  );
  await expectText(page, `0 selected · ${validCount} total`, "action-bar summary");
  await expectVisible(
    page.getByText("Review here, delete these files on your phone.", { exact: true }),
    "device-reality guidance copy",
  );

  // Notice history: both skip notices appeared, in order (the analysis-skip
  // notice replaces the undecodable one once analysis completes).
  const noticeLog = await page.evaluate(() => window.__noticeLog.slice());
  assert(
    noticeLog.includes("2 files couldn't be opened") && noticeLog.includes("1 photo couldn't be analyzed"),
    `notice history missing an entry: ${JSON.stringify(noticeLog)}`,
  );
  assert(
    noticeLog.indexOf("2 files couldn't be opened") < noticeLog.indexOf("1 photo couldn't be analyzed"),
    `notice order wrong: ${JSON.stringify(noticeLog)}`,
  );

  const s5 = await debugState(page);
  const bands = await bandInfo(page);
  assert(
    JSON.stringify(bands.map((b) => b.band)) === JSON.stringify(["blurry", "review", "sharp", "skipped"]),
    `band order ${JSON.stringify(bands.map((b) => b.band))}`,
  );
  const scorableBands = bands.filter((b) => b.band !== "skipped");
  for (const band of scorableBands) {
    const expected = s5.photos.filter((p) => p.band === band.band).length;
    assert(band.tiles.length === expected, `band ${band.band}: ${band.tiles.length} tiles vs store ${expected}`);
    assert(
      band.count === `${expected} ${expected === 1 ? "photo" : "photos"}`,
      `band ${band.band} count text "${band.count}" for ${expected}`,
    );
  }
  const skippedBand = bands.find((b) => b.band === "skipped");
  assert(
    skippedBand &&
      skippedBand.tiles.length === 1 &&
      skippedBand.tiles[0].name === "transparent-photo.png" &&
      skippedBand.tiles[0].chip === "—" &&
      skippedBand.count === "1 photo",
    `skipped section wrong: ${JSON.stringify(skippedBand)}`,
  );
  const scorableNames = scorableBands.flatMap((b) => b.tiles.map((t) => t.name));
  assert(!scorableNames.includes("transparent-photo.png"), "transparent photo leaked into a scorable band");
  const scorableCount = scorableNames.length;
  assert(scorableCount === validCount - 1, `scorable tiles ${scorableCount}, expected ${validCount - 1}`);
  assert(scorableCount + skippedBand.tiles.length === validCount, "band + skipped tiles do not add up to the store count");

  // Every thumbnail is a live blob: URL (the revocation ledger's source).
  thumbSrcs = await page.$$eval(".photo-grid img", (imgs) => imgs.map((img) => img.src));
  assert(thumbSrcs.length === validCount, `collected ${thumbSrcs.length} thumbnail srcs, expected ${validCount}`);
  assert(thumbSrcs.every((s) => s.startsWith("blob:")), `non-blob thumbnail src present: ${thumbSrcs.find((s) => !s.startsWith("blob:"))}`);
  await assertNoOverflow(page, "C5");
  await shot(page, "05-results-grouped-skipped.png");
  step(
    "C5",
    "Grouped results + analysis-skip section",
    `bands ${scorableBands.map((b) => `${b.band}:${b.tiles.length}`).join(", ")}, skipped:1 (chip "—", excluded from bands); notices observed in order ${JSON.stringify(noticeLog)}; summary "0 selected · ${validCount} total"`,
  );

  /* ---------------- C6 — band select-all, deselect one ---------------- */

  stepCursor = "C6 selection";
  const blurryBand = page.locator("section.band").filter({
    has: page.getByRole("heading", { name: "Blurry", exact: true }),
  });
  const blurryNames = bands.find((b) => b.band === "blurry").tiles.map((t) => t.name);
  const blurryCount = blurryNames.length;
  assert(blurryCount >= 2, `blurry band has ${blurryCount} photo(s) — need at least 2 for select-all + deselect`);

  await blurryBand.getByRole("button", { name: "Select all", exact: true }).click();
  await expectText(page, `${blurryCount} selected · ${validCount} total`, "summary after band select-all");
  for (const name of blurryNames) {
    const pressed = await page.getByRole("button", { name, exact: true }).getAttribute("aria-pressed");
    assert(pressed === "true", `tile ${name} aria-pressed=${pressed} after Select all`);
  }

  await page.getByRole("button", { name: "fixture-sharp-text.png", exact: true }).click();
  await expectText(page, `${blurryCount + 1} selected · ${validCount} total`, "summary after +1 sharp");

  await page.getByRole("button", { name: "fixture-blurred-checkerboard.png", exact: true }).click();
  await expectText(page, `${blurryCount} selected · ${validCount} total`, "summary after deselect");
  const deselectPressed = await page
    .getByRole("button", { name: "fixture-blurred-checkerboard.png", exact: true })
    .getAttribute("aria-pressed");
  assert(deselectPressed === "false", `deselected tile still pressed (${deselectPressed})`);

  const expectedNames = [
    ...blurryNames.filter((n) => n !== "fixture-blurred-checkerboard.png"),
    "fixture-sharp-text.png",
  ];
  await assertNoOverflow(page, "C6");
  await shot(page, "06-selection.png");
  step(
    "C6",
    "Selection",
    `Blurry select-all (${blurryCount}) → +1 sharp → deselect blurred-checkerboard; summary synced each change; expected download set: ${expectedNames.join(", ")}`,
  );

  /* ---------------- C7 — download selected ---------------- */

  stepCursor = "C7 download selected";
  const downloads = [];
  page.on("download", (download) => downloads.push(download));
  const downloadCount = expectedNames.length;
  const plural = downloadCount === 1 ? "photo" : "photos";

  await page.getByRole("button", { name: "Download selected", exact: true }).click();
  await waitLiveRegion(page, `Preparing ${downloadCount} ${plural}`, 5000);
  await expectVisible(page.getByRole("button", { name: /Preparing/ }), "busy download button");
  const addMoreDisabled = await page.getByRole("button", { name: "Add more", exact: true }).isDisabled();
  assert(addMoreDisabled, "Add more is not disabled during the download");
  await assertNoOverflow(page, "C7");
  await shot(page, "07-download-busy.png");

  await waitUntil(() => downloads.length === downloadCount, DOWNLOAD_WAIT_MS, `download events (${downloads.length}/${downloadCount})`);
  const downloadNames = downloads.map((d) => d.suggestedFilename());
  for (const name of expectedNames) {
    assert(downloadNames.includes(name), `no download event for "${name}" (got ${JSON.stringify(downloadNames)})`);
  }
  assert(new Set(downloadNames).size === downloadCount, `duplicate download names: ${JSON.stringify(downloadNames)}`);
  for (const download of downloads) {
    const name = download.suggestedFilename();
    const filePath = await download.path();
    const hash = sha256(fs.readFileSync(filePath));
    assert(hash === hashes.get(name), `downloaded bytes differ from the source file for "${name}"`);
  }
  await waitLiveRegion(page, `Saved ${downloadCount} ${plural}`, STEP_TIMEOUT);
  await expectText(page, `${blurryCount} selected · ${validCount} total`, "summary unchanged after download");
  await shot(page, "08-download-done.png");
  step(
    "C7",
    "Download selected",
    `${downloadCount} download events (${downloadNames.join(", ")}), every file byte-identical (sha256); busy "Preparing…" + Add more disabled; live region "Preparing ${downloadCount} ${plural}" → "Saved ${downloadCount} ${plural}"`,
  );

  /* ---------------- C8 — detail: navigate to band end, focus containment ---------------- */

  stepCursor = "C8 detail navigation";
  const firstBlurry = blurryNames[0];
  const lastBlurry = blurryNames[blurryNames.length - 1];
  await page.getByRole("button", { name: `View ${firstBlurry}`, exact: true }).click();
  await expectVisible(page.getByRole("dialog", { name: `Reviewing ${firstBlurry}`, exact: true }), "detail dialog");
  const stageURL = await page.locator(".detail__img").getAttribute("src");
  assert(stageURL && stageURL.startsWith("blob:"), `detail stage src is not a blob URL: ${stageURL}`);

  const nextVisible = page.locator('button[aria-label="Next photo"]').filter({ visible: true }).first();
  let navClicks = 0;
  while (navClicks <= blurryCount + 1) {
    if (await nextVisible.isDisabled().catch(() => true)) break;
    await nextVisible.click();
    navClicks += 1;
  }
  assert(navClicks === blurryCount - 1, `chevron walk took ${navClicks} click(s) to reach the band end, expected ${blurryCount - 1}`);
  const endName = (await page.locator(".detail__filename").textContent()).trim();
  assert(endName === lastBlurry, `detail ended on "${endName}", expected "${lastBlurry}"`);

  const nextStates = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-label="Next photo"]')].map((b) => ({
      visible: !!(b.offsetWidth || b.offsetHeight || b.getClientRects().length),
      disabled: b.disabled,
    })),
  );
  assert(nextStates.some((s) => s.visible), "no visible Next control in the detail view");
  assert(nextStates.every((s) => s.disabled), `Next controls not all disabled at the band end: ${JSON.stringify(nextStates)}`);
  const prevStates = await page.evaluate(() =>
    [...document.querySelectorAll('button[aria-label="Previous photo"]')].map((b) => ({ disabled: b.disabled })),
  );
  assert(prevStates.every((s) => !s.disabled), `Previous controls disabled at the band end: ${JSON.stringify(prevStates)}`);

  const parkedLabel = await assertFocusContained(page, "C8 after chevron end-disable");
  await assertNoOverflow(page, "C8");
  await shot(page, "09-detail-last-photo.png");
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    await assertFocusContained(page, `C8 Tab #${i + 1}`);
  }
  await shot(page, "10-detail-focus-cycle.png");
  step(
    "C8",
    "Detail → last photo",
    `opened on "${firstBlurry}", ${navClicks} Next click(s) → "${lastBlurry}"; every Next control disabled; focus parked on "${parkedLabel}" inside the dialog; 6× Tab stayed contained`,
  );

  /* ---------------- C9 — Escape closes, focus + stage URL cleaned ---------------- */

  stepCursor = "C9 detail close";
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".detail"), null, { timeout: STEP_TIMEOUT, polling: 50 });
  const backLabel = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? el.getAttribute("aria-label") : null;
  });
  assert(backLabel === `View ${firstBlurry}`, `focus after close is "${backLabel}", expected "View ${firstBlurry}"`);
  await waitUntil(
    async () => (await page.evaluate(() => window.__revokeLog.slice())).includes(stageURL),
    5000,
    "detail stage object-URL revocation",
  );
  await assertNoOverflow(page, "C9");
  step("C9", "Detail closed", `Escape closed the dialog; focus returned to "View ${firstBlurry}"; stage object URL revoked`);

  /* ---------------- C10 — keyboard to Start over → confirm → empty ---------------- */

  stepCursor = "C10 keyboard start over";
  const walk = [];
  let reachedStartOver = false;
  for (let i = 0; i < 16; i += 1) {
    const activeId = await page.evaluate(() => (document.activeElement ? document.activeElement.id : ""));
    if (activeId === "start-over-btn") {
      reachedStartOver = true;
      break;
    }
    await page.keyboard.press("Shift+Tab");
    walk.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return "none";
        return el.id
          ? `#${el.id}`
          : el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 30) || el.tagName;
      }),
    );
  }
  assert(reachedStartOver, `Shift+Tab walk (${walk.join(" → ")}) never reached "Start over"`);

  await page.keyboard.press("Enter");
  await waitUntil(() => dialogs.length >= 1, 5000, "confirm dialog");
  const dialog = dialogs[dialogs.length - 1];
  assert(dialog.type === "confirm", `dialog type "${dialog.type}", expected confirm`);
  assert(
    dialog.message === "Start over? Photos loaded in this session will be cleared.",
    `confirm message "${dialog.message}"`,
  );

  await expectHeading(page, "Find the blurry photos", "empty state restored after Start over");
  await expectVisible(page.getByRole("button", { name: "Choose photos", exact: true }), "CTA after Start over");
  const hiddenAgain = await page.evaluate(() => document.getElementById("start-over-btn").hidden);
  assert(hiddenAgain === true, "Start over still visible after the clear");
  await waitLiveRegion(page, "Gallery cleared.", STEP_TIMEOUT);
  const s10 = await debugState(page);
  assert(
    s10.photos.length === 0 && s10.skippedFiles.length === 0 && s10.skippedAnalysis.length === 0,
    `store not empty after Start over: ${JSON.stringify({ photos: s10.photos.length, skippedFiles: s10.skippedFiles, skippedAnalysis: s10.skippedAnalysis })}`,
  );
  const revoked = await page.evaluate(() => window.__revokeLog.slice());
  const missing = thumbSrcs.filter((src) => !revoked.includes(src));
  assert(missing.length === 0, `${missing.length}/${thumbSrcs.length} thumbnail object URLs were never revoked (e.g. ${missing[0]})`);
  await assertNoOverflow(page, "C10");
  await shot(page, "11-empty-restored.png");
  step(
    "C10",
    "Keyboard Start over → empty state",
    `Shift+Tab walk ${JSON.stringify(walk)} reached Start over; Enter → confirm "${dialog.message}" accepted; empty state restored; "Gallery cleared." announced; ${thumbSrcs.length}/${thumbSrcs.length} thumbnail object URLs revoked`,
  );

  /* ---------------- C11 — hygiene + network aggregate ---------------- */

  stepCursor = "C11 hygiene";
  const errors = hygiene.filter(
    (h) => h.kind === "console.error" || h.kind === "pageerror" || h.kind === "requestfailed" || /^http\.(4|5)/.test(h.kind),
  );
  const warnings = hygiene.filter((h) => h.kind === "console.warning");
  assert(
    errors.length === 0 && warnings.length === 0,
    `hygiene: ${errors.length} error(s) + ${warnings.length} warning(s): ${[...errors, ...warnings].map((h) => `[${h.tag}] ${h.kind}: ${h.text}`).join(" | ")}`,
  );
  const nonLocal = netLog.filter(
    (n) => !(n.url.startsWith(origin) || n.url.startsWith("blob:") || n.url.startsWith("data:")),
  );
  assert(nonLocal.length === 0, `non-local requests observed: ${JSON.stringify(nonLocal)}`);
  step(
    "C11",
    "Hygiene + network",
    `zero console errors/warnings, pageerrors, failed requests, HTTP>=400 across the whole journey (${hygiene.length} hygiene event(s)); ${netLog.length} responses, all same-origin/blob/data (client-only app)`,
  );
}

/* ------------------------------------------------------------------ */
/* Main flow                                                           */
/* ------------------------------------------------------------------ */

(async () => {
  const watchdog = setTimeout(() => {
    console.error(`WATCHDOG: run exceeded ${WATCHDOG_MS / 1000}s — forcing exit (code 2).`);
    try { if (browser && browser.process()) browser.process().kill(); } catch { /* best effort */ }
    try { if (server) { server.closeAllConnections(); server.unref(); } } catch { /* best effort */ }
    process.exit(2);
  }, WATCHDOG_MS);

  let fatal = null;

  try {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

    const { server: srv, port } = await startServer(APP_ROOT, BASE_PORT);
    server = srv;
    appUrl = `http://127.0.0.1:${port}/`;
    console.log(`Serving  ${APP_ROOT}`);
    console.log(`App URL  ${appUrl}`);

    const launchAttempts = [
      { label: "channel:chrome (system Chrome, headless — binding directive)", opts: { channel: "chrome", headless: true } },
      { label: "bundled chromium (fallback)", opts: { headless: true } },
    ];
    for (const attempt of launchAttempts) {
      try {
        browser = await chromium.launch(attempt.opts);
        console.log(`Browser  ${attempt.label}`);
        break;
      } catch (error) {
        console.log(`  launch failed (${attempt.label}): ${firstLine(error)}`);
      }
    }
    if (!browser) throw new Error("No browser could be launched.");

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      steps = [];
      shots.length = 0;
      hygiene.length = 0;
      netLog.length = 0;
      dialogs.length = 0;
      stepCursor = "C0 boot";
      const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
      await context.addInitScript(INIT_SPIES);
      const page = await context.newPage();
      wirePage(page, `attempt${attempt}`);
      page.setDefaultTimeout(STEP_TIMEOUT);

      try {
        await runScenario(page);
        scenarioFailed = null;
        winningAttempt = attempt;
        await context.close().catch(() => {});
        break;
      } catch (error) {
        scenarioFailed = error;
        console.error(`      attempt ${attempt} failed at [${stepCursor}]: ${firstLine(error)}`);
        try {
          await page.screenshot({ path: path.join(ARTIFACTS_DIR, `fail-try${attempt}.png`), timeout: 5000 });
          console.error(`      failure shot: e2e/artifacts/phase8-sweep/fail-try${attempt}.png`);
        } catch {
          /* best effort */
        }
        await context.close().catch(() => {});
      }
    }

    console.log("\n=== PHASE 8 CONTINUITY SWEEP SUMMARY ===");
    for (const s of steps) {
      console.log(`PASS  ${s.id.padEnd(4)} ${s.name}`);
      if (s.detail) console.log(`      ${s.detail}`);
    }
    if (scenarioFailed === null) {
      const flaky = winningAttempt > 1;
      console.log(
        `\nVerdict: PASS — ${steps.length} scenario steps passed${flaky ? ` (FLAKY: passed on attempt ${winningAttempt})` : ""}`,
      );
    } else {
      console.log(`\nFAIL at [${stepCursor}]: ${firstLine(scenarioFailed)}`);
      console.log(`Verdict: FAIL — scenario failed on all ${MAX_ATTEMPTS} attempts`);
    }
    console.log(`\nScreenshots (${shots.length}):`);
    for (const file of shots) console.log(`  e2e/artifacts/phase8-sweep/${file}`);
  } catch (error) {
    fatal = error;
    console.error("FATAL:", (error && error.stack) || error);
  } finally {
    clearTimeout(watchdog);
    try {
      if (browser) await browser.close();
    } catch { /* already closed */ }
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    } catch { /* best effort */ }
  }

  process.exit(fatal ? 2 : scenarioFailed ? 1 : 0);
})().catch((error) => {
  console.error("UNCAUGHT TOP-LEVEL ERROR:", error);
  process.exit(2);
});

process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED REJECTION:", error);
  process.exitCode = 2;
});
