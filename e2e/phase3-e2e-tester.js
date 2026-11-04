/**
 * phase3-e2e-tester.js — INDEPENDENT Phase 3 (Blur detection engine) e2e proof.
 *
 * Written by the E2E/Integration Testing Agent as an independent verification
 * run. It does NOT import or re-run e2e/phase3-e2e.js (the implementer's own
 * suite); it drives the live served app through its own states, with its own
 * assertions and its own artifacts.
 *
 * Run:  node e2e/phase3-e2e-tester.js
 *
 * Tooling (binding directive): Playwright LIBRARY script only — playwright-cli
 * is banned. Chrome (channel "chrome") headless, in-process static server
 * killed in finally, per-step timeouts + whole-run watchdog, screenshots to
 * e2e/artifacts/phase3-e2e-tester/, process ALWAYS exits
 * (0 pass / 1 state failed / 2 fatal or watchdog).
 *
 * Delegated state matrix (each state runs in its own fresh browser context):
 *   T1  4 fixtures: chips fill with 0–100 (pending "—" gone), sharp ≥60 →
 *       band sharp, blurred ≤40 → band blurry; DOM chip values + __debugState;
 *       plus a 375px no-overflow check on the scored gallery.
 *   T2  20× 1600×1200 batch: all scored, count integrity (no tile lost or
 *       duplicated), page interactive mid-batch (evaluate() round-trips while
 *       phase === "analyzing"), analysis window < 30 s (actual time reported).
 *   T3  Mixed valid + invalid batch: visible "N files couldn't be opened"
 *       notice, valid photos analyzed, counts exclude skipped files.
 *   T4  Transparent PNG generated in-script: "couldn't be analyzed" notice,
 *       chip stays "—", band "skipped", score null (never a fake 0).
 *   T5  Re-select the same files: scores and bands identical (determinism).
 *   T6  Worker failure path: the test server answers blur-worker.js with 500
 *       (NETWORK boundary fault; no app code touched): generic error notice
 *       with "Try again", app recovers on retry and on the next batch.
 *   T7  Phase 2 regression quick pass: empty state, 1 photo (real picker
 *       path), invalid-file notice, start-over with object-URL revocation.
 *   T8  Hygiene: zero console errors/warnings, pageerrors, failed requests,
 *       HTTP >= 400 across every state. Every claimed state has a screenshot.
 *       Single documented exclusion: T6's deliberately injected worker-script
 *       request failure (evidence of the injection is printed).
 *
 * Re-locked 2026-11-05 after the Phase 4 §9c results-screen transition (E2E
 * tester's Phase 4 run): once analysis completes, the app's view root moves to
 * the grouped results, so the old pending-toolbar totals ("4 photos" in T1,
 * "2 photos" in T3) no longer exist. Those two waits now assert the spec'd
 * Phase 4 surface instead — per-band count text == rendered tiles ("N photo[s]",
 * design-spec §8.1 band section header / §9c wireframe) and the §9c action-bar
 * summary "N selected · M total". No other assertion was weakened.
 *
 * Flakiness rule: a state may retry at most twice; a state that only passes on
 * a retry is reported as flaky, never silently green.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const APP_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(APP_ROOT, "e2e", "fixtures");
const ARTIFACTS_DIR = path.join(__dirname, "artifacts", "phase3-e2e-tester");
const BASE_PORT = 8991;
const STEP_TIMEOUT = 15000;      // one user step / one wait for a UI state
const NOTICE_TIMEOUT = 25000;    // error notice may ride the 10s handshake watchdog
const ANALYSIS_TIMEOUT = 60000;  // full 20-photo batch resolution budget
const MATRIX_BOUND_MS = 30000;   // delegated efficiency bound for the 20-photo batch
const WATCHDOG_MS = 360000;      // whole-run hard cap

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };

/* ------------------------------------------------------------------ */
/* Run state                                                           */
/* ------------------------------------------------------------------ */

const results = [];     // { id, name, status, detail, flaky }
const hygiene = [];     // { tag, kind, text, url }
const dialogs = [];     // { tag, type, message }
const shots = [];       // { tag, file }
const workersSeen = []; // { tag, url }
let currentTag = "boot";
let server = null;
let browser = null;
let appUrl = null;

/**
 * Test-server fault-injection switches (network boundary only; the app code is
 * never touched). T6 sets `blurWorker500` so /js/blur-worker.js answers 500 —
 * a realistic "worker script unavailable" failure that exercises the app's
 * worker-crash notice + retry path.
 */
const serverFaults = { blurWorker500: false };

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

const FIX = {
  sharpCheckerboard: { name: "fixture-sharp-checkerboard.png", mime: "image/png", buffer: readFixture("fixture-sharp-checkerboard.png") },
  sharpText: { name: "fixture-sharp-text.png", mime: "image/png", buffer: readFixture("fixture-sharp-text.png") },
  blurredCheckerboard: { name: "fixture-blurred-checkerboard.png", mime: "image/png", buffer: readFixture("fixture-blurred-checkerboard.png") },
  blurredText: { name: "fixture-blurred-text.png", mime: "image/png", buffer: readFixture("fixture-blurred-text.png") },
  notAnImage: { name: "fixture-not-an-image.txt", mime: "text/plain", buffer: readFixture("fixture-not-an-image.txt") },
  fakeHeic: { name: "fixture-fake.heic", mime: "image/heic", buffer: readFixture("fixture-fake.heic") },
};

const ALL_FOUR = [FIX.sharpCheckerboard, FIX.sharpText, FIX.blurredCheckerboard, FIX.blurredText];

function asInput(f) {
  return { name: f.name, mimeType: f.mime, buffer: f.buffer };
}

/* ------------------------------------------------------------------ */
/* Logging / assertion helpers                                         */
/* ------------------------------------------------------------------ */

