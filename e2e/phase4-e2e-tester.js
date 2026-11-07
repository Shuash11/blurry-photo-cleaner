/**
 * phase4-e2e-tester.js — INDEPENDENT Phase 4 (Results/review/export UI) e2e proof.
 *
 * Written by the E2E/Integration Testing Agent as an independent verification
 * run of the delegated Phase 4 state matrix (plans/blurry-photo-cleaner.md
 * Phase 4; designs/design-spec.md §8.1/§8.2/§9b/§9c/§9d). It does NOT import or
 * re-run the implementer's own suites; it drives the live served app through
 * its own states, with its own assertions and its own artifacts.
 *
 * Run:  node e2e/phase4-e2e-tester.js
 *
 * Tooling (binding directive): Playwright LIBRARY script only — playwright-cli
 * is banned. Chrome (channel "chrome") headless, in-process static server
 * killed in finally, per-step timeouts + whole-run watchdog, screenshots to
 * e2e/artifacts/phase4-e2e-tester/, process ALWAYS exits
 * (0 pass / 1 state failed / 2 fatal or watchdog).
 *
 * Delegated state matrix (each state runs in its own fresh browser context):
 *   P1  Analyzing: §9b progress card during a 24-photo batch ("N of 24", bar
 *       via aria-valuenow + scaleX, pending grid visible, no action bar / no
 *       "Add more" mid-analysis), then results render with the §6.2 band
 *       reveal (getAnimations band-reveal observed live on all 3 bands).
 *   P2  Grouped results: bands in fixed order Blurry → Needs review → Sharp,
 *       per-band count text == rendered tiles == store band population; empty
 *       band shows "No photos in this band" and no select-all toggle; no
 *       skipped section when no skipped photos.
 *   P3  Score chips (F1/F2; R4 re-scope 2026-11-06 — design-spec-v2 §11.2):
 *       every scored tile's chip reads "NN% sharp", identity-mapped from its
 *       store score, and its computed color equals the --color-band-*-text
 *       token (#FF6B6E / #FFB25C / #5BD97E); band chip headings use the same
 *       tokens.
 *   P4  Selection: single-tile toggle (aria-pressed + ring + check badge),
 *       band Select all / Deselect, action-bar summary "N selected · M total"
 *       sync; selection survives detail open/close AND a results re-render
 *       ("Add more" → re-analysis).
 *   P5  Download selected (0 selected disabled): select 2 → 2 download events,
 *       correct original filenames in store order, byte-identical content;
 *       busy state ("Preparing…", spinner, Add more disabled) + polite live
 *       announcements "Preparing 2 photos" / "Saved 2 photos".
 *   P6  Detail view (§9d + F3/F4/F5): dialog role labelled on the panel
 *       "Reviewing <name>"; desktop chevrons prev/next within band, ends
 *       disabled; Select toggle = label-change pattern (Select ↔ Selected +
 *       check glyph via is-selected, NO aria-pressed); per-item download with
 *       byte-identical content; mobile "‹ swipe ›" hint with keyboard-
 *       reachable chevron buttons (Tab trail + Enter navigation); Escape and
 *       Done close; focus returns to the originating tile. Also probes the
 *       focus-containment edge after a control self-disables (reported).
 *   P7  Add more after results (beginBatch detached-DOM fix): pending grid
 *       with existing scored tiles + new placeholders is VISIBLE (count
 *       "8 photos", 8 tiles), re-analysis runs, band counts update, old scores
 *       persist, no duplicate/lost tiles.
 *   P8  Mixed batch with invalid files: valid analyzed, invalid listed in the
 *       "N files couldn't be opened" notice, counts exclude them; a transparent
 *       PNG produces the analysis-skip notice + a trailing Skipped section
 *       (only when present), excluded from the three band counts.
 *   P9  Contrast regression (computed): band chips ≥ 4.5:1 on their tint
 *       composite; score chips ≥ 4.5:1 on #141517 (and on their composite).
 *   P10 Hygiene + responsiveness: zero console errors/warnings/pageerrors/
 *       failed requests / HTTP>=400 across every state; every network request
 *       same-origin (client-only app — no backend API by design); 375px zero
 *       horizontal overflow in empty / analyzing / results / detail states.
 *   P11 Phase 2/3 core regression quick pass: empty state; 1-photo upload via
 *       the real picker path (filename + "96% sharp" chip per the R4 re-scope
 *       2026-11-06 — design-spec-v2 §11.2 layout consequence moved the tile's
 *       file-size caption to the detail view, §11.5/Phase R6 — plus "· 1
 *       total"); invalid-file notice; start-over with object-URL revocation;
 *       fixture scoring determinism across two runs (Phase 3 surface).
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
const ARTIFACTS_DIR = path.join(__dirname, "artifacts", "phase4-e2e-tester");
const BASE_PORT = 8993;
const STEP_TIMEOUT = 15000;      // one user step / one wait for a UI state
const ANALYSIS_TIMEOUT = 60000;  // full batch resolution budget (24 large photos)
const WATCHDOG_MS = 540000;      // whole-run hard cap

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };

/* Phase 4 fix F1/F2 tokens (§3.3): band text on tints / the grouped
   background. These are the exact values the chips must compute to. */
const BAND_TOKENS = {
  blurry: { hex: "#FF6B6E", css: "rgb(255, 107, 110)", rgb: [255, 107, 110] },
  review: { hex: "#FFB25C", css: "rgb(255, 178, 92)", rgb: [255, 178, 92] },
  sharp: { hex: "#5BD97E", css: "rgb(91, 217, 126)", rgb: [91, 217, 126] },
};
const BAND_LABELS = { blurry: "Blurry", review: "Needs review", sharp: "Sharp" };
const GROUPED_BG = [20, 21, 23]; // #141517 — §3.1 grouped background (delegated contrast target)

/* ------------------------------------------------------------------ */
/* Run state                                                           */
/* ------------------------------------------------------------------ */

const results = [];  // { id, name, status, detail, flaky }
const hygiene = [];  // { tag, kind, text, url }
const netLog = [];   // { tag, url, status } — integration-chain evidence
const dialogs = [];  // { tag, type, message }
const shots = [];    // { tag, file }
let currentTag = "boot";
let server = null;
let browser = null;
let appUrl = null;

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
};

const ALL_FOUR = [FIX.sharpCheckerboard, FIX.sharpText, FIX.blurredCheckerboard, FIX.blurredText];

function asInput(f, nameOverride) {
  return { name: nameOverride || f.name, mimeType: f.mime, buffer: f.buffer };
}

/* ------------------------------------------------------------------ */
/* Logging / assertion helpers                                         */
/* ------------------------------------------------------------------ */

function record(id, name, status, detail, flaky) {
  results.push({ id, name, status, detail, flaky: Boolean(flaky) });
  const marker = status === "PASS" ? (flaky ? "PASS*" : "PASS ") : "FAIL ";
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
  console.log(`      shot: e2e/artifacts/phase4-e2e-tester/${file}`);
}

