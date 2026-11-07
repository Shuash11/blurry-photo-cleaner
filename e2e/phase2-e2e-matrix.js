/**
 * phase2-e2e-matrix.js — Phase 2 delegated state-matrix e2e proof for the
 * Blurry Photo Cleaner web app.
 *
 * Run:  node e2e/phase2-e2e-matrix.js
 *
 * Serves the app root in-process over http://127.0.0.1:<port> and drives
 * system Chrome (headless) through the Playwright LIBRARY. playwright-cli is
 * deliberately NOT used (it wedges on Windows — binding user directive).
 *
 * States proven (delegation state matrix, plans/blurry-photo-cleaner.md
 * Phase 2 + designs/design-spec.md §9a/§9e):
 *   S1  empty state — CTA visible, no stray actions; folder-pick control
 *       feature-gated (§11): absent from the DOM when no folder API exists
 *   S2  1 photo picked — tile filename + "96% sharp" chip (R4 re-scope
 *       2026-11-06: design-spec-v2 §11.2 layout consequence moved the tile's
 *       file-size caption to the detail view — §11.5, Phase R6), count updates
 *   S3  20+ photos (24) — every thumbnail renders, count correct
 *   S4  drag-drop — synthetic DataTransfer drop adds photos (desktop)
 *   S5  invalid file (.txt) — visible counted notice, excluded from gallery
 *   S6  undecodable file (.heic) — same notice path + HEIC helper, gallery intact
 *   S7  mixed batch — valid added, notice counts only failures, counts exclude skips
 *   S8  re-select/replace — re-select + "Add more" append; "Start over" (confirm
 *       accepted) clears and revokes every thumbnail object URL
 *   S9  all-failed batch — full-screen state + live-region announcement
 *       (regression lock for the F-2 fix)
 *   S10 console/network hygiene — zero console errors/warnings, pageerrors,
 *       failed requests, HTTP >= 400 in every state
 *   S11 contrast regression lock (F-1 fix; re-scoped for the Phase 4 §9c
 *       results screen and again for the v2 restyle, 2026-11-06) — "Start over"
 *       keeps the F-1 lock on the v2 single accent: computed color
 *       rgb(46,92,149) (--color-accent #3D74B8, design-spec-v2 §4.2/§4.7;
 *       the v1 rescue token --color-accent-text is retired per §4.8) and
 *       >= 4.5:1 at rest and scrolled over dark content. The "Add more" the
 *       F-1 fix originally locked was the PENDING-GRID text button; after
 *       analysis completes the app now shows the §9c results action bar,
 *       where "Add more" is the §8.1 secondary button whose label is
 *       --color-text — v2 value rgb(22,25,30) (#16191E, design-spec-v2
 *       §4.1/§4.7) — so the lock asserts that value + >= 4.5:1 on the results
 *       bar instead. Re-run + re-locked 2026-11-05 (Phase 4 e2e) and
 *       2026-11-06 (R3 v2 re-scope).
 *   S12 responsiveness — delegated states at the 375 px mobile base: CTA and
 *       gallery visible, no horizontal overflow
 *
 * Every state runs in its own fresh browser context (full isolation), every
 * step has an explicit timeout, the whole run has a watchdog, and the process
 * ALWAYS exits (0 = all states pass, 1 = a state failed, 2 = fatal/watchdog)
 * with browser and server closed. A state may retry at most twice; a state
 * that only passes on a retry is reported as flaky, never silently green.
 *
 * Screenshots: e2e/artifacts/phase2-e2e/
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

/* ------------------------------------------------------------------ */
/* Constants                                                            */
/* ------------------------------------------------------------------ */

const APP_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(APP_ROOT, "e2e", "fixtures");
const ARTIFACTS_DIR = path.join(__dirname, "artifacts", "phase2-e2e");
const BASE_PORT = 8981;
const STEP_TIMEOUT = 15000;   // every single step
const WATCHDOG_MS = 240000;   // whole run hard cap

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 812 };

// v2 restyle re-scope (design-spec-v2 §4.2/§4.7): the F-1 accent lock now
// asserts the single v2 accent #3D74B8 (rgb 46,92,149); its v1 rescue token
// --color-accent-text (#0F4CBD) is retired with no successor (§4.8).
const ACCENT_TEXT_STR = "rgb(130, 180, 236)"; // --color-accent-text #82B4EC (v0.4.0 dark: the "Start over" text token)
const ACCENT_TEXT_RGB = [130, 180, 236];
// §8.1 secondary button label (design-spec-v2 §4.1/§4.7 "Buttons": Secondary =
// --color-surface-muted fill + --color-text #16191E label) — the results-screen
// "Add more" after the Phase 4 §9c transition.
const SECONDARY_TEXT_STR = "rgb(242, 243, 245)"; // --color-text #16191E (v2)
const SECONDARY_TEXT_RGB = [242, 243, 245];
const ALL_FAILED_MSG = "Couldn't open those files. Nothing was added."; // F-2 fix copy
const STALE_MSG = "Gallery cleared."; // the stale message the F-2 defect showed
const FAILED_BODY =
  "Try JPEG or PNG photos — this browser couldn't decode them. Nothing was changed.";

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

