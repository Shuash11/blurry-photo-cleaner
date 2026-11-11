/**
 * Thresholds — single source of truth for the blur-detection algorithm's
 * tunable values and its pure math (plan Phase 3, Decision Record route A).
 *
 * Both the main thread (input preparation in BlurAnalyzer) and the Web Worker
 * (blur-worker.js — scoring) import from this module, so the working size,
 * normalization, and band cut points can never drift apart.
 *
 * ── Algorithm summary ────────────────────────────────────────────────────
 * 1. Decode upright (EXIF honored by the Phase 2 decode path).
 * 2. Downscale to a fixed working size (WORKING_* below) — variance must be
 *    comparable across photos of different resolutions, and small working
 *    images keep the worker's per-photo cost near a millisecond.
 * 3. Grayscale (Rec. 601 luma, like OpenCV's default grayscale conversion).
 * 4. Laplacian response with the classic 3×3 kernel
 *        [ 0  1  0 ]
 *        [ 1 -4  1 ]   →  response = 4·g(x,y) − g(x±1,y) − g(x,y±1)
 *        [ 0  1  0 ]
 *    (this is OpenCV cv2.Laplacian with ksize=1).
 * 5. Population variance of the responses — the Pech-Pacheco et al. (2000)
 *    sharpness measure popularized by the OpenCV "blur detection" recipe:
 *    out-of-focus photos have near-zero high-frequency energy, sharp photos
 *    have high response variance.
 * 6. Normalize to a 0–100 score (logarithmic — see VARIANCE_REF) and cut
 *    into three bands (Blurry / Needs review / Sharp).
 *
 * ── Why a logarithmic normalization ─────────────────────────────────────
 * Raw Laplacian variance spans several orders of magnitude: a blurred photo
 * sits around 1–50, an ordinary sharp photo around 10²–10³, and synthetic
 * high-contrast content (text, checkerboards) can exceed 10⁴–10⁵. A linear
 * score would pin almost every real photo to 0 or 100; mapping through
 * log(1 + v) compresses that span so the middle "Needs review" band has
 * room. VARIANCE_REF is the raw variance that maps to score 100 — anything
 * at or above it simply caps at 100.
 *
 * ── Intake caps (plan v2 INF-1) ──────────────────────────────────────────
 * This module also holds the named intake limits (plan Finding 4: caps
 * belong as named constants in Thresholds.js). They guard memory, not
 * scoring: files over MAX_FILE_BYTES are skipped at intake before any
 * decode, and a batch longer than MAX_BATCH_FILES is truncated to its
 * first MAX_BATCH_FILES items. Skipped files always surface in a counted
 * §9e-style notice — never a silent drop.
 *
 * ── Threshold rationale ─────────────────────────────────────────────────
 * On the score scale, out-of-focus/motion-blurred photos land below ~25
 * (raw variance ≲ 11), textured sharp photos reach 60+ (raw variance ≳ 10³),
 * and everything in between — including sharp-but-low-texture photos such
 * as skies and plain walls, the false-positive risk recorded in the plan's
 * red-team note — falls into "Needs review" so the user always decides.
 * The exact cut points were calibrated against the deterministic fixtures
 * in e2e/fixtures (see e2e/README evidence in the Phase 3 run log); they
 * are named constants precisely so they can be retuned without touching
 * algorithm code. If fixture separation ever degrades, the plan's recorded
 * flip condition is to add the ensemble metric (Laplacian + gradient
 * energy), not to silently nudge these numbers.
 */

/* Working image: the long edge the photo is downscaled to before scoring.
   256 px keeps detail that matters for sharpness (edges survive a 4–10×
   downscale) while making the Laplacian pass ~65k pixels — fast enough that
   a 100-photo batch queues through the worker in seconds, and small enough
   that per-photo memory is negligible. */
export const WORKING_MAX_EDGE = 256;

