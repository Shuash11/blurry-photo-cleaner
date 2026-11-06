/**
 * v2-r3-e2e-tester.js — INDEPENDENT Phase R3 (grey/modern restyle) e2e proof.
 *
 * Written by the E2E/Integration Testing Agent as an independent verification
 * run of the delegated Phase R3 state matrix (plans/blurry-photo-cleaner-v2-restyle.md
 * "Phase R3", design-spec-v2 §4.1–§4.7, §5, §6). It does NOT import or re-run
 * any implementer suite; it drives the live served app through its own states
 * with its own assertions and its own artifacts.
 *
 * Run:  node e2e/v2-r3-e2e-tester.js
 *
 * Tooling (binding directive): Playwright LIBRARY only — playwright-cli banned.
 * Chrome (channel "chrome") headless, in-process static server killed in
 * finally, per-step timeouts + whole-run watchdog, screenshots to
 * e2e/artifacts/v2-r3-e2e/ (for the record only — never read back), process
 * ALWAYS exits (0 pass / 1 state failed / 2 fatal or watchdog).
 *
 * Delegated state matrix (fresh browser context per state; retries reported):
 *   R3-1  Full user journey on the restyled app: empty → pick 4 fixtures →
 *         analyzing (progress card observed live) → grouped results (bands +
 *         counts + chips) → select 2 → Download selected (2 byte-identical
 *         downloads, busy state, live announcements) → detail open/navigate/
 *         close (Escape + focus return) → Start over (confirm + URL revocation).
 *         Zero console errors at every step.
 *   R3-2  Visual tokens (programmatic): body bg rgb(242,243,245); accent fill
 *         rgb(46,92,149); focus ring 2px rgb(46,92,149) offset 2 on light and
 *         white on stage; radii tokens ∈ {8,12,18,999} and rendered radii in
 *         the spec set; theme-color meta #F2F3F5.
 *   R3-3  Scoring identity through the real picker: fixtures → 100/96 sharp,
 *         34/36 blurry, byte-identical on re-run; rendered chips == store.
 *   R3-4  Pointer-gated density: coarse (hasTouch) 375 + 810 → every visible
 *         interactive element ≥44×44; fine 768/1280 → 36/32 density on regular
 *         controls (hero excluded, hero stays 48px at all four).
 *   R3-5  Reduced motion: emulateMedia reduce → band reveal + sheet rise
 *         disabled (animation none, delays 0, opacity 1/transform none on ALL
 *         .band--reveal elements + tiles + .detail__panel); durations 1ms.
 *   R3-6  Touch specifics: drop hint hidden on coarse (empty + all-failed),
 *         visible on desktop.
 *   R3-7  Keyboard-only core flow: Tab to CTA → picker substitution → Tab walk
 *         (band toggles, tiles Enter-toggle, action bar) → Enter download →
 *         Escape detail path → focus return; ring visible at every stop.
 *   R3-8  Hygiene + responsiveness: zero console errors/warnings/pageerrors/
 *         failed requests/HTTP≥400 in every state; every request same-origin;
 *         no horizontal overflow at 375/768/1280.
 *
 * Flakiness rule: a state may retry at most twice; a state that only passes on
 * a retry is reported as flaky, never silently green.
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("playwright");

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const APP_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(APP_ROOT, "e2e", "fixtures");
const ARTIFACTS_DIR = path.join(__dirname, "artifacts", "v2-r3-e2e");
const BASE_PORT = 9050;
const STEP_TIMEOUT = 15000;      // one user step / one wait for a UI state
const ANALYSIS_TIMEOUT = 60000;  // full batch resolution budget
const DOWNLOAD_TIMEOUT = 20000;  // 2 sequential anchor downloads

/* R6 re-scope (2026-11-06, design-spec-v2 §11.5.5): a Blurry tile's
   accessible name ends with ", suggested for deletion" — tile-photo button
   lookups match either name form. */