function record(id, name, status, detail, flaky) {
  results.push({ id, name, status, detail, flaky: Boolean(flaky) });
  const marker = status === "PASS" ? (flaky ? "PASS*" : "PASS ") : status === "SKIP" ? "SKIP " : "FAIL ";
  console.log(`${marker} ${id.padEnd(4)} ${name}${detail ? `\n      ${detail}` : ""}`);
}

function note(text) {
  console.log(`      note: ${text}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function firstLine(error) {
  return String((error && error.message) || error).split("\n")[0];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, file) {
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, file), timeout: 10000 });
  shots.push({ tag: currentTag, file });
  console.log(`      shot: e2e/artifacts/phase3-e2e-tester/${file}`);
}

async function expectRoleHeading(page, name, label, timeout = STEP_TIMEOUT) {
  try {
    await page.getByRole("heading", { name }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    throw new Error(`${label || `heading "${name}"`} not visible (${firstLine(error)})`);
  }
}

async function expectButton(page, name, label, timeout = STEP_TIMEOUT) {
  try {
    await page.getByRole("button", { name, exact: true }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    throw new Error(`${label || `button "${name}"`} not visible (${firstLine(error)})`);
  }
}

async function expectExactText(page, text, label, timeout = STEP_TIMEOUT) {
  try {
    await page.getByText(text, { exact: true }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    throw new Error(`${label || `text "${text}"`} not visible (${firstLine(error)})`);
  }
}

/** App's sanctioned inspection seam (main.js). */
async function debugState(page) {
  return page.evaluate(() => window.__debugState());
}

/**
 * Wait until every store photo has a band (analysis fully resolved) and the
 * analysis phase has left "analyzing" ("idle", or "failed" for fault states).
 */
function waitForResolved(page, expectedCount, timeout = ANALYSIS_TIMEOUT, label = "analysis") {
  return page
    .waitForFunction(
      (expected) => {
        const s = window.__debugState?.();
        return (
          !!s &&
          s.photos.length === expected &&
          s.photos.every((p) => p.band !== null) &&
          (s.analysis.phase === "idle" || s.analysis.phase === "failed")
        );
      },
      expectedCount,
      { timeout, polling: 100 },
    )
    .catch(() => {
      throw new Error(`${label}: ${expectedCount} photos were not resolved within ${timeout}ms`);
    });
}

/** Visible tile names (gallery list items; hidden notice lists excluded). */
async function visibleTileNames(page) {
  const items = page.getByRole("listitem").filter({ visible: true });
  const count = await items.count();
  const names = [];
  for (let i = 0; i < count; i += 1) {
    const text = (await items.nth(i).innerText()) || "";
    names.push(text.split("\n")[0].trim());
  }
  return names;
}

async function visibleTileCount(page) {
  return page.getByRole("listitem").filter({ visible: true }).count();
}

/** Score chip text for the tile whose text contains `name` (delegation: DOM chip values). */
async function chipText(page, name) {
  const tile = page.getByRole("listitem").filter({ visible: true, hasText: name }).first();
  await tile.waitFor({ state: "visible", timeout: STEP_TIMEOUT });
  return (await tile.locator(".chip__num").innerText()).trim();
}

async function tileText(page, name) {
  const tile = page.getByRole("listitem").filter({ visible: true, hasText: name }).first();
  return (await tile.innerText()) || "";
}

/**
 * Real user path for file selection: activate the named button and feed the
 * file chooser it opens (picker path — not a hidden-input shortcut).
 */
async function chooseFiles(page, triggerName, files, timeout = STEP_TIMEOUT, setFilesTimeout = 120000) {
  const trigger = page.getByRole("button", { name: triggerName, exact: true });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout }),
    trigger.click({ timeout }),
  ]);
  await chooser.setFiles(files, { timeout: setFilesTimeout });
}

/* ------------------------------------------------------------------ */
/* Init scripts (installed before app scripts)                         */
/* ------------------------------------------------------------------ */

/** Object-URL revocation spy (Phase 2 regression lock). */
const REVOKE_SPY = () => {
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
};

/**
 * Phase + liveness probe: records every analysis phase/done transition at
 * 25ms cadence and 50ms timer beats (lateness vs schedule), so the analysis
 * window and main-thread stalls can be measured after the fact.
 */
const PHASE_AND_LIVENESS_PROBE = () => {
  window.__phaseLog = [];
  window.__beats = [];
  const push = () => {
    try {
      const s = window.__debugState && window.__debugState();
      if (!s) return;
      const log = window.__phaseLog;
      const last = log[log.length - 1];
      if (!last || last.phase !== s.analysis.phase || last.done !== s.analysis.done) {
        log.push({ t: performance.now(), phase: s.analysis.phase, done: s.analysis.done, total: s.analysis.total });
      }
    } catch {
      /* the probe must never break the app */
    }
  };
  setInterval(push, 25);
  push();
  const beat = () => {
    const start = performance.now();
    setTimeout(() => {
      window.__beats.push({ t: start, late: performance.now() - start - 50 });
      beat();
    }, 50);
  };
  beat();
};

/* ------------------------------------------------------------------ */
/* Static server (in-process; closed in finally)                       */
/* ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".heic": "image/heic",
};

function startServer(root, basePort) {
  return new Promise((resolve, reject) => {
    let port = basePort;
    const handler = (req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        if (serverFaults.blurWorker500 && urlPath === "/js/blur-worker.js") {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Injected test fault: worker script unavailable");
          return;
        }
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
/* Page wiring — hygiene + dialogs + workers                           */
/* ------------------------------------------------------------------ */

function wirePage(page, tag) {
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      const loc = typeof msg.location === "function" ? msg.location() : null;
      hygiene.push({ tag, kind: `console.${msg.type()}`, text: msg.text(), url: loc && loc.url ? loc.url : null });
    }
  });
  page.on("pageerror", (error) => {
    hygiene.push({ tag, kind: "pageerror", text: String((error && error.message) || error), url: null });
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure() ? req.failure().errorText : "unknown";
    hygiene.push({ tag, kind: "requestfailed", text: `${req.method()} ${req.url()} — ${failure}`, url: req.url() });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      hygiene.push({ tag, kind: `http.${res.status()}`, text: res.url(), url: res.url() });
    }
  });
  page.on("dialog", (dialog) => {
    dialogs.push({ tag, type: dialog.type(), message: dialog.message() });
    dialog.accept().catch(() => {});
  });
  page.on("worker", (worker) => {
    workersSeen.push({ tag, url: worker.url() });
  });
}

/* ------------------------------------------------------------------ */
/* State runner — fresh context per attempt, max two retries           */
/* ------------------------------------------------------------------ */

async function runState(id, name, fn) {
  const MAX_ATTEMPTS = 3; // initial + two retries (delegated flakiness cap)
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const tag = attempt === 1 ? id : `${id}#try${attempt}`;
    currentTag = tag;
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const page = await context.newPage();
    wirePage(page, tag);
    page.setDefaultTimeout(STEP_TIMEOUT);
    let detail = "";
    let ok = true;
    let skipped = null;
    try {
      const outcome = await fn({ page, context, tag, attempt });
      if (outcome && typeof outcome === "object" && outcome.skip) {
        skipped = outcome.detail || "skipped";
      } else {
        detail = outcome || "";
      }
    } catch (error) {
      ok = false;
      lastError = error;
      console.error(`      attempt ${attempt} failed: ${firstLine(error)}`);
      try {
        await page.screenshot({
          path: path.join(ARTIFACTS_DIR, `fail-${id}-try${attempt}.png`),
          timeout: 5000,
        });
        console.error(`      failure shot: e2e/artifacts/phase3-e2e-tester/fail-${id}-try${attempt}.png`);
      } catch {
        /* best effort */
      }
    } finally {
      await context.close().catch(() => {});
    }
    if (skipped) {
      record(id, name, "SKIP", skipped, false);
      return;
    }
    if (ok) {
      if (attempt > 1) note(`${id} was flaky — passed on attempt ${attempt}`);
      record(id, name, "PASS", detail, attempt > 1);
      return;
    }
  }
  record(id, name, "FAIL", String((lastError && lastError.message) || lastError));
}

