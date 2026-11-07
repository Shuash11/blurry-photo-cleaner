/* Render docs/assets/figure1-system-flow.svg to a PNG for the Word report. */
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const svg = await readFile("docs/assets/figure1-system-flow.svg", "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 940, height: 420 }, deviceScaleFactor: 2 });
await page.setContent(
  `<html><body style="margin:0;background:#FFFFFF">${svg.replace('viewBox="0 0 920 400"', 'viewBox="0 0 920 400" width="940" height="409"')}</body></html>`,
  { waitUntil: "load" },
);
await page.waitForTimeout(250);
const buffer = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 940, height: 409 } });
await writeFile("docs/assets/figure1-system-flow.png", buffer);
console.log("figure PNG written:", buffer.length, "bytes");
await browser.close();
process.exit(0);
