/**
 * v2-r4-e2e-tester.js — INDEPENDENT Phase R4 e2e proof ("NN% sharp" display).
 *
 * Written by the E2E/Integration Testing Agent as an independent verification
 * of the delegated Phase R4 state matrix (plans/blurry-photo-cleaner-v2-restyle.md
 * "Phase R4" + Ruling D1, designs/design-spec-v2.md §11.2). It does NOT import
 * or re-run any implementer/probe suite; it drives the live served app with its
 * own assertions and its own artifacts (a fresh browser context per state).
 *
 * Run:  node e2e/v2-r4-e2e-tester.js
 *
 * Tooling (binding directive): Playwright LIBRARY only — playwright-cli banned.
 * Chrome (channel "chrome") headless, in-process static server killed in
 * finally, per-step timeouts + whole-run watchdog, screenshots to
 * e2e/artifacts/v2-r4-e2e/ (record only — never read back), process ALWAYS
 * exits (0 = every state passed / 1 = any state failed, fatal, or watchdog).
 *
 * Delegated state matrix (fresh context per state; actual results reported):
 *   S1  4 fixtures → tiles read "100% sharp" / "96% sharp" / "34% sharp" /
 *       "36% sharp"; DOM chip text == store score for EVERY tile; band
 *       membership coherent (34/36 under Blurry, 100/96 under Sharp).
 *   S2  Detail chip "NN% sharp · <Band>" opened via KEYBOARD (focus+Enter) and
 *       via CLICK; Escape closes (focus returns to the tile); chip text exact.
 *   S3  Mixed batch + transparent PNG → skip notice; skipped chip "—"; the
 *       string "0% sharp" appears NOWHERE for the skipped photo; band counts
 *       exclude skipped; Skipped section chip "—".
 *   S3z Boundary: a GENUINE score of 0 (deterministic smooth-gradient PNG)
 *       renders "0% sharp" (tile + detail) — distinguishable from "—".
 *   S4  Pending state: chips are "—" before scores land, then fill to
 *       "NN% sharp" — transition asserted by 10ms polling + a MutationObserver
 *       timeline of the real DOM.
 *   S5  Band headers contain NO "%" anywhere (Ruling D1); empty band keeps
 *       "Needs review" + "0 photos" + "No photos in this band"; the subtitle
 *       "Percentages are based on detected sharpness." appears EXACTLY once,
 *       positioned before the first band.
 *   S6  Determinism: Start over → re-pick → chip texts byte-identical.
 *   S7  375px: no horizontal overflow, no chip clipping (scrollWidth <=
 *       clientWidth per tile + chip box inside the tile), detail sheet chip
 *       visible with the exact format.
 *   S8  Full journey unaffected: empty → pick → select 2 → Download selected
 *       (2 byte-identical files) → Start over (confirm + every thumbnail
 *       object URL revoked). Hygiene: zero console errors/warnings/pageerrors/
 *       failed requests across EVERY state in this run.
 *
 * Flakiness rule: no fixed sleeps for conditions — web-first waits/polling.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { chromium } = require("playwright");

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const APP_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(APP_ROOT, "e2e", "fixtures");
const ARTIFACTS_DIR = path.join(__dirname, "artifacts", "v2-r4-e2e");
const BASE_PORT = 9077;
const STEP_TIMEOUT = 15000;      // one user step / one UI state
const ANALYSIS_TIMEOUT = 60000;  // full batch resolution budget
const DOWNLOAD_TIMEOUT = 20000;  // 2 sequential anchor downloads
const WATCHDOG_MS = 600000;      // whole-run hard cap
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

/* v1-locked fixture scores (sharp 100/96, blurred 34/36). */
const FIXTURES = [
  { name: "fixture-sharp-checkerboard.png", score: 100, band: "sharp" },
  { name: "fixture-sharp-text.png", score: 96, band: "sharp" },
  { name: "fixture-blurred-checkerboard.png", score: 34, band: "blurry" },
  { name: "fixture-blurred-text.png", score: 36, band: "blurry" },
].map((f) => ({ ...f, mime: "image/png", buffer: fs.readFileSync(path.join(FIXTURES_DIR, f.name)) }));

const FOUR = FIXTURES.map((f) => ({ name: f.name, mimeType: f.mime, buffer: f.buffer }));
const SUBTITLE = "Percentages are based on detected sharpness.";
const SKIP_HEADING = "1 photo couldn't be analyzed";

/* ------------------------------------------------------------------ */
/* Run state                                                           */
/* ------------------------------------------------------------------ */

const states = [];     // { id, title, status, checks: [{name, ok, detail}], evidence, error }
const hygiene = [];    // { tag, kind, text }
const requests = [];   // { tag, url }
const dialogs = [];    // { tag, type, message }
let appUrl = null;
let server = null;
let browser = null;

/* ------------------------------------------------------------------ */
/* Static server (in-process, killed in finally)                       */
/* ------------------------------------------------------------------ */

function startServer(root, basePort) {
  return new Promise((resolve, reject) => {
    let port = basePort;
    const handler = (req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
        let filePath = path.normalize(path.join(root, urlPath));
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404); res.end(); return;
        }
        res.writeHead(200, {
          "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        fs.createReadStream(filePath).pipe(res);
      } catch {
        res.writeHead(500); res.end();
      }
    };
    const srv = http.createServer(handler);
    srv.once("error", (error) => {
      if (error.code === "EADDRINUSE" && port < basePort + 20) { port += 1; srv.listen(port, "127.0.0.1"); }
      else reject(error);
    });
    srv.listen(port, "127.0.0.1", () => resolve({ server: srv, port }));
  });
}

