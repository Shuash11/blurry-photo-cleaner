/**
 * Phase 5 security verification — bounded live check (Playwright library, no CLI).
 *
 * What it proves, in one run against the locally served app:
 *   1. Every request the page makes stays on the local origin (all non-local
 *      requests are aborted and recorded — target: zero aborted).
 *   2. The full flow works with that blocking in place: empty -> choose files
 *      (2 decodable fixtures + 1 invalid) -> skipped-file notice -> results.
 *   3. The Web Worker analysis completes under the blocked network.
 *   4. No photo/blob data is written anywhere: localStorage, sessionStorage,
 *      cookies, IndexedDB, Cache API, service workers — checked early and late.
 *   5. The download of a selected photo is the original file byte-for-byte
 *      (sha256 equal), under its original filename — nothing synthesized.
 *   6. window.__debugState() carries no blob:/data: URLs or file contents.
 *
 * Exit codes: 0 = all checks pass; 1 = check failure; 2 = fatal error.
 * Test tooling only — not part of the app deliverable.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");

const APP_ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
};

function startServer() {
  const srv = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const full = path.resolve(APP_ROOT, rel);
    if (!full.startsWith(APP_ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => srv.listen(0, "127.0.0.1", () => resolve(srv)));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readStorage(page) {
  return page.evaluate(async () => {
    const out = { localStorage: [], sessionStorage: [], cookie: "", indexedDB: [], caches: [], serviceWorkers: [] };
    try { out.localStorage = Object.keys(window.localStorage); } catch (e) { out.localStorage = ["error: " + e.message]; }
    try { out.sessionStorage = Object.keys(window.sessionStorage); } catch (e) { out.sessionStorage = ["error: " + e.message]; }
    out.cookie = document.cookie;
    try { out.indexedDB = (await indexedDB.databases()).map((d) => d.name); } catch (e) { out.indexedDB = ["error: " + e.message]; }
    try { out.caches = await caches.keys(); } catch (e) { out.caches = ["error: " + e.message]; }
    try { out.serviceWorkers = (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope); } catch (e) { out.serviceWorkers = ["error: " + e.message]; }
    return out;
  });
}

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail });
}

(async () => {
  const server = await startServer();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();

    const blocked = [];
    const consoleIssues = [];
    const sameOriginFailed = [];
    const requestURLs = [];

    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleIssues.push(`${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => consoleIssues.push(`pageerror: ${e.message}`));
    page.on("requestfailed", (r) => { if (r.url().startsWith(origin)) sameOriginFailed.push(`${r.url()} — ${r.failure() ? r.failure().errorText : "?"}`); });

    await context.route("**/*", (route) => {
      const u = route.request().url();
      requestURLs.push(u);
      if (u.startsWith(origin) || u.startsWith("blob:") || u.startsWith("data:") || u.startsWith("about:")) {
        return route.continue();
      }
      blocked.push(u);
      return route.abort();
    });

    await page.goto(`${origin}/index.html`, { waitUntil: "load" });
    await page.waitForSelector(".empty-state", { timeout: 10000 });
    const storageEarly = await readStorage(page);

    await page.setInputFiles("#file-input", [
      path.join(FIXTURES, "fixture-sharp-checkerboard.png"),
      path.join(FIXTURES, "fixture-blurred-checkerboard.png"),
      path.join(FIXTURES, "fixture-not-an-image.txt"),
    ]);

    await page.waitForSelector(".notice", { timeout: 30000 });
    await page.waitForSelector(".results", { timeout: 60000 });

    const state = await page.evaluate(() => window.__debugState());

    // Select the first tile and download it; compare name and bytes to source.
    const firstTileName = (await page.locator(".results .tile").first().locator(".tile__filename").textContent()).trim();
    await page.locator(".results .tile__photo").first().click();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.locator(".action-bar .btn-primary").click(),
    ]);
    const suggested = download.suggestedFilename();
    const dlPath = path.join(os.tmpdir(), `phase5-dl-${Date.now()}-${suggested}`);
    await download.saveAs(dlPath);
    const dlHash = sha256(dlPath);
    const srcName = fs.existsSync(path.join(FIXTURES, suggested)) ? suggested : firstTileName;
    const srcPath = path.join(FIXTURES, srcName);
    const srcHash = fs.existsSync(srcPath) ? sha256(srcPath) : null;

    const storageLate = await readStorage(page);
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name));
    const debugJson = JSON.stringify(state);

    /* ---------------- verifications ---------------- */
    check("zero non-localhost page requests (target: 0)", blocked.length === 0, `blocked=${JSON.stringify(blocked)}`);
    check("zero console errors/warnings and page errors", consoleIssues.length === 0, JSON.stringify(consoleIssues));
    check("zero same-origin request failures", sameOriginFailed.length === 0, JSON.stringify(sameOriginFailed));
    check("skipped-file notice shown for the invalid file", state.skippedFiles.includes("fixture-not-an-image.txt"), `skippedFiles=${JSON.stringify(state.skippedFiles)}`);
    check("worker analysis completed under blocked network (2 photos scored)", state.photos.length === 2 && state.photos.every((p) => p.band && typeof p.score === "number"), `photos=${JSON.stringify(state.photos.map((p) => [p.name, p.band, p.score]))}`);
    const bandByName = new Map(state.photos.map((p) => [p.name, p.band]));
    check("fixtures classified as calibrated (sharp fixture sharp, blurred fixture blurry)", bandByName.get("fixture-sharp-checkerboard.png") === "sharp" && bandByName.get("fixture-blurred-checkerboard.png") === "blurry", `bands=${JSON.stringify(state.photos.map((p) => [p.name, p.band]))}`);
    check("download keeps original filename", suggested === firstTileName, `suggested=${suggested} tile=${firstTileName}`);
    check("download is the original bytes (sha256 match)", srcHash !== null && dlHash === srcHash, `download=${dlHash} source=${srcHash}`);
    check("no blob:/data: strings in __debugState()", !debugJson.includes("blob:") && !debugJson.includes("data:"), `debugState=${debugJson}`);
    check("no storage written (early)", storageEarly.localStorage.length === 0 && storageEarly.sessionStorage.length === 0 && storageEarly.cookie === "" && storageEarly.indexedDB.length === 0 && storageEarly.caches.length === 0 && storageEarly.serviceWorkers.length === 0, JSON.stringify(storageEarly));
    check("no storage written (late)", storageLate.localStorage.length === 0 && storageLate.sessionStorage.length === 0 && storageLate.cookie === "" && storageLate.indexedDB.length === 0 && storageLate.caches.length === 0 && storageLate.serviceWorkers.length === 0, JSON.stringify(storageLate));
    check("all resource-timing entries same-origin/blob", resources.every((u) => u.startsWith(origin) || u.startsWith("blob:")), JSON.stringify(resources));
    check("all attempted request URLs local/blob/data/about", requestURLs.every((u) => u.startsWith(origin) || u.startsWith("blob:") || u.startsWith("data:") || u.startsWith("about:")), JSON.stringify(requestURLs));

    const failures = checks.filter((c) => !c.pass);
    console.log(JSON.stringify({
      origin,
      checksTotal: checks.length,
      checksPassed: checks.length - failures.length,
      failures,
      blockedRequests: blocked,
      requestCount: requestURLs.length,
      storageEarly,
      storageLate,
      resourceTiming: resources,
    }, null, 2));

    fs.rmSync(dlPath, { force: true });
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (error) {
    console.error(`FATAL: ${error && error.stack ? error.stack : error}`);
    process.exitCode = 2;
  } finally {
    await browser.close().catch(() => {});
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close();
  }
  // Explicit exit: guarantees no lingering handles from a partial run.
  process.exit(process.exitCode || 0);
})();
