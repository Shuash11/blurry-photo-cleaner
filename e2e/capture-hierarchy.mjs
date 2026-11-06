/* Hierarchy audit captures — desktop + mobile, all key states. Record only. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const PORT = 9091;
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (p === "" || p === "/") p = "index.html";
    res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream" });
    res.end(await readFile(join(ROOT, p)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const OUT = join(ROOT, "e2e", "artifacts", "hierarchy-audit");
await (await import("node:fs/promises")).mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const shots = [];
const snap = async (page, name) => {
  const f = join(OUT, `${name}.png`);
  await page.screenshot({ path: f });
  shots.push(f);
};

const fixtures = [
  "fixture-blurred-text.png", "fixture-blurred-checkerboard.png",
  "fixture-sharp-text.png", "fixture-sharp-checkerboard.png",
  "fixture-blurred-text.png", "fixture-sharp-text.png",
  "fixture-blurred-checkerboard.png", "fixture-sharp-checkerboard.png",
  "fixture-sharp-text.png", "fixture-blurred-text.png",
].map((f) => join(ROOT, "e2e/fixtures", f));

/* Desktop */
const d = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
d.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
d.on("console", (m) => { if (m.type() === "error") console.log(`[console.error] ${m.text()}`); });
await d.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
await snap(d, "d1-empty");
await d.setInputFiles("#file-input", fixtures);
await d.waitForSelector(".results", { timeout: 20000 });
await d.waitForFunction(() => window.__debugState().analysis.phase === "idle", null, { timeout: 20000 });
await d.waitForTimeout(600);
await snap(d, "d2-results");
// select two + action bar
await d.locator(".band--blurry .tile__photo").first().click();
await d.locator(".band--blurry .tile__photo").nth(1).click();
await d.waitForTimeout(700);
await snap(d, "d3-results-selected");
// detail
await d.locator(".band--blurry .tile__meta-btn").first().click();
await d.waitForSelector(".detail__panel");
await d.getByRole("button", { name: "Save HD copy" }).click();
await d.waitForSelector(".hd-panel");
await d.locator(".hd-slider__input").focus();
await d.keyboard.press("ArrowRight");
await d.waitForTimeout(350);
await snap(d, "d4-detail-hd");
  await d.keyboard.press("Escape");
  await d.locator(".detail__delete").click();
await d.waitForSelector(".confirm__panel");
await snap(d, "d5-delete-dialog");
await d.keyboard.press("Escape");
await d.keyboard.press("Escape");

/* Mobile */
const m = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
await m.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
await m.setInputFiles("#file-input", fixtures.slice(0, 5));
await m.waitForSelector(".results", { timeout: 20000 });
await m.waitForFunction(() => window.__debugState().analysis.phase === "idle", null, { timeout: 20000 });
await m.waitForTimeout(600);
await snap(m, "m1-results");
await m.locator(".band--blurry .tile__meta-btn").first().click();
await m.waitForSelector(".detail__panel");
await m.waitForTimeout(350);
await snap(m, "m2-detail");

await browser.close();
server.close();
console.log("CAPTURED:\n" + shots.join("\n"));
process.exit(0);
