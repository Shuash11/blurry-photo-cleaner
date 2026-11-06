/**
 * HDConverter — orchestrates the Phase R5 honest upscaling (plan v2 R5,
 * design-spec-v2 §11.3). UI-agnostic: it probes what this browser can do
 * for a photo and turns (photo, factor) into an encoded download Blob.
 * Nothing here touches the gallery, scores, or bands — outputs are blobs
 * the UI downloads and forgets (§11.3.7).
 *
 * Capability probe (§11.3.3 — never a hardcoded browser limit):
 *   probeMax(photo) decodes the photo once and walks the candidate factors
 *   (4× → 1.5×, 0.5 steps) from largest to smallest; for each it allocates
 *   a canvas at the exact target size, draws, and verifies the backing
 *   store is real (over-limit canvases can silently lose their buffer —
 *   the iOS-class behavior the probe exists to measure). The largest
 *   factor that passes becomes the photo's supported max; 1× means "no
 *   upscale possible" and the caller must treat the entry as ABSENT
 *   (§11.3.6 Unavailable — absent, never disabled). Results are cached per
 *   photo record (WeakMap — a fresh session's records re-probe).
 *
 * Conversion runs in js/upscale-worker.js (same-origin module worker —
 * fits the shipped CSP `worker-src 'self'`) when that worker has
 * OffscreenCanvas; otherwise — or when the worker cannot start at all —
 * the mandatory main-thread canvas fallback does the identical
 * drawImage-and-encode locally (plan Decision Record). Worker lifecycle
 * mirrors BlurAnalyzer: one init handshake with a watchdog, sequential
 * jobs, transferred buffers, terminate-on-teardown, and crash → rebuild on
 * the next job.
 */

import { JPEG_QUALITY, UPSCALE_CANDIDATE_FACTORS, hdOutputSpec, upscaleDimensions } from "./Thresholds.js";
import { decodeImage } from "./PhotoStore.js";

const WORKER_READY_TIMEOUT_MS = 10000;

export class HDConverter {
  #worker = null;
  #mode = null; // "worker" | "main" — negotiated at startup; "main" is sticky
  #handshake = null; // { resolve, reject } for the init round-trip
  #pending = new Map(); // jobId → { resolve, reject } for in-flight jobs
  #nextJobId = 1;
  #probeCache = new WeakMap(); // photo record → supported max factor
  #chain = Promise.resolve(); // conversion jobs run strictly one at a time

  /**
   * Supported max factor for a photo, 1–4 in 0.5 steps (§11.3.3). Resolves
   * from the cache when probed before. Never throws: any failure degrades
   * to 1× (the entry control disappears — the sanctioned Unavailable
   * behavior, §11.8 note 10).
   */
  async probeMax(photo) {
    const cached = this.#probeCache.get(photo);
    if (cached !== undefined) {
      return cached;
    }
    let max = 1;
    try {
      max = await runCapabilityProbe(photo);
    } catch {
      max = 1; // decode failed for a photo that already passed intake — degrade silently
    }
    this.#probeCache.set(photo, max);
    return max;
  }

  /**
   * Resample one photo to `factor` × its size and encode it. Resolves with
   * { blob, width, height, name, mime } — name/mime from hdOutputSpec so
   * the download and the UI's format line can never disagree. Rejects on
   * a real conversion failure (worker crash, encode error) — the caller
   * renders the §11.3.5 failed state; nothing in the app has changed.
   */
  async convert(photo, factor) {
    // Sequential discipline (BlurAnalyzer's): a new job waits for the
    // previous one; a previous failure does not poison the queue.
    const run = this.#chain.then(() => this.#convertNow(photo, factor), () => this.#convertNow(photo, factor));
    this.#chain = run.catch(() => { /* keep the chain settled for the next job */ });
    return run;
  }

  /** Terminate the worker and fail anything in flight ("Start over"). */
  dispose() {
    this.#teardown(new Error("HDConverter disposed"));
  }

  /* ------------------------------------------------------------------
     Worker lifecycle (mirror of BlurAnalyzer's)
     ------------------------------------------------------------------ */

  /** Create the worker once per session and negotiate the convert mode. */
  async #ensureWorker() {
    if (this.#mode === "main" || this.#worker) {
      return;
    }

    const worker = new Worker(new URL("./upscale-worker.js", import.meta.url), {
      type: "module",
      name: "upscale-worker",
    });
    this.#worker = worker;