const photoButton = (page, name) =>
  page.getByRole("button", {
    name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(, suggested for deletion)?$`),
  });
const WATCHDOG_MS = 600000;      // whole-run hard cap

const DESKTOP = { width: 1280, height: 800 };

/* v2 spec values under test (design-spec-v2 §4.7 drop-in block) */
const V2 = {
  bg: "rgb(242, 243, 245)",          // --color-bg #F2F3F5
  accent: "rgb(46, 92, 149)",        // --color-accent #2E5C95
  mutedFill: "rgb(238, 241, 244)",   // --color-surface-muted #EEF1F4
  mutedText: "rgb(100, 110, 123)",   // --color-text-muted #646E7B
  text: "rgb(22, 25, 30)",           // --color-text #16191E
  accentSubtle: "rgba(46, 92, 149, 0.1)",
};

/* ------------------------------------------------------------------ */
/* Run state                                                           */
/* ------------------------------------------------------------------ */

const results = [];  // { id, name, status, detail, flaky }
const hygiene = [];  // { tag, kind, text, url }
const netLog = [];   // { tag, url, status }
const dialogs = [];  // { tag, type, message }
const shots = [];    // { tag, file }
let currentTag = "boot";
let server = null;
let browser = null;
let appUrl = null;

/* ------------------------------------------------------------------ */
/* Fixtures (v1-locked scores: sharp 100/96, blurred 34/36)            */
/* ------------------------------------------------------------------ */

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

const FIXTURES = [
  { name: "fixture-sharp-checkerboard.png", mime: "image/png", score: 100, band: "sharp" },
  { name: "fixture-sharp-text.png", mime: "image/png", score: 96, band: "sharp" },
  { name: "fixture-blurred-checkerboard.png", mime: "image/png", score: 34, band: "blurry" },
  { name: "fixture-blurred-text.png", mime: "image/png", score: 36, band: "blurry" },
].map((f) => ({ ...f, buffer: readFixture(f.name) }));

const TXT_FIXTURE = { name: "fixture-not-an-image.txt", mime: "text/plain", buffer: readFixture("fixture-not-an-image.txt") };

const asInput = (f) => ({ name: f.name, mimeType: f.mime, buffer: f.buffer });
const FOUR = FIXTURES.map(asInput);

/* ------------------------------------------------------------------ */
/* Reporting / assertion helpers                                       */
/* ------------------------------------------------------------------ */

function record(id, name, status, detail, flaky) {
  results.push({ id, name, status, detail, flaky: Boolean(flaky) });
  const marker = status === "PASS" ? (flaky ? "PASS*" : "PASS ") : "FAIL ";
  console.log(`${marker} ${id.padEnd(5)} ${name}${detail ? `\n      ${detail}` : ""}`);
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
  console.log(`      shot: e2e/artifacts/v2-r3-e2e/${file}`);
}

/** Bounded poll (condition waits, never fixed sleeps beyond settling). */
async function pollUntil(fn, timeout, interval = 50) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await fn().catch(() => false)) return true;
    if (Date.now() > deadline) return false;
    await sleep(interval);
  }
}

/* ------------------------------------------------------------------ */
/* App helpers                                                         */
/* ------------------------------------------------------------------ */

/** Real user path for file selection: activate the named button and feed the
    file chooser it opens (picker path — not a hidden-input shortcut). */
async function chooseFiles(page, triggerName, files) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: STEP_TIMEOUT }),
    page.getByRole("button", { name: triggerName, exact: true }).first().click({ timeout: STEP_TIMEOUT }),
  ]);
  await chooser.setFiles(files, { timeout: 120000 });
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

async function waitForResults(page, timeout = STEP_TIMEOUT) {
  try {
    await page.getByRole("heading", { name: "Blurry", exact: true }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    throw new Error(`results screen (band headings) not visible (${firstLine(error)})`);
  }
}

const debugState = (page) => page.evaluate(() => window.__debugState());

const readScores = (page) =>
  page.evaluate(() =>
    window.__debugState().photos.map((p) => ({ name: p.name, score: p.score, band: p.band })),
  );

/** Wait for the action-bar summary to read exactly `text`. */
const waitSummary = (page, text) =>
  page.waitForFunction(
    (t) => document.querySelector(".action-bar__summary")?.textContent.trim() === t,
    text,
    { timeout: STEP_TIMEOUT, polling: 50 },
  );

/**
 * Analyzing-state recorder (pattern proven in probe-v2-r3-ux-review.js): the
 * progress card can live <300ms and rAF/MutationObserver starvation can hide
 * it from waitForSelector, so it is sampled from inside the page.
 */
const installProgressRecorder = (pg) =>
  pg.evaluate(() => {
    window.__prog = { samples: [] };
    const sample = () => {
      const card = document.querySelector(".progress-card");
      if (!card) return null;
      const r = card.getBoundingClientRect();
      const bar = card.querySelector("[role='progressbar']");
      const cs = getComputedStyle(card);
      return {
        heading: card.querySelector(".progress-card__heading")?.textContent.trim() ?? null,
        status: card.querySelector(".progress-card__status")?.textContent.trim() ?? null,
        role: bar ? bar.getAttribute("role") : null,
        valueMin: bar ? bar.getAttribute("aria-valuemin") : null,
        valueMax: bar ? bar.getAttribute("aria-valuemax") : null,
        valueNow: bar ? bar.getAttribute("aria-valuenow") : null,
        painted: r.width > 0 && r.height > 0 && cs.visibility === "visible" && cs.display !== "none",
      };
    };
    const obs = new MutationObserver(() => {
      const s = sample();
      if (s) {
        const last = window.__prog.samples[window.__prog.samples.length - 1];
        if (!last || last.status !== s.status || last.valueNow !== s.valueNow) window.__prog.samples.push(s);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });

const readProgressSamples = (pg) => pg.evaluate(() => window.__prog.samples);

/** Download busy-state recorder: label transitions + spinner visibility. */
const installBusyRecorder = (pg) =>
  pg.evaluate(() => {
    window.__busy = { labels: [], spinner: false };
    const sample = () => {
      const btn = document.querySelector(".action-bar__actions .btn-primary");
      if (!btn) return;
      const label = (btn.textContent || "").trim();
      const last = window.__busy.labels[window.__busy.labels.length - 1];
      if (label && label !== last) window.__busy.labels.push(label);
      const sp = btn.querySelector(".spinner");
      if (sp && !sp.hidden) window.__busy.spinner = true;
    };
    new MutationObserver(sample).observe(document.body, {
      subtree: true, childList: true, characterData: true, attributes: true,
    });
    window.__busyIv = setInterval(sample, 20);
  });

const readBusy = (pg) => pg.evaluate(() => {
  clearInterval(window.__busyIv);
  return window.__busy;
});

/** Object-URL revocation spy (Start-over revocation proof). */
const REVOKE_SPY = () => {
  window.__revokeLog = [];
  const original = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = function revokeObjectURL(url) {
    try { window.__revokeLog.push(String(url)); } catch { /* never break the app */ }
    return original(url);
  };
};

/** Byte-identity check for a set of Playwright downloads vs the originals. */
async function assertDownloadsByteIdentical(downloads, label) {
  assert(downloads.length === 2, `${label}: expected 2 download events, saw ${downloads.length}`);
  const evidence = [];
  for (const d of downloads) {
    const name = d.suggestedFilename();
    const expect = FIXTURES.find((f) => f.name === name);
    assert(expect, `${label}: download "${name}" does not match a picked fixture`);
    const p = await d.path();
    assert(p, `${label}: download "${name}" has no temp path`);
    const saved = fs.readFileSync(p);
    assert(
      saved.length === expect.buffer.length && saved.equals(expect.buffer),
      `${label}: saved "${name}" (${saved.length} B) is not byte-identical to the original (${expect.buffer.length} B)`,
    );
    evidence.push(`${name} ${saved.length} B byte-identical`);
  }
  return evidence.join("; ");
}

/** Keyboard focus stop: element + computed ring. */
async function tabStop(page) {
  await page.keyboard.press("Tab");
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { tag: "BODY", name: "", ring: null };
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
      focusVisible: el.matches(":focus-visible"),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
    };
  });
}

function ringProblem(stop) {
  if (!stop || stop.tag === "BODY") return "focus left the document (BODY)";
  if (!stop.focusVisible) return "stop was not :focus-visible";
  if (stop.outlineStyle === "none" || parseFloat(stop.outlineWidth) < 2) {
    return `no visible ring (style=${stop.outlineStyle} width=${stop.outlineWidth})`;
  }
  return null;
}

/** Wait until the detail panel is gone/hidden. */
const waitDetailClosed = (page) =>
  page.waitForFunction(() => {
    const p = document.querySelector(".detail__panel");
    if (!p) return true;
    const cs = getComputedStyle(p);
    return cs.display === "none" || cs.visibility === "hidden" || p.hidden === true || Number(cs.opacity) === 0;
  }, null, { timeout: STEP_TIMEOUT, polling: 50 });

/** Horizontal-overflow delta in CSS px at the current viewport. */
const overflowPx = (page) =>
  page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);

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
        if (!filePath.startsWith(root)) { res.writeHead(403); res.end(); return; }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, "index.html");
        }
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
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
    if (res.status() >= 400) hygiene.push({ tag, kind: `http.${res.status()}`, text: res.url(), url: res.url() });
  });
  page.on("dialog", (dialog) => {
    dialogs.push({ tag, type: dialog.type(), message: dialog.message() });
    dialog.accept().catch(() => {});
  });
}

/* ------------------------------------------------------------------ */
/* State runner — fresh context per attempt, max two retries           */
/* ------------------------------------------------------------------ */

async function runState(id, name, ctxOptions, fn) {
  const only = process.env.R3_ONLY ? process.env.R3_ONLY.split(",").map((s) => s.trim()) : null;
  if (only && !only.includes(id)) {
    console.log(`\n--- ${id}: skipped (R3_ONLY debug filter) ---`);
    return;
  }
  console.log(`\n--- ${id}: ${name} ---`);
  const MAX_ATTEMPTS = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const tag = attempt === 1 ? id : `${id}#try${attempt}`;
    currentTag = tag;
    const context = await browser.newContext({ viewport: DESKTOP, acceptDownloads: true, ...ctxOptions });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    wirePage(page, tag);
    try {
      const detail = await fn({ page, context, attempt });
      record(id, name, "PASS", detail, attempt > 1);
      try { await context.close(); } catch { /* ignore */ }
      return;
    } catch (error) {
      lastError = error;
      console.log(`      attempt ${attempt} failed: ${firstLine(error)}`);
      if (attempt < MAX_ATTEMPTS) {
        await shot(page, `${id}-fail-attempt${attempt}.png`).catch(() => {});
      }
      try { await context.close(); } catch { /* ignore */ }
    }
  }
  record(id, name, "FAIL", firstLine(lastError));
}

/* ------------------------------------------------------------------ */
/* Shared check helpers                                                */
/* ------------------------------------------------------------------ */

function hygieneIssues(tag) {
  return hygiene.filter(
    (h) =>
      h.tag === tag &&
      (h.kind === "console.error" || h.kind === "pageerror" || h.kind === "requestfailed" || /^http\.(4|5)/.test(h.kind)),
  );
}