/* ------------------------------------------------------------------ */
/* Deterministic fixture generators (std lib only, same bytes per run) */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function pngHeader(width, height, colorType) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
  ]);
}

/** 480×480 RGBA, every pixel transparent → analyzer skips it (never scores 0). */
function transparentPng() {
  const width = 480;
  const height = 480;
  const row = Buffer.alloc(1 + width * 4);
  const raw = Buffer.alloc(height * row.length);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  return Buffer.concat([pngHeader(width, height, 6), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

/** 256×256 horizontal grey ramp → 3×3 Laplacian exactly 0 → score 0 ("blurry"). */
function smoothGradientPng() {
  const width = 256;
  const height = 256;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) { row[1 + x * 3] = x; row[2 + x * 3] = x; row[3 + x * 3] = x; }
  const raw = Buffer.alloc(height * row.length);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  return Buffer.concat([pngHeader(width, height, 2), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}

/* ------------------------------------------------------------------ */
/* Page helpers                                                        */
/* ------------------------------------------------------------------ */

function wire(page, tag) {
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") hygiene.push({ tag, kind: `console.${msg.type()}`, text: msg.text() });
  });
  page.on("pageerror", (error) => hygiene.push({ tag, kind: "pageerror", text: String(error.message || error) }));
  page.on("requestfailed", (req) => {
    hygiene.push({ tag, kind: "requestfailed", text: `${req.method()} ${req.url()} ${req.failure()?.errorText || ""}` });
  });
  page.on("request", (req) => requests.push({ tag, url: req.url() }));
  page.on("response", (res) => {
    if (res.status() >= 400) hygiene.push({ tag, kind: `http${res.status()}`, text: res.url() });
  });
  page.on("dialog", (dialog) => {
    dialogs.push({ tag, type: dialog.type(), message: dialog.message() });
    dialog.accept().catch(() => {});
  });
}

async function pickBatch(page, files) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: STEP_TIMEOUT }),
    page.getByRole("button", { name: "Choose photos", exact: true }).click(),
  ]);
  await chooser.setFiles(files);
}

const readStore = (page) => page.evaluate(() => {
  const state = window.__debugState();
  return {
    photos: state.photos.map((p) => ({ id: p.id, name: p.name, score: p.score, band: p.band })),
    skippedAnalysis: [...state.skippedAnalysis],
  };
});

/** Every tile's chip text keyed by tile data-id (pending grid or results). */
const readChips = (page) => page.evaluate(() => {
  const out = {};
  for (const tile of document.querySelectorAll(".tile[data-id]")) {
    const num = tile.querySelector(".chip__num");
    if (num) out[tile.dataset.id] = num.textContent.trim();
  }
  return out;
});

/** Wait until the results view has exactly `scored` formatted chips and `pending` "—" chips. */
const settleChips = (page, { scored, pending = 0 }) => page.waitForFunction((cfg) => {
  if (!document.querySelector(".results")) return false;
  const nums = [...document.querySelectorAll(".tile[data-id] .chip__num")];
  const formatted = nums.filter((el) => /^\d+% sharp$/.test(el.textContent.trim()));
  const pendingNums = nums.filter((el) => el.textContent.trim() === "—");
  return formatted.length === cfg.scored && pendingNums.length === cfg.pending;
}, { scored, pending }, { timeout: ANALYSIS_TIMEOUT, polling: 25 });

const openResults = async (page) => {
  await page.waitForSelector(".results", { timeout: ANALYSIS_TIMEOUT });
};

/* ------------------------------------------------------------------ */
/* State runner                                                        */
/* ------------------------------------------------------------------ */

let currentState = null;
let shotCount = 0;

