/**
 * phase6-e2e-tester.js — INDEPENDENT Phase 6 (polish, responsiveness,
 * accessibility) end-to-end proof for the Blurry Photo Cleaner.
 *
 * Written by the E2E/Integration Testing Agent as an independent verification
 * run of the delegated Phase 6 state matrix (plans/blurry-photo-cleaner.md
 * Phase 6: "playwright including mobile emulation (375 px): core flow
 * end-to-end on a phone viewport; keyboard-only navigation; visible focus
 * states"). It does NOT import or re-run the implementer's own suites; it
 * drives the live served app through its own user paths with its own
 * assertions and artifacts.
 *
 * Run:  node e2e/phase6-e2e-tester.js
 *
 * Tooling (binding directive): Playwright LIBRARY script only — playwright-cli
 * is banned. Chrome (channel "chrome") headless, in-process static server
 * killed in finally, per-step timeouts + whole-run watchdog, screenshots to
 * e2e/artifacts/phase6-e2e-tester/, process ALWAYS exits
 * (0 pass / 1 state failed / 2 fatal or watchdog).
 *
 * Delegated state matrix (each state runs in its own fresh browser context):
 *   M1  Mobile full flow @375 (hasTouch + isMobile + touch viewport; device
 *       speed emulated with CDP CPU throttling x4 so the analyzing card is
 *       observable): empty → real picker (4 fixtures) → analyzing (§9b card
 *       visible, status "N of 4", no overflow) → grouped results → tap-select
 *       2 tiles (hit areas ≥44px) → Download selected (2 download events,
 *       byte-identical; .btn-secondary:disabled tokens on "Add more" during
 *       the busy window) → detail sheet → hint-chevron navigation (44px hit
 *       areas, ends disabled) → Done → Start over. Zero horizontal overflow
 *       at every step; screenshot per step.
 *   M2  Touch-specific: "or drop photos here" hidden under touch emulation in
 *       the empty state and the all-failed state; visible on a desktop
 *       context (hover-capable pointer).
 *   K1  Keyboard-only desktop full flow: Tab to "Choose photos" → Enter opens
 *       the real picker (chooser.setFiles is the automation substitute for OS
 *       dialog path entry — documented substitution) → Tab walk over band
 *       toggles, tiles (Enter toggles selection), action bar → Enter on
 *       Download selected (2 downloads) → keyboard-open detail, Escape closes,
 *       focus returns to the trigger → keyboard Start over. Every Tab stop
 *       must show the computed visible focus ring; rings screenshotted on the
 *       light surface and on the dark detail stage.
 *   K2  Focus containment under keyboard: open detail → keyboard-trigger
 *       Download this photo → during busy the activeElement is inside the
 *       panel (focus parked on Done when the control self-disables) → Escape
 *       closes after completion. Chevron-to-band-end: the Next chevron
 *       self-disables while focused → focus stays contained → Escape works.
 *   A1  Announcement behavior under the real flow: 6-photo batch → progress
 *       announcements in the polite live region are throttled (bounded count,
 *       ≥500ms cadence floor) + exactly one final "Analysis complete: X
 *       blurry, Y need review, Z sharp" matching the store; toggling 2 tiles
 *       announces "2 selected" (trailing debounce allowed).
 *   R1  Reduced motion via emulateMedia({ reducedMotion: "reduce" }): analyze
 *       + results + detail open → band/tile/panel animations and transitions
 *       collapse to ≤1ms, delays 0, no long-running animation; screenshots.
 *   HY  Hygiene aggregate: zero console errors/warnings/pageerrors/failed
 *       requests/HTTP≥400 across every state this run drove; same-origin
 *       requests only (client-only app by design).
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
const ARTIFACTS_DIR = path.join(__dirname, "artifacts", "phase6-e2e-tester");
const BASE_PORT = 9011;
const STEP_TIMEOUT = 15000;      // one user step / one wait for a UI state
const ANALYSIS_TIMEOUT = 60000;  // full batch resolution budget
const DOWNLOAD_TIMEOUT = 20000;  // download-event budget
const WATCHDOG_MS = 780000;      // whole-run hard cap (13 min)

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };
const MOBILE_CONTEXT = {
  viewport: MOBILE_VIEWPORT,
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  acceptDownloads: true,
};
const DESKTOP_CONTEXT = { viewport: DESKTOP_VIEWPORT, acceptDownloads: true };

/* Phase 6 F7 tokens: .btn-secondary:disabled — muted fill + muted label. */
const DISABLED_BG = "rgb(242, 242, 247)";   // --color-surface-muted #F2F2F7
const DISABLED_FG = "rgb(110, 110, 115)";   // --color-text-muted #6E6E73
const RING_LIGHT = "rgb(30, 110, 244)";     // --color-accent-strong #1E6EF4
const RING_DARK = "rgb(255, 255, 255)";     // --color-stage-text

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
  fakeHeic: { name: "fixture-fake.heic", mime: "image/heic", buffer: readFixture("fixture-fake.heic") },
  notAnImage: { name: "fixture-not-an-image.txt", mime: "text/plain", buffer: readFixture("fixture-not-an-image.txt") },
};

const ALL_FOUR = [FIX.sharpCheckerboard, FIX.sharpText, FIX.blurredCheckerboard, FIX.blurredText];

function asInput(f, nameOverride) {
  return { name: nameOverride || f.name, mimeType: f.mime, buffer: f.buffer };
}

function bufferByName(name) {
  for (const f of ALL_FOUR) {
    if (f.name === name) return f.buffer;
  }
  return null;
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
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, file), timeout: 15000 });
  shots.push({ tag: currentTag, file });
  console.log(`      shot: e2e/artifacts/phase6-e2e-tester/${file}`);
}

