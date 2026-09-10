# Norrfällsviken coastal environment

The ocean uses one continuous surface across the published 16,384 m terrain world. It replaces the old sea polygon whose artificial closing edges produced diagonal cutoffs and conflicting water colours. The implementation is in [source-ocean.mjs](../../apps/golf/src/engine/source-ocean.mjs), with the compressed asset and checksum pinned in [norrfallsviken-ocean-source.mjs](../../apps/golf/src/engine/norrfallsviken-ocean-source.mjs).

## Geometry and rendering

Sea polygons, island holes, and disjoint shore bands share one geometry source and material. Bands follow physical or retained terrain-derived shores at 0, 2, 8, 20, 40, and 60 m; world crops and campaign cuts do not create surf. EPSG:3006 coordinates pass through the existing rotated legacy-frame bridge. The source sea reference is −0.03 m RH2000, plus the existing 20.3432 m datum offset exactly once. A 0.2 m display clearance avoids coplanar water and terrain.

The ocean is opaque and uses ordinary depth testing without polygon offset. Terrain is hidden only in complete 16 m ocean-mask cells clear of shoreline and island edges. Ocean coverage also excludes distant trees and removes sea components from automatic inland-water detection. Small residual components must still meet the lake detector's size threshold unless they overlap known water. Inland ponds retain their own levels. Published source terrain chunks and their elevations are unchanged; this is display geometry and masking.

Water receives atmospheric fog once through the material, matching terrain. Shore colour, foam and wave slope use a common ocean palette. The WebGL fallback sky's lower hemisphere uses the same fog colour as distant land and water, removing the green horizon stripe exposed by elevated camera views.

The Storsanden beach-to-dune sand corridor is traced from the 2024-06-27 LM RGBI orthophoto at 0.16 m source resolution. [The pixel trace](../../nvgkbuild/mapping/storsanden-sand-review.json) records the image checksum and display transform; [the runtime surface module](../../apps/golf/src/engine/norrfallsviken-coastal-surfaces.mjs) converts it through the same terrain bridge and blends the sand tint at its boundary. It preserves measured vegetation. The trace establishes visible sand extent on that date, not a surveyed daily waterline.

## Evidence and missing coverage

[The acquisition report](../../geo_data/course-v2/norrfallsviken/reference/lm-marine-water-2026-09-09.json) pins four Lantmäteriet Markhöjdmodell breakgeometry GeoPackages: `698_67`, `698_68`, `699_67`, and `699_68`. Their native sea polygons are unioned before clipping. All 57 explicit island polygons remain dry, including small low skerries. Source URLs, original byte counts, SHA-256 hashes, feature levels, and bounds remain in the report. Source acquisition and review were performed on 2026-09-09; the GeoPackages do not provide a capture date used here.

Some older 2.5 km campaign squares omit marine polygons. Absence there is treated as missing coverage. The fallback samples unmodified published terrain at 4 m and retains water connected to the measured sea at ≤0.15 m RH2000. A 4 m seam allowance bridges offsets between native and nominal campaign boundaries. Enclosed gap artefacts whose interior and surrounding samples are finite and no higher than 0.8 m are filled, while mainland contours, higher land, and every explicit source island remain. This removes 1,212 low artefacts covering 358,794 m² without changing the outer terrain contour. A repaired enclosed component can cross a nominal campaign boundary; the 4 m allowance is not a bound on its entire footprint.

Two additional rectangles were visually confirmed as open sea in [historical LM orthophotos](../../geo_data/course-v2/norrfallsviken/reference/lm-marine-gap-orthophotos-2026-09-09.json), both captured on 2012-05-27:

- North: EPSG:3006 `[680000, 6990500, 681500, 6992200]`, source `o69900_6800_50_fi12`.
- East: EPSG:3006 `[680000, 6987500, 682500, 6990000]`, source `o69850_6800_50_fi12`.

Their union fills the false northern terrain patch and remaining sea gaps, adding 150,421 m² beyond the preceding repair. The imagery is historical land/water evidence, not a current coastline survey. Unmapped skerries outside these reviewed rectangles remain limited by terrain resolution and the declared filtering. Sea-source heights are not bathymetry.

## Reproduction and acceptance