const results = [];   // { id, name, status, detail, flaky }
const hygiene = [];   // { tag, kind, text } — console/pageerror/request issues
const dialogs = [];   // { tag, type, message }
const shots = [];     // { id, file }
let currentTag = "boot";
let server = null;
let browser = null;

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name));
}

const FIX = {
  sharpText: { name: "fixture-sharp-text.png", mime: "image/png", buffer: readFixture("fixture-sharp-text.png") },
  checker: { name: "fixture-sharp-checkerboard.png", mime: "image/png", buffer: readFixture("fixture-sharp-checkerboard.png") },
  txt: { name: "fixture-not-an-image.txt", mime: "text/plain", buffer: readFixture("fixture-not-an-image.txt") },
  heic: { name: "fixture-fake.heic", mime: "image/heic", buffer: readFixture("fixture-fake.heic") },
};

function asInput(f, nameOverride) {
  return { name: nameOverride || f.name, mimeType: f.mime, buffer: f.buffer };
}

/* ------------------------------------------------------------------ */
/* Reporting helpers                                                    */
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

async function shot(page, file) {
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, file), timeout: 10000 });
  shots.push({ id: currentTag, file });
  console.log(`      shot: e2e/artifacts/phase2-e2e/${file}`);
}

async function expectVisible(locator, label) {
  try {
    await locator.first().waitFor({ state: "visible", timeout: STEP_TIMEOUT });
  } catch (error) {
    throw new Error(`${label}: not visible (${String(error.message).split("\n")[0]})`);
  }
}

/** Wait for an exact visible text (count spans, filenames, notice copy). */
async function expectText(page, text, label) {
  await expectVisible(page.getByText(text, { exact: true }), label || `text "${text}"`);
}

/** Visible list items (tiles while the notice disclosure is closed; a user
    reading the grid sees exactly these). */
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

/** Text content of the visible tile whose text contains `name`. */
async function tileText(page, name) {
  const item = page.getByRole("listitem").filter({ visible: true, hasText: name }).first();
  return (await item.innerText()) || "";
}

/** Wait until the gallery holds exactly `expected` fully rendered images. */
function waitForGridImages(page, expected) {
  return page
    .waitForFunction(
      (expected) => {
        const imgs = Array.from(document.querySelectorAll(".photo-grid img"));
        return imgs.length === expected && imgs.every((img) => img.complete && img.naturalWidth > 0);
      },
      expected,
      { timeout: STEP_TIMEOUT, polling: 100 },
    )
    .catch(() => {
      throw new Error(`gallery: expected ${expected} fully loaded thumbnails (timed out)`);
    });
}

/** Parse an app-formatted size ("141 KB", "280 B") back to bytes + tolerance. */
function parseDisplayedSize(match) {
  const units = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4 };
  const value = parseFloat(match[1]);
  const exp = units[match[2]];
  const decimals = (match[1].split(".")[1] || "").length;
  return {
    bytes: value * Math.pow(1024, exp),
    tolerance: 0.5 * Math.pow(10, -decimals) * Math.pow(1024, exp) + 1,
  };
}

/* Live region (the app's role="status" announcer, §12) — read through the
   accessibility role target. Visually hidden but exposed to AT. */
async function statusText(page) {
  return page.getByRole("status").first().textContent();
}

async function waitForStatusText(page, expected) {
  await page
    .waitForFunction(
      (expected) => {
        const statuses = Array.from(document.querySelectorAll('[role="status"]'));
        return statuses.some((el) => el.textContent === expected);
      },
      expected,
      { timeout: STEP_TIMEOUT, polling: 80 },
    )
    .catch(async () => {
      const actual = await statusText(page).catch(() => "(unreadable)");
      throw new Error(`live region: expected "${expected}", got "${actual}"`);
    });
  return expected;
}

/* ------------------------------------------------------------------ */
/* Drag-drop (synthetic DataTransfer — real file drags cannot be
   synthesized; the app's own drop listener handles these events)       */
/* ------------------------------------------------------------------ */

async function armDrop(page, files) {
  const dataTransfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.mime }));
    }
    return dt;
  }, files.map((f) => ({ name: f.name, mime: f.mime, b64: f.buffer.toString("base64") })));
  const main = page.getByRole("main");
  await main.dispatchEvent("dragenter", { dataTransfer });
  await main.dispatchEvent("dragover", { dataTransfer });
  return dataTransfer;
}

async function fireDrop(page, dataTransfer) {
  await page.getByRole("main").dispatchEvent("drop", { dataTransfer });
}

/* ------------------------------------------------------------------ */
/* Contrast measurement (WCAG ratio + composited backdrop). The sample
   helper is installed before app scripts; it walks ancestors compositing
   every non-transparent background over white. Pixel sampling is used
   for the scrolled header, where content flows *beneath* a sibling.     */
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

const INSTALL_SAMPLE = () => {
  const parseRGB = (str) => {
    const m = /rgba?\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)(?:,\s*([\d.]+))?\)/.exec(str || "");
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  window.__f1sample = (el) => {
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
    return { fg: [fg.r, fg.g, fg.b], fgRaw: s.color, bg: bg || [255, 255, 255] };
  };
};