async function expectHeading(page, name, label, timeout = STEP_TIMEOUT) {
  try {
    await page.getByRole("heading", { name, exact: true }).first().waitFor({ state: "visible", timeout });
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

async function expectDialog(page, name, timeout = STEP_TIMEOUT) {
  try {
    await page.getByRole("dialog", { name, exact: true }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    throw new Error(`dialog "${name}" not visible (${firstLine(error)})`);
  }
}

/** App's sanctioned inspection seam (main.js). */
async function debugState(page) {
  return page.evaluate(() => window.__debugState());
}

/** Wait until every store photo has a band and analysis left "analyzing". */
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

/** Wait for the grouped results screen (band headings always render). */
async function waitForResults(page, timeout = STEP_TIMEOUT) {
  try {
    await page.getByRole("heading", { name: "Blurry", exact: true }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    throw new Error(`results screen (band headings) not visible (${firstLine(error)})`);
  }
}

/** Visible tile (listitem) count. */
async function visibleTileCount(page) {
  return page.getByRole("listitem").filter({ visible: true }).count();
}

/** Text content of the visible tile whose text contains `name`. */
async function tileText(page, name) {
  const tile = page.getByRole("listitem").filter({ visible: true, hasText: name }).first();
  await tile.waitFor({ state: "visible", timeout: STEP_TIMEOUT });
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

/** Poll `fn` until it returns true (bounded settling wait, not a sleep). */
async function waitsTrue(fn, timeout = 3000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await fn().catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(25);
  }
}

/** Diagnostics for a control that should be disabled but is not. */
function disabledDiagnostics(locator, message) {
  return locator
    .evaluate((el) => ({
      cls: String(el.className),
      disabledProp: el.disabled,
      disabledAttr: el.getAttribute("disabled"),
      panels: document.querySelectorAll(".detail__panel").length,
      filename: document.querySelector(".detail__filename") ? document.querySelector(".detail__filename").textContent : null,
      active: document.activeElement ? (document.activeElement.getAttribute("aria-label") || document.activeElement.tagName) : null,
    }))
    .then((diag) => `${message} — diagnostics ${JSON.stringify(diag)}`)
    .catch(() => message);
}

/** Wait for the detail view to be showing `name`. */
async function waitForDetailName(page, name, timeout = STEP_TIMEOUT) {
  await page
    .waitForFunction(
      (expected) => {
        const f = document.querySelector(".detail__filename");
        return !!f && f.textContent === expected;
      },
      name,
      { timeout, polling: 50 },
    )
    .catch(() => {
      throw new Error(`detail did not navigate to "${name}" within ${timeout}ms`);
    });
}

/* ------------------------------------------------------------------ */
/* Band helpers                                                        */
/* ------------------------------------------------------------------ */

const band = (page, id) => page.locator(`[data-band="${id}"]`);

async function bandIds(page) {
  return page.$$eval("[data-band]", (els) => els.map((el) => el.getAttribute("data-band")));
}

/** Parse "N photos" / "1 photo" band-count text. */
function parseCountText(text) {
  const m = /^(\d+)\s+(photo|photos)$/.exec((text || "").trim());
  return m ? Number(m[1]) : null;
}

/** tiles by name → band id, from the rendered results grid (tile text match). */
async function renderedTileNames(page, id) {
  const tiles = band(page, id).getByRole("listitem");
  const count = await tiles.count();
  const names = [];
  for (let i = 0; i < count; i += 1) {
    names.push((await tiles.nth(i).locator(".tile__filename").innerText()).trim());
  }
  return names;
}

/* ------------------------------------------------------------------ */
/* Contrast helpers (WCAG ratio + composited backdrop)                 */
/* ------------------------------------------------------------------ */

function contrastRatio(fg, bg) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const l1 = lum(...fg);
  const l2 = lum(...bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** __p4sample returns fg as {r,g,b,a}; normalize to [r,g,b] for contrastRatio. */
function toRGB(c) {
  return Array.isArray(c) ? c : [c.r, c.g, c.b];
}

/** Analytic composite: element foreground + every non-transparent ancestor
    background stacked bottom-up over white (same method as the Phase 2 lock). */
const INSTALL_SAMPLE = () => {
  const parseRGB = (str) => {
    const m = /rgba?\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)(?:,\s*([\d.]+))?\)/.exec(str || "");
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  window.__p4sample = (el) => {
    const layers = [];
    let node = el;
    while (node && node !== document.documentElement) {
      const c = parseRGB(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) layers.push(c);
      node = node.parentElement;
    }
    let bg = null;
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const l = layers[i];
      const over = bg || [255, 255, 255];
      bg = [l.a * l.r + (1 - l.a) * over[0], l.a * l.g + (1 - l.a) * over[1], l.a * l.b + (1 - l.a) * over[2]];
    }
    const s = getComputedStyle(el);
    const fg = parseRGB(s.color);
    return { fg, fgRaw: s.color, bg: bg || [255, 255, 255] };
  };
};

/** Object-URL revocation spy (Phase 2 regression quick pass). */
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
};

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
/* Page wiring — hygiene + dialogs + network log                       */
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
    netLog.push({ tag, url: res.url(), status: res.status() });
    if (res.status() >= 400) {
      hygiene.push({ tag, kind: `http.${res.status()}`, text: res.url(), url: res.url() });
    }
  });
  page.on("dialog", (dialog) => {
    dialogs.push({ tag, type: dialog.type(), message: dialog.message() });
    dialog.accept().catch(() => {});
  });
}

/* ------------------------------------------------------------------ */
/* State runner — fresh context per attempt, max two retries           */
/* ------------------------------------------------------------------ */

