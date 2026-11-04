/**
 * BlurAnalyzer — orchestrates Phase 3 blur analysis (plan Phase 3).
 *
 * Owns the blur-worker lifecycle and the per-photo job queue. The heavy
 * work (rasterize → grayscale → Laplacian variance) happens in the worker;
 * this class only prepares inputs (decode upright via the shared Phase 2
 * decode path, downscale when the worker cannot) and dispatches.
 *
 * Contract with App:
 *   await analyzer.analyzeAll(photos, {
 *     onProgress({ done, total, current }) — per photo start (current = record)
 *     onResult(photo, { score, band })     — scored photo (App writes the store)
 *     onSkipped(photo, message)            — no visible pixels / too small
 *   })
 * Resolves with { scored, skipped } when the whole batch is done; throws on
 * an unexpected failure (worker crash, decode error) so App can show its
 * generic-error notice — photos already scored keep their scores and a
 * retry re-queues only records whose band is still null.
 *
 * Memory rules (plan Decision Record): one photo is decoded at a time and
 * the decoded original is never retained — ImageBitmaps are transferred to
 * the worker (closed there after rasterizing), fallback pixel buffers are
 * transferred and detach on post. Large batches therefore queue through a
 * single worker instead of decoding 100 photos at once.
 */

import { workingDimensions } from "./Thresholds.js";
import { decodeImage } from "./PhotoStore.js";

const WORKER_READY_TIMEOUT_MS = 10000;

export class BlurAnalyzer {
  #worker = null;
  #mode = null; // "bitmap" | "pixels" — negotiated with the worker at startup
  #handshake = null; // { resolve, reject } for the init round-trip
  #pending = new Map(); // jobId → { resolve, reject } for in-flight jobs
  #nextJobId = 1;

  /**
   * Score every photo, one at a time in array order. See class comment for
   * the handler contract. Photos are PhotoStore records (file/name/id).
   */
  async analyzeAll(photos, handlers = {}) {
    const { onProgress, onResult, onSkipped } = handlers;
    const summary = { scored: 0, skipped: 0 };

    if (photos.length > 0) {
      await this.#ensureWorker();
      let done = 0;
      for (const photo of photos) {
        onProgress?.({ done, total: photos.length, current: photo });
        const result = await this.#analyzeOne(photo);
        done += 1;
        if (result.ok) {
          summary.scored += 1;
          onResult?.(photo, result);
        } else {
          // Expected skip: zero visible pixels or too small to analyze.
          summary.skipped += 1;
          onSkipped?.(photo, result.message);
        }
      }
      onProgress?.({ done, total: photos.length, current: null });
    }
    return summary;
  }

  /** Terminate the worker and fail anything in flight. */
  dispose() {
    this.#teardown(new Error("Analyzer disposed"));
  }

  /* ------------------------------------------------------------------
     Worker lifecycle
     ------------------------------------------------------------------ */

  /** Create the worker once per session and negotiate the input mode. */
  async #ensureWorker() {
    if (this.#worker) {
      return;
    }

    const worker = new Worker(new URL("./blur-worker.js", import.meta.url), {
      type: "module", // imports Thresholds.js — one source of truth for the math
      name: "blur-worker",
    });
    this.#worker = worker;

    const ready = new Promise((resolve, reject) => {
      this.#handshake = { resolve, reject };
    });
    // Startup watchdog. If the handshake already settled this is a no-op.
    setTimeout(() => this.#handshake?.reject(new Error("Analysis worker did not start")), WORKER_READY_TIMEOUT_MS);

    worker.addEventListener("message", (event) => this.#handleMessage(event.data));
    worker.addEventListener("error", (event) => this.#handleWorkerError(event));
    worker.postMessage({ type: "init" });

    const bitmapInput = await ready;
    // Bitmap input when the worker can rasterize (OffscreenCanvas available);
    // pre-scaled pixels otherwise — the worker's math needs no canvas API
    // in that mode, so analysis still runs off the main thread everywhere.
    this.#mode = bitmapInput ? "bitmap" : "pixels";
  }

  #handleMessage(msg) {
    if (msg?.type === "ready") {
      this.#handshake?.resolve(Boolean(msg.bitmapInput));
      this.#handshake = null;
      return;
    }
    if (msg?.type === "result") {
      const job = this.#pending.get(msg.jobId);
      if (job) {
        this.#pending.delete(msg.jobId);
        job.resolve(msg);
      }
    }
  }

  /**
   * Script error inside the worker (load failure, uncaught exception):
   * fail the startup handshake and every in-flight job with the same error,
   * then drop the worker so the next batch starts fresh. analyzeAll's await
   * rethrows the error to App, which shows the generic-error notice.
   */
  #handleWorkerError(event) {
    this.#teardown(new Error(`Analysis worker crashed: ${event.message || "unknown error"}`));
  }

  /** Shared teardown: reject the handshake and all pending jobs, kill the worker. */
  #teardown(error) {
    this.#handshake?.reject(error);
    this.#handshake = null;
    this.#worker?.terminate();
    this.#worker = null;
    this.#mode = null;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const job of pending) {
      job.reject(error);
    }
  }

  /* ------------------------------------------------------------------
     Per-photo pipeline
     ------------------------------------------------------------------ */

  async #analyzeOne(photo) {
    const jobId = `j${this.#nextJobId}`;
    this.#nextJobId += 1;
    const payload = await prepareAnalysisInput(photo.file, this.#mode);
    return this.#request(jobId, photo.id, payload);
  }

  /** Post a job (transferring its buffers) and wait for the worker's result. */
  #request(jobId, photoId, payload) {
    return new Promise((resolve, reject) => {
      this.#pending.set(jobId, { resolve, reject });
      try {
        this.#worker.postMessage({ type: "analyze", jobId, photoId, ...payload }, payload.transfer);
      } catch (error) {
        this.#pending.delete(jobId);
        reject(new Error(`Could not send "${photoId}" to the analysis worker`, { cause: error }));
      }
    });
  }
}

/* --------------------------------------------------------------------------
   Input preparation (module-private)
   -------------------------------------------------------------------------- */

/**
 * Decode one file upright (shared Phase 2 decode path — EXIF honored) and
 * package it for the worker in the negotiated mode:
 *   - "bitmap": transfer the decoded ImageBitmap itself (zero main-thread
 *     resampling; the worker rasterizes). Ownership moves to the worker,
 *     which closes it after rasterizing — release() must NOT run, so this
 *     branch returns before the try/finally below. (If posting then fails,
 *     the bitmap is simply garbage-collected.)
 *   - "pixels": draw once to a working-size canvas, read the pixels back,
 *     and hand the worker the detached ArrayBuffer.
 * Both paths keep at most one decoded original alive at a time.
 */
async function prepareAnalysisInput(file, mode) {
  const decoded = await decodeImage(file);

  if (mode === "bitmap" && decoded.source instanceof ImageBitmap) {
    return {
      bitmap: decoded.source,
      transfer: [decoded.source],
    };
  }

  try {
    const dims = workingDimensions(decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable");
    }
    ctx.drawImage(decoded.source, 0, 0, dims.width, dims.height);
    const imageData = ctx.getImageData(0, 0, dims.width, dims.height);
    return {
      pixels: imageData.data.buffer,
      width: dims.width,
      height: dims.height,
      transfer: [imageData.data.buffer],
    };
  } finally {
    decoded.release(); // close the bitmap / revoke the object URL
  }
}