/** Dominant rendered color behind an element (pixel sample of its region). */
async function pixelBackdrop(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no bounding box for pixel sampling");
  const buf = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    timeout: 10000,
  });
  /* CSP note (R2 INF-2, index.html:36): the shipped policy is
     img-src 'self' blob: — a data: URL image is blocked. The screenshot is
     therefore loaded through a blob: object URL; the pixel math and every
     assertion on modeBg are unchanged. */
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    try {
      const img = new Image();
      img.src = blobUrl;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      const counts = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const key = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      let modeKey = null;
      let modeCount = 0;
      for (const [k, n] of counts) {
        if (n > modeCount) {
          modeCount = n;
          modeKey = k;
        }
      }
      const [r, g, b] = modeKey.split(",").map((v) => (+v << 3) + 4);
      return { modeBg: [r, g, b], pixels: data.length / 4, distinct: counts.size };
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }, buf.toString("base64"));
}

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
/* Static server (in-process; closed in finally)                        */
/* ------------------------------------------------------------------ */

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
/* Page wiring — console/pageerror/request hygiene + dialog capture     */
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
    if (res.status() >= 400) {
      hygiene.push({ tag, kind: `http.${res.status()}`, text: res.url() });
    }
  });
  page.on("dialog", (dialog) => {
    dialogs.push({ tag, type: dialog.type(), message: dialog.message() });
    dialog.accept().catch(() => {});
  });
}

/* ------------------------------------------------------------------ */
/* State runner — fresh context per attempt, max two retries            */
/* ------------------------------------------------------------------ */

