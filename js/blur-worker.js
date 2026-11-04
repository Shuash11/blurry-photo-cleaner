/**
 * blur-worker — the Phase 3 Web Worker (module worker).
 *
 * Receives one analysis job at a time from BlurAnalyzer, either as
 *   - an already-upright decoded ImageBitmap (transferred — zero-copy), or
 *   - raw RGBA pixels already downscaled to the working size
 *     (transferred ArrayBuffer; fallback path for engines whose workers
 *     lack OffscreenCanvas, prepared by BlurAnalyzer on the main thread).
 *
 * Pipeline (plan Phase 3, Decision Record route A):
 *   rasterize to working size → grayscale → 3×3 Laplacian → variance →
 *   normalized 0–100 score → band. All the tunable math lives in
 *   Thresholds.js, imported here so there is one source of truth.
 *
 * Protocol (with BlurAnalyzer):
 *   in  { type: "init" }
 *   out { type: "ready", bitmapInput: boolean }   — bitmapInput: this worker
 *       can rasterize transferred ImageBitmaps (OffscreenCanvas available);
 *       when false the analyzer must send pre-scaled pixels instead.
 *   in  { type: "analyze", jobId, photoId, bitmap? , pixels?, width?, height? }
 *   out { type: "result", jobId, photoId, ok, … }  — always one per analyze;
 *       ok:true carries { score, band, rawVariance }, ok:false carries
 *       { reason, message } ("zero-valid-pixels" | "too-small" |
 *       "worker-error").
 *
 * Determinism: fixed row-major iteration order, float64 accumulation,
 * two-pass variance (never the E[x²]−E[x]² shortcut, which loses precision
 * near zero). Same input → same raw variance, score, and band.
 *
 * Memory: the transferred bitmap is closed right after rasterizing; the
 * working ImageData and response array are per-job and unreachable when the
 * job ends. Nothing is cached between jobs.
 */

import {
  ALPHA_VISIBLE_MIN,
  bandForScore,
  normalizeScore,
  workingDimensions,
} from "./Thresholds.js";

/* Lifecycle flags — set by init, so the analyzer can fail fast if the worker
   starts up twice or in an unexpected order. */
let initialized = false;

self.onmessage = (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") {
    return;
  }

  if (msg.type === "init") {
    initialized = true;
    self.postMessage({
      type: "ready",
      // OffscreenCanvas in the worker ⇔ we can rasterize transferred bitmaps.
      bitmapInput: typeof OffscreenCanvas === "function",
    });
    return;
  }

  if (msg.type === "analyze") {
    self.postMessage(analyzeJob(msg));
  }
};

/* --------------------------------------------------------------------------
   Job analysis
   -------------------------------------------------------------------------- */