function assertStateClean(tag) {
  const issues = hygieneIssues(tag);
  assert(issues.length === 0, `console/network issues in ${tag}: ${issues.map((i) => `${i.kind}: ${i.text}`).join(" | ")}`);
  return "zero console errors/warnings-class page issues";
}

async function assertChipsMatchScores(page, photos, label) {
  const chips = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".tile")).map((t) => ({
      name: t.querySelector(".tile__filename")?.textContent.trim() ?? null,
      num: t.querySelector(".chip__num")?.textContent.trim() ?? null,
      bandCls: Array.from(t.querySelector(".chip")?.classList ?? []).find((c) => c.startsWith("chip--")) ?? null,
    })),
  );
  assert(chips.length === photos.length, `${label}: ${chips.length} rendered tiles vs ${photos.length} store photos`);
  for (const p of photos) {
    const c = chips.find((x) => x.name === p.name);
    assert(c, `${label}: no tile rendered for "${p.name}"`);
    // R4 re-scope (2026-11-06): chip format is NN% sharp per design-spec-v2 §11.2.
    assert(c.num === `${p.score}% sharp`, `${label}: chip for "${p.name}" shows "${c.num}", expected "${p.score}% sharp"`);
    assert(c.bandCls === `chip--${p.band}`, `${label}: chip class for "${p.name}" is ${c.bandCls}, expected chip--${p.band}`);
  }
  return chips.map((c) => `${c.name}=${c.num}(${c.bandCls})`).join(", ");
}

/** Every visible interactive element, measured. */
async function interactiveSweep(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return Array.from(document.querySelectorAll("button, a[href], input, select, textarea, [role='button']"))
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          name: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
          disabled: !!el.disabled,
          cls: typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 2).join(".") : "",
        };
      });
  });
}

/** Coarse-pointer rule (§6): every visible interactive control ≥44×44 CSS px. */
async function assertAllInteractive44(page, label) {
  const items = await interactiveSweep(page);
  assert(items.length > 0, `${label}: no visible interactive elements found`);
  const violations = items.filter((i) => i.w < 44 || i.h < 44);
  assert(
    violations.length === 0,
    `${label}: ${violations.length}/${items.length} interactive controls under 44x44 — ${JSON.stringify(violations.slice(0, 8))}`,
  );
  const minW = Math.min(...items.map((i) => i.w));
  const minH = Math.min(...items.map((i) => i.h));
  return `${items.length} controls, min ${minW}x${minH}`;
}

/** Fine-pointer density probe (§6 table). */
async function densityProbe(page) {
  return page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { minH: cs.minHeight, h: Math.round(r.height), display: cs.display };
    };
    return {
      hero: g(".btn-hero"),
      primary: g(".action-bar__actions .btn-primary"),
      secondary: g(".action-bar__actions .btn-secondary"),
      bandToggle: g(".band__toggle"),
      tileMeta: g(".tile__meta-btn"),
      compactSummary: g(".notice__summary"),
    };
  });
}

function assertFineDensity(d, label) {
  const want = [
    ["primary", "36px"],
    ["secondary", "36px"],
    ["bandToggle", "32px"],
    ["tileMeta", "32px"],
    ["compactSummary", "32px"],
  ];
  for (const [key, minH] of want) {
    assert(d[key], `${label}: ${key} not present for density measurement`);
    assert(d[key].minH === minH, `${label}: ${key} min-height ${d[key].minH}, expected ${minH} (§6 density table)`);
  }
  return `primary/secondary 36px; band toggle/tile meta/notice summary 32px`;
}

/* ------------------------------------------------------------------ */
/* R3-1 — full user journey                                            */
/* ------------------------------------------------------------------ */