async function expectHeading(page, name, label, timeout = STEP_TIMEOUT) {
  try {
    await page.getByRole("heading", { name, exact: true }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    throw new Error(`${label || `heading "${name}"`} not visible (${firstLine(error)})`);
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

async function waitForResults(page, timeout = STEP_TIMEOUT) {
  try {
    await page.getByRole("heading", { name: "Blurry", exact: true }).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    throw new Error(`results screen (band headings) not visible (${firstLine(error)})`);
  }
}

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

const band = (page, id) => page.locator(`[data-band="${id}"]`);

/** Rendered tile names of a band, in DOM order. */
async function renderedTileNames(page, id) {
  const tiles = band(page, id).getByRole("listitem");
  const count = await tiles.count();
  const names = [];
  for (let i = 0; i < count; i += 1) {
    names.push((await tiles.nth(i).locator(".tile__filename").innerText()).trim());
  }
  return names;
}

async function summaryText(page) {
  return (await page.locator(".action-bar__summary").innerText()).trim();
}

/** Horizontal overflow of the scrolling element at the current viewport. */
async function overflowOf(page) {
  return page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
}

/**
 * Real user path for file selection: activate the named button and feed the
 * file chooser it opens (picker path — not a hidden-input shortcut).
 */
async function chooseFiles(page, triggerName, files, timeout = STEP_TIMEOUT) {
  const trigger = page.getByRole("button", { name: triggerName, exact: true });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout }),
    trigger.click({ timeout }),
  ]);
  await chooser.setFiles(files, { timeout: 120000 });
}

/* ------------------------------------------------------------------ */
/* Keyboard helpers                                                    */
/* ------------------------------------------------------------------ */

async function readActive(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) {
      return { body: true, name: "(body)", ariaPressed: null, inPanel: false, outlineStyle: null, outlineWidth: null, outlineColor: null };
    }
    const cs = getComputedStyle(el);
    const panel = document.querySelector(".detail__panel");
    return {
      body: false,
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute("aria-label") || (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48)) || el.tagName,
      ariaPressed: el.getAttribute("aria-pressed"),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      inPanel: !!panel && panel.contains(el),
    };
  });
}

async function tabStop(page, { shift = false } = {}) {
  await page.keyboard.press(shift ? "Shift+Tab" : "Tab");
  return readActive(page);
}