/* A pixel counts as "visible" when its alpha is at least this value
   (0–255). 1 means: any non-fully-transparent pixel is real content. An
   image whose visible-pixel count is zero (fully transparent PNG, cleared
   canvas) is skipped by the analyzer — never scored 0 (plan acceptance). */
export const ALPHA_VISIBLE_MIN = 1;

/* Raw Laplacian variance mapped to score 100 (see rationale above). */
export const VARIANCE_REF = 20000;

/* Score scale bounds. Scores are integers 0–100. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/* Band cut points (score scale):
      score <  SCORE_BLURRY_MAX → "blurry"
      score ≥  SCORE_SHARP_MIN  → "sharp"
      otherwise                 → "review"  ("Needs review")

   Calibration (measured through the real worker, e2e/probe-thresholds.js):
   the known-sharp fixtures measure raw variance 13,718 (text) and 32,710
   (checkerboard) → scores 96/100; the deliberately blurred copies measure
   36.1 / 28.2 → scores 36/34. A blurry cut at 25 put those clearly-blurred
   fixtures in "review", so it sits at 40 instead (raw ≈ 52): heavy blur
   lands in the Blurry band with margin, while the flat-photograph limit of
   a single Laplacian metric (a noise-free smooth sky measures ~1.5 raw; a
   noise-grained flat wall ~10) still reads honestly as low edge energy.
   Sharp-but-low-texture photos therefore land Blurry or low-review — the
   red-team-accepted tradeoff; the "Needs review" band absorbs genuinely
   ambiguous mid-texture photos (raw ≈ 52–1,000) so the user always decides. */
export const SCORE_BLURRY_MAX = 40;
export const SCORE_SHARP_MIN = 60;

/* Band identifiers used by PhotoStore records and (Phase 4) the results UI. */
export const BAND_BLURRY = "blurry";
export const BAND_REVIEW = "review";
export const BAND_SHARP = "sharp";
export const BAND_SKIPPED = "skipped"; // analysis skipped (no visible pixels / too small)

/* Display labels — THE shared source (v0.6.0): the results band sections,
   App's HD-copy announcements, and the bundled download's ZIP folders all
   read this map, so the word on screen, the word in the live region, and
   the folder name in the archive can never drift. */
export const BAND_LABELS = {
  [BAND_BLURRY]: "Blurry",
  [BAND_REVIEW]: "Needs review",
  [BAND_SHARP]: "Sharp",
  [BAND_SKIPPED]: "Skipped",
};

/* ── Intake caps (plan v2 INF-1) ────────────────────────────────────────── */

/* Per-file size cap: 50 MB. Files strictly over this are skipped at intake
   (App.partitionIntake) BEFORE any placeholder tile or decode attempt — the
   file is never read into memory. Rationale for the value: the decode
   pipeline supports JPEG/PNG, where real photos run ~1–15 MB and even a
   100-megapixel JPEG rarely exceeds ~40 MB — so 50 MB sits comfortably
   above every legitimate photo while catching accidental giant inputs
   (video files, RAW sidecars, dumps renamed to .jpg) before
   createImageBitmap tries to buffer them. Comparison is `size > cap`, so a
   file at exactly 50 MB still loads — matching the "over 50 MB" copy. */
const MB = 1024 * 1024;
export const MAX_FILE_BYTES = 50 * MB;

/* Human-readable form of the cap for notice copy. Derived from
   MAX_FILE_BYTES so the copy can never drift from the enforced value
   ("50 MB"; non-whole-MB values render naturally, e.g. "50.5 MB"). */
export const MAX_FILE_LABEL = `${MAX_FILE_BYTES / MB} MB`;

/* Per-batch file-count cap: 500. Bounds what one pick can create — the
   intake pool decodes 4 files at a time, and each accepted file becomes a
   store record, a thumbnail blob URL, and a tile — so a folder walk over a
   huge library cannot balloon memory in one batch. Applied AFTER the size
   filter (room is never wasted on files that could not load anyway), to
   the first 500 items in arrival order; the excess is skipped with a
   counted notice while valid files within the cap load unaffected. Larger
   libraries load across several "Add more" picks. */