async function stateR3_1({ page, context }) {
  await context.addInitScript(REVOKE_SPY);
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  /* empty */
  await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });
  await page.getByRole("heading", { name: "Find the blurry photos", exact: true }).waitFor({ state: "visible", timeout: STEP_TIMEOUT });
  await page.getByRole("button", { name: "Choose photos", exact: true }).waitFor({ state: "visible", timeout: STEP_TIMEOUT });
  await shot(page, "01-empty.png");

  /* analyzing — recorder installed before the pick */
  await installProgressRecorder(page);
  await chooseFiles(page, "Choose photos", FOUR);
  await shot(page, "02-analyzing.png").catch(() => {});
  await waitForResolved(page, 4);
  await waitForResults(page);
  const prog = await readProgressSamples(page);
  const good = prog.find(
    (s) => s.role === "progressbar" && s.painted && s.heading === "Analyzing photos" && /^\d+ of 4$/.test(s.status || ""),
  );
  assert(prog.length >= 1, "analyzing state: progress card was never observed during the 4-photo batch");
  assert(
    good,
    `analyzing state: no sample matched (role=progressbar, painted, "Analyzing photos", "N of 4") — samples ${JSON.stringify(prog.slice(0, 4))}`,
  );
  assert(Number(good.valueMax) === 4, `analyzing state: aria-valuemax ${good.valueMax}, expected 4`);
  const cardGone = await page.evaluate(() => !document.querySelector(".progress-card"));
  assert(cardGone, "analyzing state: progress card still present after results rendered");

  /* grouped results: bands + counts + chips */
  await waitSummary(page, "0 selected · 4 total");
  const bands = await page.$$eval("[data-band]", (els) =>
    els.map((el) => ({
      band: el.getAttribute("data-band"),
      count: el.querySelector(".band__count")?.textContent.trim() ?? null,
      tiles: el.querySelectorAll(".tile").length,
      text: el.textContent.replace(/\s+/g, " ").trim().slice(0, 140),
      hasToggle: !!el.querySelector(".band__toggle"),
    })),
  );
  assert(
    JSON.stringify(bands.map((b) => b.band)) === JSON.stringify(["blurry", "review", "sharp"]),
    `results band order is ${JSON.stringify(bands.map((b) => b.band))}, expected blurry, review, sharp`,
  );
  const blurry = bands[0];
  const review = bands[1];
  const sharp = bands[2];
  assert(blurry.tiles === 2 && blurry.count === "2 photos", `blurry band: ${JSON.stringify(blurry)}`);
  assert(sharp.tiles === 2 && sharp.count === "2 photos", `sharp band: ${JSON.stringify(sharp)}`);
  assert(review.tiles === 0 && /No photos in this band/.test(review.text) && !review.hasToggle, `review band: ${JSON.stringify(review)}`);
  const store = await debugState(page);
  const bandCounts = (id) => store.photos.filter((p) => p.band === id).length;
  assert(bandCounts("blurry") === 2 && bandCounts("sharp") === 2 && bandCounts("review") === 0, `store bands ${JSON.stringify(store.photos.map((p) => [p.name, p.band]))}`);
  const chipEvidence = await assertChipsMatchScores(page, store.photos, "R3-1");
  await page.waitForFunction(() => /analysis complete|added 4 photo/i.test(document.querySelector("#live-region")?.textContent || ""), null, { timeout: STEP_TIMEOUT, polling: 50 });
  await shot(page, "03-results.png");

  /* select 2 (one per band). Uses the module-level photoButton helper —
     R6 re-scope (2026-11-06, design-spec-v2 §11.5.5): a Blurry tile's
     accessible name ends with ", suggested for deletion". */
  const selNames = [FIXTURES[0].name, FIXTURES[2].name];
  for (const n of selNames) {
    await photoButton(page, n).click({ timeout: STEP_TIMEOUT });
  }
  await waitSummary(page, "2 selected · 4 total");
  const pressed = await page.evaluate(
    (names) =>
      names.map((n) => {
        // R6 §11.5.5: a Blurry tile's aria-label carries the recommendation
        // suffix — try the bare name first, then the suffixed form.
        const el =
          document.querySelector(`button[aria-label="${n}"]`) ??
          document.querySelector(`button[aria-label="${n}, suggested for deletion"]`);
        return el?.getAttribute("aria-pressed");
      }),
    selNames,
  );
  assert(JSON.stringify(pressed) === JSON.stringify(["true", "true"]), `aria-pressed after select: ${JSON.stringify(pressed)}`);
  await shot(page, "04-selected.png");

  /* download selected: 2 byte-identical downloads + busy state + announcements */
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  await installBusyRecorder(page);
  await page.getByRole("button", { name: "Download selected", exact: true }).click({ timeout: STEP_TIMEOUT });
  // v0.3.0 re-scope: Download selected opens the export chooser (Original /
  // PNG / JPEG / WebP) � pick Original (the byte-identical v0.1 behavior).
  await page.getByRole("button", { name: /^Original/ }).click();
  await shot(page, "05-download-busy.png").catch(() => {});
  const twoArrived = await pollUntil(() => Promise.resolve(downloads.length >= 2), DOWNLOAD_TIMEOUT);
  assert(twoArrived, `download: only ${downloads.length} download event(s) arrived within ${DOWNLOAD_TIMEOUT}ms`);
  await sleep(400); // let the second download settle before asserting exact count
  const dlEvidence = await assertDownloadsByteIdentical(downloads, "R3-1");
  const busy = await readBusy(page);
  assert(busy.labels.some((l) => l.startsWith("Preparing")), `download busy: label transitions ${JSON.stringify(busy.labels)} — no "Preparing…"`);
  assert(busy.labels[busy.labels.length - 1] === "Download selected", `download busy: final label "${busy.labels[busy.labels.length - 1]}"`);
  assert(busy.spinner === true, "download busy: spinner never became visible");
  await page.waitForFunction(() => (document.querySelector("#live-region")?.textContent || "").trim() === "Saved 2 photos", null, { timeout: STEP_TIMEOUT, polling: 50 });

  /* detail open → navigate → close (Escape) → focus return */
  const openName = FIXTURES[0].name;
  await page.getByRole("button", { name: `View ${openName}`, exact: true }).click({ timeout: STEP_TIMEOUT });
  await page.waitForSelector(".detail__panel", { state: "visible", timeout: STEP_TIMEOUT });
  await page.waitForFunction((n) => document.querySelector(".detail__filename")?.textContent === n, openName, { timeout: STEP_TIMEOUT, polling: 50 });
  const panelLabel = await page.getAttribute(".detail__panel", "aria-label");
  assert(panelLabel === `Reviewing ${openName}`, `detail panel aria-label "${panelLabel}", expected "Reviewing ${openName}"`);
  await shot(page, "06-detail.png");
  await page.getByRole("button", { name: "Next photo", exact: true }).click({ timeout: STEP_TIMEOUT });
  await page.waitForFunction((n) => document.querySelector(".detail__filename")?.textContent === n, FIXTURES[1].name, { timeout: STEP_TIMEOUT, polling: 50 });
  const nextDisabled = await page.getByRole("button", { name: "Next photo", exact: true }).isDisabled();
  assert(nextDisabled, "detail navigate: Next photo not disabled at the last photo of the band");
  await page.getByRole("button", { name: "Previous photo", exact: true }).click({ timeout: STEP_TIMEOUT });
  await page.waitForFunction((n) => document.querySelector(".detail__filename")?.textContent === n, openName, { timeout: STEP_TIMEOUT, polling: 50 });
  const prevDisabled = await page.getByRole("button", { name: "Previous photo", exact: true }).isDisabled();
  assert(prevDisabled, "detail navigate: Previous photo not disabled at the first photo of the band");
  await page.keyboard.press("Escape");
  await waitDetailClosed(page);
  await page.waitForFunction((n) => document.activeElement?.getAttribute("aria-label") === n, `View ${openName}`, { timeout: STEP_TIMEOUT, polling: 50 });

  /* start over: native confirm accepted + every object URL revoked */
  await page.locator("#start-over-btn").click({ timeout: STEP_TIMEOUT });
  await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });
  await page.getByRole("heading", { name: "Find the blurry photos", exact: true }).waitFor({ state: "visible", timeout: STEP_TIMEOUT });
  const dlg = dialogs.filter((d) => d.tag === currentTag).pop();
  assert(dlg && dlg.type === "confirm", `start over: confirm dialog not observed (${JSON.stringify(dlg)})`);
  assert(/^Start over\?/.test(dlg.message), `start over: dialog message "${dlg.message}"`);
  const after = await debugState(page);
  assert(after.photos.length === 0, `start over: store still holds ${after.photos.length} photos`);
  const revoked = await page.evaluate(() => window.__revokeLog || []);
  assert(revoked.length >= 4 && revoked.every((u) => u.startsWith("blob:")), `start over: revoke log ${JSON.stringify(revoked)}`);
  await shot(page, "07-restarted.png");
  assertStateClean(currentTag);

  return `journey PASS — analyzing card observed (${prog.length} sample(s), "N of 4", valueMax 4); bands blurry/review/sharp = 2/0/2; chips ${chipEvidence}; 2 downloads byte-identical (${dlEvidence}); busy "Preparing…"+spinner; detail nav + Escape + focus return; start over confirmed, ${revoked.length} blob URLs revoked; ${assertStateClean(currentTag)}`;
}

/* ------------------------------------------------------------------ */
/* R3-2 — visual tokens (programmatic)                                 */
/* ------------------------------------------------------------------ */

