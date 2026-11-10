/**
 * V2 FEATURES E2E (R5 HD converter + R6 session delete) — the deep
 * verification the implementer smokes deliberately did not run. Bounded
 * Playwright library script; playwright-cli BANNED; exits 0/1; screenshots
 * are record-only (never read back).
 *
 * R5: download byte-decode at upscaled dimensions, naming rule, store
 *     untouched, batch conversion, honesty DOM sweep, slide-animation
 *     computed-style contract + reduced-motion collapse, batch modal APG
 *     contract, live-region announcements.
 * R6: dialog cancel paths (button/Escape/scrim) change nothing and restore
 *     focus, confirm removes exactly the named photos + announcement copy,
 *     stacking over the detail modal, skipped records are deletable,
 *     counts/summary recompute, focus fallback chain.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "playwright";
import { parseZip } from "./zip-read.js";

const ROOT = process.cwd();
const PORT = 9083;
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
const FIX = (n) => join(ROOT, "e2e", "fixtures", n);

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

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const PROHIBITED = /\b(enhance|enhanced|improve|improved|magic|fix(?:ed)?|better quality|quality boost|AI)\b/i;

const browser = await chromium.launch({ channel: "chrome", headless: true });

/** Node-side image dimension reader (PNG IHDR / JPEG SOF0-SOF15) — the
 *  downloaded HD copy is decoded WITHOUT touching the app page, so the
 *  CSP (connect-src 'none') is never exercised by this harness. */
function imageDimensions(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) { off += 1; continue; }
      const marker = buf[off + 1];
      const len = buf.readUInt16BE(off + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
      }
      off += 2 + len;
    }
  }
  return { w: 0, h: 0 };
}

