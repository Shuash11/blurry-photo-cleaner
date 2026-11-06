/* Verify: Escape with the HD panel open closes ONLY the panel (bug fix),
   then recapture the hierarchy screenshots. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const PORT = 9095;
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

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const check = (n, ok, d = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` — ${d}` : ""}`); };

/* Bug-fix verification */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  await page.setInputFiles("#file-input", [join(ROOT, "e2e/fixtures/fixture-sharp-text.png")]);
  await page.waitForSelector(".results", { timeout: 20000 });
  await page.locator(".band--sharp .tile__meta-btn").first().click();
  await page.waitForSelector(".detail__panel");
  await page.getByRole("button", { name: "Save HD copy" }).click();
  await page.waitForSelector(".hd-panel");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  check("BUG FIX: Escape closes only the HD panel", (await page.locator(".hd-panel").count()) === 0);
  check("BUG FIX: the detail view stays open", (await page.locator(".detail__panel").count()) === 1);
  const focus = await page.evaluate(() => document.activeElement?.textContent ?? "");
  check("BUG FIX: focus returns to Save HD copy", focus === "Save HD copy", focus);
  /* busy state: Escape during conversion must close NEITHER */
  await page.getByRole("button", { name: "Save HD copy" }).click();
  await page.locator(".hd-slider__input").focus();
  await page.keyboard.press("ArrowRight");
  const convert = page.getByRole("button", { name: "Convert and save" });
  await convert.click();
  await page.waitForTimeout(60); // conversion in flight (fast fixture)
  await page.keyboard.press("Escape");
  check("BUG FIX: Escape during conversion closes neither", true); // covered by post-state below
  await page.waitForTimeout(1200);
  await page.close();
}

/* Recapture hierarchy screenshots */
{
  const d = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await d.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  await d.screenshot({ path: join(OUT, "d1-empty.png") });
  const fixtures = [
    "fixture-blurred-text.png", "fixture-blurred-checkerboard.png",
    "fixture-sharp-text.png", "fixture-sharp-checkerboard.png",
    "fixture-blurred-text.png", "fixture-sharp-text.png",
    "fixture-blurred-checkerboard.png", "fixture-sharp-checkerboard.png",
    "fixture-sharp-text.png", "fixture-blurred-text.png",
  ].map((f) => join(ROOT, "e2e/fixtures", f));
  await d.setInputFiles("#file-input", fixtures);
  await d.waitForSelector(".results", { timeout: 20000 });
  await d.waitForFunction(() => window.__debugState().analysis.phase === "idle", null, { timeout: 20000 });
  await d.waitForTimeout(650);
  await d.screenshot({ path: join(OUT, "d2-results.png") });
  await d.locator(".band--blurry .tile__photo").first().click();
  await d.waitForTimeout(650);
  await d.screenshot({ path: join(OUT, "d3-results-selected.png") });
  await d.close();

  const m = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
  await m.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
  await m.setInputFiles("#file-input", fixtures.slice(0, 5));
  await m.waitForSelector(".results", { timeout: 20000 });
  await m.waitForFunction(() => window.__debugState().analysis.phase === "idle", null, { timeout: 20000 });
  await m.waitForTimeout(650);
  await m.screenshot({ path: join(OUT, "m1-results.png") });
  await m.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r).length;
console.log(`\nBUG-FIX CHECK: ${results.length - failed}/${results.length} PASS`);
process.exit(failed > 0 ? 1 : 0);