async function stateR3_2({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });

  /* page surface + meta */
  const surface = await page.evaluate(() => {
    const body = getComputedStyle(document.body).backgroundColor;
    const html = getComputedStyle(document.documentElement).backgroundColor;
    return {
      body,
      html,
      themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null,
    };
  });
  assert(surface.body === V2.bg, `body background ${surface.body}, expected ${V2.bg} (§4.1 --color-bg)`);
  assert(surface.themeColor === "#F2F3F5", `theme-color meta "${surface.themeColor}", expected #F2F3F5 (§4.8)`);

  /* accent fill on the hero primary */
  const heroFill = await page.evaluate(() => getComputedStyle(document.querySelector(".btn-hero")).backgroundColor);
  assert(heroFill === V2.accent, `hero fill ${heroFill}, expected ${V2.accent} (§4.2 --color-accent)`);
  const heroRadius = await page.evaluate(() => getComputedStyle(document.querySelector(".btn-hero")).borderRadius);
  assert(heroRadius === "12px", `hero radius ${heroRadius}, expected 12px (§4.6 --radius-md)`);

  /* focus ring on light: 2px accent, offset 2 */
  let ctaRing = null;
  for (let i = 0; i < 10 && !ctaRing; i += 1) {
    const s = await tabStop(page);
    if (s.name === "Choose photos") ctaRing = s;
  }
  assert(ctaRing, "keyboard: Tab never reached the hero CTA");
  assert(ringProblem(ctaRing) === null, `light focus ring problem: ${ringProblem(ctaRing)} (${JSON.stringify(ctaRing)})`);
  assert(ctaRing.outlineColor === V2.accent, `light focus ring color ${ctaRing.outlineColor}, expected ${V2.accent} (§4.2)`);
  assert(ctaRing.outlineWidth === "2px" && ctaRing.outlineOffset === "2px", `light focus ring ${ctaRing.outlineWidth}/${ctaRing.outlineOffset}, expected 2px/2px`);
  await shot(page, "08-tokens-empty.png");

  /* results + notice (4 valid + 1 undecodable) */
  await chooseFiles(page, "Choose photos", [...FOUR, asInput(TXT_FIXTURE)]);
  await waitForResolved(page, 4);
  await waitForResults(page);
  await page.waitForSelector(".notice", { state: "visible", timeout: 8000 });

  /* select one tile so the check badge (full radius) and enabled primary exist */
  await photoButton(page, FIXTURES[1].name).click({ timeout: STEP_TIMEOUT });
  await waitSummary(page, "1 selected · 4 total");
  /* the primary fill has a background-color transition from the disabled
     (surface-muted) fill — wait for the settled enabled accent value. */
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector(".action-bar__actions .btn-primary")).backgroundColor === "rgb(46, 92, 149)",
    null,
    { timeout: STEP_TIMEOUT, polling: 25 },
  );

  /* radii: tokens exact + rendered set in the spec set, all four token values in use */
  const tokenRadii = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      sm: cs.getPropertyValue("--radius-sm").trim(),
      md: cs.getPropertyValue("--radius-md").trim(),
      lg: cs.getPropertyValue("--radius-lg").trim(),
      full: cs.getPropertyValue("--radius-full").trim(),
    };
  });
  assert(tokenRadii.sm === "8px" && tokenRadii.md === "12px" && tokenRadii.lg === "18px" && tokenRadii.full === "999px", `§4.6 radius tokens ${JSON.stringify(tokenRadii)}`);
  const radii = await page.evaluate(() => {
    const vals = {};
    for (const el of document.body.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      for (const c of [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]) {
        if (c && c !== "0px") vals[c] = (vals[c] || 0) + 1;
      }
    }
    return vals;
  });
  const allowed = new Set(["4px", "8px", "12px", "18px", "999px", "50%"]); // 4px = nested floor (§4.6)
  const bad = Object.keys(radii).filter((r) => !allowed.has(r));
  assert(bad.length === 0, `rendered radii outside the §4.6 set: ${JSON.stringify(bad)} (all: ${JSON.stringify(radii)})`);
  assert(radii["8px"] && radii["12px"] && radii["18px"], `rendered value set must include 8/12/18px (${JSON.stringify(radii)})`);
  assert(radii["999px"] || radii["50%"], `no full-radius element rendered (${JSON.stringify(radii)})`);
  const bandChipRadius = await page.evaluate(() => getComputedStyle(document.querySelector(".band-chip")).borderRadius);
  assert(bandChipRadius === "8px", `band chip radius ${bandChipRadius}, expected 8px (§4.6 small controls)`);
  const primaryFill = await page.evaluate(() => getComputedStyle(document.querySelector(".action-bar__actions .btn-primary")).backgroundColor);
  assert(primaryFill === V2.accent, `enabled primary fill ${primaryFill}, expected ${V2.accent}`);
  await shot(page, "09-tokens-results.png");

  /* focus ring on stage: white 2px inside the detail dialog */
  await page.getByRole("button", { name: `View ${FIXTURES[1].name}`, exact: true }).click({ timeout: STEP_TIMEOUT });
  await page.waitForSelector(".detail__panel", { state: "visible", timeout: STEP_TIMEOUT });
  let stageRing = null;
  for (let i = 0; i < 10 && !stageRing; i += 1) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return {
        inPanel: !!el.closest && !!el.closest(".detail__panel"),
        name: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40),
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
      };
    });
    if (s.inPanel && s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2) stageRing = s;
  }
  assert(stageRing, "stage focus ring: no focused panel control with a visible outline found in 10 Tab stops");
  assert(stageRing.outlineColor === "rgb(255, 255, 255)", `stage focus ring color ${stageRing.outlineColor}, expected white (§4.4 --color-stage-text)`);
  assert(stageRing.outlineWidth === "2px", `stage focus ring width ${stageRing.outlineWidth}, expected 2px`);
  await shot(page, "10-stage-focus.png");
  await page.keyboard.press("Escape");
  await waitDetailClosed(page);
  assertStateClean(currentTag);

  return `tokens PASS — body ${surface.body}; theme-color ${surface.themeColor}; hero fill ${heroFill}; light ring ${ctaRing.outlineWidth} ${ctaRing.outlineColor} offset ${ctaRing.outlineOffset}; stage ring ${stageRing.outlineWidth} ${stageRing.outlineColor}; radius tokens ${JSON.stringify(tokenRadii)}; rendered radii ${JSON.stringify(radii)}`;
}

/* ------------------------------------------------------------------ */
/* R3-3 — scoring identity through the real picker                     */
/* ------------------------------------------------------------------ */

async function stateR3_3({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });

  const assertExact = (run, label) => {
    assert(run.length === 4, `${label}: ${run.length} scored photos, expected 4 (${JSON.stringify(run)})`);
    for (const f of FIXTURES) {
      const got = run.find((p) => p.name === f.name);
      assert(got, `${label}: "${f.name}" missing`);
      assert(got.score === f.score && got.band === f.band, `${label}: "${f.name}" scored ${got.score}/${got.band}, expected ${f.score}/${f.band}`);
    }
  };

  /* run 1 */
  await chooseFiles(page, "Choose photos", FOUR);
  await waitForResolved(page, 4);
  await waitForResults(page);
  const run1 = await readScores(page);
  assertExact(run1, "run 1");
  const chipEvidence = await assertChipsMatchScores(page, run1, "run 1");
  await shot(page, "11-scoring-run1.png");

  /* run 2: start over, re-pick the same batch */
  await page.locator("#start-over-btn").click({ timeout: STEP_TIMEOUT });
  await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });
  await chooseFiles(page, "Choose photos", FOUR);
  await waitForResolved(page, 4);
  await waitForResults(page);
  const run2 = await readScores(page);
  assertExact(run2, "run 2");
  const sorted = (run) => JSON.stringify([...run].sort((a, b) => a.name.localeCompare(b.name)));
  assert(sorted(run2) === sorted(run1), `scores not byte-identical across runs:\nrun1 ${sorted(run1)}\nrun2 ${sorted(run2)}`);
  await shot(page, "12-scoring-run2.png");
  assertStateClean(currentTag);

  return `scoring PASS — run1 ${run1.map((p) => `${p.name}=${p.score}/${p.band}`).join(", ")}; run2 byte-identical; chips ${chipEvidence}`;
}

/* ------------------------------------------------------------------ */
/* R3-4 — pointer-gated density                                        */
/* ------------------------------------------------------------------ */

const DENSITY_CONFIGS = [
  {
    label: "coarse-375",
    options: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true },
    coarse: true,
    sweep: true,
    fine: false,
  },
  {
    label: "coarse-810",
    options: { ...devices["iPad (gen 7)"] },
    coarse: true,
    sweep: true,
    fine: false,
    tabletNav: true,
  },
  {
    label: "fine-768",
    options: { viewport: { width: 768, height: 1024 } },
    coarse: false,
    sweep: false,
    fine: true,
  },
  {
    label: "fine-1280",
    options: { viewport: { width: 1280, height: 800 } },
    coarse: false,
    sweep: false,
    fine: true,
  },
];

