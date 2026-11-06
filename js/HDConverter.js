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

import { HD_POOL_SIZE, JPEG_QUALITY, UPSCALE_CANDIDATE_FACTORS, hdOutputSpec, upscaleDimensions } from "./Thresholds.js";
import { decodeImage } from "./PhotoStore.js";
import { applyUnsharp } from "./sharpen.js";

const WORKER_READY_TIMEOUT_MS = 10000;

export class HDConverter {
  /* v0.3.0 worker pool (user request: parallel conversion for ≥25-photo
     batches): HD_POOL_SIZE same-origin workers share the job queue. Each
     slot is { worker, busy }; #idle is the free-slot stack, #waitQ the FIFO
     of jobs waiting for a slot. One negotiated convert mode for the pool
     ("worker" | "main"); the main-thread fallback stays single-lane (it is
     the degraded path, and it blocks the main thread anyway). */
  #pool = []; // [{ worker, busy }]
  #idle = []; // free worker slots (LIFO — warm workers are reused first)
  #waitQ = []; // { run(slot), reject } — FIFO
  #mode = null; // "worker" | "main" — negotiated at startup; "main" is sticky
  #handshake = null; // { resolve, reject } for the init round-trip
  #pending = new Map(); // jobId → { resolve, reject } for in-flight jobs
  #nextJobId = 1;
  #probeCache = new WeakMap(); // photo record → supported max factor

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
   * Resample one photo to `factor` × its size, optionally sharpen, and
   * encode it as `opts.format` ("png" | "jpeg" | "webp" — undefined keeps
   * the v0.1 source-derived default). Resolves with
   * { blob, width, height, name, mime } — name/mime from hdOutputSpec so
   * the download and the UI's format line can never disagree. Rejects on
   * a real conversion failure (worker crash, encode error) — the caller
   * renders the §11.3.5 failed state; nothing in the app has changed.
   *
   * v0.3.0 pool semantics: callers may fire MANY converts concurrently —
   * the pool runs HD_POOL_SIZE of them in parallel and the rest wait in
   * FIFO order. This is what converts a 25-photo batch in waves instead of
   * one-at-a-time.
   */
  convert(photo, factor, opts = {}) {
    const sharpen = typeof opts.sharpen === "number" && opts.sharpen > 0 ? opts.sharpen : 0;
    const format = typeof opts.format === "string" ? opts.format : undefined;
    return this.#acquireSlot(
      (slot) => this.#convertNow(photo, factor, sharpen, format, slot),
    );
  }

  /**
   * Take a free pool slot (or queue until one frees) and run the job. The
   * convert mode is negotiated HERE, before any slot math — a first call
   * negotiates, grows the pool to one worker, and runs immediately;
   * subsequent concurrent calls grow the pool up to HD_POOL_SIZE (the
   * ≥25-photo batch then converts in ⌈25/size⌉ parallel waves) and only
   * queue when every slot is busy.
   */
  async #acquireSlot(run) {
    try {
      await this.#ensureMode();
    } catch {
      this.#mode = "main"; // cannot even probe → the mandatory fallback
    }
    if (this.#mode === "main") {
      // Main-thread fallback: single lane by necessity (it blocks the UI).
      const run0 = this.#mainChain.then(run, run);
      this.#mainChain = run0.catch(() => { /* keep the chain settled */ });
      return run0;
    }
    const slot = this.#idle.pop();
    if (slot) {
      return run(slot);
    }
    if (this.#pool.length < HD_POOL_SIZE) {
      const fresh = await this.#growPool();
      if (fresh) {
        return run(fresh);
      }
    }
    return new Promise((resolve, reject) => {
      this.#waitQ.push({ run, resolve, reject });
    });
  }

  #mainChain = Promise.resolve(); // fallback single lane

  /** Release a slot back to the pool and hand it the next waiting job. */
  #releaseSlot(slot) {
    if (!slot) {
      return; // main-thread-fallback jobs run without a pool slot
    }
    const next = this.#waitQ.shift();
    if (next) {
      next.run(slot).then(next.resolve, next.reject);
    } else {
      this.#idle.push(slot);
    }
  }

  /** Terminate every worker and fail anything in flight ("Start over"). */
  dispose() {
    this.#teardown(new Error("HDConverter disposed"));
  }

  /* ------------------------------------------------------------------
      Worker lifecycle (pool edition)
      ------------------------------------------------------------------ */

  /** Negotiate the convert mode once — ALL concurrent callers share this
   *  exact promise (the v0.3.0 race: two simultaneous first converts each
   *  created a probe worker and overwrote the single #handshake field, so
   *  one caller's await never resolved and its job hung forever). */
  #modePromise = null;

  async #ensureMode() {
    if (this.#mode) {
      return this.#mode;
    }
    if (!this.#modePromise) {
      this.#modePromise = this.#negotiateMode();
    }
    return this.#modePromise;
  }

  async #negotiateMode() {
    const probe = new Worker(new URL("./upscale-worker.js", import.meta.url), {
      type: "module",
      name: "upscale-worker-probe",
    });
    const ready = new Promise((resolve, reject) => {
      this.#handshake = { resolve, reject };
    });
    setTimeout(() => this.#handshake?.reject(new Error("Upscale worker did not start")), WORKER_READY_TIMEOUT_MS);
    probe.addEventListener("message", (event) => this.#handleHandshake(event.data));
    probe.addEventListener("error", (event) => this.#handshake?.reject(new Error(event.message || "worker error")));
    probe.postMessage({ type: "init" });
    try {
      const canvasInWorker = await ready;
      if (canvasInWorker) {
        this.#mode = "worker";
        // The probe worker becomes pool slot 0; the rest are created on
        // demand as the queue depth requires (no idle fan-out cost).
        this.#pool.push({ worker: probe, busy: false });
        // Slot 0 needs the full result handler — the handshake listener
        // above only handles "ready".
        probe.addEventListener("message", (event) => this.#handleMessage(this.#pool[0], event.data));
        this.#idle.push(this.#pool[0]);
        return "worker";
      }
      probe.terminate();
      this.#mode = "main";
      return "main";
    } catch (error) {
      probe.terminate();
      this.#mode = "main"; // cannot start → the plan's mandatory fallback
      return "main";
    }
  }

  /** Grow the pool by one warm worker (capped at HD_POOL_SIZE). */
  async #growPool() {
    if (this.#pool.length >= HD_POOL_SIZE) {
      return null;
    }
    const worker = new Worker(new URL("./upscale-worker.js", import.meta.url), {
      type: "module",
      name: `upscale-worker-${this.#pool.length}`,
    });
    const slot = { worker, busy: true };
    this.#pool.push(slot);
    worker.addEventListener("message", (event) => this.#handleMessage(slot, event.data));
    worker.addEventListener("error", () => {
      // Crash → fail this slot's in-flight job; the slot dies. The next
      // convert grows a fresh worker (crash → rebuild, pool edition).
      this.#pending.forEach((job, jobId) => {
        if (job.slot === slot) {
          this.#pending.delete(jobId);
          job.reject(new Error("Upscale worker crashed"));
        }
      });
      this.#pool = this.#pool.filter((s) => s !== slot);
      this.#idle = this.#idle.filter((s) => s !== slot);
    });
    worker.postMessage({ type: "init" });
    return slot;
  }

  #handleHandshake(msg) {
    if (msg?.type === "ready") {
      this.#handshake?.resolve(Boolean(msg.canvas));
      this.#handshake = null;
    }
  }

  #handleMessage(slot, msg) {
    if (msg?.type === "result") {
      slot.busy = false;
      const job = this.#pending.get(msg.jobId);
      if (job) {
        this.#pending.delete(msg.jobId);
        job.resolve(msg);
      }
      this.#releaseSlot(slot); // hand the warm slot to the next waiting job
    }
  }

  #teardown(error) {
    this.#handshake?.reject(error);
    this.#handshake = null;
    for (const slot of this.#pool) {
      slot.worker.terminate();
    }
    this.#pool = [];
    this.#idle = [];
    this.#waitQ = [];
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

  async #convertNow(photo, factor, sharpen, format, slot) {
    const output = hdOutputSpec(photo.name, format);
    // One rounding rule (§11.3.2): the target the worker draws, the dims
    // announced to the live region, and the readout all come from here.
    const target = upscaleDimensions(photo.width, photo.height, factor);

    // The mode was negotiated by #acquireSlot before this ran; job failures
    // after startup propagate as real conversion failures.
    const useWorker = this.#mode === "worker";

    if (useWorker) {
      const decoded = await decodeImage(photo.file);
      if (decoded.source instanceof ImageBitmap) {
        try {
          return await this.#convertViaWorker(slot, photo.id, decoded.source, target, output, sharpen);
        } catch (error) {
          this.#releaseSlot(slot);
          if (this.#pool.length === 0) {
            // The worker crashed mid-job: retry once on the fallback so a
            // transient worker death degrades to slower-but-working.
            return this.#convertOnMainThread(photo.file, target, output, sharpen);
          }
          throw error;
        }
      }
      decoded.release(); // SVG-class source: not transferable — fall through to the main path
      this.#releaseSlot(slot);
      return this.#convertOnMainThread(photo.file, target, output, sharpen);
    }
    this.#releaseSlot(slot);
    return this.#convertOnMainThread(photo.file, target, output, sharpen);
  }

  /** Transfer the bitmap; the pool worker draws, sharpens, encodes. */
  #convertViaWorker(slot, photoId, bitmap, target, output, sharpen) {
    const jobId = `h${this.#nextJobId}`;
    this.#nextJobId += 1;
    slot.busy = true;
    return new Promise((resolve, reject) => {
      this.#pending.set(jobId, { resolve, reject, slot });
      try {
        slot.worker.postMessage(
          {
            type: "convert",
            jobId,
            photoId,
            bitmap,
            targetWidth: target.width,
            targetHeight: target.height,
            mime: output.mime,
            quality: JPEG_QUALITY,
            sharpen,
          },
          [bitmap],
        );
      } catch (error) {
        this.#pending.delete(jobId);
        slot.busy = false;
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
   * resample + sharpen + encode on a detached canvas.
   */
  async #convertOnMainThread(file, target, output, sharpen) {
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
      if (sharpen > 0) {
        const imageData = ctx.getImageData(0, 0, target.width, target.height);
        applyUnsharp(imageData, sharpen);
        ctx.putImageData(imageData, 0, 0);
      }
      const quality = output.mime === "image/png" ? undefined : JPEG_QUALITY;
      const blob = await canvasToBlob(canvas, output.mime, quality);
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