    const ready = new Promise((resolve, reject) => {
      this.#handshake = { resolve, reject };
    });
    // Startup watchdog. If the handshake already settled this is a no-op.
    setTimeout(() => this.#handshake?.reject(new Error("Upscale worker did not start")), WORKER_READY_TIMEOUT_MS);

    worker.addEventListener("message", (event) => this.#handleMessage(event.data));
    worker.addEventListener("error", (event) => this.#handleWorkerError(event));
    worker.postMessage({ type: "init" });

    try {
      const canvasInWorker = await ready;
      if (canvasInWorker) {
        this.#mode = "worker"; // resampling + encoding run off the main thread
      } else {
        // No OffscreenCanvas in this worker: it can never help — park the
        // session in the main-thread fallback (plan-mandated path).
        worker.terminate();
        this.#worker = null;
        this.#mode = "main";
      }
    } catch (error) {
      this.#teardown(error); // so the NEXT job rebuilds instead of reusing a dead worker
      throw error;
    }
  }

  #handleMessage(msg) {
    if (msg?.type === "ready") {
      this.#handshake?.resolve(Boolean(msg.canvas));
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
   * Script error inside the worker: fail the handshake and every in-flight
   * job with the same error, then drop the worker so the next convert
   * rebuilds a fresh one (crash → rebuild). The current convert rejects →
   * the caller shows the §11.3.5 failed state.
   */
  #handleWorkerError(event) {
    this.#teardown(new Error(`Upscale worker crashed: ${event.message || "unknown error"}`));
  }

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
     Conversion
     ------------------------------------------------------------------ */

  async #convertNow(photo, factor) {
    const output = hdOutputSpec(photo.name);
    // One rounding rule (§11.3.2): the target the worker draws, the dims
    // announced to the live region, and the readout all come from here.
    const target = upscaleDimensions(photo.width, photo.height, factor);

    // Worker start failures are an AVAILABILITY question — the main-thread
    // fallback answers them (the plan's mandatory fallback). Job failures
    // after startup propagate as real conversion failures.
    let useWorker = false;
    try {
      await this.#ensureWorker();
      useWorker = this.#mode === "worker";
    } catch {
      useWorker = false;
    }

    if (useWorker) {
      const decoded = await decodeImage(photo.file);
      if (decoded.source instanceof ImageBitmap) {
        try {
          return await this.#convertViaWorker(photo.id, decoded.source, target, output);
        } catch (error) {
          if (this.#worker === null) {
            // The worker crashed mid-job: retry once on the fallback so a
            // transient worker death degrades to slower-but-working rather
            // than a spurious failure (crash → rebuild already ran).
            return this.#convertOnMainThread(photo.file, target, output);
          }
          throw error;
        }
      }
      decoded.release(); // SVG-class source: not transferable — fall through to the main path
      return this.#convertOnMainThread(photo.file, target, output);
    }
    return this.#convertOnMainThread(photo.file, target, output);
  }

  /** Transfer the bitmap; the worker draws, encodes, and transfers bytes back. */
  #convertViaWorker(photoId, bitmap, target, output) {
    const jobId = `h${this.#nextJobId}`;
    this.#nextJobId += 1;
    return new Promise((resolve, reject) => {
      this.#pending.set(jobId, { resolve, reject });
      try {
        this.#worker.postMessage(
          {
            type: "convert",
            jobId,
            photoId,
            bitmap,
            targetWidth: target.width,
            targetHeight: target.height,
            mime: output.mime,
            quality: JPEG_QUALITY,
          },
          [bitmap],
        );
      } catch (error) {
        this.#pending.delete(jobId);
        reject(new Error(`Could not send "${photoId}" to the upscale worker`, { cause: error }));
      }
    }).then((msg) => {
      if (!msg.ok) {
        throw new Error(msg.message || "Upscaling failed in the worker");
      }
      return {
        blob: new Blob([msg.buffer], { type: msg.mime }),
        width: msg.width,
        height: msg.height,
        name: output.name,
        mime: msg.mime,
      };
    });
  }

  /**
   * Mandatory main-thread fallback (plan Decision Record): identical
   * drawImage-with-high-smoothing resample and encode on a detached
   * canvas. Used when the worker lacks OffscreenCanvas, cannot start, or
   * the decoded source is not a transferable bitmap.
   */
  async #convertOnMainThread(file, target, output) {
    const decoded = await decodeImage(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas 2D context unavailable");
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(decoded.source, 0, 0, target.width, target.height);
      const blob = await canvasToBlob(canvas, output.mime, output.mime === "image/jpeg" ? JPEG_QUALITY : undefined);
      return { blob, width: target.width, height: target.height, name: output.name, mime: output.mime };
    } finally {
      decoded.release();
    }
  }
}

/* --------------------------------------------------------------------------
   Capability probe (§11.3.3 — allocate-and-test, module-private)
   -------------------------------------------------------------------------- */

/**
 * Walk the candidate factors largest-first and return the largest one this
 * browser can actually allocate, draw, and hold a real backing store for —
 * or 1× when none pass. Measures the real device: no browser, version, or
 * platform string is ever consulted (§11.3.3).
 */
async function runCapabilityProbe(photo) {
  const decoded = await decodeImage(photo.file);
  try {
    for (const factor of UPSCALE_CANDIDATE_FACTORS) {
      const target = upscaleDimensions(decoded.width, decoded.height, factor);
      if (canvasSupportsSize(decoded.source, target.width, target.height)) {
        return factor;
      }
    }
    return 1; // fully clamped: no upscale possible for this photo
  } finally {
    decoded.release();
  }
}

/**
 * Allocate-and-test one target size: create the canvas at exactly the
 * target dimensions (a silently clamped size fails immediately), draw the
 * photo into it, then prove the backing store is real by filling one pixel
 * and reading it back — an over-limit canvas can exist with a dead buffer
 * (alpha reads 0). Any throw is a "not supported". The allocation is
 * released in `finally` (width/height = 0 frees the backing store).
 */
function canvasSupportsSize(source, width, height) {
  let canvas = null;
  try {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    if (canvas.width !== width || canvas.height !== height) {
      return false; // the browser silently clamped/zeroed the size
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return false;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, width, height);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3] === 255;
  } catch {
    return false;
  } finally {
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

/** canvas.toBlob as a promise (the main-thread encode step). */
function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Encoding failed"));
        }
      },
      mime,
      quality,
    );
  });
}