/* ------------------------------------------------------------------ */
/* T1 — 4 fixtures: chips fill, sharp >= 60 sharp, blurred <= 40 blurry */
/* ------------------------------------------------------------------ */

async function stateT1({ page, context }) {
  await context.addInitScript(REVOKE_SPY); // harmless here; proves the spy never fires in a normal run
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  await chooseFiles(page, "Choose photos", ALL_FOUR.map(asInput));
  await waitForResolved(page, 4);
  const state = await debugState(page);

  // Every photo: integer score 0–100, real band, DOM chip === score.
  const chipEvidence = [];
  for (const p of state.photos) {
    assert(
      Number.isInteger(p.score) && p.score >= 0 && p.score <= 100,
      `"${p.name}" score ${JSON.stringify(p.score)} is not an integer 0–100`,
    );
    assert(
      ["blurry", "review", "sharp"].includes(p.band),
      `"${p.name}" band ${JSON.stringify(p.band)} is not a real band`,
    );
    const chip = await chipText(page, p.name);
    assert(chip === String(p.score), `chip for "${p.name}" shows "${chip}", expected "${p.score}"`);
    chipEvidence.push(`${p.name}=${p.score}/${p.band}`);
  }

  // Delegated fixture rules (stricter than the plan's: sharp >= 60 sharp band,
  // blurred <= 40 blurry band).
  const byName = (name) => state.photos.find((p) => p.name === name);
  for (const fix of [FIX.sharpCheckerboard, FIX.sharpText]) {
    const p = byName(fix.name);
    assert(p, `"${fix.name}" missing from the store`);
    assert(
      p.score >= 60 && p.band === "sharp",
      `sharp fixture "${fix.name}" scored ${p.score}/${p.band} — delegation requires >= 60 in band "sharp"`,
    );
  }
  for (const fix of [FIX.blurredCheckerboard, FIX.blurredText]) {
    const p = byName(fix.name);
    assert(p, `"${fix.name}" missing from the store`);
    assert(
      p.score <= 40 && p.band === "blurry",
      `blurred fixture "${fix.name}" scored ${p.score}/${p.band} — delegation requires <= 40 in band "blurry"`,
    );
  }

  // Pending "—" must be fully replaced (all four chips already matched scores).
  const tiles = await visibleTileCount(page);
  assert(tiles === 4, `gallery shows ${tiles} tiles, expected 4`);
  await shot(page, "01-fixtures-scored.png");

  // Responsiveness of the delegated state at the 375px mobile base.
  await page.setViewportSize(MOBILE_VIEWPORT);
  await sleep(250);
  const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `scored gallery overflows horizontally by ${overflow}px at 375px`);
  const mobileTiles = await visibleTileCount(page);
  assert(mobileTiles === 4, `mobile gallery shows ${mobileTiles} tiles, expected 4`);
  // Phase 4 §9c re-lock: the pending-toolbar "4 photos" total is gone once
  // the grouped results render. Equivalent mobile count lock: the §9c
  // action-bar summary "· 4 total" + per-band count text == rendered tiles.
  await expectExactText(page, "0 selected · 4 total", "mobile action-bar summary (§9c)");
  const mobileBands = await page.$$eval("[data-band]", (els) =>
    els.map((el) => ({
      band: el.getAttribute("data-band"),
      count: (el.querySelector(".band__count") || {}).textContent,
      tiles: el.querySelectorAll(".tile").length,
    })),
  );
  const mobileBandTiles = mobileBands.reduce((n, b) => n + b.tiles, 0);
  assert(mobileBandTiles === 4, `mobile results bands hold ${mobileBandTiles} tiles, expected 4 (old lock: "4 photos")`);
  for (const b of mobileBands) {
    const text = (b.count || "").trim();
    const expectedText = `${b.tiles} ${b.tiles === 1 ? "photo" : "photos"}`;
    assert(text === expectedText, `band ${b.band} count "${text}" != ${b.tiles} rendered tiles`);
  }
  await shot(page, "01b-fixtures-scored-mobile.png");

  return `4 fixtures scored via worker: ${chipEvidence.join(", ")}; DOM chips match __debugState; 375px shows 4 tiles, zero horizontal overflow`;
}