async function shot(page, name) {
  const file = path.join(ARTIFACTS_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  if (currentState) currentState.screenshots.push(path.basename(file));
  shotCount += 1;
  return file;
}

async function runState(id, title, fn) {
  const state = { id, title, status: "PASS", checks: [], evidence: null, error: null, screenshots: [] };
  states.push(state);
  currentState = state;
  const context = await browser.newContext({ viewport: DESKTOP, acceptDownloads: true });
  const page = await context.newPage();
  wire(page, id);
  const expect = (name, ok, detail = "") => {
    state.checks.push({ name, ok: !!ok, detail });
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${name}${detail ? ` — ${detail}` : ""}`);
  };
  try {
    const evidence = await fn({ page, context, expect, state });
    state.evidence = evidence ?? null;
    if (!state.checks.every((c) => c.ok)) state.status = "FAIL";
    const issues = hygiene.filter((h) => h.tag === id);
    expect("typing: zero console errors/warnings/pageerrors/failed requests in this state", issues.length === 0, JSON.stringify(issues.slice(0, 3)));
    if (!state.checks.every((c) => c.ok)) state.status = "FAIL";
  } catch (error) {
    state.status = "FAIL";
    state.error = error.message;
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, `fail-${id}.png`) }).catch(() => {});
    console.log(`  FATAL  ${id}  ${error.message}`);
  } finally {
    currentState = null;
    await context.close().catch(() => {});
  }
  console.log(`  ${state.status === "PASS" ? "== PASS" : "== FAIL"}  ${id} — ${title}\n`);
  return state;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

(async () => {
  const watchdog = setTimeout(() => {
    console.error(`E2E WATCHDOG: run exceeded ${WATCHDOG_MS}ms — killing.`);
    process.exit(1);
  }, WATCHDOG_MS);
  watchdog.unref?.();

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  let exitCode = 1;
  try {
    ({ server } = await startServer(APP_ROOT, BASE_PORT));
    const { port } = await new Promise((resolve) => {
      const check = () => (server.listening ? resolve({ port: server.address().port }) : setTimeout(check, 10));
      check();
    });
    appUrl = `http://127.0.0.1:${port}/`;
    console.log(`serving ${APP_ROOT} at ${appUrl}\n`);

    browser = await chromium.launch({ channel: "chrome", headless: true });

    /* ================================================================ */
    /* S1 — four fixtures: exact percentages + store identity + bands   */
    /* ================================================================ */

    await runState("S1", "4 fixtures → exact \"NN% sharp\" chips, DOM == store, band coherence", async ({ page, expect }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });
      await pickBatch(page, FOUR);
      await openResults(page);
      await settleChips(page, { scored: 4 });

      const store = await readStore(page);
      const chips = await readChips(page);
      const tileBands = await page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll(".tile[data-id]")].map((t) => [t.dataset.id, t.closest(".band")?.dataset.band ?? null]),
      ));
      const bandCounts = await page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll(".band")].map((b) => [b.dataset.band, {
          count: b.querySelector(".band__count")?.textContent ?? null,
          tiles: b.querySelectorAll(".tile[data-id]").length,
        }]),
      ));

      expect("store holds exactly the 4 fixtures with locked scores 100/96/34/36 and bands", store.photos.length === 4
        && FIXTURES.every((f) => {
          const p = store.photos.find((x) => x.name === f.name);
          return p && p.score === f.score && p.band === f.band;
        }), JSON.stringify(store.photos.map((p) => [p.name, p.score, p.band])));

      const formatted = Object.values(chips).filter((t) => /^\d+% sharp$/.test(t));
      expect("all 4 tile chips are formatted \"NN% sharp\" (DOM text)", formatted.length === 4, JSON.stringify(chips));

      for (const f of FIXTURES) {
        const p = store.photos.find((x) => x.name === f.name);
        expect(`"${f.name}" chip text == store score (${f.score}% sharp)`, !!p && chips[p.id] === `${f.score}% sharp`,
          p ? `store=${p.score} chip=${JSON.stringify(chips[p.id])}` : "(missing)");
      }

      expect("band membership coherent (34/36 under Blurry, 100/96 under Sharp)", FIXTURES.every((f) => {
        const p = store.photos.find((x) => x.name === f.name);
        return p && tileBands[p.id] === f.band;
      }), JSON.stringify(tileBands));

      expect("band counts: Blurry 2 photos / Sharp 2 photos / Needs review 0 photos, counts == tiles", bandCounts.blurry?.count === "2 photos"
        && bandCounts.blurry?.tiles === 2
        && bandCounts.sharp?.count === "2 photos" && bandCounts.sharp?.tiles === 2
        && bandCounts.review?.count === "0 photos" && bandCounts.review?.tiles === 0,
      JSON.stringify(bandCounts));

      await shot(page, "s1-results-1280");
      return JSON.stringify({ chips, tileBands, bandCounts });
    });

    /* ================================================================ */
    /* S2 — detail chip via keyboard + click, exact text, Escape close  */
    /* ================================================================ */

    await runState("S2", "detail chip \"NN% sharp · Band\" via keyboard + click; Escape close", async ({ page, expect }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await pickBatch(page, FOUR);
      await openResults(page);
      await settleChips(page, { scored: 4 });
      const store = await readStore(page);
      const blurry = store.photos.find((p) => p.name === "fixture-blurred-checkerboard.png");
      const sharp = store.photos.find((p) => p.name === "fixture-sharp-text.png");

      // Keyboard path: focus the tile's meta button and press Enter.
      const blurryMeta = page.getByRole("button", { name: `View ${blurry.name}` });
      await blurryMeta.focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector(".detail__panel", { timeout: STEP_TIMEOUT });
      await page.waitForFunction(() => document.querySelector(".detail__panel")?.classList.contains("detail__panel--open")
        || getComputedStyle(document.querySelector(".detail__panel")).visibility !== "hidden", null, { timeout: STEP_TIMEOUT });
      const kbChip = (await page.locator(".detail__chip").textContent()).trim();
      expect("keyboard-opened detail chip is exactly \"34% sharp · Blurry\"", kbChip === `${blurry.score}% sharp · Blurry`, JSON.stringify(kbChip));
      await shot(page, "s2-detail-keyboard-1280");

      await page.keyboard.press("Escape");
      await page.waitForFunction(() => {
        const panel = document.querySelector(".detail__panel");
        if (!panel) return true;
        const cs = getComputedStyle(panel);
        return cs.visibility === "hidden" || cs.display === "none" || panel.offsetParent === null;
      }, null, { timeout: STEP_TIMEOUT });
      const focusReturned = await page.evaluate((name) => {
        const el = document.activeElement;
        return !!el && el.classList.contains("tile__meta-btn") && el.getAttribute("aria-label") === `View ${name}`;
      }, blurry.name);
      expect("Escape closes the sheet and focus returns to the tile's meta button", focusReturned);

      // Click path on a second (Sharp) photo.
      await page.getByRole("button", { name: `View ${sharp.name}` }).click();
      await page.waitForSelector(".detail__panel", { timeout: STEP_TIMEOUT });
      const clickChip = (await page.locator(".detail__chip").textContent()).trim();
      expect("click-opened detail chip is exactly \"96% sharp · Sharp\"", clickChip === `${sharp.score}% sharp · Sharp`, JSON.stringify(clickChip));
      await shot(page, "s2-detail-click-1280");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => {
        const panel = document.querySelector(".detail__panel");
        if (!panel) return true;
        const cs = getComputedStyle(panel);
        return cs.visibility === "hidden" || cs.display === "none" || panel.offsetParent === null;
      }, null, { timeout: STEP_TIMEOUT });

      return JSON.stringify({ kbChip, clickChip, focusReturned });
    });

    /* ================================================================ */
    /* S3 — mixed batch with transparent PNG (skip path)                */
    /* ================================================================ */

    await runState("S3", "transparent PNG skipped: chip \"—\", never \"0% sharp\", counts exclude skipped", async ({ page, expect }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await pickBatch(page, [...FOUR, { name: "fixture-transparent.png", mimeType: "image/png", buffer: transparentPng() }]);
      await openResults(page);
      await settleChips(page, { scored: 4, pending: 1 });

      const store = await readStore(page);
      const chips = await readChips(page);
      const skipped = store.photos.find((p) => p.name === "fixture-transparent.png");
      const skippedBands = await page.evaluate(() => [...document.querySelectorAll(".band")].map((b) => b.dataset.band));

      expect("skip notice \"1 photo couldn't be analyzed\" is visible", await page.getByRole("heading", { name: SKIP_HEADING, exact: true }).count() === 1);
      expect("skipped photo: store score null, band \"skipped\", name in analysis-skipped ledger", !!skipped
        && skipped.score === null && skipped.band === "skipped" && store.skippedAnalysis.includes("fixture-transparent.png"),
      JSON.stringify(skipped));

      const skippedSection = page.locator('.band[data-band="skipped"]');
      expect("Skipped section renders last with 1 tile, count \"1 photo\"", skippedBands[skippedBands.length - 1] === "skipped"
        && await skippedSection.locator(".tile[data-id]").count() === 1
        && (await skippedSection.locator(".band__count").textContent()).trim() === "1 photo",
      JSON.stringify(skippedBands));
      const skippedChip = skipped ? chips[skipped.id] : null;
      expect("skipped tile chip is \"—\" (not \"0% sharp\")", skippedChip === "—", JSON.stringify(skippedChip));

      // Digit boundary: "100% sharp" contains the substring "0% sharp" — the ban is on a
      // standalone zero score, so match "0% sharp" only when not preceded by another digit.
      const noZeroSharp = await page.evaluate(() => !/(^|[^0-9])0% sharp/.test(document.body.textContent));
      expect("NO photo renders \"0% sharp\" in the skipped batch (digit-boundary match)", noZeroSharp);

      const bandState = await page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll(".band")].map((b) => [b.dataset.band, {
          count: b.querySelector(".band__count")?.textContent ?? null,
          tiles: b.querySelectorAll(".tile[data-id]").length,
          ids: [...b.querySelectorAll(".tile[data-id]")].map((t) => t.dataset.id),
        }]),
      ));
      expect("band counts exclude skipped (Blurry 2 / Sharp 2 / Needs review 0 / Skipped 1; tiles == counts)", bandState.blurry?.count === "2 photos"
        && bandState.sharp?.count === "2 photos" && bandState.review?.count === "0 photos" && bandState.skipped?.count === "1 photo"
        && bandState.blurry.tiles === 2 && bandState.sharp.tiles === 2 && bandState.review.tiles === 0 && bandState.skipped.tiles === 1,
      JSON.stringify(bandState));
      expect("skipped tile does not appear inside any scored band", skipped
        && !["blurry", "review", "sharp"].some((b) => bandState[b]?.ids.includes(skipped.id)));

      const everyChipValid = Object.values(chips).every((t) => /^\d+% sharp$/.test(t) || t === "—");
      expect("every chip in the batch reads \"NN% sharp\" or \"—\" (no bare score)", everyChipValid, JSON.stringify(chips));

      await shot(page, "s3-mixed-skipped-1280");
      return JSON.stringify({ skipped, skippedChip, bandState });
    });

    /* ================================================================ */
    /* S3z — boundary: a genuine score of 0 renders "0% sharp"          */
    /* ================================================================ */

    await runState("S3z", "genuine score 0 renders \"0% sharp\" (tile + detail) — distinct from \"—\"", async ({ page, expect }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await pickBatch(page, [{ name: "fixture-smooth-gradient.png", mimeType: "image/png", buffer: smoothGradientPng() }]);
      await openResults(page);
      await settleChips(page, { scored: 1 });

      const store = await readStore(page);
      const chips = await readChips(page);
      const zero = store.photos[0];
      expect("smooth-gradient photo scores exactly 0 in band \"blurry\" (scored, never skipped)", !!zero && zero.score === 0 && zero.band === "blurry", JSON.stringify(zero));
      expect("tile chip renders \"0% sharp\" (a real measurement)", zero && chips[zero.id] === "0% sharp", JSON.stringify(chips));

      await page.getByRole("button", { name: `View ${zero.name}` }).click();
      await page.waitForSelector(".detail__panel", { timeout: STEP_TIMEOUT });
      const detailChip = (await page.locator(".detail__chip").textContent()).trim();
      expect("detail chip renders \"0% sharp · Blurry\"", detailChip === "0% sharp · Blurry", JSON.stringify(detailChip));
      expect("no Skipped section exists for a scored-0 photo", await page.locator('.band[data-band="skipped"]').count() === 0);
      await shot(page, "s3z-zero-score-1280");
      await page.keyboard.press("Escape");
      return JSON.stringify({ zero, detailChip });
    });

    /* ================================================================ */
    /* S4 — pending "—" → filled "NN% sharp" transition (polling)       */
    /* ================================================================ */

    await runState("S4", "pending chips \"—\" before scores land, then fill to \"NN% sharp\"", async ({ page, expect }) => {
      await page.addInitScript(() => {
        window.__chipTimeline = [];
        const snap = () => {
          const tiles = [...document.querySelectorAll(".tile[data-id]")];
          if (!tiles.length) return;
          const entry = { hasResults: !!document.querySelector(".results"), chips: {} };
          for (const t of tiles) {
            const n = t.querySelector(".chip__num");
            if (n) entry.chips[t.dataset.id] = n.textContent.trim();
          }
          if (!Object.keys(entry.chips).length) return;
          const last = window.__chipTimeline[window.__chipTimeline.length - 1];
          if (!last || JSON.stringify(last.chips) !== JSON.stringify(entry.chips) || last.hasResults !== entry.hasResults) {
            window.__chipTimeline.push(entry);
          }
        };
        new MutationObserver(snap).observe(document.documentElement || document, { subtree: true, childList: true, characterData: true });
      });
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await pickBatch(page, FOUR);

      // Live observation: 10ms polling must catch the all-pending DOM.
      const sawPendingLive = await page.waitForFunction(() => {
        const tiles = [...document.querySelectorAll(".tile[data-id]")];
        if (tiles.length !== 4 || document.querySelector(".results")) return false;
        return tiles.every((t) => t.querySelector(".chip__num")?.textContent.trim() === "—");
      }, null, { timeout: STEP_TIMEOUT, polling: 10 }).then(() => true).catch(() => false);
      const pendingShot = await shot(page, "s4-pending-live");

      await openResults(page);
      await settleChips(page, { scored: 4 });
      const timeline = await page.evaluate(() => window.__chipTimeline);
      const finalChips = await readChips(page);
      const store = await readStore(page);
      const allPending = timeline.find((e) => !e.hasResults
        && Object.keys(e.chips).length === 4
        && Object.values(e.chips).every((t) => t === "—"));
      const first = timeline[0] ?? null;
      const perIdTransition = store.photos.every((p) => {
        const values = timeline.map((e) => e.chips[p.id]).filter((v) => v !== undefined);
        return values.length > 0 && values[0] === "—" && values[values.length - 1] === `${p.score}% sharp`;
      });
      const laterAllScored = !!allPending && timeline.some((e, i) => i > timeline.indexOf(allPending)
        && Object.values(e.chips).some((t) => /^\d+% sharp$/.test(t)));

      expect("all-pending DOM state observed (MutationObserver timeline: 4×\"—\", pre-results)", !!allPending,
        `first=${JSON.stringify(first)} allPending=${JSON.stringify(allPending)}`);
      expect("live 10ms polling caught the all-pending state (chips \"—\" before scores land)", sawPendingLive,
        `live=${sawPendingLive} timelineProvesPending=${!!allPending}`);
      expect("every photo's chip transitioned \"—\" → \"NN% sharp\" (values from the timeline)", perIdTransition && laterAllScored,
        JSON.stringify(timeline.map((e) => [e.hasResults, e.chips])));
      expect("final chips after fill == store scores", store.photos.every((p) => finalChips[p.id] === `${p.score}% sharp`), JSON.stringify(finalChips));
      await shot(page, "s4-results-1280");
      return JSON.stringify({ sawPendingLive, snapshots: timeline.length, finalChips, pendingShot: path.basename(pendingShot) });
    });

    /* ================================================================ */
    /* S5 — band headers (Ruling D1) + subtitle + empty band            */
    /* ================================================================ */

    await runState("S5", "no % in band headers (D1); empty band unchanged; subtitle exactly once, before first band", async ({ page, expect }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await pickBatch(page, FOUR);
      await openResults(page);
      await settleChips(page, { scored: 4 });

      const view = await page.evaluate(() => {
        const headers = [...document.querySelectorAll(".band__header")].map((h) => h.textContent);
        const bandChips = [...document.querySelectorAll(".band-header h2, .band__header h2, .band-chip")].map((h) => h.textContent.trim());
        const review = document.querySelector('.band[data-band="review"]');
        const subtitle = document.querySelector(".results__subtitle");
        const firstBand = document.querySelector(".results .band");
        const subtitles = [...document.querySelectorAll(".results__subtitle")];
        const allBands = [...document.querySelectorAll(".results .band")];
        return {
          headers,
          bandChips,
          review: review ? {
            count: review.querySelector(".band__count")?.textContent ?? null,
            empty: review.querySelector(".band__empty")?.textContent ?? null,
          } : null,
          subtitleCount: subtitles.length,
          subtitleText: subtitle?.textContent ?? null,
          subtitleBeforeFirstBand: !!subtitle && !!firstBand
            && !!(subtitle.compareDocumentPosition(firstBand) & Node.DOCUMENT_POSITION_FOLLOWING),
          subtitleBeforeEveryBand: !!subtitle && allBands.every((b) => !!(subtitle.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)),
          subtitleNextIsBand: subtitle?.nextElementSibling?.classList.contains("band") ?? null,
          subtitleInsideResults: subtitle?.parentElement?.classList.contains("results") ?? null,
          goodResolution: document.body.textContent.includes("good resolution"),
          chipTexts: [...document.querySelectorAll(".tile[data-id] .chip__num")].map((n) => n.textContent.trim()),
        };
      });

      expect("NO band header contains \"%\" (Ruling D1)", view.headers.length === 3
        && view.headers.every((t) => !t.includes("%")), JSON.stringify(view.headers));
      expect("band headings are the plain labels Blurry / Needs review / Sharp", JSON.stringify(view.bandChips) === JSON.stringify(["Blurry", "Needs review", "Sharp"]),
        JSON.stringify(view.bandChips));
      expect("empty Needs review band keeps \"0 photos\" + \"No photos in this band\"", view.review?.count === "0 photos"
        && view.review?.empty === "No photos in this band", JSON.stringify(view.review));

      expect("subtitle appears EXACTLY once inside .results", view.subtitleCount === 1 && view.subtitleInsideResults,
        JSON.stringify({ count: view.subtitleCount, inside: view.subtitleInsideResults }));
      expect("subtitle copy is exact: \"" + SUBTITLE + "\"", view.subtitleText === SUBTITLE, JSON.stringify(view.subtitleText));
      expect("subtitle sits in document order before the first band (and every band)", view.subtitleBeforeFirstBand && view.subtitleBeforeEveryBand
        && view.subtitleNextIsBand === true, JSON.stringify({ before: view.subtitleBeforeFirstBand, beforeAll: view.subtitleBeforeEveryBand, nextIsBand: view.subtitleNextIsBand }));
      expect("no \"good resolution\" copy anywhere; every chip formatted", view.goodResolution === false
        && view.chipTexts.every((t) => /^\d+% sharp$/.test(t)), JSON.stringify({ goodResolution: view.goodResolution, chipTexts: view.chipTexts }));

      await shot(page, "s5-headers-subtitle-1280");
      return JSON.stringify(view);
    });

    /* ================================================================ */
    /* S6 — determinism: Start over → re-pick → byte-identical chips    */
    /* ================================================================ */

    await runState("S6", "Start over → re-pick: chip texts byte-identical (determinism)", async ({ page, expect }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await pickBatch(page, FOUR);
      await openResults(page);
      await settleChips(page, { scored: 4 });
      const run1 = await readStore(page);
      const chips1 = await readChips(page);
      const chips1ByName = Object.fromEntries(run1.photos.map((p) => [p.name, chips1[p.id]]));

      await page.getByRole("button", { name: "Start over", exact: true }).click();
      await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });
      await page.waitForFunction(() => document.querySelectorAll(".tile[data-id]").length === 0, null, { timeout: STEP_TIMEOUT });

      await pickBatch(page, FOUR);
      await openResults(page);
      await settleChips(page, { scored: 4 });
      const run2 = await readStore(page);
      const chips2 = await readChips(page);
      const chips2ByName = Object.fromEntries(run2.photos.map((p) => [p.name, chips2[p.id]]));

      const byteIdentical = FIXTURES.every((f) => chips1ByName[f.name] === chips2ByName[f.name] && chips2ByName[f.name] === `${f.score}% sharp`);
      const scoresIdentical = FIXTURES.every((f) => {
        const a = run1.photos.find((p) => p.name === f.name);
        const b = run2.photos.find((p) => p.name === f.name);
        return a && b && a.score === b.score && a.band === b.band;
      });
      expect("run 2 chip texts byte-identical to run 1 and to the locked scores", byteIdentical,
        JSON.stringify({ run1: chips1ByName, run2: chips2ByName }));
      expect("run 2 store scores/bands byte-identical to run 1", scoresIdentical, JSON.stringify(run2.photos.map((p) => [p.name, p.score, p.band])));
      const dialog = dialogs.filter((d) => d.tag === "S6");
      expect("Start over raised the native confirm dialog", dialog.some((d) => d.type === "confirm" && /Start over\?/.test(d.message)), JSON.stringify(dialog));
      await shot(page, "s6-run2-1280");
      return JSON.stringify({ run1: chips1ByName, run2: chips2ByName });
    });

    /* ================================================================ */
    /* S7 — 375px: no overflow, no clipping, detail chip visible        */
    /* ================================================================ */

    await runState("S7", "375px: no horizontal overflow, no chip clipping, detail sheet chip visible", async ({ page, expect }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page.setViewportSize(MOBILE);
      await pickBatch(page, FOUR);
      await openResults(page);
      await settleChips(page, { scored: 4 });

      const layout = await page.evaluate(() => {
        const overflowX = document.scrollingElement.scrollWidth - window.innerWidth;
        const tiles = [...document.querySelectorAll(".tile[data-id]")].map((tile) => {
          const chip = tile.querySelector(".chip");
          const meta = tile.querySelector(".tile__meta-btn") ?? tile.querySelector(".tile__meta");
          const t = tile.getBoundingClientRect();
          const c = chip.getBoundingClientRect();
          return {
            name: tile.querySelector(".tile__filename")?.textContent ?? null,
            chipText: chip.querySelector(".chip__num")?.textContent ?? null,
            chipInside: c.left >= t.left - 1 && c.right <= t.right + 1,
            chipClipped: chip.scrollWidth > chip.clientWidth + 1,
            metaClipped: meta ? meta.scrollWidth > meta.clientWidth + 1 : null,
            chipWidth: Math.round(c.width),
            tileWidth: Math.round(t.width),
          };
        });
        return { overflowX, tiles, viewport: window.innerWidth };
      });
      expect("375px: document scrollWidth == viewport (no horizontal overflow)", layout.overflowX <= 0,
        `overflowX=${layout.overflowX} vw=${layout.viewport}`);
      expect("375px: every chip inside its tile, scrollWidth <= clientWidth (no clipping)", layout.tiles.length === 4
        && layout.tiles.every((t) => t.chipInside && !t.chipClipped && t.metaClipped !== true && /^\d+% sharp$/.test(t.chipText)),
      JSON.stringify(layout.tiles));
      await shot(page, "s7-results-375");

      const store = await readStore(page);
      const blurry = store.photos.find((p) => p.band === "blurry");
      await page.getByRole("button", { name: `View ${blurry.name}` }).click();
      await page.waitForSelector(".detail__panel", { timeout: STEP_TIMEOUT });
      const detail = await page.evaluate(() => {
        const panel = document.querySelector(".detail__panel");
        const chip = document.querySelector(".detail__chip");
        const p = panel.getBoundingClientRect();
        const c = chip.getBoundingClientRect();
        return {
          panelWidth: Math.round(p.width),
          panelHeight: Math.round(p.height),
          chipVisible: c.left >= p.left - 1 && c.right <= p.right + 1 && c.top >= p.top - 1 && c.bottom <= p.bottom + 1,
          chipText: chip.textContent.trim(),
        };
      });
      expect("375px detail: full-height sheet, chip fully visible with exact \"NN% sharp · Band\"", detail.panelWidth === 375
        && detail.panelHeight === 812 && detail.chipVisible && detail.chipText === `${blurry.score}% sharp · Blurry`,
      JSON.stringify(detail));
      await shot(page, "s7-detail-375");
      await page.keyboard.press("Escape");
      return JSON.stringify({ layout, detail });
    });

    /* ================================================================ */
    /* S8 — full journey unaffected + hygiene                           */
    /* ================================================================ */

    await runState("S8", "full journey: empty → 4 → select 2 → byte-identical downloads → Start over revocation", async ({ page, context, expect }) => {
      await context.addInitScript(() => {
        window.__revokeLog = [];
        const original = URL.revokeObjectURL.bind(URL);
        URL.revokeObjectURL = function revokeObjectURL(url) {
          try { window.__revokeLog.push(String(url)); } catch { /* never break the app */ }
          return original(url);
        };
      });
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

      await page.getByRole("heading", { name: "Find the blurry photos" }).waitFor({ state: "visible", timeout: STEP_TIMEOUT });
      expect("empty state: CTA + privacy line visible, no Start over", await page.getByRole("button", { name: "Choose photos", exact: true }).count() === 1
        && await page.getByText("Photos never leave this device.", { exact: true }).count() === 1
        && await page.getByRole("button", { name: "Start over", exact: true }).count() === 0);
      await shot(page, "s8-empty");

      await pickBatch(page, FOUR);
      await openResults(page);
      await settleChips(page, { scored: 4 });

      // Select the two Blurry photos like a user (tile photo buttons).
      // R6 re-scope (2026-11-06, design-spec-v2 §11.5.5): Blurry tiles'
      // accessible names end with ", suggested for deletion".
      const suggestedName = (name) =>
        new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(, suggested for deletion)?$`);
      for (const name of ["fixture-blurred-checkerboard.png", "fixture-blurred-text.png"]) {
        await page.getByRole("button", { name: suggestedName(name) }).click();
      }
      await page.waitForFunction(() => {
        const el = document.querySelector(".action-bar__summary");
        return !!el && el.textContent.includes("2 selected");
      }, null, { timeout: STEP_TIMEOUT, polling: 25 });
      const summary = (await page.locator(".action-bar__summary").textContent()).trim();
      const pressed = await page.evaluate(() => ["fixture-blurred-checkerboard.png", "fixture-blurred-text.png"].map((name) => {
        // R6 §11.5.5: Blurry tiles' aria-label carries the recommendation
        // suffix — match either form.
        const btn = [...document.querySelectorAll(".tile__photo")].find(
          (b) => b.getAttribute("aria-label") === name
            || b.getAttribute("aria-label") === `${name}, suggested for deletion`,
        );
        return btn?.getAttribute("aria-pressed") ?? null;
      }));
      expect("selecting 2 tiles: summary \"2 selected · 4 total\", both aria-pressed=true", summary === "2 selected · 4 total"
        && pressed.every((v) => v === "true"), JSON.stringify({ summary, pressed }));
      await shot(page, "s8-selected");

      // Download selected → two downloads, byte-identical to the originals.
      // Collect via page.on (two simultaneous waitForEvent promises would both
      // resolve on the FIRST event — a collector is the correct pattern).
      const downloads = [];
      page.on("download", (d) => downloads.push(d));
      await page.getByRole("button", { name: /^Download selected/ }).click();
      const dlDeadline = Date.now() + DOWNLOAD_TIMEOUT;
      while (downloads.length < 2 && Date.now() < dlDeadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (downloads.length !== 2) throw new Error(`expected 2 download events, saw ${downloads.length}`);
      const savedNames = downloads.map((d) => d.suggestedFilename());
      const downloadedBytes = [];
      for (const d of downloads) downloadedBytes.push(fs.readFileSync(await d.path()));
      const expectedByName = new Map(FIXTURES.map((f) => [f.name, f.buffer]));
      const bytesOk = savedNames.every((n) => expectedByName.has(n))
        && downloadedBytes.every((buf, i) => buf.equals(expectedByName.get(savedNames[i])));
      expect("2 downloads with the original names, content byte-identical to the source files", bytesOk,
        JSON.stringify({ savedNames, sizes: downloadedBytes.map((b) => b.length) }));

      // Start over → cleared + every thumbnail object URL revoked.
      const thumbSrcs = await page.$$eval(".photo-grid img", (imgs) => imgs.map((img) => img.src));
      await page.getByRole("button", { name: "Start over", exact: true }).click();
      await page.getByRole("heading", { name: "Find the blurry photos" }).waitFor({ state: "visible", timeout: STEP_TIMEOUT });
      await page.waitForFunction(() => document.querySelectorAll(".tile[data-id]").length === 0, null, { timeout: STEP_TIMEOUT });
      const revoked = await page.evaluate(() => window.__revokeLog.slice());
      const missing = thumbSrcs.filter((s) => !revoked.includes(s));
      expect("Start over cleared the grid and revoked every thumbnail object URL", thumbSrcs.length === 4 && missing.length === 0,
        JSON.stringify({ thumbSrcs: thumbSrcs.length, revoked: revoked.length, missing }));
      const soDialog = dialogs.filter((d) => d.tag === "S8");
      expect("Start over raised the native confirm dialog (accepted)", soDialog.some((d) => d.type === "confirm" && /Start over\?/.test(d.message)),
        JSON.stringify(soDialog));
      await shot(page, "s8-after-startover");
      return JSON.stringify({ summary, savedNames });
    });

    /* ================================================================ */
    /* Global hygiene + same-origin                                     */
    /* ================================================================ */

    console.log("— global checks —");
    const g = { checks: [], add(name, ok, detail = "") { this.checks.push({ name, ok, detail }); console.log(`  ${ok ? "PASS" : "FAIL"}  HYGIENE  ${name}${detail ? ` — ${detail}` : ""}`); } };
    g.add("zero console errors/warnings/pageerrors/failed requests across ALL states", hygiene.length === 0,
      JSON.stringify(hygiene.slice(0, 5)));
    const origin = new URL(appUrl).origin;
    const offOrigin = requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith("blob:") && !r.url.startsWith("data:"));
    g.add("every network request is same-origin (no external calls)", offOrigin.length === 0,
      JSON.stringify(offOrigin.slice(0, 5)));
    g.add("no HTTP >= 400 responses observed", !hygiene.some((h) => h.kind.startsWith("http")),
      JSON.stringify(hygiene.filter((h) => h.kind.startsWith("http")).slice(0, 5)));

    const failedStates = states.filter((s) => s.status !== "PASS");
    const failed = failedStates.length + g.checks.filter((c) => !c.ok).length;
    const summary = {
      phase: "R4 — percentage display \"NN% sharp\"",
      spec: "designs/design-spec-v2.md §11.2 + plan Ruling D1",
      states: states.map((s) => ({ id: s.id, title: s.title, status: s.status, checks: s.checks, error: s.error, screenshots: s.screenshots })),
      globalChecks: g.checks,
      hygiene,
      dialogs,
      requests: requests.length,
      offOriginRequests: offOrigin,
      failures: failed,
      verdict: failed === 0 ? "PASS" : "FAIL",
    };
    fs.writeFileSync(path.join(ARTIFACTS_DIR, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(`\nsummary → ${path.join(ARTIFACTS_DIR, "summary.json")}`);
    console.log(`\n${failed === 0 ? "R4 E2E PASS" : `R4 E2E FAIL (${failed})`}: states ${states.map((s) => `${s.id}=${s.status}`).join(" ")}${g.checks.some((c) => !c.ok) ? " + global hygiene FAIL" : ""}`);
    exitCode = failed === 0 ? 0 : 1;
  } catch (error) {
    console.error("R4 E2E FATAL:", error);
    exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try { if (server) { server.closeAllConnections(); await new Promise((r) => server.close(r)); } } catch { /* ignore */ }
  }
  process.exit(exitCode);
})();
