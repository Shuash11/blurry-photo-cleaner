# e2e fixtures

Test images for the Blurry Photo Cleaner e2e suite (this phase builds them; Phases 3–4 and the regression sweep consume them).

All files are 480×480 px and were generated deterministically by `generate_fixtures.py` (Python stdlib only — no dependencies). Regenerate with:

```
python generate_fixtures.py
```

## Inventory

| File | Classification | What it is |
|---|---|---|
| `fixture-sharp-checkerboard.png` | **Known sharp** | Black/white 12 px checkerboard with per-pixel luminance noise (±35) — very high local contrast |
| `fixture-sharp-text.png` | **Known sharp** | High-contrast text-like bars and dot details on white with mild noise (±20) — high edge density |
| `fixture-blurred-checkerboard.png` | **Deliberately blurred** | Copy of the sharp checkerboard after a box blur ×3 (separable, radius 5 ≈ Gaussian σ ≈ 5.5 px) |
| `fixture-blurred-text.png` | **Deliberately blurred** | Copy of the sharp text pattern after the same blur |
| `fixture-not-an-image.txt` | Invalid | Plain text file — the app must skip it with a visible counted message, never silently |
| `fixture-fake.heic` | Invalid | ISO-BMFF `ftyp` box with the `heic` brand but no decodable image data — fails decode in every browser (HEIC-capable or not), so it exercises the undecodable-file path everywhere |

## Why these work for blur-detection tests (Phase 3)

The sharp fixtures were drawn specifically for high Laplacian-variance response (dense high-contrast edges + noise). Measured adjacent-pixel contrast energy (a proxy for local gradient energy):

- sharp checkerboard ≈ 30.6 vs its blurred copy ≈ 2.5 (~12× lower)
- sharp text ≈ 8.3 vs its blurred copy ≈ 1.4 (~6× lower)

A large, unambiguous gap means a passing fixture test reflects real sharpness separation, not threshold luck. The invalid files exist so the "N files couldn't be opened" path can be exercised without depending on a device that produces real HEIC photos.
