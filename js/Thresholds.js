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