async function stateR3_4({ page: _unused }) {
  const evidence = [];
  for (const cfg of DENSITY_CONFIGS) {
    const tag = `${currentTag}/${cfg.label}`;
    const context = await browser.newContext({ acceptDownloads: true, ...cfg.options });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    wirePage(page, tag);
    try {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });
      const media = await page.evaluate(() => ({
        coarse: matchMedia("(pointer: coarse)").matches,
        fine: matchMedia("(pointer: fine)").matches,
        touch: "ontouchstart" in window || navigator.maxTouchPoints > 0,
      }));
      assert(media.coarse === cfg.coarse, `${cfg.label}: pointer coarse=${media.coarse}, expected ${cfg.coarse} (${JSON.stringify(media)})`);

      /* hero CTA stays 48px everywhere */
      const hero = await page.evaluate(() => {
        const el = document.querySelector(".btn-hero");
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
      assert(hero.h === 48, `${cfg.label}: hero CTA height ${hero.h}, expected 48px (§6 "hero keeps 48px at every breakpoint")`);

      if (cfg.sweep) evidence.push(`${cfg.label} empty: ${await assertAllInteractive44(page, `${cfg.label} empty`)}`);

      /* 4 valid + 1 undecodable → same batch: notice card, results, action bar */
      await chooseFiles(page, "Choose photos", [...FOUR, asInput(TXT_FIXTURE)]);
      await waitForResolved(page, 4);
      await waitForResults(page);
      await page.waitForSelector(".notice", { state: "visible", timeout: 8000 });

      if (cfg.sweep) evidence.push(`${cfg.label} results: ${await assertAllInteractive44(page, `${cfg.label} results`)}`);
      if (cfg.fine) {
        const d = await densityProbe(page);
        evidence.push(`${cfg.label} results: ${assertFineDensity(d, cfg.label)}`);
      }

      /* detail: coarse 375 keeps ≥44 in the sheet; tablet chevrons are 44×44 */
      await page.locator(".tile").first().locator(".tile__meta-btn").click({ timeout: STEP_TIMEOUT });
      await page.waitForSelector(".detail__panel", { state: "visible", timeout: STEP_TIMEOUT });
      /* the desktop modal plays modal-pop (a scale animation) — measuring
         mid-animation gives ~43.5px boxes; wait for it to settle first. */
      await page.waitForFunction(
        () => {
          const p = document.querySelector(".detail__panel");
          return !p || p.getAnimations().every((a) => a.playState !== "running");
        },
        null,
        { timeout: STEP_TIMEOUT, polling: 50 },
      );
      if (cfg.sweep) evidence.push(`${cfg.label} detail: ${await assertAllInteractive44(page, `${cfg.label} detail`)}`);
      if (cfg.tabletNav) {
        const nav = await page.evaluate(() => {
          const el = document.querySelector(".detail__nav--next");
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display };
        });
        assert(nav && nav.display !== "none" && nav.w >= 44 && nav.h >= 44, `${cfg.label}: detail chevron ${JSON.stringify(nav)}, expected ≥44x44 (§6):`);
        evidence.push(`${cfg.label} detail chevron ${nav.w}x${nav.h}`);
      }
      await page.keyboard.press("Escape");
      await waitDetailClosed(page);
      await shot(page, `13-density-${cfg.label}.png`);
      assertStateClean(tag);
    } finally {
      try { await context.close(); } catch { /* ignore */ }
    }
  }
  return `density PASS — hero 48px at all four contexts; ${evidence.join("; ")}`;
}

/* ------------------------------------------------------------------ */
/* R3-5 — reduced motion                                               */
/* ------------------------------------------------------------------ */

const hintState = (pg) =>
  pg.evaluate(() => {
    const el = document.querySelector(".empty-state__drop-hint");
    if (!el) return { exists: false, display: null, text: null, visible: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      exists: true,
      display: cs.display,
      text: el.textContent.trim(),
      visible: r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden",
    };
  });