Run from the repository root. The existing Python environment needs NumPy, Shapely, ContourPy, rasterio, and Pillow. Acquisition uses the existing local Lantmäteriet credential workflow; raw source files and imagery remain in ignored cache.

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe nvgkbuild/mapping/review-marine-gaps.py
& upsalabuild/cache/review-venv/Scripts/python.exe nvgkbuild/mapping/acquire-coastal-water.py
& upsalabuild/cache/review-venv/Scripts/python.exe nvgkbuild/mapping/test-coastal-water.py
npm run check:norrfallsviken-coast
node nvgkbuild/mapping/validate-coastal-runtime.mjs
node nvgkbuild/mapping/update-coastal-source-manifest.mjs
npm --prefix apps/golf run build
```

The generator verifies original source hashes, the pinned reviewed-image hashes, polygon validity, shared centimetre topology, complete band coverage, and zero source-island intersection. Missing, excess, or overlapping band area above 0.05 m² fails generation. Asset `7f7d8ec406b62ad829b40c06f5e0574b0615033d615454733bf880b955b022e3` is 3,329,560 compressed bytes and has three sea polygons, 58 interior rings, and 239 valid band polygons. The 58 final rings include retained terrain-derived land and are distinct from the 57 explicit source island polygons.

[Independent runtime validation](../../nvgkbuild/mapping/coastal-runtime-validation.json) passes for this exact asset: 371,403 vertices, 371,335 triangles, seven mapped-island probes, and a 0.03349 m² triangulation-area difference over 170,996,692.58664 m². It checks upward faces and triangle membership as well as area. This validation triangulates in the source-aligned frame; the browser's rotated legacy frame removes different near-collinear triangles. The loader verifies bytes and SHA-256 before parsing, including the separately pinned decoded identity when the HTTP server decompresses gzip automatically.

Browser acceptance passes on the production build in WebGPU and WebGL2: seven viewpoints in golden and noon lighting for each renderer, 28 captures, no page or console errors. Both renderers produce one continuous ocean surface with 366,121 triangles, preserve the seven mapped-island probes, and report zero distant trees on sea. The single remaining automatically detected water component belongs to an inland pond at 30.32 m; ocean remnants are gone. The 65 focused JavaScript tests, three Python topology tests, source-ledger validation and production build pass. [The browser review record](../../nvgkbuild/mapping/coastal-browser-validation.json) pins report and image hashes.

To repeat the captures, start the production preview and run:

```powershell
$env:BANVY_GPU='1'
node nvgkbuild/mapping/check-environment.mjs --url http://127.0.0.1:8638 --out nvgkbuild/cache/environment-accepted-webgpu
node nvgkbuild/mapping/check-environment.mjs --url http://127.0.0.1:8638 --webgl --out nvgkbuild/cache/environment-accepted-webgl
```

Direct review of the coastal, offshore, beach, harbour and inland-pond captures found no angular sea cutoff, campaign-boundary surf, offshore false-land speckling, obvious water bleed, disconnected sand corridor, or WebGL green horizon stripe. Source gaps and the historical imagery limits above remain explicit; this acceptance covers the environment continuity repair.

## 2026-09-10: dev-server fallback and beach close-up

A normal visit on port 5173 reproduced the user's `STANDARDTERRÄNG · FALLBACK` screenshot: the published root failed to load and zero LM terrain tiles were installed. The initial error discarded its nested cause, so the exact failed response cannot be reconstructed. The coarse beach mounds belonged to the legacy terrain, not a second mesh over the 1 m terrain. A fresh default visit subsequently loaded the verified graph successfully. Three live camera checks found no simultaneously rendered parent/child terrain tiles and zero legacy course-surface overlays.

The publication code contained a race consistent with this failure: it overwrote the live mutable terrain index directly. Publishers now stage a complete replacement beside the index and rename it into place, with a shared lock around read/merge/write so concurrent course updates retain each other's entries. Regression tests cover partial staging failure, concurrent publishers, and lock timeout without changing the old root. Terrain selection now retains the nested error and the fallback badge reports a loading failure instead of claiming that only Puttom supports LM terrain.

The sea also carried the legacy `isLake` flag, which applied an automatic inland-reed fringe across the open beach. Norrfällsviken's sea is now excluded from that procedural reed generator. This removes invented shoreline spikes without changing the measured terrain, mapped vegetation, or orthophoto sand trace. Close and elevated beach views were checked on the normal dev URL without `v2=require`.

## 2026-09-10: nearby and distant terrain colours

The far tint raster copied nearby colours through the last complete 24 m footprint at ±1512 m, then switched directly to the vista palette at ±1536 m. The shader's existing near fade could not conceal a discontinuity already baked into the far texture. The overview now blends the two sources across an inward 300 m band, reaching zero nearby contribution before its sampling footprint reaches the crop. Downsampling weights partial texels symmetrically and averages decoded linear colours instead of sRGB bytes.

[The validation record](../../nvgkbuild/mapping/terrain-colour-validation.json) records six before views and twelve accepted views across WebGPU/WebGL2 in golden and noon lighting, with report and capture hashes. At the checked forest boundary the maximum channel jump fell from 37 to 0 sRGB byte levels; all 50 sampled heights stayed unchanged. Visual review confirms the sharp rectangle is gone in the inland forest and across the inlet. Sixteen focused tests and the production build pass.

The change is served by the normal `npm run dev` app on port 5173. Repeat the browser checks with:

```powershell
$env:BANVY_GPU='1'
node nvgkbuild/mapping/check-terrain-colours.mjs
node nvgkbuild/mapping/check-terrain-colours.mjs --webgl
npx vitest run apps/golf/src/engine/ground-tint-overview.test.mjs apps/golf/src/engine/material-style-data.test.mjs
```