/* ------------------------------------------------------------------ */
/* T2 — 20× 1600×1200 batch: all scored, interactive mid-batch, < 30 s */
/* ------------------------------------------------------------------ */

async function stateT2({ page, tag }) {
  await page.addInitScript(PHASE_AND_LIVENESS_PROBE);
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  // Generate a deterministic 1600×1200 photo-like PNG in-page (gradient +
  // seeded speckle) and feed 20 copies through the real picker path.
  const bigB64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1200;
    const ctx = c.getContext("2d");
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
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 8192) {
      binary += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    }
    return btoa(binary);
  });
  const bigBuffer = Buffer.from(bigB64, "base64");
  note(`generated 1600×1200 photo: ${(bigBuffer.length / 1024).toFixed(0)} KB × 20`);
  const batch = Array.from({ length: 20 }, (_, i) => ({
    name: `large-photo-${String(i + 1).padStart(2, "0")}.png`,
    mimeType: "image/png",
    buffer: bigBuffer,
  }));

  const injectStart = Date.now();
  await chooseFiles(page, "Choose photos", batch);

  // Sample the running app until the batch resolves, measuring each
  // evaluate() round-trip — the delegated interactivity assertion.
  const samples = [];
  let complete = false;
  const deadline = Date.now() + ANALYSIS_TIMEOUT;
  while (Date.now() < deadline) {
    const rtStart = Date.now();
    let snap = null;
    try {
      snap = await page.evaluate(() => {
        const s = window.__debugState?.();
        if (!s) return null;
        return {
          phase: s.analysis.phase,
          done: s.analysis.done,
          total: s.analysis.total,
          n: s.photos.length,
          allBands: s.photos.every((p) => p.band !== null),
          tiles: document.querySelectorAll(".photo-grid .tile").length,
        };
      });
    } catch {
      snap = null;
    }
    const rtMs = Date.now() - rtStart;
    if (snap) {
      samples.push({ wall: Date.now() - injectStart, rtMs, ...snap });
      if (snap.n === 20 && snap.allBands && snap.phase !== "analyzing") {
        complete = true;
        break;
      }
    }
    await sleep(100);
  }
  assert(complete, `20-photo batch did not fully resolve within ${ANALYSIS_TIMEOUT}ms`);

  // Interactivity: at least one mid-batch observation while analyzing, every
  // round-trip prompt, and at least one sample with done < total (truly mid-run).
  const analyzingSamples = samples.filter((s) => s.phase === "analyzing");
  assert(
    analyzingSamples.length > 0,
    `never observed phase "analyzing" (samples: ${samples.length}) — mid-batch interactivity not provable`,
  );
  assert(
    analyzingSamples.some((s) => s.done < s.total),
    "no analyzing sample was mid-run (done < total) — the page may have finished before sampling",
  );
  assert(
    analyzingSamples.every((s) => s.n === 20 && s.tiles === 20),
    `count integrity broken mid-batch: ${JSON.stringify(analyzingSamples.map((s) => ({ n: s.n, tiles: s.tiles })))}`,
  );
  const maxRt = Math.max(...samples.map((s) => s.rtMs));
  const maxRtAnalyzing = Math.max(...analyzingSamples.map((s) => s.rtMs));
  assert(
    analyzingSamples.every((s) => s.rtMs < 1000),
    `evaluate() round-trip stalled while analyzing: worst ${maxRtAnalyzing}ms`,
  );

  // Completion integrity: 20 unique photos, every one scored 0–100.
  const state = await debugState(page);
  assert(state.photos.length === 20, `store holds ${state.photos.length} photos, expected 20`);
  const names = state.photos.map((p) => p.name);
  const ids = state.photos.map((p) => p.id);
  assert(new Set(names).size === 20, `duplicate names in store: ${JSON.stringify(names)}`);
  assert(new Set(ids).size === 20, `duplicate ids in store: ${JSON.stringify(ids)}`);
  for (const p of state.photos) {
    assert(
      Number.isInteger(p.score) && p.score >= 0 && p.score <= 100 && ["blurry", "review", "sharp"].includes(p.band),
      `"${p.name}" not scored properly: ${JSON.stringify({ score: p.score, band: p.band })}`,
    );
  }
  const tilesFinal = await visibleTileCount(page);
  assert(tilesFinal === 20, `gallery shows ${tilesFinal} tiles, expected 20`);
  let pendingChips = 0;
  for (const p of state.photos) {
    const chip = await chipText(page, p.name);
    assert(chip === String(p.score), `chip for "${p.name}" shows "${chip}", expected "${p.score}"`);
    if (chip === "—") pendingChips += 1;
  }
  assert(pendingChips === 0, `${pendingChips} chips still show "—" after resolution`);

  // Web Worker evidence (plan acceptance: analysis runs in a Worker).
  const workerUrls = workersSeen.filter((w) => w.tag === tag).map((w) => w.url);
  assert(
    workerUrls.some((u) => u.endsWith("blur-worker.js")),
    `no blur-worker.js worker observed (workers seen for ${tag}: ${JSON.stringify(workerUrls)})`,
  );

  // Efficiency window measured from the phase log; total wall from injection.
  const timing = await page.evaluate(() => {
    const log = window.__phaseLog || [];
    const startEntry = log.find((e) => e.phase === "analyzing") || null;
    const endEntry = startEntry ? log.find((e) => e.phase !== "analyzing" && e.t > startEntry.t) || null : null;
    const beats = window.__beats || [];
    let beatCount = 0;
    let worstLate = null;
    if (startEntry && endEntry) {
      for (const b of beats) {
        if (b.t >= startEntry.t && b.t <= endEntry.t) {
          beatCount += 1;
          worstLate = Math.max(worstLate === null ? -Infinity : worstLate, b.late);
        }
      }
    }
    return {
      startT: startEntry ? startEntry.t : null,
      endT: endEntry ? endEntry.t : null,
      beatCount,
      worstLate,
      tail: log.slice(-4),
    };
  });
  assert(timing.startT !== null && timing.endT !== null, "phase log did not capture the analysis window");
  const windowMs = timing.endT - timing.startT;
  const wallMs = Date.now() - injectStart;
  assert(
    windowMs < MATRIX_BOUND_MS,
    `analysis window ${windowMs.toFixed(0)}ms >= ${MATRIX_BOUND_MS}ms bound`,
  );
  note(
    `timing: analysis window ${(windowMs / 1000).toFixed(2)}s (inject→all-scored wall ${(wallMs / 1000).toFixed(2)}s); ` +
      `evaluate round-trips max ${maxRt}ms overall / ${maxRtAnalyzing}ms while analyzing; ` +
      `timer beats during window: ${timing.beatCount}${timing.worstLate === null ? "" : `, worst lateness ${timing.worstLate.toFixed(0)}ms`}`,
  );
  note(`phase log tail: ${JSON.stringify(timing.tail)}`);

  await shot(page, "02-batch-20-scored.png");
  return (
    `20/20 scored, tiles unique (20), blur-worker.js observed; ` +
    `interesting samples while analyzing: ${analyzingSamples.length}, worst evaluate round-trip ${maxRtAnalyzing}ms; ` +
    `analysis window ${(windowMs / 1000).toFixed(2)}s < 30s (wall ${(wallMs / 1000).toFixed(2)}s)`
  );
}