async function runState(id, name, fn) {
  // Debug-only filter (e.g. P4_ONLY=P6): a filtered run is NEVER gate evidence.
  const only = process.env.P4_ONLY ? process.env.P4_ONLY.split(",").map((s) => s.trim()) : null;
  if (only && !only.includes(id)) {
    console.log(`\n--- ${id}: skipped (P4_ONLY debug filter) ---`);
    return;
  }
  const MAX_ATTEMPTS = 3; // initial + two retries (delegated flakiness cap)
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const tag = attempt === 1 ? id : `${id}#try${attempt}`;
    currentTag = tag;
    const context = await browser.newContext({
      viewport: DESKTOP_VIEWPORT,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    wirePage(page, tag);
    page.setDefaultTimeout(STEP_TIMEOUT);
    let detail = "";
    let ok = true;
    try {
      detail = (await fn({ page, context, tag, attempt })) || "";
    } catch (error) {
      ok = false;
      lastError = error;
      console.error(`      attempt ${attempt} failed: ${firstLine(error)}`);
      try {
        await page.screenshot({
          path: path.join(ARTIFACTS_DIR, `fail-${id}-try${attempt}.png`),
          timeout: 5000,
        });
        console.error(`      failure shot: e2e/artifacts/phase4-e2e-tester/fail-${id}-try${attempt}.png`);
      } catch {
        /* best effort */
      }
    } finally {
      await context.close().catch(() => {});
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
/* P1 — Analyzing: §9b progress card, then results with band reveal    */
/* ------------------------------------------------------------------ */

async function stateP1({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  // Deterministic large photo generated in-page (gradient + seeded speckle);
  // 24 copies give a multi-second analysis window.
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
  note(`generated 1600×1200 photo: ${(bigBuffer.length / 1024).toFixed(0)} KB × 24`);
  const batch = Array.from({ length: 24 }, (_, i) => ({
    name: `progress-photo-${String(i + 1).padStart(2, "0")}.png`,
    mimeType: "image/png",
    buffer: bigBuffer,
  }));

  await chooseFiles(page, "Choose photos", batch);

  // §9b progress card: heading, "N of 24" status, determinate bar.
  await expectHeading(page, "Analyzing photos", "§9b progress card heading");
  const bar = page.getByRole("progressbar", { name: "Analyzing photos" });
  await bar.waitFor({ state: "visible", timeout: STEP_TIMEOUT });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[role="progressbar"][aria-label="Analyzing photos"]');
      return !!el && Number(el.getAttribute("aria-valuenow")) >= 1 && Number(el.getAttribute("aria-valuemax")) === 24;
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 25 },
  );
  const sample = await page.evaluate(() => {
    const card = [...document.querySelectorAll("section")].find(
      (s) => s.querySelector("h2") && s.querySelector("h2").textContent.trim() === "Analyzing photos",
    );
    const status = card ? card.querySelector(".progress-card__status") : null;
    const barEl = card ? card.querySelector('[role="progressbar"]') : null;
    const fill = card ? card.querySelector(".progress-card__fill") : null;
    return {
      status: status ? status.textContent.trim() : null,
      now: barEl ? Number(barEl.getAttribute("aria-valuenow")) : null,
      max: barEl ? Number(barEl.getAttribute("aria-valuemax")) : null,
      transform: fill ? fill.style.transform || getComputedStyle(fill).transform : null,
    };
  });
  assert(sample.status && /^\d+ of 24$/.test(sample.status), `progress status "${sample.status}" does not read "N of 24"`);
  assert(sample.now >= 1 && sample.max === 24, `progressbar values now=${sample.now} max=${sample.max}`);
  assert(sample.transform && sample.transform.startsWith("scaleX("), `progress fill transform "${sample.transform}" is not scaleX()`);

  // §9b: pending grid below the card, no action bar, no intake affordance.
  const pendingTiles = await visibleTileCount(page);
  assert(pendingTiles === 24, `pending grid shows ${pendingTiles} visible tiles while analyzing, expected 24`);
  assert(
    (await page.getByRole("button", { name: "Download selected" }).count()) === 0,
    "action bar (Download selected) visible while analyzing — §9b shows no action bar",
  );
  assert(
    (await page.getByRole("button", { name: "Select all", exact: true }).count()) === 0,
    "band toggles visible while analyzing",
  );
  const addMoreVisible = await page.getByRole("button", { name: "Add more", exact: true }).filter({ visible: true }).count();
  assert(addMoreVisible === 0, `"Add more" visible while analyzing (${addMoreVisible} match) — §9b keeps no intake affordance mid-analysis`);
  await shot(page, "01a-analyzing-progress.png");

  // §6.2 band reveal: observer armed before the transition completes.
  const revealPromise = page
    .waitForFunction(() => document.getAnimations().some((a) => a.animationName === "band-reveal"), null, {
      timeout: ANALYSIS_TIMEOUT,
      polling: 25,
    })
    .then(() => true)
    .catch(() => false);

  await waitForResults(page, ANALYSIS_TIMEOUT);
  const sawRevealAnimation = await revealPromise;
  const revealNames = await page.$$eval("[data-band]", (els) => els.map((el) => getComputedStyle(el).animationName));
  assert(sawRevealAnimation, "no live band-reveal animation observed on the analyzing → results transition (§6.2)");
  assert(
    revealNames.length === 3 && revealNames.every((n) => n === "band-reveal"),
    `band reveal animation names: ${JSON.stringify(revealNames)}`,
  );

  assert(
    (await page.getByRole("heading", { name: "Analyzing photos" }).count()) === 0,
    "progress card still present after results rendered",
  );
  await waitForResolved(page, 24);
  assert(
    (await page.getByText("0 selected · 24 total", { exact: true }).count()) === 1,
    "action-bar summary missing after the 24-photo batch",
  );
  const stats = [];
  for (const id of ["blurry", "review", "sharp"]) {
    const n = parseCountText(await band(page, id).locator(".band__count").innerText());
    stats.push(`${id}=${n}`);
  }
  await shot(page, "01b-results-after-reveal.png");

  return `card visible "${sample.status}" (bar now=${sample.now}/${sample.max}, fill ${sample.transform}); 24 pending tiles, no action bar; results rendered with band-reveal on all 3 bands; counts ${stats.join(", ")}`;
}

/* ------------------------------------------------------------------ */
/* P2 — grouped results structure                                      */
/* ------------------------------------------------------------------ */

async function stateP2({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await chooseFiles(page, "Choose photos", ALL_FOUR.map((f) => asInput(f)));
  await waitForResolved(page, 4);
  await waitForResults(page);

  // Fixed order Blurry → Needs review → Sharp (skipped absent).
  const ids = await bandIds(page);
  assert(
    ids.length === 3 && ids[0] === "blurry" && ids[1] === "review" && ids[2] === "sharp",
    `band order ${JSON.stringify(ids)}, expected ["blurry","review","sharp"]`,
  );

  const state = await debugState(page);
  const storeBandCount = (b) => state.photos.filter((p) => p.band === b).length;

  const stats = [];
  for (const id of ids) {
    const section = band(page, id);
    await expectHeading(section, BAND_LABELS[id], `band heading "${BAND_LABELS[id]}"`, STEP_TIMEOUT);
    const countText = (await section.locator(".band__count").innerText()).trim();
    const n = parseCountText(countText);
    assert(n !== null, `band ${id} count text "${countText}" does not match "N photos"`);
    const tiles = await section.getByRole("listitem").count();
    assert(n === tiles, `band ${id}: count text says ${n}, but ${tiles} tiles render`);
    assert(n === storeBandCount(id), `band ${id}: ${n} shown vs ${storeBandCount(id)} store photos with band "${id}"`);
    stats.push(`${id}=${n}`);
  }

  // Empty band: message + count 0, no select-all toggle.
  const review = band(page, "review");
  assert(
    (await review.getByText("No photos in this band", { exact: true }).count()) === 1,
    "empty review band does not show 'No photos in this band'",
  );
  assert(
    (await review.getByRole("button", { name: "Select all", exact: true }).count()) === 0,
    "empty band shows a Select all toggle",
  );
  // Populated bands each carry the select-all affordance. R6 re-scope
  // (2026-11-06, design-spec-v2 §11.5.5): the Blurry band's toggle is
  // "Select all recommended ({N})" — the band IS the recommended set.
  for (const id of ["blurry", "sharp"]) {
    const toggle = band(page, id).getByRole("button", {
      name: id === "blurry" ? /Select all recommended \(\d+\)/ : "Select all",
    });
    assert(
      (await toggle.count()) === 1,
      `band ${id} has no select-all toggle (blurry expects "Select all recommended (N)")`,
    );
  }
  assert(!ids.includes("skipped"), "skipped section rendered although no photo was skipped");

  // Action bar scaffolding + §13 device-reality copy + header title.
  assert(
    (await page.getByText("0 selected · 4 total", { exact: true }).count()) === 1,
    "action-bar summary '0 selected · 4 total' missing",
  );
  assert(
    (await page.getByText("Review here, delete these files on your phone.", { exact: true }).count()) === 1,
    "device-reality copy missing near the download action (§13)",
  );
  await page.getByRole("heading", { level: 1, name: "Results", exact: true }).waitFor({ state: "visible", timeout: STEP_TIMEOUT });

  await shot(page, "02-grouped-results.png");
  return `bands ${ids.join(" → ")}; counts==tiles==store (${stats.join(", ")}); empty band message + no toggle; no skipped section; summary "0 selected · 4 total"`;
}

/* ------------------------------------------------------------------ */
/* P3 — score chips: numbers + F1/F2 token colors                      */
/* ------------------------------------------------------------------ */

async function stateP3({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await chooseFiles(page, "Choose photos", ALL_FOUR.map((f) => asInput(f)));
  await waitForResolved(page, 4);
  await waitForResults(page);

  const state = await debugState(page);
  const byName = new Map(state.photos.map((p) => [p.name, p]));

  // F1: band chip headings compute to --color-band-*-text.
  const chipColors = {};
  for (const id of ["blurry", "review", "sharp"]) {
    const heading = band(page, id).getByRole("heading", { name: BAND_LABELS[id], exact: true });
    const color = await heading.evaluate((el) => getComputedStyle(el).color);
    assert(
      color === BAND_TOKENS[id].css,
      `band chip "${BAND_LABELS[id]}" color ${color}, expected ${BAND_TOKENS[id].css} (${BAND_TOKENS[id].hex})`,
    );
    chipColors[id] = color;
  }

  // F2: every scored tile — chip "NN% sharp" == store score (R4 §11.2
  // identity mapping), chip color == band token.
  let checked = 0;
  const evidence = [];
  for (const id of ["blurry", "review", "sharp"]) {
    const tiles = band(page, id).getByRole("listitem");
    const count = await tiles.count();
    for (let i = 0; i < count; i += 1) {
      const tile = tiles.nth(i);
      const name = (await tile.locator(".tile__filename").innerText()).trim();
      const photo = byName.get(name);
      assert(photo, `tile "${name}" has no matching store photo`);
      const numText = (await tile.locator(".chip__num").innerText()).trim();
      assert(numText === `${photo.score}% sharp`, `tile "${name}" chip shows "${numText}", expected "${photo.score}% sharp" (R4 §11.2 identity mapping)`);
      const color = await tile.locator(".chip__num").evaluate((el) => getComputedStyle(el).color);
      assert(
        color === BAND_TOKENS[photo.band].css,
        `tile "${name}" (${photo.band}) chip color ${color}, expected ${BAND_TOKENS[photo.band].css}`,
      );
      checked += 1;
      evidence.push(`${name}=${numText}/${photo.band}${color}`);
    }
  }
  assert(checked === 4, `checked ${checked} scored tiles, expected 4`);

  await shot(page, "03-score-chips-token-colors.png");
  return `band chips ${JSON.stringify(chipColors)} == F1 tokens; 4/4 tile chips read "NN% sharp" == store score (R4 §11.2) and color==F2 token (${evidence.join("; ")})`;
}

/* ------------------------------------------------------------------ */
/* P4 — selection model + survival across detail and re-render         */
/* ------------------------------------------------------------------ */

async function stateP4({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await chooseFiles(page, "Choose photos", ALL_FOUR.map((f) => asInput(f)));
  await waitForResolved(page, 4);
  await waitForResults(page);

  const summary = async () => (await page.locator(".action-bar__summary").innerText()).trim();
  const downloadBtn = page.getByRole("button", { name: "Download selected", exact: true });
  const photoBtn = (name) => page.getByRole("button", { name, exact: true });
  const tileOf = (name) => page.getByRole("listitem").filter({ hasText: name });
  const readTile = async (name) => ({
    pressed: await tileOf(name).getByRole("button", { name, exact: true }).getAttribute("aria-pressed"),
    checkVisible: await tileOf(name).locator(".tile__check").isVisible(),
    ring: await tileOf(name).getByRole("button", { name, exact: true }).evaluate((el) => getComputedStyle(el).boxShadow),
  });

  // Zero state: summary + primary disabled.
  assert((await summary()) === "0 selected · 4 total", `initial summary "${await summary()}"`);
  assert(await downloadBtn.isDisabled(), "Download selected is enabled with 0 selected");

  // Single toggle on: aria-pressed + ring + check badge.
  await photoBtn(FIX.sharpText.name).click();
  let t = await readTile(FIX.sharpText.name);
  assert(t.pressed === "true", `aria-pressed after select is "${t.pressed}"`);
  assert(t.checkVisible, "check badge not visible after selecting a tile");
  assert(t.ring !== "none" && /2px/.test(t.ring), `selection ring box-shadow "${t.ring}"`);
  assert((await summary()) === "1 selected · 4 total", `summary after 1 select "${await summary()}"`);
  await shot(page, "04a-single-selected.png");

  // Toggle off.
  await photoBtn(FIX.sharpText.name).click();
  t = await readTile(FIX.sharpText.name);
  assert(t.pressed === "false" && !t.checkVisible, `toggle off failed (pressed=${t.pressed}, check=${t.checkVisible})`);
  assert((await summary()) === "0 selected · 4 total", `summary after deselect "${await summary()}"`);

  // Band select-all → Deselect.
  await band(page, "sharp").getByRole("button", { name: "Select all", exact: true }).click();
  assert((await summary()) === "2 selected · 4 total", `summary after sharp Select all "${await summary()}"`);
  for (const n of [FIX.sharpCheckerboard.name, FIX.sharpText.name]) {
    t = await readTile(n);
    assert(t.pressed === "true" && t.checkVisible, `band select-all missed "${n}"`);
  }
  const deselectToggle = band(page, "sharp").getByRole("button", { name: "Deselect", exact: true });
  assert(await deselectToggle.isVisible(), "band toggle did not flip to Deselect when the band was fully selected");

  // Blurry band select-all adds; Deselect removes. R6 re-scope: the blurry
  // toggle reads "Select all recommended (N)" (§11.5.5).
  await band(page, "blurry").getByRole("button", { name: /Select all recommended \(\d+\)/ }).click();
  assert((await summary()) === "4 selected · 4 total", `summary after blurry Select all "${await summary()}"`);
  await band(page, "blurry").getByRole("button", { name: "Deselect", exact: true }).click();
  assert((await summary()) === "2 selected · 4 total", `summary after blurry Deselect "${await summary()}"`);
  await deselectToggle.click();
  assert((await summary()) === "0 selected · 4 total", `summary after sharp Deselect "${await summary()}"`);

  // Select exactly one tile for the survival tests.
  await photoBtn(FIX.sharpText.name).click();
  assert((await summary()) === "1 selected · 4 total", `summary before survival tests "${await summary()}"`);

  // Survival 1: detail open/close.
  await page.getByRole("button", { name: `View ${FIX.sharpText.name}`, exact: true }).click();
  const panel = page.locator(".detail__panel");
  await panel.waitFor({ state: "visible", timeout: STEP_TIMEOUT });
  const detailSelect = panel.getByRole("button", { name: /^Select(ed)?$/ });
  assert((await detailSelect.innerText()).trim() === "Selected", "detail Select toggle does not show 'Selected' for a selected tile");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".detail__panel"), null, { timeout: STEP_TIMEOUT, polling: 50 });
  t = await readTile(FIX.sharpText.name);
  assert(t.pressed === "true" && t.checkVisible, "selection lost after opening/closing the detail view");
  assert((await summary()) === "1 selected · 4 total", `summary after detail close "${await summary()}"`);

  // Survival 2: results re-render via "Add more" → re-analysis.
  await chooseFiles(page, "Add more", [asInput(FIX.sharpCheckerboard, "extra-sharp-copy.png")]);
  await waitForResolved(page, 5);
  await waitForResults(page);
  t = await readTile(FIX.sharpText.name);
  assert(t.pressed === "true" && t.checkVisible, "selection lost across the Add more → re-render cycle");
  assert((await summary()) === "1 selected · 5 total", `summary after re-render "${await summary()}"`);
  await shot(page, "04b-selection-survives-rerender.png");

  return `single toggle aria-pressed+ring+check; band Select all/Deselect syncs; summary 0→1→2→4→0→1; selection survived detail open/close and a 5-photo re-render ("1 selected · 5 total")`;
}

/* ------------------------------------------------------------------ */
/* P5 — Download selected                                              */
/* ------------------------------------------------------------------ */

async function stateP5({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await chooseFiles(page, "Choose photos", ALL_FOUR.map((f) => asInput(f)));
  await waitForResolved(page, 4);
  await waitForResults(page);

  const summary = async () => (await page.locator(".action-bar__summary").innerText()).trim();
  const downloadBtn = () => page.getByRole("button", { name: /^(Download selected|Preparing)/ });

  // 0 selected → disabled.
  assert(await downloadBtn().isDisabled(), "Download selected is enabled at 0 selected");
  assert((await summary()) === "0 selected · 4 total", `summary at zero "${await summary()}"`);

  // Select exactly 2 (one sharp, one blurry); store order decides download order.
  await page.getByRole("button", { name: FIX.sharpText.name, exact: true }).click();
  // R6 re-scope: the blurry tile's accessible name carries the §11.5.5
  // recommendation fact — match either name form.
  await page
    .getByRole("button", { name: new RegExp(`^${FIX.blurredCheckerboard.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(, suggested for deletion)?$`) })
    .click();
  assert((await summary()) === "2 selected · 4 total", `summary at 2 selected "${await summary()}"`);
  assert(!(await downloadBtn().isDisabled()), "Download selected disabled with 2 selected");

  const downloads = [];
  page.on("download", (d) => downloads.push({ name: d.suggestedFilename(), download: d, at: Date.now() }));

  await downloadBtn().click();
  // v0.3.0 re-scope: Download selected opens the export chooser — pick
  // Original (the byte-identical v0.1 behavior), then the busy state runs.
  await page.getByRole("button", { name: /^Original/ }).click();

  // Busy state: label "Preparing…", disabled, spinner, Add more disabled, live region.
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Preparing"));
      return !!btn && btn.disabled;
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 20 },
  );
  const spinnerVisible = await page.locator(".action-bar .spinner").isVisible();
  const addMoreDisabled = await page.getByRole("button", { name: "Add more", exact: true }).isDisabled();
  const liveBusy = (await page.locator("#live-region").textContent()).trim();
  assert(spinnerVisible, "spinner not visible during the download busy state");
  assert(addMoreDisabled, '"Add more" not disabled during downloads');
  assert(liveBusy === "Preparing 2 photos", `live region during busy "${liveBusy}", expected "Preparing 2 photos"`);
  await shot(page, "05a-download-busy.png");

  // Both downloads, sequentially, from the original files.
  const deadline = Date.now() + STEP_TIMEOUT;
  while (downloads.length < 2 && Date.now() < deadline) await sleep(50);
  assert(
    downloads.length === 2,
    `expected 2 download events, saw ${downloads.length} (${JSON.stringify(downloads.map((d) => d.name))})`,
  );
  // The app downloads in store order (decode-completion order) — derive it.
  const storeOrder = (await debugState(page)).photos
    .filter((p) => p.name === FIX.sharpText.name || p.name === FIX.blurredCheckerboard.name)
    .map((p) => p.name);
  assert(
    downloads.length === 2 && downloads[0].name === storeOrder[0] && downloads[1].name === storeOrder[1],
    `download names/order ${JSON.stringify(downloads.map((d) => d.name))}, expected store order ${JSON.stringify(storeOrder)}`,
  );
  const expectedBuffers = new Map([
    [FIX.sharpText.name, FIX.sharpText.buffer],
    [FIX.blurredCheckerboard.name, FIX.blurredCheckerboard.buffer],
  ]);
  for (const d of downloads) {
    const expectedBuffer = expectedBuffers.get(d.name);
    const savedPath = await d.download.path();
    const saved = fs.readFileSync(savedPath);
    assert(
      saved.length === expectedBuffer.length && saved.equals(expectedBuffer),
      `saved "${d.name}" (${saved.length} B) differs from the original file (${expectedBuffer.length} B)`,
    );
  }
  note(`download events: ${downloads.map((d) => d.name).join(" → ")}; Δt=${downloads[1].at - downloads[0].at}ms (sequential loop)`);

  // Completion state: label restored, spinner hidden, Add more enabled, live region.
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Download selected"));
      return !!btn && !btn.disabled;
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 50 },
  );
  const liveAfter = (await page.locator("#live-region").textContent()).trim();
  assert(liveAfter === "Saved 2 photos", `live region after downloads "${liveAfter}", expected "Saved 2 photos"`);
  assert(!(await page.locator(".action-bar .spinner").isVisible()), "spinner still visible after downloads finished");
  assert(!(await page.getByRole("button", { name: "Add more", exact: true }).isDisabled()), '"Add more" still disabled after downloads');
  await shot(page, "05b-after-download.png");

  return `0 selected disabled; 2 selected → "${downloads[0].name}" + "${downloads[1].name}" (byte-identical, ${downloads[1].at - downloads[0].at}ms apart); busy "Preparing…"+spinner+Add more disabled+live "Preparing 2 photos"; done → live "Saved 2 photos"`;
}

/* ------------------------------------------------------------------ */
/* P6 — detail view: dialog label, nav, Select pattern, per-item DL    */
/* ------------------------------------------------------------------ */

async function stateP6({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  // 5 photos: the sharp band holds 3 (checkerboard, text, extra copy), so a
  // MIDDLE photo exists — both chevrons can be enabled and keyboard-reachable
  // there, while the first/last photos still prove the ends-disabled rule.
  const EXTRA_SHARP = asInput(FIX.sharpText, "extra-sharp-copy.png");
  await chooseFiles(page, "Choose photos", [...ALL_FOUR.map((f) => asInput(f)), EXTRA_SHARP]);
  await waitForResolved(page, 5);
  await waitForResults(page);
  const sharpCount = parseCountText(await band(page, "sharp").locator(".band__count").innerText());
  assert(sharpCount === 3, `sharp band holds ${sharpCount} photos, expected 3 for the middle-photo checks`);

  // The store inserts records in decode-completion order (observable app
  // behavior), so derive the band's tile order from the rendered DOM instead
  // of assuming upload order.
  const sharpNames = await renderedTileNames(page, "sharp");
  assert(sharpNames.length === 3, `rendered sharp tiles: ${JSON.stringify(sharpNames)}`);
  const [firstSharp, middleSharp, lastSharp] = sharpNames;
  note(`sharp band order (decode completion): ${sharpNames.join(" → ")}`);
  const bufferByName = new Map([
    [FIX.sharpCheckerboard.name, FIX.sharpCheckerboard.buffer],
    [FIX.sharpText.name, FIX.sharpText.buffer],
    [EXTRA_SHARP.name, FIX.sharpText.buffer],
  ]);

  const panel = () => page.locator(".detail__panel");
  const openMeta = (name) => page.getByRole("button", { name: `View ${name}`, exact: true }).click();
  const gridTileBtn = (name) => page.getByRole("listitem").filter({ hasText: name }).getByRole("button", { name, exact: true });

  /* ---------------- desktop modal ---------------- */

  await openMeta(firstSharp);
  await expectDialog(page, `Reviewing ${firstSharp}`); // F3: role=dialog + aria-label on the panel
  assert((await panel().locator(".detail__filename").innerText()).trim() === firstSharp, "detail filename wrong");

  // Desktop chevrons visible; prev disabled at the band's first photo.
  const navPrev = panel().locator('button[aria-label="Previous photo"]').filter({ visible: true });
  const navNext = panel().locator('button[aria-label="Next photo"]').filter({ visible: true });
  assert((await navPrev.count()) === 1, `visible "Previous photo" chevrons: ${await navPrev.count()} (expected 1 on desktop)`);
  assert((await navNext.count()) === 1, `visible "Next photo" chevrons: ${await navNext.count()} (expected 1 on desktop)`);
  assert(
    await waitsTrue(() => navPrev.isDisabled(), 3000),
    await disabledDiagnostics(navPrev, "prev chevron not disabled at the band's first photo"),
  );
  assert(!(await navNext.isDisabled()), "next chevron disabled at the first of a 3-photo band");
  await shot(page, "06a-detail-desktop.png");

  // Navigate next → middle sharp photo; image swaps; both chevrons enabled.
  const srcBefore = await panel().locator(".detail__stage > .detail__img").getAttribute("src");
  await navNext.click();
  await waitForDetailName(page, middleSharp);
  const srcAfter = await panel().locator(".detail__stage > .detail__img").getAttribute("src");
  assert(srcBefore !== srcAfter, "detail image src did not change on navigation");
  assert(!(await navPrev.isDisabled()), "prev chevron disabled at the middle photo");
  assert(!(await navNext.isDisabled()), "next chevron disabled at the middle photo");
  const chipText = (await panel().locator(".detail__chip").innerText()).replace(/\s+/g, " ").trim();
  assert(/·\s*Sharp$/.test(chipText), `detail chip "${chipText}" does not read "· Sharp"`);
  await shot(page, "06b-detail-nav-middle.png");

  // F5: Select toggle = label-change pattern, no aria-pressed, check glyph on.
  const detailSelect = panel().getByRole("button", { name: /^Select(ed)?$/ });
  assert((await detailSelect.innerText()).trim() === "Select", "detail Select initial label wrong");
  assert(
    (await detailSelect.getAttribute("aria-pressed")) === null,
    "detail Select exposes aria-pressed — F5 requires the label-change pattern without aria-pressed",
  );
  assert(!(await panel().locator(".detail__select-check").isVisible()), "select check glyph visible in the off state");
  await detailSelect.click();
  assert((await detailSelect.innerText()).trim() === "Selected", "detail Select label did not become 'Selected'");
  assert(await panel().locator(".detail__select-check").isVisible(), "select check glyph not visible in the on state (F5)");
  assert((await detailSelect.getAttribute("aria-pressed")) === null, "aria-pressed appeared on the detail Select toggle");
  assert(
    (await gridTileBtn(middleSharp).getAttribute("aria-pressed")) === "true",
    "detail Select did not select the grid tile",
  );
  await detailSelect.click();
  assert((await detailSelect.innerText()).trim() === "Select", "detail Select label did not return to 'Select'");
  assert(!(await panel().locator(".detail__select-check").isVisible()), "check glyph still visible after toggling off");
  assert(
    (await gridTileBtn(middleSharp).getAttribute("aria-pressed")) === "false",
    "detail Select off did not deselect the grid tile",
  );

  // Escape closes from a focused-in-panel state; focus returns to the originating tile.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".detail__panel"), null, { timeout: STEP_TIMEOUT, polling: 50 });
  let active = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute("aria-label")) || null);
  assert(active === `View ${firstSharp}`, `focus after Escape is on "${active}", expected the originating tile button`);

  // Reopen via keyboard (Enter on the tile button).
  await page.getByRole("button", { name: `View ${firstSharp}`, exact: true }).press("Enter");
  await expectDialog(page, `Reviewing ${firstSharp}`);

  // Navigate to the band's last photo: next disables at the end.
  await navNext.click();
  await waitForDetailName(page, middleSharp);
  await navNext.click();
  await waitForDetailName(page, lastSharp);
  assert(await navNext.isDisabled(), "next chevron not disabled at the band's last photo");
  assert(!(await navPrev.isDisabled()), "prev chevron disabled at the band's last photo");

  // Per-item download of the current (last) photo, then Done close.
  const perItemDownloads = [];
  page.on("download", (d) => perItemDownloads.push(d));
  const dlPromise = page.waitForEvent("download", { timeout: STEP_TIMEOUT });
  await panel().getByRole("button", { name: /^(Download this photo|Preparing)/ }).click();
  // v0.3.0: the export chooser opens — pick Original (byte-identical).
  await page.waitForSelector(".confirm__panel", { timeout: STEP_TIMEOUT });
  await page.getByRole("button", { name: /^Original/ }).click();
  await page.waitForFunction(
    () => {
      const btn = document.querySelector(".detail__download");
      return !!btn && btn.disabled && btn.textContent.includes("Preparing");
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 20 },
  );
  const dl = await dlPromise;
  assert(
    dl.suggestedFilename() === lastSharp,
    `per-item download filename "${dl.suggestedFilename()}", expected "${lastSharp}"`,
  );
  const dlSaved = fs.readFileSync(await dl.path());
  assert(
    dlSaved.equals(bufferByName.get(dl.suggestedFilename())),
    `per-item download content of "${dl.suggestedFilename()}" differs from the original file`,
  );
  await page.waitForFunction(
    () => {
      const btn = document.querySelector(".detail__download");
      return !!btn && !btn.disabled && btn.textContent.includes("Download this photo");
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 50 },
  );
  assert(perItemDownloads.length === 1, `per-item click produced ${perItemDownloads.length} download events, expected 1`);
  await shot(page, "06c-detail-per-item-download.png");

  // Probe (reported, not gated): focus containment after a control self-disables.
  const activeAfterBusy = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 24) || el.tagName;
  });
  await page.keyboard.press("Escape");
  await sleep(300);
  const closedByEscapeAfterBusy = await page.evaluate(() => !document.querySelector(".detail__panel"));
  if (!closedByEscapeAfterBusy) {
    note(
      `FOCUS-CONTAINMENT EDGE (reported non-blocking, Phase 6 a11y candidate): after the per-item download button self-disabled, ` +
        `document.activeElement="${activeAfterBusy}" (Chrome blurs disabled focused buttons); Escape then does nothing ` +
        `(panel-scoped keydown never hears it) and Tab would leave the aria-modal overlay.`,
    );
    await shot(page, "06d-focus-edge-escape-lost.png");
  } else {
    note(`focus-containment probe: activeElement "${activeAfterBusy}", Escape still closed the sheet`);
  }

  // Done click closes (works regardless of focus); focus returns to the tile.
  if (!closedByEscapeAfterBusy) {
    await panel().getByRole("button", { name: "Done", exact: true }).click();
  }
  await page.waitForFunction(() => !document.querySelector(".detail__panel"), null, { timeout: STEP_TIMEOUT, polling: 50 });
  active = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute("aria-label")) || null);
  assert(active === `View ${firstSharp}`, `focus after Done close is on "${active}", expected the originating tile button`);

  /* ---------------- mobile sheet (§9d + F4) ---------------- */

  await page.setViewportSize(MOBILE_VIEWPORT);
  await sleep(250);
  await openMeta(firstSharp);
  await expectDialog(page, `Reviewing ${firstSharp}`);
  const navDisplays = await page.locator(".detail__nav").evaluateAll((els) => els.map((el) => getComputedStyle(el).display));
  assert(navDisplays.every((d) => d === "none"), `mobile flanking chevrons display: ${JSON.stringify(navDisplays)}`);
  assert(
    await panel().getByText("swipe", { exact: true }).isVisible(),
    'mobile "‹ swipe ›" hint text not visible (F4)',
  );
  const hintPrev = panel().locator('button[aria-label="Previous photo"]').filter({ visible: true });
  const hintNext = panel().locator('button[aria-label="Next photo"]').filter({ visible: true });
  assert((await hintPrev.count()) === 1, `mobile visible "Previous photo" buttons: ${await hintPrev.count()} (expected 1)`);
  assert((await hintNext.count()) === 1, `mobile visible "Next photo" buttons: ${await hintNext.count()} (expected 1)`);
  assert(await hintPrev.isDisabled(), "hint prev not disabled at the band's first photo");
  await shot(page, "06e-detail-mobile-hint.png");

  // Mobile: Escape closes from the canonical focus state (panel focused on open).
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".detail__panel"), null, { timeout: STEP_TIMEOUT, polling: 50 });
  let mobileActive = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute("aria-label")) || null);
  assert(mobileActive === `View ${firstSharp}`, `mobile focus after Escape is on "${mobileActive}", expected the originating tile`);

  // Reopen and prove the hint chevrons are keyboard-reachable. At the first
  // photo only "Next photo" is tabbable (prev is legitimately disabled);
  // Enter navigates to the middle photo, where BOTH become tabbable.
  await openMeta(firstSharp);
  await expectDialog(page, `Reviewing ${firstSharp}`);
  const focusTrail = [];
  let reachedNext = false;
  for (let i = 0; i < 12 && !reachedNext; i += 1) {
    await page.keyboard.press("Tab");
    const desc = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 20) || el.tagName;
    });
    focusTrail.push(desc);
    if (desc === "Next photo") reachedNext = true;
  }
  assert(reachedNext, `keyboard Tab never reached the hint next chevron (trail: ${JSON.stringify(focusTrail)})`);
  await page.keyboard.press("Enter");
  await waitForDetailName(page, middleSharp);

  // Middle photo: both hint chevrons enabled; Tab reaches the prev one too.
  assert(!(await hintPrev.isDisabled()), "hint prev still disabled at the middle photo");
  assert(!(await hintNext.isDisabled()), "hint next disabled at the middle photo");
  const focusTrail2 = [];
  let reachedPrev = false;
  for (let i = 0; i < 12 && !reachedPrev; i += 1) {
    await page.keyboard.press("Tab");
    const desc = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 20) || el.tagName;
    });
    focusTrail2.push(desc);
    if (desc === "Previous photo") reachedPrev = true;
  }
  assert(
    reachedPrev,
    `keyboard Tab never reached the hint prev chevron at the middle photo (trail: ${JSON.stringify(focusTrail2)})`,
  );

  // Enter on the focused prev chevron navigates back; the first photo disables it again.
  await page.keyboard.press("Enter");
  await waitForDetailName(page, firstSharp);
  assert(await hintPrev.isDisabled(), "hint prev not re-disabled after navigating back to the first photo");
  await shot(page, "06f-detail-mobile-nav-back.png");

  // Mobile: Done closes; focus returns to the originating tile.
  await panel().getByRole("button", { name: "Done", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".detail__panel"), null, { timeout: STEP_TIMEOUT, polling: 50 });
  mobileActive = await page.evaluate(() => (document.activeElement && document.activeElement.getAttribute("aria-label")) || null);
  assert(mobileActive === `View ${firstSharp}`, `mobile focus after Done is on "${mobileActive}", expected the originating tile`);

  return `dialog aria-label on panel (F3); desktop chevrons: prev disabled at first, next disabled at last, image swaps on nav; Select↔Selected + check glyph, no aria-pressed (F5) on the middle photo; per-item download "${dl.suggestedFilename()}" byte-identical; mobile hint "swipe": both chevrons keyboard-reachable (trails ${JSON.stringify(focusTrail)} / ${JSON.stringify(focusTrail2)}) + Enter navigation both ways; Escape/Done close → focus returns to tile`;
}