async function stateR3_5({ page: _unused }) {
  const evidence = [];

  /* reduced-motion context */
  {
    const tag = `${currentTag}/reduce`;
    const context = await browser.newContext({ viewport: DESKTOP, reducedMotion: "reduce", acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    wirePage(page, tag);
    try {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      const media = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
      assert(media, "reduced-motion: context does not report prefers-reduced-motion: reduce");
      await chooseFiles(page, "Choose photos", FOUR);
      await waitForResolved(page, 4);
      await waitForResults(page);

      const rm = await page.evaluate(() => {
        const els = [...document.querySelectorAll(".band--reveal"), ...document.querySelectorAll(".band--reveal .tile")];
        return els.map((el) => {
          const cs = getComputedStyle(el);
          return {
            label: `${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 2).join(".")}`,
            animationName: cs.animationName,
            animationDelay: cs.animationDelay,
            opacity: cs.opacity,
            transform: cs.transform,
            running: el.getAnimations().length,
          };
        });
      });
      assert(rm.length === 7, `reduced-motion: found ${rm.length} .band--reveal elements/tiles, expected 7 (3 bands + 4 tiles)`);
      const bad = rm.filter(
        (s) => s.animationName !== "none" || s.animationDelay !== "0s" || s.opacity !== "1" || s.transform !== "none" || s.running !== 0,
      );
      assert(bad.length === 0, `reduced-motion: band reveal not disabled on ${bad.length}/7 — ${JSON.stringify(bad.slice(0, 3))}`);

      const durations = await page.evaluate(() => {
        const p = document.querySelector(".tile__photo");
        const b = document.querySelector(".band__toggle");
        return { tilePhoto: getComputedStyle(p).transitionDuration, bandToggle: getComputedStyle(b).transitionDuration };
      });
      assert(
        durations.tilePhoto === "0.001s" && durations.bandToggle === "0.001s",
        `reduced-motion: transition durations ${JSON.stringify(durations)}, expected 1ms (0.001s)`,
      );

      /* sheet rise / modal pop disabled on the detail panel */
      await page.locator(".tile").first().locator(".tile__meta-btn").click({ timeout: STEP_TIMEOUT });
      await page.waitForSelector(".detail__panel", { state: "visible", timeout: STEP_TIMEOUT });
      const panel = await page.evaluate(() => {
        const p = document.querySelector(".detail__panel");
        const cs = getComputedStyle(p);
        return { animationName: cs.animationName, animationDelay: cs.animationDelay, running: p.getAnimations().length };
      });
      assert(
        panel.animationName === "none" && panel.animationDelay === "0s" && panel.running === 0,
        `reduced-motion: detail panel ${JSON.stringify(panel)}, expected animation none / delay 0s / no running animations`,
      );
      await page.keyboard.press("Escape");
      await waitDetailClosed(page);
      await shot(page, "17-reduced-motion.png");
      evidence.push(`reduce: 7/7 reveal elements none/0s/opacity1/no transform; transitions ${durations.tilePhoto}; panel animation ${panel.animationName}`);
      assertStateClean(tag);
    } finally {
      try { await context.close(); } catch { /* ignore */ }
    }
  }

  /* normal-motion context: prove the reveal exists (so its disabling is real) */
  {
    const tag = `${currentTag}/normal`;
    const context = await browser.newContext({ viewport: DESKTOP, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    wirePage(page, tag);
    try {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await chooseFiles(page, "Choose photos", FOUR);
      await waitForResolved(page, 4);
      await waitForResults(page);
      const nm = await page.evaluate(() => {
        const sections = [...document.querySelectorAll(".band--reveal")].map((el) => getComputedStyle(el).animationName);
        const tileDelays = [...document.querySelectorAll(".band--reveal .tile")].map((el) => getComputedStyle(el).animationDelay);
        const tileDuration = getComputedStyle(document.querySelector(".band--reveal .tile")).animationDuration;
        return { sections, tileDelays, tileDuration };
      });
      assert(nm.sections.length === 3 && nm.sections.every((n) => n === "band-reveal"), `normal-motion: section animation names ${JSON.stringify(nm.sections)}`);
      assert(nm.tileDelays.some((d) => parseFloat(d) > 0), `normal-motion: no stagger delay on any tile (${JSON.stringify(nm.tileDelays)})`);
      assert(nm.tileDuration === "0.32s", `normal-motion: tile animation duration ${nm.tileDuration}, expected 0.32s (_duration-slow)`);
      await shot(page, "18-normal-motion.png");
      evidence.push(`normal: sections ${JSON.stringify(nm.sections)}, tile delays ${JSON.stringify(nm.tileDelays)}`);
      assertStateClean(tag);
    } finally {
      try { await context.close(); } catch { /* ignore */ }
    }
  }
  return `reduced motion PASS — ${evidence.join("; ")}`;
}

/* ------------------------------------------------------------------ */
/* R3-6 — drop-hint pointer gating                                     */
/* ------------------------------------------------------------------ */

async function stateR3_6({ page: _unused }) {
  const evidence = [];

  /* coarse 375: hidden in the empty state AND the all-failed state */
  {
    const tag = `${currentTag}/coarse`;
    const context = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    wirePage(page, tag);
    try {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });
      const media = await page.evaluate(() => ({ hoverNone: matchMedia("(hover: none)").matches, coarse: matchMedia("(pointer: coarse)").matches }));
      assert(media.coarse, `drop hint coarse context: pointer coarse=${media.coarse}`);
      const empty = await hintState(page);
      assert(!empty.visible && (empty.display === "none" || !empty.exists), `drop hint empty/coarse: visible=${empty.visible} display=${empty.display}`);
      await shot(page, "19-hint-coarse-empty.png");

      await chooseFiles(page, "Choose photos", [asInput(TXT_FIXTURE)]);
      await page.getByRole("heading", { name: "Couldn't open those files", exact: true }).waitFor({ state: "visible", timeout: STEP_TIMEOUT });
      const failed = await hintState(page);
      assert(!failed.visible && (failed.display === "none" || !failed.exists), `drop hint all-failed/coarse: visible=${failed.visible} display=${failed.display}`);
      await shot(page, "20-hint-coarse-allfailed.png");
      evidence.push(`coarse 375 (hook:none=${media.hoverNone}): empty ${empty.exists ? empty.display : "absent"}, all-failed ${failed.exists ? failed.display : "absent"}`);
      assertStateClean(tag);
    } finally {
      try { await context.close(); } catch { /* ignore */ }
    }
  }

  /* desktop fine: visible with the exact copy */
  {
    const tag = `${currentTag}/desktop`;
    const context = await browser.newContext({ viewport: DESKTOP, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    wirePage(page, tag);
    try {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });
      const hint = await hintState(page);
      assert(hint.exists && hint.visible, `drop hint desktop: ${JSON.stringify(hint)}`);
      assert(hint.text === "or drop photos here", `drop hint desktop text "${hint.text}"`);
      await shot(page, "21-hint-desktop.png");
      evidence.push(`desktop 1280: visible, "${hint.text}"`);
      assertStateClean(tag);
    } finally {
      try { await context.close(); } catch { /* ignore */ }
    }
  }
  return `drop hint PASS — ${evidence.join("; ")}`;
}

/* ------------------------------------------------------------------ */
/* R3-7 — keyboard-only core flow                                      */
/* ------------------------------------------------------------------ */

async function stateR3_7({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });

  /* Tab to the CTA (keyboard only) */
  const emptyTrail = [];
  let cta = null;
  for (let i = 0; i < 12 && !cta; i += 1) {
    const s = await tabStop(page);
    emptyTrail.push(s.name || s.tag);
    if (s.name === "Choose photos") cta = s;
  }
  assert(cta, `keyboard: Tab never reached "Choose photos" (trail ${JSON.stringify(emptyTrail)})`);
  assert(ringProblem(cta) === null, `keyboard CTA ring: ${ringProblem(cta)} (${JSON.stringify(cta)})`);
  await shot(page, "22-kb-cta.png");

  /* Enter opens the real picker; chooser.setFiles substitutes the OS dialog
     (browser security prevents typing into the native dialog). */
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: STEP_TIMEOUT }),
    page.keyboard.press("Enter"),
  ]);
  await chooser.setFiles(FOUR, { timeout: 120000 });
  await waitForResolved(page, 4);
  await waitForResults(page);

  /* Tab walk: band toggles → tiles (Enter toggles) → action bar → Enter download → Enter detail → Escape */
  const stops = [];
  const ringViolations = [];
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  const tileNames = FIXTURES.map((f) => f.name);
  let bandToggles = 0;
  let tilesToggled = 0;
  let downloadPressed = false;
  let detailChecked = false;
  // R5 adjudication (documented): pressing Enter on "Download selected"
  // disables the focused button while busy, and Chrome drops focus to BODY
  // (the app's own #setDisabled comment documents this exact behavior for
  // in-dialog controls; the action bar's busy disable predates v2). The
  // sequential-focus-navigation starting point then stays at that
  // end-of-document button, so the FIRST Tab after the download may land on
  // BODY before wrapping back into the document ("Start over"). This stop
  // is a browser focus artifact of the busy disable — not a keyboard-
  // reachability failure — and it occurs with the v2 action bar unchanged
  // (verified: the identical BODY stop reproduces with the R5 "Save HD
  // copies" entry removed). The walk therefore allows exactly ONE BODY
  // stop immediately after the download Enter; every other BODY stop, and
  // every control stop, still fails the ring check as before.
  let expectFocusDropStop = false;

  for (let i = 0; i < 160 && !(downloads.length >= 2 && detailChecked); i += 1) {
    const s = await tabStop(page); // (fix: the walk previously dropped the page arg — tabStop threw on undefined)
    stops.push(s.name || s.tag);
    const problem = ringProblem(s);
    if (problem && expectFocusDropStop && s.tag === "BODY") {
      expectFocusDropStop = false; // the one documented artifact — skipped
    } else {
      if (problem) ringViolations.push(`${s.name || s.tag}: ${problem}`);
      expectFocusDropStop = false;
    }

    if (/^(Select all|Deselect)$/.test(s.name)) { bandToggles += 1; continue; }
    if (tileNames.includes(s.name)) {
      if (tilesToggled < 2) {
        await page.keyboard.press("Enter");
        tilesToggled += 1;
        await waitSummary(page, `${tilesToggled} selected · 4 total`);
      }
      continue;
    }
    if (s.name === "Add more" || s.name === "Start over") continue;
    if (s.name === "Download selected") {
      if (tilesToggled === 2 && !downloadPressed) {
        const disabled = await page.evaluate(() => {
          const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Download selected");
          return !b || b.disabled;
        });
        assert(!disabled, "keyboard: Download selected is disabled although 2 tiles are selected");
        downloadPressed = true;
        expectFocusDropStop = true; // see the R5 adjudication note above
        await page.keyboard.press("Enter");
        // v0.3.0: the export chooser opens — focus lands on its first
        // option (Original); Enter activates it and the downloads run.
        await page.waitForSelector(".confirm__panel", { timeout: STEP_TIMEOUT });
        await page.keyboard.press("Enter");
        const ok = await pollUntil(() => Promise.resolve(downloads.length >= 2), DOWNLOAD_TIMEOUT);
        assert(ok, `keyboard download: only ${downloads.length} download(s) arrived within ${DOWNLOAD_TIMEOUT}ms`);
      }
      continue;
    }
    if (/^View /.test(s.name) && downloadPressed && !detailChecked) {
      const viewName = s.name.slice(5);
      detailChecked = true;
      await page.keyboard.press("Enter");
      await page.waitForSelector(".detail__panel", { state: "visible", timeout: STEP_TIMEOUT });
      await page.waitForFunction((n) => document.querySelector(".detail__filename")?.textContent === n, viewName, { timeout: STEP_TIMEOUT, polling: 50 });
      await shot(page, "24-kb-detail.png");
      await page.keyboard.press("Escape");
      await waitDetailClosed(page);
      await page.waitForFunction((n) => document.activeElement?.getAttribute("aria-label") === n, s.name, { timeout: STEP_TIMEOUT, polling: 50 });
      continue;
    }
  }

  assert(bandToggles >= 1, `keyboard: no band toggle stop during the walk (${JSON.stringify(stops.slice(0, 30))})`);
  assert(tilesToggled === 2, `keyboard: ${tilesToggled} tiles toggled via Enter, expected 2`);
  assert(downloadPressed, `keyboard: never reached/entered "Download selected" (${stops.length} stops)`);
  await sleep(300);
  assert(downloads.length === 2, `keyboard download: ${downloads.length} download events, expected 2`);
  const dlEvidence = await assertDownloadsByteIdentical(downloads, "R3-7 keyboard");
  assert(detailChecked, "keyboard: never opened the detail view via Enter during the walk");
  assert(ringViolations.length === 0, `keyboard: ${ringViolations.length} stop(s) without a visible ring — ${JSON.stringify(ringViolations.slice(0, 8))}`);
  await shot(page, "23-kb-selected.png").catch(() => {});
  assertStateClean(currentTag);

  return `keyboard PASS — ${stops.length} Tab stops (band toggles ${bandToggles}; 2 tiles Enter-toggled; Download selected Enter; View Enter + Escape focus return); every stop had a ≥2px focus ring; 2 downloads byte-identical (${dlEvidence})`;
}

