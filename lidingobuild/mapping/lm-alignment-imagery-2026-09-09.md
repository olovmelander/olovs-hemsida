# Lidingö native orthophoto alignment evidence

The live Lantmäteriet STAC recheck on 2026-09-09 found `orto-o2-2025` to be the newest complete campaign for the ground. The selected assets match the prior 2026-09-07 discovery. Published source-mosaic polygons establish **2025-05-31** as the capture date across every review window.

The pinned plan contains 18 native tee corridors, 18 native complete-hole windows and one 0.8 m overview. Tee corridors cover the full scorecard-distance spread along the existing route plus 40 m in every direction; full-hole windows add 60 m of boundary context. Native pixels have a 0.16 m ground sample distance.

The current model already uses an exact EPSG:3006 local frame:

```
E = 677700.5 + x
N = 6586399.5 - z
E = minE + column * 0.16
N = maxN - row * 0.16
```

The final two expressions describe review coordinates measured from the northwest **pixel edge**. Pixel centres add 0.5 to the column and row. Legacy WGS84 metre approximations must not be used for this model.

The evidence files are in `geo_data/course-v2/lidingo/reference/`:

- `lm-ortho-catalog-2026-09-09.json`: live catalog campaign and asset selection.
- `lm-ortho-plan-2026-09-09.json`: pinned pre-edit model hash, source grids and window coordinates.
- `lm-ortho-acquisition-2026-09-09.json`: authenticated byte-range access, native grids, window hashes and validity.
- `lm-ortho-capture-2026-09-09.json`: contributing image footprints and capture dates.
- `lm-ortho-validation-2026-09-09.json`: offline grid, band, PNG, hash, worldfile and native-overlap checks.

Verification passed for 37 windows, including 36 native windows, covering 101,472,459 output pixels. Every pixel was valid. RGB previews match the first three GeoTIFF bands exactly; the fourth band is near infrared, never alpha. Every overlapping native pair returned identical measured RGBI bytes.

The matching raster, raw RGB PNG, optional old-geometry overlay and pixel-centre worldfile remain under the ignored `lidingobuild/cache/lm-ortho/` directory. Tee windows are `lidingo-NN-tees`; hole windows are `lidingo-NN-hole`; the overview is `lidingo-ground-overview`. `alignment-plan.json` is the local copy of the pinned plan. These names avoid a concurrent older review process that used `hole-NN-tees`, `ground-overview` and `plan.json`.

Reacquire the pinned baseline and verify with:

```powershell
upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/mapping/lm-alignment-acquire.py
upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/mapping/lm-alignment-capture.py
upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/mapping/lm-alignment-verify.py
```

Credentials are read from the existing local environment or `.env` and never persisted. `lm-alignment-discover.mjs` supports an independent live recheck; the accepted review retains the hash of its original catalog observation. The baseline plan is intentionally retained after geometry changes rather than regenerated from those changes.

Source registration checks establish internal consistency, not survey accuracy. Platform boundaries are separate manual image interpretations. The imagery does not establish current daily marker positions, and small or shadow-obscured objects remain uncertain.