/* ------------------------------------------------------------------ */
/* P7 — Add more after results (beginBatch detached-DOM fix)           */
/* ------------------------------------------------------------------ */

async function stateP7({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await chooseFiles(page, "Choose photos", [asInput(FIX.sharpText), asInput(FIX.blurredText)]);
  await waitForResolved(page, 2);
  await waitForResults(page);

  const before = await debugState(page);
  const scoreBefore = new Map(before.photos.map((p) => [p.name, p.score]));
  assert(
    parseCountText(await band(page, "blurry").locator(".band__count").innerText()) === 1 &&
      parseCountText(await band(page, "sharp").locator(".band__count").innerText()) === 1,
    "initial band counts are not 1 blurry + 1 sharp",
  );

  // The regression scenario: "Add more" from the results screen. Without the
  // beginBatch rebuild, the pending grid would be appended to a disconnected
  // shell and nothing would be visible.
  const sixMore = [
    asInput(FIX.sharpCheckerboard),
    asInput(FIX.blurredCheckerboard),
    asInput(FIX.sharpText, "extra-sharp-1.png"),
    asInput(FIX.sharpText, "extra-sharp-2.png"),
    asInput(FIX.blurredText, "extra-blur-1.png"),
    asInput(FIX.blurredText, "extra-blur-2.png"),
  ];
  await chooseFiles(page, "Add more", sixMore);

  // The pending grid must be VISIBLE: toolbar count 8 photos + 8 visible tiles,
  // with the already-scored tiles showing their preserved scores.
  await page.waitForFunction(
    () => {
      const count = document.querySelector(".gallery-toolbar__count");
      const tiles = Array.from(document.querySelectorAll("li.tile")).filter((el) => el.getClientRects().length > 0);
      return !!count && count.textContent === "8 photos" && tiles.length === 8;
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 20 },
  );
  // Preserved scores for the two pre-existing tiles (visible right away).
  // R4 re-scope (2026-11-06, design-spec-v2 §11.2): the preserved score renders
  // through the shared identity-mapped "NN% sharp" chip text.
  for (const name of [FIX.sharpText.name, FIX.blurredText.name]) {
    const tile = page.getByRole("listitem").filter({ visible: true, hasText: name }).first();
    const chip = (await tile.locator(".chip__num").innerText()).trim();
    assert(chip === `${scoreBefore.get(name)}% sharp`, `pending tile "${name}" chip "${chip}", expected preserved score "${scoreBefore.get(name)}% sharp" (R4 §11.2)`);
  }
  const pendingShot = "07a-addmore-pending-visible.png";
  await shot(page, pendingShot);

  // Re-analysis runs; results re-render with updated counts.
  await waitForResolved(page, 8);
  await waitForResults(page);
  const state = await debugState(page);
  assert(state.photos.length === 8, `store holds ${state.photos.length} photos after add-more, expected 8`);
  const ids = await bandIds(page);
  const stats = [];
  for (const id of ["blurry", "review", "sharp"]) {
    const n = parseCountText(await band(page, id).locator(".band__count").innerText());
    const tiles = await band(page, id).getByRole("listitem").count();
    assert(n === tiles, `band ${id} count ${n} != ${tiles} tiles after re-analysis`);
    stats.push(`${id}=${n}`);
  }
  // Fixture calibration: 4 blurry + 0 review + 4 sharp.
  assert(
    parseCountText(await band(page, "blurry").locator(".band__count").innerText()) === 4 &&
      parseCountText(await band(page, "review").locator(".band__count").innerText()) === 0 &&
      parseCountText(await band(page, "sharp").locator(".band__count").innerText()) === 4,
    `updated counts ${stats.join(", ")}, expected blurry=4, review=0, sharp=4`,
  );
  // Every rendered tile is a real store photo, exactly once; old scores unchanged.
  const rendered = [];
  for (const id of ["blurry", "review", "sharp"]) rendered.push(...(await renderedTileNames(page, id)));
  const storeNames = state.photos.map((p) => p.name);
  assert(rendered.length === 8 && new Set(rendered).size === 8, `rendered tile names ${JSON.stringify(rendered)}`);
  assert(
    rendered.every((n) => storeNames.includes(n)) && storeNames.every((n) => rendered.includes(n)),
    `rendered tiles do not match the store (rendered ${JSON.stringify(rendered)} vs store ${JSON.stringify(storeNames)})`,
  );
  for (const p of state.photos) {
    if (scoreBefore.has(p.name) && p.name !== "extra-sharp-1.png") {
      // (extra-sharp-1/2 share the sharpText name pattern only via nameOverride — not in scoreBefore)
      assert(p.score === scoreBefore.get(p.name), `score of "${p.name}" changed across re-analysis: ${p.score} vs ${scoreBefore.get(p.name)}`);
    }
    assert(["blurry", "review", "sharp"].includes(p.band), `"${p.name}" not scored after re-analysis (${p.band})`);
  }
  assert(
    (await page.getByText("0 selected · 8 total", { exact: true }).count()) === 1,
    "action-bar summary '0 selected · 8 total' missing after re-analysis",
  );
  await shot(page, "07b-addmore-results-updated.png");

  return `pending grid rebuilt and VISIBLE (toolbar "8 photos", 8 tiles, old scores preserved); re-analysis scored all 6 new photos; counts ${stats.join(", ")} (== tiles); 8 unique tiles ↔ 8 store photos; no detached-DOM symptom`;
}

/* ------------------------------------------------------------------ */
/* P8 — mixed batch with invalid files + skipped section               */
/* ------------------------------------------------------------------ */

async function stateP8({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  /* Scenario A: undecodable file in a mixed batch. */
  await chooseFiles(page, "Choose photos", [asInput(FIX.sharpText), asInput(FIX.notAnImage), asInput(FIX.blurredText)]);
  await waitForResolved(page, 2);
  await waitForResults(page);
  await expectHeading(page, "1 file couldn't be opened", "undecodable notice heading");
  await page.getByText("See the 1 file", { exact: true }).click({ timeout: STEP_TIMEOUT });
  await expectExactText(page, FIX.notAnImage.name, "skipped filename in the notice");

  const stateA = await debugState(page);
  assert(stateA.photos.length === 2, `store holds ${stateA.photos.length} photos, expected the 2 valid ones`);
  assert(
    stateA.skippedFiles.length === 1 && stateA.skippedFiles[0] === FIX.notAnImage.name,
    `skipped ledger wrong: ${JSON.stringify(stateA.skippedFiles)}`,
  );
  const idsA = await bandIds(page);
  assert(!idsA.includes("skipped"), "skipped section rendered for an undecodable file (it never enters the store)");
  let sumA = 0;
  for (const id of ["blurry", "review", "sharp"]) {
    const n = parseCountText(await band(page, id).locator(".band__count").innerText());
    const tiles = await band(page, id).getByRole("listitem").count();
    assert(n === tiles, `band ${id} count ${n} != ${tiles} tiles`);
    sumA += n;
    for (const name of await renderedTileNames(page, id)) {
      const photo = stateA.photos.find((p) => p.name === name);
      assert(photo && typeof photo.score === "number", `tile "${name}" not analyzed`);
    }
  }
  assert(sumA === 2, `band counts sum ${sumA}, expected 2 (skipped file excluded)`);
  assert(
    (await page.getByText("0 selected · 2 total", { exact: true }).count()) === 1,
    "summary total does not exclude the undecodable file",
  );
  await shot(page, "08a-mixed-invalid-notice.png");

  /* Scenario B: transparent PNG → analysis skip + trailing Skipped section. */
  const transparentB64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < buf.length; i += 8192) {
      binary += String.fromCharCode.apply(null, buf.slice(i, i + 8192));
    }
    return btoa(binary);
  });
  const transparent = { name: "transparent-photo.png", mimeType: "image/png", buffer: Buffer.from(transparentB64, "base64") };
  await chooseFiles(page, "Add more", [transparent, asInput(FIX.sharpCheckerboard)]);
  await waitForResolved(page, 4);
  await waitForResults(page);
  await expectHeading(page, "1 photo couldn't be analyzed", "analysis-skip notice heading");

  const stateB = await debugState(page);
  const skippedPhoto = stateB.photos.find((p) => p.name === transparent.name);
  assert(skippedPhoto, "transparent photo missing from the store");
  assert(
    skippedPhoto.band === "skipped" && skippedPhoto.score === null,
    `transparent photo state ${JSON.stringify({ band: skippedPhoto.band, score: skippedPhoto.score })}`,
  );
  const idsB = await bandIds(page);
  assert(
    idsB.length === 4 && idsB[3] === "skipped",
    `skipped section must render last only when present; band ids ${JSON.stringify(idsB)}`,
  );
  const skippedSection = band(page, "skipped");
  const skippedTiles = await skippedSection.getByRole("listitem").count();
  assert(skippedTiles === 1, `skipped section shows ${skippedTiles} tiles, expected 1`);
  const skippedChip = (await skippedSection.getByRole("listitem").first().locator(".chip__num").innerText()).trim();
  assert(skippedChip === "—", `skipped tile chip "${skippedChip}", expected "—" (never a fake score)`);

  let sumB = 0;
  for (const id of ["blurry", "review", "sharp"]) {
    const n = parseCountText(await band(page, id).locator(".band__count").innerText());
    const tiles = await band(page, id).getByRole("listitem").count();
    assert(n === tiles, `band ${id} count ${n} != ${tiles} tiles`);
    const names = await renderedTileNames(page, id);
    assert(!names.includes(transparent.name), `skipped photo appears inside band ${id}`);
    sumB += n;
  }
  const scoredCount = stateB.photos.filter((p) => ["blurry", "review", "sharp"].includes(p.band)).length;
  assert(sumB === scoredCount && sumB === 3, `band counts sum ${sumB}, expected ${scoredCount} scorable photos`);
  assert(
    (await page.getByText("0 selected · 4 total", { exact: true }).count()) === 1,
    "summary total missing after the analysis skip batch",
  );
  await shot(page, "08b-analysis-skip-section.png");

  return `undecodable: notice "1 file couldn't be opened" + name listed; 2 tiles analyzed; counts sum 2; no skipped section. transparent: notice "1 photo couldn't be analyzed"; trailing Skipped section 1 tile chip "—"; band counts sum 3 == scorable; skipped excluded from all three bands`;
}