/* ------------------------------------------------------------------ */
/* T3 — mixed valid + invalid batch                                    */
/* ------------------------------------------------------------------ */

async function stateT3({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  await chooseFiles(page, "Choose photos", [
    asInput(FIX.sharpText),
    asInput(FIX.blurredCheckerboard),
    asInput(FIX.notAnImage),
    asInput(FIX.fakeHeic),
  ]);
  await waitForResolved(page, 2);

  const state = await debugState(page);
  assert(state.photos.length === 2, `store holds ${state.photos.length} photos, expected the 2 valid ones`);
  assert(
    state.skippedFiles.length === 2 &&
      state.skippedFiles.includes(FIX.notAnImage.name) &&
      state.skippedFiles.includes(FIX.fakeHeic.name),
    `skipped ledger wrong: ${JSON.stringify(state.skippedFiles)}`,
  );

  // Visible notice counts only the failures; results continue below.
  await expectRoleHeading(page, "2 files couldn't be opened", "undecodable notice heading");
  await expectExactText(
    page,
    "Your browser can't decode these formats. They were skipped — nothing was changed.",
    "undecodable notice body",
  );

  // Counts exclude skipped files — Phase 4 §9c re-lock: the pending-toolbar
  // "2 photos" total is gone once the grouped results render; the lock now
  // reads the §9c action-bar summary total + the per-band counts/tiles.
  await expectExactText(page, "0 selected · 2 total", "action-bar summary excludes skipped files (§9c)");
  const mixedBands = await page.$$eval("[data-band]", (els) =>
    els.map((el) => ({
      band: el.getAttribute("data-band"),
      count: (el.querySelector(".band__count") || {}).textContent,
      tiles: el.querySelectorAll(".tile").length,
    })),
  );
  const mixedBandTiles = mixedBands.reduce((n, b) => n + b.tiles, 0);
  assert(mixedBandTiles === 2, `results bands hold ${mixedBandTiles} tiles, expected the 2 valid photos (skips excluded)`);
  assert(
    !mixedBands.some((b) => b.band === "skipped"),
    `a skipped section rendered for undecodable files: ${JSON.stringify(mixedBands.map((b) => b.band))}`,
  );
  for (const b of mixedBands) {
    const text = (b.count || "").trim();
    const expectedText = `${b.tiles} ${b.tiles === 1 ? "photo" : "photos"}`;
    assert(text === expectedText, `band ${b.band} count "${text}" != ${b.tiles} rendered tiles`);
  }
  const names = (await visibleTileNames(page)).sort();
  const expected = [FIX.sharpText.name, FIX.blurredCheckerboard.name].sort();
  assert(
    names.length === 2 && names[0] === expected[0] && names[1] === expected[1],
    `gallery after mixed batch: ${JSON.stringify(names)}, expected ${JSON.stringify(expected)}`,
  );

  // The valid photos are analyzed; their chips show scores.
  const chipEvidence = [];
  for (const p of state.photos) {
    assert(["blurry", "review", "sharp"].includes(p.band), `valid photo "${p.name}" has no band (${p.band})`);
    const chip = await chipText(page, p.name);
    assert(chip === String(p.score), `chip for "${p.name}" shows "${chip}", expected "${p.score}"`);
    chipEvidence.push(`${p.name}=${p.score}/${p.band}`);
  }

  await shot(page, "03-mixed-invalid-batch.png");
  return `4 files in → 2 tiles (${names.join(", ")}), notice "2 files couldn't be opened", counts exclude skipped; analyzed: ${chipEvidence.join(", ")}`;
}

/* ------------------------------------------------------------------ */
/* T4 — transparent PNG: skipped with a message, never scored          */
/* ------------------------------------------------------------------ */

async function stateT4({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  // Generate the transparent PNG in-script (cleared canvas → alpha 0 pixels).
  const transparentB64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    // left completely cleared — every pixel alpha 0
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 8192) {
      binary += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
    }
    return btoa(binary);
  });
  const transparent = {
    name: "transparent-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(transparentB64, "base64"),
  };

  await chooseFiles(page, "Choose photos", [transparent, asInput(FIX.sharpText)]);
  await waitForResolved(page, 2);

  const state = await debugState(page);
  const skipped = state.photos.find((p) => p.name === transparent.name);
  assert(skipped, "transparent photo missing from the store");
  assert(
    skipped.band === "skipped" && skipped.score === null,
    `transparent photo not marked skipped: ${JSON.stringify({ band: skipped.band, score: skipped.score })}`,
  );
  const scoredCount = state.photos.filter((p) => ["blurry", "review", "sharp"].includes(p.band)).length;
  assert(scoredCount === 1, `${scoredCount} photos scored, expected 1 (transparent must not be scored)`);
  assert(state.skippedAnalysis.length === 1 && state.skippedAnalysis[0] === transparent.name, "analysis-skip ledger wrong");

  // Visible counted notice + body copy.
  await expectRoleHeading(page, "1 photo couldn't be analyzed", "analysis-skip notice heading");
  await expectExactText(
    page,
    "These photos have no visible pixels, so they can't be scored. They were skipped — nothing was changed.",
    "analysis-skip notice body",
  );

  // Chip stays "—" for the skipped photo; the scored one shows its number.
  const tiles = await visibleTileCount(page);
  assert(tiles === 2, `gallery shows ${tiles} tiles, expected 2 (skip keeps the tile)`);
  const skippedChip = await chipText(page, transparent.name);
  assert(skippedChip === "—", `skipped tile chip shows "${skippedChip}", expected "—"`);
  const sharpPhoto = state.photos.find((p) => p.name === FIX.sharpText.name);
  const sharpChip = await chipText(page, FIX.sharpText.name);
  assert(sharpChip === String(sharpPhoto.score), `scored chip shows "${sharpChip}", expected "${sharpPhoto.score}"`);

  await shot(page, "04-transparent-skip-notice.png");
  return `transparent: band "skipped", score null, chip "—", notice + ledger visible; sharp companion scored ${sharpChip}`;
}