/* ------------------------------------------------------------------ */
/* R3-8 — hygiene + responsiveness                                     */
/* ------------------------------------------------------------------ */

async function stateR3_8({ page: _unused }) {
  const overflow = [];
  for (const width of [375, 768, 1280]) {
    const tag = `${currentTag}/w${width}`;
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 800 }, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    wirePage(page, tag);
    try {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page.waitForSelector(".empty-state", { timeout: STEP_TIMEOUT });
      let d = await overflowPx(page);
      assert(d <= 1, `${width}px empty state: horizontal overflow ${d}px`);
      overflow.push(`${width}px empty ${d}px`);

      await chooseFiles(page, "Choose photos", FOUR);
      await waitForResolved(page, 4);
      await waitForResults(page);
      d = await overflowPx(page);
      assert(d <= 1, `${width}px results: horizontal overflow ${d}px`);
      overflow.push(`results ${d}px`);

      await page.locator(".tile").first().locator(".tile__meta-btn").click({ timeout: STEP_TIMEOUT });
      await page.waitForSelector(".detail__panel", { state: "visible", timeout: STEP_TIMEOUT });
      d = await overflowPx(page);
      assert(d <= 1, `${width}px detail: horizontal overflow ${d}px`);
      overflow.push(`detail ${d}px`);
      await shot(page, `25-overflow-${width}.png`);
      await page.keyboard.press("Escape");
      await waitDetailClosed(page);
      assertStateClean(tag);
    } finally {
      try { await context.close(); } catch { /* ignore */ }
    }
  }

  /* global hygiene across every state/context of the whole run */
  const errors = hygiene.filter(
    (h) => h.kind === "console.error" || h.kind === "pageerror" || h.kind === "requestfailed" || /^http\.(4|5)/.test(h.kind),
  );
  const warnings = hygiene.filter((h) => h.kind === "console.warning");
  assert(
    errors.length === 0,
    `hygiene: ${errors.length} error(s) across all states: ${errors.slice(0, 6).map((e) => `[${e.tag}] ${e.kind}: ${e.text}`).join(" | ")}`,
  );
  assert(
    warnings.length === 0,
    `hygiene: ${warnings.length} console warning(s): ${warnings.slice(0, 6).map((e) => `[${e.tag}] ${e.kind}: ${e.text}`).join(" | ")}`,
  );
  const external = netLog.filter((r) => !r.url.startsWith(appUrl) && !r.url.startsWith("blob:"));
  assert(external.length === 0, `hygiene: ${external.length} non-app request(s): ${JSON.stringify(external.slice(0, 6))}`);
  const badStatuses = netLog.filter((r) => r.status >= 400);
  assert(badStatuses.length === 0, `hygiene: HTTP ≥400 responses: ${JSON.stringify(badStatuses.slice(0, 6))}`);

  return `hygiene PASS — ${netLog.length} responses all same-origin (0 external), zero console errors/warnings/pageerrors/failed requests/HTTP≥400; overflow: ${overflow.join(", ")}`;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

(async () => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const watchdog = setTimeout(() => {
    console.error(`\nWATCHDOG: whole run exceeded ${WATCHDOG_MS}ms — killing`);
    process.exit(2);
  }, WATCHDOG_MS);

  let fatal = null;
  try {
    const started = await startServer(APP_ROOT, BASE_PORT);
    server = started.server;
    appUrl = `http://127.0.0.1:${started.port}/`;
    console.log(`R3 E2E: serving ${APP_ROOT} at ${appUrl}`);
    browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 60000 });

    await runState("R3-1", "Full user journey: empty → 4 fixtures → analyzing → results → select 2 → download 2 (byte-identical) → detail → start over", {}, stateR3_1);
    await runState("R3-2", "Visual tokens: surfaces, accent fill, focus rings (light/stage), radii {8,12,18,999}, theme-color", {}, stateR3_2);
    await runState("R3-3", "Scoring identity via real picker: 100/96 sharp, 34/36 blurry, byte-identical re-run", {}, stateR3_3);
    await runState("R3-4", "Pointer-gated density: coarse 375/810 ≥44×44, fine 768/1280 36/32, hero 48 everywhere", {}, stateR3_4);
    await runState("R3-5", "Reduced motion: band reveal + sheet rise disabled, transition durations 1ms", {}, stateR3_5);
    await runState("R3-6", "Drop hint: hidden on coarse (empty + all-failed), visible on desktop", {}, stateR3_6);
    await runState("R3-7", "Keyboard-only core flow: CTA → picker → walk → Enter download → Escape detail, rings visible", {}, stateR3_7);
    await runState("R3-8", "Hygiene + responsiveness: zero console/network issues, no overflow at 375/768/1280", {}, stateR3_8);
  } catch (error) {
    fatal = error;
    console.error("FATAL:", (error && error.stack) || error);
  } finally {
    clearTimeout(watchdog);
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    } catch { /* ignore */ }
  }

  const failed = results.filter((r) => r.status !== "PASS");
  const flaky = results.filter((r) => r.flaky);
  console.log("\n==== R3 E2E MATRIX SUMMARY ====");
  for (const r of results) {
    console.log(`${r.status}  ${r.id.padEnd(5)} ${r.name}`);
  }
  console.log(`shots: ${shots.length} -> e2e/artifacts/v2-r3-e2e/`);
  console.log(`hygiene: ${hygiene.length} console events recorded; network: ${netLog.length} responses`);
  if (flaky.length) console.log(`FLAKY (passed on retry): ${flaky.map((r) => r.id).join(", ")}`);
  if (fatal) {
    console.log("R3 E2E MATRIX FATAL — run aborted");
    process.exit(2);
  }
  if (failed.length) {
    console.log(`R3 E2E MATRIX FAIL (${failed.length}): ${failed.map((r) => r.id).join(", ")}`);
    process.exit(1);
  }
  console.log("R3 E2E MATRIX PASS");
  process.exit(0);
})();