/* ------------------------------------------------------------------ */
/* P9 — contrast regression (computed)                                 */
/* ------------------------------------------------------------------ */

async function stateP9({ page, context }) {
  await context.addInitScript(INSTALL_SAMPLE);
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await chooseFiles(page, "Choose photos", ALL_FOUR.map((f) => asInput(f)));
  await waitForResolved(page, 4);
  await waitForResults(page);

  const evidence = [];

  // F1: band chips — text token vs its tint composite (ancestor-walk computed).
  for (const id of ["blurry", "review", "sharp"]) {
    const heading = band(page, id).getByRole("heading", { name: BAND_LABELS[id], exact: true });
    const sample = await heading.evaluate((el) => window.__p4sample(el));
    assert(sample.fgRaw === BAND_TOKENS[id].css, `band chip ${id} color ${sample.fgRaw}, expected ${BAND_TOKENS[id].css}`);
    const ratio = contrastRatio(toRGB(sample.fg), sample.bg);
    assert(
      ratio >= 4.5,
      `band chip ${id}: ${ratio.toFixed(2)}:1 on composite rgb(${sample.bg.map(Math.round)}) < 4.5:1`,
    );
    evidence.push(`chip ${id} ${ratio.toFixed(2)}:1`);
  }

  // F2: every score chip — token vs #141517 (delegated target) and vs composite.
  const state = await debugState(page);
  const byName = new Map(state.photos.map((p) => [p.name, p]));
  let checked = 0;
  for (const id of ["blurry", "review", "sharp"]) {
    const tiles = band(page, id).getByRole("listitem");
    const count = await tiles.count();
    for (let i = 0; i < count; i += 1) {
      const num = tiles.nth(i).locator(".chip__num");
      const name = (await tiles.nth(i).locator(".tile__filename").innerText()).trim();
      const photo = byName.get(name);
      const sample = await num.evaluate((el) => window.__p4sample(el));
      assert(sample.fgRaw === BAND_TOKENS[photo.band].css, `chip ${name} color ${sample.fgRaw}`);
      const onGrouped = contrastRatio(toRGB(sample.fg), GROUPED_BG);
      const onComposite = contrastRatio(toRGB(sample.fg), sample.bg);
      assert(onGrouped >= 4.5, `score chip ${name}: ${onGrouped.toFixed(2)}:1 on #141517 < 4.5:1`);
      assert(onComposite >= 4.5, `score chip ${name}: ${onComposite.toFixed(2)}:1 on composite rgb(${sample.bg.map(Math.round)}) < 4.5:1`);
      evidence.push(`${name} ${onGrouped.toFixed(2)}:1/#141517`);
      checked += 1;
    }
  }
  assert(checked === 4, `checked ${checked} score chips, expected 4`);

  await shot(page, "09-contrast-tokens.png");
  return `computed: ${evidence.join("; ")} — all ≥ 4.5:1 (tokens ${Object.values(BAND_TOKENS).map((t) => t.hex).join(", ")})`;
}