/** Returns a violation string when the focused element has no visible ring. */
function ringIssue(stop) {
  if (!stop || stop.body) return null;
  if (stop.outlineStyle !== "solid") return `outline-style "${stop.outlineStyle}"`;
  if (!(parseFloat(stop.outlineWidth) >= 2)) return `outline-width "${stop.outlineWidth}"`;
  const color = stop.outlineColor || "";
  if (!color || color === "transparent" || /rgba\(0,\s*0,\s*0,\s*0\)/.test(color)) return `outline-color "${color}"`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Live-region announcement spy (init script)                          */
/* ------------------------------------------------------------------ */

const ANNOUNCE_SPY = () => {
  window.__announceLog = [];
  const record = () => {
    const el = document.getElementById("live-region");
    if (!el) return;
    const text = (el.textContent || "").trim();
    if (!text) return;
    const last = window.__announceLog[window.__announceLog.length - 1];
    if (!last || last.text !== text) {
      window.__announceLog.push({ text, t: Date.now() });
    }
  };
  const observer = new MutationObserver(record);
  // Init scripts run before documentElement exists — observe the Document
  // node itself (never null) so the boot mutations are not missed.
  observer.observe(document, { childList: true, subtree: true, characterData: true });
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

async function runState(id, name, fn, contextOptions = DESKTOP_CONTEXT, initScript = null) {
  const only = process.env.P6_ONLY ? process.env.P6_ONLY.split(",").map((s) => s.trim()) : null;
  if (only && !only.includes(id)) {
    console.log(`\n--- ${id}: skipped (P6_ONLY debug filter) ---`);
    return;
  }
  const MAX_ATTEMPTS = 3; // initial + two retries (delegated flakiness cap)
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const tag = attempt === 1 ? id : `${id}#try${attempt}`;
    currentTag = tag;
    const context = await browser.newContext(contextOptions);
    if (initScript) await context.addInitScript(initScript);
    const page = await context.newPage();
    wirePage(page, tag);
    page.setDefaultTimeout(STEP_TIMEOUT);
    let detail = "";
    let ok = true;
    try {
      detail = (await fn({ page, context, browser, tag, attempt })) || "";
    } catch (error) {
      ok = false;
      lastError = error;
      console.error(`      attempt ${attempt} failed: ${firstLine(error)}`);
      try {
        await page.screenshot({
          path: path.join(ARTIFACTS_DIR, `fail-${id}-try${attempt}.png`),
          timeout: 8000,
        });
        console.error(`      failure shot: e2e/artifacts/phase6-e2e-tester/fail-${id}-try${attempt}.png`);
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
/* M1 — Mobile full flow @375 (touch emulation + device-speed CPU)     */
/* ------------------------------------------------------------------ */

async function stateM1({ page, context }) {
  // Device-speed emulation: throttling the renderer 4x keeps the §9b
  // analyzing card observable for a phone-class device (same page, same
  // behavior — only the CPU pace changes).
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 }).catch(() => {
    note("CPU throttling unavailable — continuing at full speed");
  });

  const overflows = [];
  const checkOverflow = async (label) => {
    const over = await overflowOf(page);
    assert(over <= 1, `${label}: horizontal overflow ${over}px at ${MOBILE_VIEWPORT.width}px`);
    overflows.push(`${label}=${over}px`);
  };

  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  /* empty */
  await expectHeading(page, "Find the blurry photos", "mobile empty heading");
  await checkOverflow("empty");
  await shot(page, "m1-01-empty.png");

  // Atomic analyzing observer: one rAF loop records the first frame the §9b
  // card is visible, together with the overflow at that moment.
  await page.evaluate(() => {
    window.__m1 = { card: null };
    const tick = () => {
      const snap = window.__m1;
      if (!snap.card) {
        const el = document.querySelector(".progress-card");
        if (el && el.getClientRects().length > 0) {
          const status = el.querySelector(".progress-card__status");
          snap.card = {
            status: status ? status.textContent.trim() : null,
            overflow: document.scrollingElement.scrollWidth - window.innerWidth,
            at: Date.now(),
          };
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  /* pick 4 fixtures via the real picker (tap) */
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: STEP_TIMEOUT }),
    page.getByRole("button", { name: "Choose photos", exact: true }).tap({ timeout: STEP_TIMEOUT }),
  ]);
  await chooser.setFiles(ALL_FOUR.map((f) => asInput(f)), { timeout: 120000 });

  /* analyzing */
  const cardSnap = await page
    .waitForFunction(() => (window.__m1 && window.__m1.card) || null, null, { timeout: ANALYSIS_TIMEOUT, polling: 10 })
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  assert(cardSnap, "the §9b analyzing card was never observed visible during the 4-photo batch");
  assert(
    cardSnap.status && /^\d+ of 4$/.test(cardSnap.status),
    `progress status "${cardSnap.status}" does not read "N of 4"`,
  );
  assert(cardSnap.overflow <= 1, `analyzing: horizontal overflow ${cardSnap.overflow}px at 375px`);
  overflows.push(`analyzing=${cardSnap.overflow}px (card "${cardSnap.status}")`);
  await shot(page, "m1-02-analyzing.png");

  /* grouped results */
  await waitForResolved(page, 4);
  await waitForResults(page);
  await checkOverflow("results");
  const counts = [];
  for (const id of ["blurry", "review", "sharp"]) {
    const text = (await band(page, id).locator(".band__count").innerText()).trim();
    counts.push(`${id}:${text}`);
  }
  assert(
    (await page.getByText("0 selected · 4 total", { exact: true }).count()) === 1,
    "action-bar summary '0 selected · 4 total' missing on mobile results",
  );
  await shot(page, "m1-03-results.png");

  /* select 2 via tap targets */
  const tileBtn = (name) =>
    page.getByRole("listitem").filter({ hasText: name }).getByRole("button", { name, exact: true });
  const taps = [FIX.sharpText.name, FIX.blurredCheckerboard.name];
  const hitAreas = [];
  for (const name of taps) {
    const box = await tileBtn(name).boundingBox();
    assert(
      box && box.width >= 44 && box.height >= 44,
      `tile tap target "${name}" is ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "missing"} — below the 44px floor (§12)`,
    );
    hitAreas.push(`${name} ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  await tileBtn(taps[0]).tap();
  await tileBtn(taps[1]).tap();
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".action-bar__summary");
      return !!el && el.textContent.trim() === "2 selected · 4 total";
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 25 },
  );
  await checkOverflow("selected");
  await shot(page, "m1-04-selected.png");

  /* download selected (2 download events, byte-identical) */
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  await page.getByRole("button", { name: "Download selected", exact: true }).tap();

  // F7 tokens on the secondary "Add more" during the busy window: wait for the
  // disabled state with the settled token values (transition-tolerant).
  const busyStyle = await page
    .waitForFunction(
      () => {
        const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Add more");
        if (!btn || !btn.disabled) return null;
        const cs = getComputedStyle(btn);
        if (cs.backgroundColor !== "rgb(242, 242, 247)" || cs.color !== "rgb(110, 110, 115)") return null;
        return { bg: cs.backgroundColor, color: cs.color };
      },
      null,
      { timeout: 10000, polling: 10 },
    )
    .then((handle) => handle.jsonValue())
    .catch(() => null);
  assert(
    busyStyle,
    'the secondary "Add more" never showed the disabled tokens during the download busy window (.btn-secondary:disabled)',
  );
  await shot(page, "m1-05-download-busy.png");

  const dlDeadline = Date.now() + DOWNLOAD_TIMEOUT;
  while (downloads.length < 2 && Date.now() < dlDeadline) await sleep(50);
  assert(
    downloads.length === 2,
    `expected 2 download events, saw ${downloads.length} (${JSON.stringify(downloads.map((d) => d.suggestedFilename()))})`,
  );
  const names = downloads.map((d) => d.suggestedFilename()).sort();
  assert(
    JSON.stringify(names) === JSON.stringify([...taps].sort()),
    `download filenames ${JSON.stringify(names)}, expected ${JSON.stringify([...taps].sort())}`,
  );
  for (const d of downloads) {
    const saved = fs.readFileSync(await d.path());
    const original = bufferByName(d.suggestedFilename());
    assert(original, `downloaded "${d.suggestedFilename()}" has no matching fixture`);
    assert(
      saved.length === original.length && saved.equals(original),
      `saved "${d.suggestedFilename()}" (${saved.length} B) differs from the original file (${original.length} B)`,
    );
  }
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Download selected");
      return !!btn && !btn.disabled;
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 50 },
  );
  await checkOverflow("after-download");
  await shot(page, "m1-06-after-download.png");

  /* detail sheet */
  const sharpNames = await renderedTileNames(page, "sharp");
  assert(sharpNames.length === 2, `sharp band renders ${sharpNames.length} tiles, expected 2`);
  const [firstSharp, secondSharp] = sharpNames;
  await page.getByRole("button", { name: `View ${firstSharp}`, exact: true }).tap();
  await expectDialog(page, `Reviewing ${firstSharp}`);
  const navDisplays = await page.locator(".detail__nav").evaluateAll((els) => els.map((el) => getComputedStyle(el).display));
  assert(navDisplays.length === 2 && navDisplays.every((d) => d === "none"), `mobile flanking chevrons display ${JSON.stringify(navDisplays)}`);
  assert(await page.locator(".detail__hint").getByText("swipe", { exact: true }).isVisible(), 'mobile "swipe" hint not visible');
  await checkOverflow("detail-sheet");
  await shot(page, "m1-07-detail.png");

  /* navigate via hint chevrons (44px hit areas) */
  const hintPrev = page.locator('.detail__hint-nav[aria-label="Previous photo"]');
  const hintNext = page.locator('.detail__hint-nav[aria-label="Next photo"]');
  const hintHits = [];
  for (const [label, loc] of [["Previous photo", hintPrev], ["Next photo", hintNext]]) {
    const box = await loc.boundingBox();
    assert(
      box && box.width >= 44 && box.height >= 44,
      `hint chevron "${label}" hit area is ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "missing"} — below 44px`,
    );
    hintHits.push(`${label} ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  assert(await hintPrev.isDisabled(), "hint prev not disabled at the band's first photo");
  assert(!(await hintNext.isDisabled()), "hint next disabled at the band's first photo");
  await hintNext.tap();
  await waitForDetailName(page, secondSharp);
  assert(await hintNext.isDisabled(), "hint next not disabled at the band's last photo");
  assert(!(await hintPrev.isDisabled()), "hint prev disabled at the band's last photo");
  await shot(page, "m1-08-detail-nav.png");
  await hintPrev.tap();
  await waitForDetailName(page, firstSharp);
  assert(await hintPrev.isDisabled(), "hint prev not re-disabled after navigating back");

  /* close → Start over */
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await page.waitForFunction(() => !document.querySelector(".detail__panel"), null, { timeout: STEP_TIMEOUT, polling: 50 });
  await page.getByRole("button", { name: "Start over", exact: true }).tap();
  await expectHeading(page, "Find the blurry photos", "empty state after mobile Start over");
  await page.waitForFunction(() => document.querySelectorAll(".photo-grid img").length === 0, null, { timeout: STEP_TIMEOUT, polling: 100 });
  await checkOverflow("after-start-over");
  await shot(page, "m1-09-after-start-over.png");

  return `375px touch flow complete; overflow ${overflows.join(", ")}; analyzing card "${cardSnap.status}"; bands ${counts.join(", ")}; tap targets ${hitAreas.join(", ")}; 2 byte-identical downloads (${names.join(", ")}); busy Add-more disabled style ${busyStyle.bg}/${busyStyle.color}; hint hits ${hintHits.join(", ")}; nav ${firstSharp} → ${secondSharp} → back (ends disabled); Done + Start over clean`;
}

/* ------------------------------------------------------------------ */
/* M2 — touch-specific drop-hint hiding (+ desktop visibility)         */
/* ------------------------------------------------------------------ */

async function stateM2({ page, browser, tag }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  const hintMeta = await page.evaluate(() => ({
    hoverNone: matchMedia("(hover: none)").matches,
    pointerCoarse: matchMedia("(pointer: coarse)").matches,
    display: (() => {
      const el = document.querySelector(".empty-state__drop-hint");
      return el ? getComputedStyle(el).display : null;
    })(),
    text: (() => {
      const el = document.querySelector(".empty-state__drop-hint");
      return el ? el.textContent.trim() : null;
    })(),
  }));
  assert(hintMeta.text === "or drop photos here", `drop hint text "${hintMeta.text}"`);
  assert(
    hintMeta.hoverNone || hintMeta.pointerCoarse,
    `touch emulation did not flip the pointer media features (hover:none=${hintMeta.hoverNone}, pointer:coarse=${hintMeta.pointerCoarse})`,
  );
  const hintLocator = page.getByText("or drop photos here", { exact: true });
  assert((await hintLocator.count()) === 1, "drop hint absent from the touch empty state DOM");
  assert(!(await hintLocator.isVisible()), "drop hint VISIBLE under touch emulation (empty state) — @media (hover:none),(pointer:coarse) not applied");
  assert(hintMeta.display === "none", `computed display "${hintMeta.display}", expected "none"`);
  await shot(page, "m2-01-empty-touch-hint-hidden.png");

  /* all-failed state keeps the same behavior */
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: STEP_TIMEOUT }),
    page.getByRole("button", { name: "Choose photos", exact: true }).tap(),
  ]);
  await chooser.setFiles([asInput(FIX.fakeHeic), asInput(FIX.notAnImage)], { timeout: 60000 });
  await expectHeading(page, "Couldn't open those files", "all-failed heading");
  assert(!(await hintLocator.isVisible()), "drop hint VISIBLE under touch emulation (all-failed state)");
  const failedDisplay = await page.evaluate(() => {
    const el = document.querySelector(".empty-state__drop-hint");
    return el ? getComputedStyle(el).display : null;
  });
  assert(failedDisplay === "none", `all-failed hint computed display "${failedDisplay}", expected "none"`);
  await shot(page, "m2-02-all-failed-touch-hint-hidden.png");

  /* desktop context: hint visible on a hover-capable pointer */
  const deskContext = await browser.newContext(DESKTOP_CONTEXT);
  const deskPage = await deskContext.newPage();
  wirePage(deskPage, `${tag}-desktop`);
  deskPage.setDefaultTimeout(STEP_TIMEOUT);
  try {
    await deskPage.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
    const deskMeta = await deskPage.evaluate(() => {
      const el = document.querySelector(".empty-state__drop-hint");
      return {
        hoverHover: matchMedia("(hover: hover)").matches,
        display: el ? getComputedStyle(el).display : null,
        text: el ? el.textContent.trim() : null,
      };
    });
    assert(deskMeta.hoverHover, "desktop context does not report (hover: hover)");
    assert(deskMeta.text === "or drop photos here", `desktop hint text "${deskMeta.text}"`);
    assert(deskMeta.display !== "none", `desktop hint computed display "${deskMeta.display}" (expected visible)`);
    assert(
      await deskPage.getByText("or drop photos here", { exact: true }).isVisible(),
      "desktop drop hint not visible on a hover-capable pointer",
    );
    await shot(deskPage, "m2-03-desktop-hint-visible.png");
  } finally {
    await deskContext.close().catch(() => {});
  }

  return `touch: hint present in DOM but display:none (empty + all-failed), hover:none=${hintMeta.hoverNone} pointer:coarse=${hintMeta.pointerCoarse}; desktop: hint visible with (hover: hover)`;
}

/* ------------------------------------------------------------------ */
/* K1 — keyboard-only desktop full flow + visible focus rings          */
/* ------------------------------------------------------------------ */

async function stateK1({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await expectHeading(page, "Find the blurry photos", "keyboard run start heading");

  /* Tab to the CTA (keyboard-only) */
  const emptyTrail = [];
  let cta = null;
  for (let i = 0; i < 12 && !cta; i += 1) {
    const s = await tabStop(page);
    emptyTrail.push(s);
    if (s.name === "Choose photos") cta = s;
  }
  assert(cta, `Tab never reached "Choose photos" (trail ${JSON.stringify(emptyTrail.map((s) => s.name))})`);
  const ctaRing = ringIssue(cta);
  assert(!ctaRing, `CTA focus ring missing: ${ctaRing}`);
  assert(cta.outlineColor === RING_LIGHT, `CTA ring color ${cta.outlineColor}, expected ${RING_LIGHT}`);
  await shot(page, "k1-01-focus-empty-cta.png");

  /* Enter opens the real picker; chooser.setFiles substitutes the OS dialog
     (browser security prevents a test from typing into the native dialog). */
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: STEP_TIMEOUT }),
    page.keyboard.press("Enter"),
  ]);
  await chooser.setFiles(ALL_FOUR.map((f) => asInput(f)), { timeout: 120000 });

  await waitForResolved(page, 4);
  await waitForResults(page);

  /* keyboard walk: band toggles → tiles (Enter selects) → action bar */
  const stops = [];
  const tileToggles = [];
  let sawBandToggle = 0;
  let sawAddMore = false;
  let reachedDownload = false;
  let tileShotTaken = false;
  for (let i = 0; i < 90 && !reachedDownload; i += 1) {
    const s = await tabStop(page);
    stops.push(s);
    if (s.name === "Select all" || s.name === "Deselect") sawBandToggle += 1;
    if (s.name === "Add more") sawAddMore = true;
    if (s.ariaPressed === "true" || s.ariaPressed === "false") {
      if (tileToggles.length < 2) {
        await page.keyboard.press("Enter");
        const after = await readActive(page);
        assert(
          after.ariaPressed === "true",
          `Enter did not toggle tile "${s.name}" on (aria-pressed=${after.ariaPressed})`,
        );
        tileToggles.push(s.name);
        if (!tileShotTaken) {
          await shot(page, "k1-02-focus-tile-selected.png");
          tileShotTaken = true;
        }
        continue;
      }
    }
    if (s.name === "Download selected") reachedDownload = true;
  }
  assert(reachedDownload, `keyboard walk never reached "Download selected" (stops ${JSON.stringify(stops.map((s) => s.name))})`);
  assert(sawBandToggle >= 1, `keyboard walk never reached a band Select all toggle (stops ${JSON.stringify(stops.map((s) => s.name))})`);
  assert(sawAddMore, "keyboard walk never reached the action bar's Add more button");
  assert(tileToggles.length === 2, `Enter selected ${tileToggles.length} tiles, expected 2`);
  const ringViolations = stops.filter((s) => !s.body && ringIssue(s)).map((s) => `${s.name}: ${ringIssue(s)}`);
  assert(ringViolations.length === 0, `${ringViolations.length} Tab stop(s) without a visible focus ring: ${JSON.stringify(ringViolations)}`);
  assert((await summaryText(page)) === "2 selected · 4 total", `summary "${await summaryText(page)}" after 2 keyboard selects`);
  await shot(page, "k1-03-two-selected.png");

  /* Enter on Download selected → downloads */
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  await page.keyboard.press("Enter");
  const dlDeadline = Date.now() + DOWNLOAD_TIMEOUT;
  while (downloads.length < 2 && Date.now() < dlDeadline) await sleep(50);
  assert(downloads.length === 2, `keyboard download produced ${downloads.length} events, expected 2`);
  for (const d of downloads) {
    const saved = fs.readFileSync(await d.path());
    const original = bufferByName(d.suggestedFilename());
    assert(original && saved.equals(original), `keyboard download "${d.suggestedFilename()}" is not byte-identical to its fixture`);
  }
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Download selected");
      return !!btn && !btn.disabled;
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 50 },
  );

  /* keyboard detail: Enter on a tile's View button, Escape closes, focus returns */
  let viewStop = null;
  const viewTrail = [];
  for (let i = 0; i < 90 && !viewStop; i += 1) {
    const s = await tabStop(page);
    viewTrail.push(s);
    if (/^View /.test(s.name)) viewStop = s;
  }
  assert(viewStop, `keyboard walk never reached a View meta button (trail ${JSON.stringify(viewTrail.map((s) => s.name))})`);
  const viewRing = ringIssue(viewStop);
  assert(!viewRing, `View button focus ring missing: ${viewRing}`);
  const viewName = viewStop.name.slice(5);
  await page.keyboard.press("Enter");
  await expectDialog(page, `Reviewing ${viewName}`);

  const firstPanelStop = await tabStop(page); // panel-focused → trap routes to the first control
  assert(firstPanelStop.inPanel, `first Tab after dialog open left the panel (${firstPanelStop.name})`);
  const darkRing = ringIssue(firstPanelStop);
  assert(!darkRing, `dark-stage focus ring missing: ${darkRing}`);
  assert(
    firstPanelStop.outlineColor === RING_DARK,
    `dark-stage ring color ${firstPanelStop.outlineColor}, expected ${RING_DARK}`,
  );
  await shot(page, "k1-04-focus-dark-stage.png");

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".detail__panel"), null, { timeout: STEP_TIMEOUT, polling: 50 });
  const backToTrigger = await readActive(page);
  assert(
    backToTrigger.name === `View ${viewName}`,
    `focus after Escape is "${backToTrigger.name}", expected "View ${viewName}"`,
  );

  /* keyboard Start over */
  let startOver = null;
  const soTrail = [];
  for (let i = 0; i < 90 && !startOver; i += 1) {
    const s = await tabStop(page, { shift: true });
    soTrail.push(s);
    if (s.name === "Start over") startOver = s;
  }
  assert(startOver, `Shift+Tab never reached "Start over" (trail ${JSON.stringify(soTrail.map((s) => s.name))})`);
  const soRing = ringIssue(startOver);
  assert(!soRing, `Start over focus ring missing: ${soRing}`);
  await page.keyboard.press("Enter");
  await expectHeading(page, "Find the blurry photos", "empty state after keyboard Start over");
  await shot(page, "k1-05-after-keyboard-start-over.png");

  return `keyboard-only: Tab→CTA (ring ${cta.outlineColor}) → Enter picker [substitution: chooser.setFiles] → walk ${stops.length} stops covering band toggles, tiles (Enter selected ${tileToggles.join(", ")}), Add more → Download selected (2 byte-identical downloads) → View via Enter, Escape → focus back to "View ${viewName}" → Shift+Tab Start over; every stop had a visible ring (light ${RING_LIGHT}, dark ${RING_DARK})`;
}

