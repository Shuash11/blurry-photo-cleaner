/**
 * upscale-worker — the Phase R5 Web Worker (module worker, plan v2 R5).
 *
 * Resamples one photo to a larger pixel size entirely off the main thread:
 * the transferred (already upright, EXIF-honored) ImageBitmap is drawn onto
 * an OffscreenCanvas at the requested target size with
 * imageSmoothingQuality: "high" — plain canvas resampling that ENLARGES
 * PIXELS AND ADDS NO DETAIL (plan Decision Record) — then encodes the
 * result (JPEG at the job's quality, or PNG) and transfers the bytes back.
 *
 * Same-origin file worker: constructed from a URL (`new Worker(new
 * URL("./upscale-worker.js", import.meta.url))`), which the shipped CSP
 * `worker-src 'self'` (index.html) admits. Never a blob worker.
 *
 * Protocol (with HDConverter — data-only messages, blur-worker pattern):
 *   in  { type: "init" }
 *   out { type: "ready", canvas: boolean }  — canvas: OffscreenCanvas exists
 *       in this worker; when false the converter must use its main-thread
 *       canvas fallback (plan: "mandatory main-thread canvas fallback").
 *   in  { type: "convert", jobId, photoId, bitmap, targetWidth, targetHeight,
 *         mime, quality }
 *   out { type: "result", jobId, photoId, … }  — exactly one per convert.
 *       ok:true  carries { width, height, mime, buffer } — buffer is a
 *                transferred ArrayBuffer of the encoded image file.
 *       ok:false carries { reason: "worker-error", message }.
 *
 * Memory: the transferred bitmap is closed right after drawing; the
 * OffscreenCanvas and its context are per-job and unreachable when the job
 * ends. Nothing is cached between jobs. The result ArrayBuffer is
 * transferred (not copied) on postMessage.
 */

/* Lifecycle flag — set by init, mirroring blur-worker's fail-fast. */
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
      // OffscreenCanvas in the worker ⇔ we can resample transferred bitmaps.
      canvas: typeof OffscreenCanvas === "function",
    });
    return;
  }

  if (msg.type === "convert") {
    convertJob(msg).then((result) => {
      // Transfer the encoded bytes back zero-copy (blur-worker memory rule:
      // buffers move, never copy). Failed jobs carry no buffer to transfer.
      if (result.ok) {
        self.postMessage(result, [result.buffer]);
      } else {
        self.postMessage(result);
      }
    });
  }
};

/* --------------------------------------------------------------------------
   Job execution
   -------------------------------------------------------------------------- */

async function convertJob(msg) {
  const { jobId, photoId } = msg;
  try {
    if (!initialized) {
      throw new Error("Worker received convert before init");
    }
    const buffer = await resampleAndEncode(msg);
    return {
      type: "result",
      jobId,
      photoId,
      ok: true,
      width: msg.targetWidth,
      height: msg.targetHeight,
      mime: msg.mime,
      buffer,
    };
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
 * Draw the bitmap at the target size and encode. The bitmap's dimensions
 * are trusted as the source rect (the converter decoded it upright via the
 * shared Phase 2 path); the target comes from the caller, which computed it
 * through Thresholds.upscaleDimensions — the one rounding rule.
 */
async function resampleAndEncode(msg) {
  const bitmap = msg.bitmap;
  if (!bitmap) {
    throw new Error("Convert job carried no bitmap");
  }
  if (typeof OffscreenCanvas !== "function") {
    // HDConverter negotiated the mode; reaching here means negotiation lied.
    throw new Error("OffscreenCanvas unavailable in worker");
  }

  const canvas = new OffscreenCanvas(msg.targetWidth, msg.targetHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("OffscreenCanvas 2D context unavailable");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, msg.targetWidth, msg.targetHeight);
  bitmap.close(); // release the transferred bitmap immediately (memory rule)

  const blob = await canvas.convertToBlob({
    type: msg.mime,
    quality: msg.mime === "image/jpeg" ? msg.quality : undefined,
  });
  const buffer = await blob.arrayBuffer();
  return buffer;
}