async function runState(id, name, fn) {
  const MAX_ATTEMPTS = 3; // initial + two retries, per the flakiness rule
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
    try {
      detail = (await fn({ page, context, browser, tag, attempt })) || "";
    } catch (error) {
      ok = false;
      lastError = error;
      console.error(`      attempt ${attempt} failed: ${(error && error.message) || error}`);
      try {
        await page.screenshot({
          path: path.join(ARTIFACTS_DIR, `fail-${id}-try${attempt}.png`),
          timeout: 5000,
        });
        console.error(`      failure shot: e2e/artifacts/phase2-e2e/fail-${id}-try${attempt}.png`);
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
/* Main flow                                                            */
/* ------------------------------------------------------------------ */

(async () => {
  const watchdog = setTimeout(() => {
    console.error(`WATCHDOG: run exceeded ${WATCHDOG_MS / 1000}s — forcing exit (code 2).`);
    try { if (browser && browser.process()) browser.process().kill(); } catch { /* best effort */ }
    try { if (server) { server.closeAllConnections(); server.unref(); } } catch { /* best effort */ }
    process.exit(2);
  }, WATCHDOG_MS);

  let fatal = null;
  let appUrl = null;

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
        console.log(`  launch failed (${attempt.label}): ${String(error.message).split("\n")[0]}`);
      }
    }
    if (!browser) throw new Error("No browser could be launched.");

    /* ---------------- S1 — empty state + folder gate (§9a, §11) ---------------- */

    await runState("S1", "Empty state: CTA visible, no stray actions, folder control feature-gated", async ({ page, context, tag }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await expectVisible(page.getByRole("button", { name: "Choose photos" }), "Choose photos CTA");
      await expectVisible(page.getByRole("heading", { name: "Find the blurry photos" }), "empty-state heading");
      await expectText(page, "or drop photos here", "drop hint");
      await expectText(page, "Photos never leave this device.", "privacy line");

      const contextMenu = await page.getByRole("button", { name: "Start over" }).count();
      assert(contextMenu === 0, `"Start over" is visible in the empty state (${contextMenu} match) — §9a header has no actions`);

      const caps = await page.evaluate(() => ({
        secure: window.isSecureContext,
        showDirectoryPicker: typeof window.showDirectoryPicker,
        webkitdirectory: "webkitdirectory" in HTMLInputElement.prototype,
      }));
      const expectedFolderControl =
        (caps.secure && caps.showDirectoryPicker === "function") || caps.webkitdirectory;
      const folderCount = await page.getByRole("button", { name: "Choose folder" }).count();
      assert(
        (folderCount === 1) === expectedFolderControl,
        `folder control (${folderCount}) does not match detected capability ${JSON.stringify(caps)}`,
      );
      if (folderCount === 1) {
        await expectVisible(page.getByRole("button", { name: "Choose folder" }), "Choose folder button");
      }
      await shot(page, "01-empty-state.png");

      // Simulate a browser with NO folder-pick API at all: the control must be
      // absent from the DOM entirely — never disabled-looking (§11).
      const bare = await context.newPage();
      wirePage(bare, `${tag}:bare`);
      bare.setDefaultTimeout(STEP_TIMEOUT);
      await bare.addInitScript(() => {
        try { delete window.showDirectoryPicker; } catch { /* already absent */ }
        try { delete HTMLInputElement.prototype.webkitdirectory; } catch { /* not configurable */ }
      });
      await bare.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      const bareCaps = await bare.evaluate(() => ({
        showDirectoryPicker: typeof window.showDirectoryPicker,
        webkitdirectory: "webkitdirectory" in HTMLInputElement.prototype,
      }));
      assert(
        bareCaps.showDirectoryPicker !== "function" && !bareCaps.webkitdirectory,
        `capability simulation failed: ${JSON.stringify(bareCaps)}`,
      );
      const bareFolder = await bare.getByRole("button", { name: "Choose folder" }).count();
      assert(bareFolder === 0, `folder button exists (${bareFolder}) although no folder API is supported — §11 violation`);
      await expectVisible(bare.getByRole("button", { name: "Choose photos" }), "CTA on no-folder-API page");
      await shot(bare, "01b-empty-no-folder-api.png");
      await bare.close();

      return `caps ${JSON.stringify(caps)} → folder control ${folderCount === 1 ? "present (webkitdirectory fallback, §11 priority 2)" : "absent"}; with both APIs deleted the control is absent from the DOM`;
    });

    /* ---------------- S2 — 1 photo via the real CTA path ---------------- */

    await runState("S2", "1 photo picked: filename + \"96% sharp\" chip (R4 §11.2), count updates", async ({ page }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

      // Act like a user: click "Choose photos", feed the owning file chooser.
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: STEP_TIMEOUT }),
        page.getByRole("button", { name: "Choose photos" }).click({ timeout: STEP_TIMEOUT }),
      ]);
      await chooser.setFiles([asInput(FIX.sharpText)]);

      await expectText(page, FIX.sharpText.name, "tile filename");
      await expectText(page, "1 photo", "photo count");
      await waitForGridImages(page, 1);

      const names = await visibleTileNames(page);
      assert(
        names.length === 1 && names[0] === FIX.sharpText.name,
        `gallery shows ${JSON.stringify(names)} instead of the single expected tile`,
      );

      /* R4 re-scope (2026-11-06): design-spec-v2 §11.2 layout consequence —
         the tile's file-size caption yields its slot to the wider "NN% sharp"
         chip and moves to the detail view (§11.5, Phase R6). The old "N KB/MB"
         tile assertion is dropped with that citation; the same tile element is
         asserted on its NEW text instead: the R4 percentage chip, identity-
         mapped from the store score (96 → "96% sharp"). */
      await page.waitForFunction(
        () => {
          const num = document.querySelector(".photo-grid .tile .chip__num");
          return !!num && /^\d+% sharp$/.test(num.textContent.trim());
        },
        null,
        { timeout: STEP_TIMEOUT, polling: 25 },
      );
      const chipText = (await page.locator(".photo-grid .tile .chip__num").first().innerText()).trim();
      assert(
        chipText === "96% sharp",
        `tile chip "${chipText}", expected "96% sharp" for the fixture's locked score (R4 §11.2 identity mapping)`,
      );

      // State change: Start over appears once photos exist (pairs with S1).
      await expectVisible(page.getByRole("button", { name: "Start over" }), "Start over after selection");
      await shot(page, "02-single-photo.png");
      return `tile "${FIX.sharpText.name}" chip "${chipText}" (R4 §11.2; size caption now detail-only per §11.2/§11.5); count "1 photo"`;
    });

    /* ---------------- S3 — 24 photos ---------------- */

    await runState("S3", "Many photos (24): every thumbnail renders, count correct", async ({ page }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      const bulk = Array.from({ length: 24 }, (_, i) => ({
        name: `bulk-photo-${String(i + 1).padStart(2, "0")}.png`,
        mimeType: "image/png",
        buffer: i % 2 === 0 ? FIX.sharpText.buffer : FIX.checker.buffer,
      }));
      await page.setInputFiles("#file-input", bulk, { timeout: STEP_TIMEOUT });

      await expectText(page, "24 photos", "photo count");
      await waitForGridImages(page, 24);
      await expectText(page, "bulk-photo-01.png", "first tile");
      await expectText(page, "bulk-photo-24.png", "last tile");

      const names = await visibleTileNames(page);
      assert(names.length === 24, `visible tiles: ${names.length}, expected 24`);
      await shot(page, "03-many-photos.png");
      return `24/24 thumbnails rendered (naturalWidth > 0), count "24 photos", tiles ${names.length}`;
    });

    /* ---------------- S4 — drag-drop (desktop) ---------------- */

    await runState("S4", "Drag-drop: synthetic DataTransfer drop adds photos (desktop)", async ({ page }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      const dropFiles = [
        { name: "dropped-photo-1.png", mime: "image/png", buffer: FIX.checker.buffer },
        { name: "dropped-photo-2.png", mime: "image/png", buffer: FIX.sharpText.buffer },
      ];

      const dt = await armDrop(page, dropFiles);
      await page
        .waitForFunction(
          /* v2 re-scope (design-spec-v2 §4.2/§4.8): drag-over fill is
             --color-accent-subtle rgba(46,92,149,0.10); v1's literal was
             rgba(0,136,255,0.10). */
          () => getComputedStyle(document.querySelector("main")).backgroundColor === "rgba(109, 159, 216, 0.16)",
          null,
          { timeout: STEP_TIMEOUT, polling: 60 },
        )
        .catch(() => {
          throw new Error("dragover feedback: drop zone did not tint (expected rgba(46,92,149,0.1) — v2 --color-accent-subtle, §4.2)");
        });
      await shot(page, "04a-dragover-feedback.png");

      await fireDrop(page, dt);
      await expectText(page, "dropped-photo-1.png", "first dropped tile");
      await expectText(page, "dropped-photo-2.png", "second dropped tile");
      await expectText(page, "2 photos", "photo count after drop");
      await waitForGridImages(page, 2);

      const names = await visibleTileNames(page);
      assert(
        names.length === 2 && names.includes("dropped-photo-1.png") && names.includes("dropped-photo-2.png"),
        `tiles after drop: ${JSON.stringify(names)}`,
      );
      await shot(page, "04b-after-drop.png");
      return `dragover tint observed; drop added ${names.length} photos, count "2 photos"`;
    });

    /* ---------------- S5 — invalid file, gallery intact ---------------- */

    await runState("S5", "Invalid file (.txt): visible counted notice, excluded from gallery", async ({ page }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page.setInputFiles("#file-input", [asInput(FIX.sharpText)], { timeout: STEP_TIMEOUT });
      await expectText(page, "1 photo", "initial photo count");
      await waitForGridImages(page, 1);

      await page.setInputFiles("#file-input", [asInput(FIX.txt)], { timeout: STEP_TIMEOUT });
      await expectText(page, "1 file couldn't be opened", "undecodable notice heading");
      await expectVisible(page.getByText("Your browser can't decode these formats. They were skipped — nothing was changed.", { exact: true }), "notice body");

      const names = await visibleTileNames(page); // disclosure closed: tiles only
      assert(
        names.length === 1 && names[0] === FIX.sharpText.name,
        `skipped file leaked into the gallery: ${JSON.stringify(names)}`,
      );
      await expectText(page, "1 photo", "count unchanged after skip");

      await page.getByText("See the 1 file", { exact: true }).click({ timeout: STEP_TIMEOUT });
      await expectText(page, FIX.txt.name, "skipped filename listed in notice");
      await shot(page, "05-invalid-file-notice.png");
      return `notice "1 file couldn't be opened", gallery unchanged (${names.length} tile), skipped name listed in disclosure`;
    });

    /* ---------------- S6 — undecodable HEIC ---------------- */

    await runState("S6", "Undecodable file (.heic): same notice path, HEIC helper, gallery intact", async ({ page }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page.setInputFiles("#file-input", [asInput(FIX.sharpText)], { timeout: STEP_TIMEOUT });
      await expectText(page, "1 photo", "initial photo count");
      await waitForGridImages(page, 1);

      await page.setInputFiles("#file-input", [asInput(FIX.heic)], { timeout: STEP_TIMEOUT });
      await expectText(page, "1 file couldn't be opened", "undecodable notice heading");
      await expectText(page, "iPhone HEIC photos may need converting to JPEG first.", "HEIC helper line");

      const names = await visibleTileNames(page);
      assert(
        names.length === 1 && names[0] === FIX.sharpText.name,
        `HEIC leaked into the gallery: ${JSON.stringify(names)}`,
      );
      await expectText(page, "1 photo", "count unchanged after HEIC skip");

      await page.getByText("See the 1 file", { exact: true }).click({ timeout: STEP_TIMEOUT });
      await expectText(page, FIX.heic.name, "HEIC filename listed in notice");
      await shot(page, "06-undecodable-heic-notice.png");
      return `notice + HEIC helper visible, gallery intact (${names.length} tile)`;
    });

    /* ---------------- S7 — mixed batch ---------------- */

    await runState("S7", "Mixed batch: valid added, notice counts only failures, counts exclude skips", async ({ page }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page.setInputFiles(
        "#file-input",
        [asInput(FIX.sharpText), asInput(FIX.checker), asInput(FIX.txt), asInput(FIX.heic)],
        { timeout: STEP_TIMEOUT },
      );

      await expectText(page, "2 photos", "count excludes skipped files");
      await expectText(page, "2 files couldn't be opened", "notice counts only failures");
      await waitForGridImages(page, 2);

      const names = await visibleTileNames(page);
      const sorted = [...names].sort();
      assert(
        names.length === 2 && sorted[0] === FIX.checker.name && sorted[1] === FIX.sharpText.name,
        `gallery after mixed batch: ${JSON.stringify(names)}`,
      );

      await page.getByText("See the 2 files", { exact: true }).click({ timeout: STEP_TIMEOUT });
      await expectText(page, FIX.txt.name, "skipped txt listed");
      await expectText(page, FIX.heic.name, "skipped heic listed");
      await expectText(page, "2 photos", "count still excludes skipped");
      await shot(page, "07-mixed-batch.png");
      return `4 files in → 2 tiles (${names.join(", ")}), notice says "2 files couldn't be opened", count "2 photos"`;
    });

    /* ---------------- S8 — re-select / replace / revoke ---------------- */

    await runState("S8", "Re-select appends; Start over (confirm) clears and revokes object URLs", async ({ page, context, tag }) => {
      await context.addInitScript(REVOKE_SPY);
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

      await page.setInputFiles("#file-input", [asInput(FIX.sharpText)], { timeout: STEP_TIMEOUT });
      await expectText(page, "1 photo", "count after first pick");

      // Re-select the same file: the input resets, so it appends (§ landscape).
      await page.setInputFiles("#file-input", [asInput(FIX.sharpText)], { timeout: STEP_TIMEOUT });
      await expectText(page, "2 photos", "count after re-selecting the same file");

      // "Add more" is the in-gallery append affordance — use the real button.
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: STEP_TIMEOUT }),
        page.getByRole("button", { name: "Add more" }).click({ timeout: STEP_TIMEOUT }),
      ]);
      await chooser.setFiles([asInput(FIX.checker)]);
      await expectText(page, "3 photos", "count after Add more");
      await waitForGridImages(page, 3);

      const names = await visibleTileNames(page);
      assert(
        names.length === 3 &&
          names.filter((n) => n === FIX.sharpText.name).length === 2 &&
          names.includes(FIX.checker.name),
        `gallery after appends: ${JSON.stringify(names)}`,
      );
      const srcs = await page.$$eval(".photo-grid img", (imgs) => imgs.map((img) => img.src));
      assert(srcs.length === 3 && srcs.every((s) => s.startsWith("blob:")), `unexpected thumbnail srcs: ${JSON.stringify(srcs)}`);
      await shot(page, "08a-before-start-over.png");

      await page.getByRole("button", { name: "Start over" }).click({ timeout: STEP_TIMEOUT });
      const stateDialogs = dialogs.filter((d) => d.tag === tag);
      assert(
        stateDialogs.some((d) => d.type === "confirm" && /Start over\?/.test(d.message)),
        `native confirm not observed: ${JSON.stringify(stateDialogs)}`,
      );

      await expectVisible(page.getByRole("heading", { name: "Find the blurry photos" }), "empty state after Start over");
      await page.waitForFunction(() => document.querySelectorAll(".photo-grid img").length === 0, null, {
        timeout: STEP_TIMEOUT,
        polling: 100,
      });
      const startOverNow = await page.getByRole("button", { name: "Start over" }).count();
      assert(startOverNow === 0, `"Start over" still visible after clear (${startOverNow})`);

      const revoked = await page.evaluate(() => window.__revokeLog.slice());
      const missing = srcs.filter((src) => !revoked.includes(src));
      assert(
        missing.length === 0,
        `${missing.length}/${srcs.length} thumbnail object URLs were never revoked. Example: ${missing[0]}`,
      );
      await shot(page, "08b-after-start-over.png");
      return `re-select + "Add more" appended to 3 tiles; confirm "${stateDialogs.find((d) => d.type === "confirm").message}" accepted; ${srcs.length}/${srcs.length} object URLs revoked on clear`;
    });

    /* ---------------- S9 — all-failed batch + live region (F-2 lock) ---------------- */

    await runState("S9", "All-failed batch: full-screen state, live region announces outcome (F-2 lock)", async ({ page, context, tag }) => {
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });

      // Prime the exact stale message the F-2 defect showed ("Gallery cleared.")
      await page.setInputFiles("#file-input", [asInput(FIX.sharpText)], { timeout: STEP_TIMEOUT });
      await expectText(page, "1 photo", "priming count");
      await page.getByRole("button", { name: "Start over" }).click({ timeout: STEP_TIMEOUT });
      await waitForStatusText(page, STALE_MSG);
      const before = await statusText(page);

      await page.setInputFiles("#file-input", [asInput(FIX.txt), asInput(FIX.heic)], { timeout: STEP_TIMEOUT });
      await expectVisible(page.getByRole("heading", { name: "Couldn't open those files" }), "all-failed heading");
      await expectText(page, FAILED_BODY, "all-failed body copy");
      const after = await waitForStatusText(page, ALL_FAILED_MSG);
      assert(after !== before, "live region did not move off the stale message");

      const names = await visibleTileNames(page);
      assert(names.length === 0, `gallery present in the all-failed state: ${JSON.stringify(names)}`);
      await expectVisible(page.getByRole("button", { name: "Choose photos" }), "recovery CTA in all-failed state");
      await shot(page, "09a-all-failed-primed.png");

      // Fresh-page route: the announcement must fire from a pristine empty app too.
      const page2 = await context.newPage();
      wirePage(page2, `${tag}:fresh`);
      page2.setDefaultTimeout(STEP_TIMEOUT);
      await page2.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page2.setInputFiles("#file-input", [asInput(FIX.txt), asInput(FIX.heic)], { timeout: STEP_TIMEOUT });
      await expectVisible(page2.getByRole("heading", { name: "Couldn't open those files" }), "all-failed heading (fresh)");
      await waitForStatusText(page2, ALL_FAILED_MSG);
      await shot(page2, "09b-all-failed-fresh.png");
      await page2.close();

      return `live region moved "${before}" → "${after}"; fresh-page route announced the same; no gallery rendered`;
    });

    /* ---------------- S12 — mobile responsiveness (375 px base) ---------------- */

    await runState("S12", "Responsiveness at 375 px: CTA and gallery usable, no horizontal overflow", async ({ page }) => {
      await page.setViewportSize(MOBILE_VIEWPORT);
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await expectVisible(page.getByRole("button", { name: "Choose photos" }), "mobile CTA");
      const overflowEmpty = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
      assert(overflowEmpty <= 1, `empty state overflows horizontally by ${overflowEmpty}px at 375px`);

      await page.setInputFiles("#file-input", [asInput(FIX.sharpText), asInput(FIX.checker)], { timeout: STEP_TIMEOUT });
      await expectText(page, "2 photos", "mobile photo count");
      await waitForGridImages(page, 2);
      const names = await visibleTileNames(page);
      assert(names.length === 2, `mobile gallery shows ${names.length} tiles, expected 2`);
      await expectVisible(page.getByRole("button", { name: "Start over" }), "mobile Start over");
      await expectVisible(page.getByRole("button", { name: "Add more" }), "mobile Add more");
      const overflowGallery = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
      assert(overflowGallery <= 1, `gallery overflows horizontally by ${overflowGallery}px at 375px`);
      await shot(page, "12-mobile-gallery.png");
      return `375×812: CTA + 2-tile gallery + actions visible, zero horizontal overflow in both states`;
    });

    /* ---------------- S11 — contrast regression lock (F-1) ---------------- */

    await runState("S11", "Contrast lock: Start over v2 accent #3D74B8 + Add more §8.1 secondary, >=4.5:1 at rest + scrolled", async ({ page, context }) => {
      await context.addInitScript(INSTALL_SAMPLE);
      await page.goto(appUrl, { waitUntil: "load", timeout: STEP_TIMEOUT });
      await page.setInputFiles("#file-input", [asInput(FIX.sharpText), asInput(FIX.checker)], { timeout: STEP_TIMEOUT });
      // Phase 4 §9c: once analysis completes the view root moves to the
      // grouped results, whose action bar carries the §8.1 secondary
      // "Add more". The summary asserts that state (the old "2 photos"
      // toolbar count only exists on the transient pending screen).
      await expectText(page, "0 selected · 2 total", "results action-bar summary before contrast checks");
      await waitForGridImages(page, 2);

      const addMore = page.getByRole("button", { name: "Add more" });
      const startOver = page.getByRole("button", { name: "Start over" });
      await expectVisible(addMore, "Add more");
      await expectVisible(startOver, "Start over");

      const sampleEl = async (locator) => locator.evaluate((el) => window.__f1sample(el));

      // At rest — computed color + composited backdrop (analytic).
      const addRest = await sampleEl(addMore);
      const soRest = await sampleEl(startOver);
      // Phase 4 + v2 re-scope: "Add more" on results is the §8.1 secondary
      // button (--color-text #16191E); "Start over" carries the F-1 lock on
      // the v2 single accent #3D74B8 (design-spec-v2 §4.2/§4.7).
      assert(addRest.fgRaw === SECONDARY_TEXT_STR, `"Add more" color is ${addRest.fgRaw}, expected ${SECONDARY_TEXT_STR} (§8.1 secondary)`);
      assert(soRest.fgRaw === ACCENT_TEXT_STR, `"Start over" color is ${soRest.fgRaw}, expected ${ACCENT_TEXT_STR}`);
      const addRestRatio = contrastRatio(addRest.fg, addRest.bg);
      const soRestRatio = contrastRatio(soRest.fg, soRest.bg);
      assert(addRestRatio >= 4.5, `"Add more" at rest: ${addRestRatio.toFixed(2)}:1 < 4.5:1`);
      assert(soRestRatio >= 4.5, `"Start over" at rest: ${soRestRatio.toFixed(2)}:1 < 4.5:1`);

      // At rest — rendered pixel evidence of the actual backdrops.
      const addPx = await pixelBackdrop(page, addMore);
      const addPxRatio = contrastRatio(SECONDARY_TEXT_RGB, addPx.modeBg);
      assert(addPxRatio >= 4.5, `"Add more" rendered backdrop rgb(${addPx.modeBg}): ${addPxRatio.toFixed(2)}:1 < 4.5:1`);
      await shot(page, "11a-gallery-rest.png");

      // Scrolled state — dark content flows beneath the translucent header.
      const darkB64 = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 400;
        c.height = 400;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#20242C";
        ctx.fillRect(0, 0, 400, 400);
        ctx.fillStyle = "#3A4048";
        for (let i = 0; i < 40; i += 1) ctx.fillRect((i * 37) % 400, (i * 53) % 400, 22, 22);
        return c.toDataURL("image/png").split(",")[1];
      });
      const darkBuffer = Buffer.from(darkB64, "base64");
      const darks = Array.from({ length: 48 }, (_, i) => ({
        name: `dark-${String(i + 1).padStart(2, "0")}.png`,
        mimeType: "image/png",
        buffer: darkBuffer,
      }));
      await page.setInputFiles("#file-input", darks, { timeout: STEP_TIMEOUT });
      // Phase 4 §9c: the toolbar "50 photos" total moved to the action-bar
      // summary ("0 selected · 50 total") once the results screen renders.
      await expectText(page, "0 selected · 50 total", "results action-bar summary before scroll");
      await waitForGridImages(page, 50);

      // R6 re-scope (2026-11-06, design-spec-v2 §11.5.2): tiles now carry a
      // third meta row (per-tile Delete), so the page BOTTOM is light meta —
      // scrolling to scrollHeight puts the light delete rows under the
      // header instead of the dark photos. Scroll the last dark PHOTO under
      // the sticky header explicitly — the lock's intent is dark content
      // behind the translucent header.
      await page.evaluate(() => {
        // Pick the photo horizontally aligned with the "Start over" button —
        // the pixel sample reads what is behind THAT button, so the dark
        // tile must sit in the same column, then scroll its dark middle
        // under the translucent header.
        const btn = document.getElementById("start-over-btn");
        const photos = [...document.querySelectorAll(".tile__photo")];
        const br = btn.getBoundingClientRect();
        const btnX = (br.left + br.right) / 2;
        const target = photos
          .map((p) => ({ p, r: p.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0)
          .sort(
            (a, b) =>
              Math.abs((a.r.left + a.r.right) / 2 - btnX) -
              Math.abs((b.r.left + b.r.right) / 2 - btnX),
          )[0];
        window.scrollTo(0, window.scrollY + target.r.top + target.r.height / 2 - 24);
      });
      await page.waitForFunction(() => window.scrollY > 100, null, { timeout: STEP_TIMEOUT, polling: 100 });
      await expectVisible(startOver, "Start over while scrolled (sticky header)");

      const soScrolled = await sampleEl(startOver);
      assert(soScrolled.fgRaw === ACCENT_TEXT_STR, `"Start over" scrolled color is ${soScrolled.fgRaw}`);
      const soScrolledRatio = contrastRatio(soScrolled.fg, soScrolled.bg);
      assert(soScrolledRatio >= 4.5, `"Start over" scrolled analytic composite: ${soScrolledRatio.toFixed(2)}:1 < 4.5:1`);

      const soPx = await pixelBackdrop(page, startOver);
      const maxChannel = Math.max(...soPx.modeBg);
      assert(maxChannel < 245, `scrolled backdrop behind "Start over" is ~white rgb(${soPx.modeBg}) — dark content is not under the header`);
      const soPxRatio = contrastRatio(ACCENT_TEXT_RGB, soPx.modeBg);
      assert(soPxRatio >= 4.5, `"Start over" rendered backdrop rgb(${soPx.modeBg}): ${soPxRatio.toFixed(2)}:1 < 4.5:1`);

      // "Add more" surface never varies with scroll (#EEF1F4 v2 surface-muted, constant);
      // Phase 4 re-scope: label is --color-text (§8.1 secondary).
      const addScrolled = await sampleEl(addMore);
      assert(addScrolled.fgRaw === SECONDARY_TEXT_STR, `"Add more" scrolled color is ${addScrolled.fgRaw}, expected ${SECONDARY_TEXT_STR}`);
      const addScrolledRatio = contrastRatio(addScrolled.fg, addScrolled.bg);
      assert(addScrolledRatio >= 4.5, `"Add more" scrolled: ${addScrolledRatio.toFixed(2)}:1 < 4.5:1`);
      await shot(page, "11b-scrolled-dark-header.png");

      return [
        `rest: Add more ${addRest.fgRaw} on rgb(${addRest.bg.map(Math.round)}) ${addRestRatio.toFixed(2)}:1; Start over ${soRest.fgRaw} ${soRestRatio.toFixed(2)}:1;`,
        `rendered: Add more backdrop rgb(${addPx.modeBg}) ${addPxRatio.toFixed(2)}:1;`,
        `scrolled: Start over backdrop rgb(${soPx.modeBg}) ${soPxRatio.toFixed(2)}:1; Add more ${addScrolledRatio.toFixed(2)}:1`,
      ].join(" ");
    });

    /* ---------------- S10 — hygiene across every state (last) ---------------- */

    const errors = hygiene.filter(
      (h) =>
        h.kind === "console.error" ||
        h.kind === "pageerror" ||
        h.kind === "requestfailed" ||
        /^http\.(4|5)/.test(h.kind),
    );
    const warnings = hygiene.filter((h) => h.kind === "console.warning");
    currentTag = "S10";
    if (errors.length === 0 && warnings.length === 0) {
      record("S10", "Console/network hygiene: zero errors, warnings, pageerrors, failed requests", "PASS",
        `${hygiene.length} console/network events observed in any state — none were errors or warnings`);
    } else {
      const summary = [...errors, ...warnings].map((i) => `[${i.tag}] ${i.kind}: ${i.text}`).join(" | ");
      record("S10", "Console/network hygiene: zero errors, warnings, pageerrors, failed requests", "FAIL",
        `${errors.length} error(s) + ${warnings.length} warning(s): ${summary}`);
    }

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

  /* ---------------- summary ---------------- */

  console.log("\n=== PHASE 2 E2E STATE-MATRIX SUMMARY ===");
  for (const r of results) {
    console.log(`${r.status.padEnd(5)} ${r.id.padEnd(4)} ${r.name}${r.flaky ? "  [FLAKY: passed on retry]" : ""}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }
  console.log(`\nScreenshots (${shots.length}):`);
  for (const s of shots) console.log(`  e2e/artifacts/phase2-e2e/${s.file}`);
  if (dialogs.length > 0) {
    console.log(`Dialogs handled: ${dialogs.map((d) => `[${d.tag}] ${d.type}: "${d.message}"`).join("; ")}`);
  }
  const failed = results.filter((r) => r.status !== "PASS");
  const flaky = results.filter((r) => r.flaky);
  console.log(
    `\nVerdict: ${failed.length === 0 && !fatal ? "PASS" : "FAIL"} — ${results.length - failed.length}/${results.length} states passed` +
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