export const MAX_BATCH_FILES = 500;

/**
 * Working-size math for a decoded image. Keeps the aspect ratio, never
 * upscales (a 64 px avatar is analyzed at 64 px — upscaling would invent
 * no sharpness and would distort the variance scale), and clamps to ≥ 1 px
 * so degenerate dimensions cannot crash the canvas math.
 */
export function workingDimensions(width, height) {
  const scale = Math.min(1, WORKING_MAX_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Raw variance → 0–100 score. Logarithmic map (see rationale above),
 * clamped, rounded to an integer so the UI shows a stable value.
 *
 * Determinism: float64 math in a fixed expression order; the same raw
 * variance always yields the same score in a given engine. Cross-engine
 * differences are far below the 1-point rounding step.
 */
export function normalizeScore(rawVariance) {
  if (!(rawVariance > 0)) {
    return SCORE_MIN;
  }
  const scaled = (100 * Math.log1p(rawVariance)) / Math.log1p(VARIANCE_REF);
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(scaled)));
}

/* ── HD converter (plan v2 R5, design-spec-v2 §11.3) ────────────────────── */

/* Slider ceiling: the user-facing factor never exceeds 4×. The EFFECTIVE
   max for a given photo is the runtime capability probe's result (§11.3.3,
   HDConverter.probeMax) — this constant is only the top of the candidate
   list and the slider's nominal range, never a browser-limit claim. */
export const MAX_UPSCALE_FACTOR = 4;

/* Probe candidates: factors tested from largest to smallest (§11.3.3 runs
   "4× down to 1.5× (0.5 steps)"). Derived from MAX_UPSCALE_FACTOR so the
   list can never drift from the slider ceiling. */
export const UPSCALE_CANDIDATE_FACTORS = (() => {
  const factors = [];
  for (let f = MAX_UPSCALE_FACTOR; f >= 1.5; f -= 0.5) {
    factors.push(f);
  }
  return factors;
})();

/* JPEG encode quality for HD outputs (plan-verbatim 0.92). PNG outputs are
   lossless and ignore it. The "quality 92" label is derived from this
   constant at the call sites (MAX_FILE_LABEL precedent — the copy can never
   drift from the enforced value). */
export const JPEG_QUALITY = 0.92;

/**
 * Output-dimension math — THE one rounding rule (§11.3.2: "The readout and
 * the saved file's dimensions must agree exactly — one rounding rule,
 * computed once, consumed by worker and UI alike"). Round(w × f) ×
 * Round(h × f), floored at 1px so degenerate sources cannot crash the
 * canvas math. The probe, the readout, the worker's target, and the e2e
 * expectation all call this — nowhere else may a target dimension be
 * computed.
 */