function analyzeJob(msg) {
  const { jobId, photoId } = msg;
  try {
    if (!initialized) {
      throw new Error("Worker received analyze before init");
    }
    const imageData = toWorkingImageData(msg);
    return { type: "result", jobId, photoId, ...scoreImageData(imageData) };
  } catch (error) {
    return {
      type: "result",
      jobId,
      photoId,
      ok: false,
      reason: "worker-error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Produce the working-size ImageData for a job. Bitmap input is downscaled
 * here (drawImage does the resampling); pixel input already arrives at the
 * working size (main thread used the same workingDimensions()).
 */
function toWorkingImageData(msg) {
  if (msg.bitmap) {
    const bitmap = msg.bitmap;
    const dims = workingDimensions(bitmap.width, bitmap.height);
    const imageData = rasterize(bitmap, dims);
    bitmap.close(); // release the transferred bitmap immediately (memory rule)
    return imageData;
  }

  if (msg.pixels instanceof ArrayBuffer) {
    const expected = msg.width * msg.height * 4;
    if (msg.pixels.byteLength !== expected) {
      throw new Error(`Pixel buffer is ${msg.pixels.byteLength} B, expected ${expected} B`);
    }
    return new ImageData(new Uint8ClampedArray(msg.pixels), msg.width, msg.height);
  }

  throw new Error("Job carried neither a bitmap nor a pixel buffer");
}

/** Draw a bitmap onto an OffscreenCanvas at the working size and read back RGBA. */
function rasterize(bitmap, dims) {
  if (typeof OffscreenCanvas !== "function") {
    // Analyzer negotiated the mode; reaching here means negotiation lied.
    throw new Error("OffscreenCanvas unavailable in worker");
  }
  const canvas = new OffscreenCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("OffscreenCanvas 2D context unavailable");
  }
  ctx.drawImage(bitmap, 0, 0, dims.width, dims.height);
  return ctx.getImageData(0, 0, dims.width, dims.height);
}

/* --------------------------------------------------------------------------
   Scoring — grayscale → Laplacian → variance → score/band
   -------------------------------------------------------------------------- */

function scoreImageData(imageData) {
  const { data, width, height } = imageData;

  // Zero-valid-pixel guard (plan acceptance): count visible pixels first.
  // A fully transparent image is skipped with a message — never scored 0.
  if (countVisiblePixels(data) === 0) {
    return {
      ok: false,
      reason: "zero-valid-pixels",
      message: "Image has no visible pixels (fully transparent).",
    };
  }

  const gray = toGrayscale(data, width, height);
  const rawVariance = laplacianVariance(gray, width, height);
  if (rawVariance === null) {
    return {
      ok: false,
      reason: "too-small",
      message: "Image is smaller than 3×3 pixels, nothing to analyze.",
    };
  }

  const score = normalizeScore(rawVariance);
  return { ok: true, score, band: bandForScore(score), rawVariance };
}

function countVisiblePixels(data) {
  let visible = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] >= ALPHA_VISIBLE_MIN) {
      visible += 1;
    }
  }
  return visible;
}

/**
 * Rec. 601 luma grayscale (0.299 R + 0.587 G + 0.114 B — OpenCV's default
 * conversion), with partially transparent pixels composited over white.
 * Compositing matches the Phase 2 thumbnail backdrop, so a sticker-like
 * PNG scores deterministically instead of depending on the canvas's
 * un-premultiplied RGB for transparent pixels (which getImageData leaves
 * unspecified). Opaque pixels (alpha 255) skip the arithmetic entirely.
 */
function toGrayscale(data, width, height) {
  const gray = new Uint8ClampedArray(width * height);
  let p = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a === 255) {
      gray[p++] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    } else {
      const t = (255 - a) / 255; // white contribution
      const f = a / 255;
      gray[p++] = Math.round(0.299 * (r * f + 255 * t) + 0.587 * (g * f + 255 * t) + 0.114 * (b * f + 255 * t));
    }
  }
  return gray;
}

/**
 * Laplacian variance over the grayscale working image (float64 view for the
 * arithmetic). The 3×3 kernel is applied to interior pixels only; the 1px
 * border is excluded — a deterministic, resolution-independent choice that
 * avoids OpenCV's border-reflection convention without changing the
 * measure's meaning (the border is < 2% of a 256px image).
 *
 * Returns the population variance mean((response − mean)²), or null when
 * the interior is empty (image smaller than 3×3 px).
 */
function laplacianVariance(gray, width, height) {
  const interiorW = width - 2;
  const interiorH = height - 2;
  if (interiorW <= 0 || interiorH <= 0) {
    return null;
  }

  const g = new Float64Array(gray); // one up-front widening pass; float64 math below
  const responses = new Float64Array(interiorW * interiorH);
  let k = 0;
  for (let y = 1; y <= interiorH; y += 1) {
    const row = y * width;
    for (let x = 1; x <= interiorW; x += 1) {
      const c = row + x;
      responses[k] = 4 * g[c] - g[c - 1] - g[c + 1] - g[c - width] - g[c + width];
      k += 1;
    }
  }

  // Two-pass population variance (stable near zero, deterministic order).
  let sum = 0;
  for (let i = 0; i < responses.length; i += 1) {
    sum += responses[i];
  }
  const mean = sum / responses.length;
  let squared = 0;
  for (let i = 0; i < responses.length; i += 1) {
    const d = responses[i] - mean;
    squared += d * d;
  }
  return squared / responses.length;
}