/* ------------------------------------------------------------------ */
/* K2 — focus containment under keyboard                               */
/* ------------------------------------------------------------------ */

async function stateK2({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await chooseFiles(page, "Choose photos", ALL_FOUR.map((f) => asInput(f)));
  await waitForResolved(page, 4);
  await waitForResults(page);

  const sharpNames = await renderedTileNames(page, "sharp");
  assert(sharpNames.length === 2, `sharp band renders ${sharpNames.length} tiles, expected 2`);
  const [firstSharp, secondSharp] = sharpNames;

  /* open detail via keyboard (Enter on the View meta button) */
  await page.getByRole("button", { name: `View ${firstSharp}`, exact: true }).press("Enter");
  await expectDialog(page, `Reviewing ${firstSharp}`);

  /* Tab to Download this photo (keyboard), then Enter */
  let dlStop = null;
  const preTrail = [];
  for (let i = 0; i < 14 && !dlStop; i += 1) {
    const s = await tabStop(page);
    preTrail.push(s);
    if (s.name === "Download this photo") dlStop = s;
  }
  assert(dlStop, `Tab trail never reached "Download this photo" (${JSON.stringify(preTrail.map((s) => s.name))})`);
  const dlRing = ringIssue(dlStop);
  assert(!dlRing, `Download this photo focus ring missing: ${dlRing}`);

  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => {
      const b = document.querySelector(".detail__download");
      return !!b && b.disabled && b.textContent.includes("Preparing");
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 10 },
  );
  const busyFocus = await readActive(page);
  assert(
    busyFocus.inPanel,
    `during per-item busy, focus escaped the panel: ${JSON.stringify(busyFocus)}`,
  );
  await shot(page, "k2-01-busy-focus-contained.png");

  await page.waitForFunction(
    () => {
      const b = document.querySelector(".detail__download");
      return !!b && !b.disabled && b.textContent.includes("Download this photo");
    },
    null,
    { timeout: STEP_TIMEOUT, polling: 50 },
  );
  const dlDeadline = Date.now() + DOWNLOAD_TIMEOUT;
  while (downloads.length < 1 && Date.now() < dlDeadline) await sleep(50);
  assert(downloads.length === 1, `per-item keyboard download produced ${downloads.length} events, expected 1`);
  assert(downloads[0].suggestedFilename() === firstSharp, `per-item download name "${downloads[0].suggestedFilename()}"`);
  const saved = fs.readFileSync(await downloads[0].path());
  const original = bufferByName(firstSharp);
  assert(original && saved.equals(original), `per-item download "${firstSharp}" is not byte-identical to its fixture`);

  /* Escape still closes after completion */
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".detail__panel"), null, { timeout: STEP_TIMEOUT, polling: 50 });
  const back1 = await readActive(page);
  assert(back1.name === `View ${firstSharp}`, `focus after Escape is "${back1.name}", expected "View ${firstSharp}"`);

  /* chevron-to-band-end: Next self-disables while focused */
  await page.getByRole("button", { name: `View ${firstSharp}`, exact: true }).press("Enter");
  await expectDialog(page, `Reviewing ${firstSharp}`);
  let nextStop = null;
  const navTrail = [];
  for (let i = 0; i < 14 && !nextStop; i += 1) {
    const s = await tabStop(page);
    navTrail.push(s);
    if (s.name === "Next photo") nextStop = s;
  }
  assert(nextStop, `Tab trail never reached the desktop "Next photo" chevron (${JSON.stringify(navTrail.map((s) => s.name))})`);
  assert(nextStop.inPanel, "the desktop Next chevron stop was outside the panel");
  assert(nextStop.outlineColor === RING_DARK, `chevron ring color ${nextStop.outlineColor}, expected ${RING_DARK}`);
  await page.keyboard.press("Enter");
  await waitForDetailName(page, secondSharp);
  const atEnd = await readActive(page);
  assert(
    atEnd.inPanel,
    `after the chevron self-disabled at the band end, focus escaped the panel: ${JSON.stringify(atEnd)}`,
  );
  assert(atEnd.name === "Done", `focus parked on "${atEnd.name}", expected the Done button (containment spot)`);
  await shot(page, "k2-02-chevron-end-contained.png");

  /* Tab cycle stays contained */
  const cycle = [];
  for (let i = 0; i < 8; i += 1) {
    const s = await tabStop(page);
    cycle.push(s.name);
    assert(s.inPanel, `Tab ${i + 1} escaped the panel: "${s.name}"`);
  }

  /* Escape from the contained state closes and restores the trigger */
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".detail__panel"), null, { timeout: STEP_TIMEOUT, polling: 50 });
  const back2 = await readActive(page);
  assert(back2.name === `View ${firstSharp}`, `focus after final Escape is "${back2.name}", expected "View ${firstSharp}"`);

  return `busy: activeElement="${busyFocus.name}" inside panel (no focus loss to body); per-item keyboard download "${firstSharp}" byte-identical; Escape closes → focus "View ${firstSharp}"; chevron to band end: next self-disabled, focus parked on "${atEnd.name}", Tab cycle [${cycle.join(" → ")}] all inside panel, Escape closes`;
}

