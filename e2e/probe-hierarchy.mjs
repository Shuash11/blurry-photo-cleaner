/* Probe: computed styles of the tile delete button + hierarchy metrics */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const PORT = 9093;
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

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
const fixtures = ["fixture-sharp-text.png", "fixture-blurred-text.png"].map((f) => join(ROOT, "e2e/fixtures", f));
await page.setInputFiles("#file-input", fixtures);
await page.waitForSelector(".results", { timeout: 20000 });
await page.waitForFunction(() => window.__debugState().analysis.phase === "idle", null, { timeout: 20000 });

const info = await page.evaluate(() => {
  const del = document.querySelector(".tile__delete");
  const cs = getComputedStyle(del);
  const chip = document.querySelector(".chip");
  const meta = document.querySelector(".tile__meta-btn");
  const toggle = document.querySelector(".band--blurry .band__toggle");
  const summary = document.querySelector(".action-bar__summary");
  const addMore = document.querySelector(".action-bar__actions .btn-secondary");
  const dl = document.querySelector(".action-bar__actions .btn-primary");
  const m = (el) => {
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { color: c.color, fs: c.fontSize, fw: c.fontWeight, h: Math.round(r.height), w: Math.round(r.width) };
  };
  return {
    deleteBtn: { ...m(del), classes: del.className },
    chip: m(chip),
    metaBtn: m(meta),
    bandToggle: { ...m(toggle), text: toggle.textContent },
    summary: m(summary),
    addMore: m(addMore),
    download: m(dl),
    bandGap: (() => {
      const b = document.querySelector(".band--blurry");
      return getComputedStyle(b).marginBottom || getComputedStyle(b).paddingBottom;
    })(),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
server.close();
process.exit(0);