/* ------------------------------------------------------------------ */
/* P11 — Phase 2/3 core regression quick pass                          */
/* ------------------------------------------------------------------ */

async function stateP11({ page, context }) {
  await context.addInitScript(REVOKE_SPY);
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  /* (a) empty state */
  await expectHeading(page, "Find the blurry photos", "empty-state heading");
  await expectButton(page, "Choose photos", "empty-state CTA");
  await expectExactText(page, "Photos never leave this device.", "privacy line");
  assert((await page.getByRole("button", { name: "Start over" }).count()) === 0, '"Start over" visible in the empty state');
  await shot(page, "11a-regression-empty.png");

  /* (b) one photo via the real picker path */
  await chooseFiles(page, "Choose photos", [asInput(FIX.sharpText)]);
  await waitForResolved(page, 1);
  await waitForResults(page);
  await expectExactText(page, FIX.sharpText.name, "tile filename");
  /* R4 re-scope (2026-11-06): design-spec-v2 §11.2 layout consequence — the
     tile's file-size caption yields its slot to the wider "NN% sharp" chip and
     moves to the detail view (§11.5, Phase R6). The old "N KB/MB" tile
     assertion is dropped with that citation; the tile is asserted on its NEW
     text instead: the R4 percentage chip, identity-mapped from the store
     score (96 → "96% sharp"). */
  const single = await tileText(page, FIX.sharpText.name);
  assert(/96% sharp/.test(single), `single tile missing the R4 chip text "96% sharp" (tile text: ${JSON.stringify(single)})`);
  assert(
    (await page.getByText("0 selected · 1 total", { exact: true }).count()) === 1,
    "single-photo total missing from the action-bar summary",
  );
  await expectButton(page, "Start over", "Start over after selection");
  await shot(page, "11b-regression-single-photo.png");

  /* (c) invalid file → visible notice, counts unchanged */
  await chooseFiles(page, "Add more", [asInput(FIX.notAnImage)]);
  await expectHeading(page, "1 file couldn't be opened", "undecodable notice heading");
  await page.getByText("See the 1 file", { exact: true }).click({ timeout: STEP_TIMEOUT });
  await expectExactText(page, FIX.notAnImage.name, "skipped filename listed");
  assert(
    (await page.getByText("0 selected · 1 total", { exact: true }).count()) === 1,
    "total changed after the skipped file",
  );
  await shot(page, "11c-regression-invalid-notice.png");

  /* (d) add a second photo, then start over revokes every thumbnail URL */
  await chooseFiles(page, "Add more", [asInput(FIX.blurredText)]);
  await waitForResolved(page, 2);
  await waitForResults(page);
  const srcs = await page.$$eval(".photo-grid img", (imgs) => imgs.map((img) => img.src));
  assert(srcs.length === 2 && srcs.every((s) => s.startsWith("blob:")), `unexpected thumbnail srcs: ${JSON.stringify(srcs)}`);
  await page.getByRole("button", { name: "Start over" }).click();
  const stateDialogs = dialogs.filter((d) => d.tag === currentTag);
  assert(
    stateDialogs.some((d) => d.type === "confirm" && /Start over\?/.test(d.message)),
    `native confirm not observed: ${JSON.stringify(stateDialogs)}`,
  );
  await expectHeading(page, "Find the blurry photos", "empty state after Start over");
  await page.waitForFunction(() => document.querySelectorAll(".photo-grid img").length === 0, null, {
    timeout: STEP_TIMEOUT,
    polling: 100,
  });
  const revoked = await page.evaluate(() => window.__revokeLog.slice());
  const missing = srcs.filter((s) => !revoked.includes(s));
  assert(missing.length === 0, `${missing.length}/${srcs.length} thumbnail object URLs never revoked. Example: ${missing[0]}`);
  await shot(page, "11d-regression-after-start-over.png");

  /* (e) fixture scoring determinism (Phase 3 surface) */
  await chooseFiles(page, "Choose photos", ALL_FOUR.map((f) => asInput(f)));
  await waitForResolved(page, 4);
  const firstRun = (await debugState(page)).photos.map((p) => ({ name: p.name, score: p.score, band: p.band }));
  await chooseFiles(page, "Add more", ALL_FOUR.map((f) => asInput(f)));
  await waitForResolved(page, 8);
  const secondRun = (await debugState(page)).photos.map((p) => ({ name: p.name, score: p.score, band: p.band }));
  assert(secondRun.length === 8, `after re-select the store holds ${secondRun.length} photos, expected 8`);
  const deterministic = [];
  for (const fix of ALL_FOUR) {
    const runs = secondRun.filter((p) => p.name === fix.name);
    assert(runs.length === 2, `"${fix.name}" appears ${runs.length}× after re-select, expected 2`);
    assert(
      runs[0].score === runs[1].score && runs[0].band === runs[1].band,
      `"${fix.name}" unstable in-session: ${JSON.stringify(runs)}`,
    );
    const original = firstRun.find((p) => p.name === fix.name);
    assert(
      runs[0].score === original.score && runs[0].band === original.band,
      `"${fix.name}" differs from the first run: first ${JSON.stringify(original)}, reselect ${JSON.stringify(runs[0])}`,
    );
    deterministic.push(`${fix.name}=${runs[0].score}/${runs[0].band}×2`);
  }
  const byName = (name) => secondRun.find((p) => p.name === name);
  assert(byName(FIX.sharpCheckerboard.name).band === "sharp" && byName(FIX.sharpCheckerboard.name).score >= 60, "sharp checkerboard fixture regressed");
  assert(byName(FIX.sharpText.name).band === "sharp" && byName(FIX.sharpText.name).score >= 60, "sharp text fixture regressed");
  assert(byName(FIX.blurredCheckerboard.name).band === "blurry" && byName(FIX.blurredCheckerboard.name).score <= 40, "blurred checkerboard fixture regressed");
  assert(byName(FIX.blurredText.name).band === "blurry" && byName(FIX.blurredText.name).score <= 40, "blurred text fixture regressed");
  await shot(page, "11e-regression-determinism.png");

  return `empty clean; 1 photo chip "96% sharp" (R4 §11.2) + "0 selected · 1 total"; invalid notice leaves total unchanged; start-over (confirm accepted) cleared and revoked ${srcs.length}/${srcs.length} object URLs; 4 fixtures × 2 runs byte-identical (${deterministic.join(", ")})`;
}