/* ------------------------------------------------------------------ */
/* A1 — announcement behavior under the real flow                      */
/* ------------------------------------------------------------------ */

async function stateA1({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

  const batch = [
    asInput(FIX.sharpCheckerboard),
    asInput(FIX.sharpText),
    asInput(FIX.blurredCheckerboard),
    asInput(FIX.blurredText),
    asInput(FIX.sharpText, "extra-sharp-copy.png"),
    asInput(FIX.blurredText, "extra-blur-copy.png"),
  ];
  await chooseFiles(page, "Choose photos", batch);
  await waitForResolved(page, 6);
  await waitForResults(page);

  const log = await page.evaluate(() => window.__announceLog.slice());
  const progress = log.filter((e) => /^Analyzing \d+ of 6$/.test(e.text));
  const completion = log.filter((e) => /^Analysis complete:/.test(e.text));
  assert(progress.length >= 1, `no progress announcements captured (log ${JSON.stringify(log.map((e) => e.text))})`);
  assert(
    progress.length <= 5,
    `${progress.length} progress announcements for a 6-photo batch — throttle (500ms floor) not effective`,
  );
  const gaps = [];
  for (let i = 1; i < progress.length; i += 1) {
    const gap = progress[i].t - progress[i - 1].t;
    gaps.push(gap);
    assert(gap >= 480, `progress announcements ${i}→${i + 1} only ${gap}ms apart (500ms floor expected)`);
  }
  const state = await debugState(page);
  const counts = { blurry: 0, review: 0, sharp: 0 };
  for (const p of state.photos) {
    if (counts[p.band] !== undefined) counts[p.band] += 1;
  }
  const expected = `Analysis complete: ${counts.blurry} blurry, ${counts.review} need review, ${counts.sharp} sharp`;
  assert(
    completion.length === 1 && completion[0].text === expected,
    `completion announcement ${JSON.stringify(completion.map((e) => e.text))}, expected exactly "${expected}"`,
  );
  await shot(page, "a1-01-results-6.png");

  /* toggle 2 tiles → "2 selected" (trailing debounce allowed) */
  const blurryNames = await renderedTileNames(page, "blurry");
  const sharpNames = await renderedTileNames(page, "sharp");
  const t0 = Date.now();
  await page.getByRole("button", { name: blurryNames[0], exact: true }).click();
  await page.getByRole("button", { name: sharpNames[0], exact: true }).click();
  const announced = await page
    .waitForFunction(() => (window.__announceLog || []).some((e) => e.text === "2 selected"), null, {
      timeout: 5000,
      polling: 50,
    })
    .then(() => true)
    .catch(() => false);
  const logAfter = await page.evaluate(() => window.__announceLog.slice());
  assert(
    announced,
    `"2 selected" never appeared in the live region (log ${JSON.stringify(logAfter.map((e) => e.text))})`,
  );
  const selEntry = logAfter.filter((e) => e.text === "2 selected").pop();
  assert((await summaryText(page)) === "2 selected · 6 total", `summary "${await summaryText(page)}"`);
  await shot(page, "a1-02-two-selected.png");
  const analyzeWindowMs = completion[0].t - progress[0].t;

  return `6-photo batch: ${progress.length} progress announcements (${progress.map((e) => e.text).join(" → ")}; gaps ${gaps.length ? gaps.join("ms, ") + "ms" : "n/a"}; analysis window ${analyzeWindowMs}ms) ≤ 5 bounded; completion exactly "${completion[0].text}"; 2 tile toggles → "2 selected" announced ${selEntry.t - t0}ms after first click (log: ${logAfter.map((e) => e.text).join(" | ")})`;
}

/* ------------------------------------------------------------------ */
/* R1 — reduced motion (emulateMedia)                                  */
/* ------------------------------------------------------------------ */

async function stateR1({ page }) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  const reduceOn = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  assert(reduceOn, "emulated reduced motion is not active (matchMedia)");

  // First-frame watcher: the moment the reveal sections mount, snapshot the
  // computed animation state (delay + backward-fill opacity) atomically.
  await page.evaluate(() => {
    window.__r1first = null;
    const snap = () => {
      if (window.__r1first) return;
      const bands = [...document.querySelectorAll(".band--reveal")];
      if (!bands.length) return;
      window.__r1first = bands.map((el) => {
        const cs = getComputedStyle(el);
        const tile = el.querySelector(".tile");
        const tcs = tile ? getComputedStyle(tile) : null;
        return {
          delay: cs.animationDelay,
          opacity: cs.opacity,
          transform: cs.transform,
          firstTile: tcs ? { delay: tcs.animationDelay, opacity: tcs.opacity } : null,
        };
      });
    };
    const obs = new MutationObserver(snap);
    obs.observe(document, { childList: true, subtree: true });
    snap();
  });

  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: STEP_TIMEOUT }),
    page.getByRole("button", { name: "Choose photos", exact: true }).tap(),
  ]);
  await chooser.setFiles(ALL_FOUR.map((f) => asInput(f)), { timeout: 120000 });
  await waitForResolved(page, 4);
  await waitForResults(page);
  // Settle: every reveal animation (including its stagger delay) finishes, so
  // the transform/opacity checks see the resting state; the deterministic
  // root-cause check below reads the persistent computed animation-delay.
  await page.evaluate(() => {
    const all = Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
    return Promise.race([all, new Promise((r) => setTimeout(r, 2000))]);
  });

  const readMotion = () =>
    page.evaluate(() => {
      const read = (el) => {
        const cs = getComputedStyle(el);
        return {
          animationName: cs.animationName,
          animationDuration: cs.animationDuration,
          animationDelay: cs.animationDelay,
          transitionDuration: cs.transitionDuration,
          transform: cs.transform,
          opacity: cs.opacity,
        };
      };
      const bands = [...document.querySelectorAll(".band--reveal")].map(read);
      const tiles = [...document.querySelectorAll(".band--reveal .tile")].map(read);
      const button = document.querySelector(".btn-primary");
      return {
        bands,
        tiles,
        buttonTransition: button ? getComputedStyle(button).transitionDuration : null,
        firstFrame: window.__r1first,
        longRunning: document
          .getAnimations()
          .filter((a) => {
            try {
              return a.playState === "running" && a.effect.getTiming().duration > 5;
            } catch {
              return false;
            }
          }).length,
      };
    });

  const isOneMs = (v) => typeof v === "string" && v.split(",").every((d) => parseFloat(d) <= 0.00101);
  const rm = await readMotion();
  assert(rm.bands.length === 3, `reduced-motion results: ${rm.bands.length} .band--reveal sections, expected 3`);
  rm.bands.forEach((b, i) => {
    assert(isOneMs(b.animationDuration), `band ${i}: animationDuration ${b.animationDuration} not collapsed to 1ms`);
  });
  assert(rm.tiles.length >= 1, "no tiles found inside the .band--reveal sections");
  rm.tiles.forEach((t, i) => {
    assert(isOneMs(t.animationDuration), `tile ${i}: animationDuration ${t.animationDuration} not collapsed to 1ms`);
  });
  assert(isOneMs(rm.buttonTransition), `button transitionDuration ${rm.buttonTransition} not collapsed to 1ms`);
  assert(rm.longRunning === 0, `${rm.longRunning} animation(s) longer than 5ms still running under reduced motion`);
  rm.bands.forEach((b, i) => {
    assert(b.transform === "none", `band ${i}: leftover transform ${b.transform} after settle`);
    assert(b.opacity === "1", `band ${i}: opacity ${b.opacity} after settle`);
  });

  // Spec §12: reduced motion "disables the band reveal" — not merely shortens
  // it. Any residual reveal stagger delay (with `backwards` fill holding the
  // element invisible/translated until its delay elapses) means the reveal is
  // still active. This is the delegate's "no band-reveal animation classes
  // active" check, run across EVERY band and tile (the first band carries
  // delay 0, which is why a first-element sample passes). The computed
  // animation-delay persists after the animation finishes, so this check is
  // deterministic.
  const bandDelays = rm.bands.map((b) => b.animationDelay);
  const tileDelays = rm.tiles.map((t) => t.animationDelay);
  const revealNames = [...new Set([...rm.bands, ...rm.tiles].map((x) => x.animationName))].join(",");
  const delayedBand = bandDelays.some((d) => parseFloat(d) !== 0);
  const delayedTile = tileDelays.some((d) => parseFloat(d) !== 0);
  assert(
    !delayedBand && !delayedTile,
    `reduced motion: the band reveal is still ACTIVE — animation-name "${revealNames}" on .band--reveal sections/tiles, durations collapsed to 1ms but stagger delays remain (bands [${bandDelays.join(", ")}], tiles [${tileDelays.join(", ")}]); with fill-mode backwards the staggered elements stay hidden/translated until their delay elapses. Spec §12 requires the band reveal to be DISABLED. First-frame snapshot: ${JSON.stringify(rm.firstFrame)}`,
  );
  await shot(page, "r1-01-results-reduced-motion.png");

  /* detail open under reduced motion */
  const sharpNames = await renderedTileNames(page, "sharp");
  await page.getByRole("button", { name: `View ${sharpNames[0]}`, exact: true }).tap();
  await expectDialog(page, `Reviewing ${sharpNames[0]}`);
  const detailMotion = await page.evaluate(() => {
    const read = (el) => {
      const cs = getComputedStyle(el);
      return { animationDuration: cs.animationDuration, animationDelay: cs.animationDelay, transitionDuration: cs.transitionDuration };
    };
    return {
      scrim: read(document.querySelector(".detail")),
      panel: read(document.querySelector(".detail__panel")),
    };
  });
  assert(isOneMs(detailMotion.scrim.animationDuration), `detail scrim animationDuration ${detailMotion.scrim.animationDuration} not collapsed`);
  assert(isOneMs(detailMotion.panel.animationDuration), `detail panel animationDuration ${detailMotion.panel.animationDuration} not collapsed`);
  assert(parseFloat(detailMotion.panel.animationDelay) === 0, `detail panel animationDelay ${detailMotion.panel.animationDelay} not 0`);
  assert(isOneMs(detailMotion.panel.transitionDuration), `detail panel transitionDuration ${detailMotion.panel.transitionDuration} not collapsed`);
  await shot(page, "r1-02-detail-reduced-motion.png");

  return `matchMedia reduce=true; bands ×3 + ${rm.tiles.length} tiles + button transition all ≤1ms (names "${revealNames}", durations ${rm.bands[0].animationDuration}), all stagger delays 0 (bands [${bandDelays.join(", ")}], tiles [${tileDelays.join(", ")}]) → reveal disabled, transforms none, 0 long-running animations; detail scrim/panel ${detailMotion.panel.animationDuration} collapsed`;
}

