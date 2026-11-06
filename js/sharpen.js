/**
 * sharpen.js — the unsharp-mask sharpening pass shared by the upscale
 * worker and the main-thread fallback (v0.3.0, user request: converted
 * copies should be able to genuinely improve, so the fresh sharpness score
 * can honestly re-band them).
 *
 * Method: Laplacian add — out = v + amount·(4v − left − right − up − down).
 * This is the classic unsharp mask's high-boost form (the same 3×3
 * Laplacian kernel the analyzer measures with, applied as an ENHANCER):
 * it raises local edge contrast, which is exactly what the 0–100
 * Laplacian-variance score responds to. Border pixels are sharpened with
 * the edge-clamped neighborhood (neighbors outside the image reuse the
 * edge value) so nothing shifts at the frame.
 *
 * HONESTY (plan Decision Record, unchanged): this is contrast enhancement
 * of the ENLARGED image — it adds crispness, not captured detail. The UI
 * copy keeps saying "enlarged, same captured detail"; the fresh score
 * simply measures what is actually in the file after the pass.
 *
 * Pure function over an ImageData-compatible {data,width,height}; mutates
 * `data` in place from a copied source (no neighbor contamination).
 */
export function applyUnsharp(imageData, amount) {
  if (!amount || amount <= 0) {
    return imageData;
  }
  const { width, height } = imageData;
  const src = new Uint8ClampedArray(imageData.data); // snapshot for neighbors
  const out = imageData.data;
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  for (let y = 0; y < height; y += 1) {
    const up = (y > 0 ? y - 1 : 0) * width;
    const down = (y < height - 1 ? y + 1 : height - 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const left = (x > 0 ? x - 1 : 0) + row;
      const right = (x < width - 1 ? x + 1 : width - 1) + row;
      const center = x + row;
      const o = center * 4;
      // RGB only — alpha is untouched (transparency must survive exactly).
      for (let c = 0; c < 3; c += 1) {
        const v = src[o + c];
        const lap = 4 * v - src[left * 4 + c] - src[right * 4 + c] - src[up * 4 + c] - src[down * 4 + c];
        out[o + c] = clamp255(v + amount * lap);
      }
    }
  }
  return imageData;
}