/* ------------------------------------------------------------------ */
/* P10 — hygiene across every state + 375px overflow (runs last)       */
/* ------------------------------------------------------------------ */

async function stateP10({ page }) {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  const checkOverflow = async (label) => {
    const over = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    assert(over <= 1, `${label}: horizontal overflow ${over}px at 375px`);
    return `${label} ${over}px`;
  };
  const overflowEvidence = [];

  // empty
  await expectHeading(page, "Find the blurry photos", "mobile empty heading");
  overflowEvidence.push(await checkOverflow("empty"));
  await shot(page, "10a-empty-mobile.png");

  // analyzing (12× 1600×1200 — the same size as P1, whose card window was
  // solidly observable; the batch must hold the §9b card long enough to
  // measure the analyzing layout)
  const midB64 = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1200;
    const ctx = c.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, 1600, 1200);
    grad.addColorStop(0, "#8f6b3a");
    grad.addColorStop(1, "#f3eee8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1600, 1200);
    let seed = 987654321;
    const rnd = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 400; i += 1) {
      ctx.fillStyle = `rgba(${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)},${Math.floor(rnd() * 255)},0.8)`;
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
  const midBuffer = Buffer.from(midB64, "base64");
  note(`generated mobile analyzing photo: ${(midBuffer.length / 1024).toFixed(0)} KB × 12`);
  const mobileBatch = Array.from({ length: 12 }, (_, i) => ({
    name: `mobile-photo-${i + 1}.png`,
    mimeType: "image/png",
    buffer: midBuffer,
  }));
  await chooseFiles(page, "Choose photos", mobileBatch);
  await page
    .waitForFunction(() => {
      const card = document.querySelector(".progress-card");
      return !!card && card.getClientRects().length > 0;
    }, null, { timeout: STEP_TIMEOUT, polling: 10 })
    .catch(() => {
      throw new Error("mobile analyzing card never became visible within the 12-photo batch");
    });
  overflowEvidence.push(await checkOverflow("analyzing"));
  await shot(page, "10b-analyzing-mobile.png");

  // results
  await waitForResolved(page, 12);
  await waitForResults(page, ANALYSIS_TIMEOUT);
  overflowEvidence.push(await checkOverflow("results"));
  await shot(page, "10c-results-mobile.png");

  // detail sheet
  const firstTile = page.getByRole("listitem").filter({ visible: true }).first();
  await firstTile.getByRole("button", { name: /^View / }).click();
  await page.locator(".detail__panel").waitFor({ state: "visible", timeout: STEP_TIMEOUT });
  overflowEvidence.push(await checkOverflow("detail-sheet"));
  await shot(page, "10d-detail-mobile.png");
  await page.keyboard.press("Escape");

  /* hygiene aggregate over every state run before this one (plus this one) */
  const unexpected = hygiene.filter(
    (h) =>
      h.kind === "console.error" ||
      h.kind === "console.warning" ||
      h.kind === "pageerror" ||
      h.kind === "requestfailed" ||
      /^http\.(4|5)/.test(h.kind),
  );
  if (unexpected.length > 0) {
    const summary = unexpected.map((h) => `[${h.tag}] ${h.kind}: ${h.text}`).join(" | ");
    throw new Error(`${unexpected.length} hygiene violation(s): ${summary}`);
  }
  const badStatus = netLog.filter((r) => r.status >= 400);
  assert(badStatus.length === 0, `HTTP >= 400: ${JSON.stringify(badStatus)}`);
  const foreign = netLog.filter((r) => appUrl && !r.url.startsWith(appUrl) && !r.url.startsWith("blob:"));
  assert(foreign.length === 0, `non same-origin request(s): ${JSON.stringify(foreign.slice(0, 5))}`);
  const origin = appUrl ? new URL(appUrl).origin : "";

  return `hygiene: 0 console errors/warnings, 0 pageerrors, 0 failed requests, 0 HTTP>=400 across all states (${netLog.length} same-origin responses logged, origin ${origin}; client-only app — no backend API); 375px overflow: ${overflowEvidence.join(", ")}`;
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

  try {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

    const { server: srv, port } = await startServer(APP_ROOT, BASE_PORT);
    server = srv;
    appUrl = `http://127.0.0.1:${port}/`;
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

    console.log(`\n--- P1: analyzing progress card + band reveal ---`);
    await runState("P1", "Analyzing (§9b): progress card 'N of 24' + bar + pending grid; results with band reveal", stateP1);

    console.log(`\n--- P2: grouped results structure ---`);
    await runState("P2", "Grouped results: band order, counts==tiles==store, empty-band message, no skipped section", stateP2);

    console.log(`\n--- P3: score chips + token colors ---`);
    await runState("P3", "Score chips (F1/F2; R4 §11.2): \"NN% sharp\" == store score and computed color == band token on every scored tile", stateP3);

    console.log(`\n--- P4: selection model ---`);
    await runState("P4", "Selection: toggle ring/check/aria-pressed, band select-all, summary sync, survives detail + re-render", stateP4);

    console.log(`\n--- P5: download selected ---`);
    await runState("P5", "Download selected: 0-selected blocked; 2 selected → 2 byte-identical downloads + busy/announcements", stateP5);

    console.log(`\n--- P6: detail view ---`);
    await runState("P6", "Detail (§9d/F3/F4/F5): dialog label, band nav ends-disabled, Select label pattern, per-item DL, mobile hint keyboard", stateP6);

    console.log(`\n--- P7: add more after results (beginBatch fix) ---`);
    await runState("P7", "Add more: pending grid visible (detached-DOM fix), re-analysis, band counts update, old scores persist", stateP7);

    console.log(`\n--- P8: mixed invalid + skipped section ---`);
    await runState("P8", "Mixed batch: invalid in notice, counts exclude skipped; transparent → Skipped section only when present", stateP8);

    console.log(`\n--- P9: contrast regression ---`);
    await runState("P9", "Contrast (computed): band chips ≥4.5:1 on tint composite; score chips ≥4.5:1 on #141517", stateP9);

    console.log(`\n--- P11: Phase 2/3 core regression quick pass ---`);
    await runState("P11", "Phase 2/3 quick pass: empty, 1 photo, invalid notice, start-over + revocation, determinism", stateP11);

    console.log(`\n--- P10: hygiene + 375px overflow (runs last to aggregate every state) ---`);
    await runState("P10", "Hygiene: zero console errors/warnings/pageerrors/failed requests; same-origin only; 375px no overflow", stateP10);
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

  console.log("\n=== PHASE 4 E2E TESTER SUMMARY (independent run) ===");
  for (const r of results) {
    console.log(`${r.status.padEnd(5)} ${r.id.padEnd(4)} ${r.name}${r.flaky ? "  [FLAKY: passed on retry]" : ""}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
  console.log(`\nScreenshots (${shots.length}):`);
  for (const s of shots) console.log(`  e2e/artifacts/phase4-e2e-tester/${s.file}`);
  console.log(`\nNetwork responses logged: ${netLog.length} (all same-origin static assets; no backend API by design)`);
  console.log(`Dialogs handled: ${dialogs.length}`);

  const failed = results.filter((r) => r.status === "FAIL");
  const flaky = results.filter((r) => r.flaky);
  const verdict = failed.length === 0 && !fatal ? "PASS" : "FAIL";
  console.log(
    `\nVerdict: ${verdict} — ${results.length - failed.length}/${results.length} states passed` +
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