/* ------------------------------------------------------------------ */
/* T5 — re-select the same files: identical scores (determinism)       */
/* ------------------------------------------------------------------ */

async function stateT5({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  await chooseFiles(page, "Choose photos", ALL_FOUR.map(asInput));
  await waitForResolved(page, 4);
  const firstRun = (await debugState(page)).photos.map((p) => ({ name: p.name, score: p.score, band: p.band }));
  assert(firstRun.length === 4, `first run produced ${firstRun.length} photos, expected 4`);

  // Re-select the same files through the in-gallery "Add more" path.
  await chooseFiles(page, "Add more", ALL_FOUR.map(asInput));
  await waitForResolved(page, 8);
  const secondRun = (await debugState(page)).photos.map((p) => ({ name: p.name, score: p.score, band: p.band }));
  assert(secondRun.length === 8, `after re-select the store holds ${secondRun.length} photos, expected 8`);

  const firstByName = new Map(firstRun.map((p) => [p.name, p]));
  const evidence = [];
  for (const fix of ALL_FOUR) {
    const runs = secondRun.filter((p) => p.name === fix.name);
    assert(runs.length === 2, `"${fix.name}" appears ${runs.length}× after re-select, expected 2`);
    assert(
      runs[0].score === runs[1].score && runs[0].band === runs[1].band,
      `"${fix.name}" unstable in-session: ${JSON.stringify(runs)}`,
    );
    const original = firstByName.get(fix.name);
    assert(
      runs[0].score === original.score && runs[0].band === original.band,
      `"${fix.name}" differs from first run: first ${JSON.stringify(original)}, reselect ${JSON.stringify(runs[0])}`,
    );
    evidence.push(`${fix.name}=${runs[0].score}/${runs[0].band}×2`);
  }

  await shot(page, "05-determinism-reselect.png");
  return `8 photos (4 fixtures × 2 runs); every re-run byte-identical: ${evidence.join(", ")}`;
}

/* ------------------------------------------------------------------ */
/* T6 — worker failure: notice + Try again, recovery                   */
/* ------------------------------------------------------------------ */

/**
 * Fault injection at the NETWORK boundary only (no app code touched): the test
 * server answers /js/blur-worker.js with 500, so the worker script cannot load
 * and the analyzer's startup handshake fails. The fault is healed before the
 * retry → a fresh worker starts normally.
 */
async function stateT6({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  serverFaults.blurWorker500 = true;
  try {
    await chooseFiles(page, "Choose photos", [asInput(FIX.sharpText)]);

    // Intake decodes on the main thread and succeeds; analysis then fails to
    // start its worker → the app must surface the generic-error notice.
    await expectRoleHeading(page, "Something went wrong", "generic error heading", NOTICE_TIMEOUT);
    await expectExactText(
      page,
      "Analysis stopped partway. Photos already scored keep their scores.",
      "generic error body",
    );
    await expectButton(page, "Try again", "Try again button");
    await expectButton(page, "Dismiss", "Dismiss button");

    const failedState = await debugState(page);
    assert(failedState.analysis.phase === "failed", `analysis phase is "${failedState.analysis.phase}", expected "failed"`);
    assert(
      failedState.photos.length === 1 && failedState.photos[0].band === null,
      `failed photo state wrong: ${JSON.stringify(failedState.photos)}`,
    );
    assert((await chipText(page, FIX.sharpText.name)) === "—", "failed photo chip is not the pending dash");
    const stillInteractive = await page.evaluate(() => 6 * 7);
    assert(stillInteractive === 42, "page did not respond to evaluate() after analysis failure");
    await shot(page, "06a-worker-failure-notice.png");
  } finally {
    serverFaults.blurWorker500 = false; // heal before the retry (also on failure, so retries start clean)
  }

  // Click the app's own recovery affordance now that the fault is healed.
  await page.getByRole("button", { name: "Try again" }).click({ timeout: STEP_TIMEOUT });
  await waitForResolved(page, 1, ANALYSIS_TIMEOUT, "retry analysis");
  const recovered = (await debugState(page)).photos[0];
  assert(
    Number.isInteger(recovered.score) && ["blurry", "review", "sharp"].includes(recovered.band),
    `retry did not score the photo: ${JSON.stringify(recovered)}`,
  );
  const recoveredChip = await chipText(page, FIX.sharpText.name);
  assert(recoveredChip === String(recovered.score), `recovered chip shows "${recoveredChip}", expected "${recovered.score}"`);
  await shot(page, "06b-worker-failure-recovered.png");

  // And the app keeps working for the next batch too.
  await chooseFiles(page, "Add more", [asInput(FIX.sharpCheckerboard)]);
  await waitForResolved(page, 2, ANALYSIS_TIMEOUT, "post-recovery batch");
  const afterBatch = await debugState(page);
  for (const p of afterBatch.photos) {
    assert(
      Number.isInteger(p.score) && ["blurry", "review", "sharp"].includes(p.band),
      `post-recovery batch photo unresolved: ${JSON.stringify(p)}`,
    );
  }

  return `failure → "Something went wrong" + Try again; retry scored "${FIX.sharpText.name}" ${recovered.score}/${recovered.band}; next batch scored 2/2`;
}

/* ------------------------------------------------------------------ */
/* T7 — Phase 2 regression quick pass                                  */
/* ------------------------------------------------------------------ */

async function stateT7({ page, context }) {
  await context.addInitScript(REVOKE_SPY);
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  /* (a) empty state */
  await expectRoleHeading(page, "Find the blurry photos", "empty-state heading");
  await expectButton(page, "Choose photos", "empty-state CTA");
  await expectExactText(page, "Photos never leave this device.", "privacy line");
  const startOverEmpty = await page.getByRole("button", { name: "Start over" }).count();
  assert(startOverEmpty === 0, `"Start over" visible in the empty state (${startOverEmpty} match)`);
  await shot(page, "07a-regression-empty.png");

  /* (b) one photo via the real picker path */
  await chooseFiles(page, "Choose photos", [asInput(FIX.sharpText)]);
  await expectExactText(page, FIX.sharpText.name, "tile filename");
  await expectExactText(page, "1 photo", "photo count");
  const singleText = await tileText(page, FIX.sharpText.name);
  const sizeMatch = /(\d+(?:\.\d+)?) (B|KB|MB|GB)/.exec(singleText);
  assert(sizeMatch, `no file size shown in the single tile (tile text: ${JSON.stringify(singleText)})`);
  await expectButton(page, "Start over", "Start over after selection");
  await shot(page, "07b-regression-single-photo.png");

  /* (c) invalid file → visible notice, gallery unchanged */
  await chooseFiles(page, "Add more", [asInput(FIX.notAnImage)]);
  await expectRoleHeading(page, "1 file couldn't be opened", "undecodable notice heading");
  const namesAfterInvalid = await visibleTileNames(page);
  assert(
    namesAfterInvalid.length === 1 && namesAfterInvalid[0] === FIX.sharpText.name,
    `skipped file leaked into the gallery: ${JSON.stringify(namesAfterInvalid)}`,
  );
  await expectExactText(page, "1 photo", "count unchanged after skip");
  await shot(page, "07c-regression-invalid-notice.png");

  /* (d) start over clears and revokes every thumbnail object URL */
  await chooseFiles(page, "Add more", [asInput(FIX.sharpCheckerboard)]);
  await waitForResolved(page, 2, ANALYSIS_TIMEOUT, "regression gallery");
  const srcs = await page.$$eval(".photo-grid img", (imgs) => imgs.map((img) => img.src));
  assert(srcs.length === 2 && srcs.every((s) => s.startsWith("blob:")), `unexpected thumbnail srcs: ${JSON.stringify(srcs)}`);

  await page.getByRole("button", { name: "Start over" }).click({ timeout: STEP_TIMEOUT });
  const stateDialogs = dialogs.filter((d) => d.tag === currentTag);
  assert(
    stateDialogs.some((d) => d.type === "confirm" && /Start over\?/.test(d.message)),
    `native confirm not observed: ${JSON.stringify(stateDialogs)}`,
  );
  await expectRoleHeading(page, "Find the blurry photos", "empty state after Start over");
  await page.waitForFunction(() => document.querySelectorAll(".photo-grid img").length === 0, null, {
    timeout: STEP_TIMEOUT,
    polling: 100,
  });
  const startOverAfter = await page.getByRole("button", { name: "Start over" }).count();
  assert(startOverAfter === 0, `"Start over" still visible after clear (${startOverAfter})`);

  const revoked = await page.evaluate(() => window.__revokeLog.slice());
  const missing = srcs.filter((src) => !revoked.includes(src));
  assert(missing.length === 0, `${missing.length}/${srcs.length} thumbnail object URLs never revoked. Example: ${missing[0]}`);
  await shot(page, "07d-regression-after-start-over.png");

  return `empty state clean; 1 photo shows "${sizeMatch[0]}"; invalid notice leaves 1 tile; start-over (confirm accepted) cleared and revoked ${srcs.length}/${srcs.length} object URLs`;
}

/* ------------------------------------------------------------------ */
/* Main flow                                                           */
/* ------------------------------------------------------------------ */

(async () => {
  const watchdog = setTimeout(() => {
    console.error(`WATCHDOG: run exceeded ${WATCHDOG_MS / 1000}s — forcing exit (code 2).`);
    try {
      if (browser && browser.process()) browser.process().kill();
    } catch {
      /* best effort */
    }
    try {
      if (server) {
        server.closeAllConnections();
        server.unref();
      }
    } catch {
      /* best effort */
    }
    process.exit(2);
  }, WATCHDOG_MS);

  let fatal = null;
  let appUrlLocal = null;

  try {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

    const { server: srv, port } = await startServer(APP_ROOT, BASE_PORT);
    server = srv;
    appUrlLocal = `http://127.0.0.1:${port}/`;
    appUrl = appUrlLocal; // module-scope for state functions
    console.log(`Serving  ${APP_ROOT}`);
    console.log(`App URL  ${appUrl}`);

    const launchAttempts = [
      { label: "channel:chrome (system Chrome, headless — binding directive)", opts: { channel: "chrome", headless: true } },
      { label: "bundled chromium (fallback — reported if used)", opts: { headless: true } },
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

    console.log(`\n--- T1: 4 fixtures ---`);
    await runState("T1", "4 fixtures: chips fill 0–100, sharp ≥60 sharp, blurred ≤40 blurry (+375px)", stateT1);

    console.log(`\n--- T2: 20-photo 1600×1200 batch ---`);
    await runState("T2", "20× 1600×1200 batch: all scored, interactive mid-batch, counts intact, <30s", stateT2);

    console.log(`\n--- T3: mixed valid + invalid ---`);
    await runState("T3", "Mixed batch: invalid → visible notice, valid analyzed, counts exclude skipped", stateT3);

    console.log(`\n--- T4: transparent PNG ---`);
    await runState("T4", "Transparent PNG: \"couldn't be analyzed\" notice, chip \"—\", band skipped", stateT4);

    console.log(`\n--- T5: determinism ---`);
    await runState("T5", "Re-select same files: scores/bands identical to first run", stateT5);

    console.log(`\n--- T6: worker failure resilience ---`);
    await runState("T6", "Worker script aborted: generic error + Try again; recovery on retry + next batch", stateT6);

    console.log(`\n--- T7: Phase 2 regression quick pass ---`);
    await runState("T7", "Phase 2 core: empty, 1 photo, invalid notice, start-over + URL revocation", stateT7);

    /* ---------------- T8 — hygiene across every state ---------------- */

    console.log(`\n--- T8: hygiene ---`);
    // The only permitted noise: T6's deliberately injected worker-script
    // failure. Everything else must be silent.
    const t6InjectedFaultEvents = hygiene.filter(
      (h) => h.tag.startsWith("T6") && h.url && /blur-worker\.js/.test(h.url),
    );
    const isInjectedNoise = (h) => {
      if (!h.tag.startsWith("T6")) return false;
      if (h.url && /blur-worker\.js/.test(h.url)) return true;
      // Chrome may log a "Failed to load resource ... 500" console error for
      // the injected worker-script failure (location = the script URL; if the
      // location is missing, attribute it only while the injected fault fired).
      if (
        h.kind === "console.error" &&
        /Failed to load resource|ERR_FAILED|500/i.test(h.text) &&
        t6InjectedFaultEvents.length > 0
      ) {
        return true;
      }
      return false;
    };

    if (hygiene.length > 0) {
      console.log("      hygiene events collected:");
      for (const h of hygiene) {
        console.log(`        [${h.tag}] ${h.kind}${isInjectedNoise(h) ? " (injected T6 fault — excluded)" : ""}: ${h.text}${h.url && !h.text.includes(h.url) ? ` @ ${h.url}` : ""}`);
      }
      console.log(
        `      injected T6 fault evidence: ${t6InjectedFaultEvents.length} event(s) for blur-worker.js` +
          (t6InjectedFaultEvents.length ? `: ${t6InjectedFaultEvents.map((h) => h.text).join("; ")}` : " — none observed (error event or watchdog path may have produced no request event)"),
      );
    }
    const unexpected = hygiene.filter(
      (h) =>
        !isInjectedNoise(h) &&
        (h.kind === "console.error" ||
          h.kind === "console.warning" ||
          h.kind === "pageerror" ||
          h.kind === "requestfailed" ||
          /^http\.(4|5)/.test(h.kind)),
    );
    currentTag = "T8";
    if (unexpected.length === 0) {
      record(
        "T8",
        "Hygiene: zero console errors/warnings, pageerrors, failed requests, HTTP>=400",
        "PASS",
        `${hygiene.length} raw hygiene event(s) collected; all unexpected-noise categories empty` +
          (t6InjectedFaultEvents.length ? `; ${t6InjectedFaultEvents.length} injected T6 worker-fault event(s) excluded as designed` : ""),
      );
    } else {
      const summary = unexpected.map((i) => `[${i.tag}] ${i.kind}: ${i.text}`).join(" | ");
      record("T8", "Hygiene: zero console errors/warnings, pageerrors, failed requests, HTTP>=400", "FAIL",
        `${unexpected.length} unexpected event(s): ${summary}`);
      console.error(`      hygiene FAIL details: ${summary}`);
    }
  } catch (error) {
    fatal = error;
    console.error("FATAL:", (error && error.stack) || error);
  } finally {
    clearTimeout(watchdog);
    try {
      if (browser) await browser.close();
    } catch {
      /* already closed */
    }
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    } catch {
      /* best effort */
    }
  }

  /* ---------------- summary ---------------- */

  console.log("\n=== PHASE 3 E2E TESTER SUMMARY (independent run) ===");
  for (const r of results) {
    console.log(`${r.status.padEnd(5)} ${r.id.padEnd(4)} ${r.name}${r.flaky ? "  [FLAKY: passed on retry]" : ""}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
  console.log(`\nWorkers observed:`);
  for (const w of workersSeen) console.log(`  [${w.tag}] ${w.url}`);
  console.log(`\nScreenshots (${shots.length}):`);
  for (const s of shots) console.log(`  e2e/artifacts/phase3-e2e-tester/${s.file}`);
  console.log(`\nDialogs handled: ${dialogs.length}`);

  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP");
  const flaky = results.filter((r) => r.flaky);
  const verdict = failed.length === 0 && !fatal ? "PASS" : "FAIL";
  console.log(
    `\nVerdict: ${verdict} — ${results.length - failed.length - skipped.length}/${results.length} states passed` +
      (skipped.length ? `, ${skipped.length} skipped` : "") +
      (flaky.length ? `, ${flaky.length} flaky` : "") +
      (fatal ? "; FATAL error terminated the run" : ""),
  );

  process.exit(fatal ? 2 : failed.length > 0 ? 1 : 0);
})().catch((error) => {
  console.error("UNCAUGHT TOP-LEVEL ERROR:", error);
  process.exit(2);
});

process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED REJECTION:", error);
  process.exitCode = 2;
});