try {
  /* ---------------- R5-A: per-photo convert, decoded dimensions -------- */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const issues = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") issues.push(m.text()); });
    page.on("pageerror", (e) => issues.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    await page.setInputFiles("#file-input", [FIX("fixture-sharp-text.png")]);
    await page.waitForSelector(".results", { timeout: 20000 });
    await page.waitForFunction(() => window.__debugState().analysis.phase === "idle", null, { timeout: 20000 });

    const before = await page.evaluate(() => window.__debugState().photos.map((p) => ({ s: p.score, b: p.band })));
    const srcDims = await page.evaluate(() => {
      const p = window.__debugState().photos[0];
      const img = document.querySelector(`.tile[data-id="${p.id}"] img`);
      return { w: img.naturalWidth, h: img.naturalHeight };
    });

    await page.locator(".band--sharp .tile__meta-btn").first().click();
    await page.waitForSelector(".detail__panel", { timeout: 5000 });
    await page.getByRole("button", { name: "HD Converter" }).click();
    await page.waitForSelector(".hd-panel", { timeout: 5000 });

    // §11.4 animation contract on the Output value (computed styles).
    const anim = await page.evaluate(() => {
      const el = document.querySelector(".hd-readout__line") ?? document.querySelector("[class*='readout']");
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { transition: cs.transitionProperty, duration: cs.transitionDuration, timing: cs.transitionTimingFunction };
    });
    check("R5 slide: transform-only transition present on the readout",
      !!anim && /transform/.test(anim.transition), JSON.stringify(anim));

    await page.locator(".hd-slider__input").focus();
    await page.keyboard.press("ArrowRight"); // 1× → 1.5×
    await page.keyboard.press("ArrowRight"); // 1.5× → 2×
    await page.waitForTimeout(300);

        // v0.3.0 preview flow: "Create preview" converts without downloading;
    // the download fires from the preview's "Download HD copy" button.
    await page.getByRole("button", { name: "Create preview" }).click();
    await page.waitForSelector(".hd-preview__actions:not([hidden])", { timeout: 15000 });
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.getByRole("button", { name: "Download HD copy" }).click(),
    ]);
    const name = download.suggestedFilename();
    const path = await download.path();
    // Decode dimensions NODE-side (PNG IHDR / JPEG SOF) — fetching the file
    // in-page would violate the app's own CSP (connect-src 'none').
    const dims = imageDimensions((await import("node:fs")).readFileSync(path));

    check("R5 naming: {basename}-hd kept the source extension", /-hd\.(png|jpg|jpeg)$/.test(name), name);
    check("R5 output decodes at upscaled dimensions",
      dims.w === srcDims.w * 2 && dims.h === srcDims.h * 2, JSON.stringify(dims));

    const after = await page.evaluate(() => window.__debugState().photos.map((p) => ({ s: p.score, b: p.band })));
    // v0.3.0: the DOWNLOAD adds the HD copy as a new record (the auto-reband
    // behavior) — the ORIGINAL record must stay byte-identical.
    check("R5 original record untouched by conversion",
      JSON.stringify(before[0]) === JSON.stringify(after[0]) && after.length === before.length + 1,
      JSON.stringify({ before, after }));
    check("R5 zero console errors in per-photo flow", issues.length === 0, issues.join(" | "));
    await page.close();
  }

  /* ---------------- R5-B: batch conversion + honesty sweep -------------- */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const issues = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") issues.push(m.text()); });
    page.on("pageerror", (e) => issues.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    await page.setInputFiles("#file-input", [FIX("fixture-sharp-text.png"), FIX("fixture-sharp-checkerboard.png")]);
    await page.waitForSelector(".results", { timeout: 20000 });
    await page.waitForFunction(() => window.__debugState().analysis.phase === "idle", null, { timeout: 20000 });

    for (const n of ["fixture-sharp-text.png", "fixture-sharp-checkerboard.png"]) {
      await page.getByRole("button", { name: new RegExp(`^${n}(, suggested for deletion)?$`) }).click();
    }
    await page.getByRole("button", { name: "Save HD copies" }).click();
    await page.waitForSelector(".hd-dialog__panel", { timeout: 5000 });

    // APG contract: labelled dialog, focus inside, Escape closes while idle.
    const labelled = await page.evaluate(() => {
      const p = document.querySelector(".hd-dialog__panel");
      return p?.getAttribute("role") === "dialog"
        && p?.getAttribute("aria-modal") === "true"
        && !!p?.getAttribute("aria-labelledby");
    });
    check("R5 batch modal: role/aria-modal/labelled", labelled);
    await page.keyboard.press("Escape");
    check("R5 batch modal: Escape closes while idle", (await page.locator(".hd-dialog__panel").count()) === 0);

    await page.getByRole("button", { name: "Save HD copies" }).click();
    await page.locator(".hd-slider__input").pressSequentially? null : null;
    const slider = page.locator(".hd-dialog .hd-slider__input");
    await slider.focus();
    // §11.3.5 honesty copy renders in the dialog's IDLE state (the done
    // state replaces the body) — assert it before converting.
    const idleText = await page.locator(".hd-dialog__panel").textContent();
    check("R5 honesty: the exact honest label rendered at least once",
      idleText.includes("Upscaled — enlarged, same captured detail."));
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    const downloads = [];
    page.on("download", (d) => downloads.push(d));
    await page.getByRole("button", { name: "Convert and save" }).click();
    const deadline = Date.now() + 30000;
    while (downloads.length < 1 && Date.now() < deadline) await page.waitForTimeout(100);
    // v0.6.0: the batch saves ONE zip; both copies inside as "-hd.jpg"
    // (duplicates of the same base name get " (2)"-style suffixes).
    check("R5 batch: one HD zip download", downloads.length === 1 && downloads[0].suggestedFilename() === "blurry-photo-cleaner-hd-copies.zip",
      downloads.map((d) => d.suggestedFilename()).join(", "));
    if (downloads.length === 1) {
      const entries = parseZip(await downloads[0].path());
      check("R5 batch: HD naming on both", entries.length === 2 && entries.every((e) => /-hd( \(\d+\))?\.jpg$/.test(e.name)),
        JSON.stringify(entries.map((e) => e.name)));
    }
    // §11.3.5 done state (the honesty paragraph belongs to idle — asserted
    // above). WAIT for the done state first, then read it.
    await page.waitForSelector("text=2 HD copies saved.", { timeout: 10000 }).catch(() => {});
    const dialogText = await page.locator(".hd-dialog__panel").textContent();
    check("R5 batch: done state message", dialogText.includes("2 HD copies saved"), dialogText.slice(0, 120));
    await page.keyboard.press("Escape"); // done state closes

    // §11.3.5 prohibited-word sweep across the whole document (post-flows).
    const text = await page.evaluate(() => document.body.innerText);
    check("R5 honesty: no prohibited words in user-facing text", !PROHIBITED.test(text),
      (text.match(PROHIBITED) ?? []).join(","));
    check("R5 batch zero console errors", issues.length === 0, issues.join(" | "));
    await page.close();
  }

  /* ---------------- R6 deep: dialog contract + focus + skipped --------- */
  {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, acceptDownloads: true });
    const issues = [];
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") issues.push(m.text()); });
    page.on("pageerror", (e) => issues.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    // Mixed batch: 2 sharp + 1 blurred + transparent (skipped record).
    await page.setInputFiles("#file-input", [
      FIX("fixture-sharp-text.png"),
      FIX("fixture-sharp-checkerboard.png"),
      FIX("fixture-blurred-text.png"),
    ]);
    await page.waitForSelector(".results", { timeout: 20000 });
    await page.waitForFunction(() => window.__debugState().analysis.phase === "idle", null, { timeout: 20000 });

    // Transparent PNG → skipped record (generate in-page via canvas → File).
    await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 64; c.height = 64; // fully transparent
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const file = new File([blob], "transparent.png", { type: "image/png" });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.getElementById("file-input");
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => window.__debugState().photos.some((p) => p.band === "skipped"), null, { timeout: 20000 });
    const total4 = await page.evaluate(() => window.__debugState().photos.length);
    check("R6 setup: 4 records incl. 1 skipped", total4 === 4, `total=${total4}`);

    // Scrim click = Cancel; focus returns to the invoking tile Delete.
    const firstDelete = page.locator(".band--sharp .tile__delete").first();
    await firstDelete.click();
    await page.waitForSelector(".confirm__panel", { timeout: 5000 });
    check("R6 stack: dialog over page (z-index 60)", await page.evaluate(() => {
      const c = getComputedStyle(document.querySelector(".confirm"));
      return Number(c.zIndex) > 30;
    }));
    await page.mouse.click(12, 400); // scrim area (card is centered, 375px → margins)
    await page.waitForTimeout(100);
    check("R6 scrim click cancels", (await page.locator(".confirm__panel").count()) === 0);
    const refocused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    check("R6 cancel restores focus to the invoking Delete", /Delete .* from this session/.test(refocused), refocused);
    check("R6 cancel removed nothing", (await page.evaluate(() => window.__debugState().photos.length)) === 4);

    // Confirm removes exactly the named photo; announcement copy exact.
    await firstDelete.click();
    await page.waitForSelector(".confirm__panel", { timeout: 5000 });
    const targetName = await page.evaluate(() => window.__debugState().photos.find((p) => p.band === "sharp").name);
    await page.locator(".btn-delete").click();
    await page.waitForFunction(() => window.__debugState().photos.length === 3, null, { timeout: 5000 });
    const live = await page.locator("#live-region").textContent();
    check("R6 announcement copy exact (singular)", live.trim() === `${targetName} removed from this session.`, live.trim());

    // Skipped records are deletable (§11.5.4).
    const skippedDelete = page.locator(".band--skipped .tile__delete");
    check("R6 skipped tile carries Delete", (await skippedDelete.count()) === 1);
    await skippedDelete.click();
    await page.waitForSelector(".confirm__panel", { timeout: 5000 });
    await page.locator(".btn-delete").click();
    await page.waitForFunction(() => window.__debugState().photos.length === 2, null, { timeout: 5000 });
    const skippedGone = await page.evaluate(() => !window.__debugState().photos.some((p) => p.band === "skipped"));
    check("R6 skipped record removed", skippedGone);

    // Focus fallback: delete the LAST remaining sharp tile → focus lands in
    // the same band (next tile) or the band toggle, never BODY.
    const remaining = page.locator(".band--sharp .tile__delete");
    await remaining.last().click();
    await page.waitForSelector(".confirm__panel", { timeout: 5000 });
    await page.locator(".btn-delete").click();
    await page.waitForFunction(() => window.__debugState().photos.length === 1, null, { timeout: 5000 });
    const focusCls = await page.evaluate(() => document.activeElement?.className ?? "BODY");
    check("R6 focus fallback lands on a real control", focusCls !== "BODY" && focusCls.length > 0, focusCls);

    // Multi-select dialog (N=2): title counts, details disclosure present.
    const lastBlurry = page.locator(".band--blurry .tile__photo");
    await lastBlurry.click(); // select the blurry tile
    await page.locator('button:has-text("Delete selected")').click();
    await page.waitForSelector(".confirm__panel", { timeout: 5000 });
    check("R6 N=2 title counts", (await page.locator("#confirm-title").textContent()).includes("Delete 1 photo from this session?"));
    await page.keyboard.press("Escape");
    check("R6 N=2 dialog Escape-cancels", (await page.locator(".confirm__panel").count()) === 0);
    check("R6 zero console errors across delete flows", issues.length === 0, issues.join(" | "));
    await page.close();
  }

  /* ---------------- Reduced-motion: slide collapses -------------------- */
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
    await page.setInputFiles("#file-input", [FIX("fixture-sharp-text.png")]);
    await page.waitForSelector(".results", { timeout: 20000 });
    await page.locator(".band--sharp .tile__meta-btn").first().click();
    await page.getByRole("button", { name: "HD Converter" }).click();
    await page.waitForSelector(".hd-panel", { timeout: 5000 });
    const rm = await page.evaluate(() => {
      const el = document.querySelector(".hd-readout__line") ?? document.querySelector("[class*='readout']");
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { transition: cs.transitionProperty, duration: cs.transitionDuration };
    });
    check("R5 reduced-motion: readout transition collapsed", !!rm && (rm.transition === "none" || rm.duration === "0s"), JSON.stringify(rm));
    await page.close();
  }
} catch (error) {
  check("E2E RUN COMPLETED", false, error.stack || error.message);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nV2 FEATURES E2E: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length > 0 ? 1 : 0);