/* ------------------------------------------------------------------ */
/* HY — hygiene aggregate across every state this run drove            */
/* ------------------------------------------------------------------ */

async function stateHY({ page }) {
  await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
  await expectHeading(page, "Find the blurry photos", "hygiene empty heading");

  const violations = hygiene.filter(
    (h) =>
      h.kind === "console.error" ||
      h.kind === "console.warning" ||
      h.kind === "pageerror" ||
      h.kind === "requestfailed" ||
      /^http\.(4|5)/.test(h.kind),
  );
  if (violations.length > 0) {
    const summary = violations.map((h) => `[${h.tag}] ${h.kind}: ${h.text}`).join(" | ");
    throw new Error(`${violations.length} hygiene violation(s): ${summary}`);
  }
  const badStatus = netLog.filter((r) => r.status >= 400);
  assert(badStatus.length === 0, `HTTP ≥ 400 responses: ${JSON.stringify(badStatus.slice(0, 5))}`);
  const foreign = netLog.filter(
    (r) => appUrl && !r.url.startsWith(appUrl) && !r.url.startsWith("blob:") && !r.url.startsWith("data:"),
  );
  assert(foreign.length === 0, `non same-origin request(s): ${JSON.stringify(foreign.slice(0, 5))}`);
  const origin = appUrl ? new URL(appUrl).origin : "";

  return `zero console errors/warnings, pageerrors, failed requests, HTTP≥400 across every state; ${netLog.length} responses logged, all same-origin (${origin}; client-only app — no backend API by design)`;
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

    browser = await chromium.launch({ channel: "chrome", headless: true });
    console.log("Browser  channel:chrome (system Chrome, headless — binding directive)");

    console.log(`\n--- M1: mobile full flow @375 (touch emulation) ---`);
    await runState("M1", "Mobile full flow @375: pick → analyzing → results → tap-select → download → detail sheet → hint nav → Start over", stateM1, MOBILE_CONTEXT);

    console.log(`\n--- M2: touch-specific drop-hint hiding ---`);
    await runState("M2", "Touch-specific: 'or drop photos here' hidden (empty + all-failed) under touch, visible on desktop", stateM2, MOBILE_CONTEXT);

    console.log(`\n--- K1: keyboard-only full flow + focus rings ---`);
    await runState("K1", "Keyboard-only desktop flow: picker via Enter, Tab walk, Enter selection, downloads, detail Escape, Start over; rings everywhere", stateK1, DESKTOP_CONTEXT);

    console.log(`\n--- K2: focus containment under keyboard ---`);
    await runState("K2", "Focus containment: busy download keeps focus in panel; chevron-to-band-end parks focus on Done; Escape works", stateK2, DESKTOP_CONTEXT);

    console.log(`\n--- A1: announcement behavior ---`);
    await runState("A1", "Announcements: 6-photo batch throttled progress + exact completion; 2 toggles → '2 selected'", stateA1, DESKTOP_CONTEXT, ANNOUNCE_SPY);

    console.log(`\n--- R1: reduced motion ---`);
    await runState("R1", "Reduced motion: band/tile/panel motion collapses to 1ms per spec §12", stateR1, MOBILE_CONTEXT);

    console.log(`\n--- HY: hygiene aggregate (runs last) ---`);
    await runState("HY", "Hygiene: zero console errors/warnings/pageerrors/failed requests/HTTP≥400; same-origin only", stateHY, DESKTOP_CONTEXT);
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

  console.log("\n=== PHASE 6 E2E TESTER SUMMARY (independent run) ===");
  for (const r of results) {
    console.log(`${r.status.padEnd(5)} ${r.id.padEnd(4)} ${r.name}${r.flaky ? "  [FLAKY: passed on retry]" : ""}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
  console.log(`\nScreenshots (${shots.length}):`);
  for (const s of shots) console.log(`  e2e/artifacts/phase6-e2e-tester/${s.file}`);
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
