/**
 * PhotoStore — owns the photo records and their object-URL lifecycle.
 *
 * A record (Phase 2) carries everything the upload/selection state needs and
 * leaves clean extension points for Phase 3 (blur analysis fills score/band;
 * Phase 4 reads file/name for downloads):
 *
 *   {
 *     id:          stable unique id ("p1", "p2", …)
 *     file:        the original File (kept for analysis and download)
 *     name:        file name
 *     size:        file size in bytes
 *     thumbURL:    object URL of the downscaled thumbnail blob
 *     width:       decoded natural width in px
 *     height:      decoded natural height in px
 *     score:       null until Phase 3 analysis runs; 0–100 when scored
 *     band:        null → "blurry" | "review" | "sharp" when scored;
 *                  "skipped" when analysis was skipped (no visible pixels /
 *                  too small) — score stays null then
 *     skipMessage: human-readable reason when band is "skipped", else undefined
 *   }
 *
 * Memory rules (plan Decision Record): thumbnails are downscaled via canvas —
 * full-size images are never used as grid sources — and every object URL this
 * store hands out is revoked by the store itself on clear().
 */

import { BAND_SKIPPED } from "./Thresholds.js";

/* Thumbnail long edge in px. Small enough that a 100+ photo grid of
   ~30–60 KB JPEG blobs stays cheap; large enough for the Phase 4 detail view. */
const THUMB_MAX_EDGE = 512;
const THUMB_JPEG_QUALITY = 0.85;

export class PhotoStore {
  #photos = [];
  #nextId = 1;

  /** Photo records, oldest first. Callers must not mutate. */
  get photos() {
    return this.#photos.slice();
  }

  get count() {
    return this.#photos.length;
  }

  getById(id) {
    return this.#photos.find((photo) => photo.id === id) ?? null;
  }

  /** Records analysis has not resolved yet (band still null), oldest first. */
  get unscored() {
    return this.#photos.filter((photo) => photo.band === null);
  }

  /**
   * Write a Phase 3 analysis result into a record. Returns true when the
   * record exists (a result for a cleared photo is silently ignored — the
   * queue guarantees this cannot race, the guard is defense in depth).
   */
  applyAnalysis(id, { score, band }) {
    const record = this.getById(id);
    if (!record) {
      return false;
    }
    record.score = score;
    record.band = band;
    return true;
  }

  /**
   * Mark a record as skipped by analysis (zero valid pixels / too small) —
   * it keeps its thumbnail and stays in the gallery, it is just never
   * scored, per the plan's "skip with a message, never score 0" rule.
   */
  applySkip(id, message) {
    const record = this.getById(id);
    if (!record) {
      return false;
    }
    record.score = null;
    record.band = BAND_SKIPPED;
    record.skipMessage = message;
    return true;
  }

  /**
   * Verify the browser can actually decode this file (never by extension
   * alone — plan Decision Record), build the downscaled thumbnail, and add
   * the record. Throws when the file cannot be opened; the caller turns
   * that into the visible "N files couldn't be opened" notice (§9e).
   */
  async createRecord(file) {
    const decoded = await decodeImage(file);
    let thumbURL;
    try {
      thumbURL = await renderThumbnail(decoded.source, decoded.width, decoded.height);
    } finally {
      decoded.release();
    }

    const record = {
      id: `p${this.#nextId}`,
      file,
      name: file.name,
      size: file.size,
      thumbURL,
      width: decoded.width,
      height: decoded.height,
      score: null, // Phase 3: BlurAnalyzer fills this.
      band: null,  // Phase 3: "blurry" | "review" | "sharp".
    };
    this.#nextId += 1;
    this.#photos.push(record);
    return record;
  }

  /** Revoke every thumbnail URL and empty the store ("Start over"). */
  clear() {
    for (const photo of this.#photos) {
      URL.revokeObjectURL(photo.thumbURL);
    }
    this.#photos = [];
  }

  /**
   * §11.5.4 confirmed session delete: remove records by id, revoking their
   * thumbnail object URLs (the clear() pattern scoped to the removed
   * records). Returns the removed records in store order so the caller can
   * announce and compute the focus fallback; unknown ids are ignored.
   */
  remove(ids) {
    const idSet = new Set(ids);
    const removed = this.#photos.filter((photo) => idSet.has(photo.id));
    if (removed.length === 0) {
      return [];
    }
    for (const photo of removed) {
      URL.revokeObjectURL(photo.thumbURL);
    }
    this.#photos = this.#photos.filter((photo) => !idSet.has(photo.id));
    return removed;
  }
}

/* --------------------------------------------------------------------------
   Decode + thumbnail helpers (module-private)
   -------------------------------------------------------------------------- */

/**
 * Decode an image File to a drawable source. Two attempts, in order:
 *   1. createImageBitmap — fast, decodes off the main thread, and honors
 *      EXIF orientation via imageOrientation: "from-image".
 *   2. HTMLImageElement.decode() — covers SVG sources (which
 *      createImageBitmap rejects) and older engines.
 * Both failing means the browser cannot open the file (e.g. HEIC where
 * unsupported) — exactly what the plan requires us to detect for real.
 *
 * Exported because BlurAnalyzer reuses the exact same path for its analysis
 * input, so EXIF-rotated photos are analyzed upright and SVG sources behave
 * identically in both pipelines.
 */
export async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => bitmap.close(),
        };
      }
      bitmap.close();
    } catch {
      // Undecodable by this path — try the <img> path before giving up.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width <= 0 || height <= 0) {
      throw new Error("image has no pixels");
    }
    return {
      source: image,
      width,
      height,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new Error(`Cannot decode "${file.name}": ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

/**
 * Draw the decoded source into a canvas downscaled so its long edge is at
 * most THUMB_MAX_EDGE, and encode as a JPEG blob. Resolves with the blob's
 * object URL — the record's thumbnail source for the whole session.
 */
function renderThumbnail(source, width, height) {
  return new Promise((resolve, reject) => {
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height));
    const thumbW = Math.max(1, Math.round(width * scale));
    const thumbH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = thumbW;
    canvas.height = thumbH;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas 2D context unavailable"));
      return;
    }

    // Photos fill the frame; the white backdrop keeps transparent sources
    // from encoding on a black JPEG background.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, thumbW, thumbH);
    ctx.drawImage(source, 0, 0, thumbW, thumbH);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          reject(new Error("Thumbnail encoding failed"));
        }
      },
      "image/jpeg",
      THUMB_JPEG_QUALITY,
    );
  });
}