export function upscaleDimensions(width, height, factor) {
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/* Output naming (§11.3.1/§11.3.5): "{basename}-hd.jpg", where basename is
   the filename minus its final extension (".jpeg" also lands on ".jpg" by
   stripping). PNG sources keep their extension → "{basename}-hd.png".
   Everything else saves JPEG at JPEG_QUALITY. One helper so the panel's
   format line, the actual encode format, and the download's filename can
   never disagree.

   v0.3.0: an explicit `format` ("png" | "jpeg" | "webp") overrides the
   source-derived default — the export-format chooser (user request
   2026-11-06) names the encode format, so the extension, the mime, and the
   panel's format line must all follow it. No format → the legacy behavior. */
const FORMAT_SPECS = {
  png: { ext: "png", mime: "image/png" },
  jpeg: { ext: "jpg", mime: "image/jpeg" },
  webp: { ext: "webp", mime: "image/webp" },
};

export function hdOutputSpec(filename, format) {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  if (format && FORMAT_SPECS[format]) {
    const spec = FORMAT_SPECS[format];
    return { name: `${base}-hd.${spec.ext}`, mime: spec.mime };
  }
  const isPng = /\.png$/i.test(filename);
  return {
    name: `${base}-hd.${isPng ? "png" : "jpg"}`,
    mime: isPng ? "image/png" : "image/jpeg",
  };
}

/* ── v0.3.0 — export formats, sharpening, worker pool (user requests) ────── */

/** Export formats for the download chooser: "Original" keeps the source
 *  bytes byte-identical (the v0.1 behavior); the other three re-encode
 *  through the converter at 1× (PNG lossless, JPEG/WebP at JPEG_QUALITY).
 *  One list so the chooser, the encoder, and the extension logic agree. */
export const EXPORT_FORMATS = [
  { id: "original", label: "Original", mime: null },
  { id: "png", label: "PNG", mime: "image/png" },
  { id: "jpeg", label: "JPEG", mime: "image/jpeg" },
  { id: "webp", label: "WebP", mime: "image/webp" },
];

/** The default export choice (the chooser remembers the last pick for the
 *  session — module state, never localStorage, per the storage rule). */
export const EXPORT_FORMAT_DEFAULT = "original";

/** Unsharp-mask sharpening levels for the HD converter (user request
 *  2026-11-06): plain resampling only ENLARGES; the sharpen pass is what
 *  can genuinely raise local edge contrast — and with it the sharpness
 *  score — so a converted copy can honestly re-band. Amounts are the
 *  Laplacian-add weight (out = v + amount·(4v − neighbors)); 1px radius. */
export const SHARPEN_LEVELS = [
  { id: "off", label: "Off", amount: 0 },
  { id: "low", label: "Low", amount: 0.3 },
  { id: "high", label: "High", amount: 0.6 },
];

export const SHARPEN_DEFAULT = "off";

/** Parallel HD conversion pool (user request: "at least 25" in one batch):
 *  the pool runs this many workers pulling from the job queue — sized to
 *  the CPU (cores − 1, 2–8), which converts 25 photos in ~⌈25/size⌉ waves
 *  while the UI thread stays free. */
export const HD_POOL_SIZE = Math.max(
  2,
  Math.min(8, (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4) - 1,
);

/** Name for a re-encoded ORIGINAL export (no "-hd" — that marks HD upscales):
 *  "{basename}.{format ext}". Same extension rule as hdOutputSpec. */
export function exportName(filename, format) {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const spec = FORMAT_SPECS[format];
  return `${base}.${spec ? spec.ext : "jpg"}`;
}

/* ── Percentage display (plan v2 R4, design-spec-v2 §11.2) ───────────────── */

/**
 * Score → display text: "NN% sharp". Identity mapping — the percentage IS
 * the stored 0–100 integer (normalizeScore already returns a rounded
 * integer), so there is no transformation, no re-rounding, no floor here.
 * Score 0 renders "0% sharp" (a real measurement); unscored and skipped
 * photos never reach this helper — their chips render "—" at the call
 * sites (§11.2). One shared helper so the tile chips, the pending grid,
 * and the detail chip cannot drift apart (the MAX_FILE_LABEL precedent:
 * display copy derived at one source).
 */
export function formatPercent(score) {
  return `${score}% sharp`;
}

/**
 * Bytes → display text: "141 KB" / "1.4 MB" (the same compact style the
 * detail view's file-size caption has always used). One shared helper so
 * the detail caption and the export chooser's per-format size labels
 * cannot drift apart (the formatPercent precedent: display copy derived
 * at one source). Invalid input renders "" — callers decide what to show.
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** Score → band id (constants above). */
export function bandForScore(score) {
  if (score < SCORE_BLURRY_MAX) {
    return BAND_BLURRY;
  }
  if (score >= SCORE_SHARP_MIN) {
    return BAND_SHARP;
  }
  return BAND_REVIEW;
}
