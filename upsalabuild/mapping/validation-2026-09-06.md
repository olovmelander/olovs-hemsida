# Upsala mapping validation — 2026-09-06

Validated local code checkpoint `87b432ccb6a14f09a1f4e91c99e5c5f436dd2793`,
including renderer fix `2745f60af5e794b061ca9f7a13c6364894c98aed`.
This records technical validation and bounded visual review, not a complete survey
or a claim of perfect geographic accuracy.

## Automated checks

| Check | Result | Local evidence under `upsalabuild/cache/` |
|---|---|---|
| Full unit suite | 388 Vitest + 309 Node tests passed: 697 total, no failures or skips | `full-tests.log` |
| Canonical PROJ migration | All 7 grounds, 10 converted models and 10 course slugs verified byte-for-byte using real pyproj | `migration-check-final.log` |
| Source catalog and artifact checksums | Passed for all 7 grounds; existing source-approval blockers remain explicit | `geo-manifests.log` |
| Standalone geometry/card/data gates | Passed | `check3d.log` |
| Pack/page byte identity and all-course pack checks | Passed; all 10 packs match their cards and manifest records | `check-pack.log`, `check-packs.log` |
| App/page lint and production build | Passed | `lint-app.log`, `lint-page.log`, `app-build.log` |
| V2 app isolation and renderer build | Passed | `v2-app-final.log`, `v2-renderer-final.log` |

The standalone page is 1,212,619 bytes (1184.20 KiB). Its budget is 1220 KiB,
increased from 1150 KiB to accommodate observed geometry and its rendering support.
Review-only duplicate scenery is excluded from the runtime payload; woodland grid
packing is lossless.

The legacy browser run covered **Upsala and Mellanbanan only**. Their card, HUD,
surface-material, physical tee-platform, object-policy and submerged-object gates
passed, with no page errors. Both still failed `frame is a picture` at luminance
**0.036** (`browser-gates.log`). This is consistent with the known container
software-renderer issue; the failures remain recorded. This report does not claim
that all ten courses were rerun in the browser.

## Required-v2 visual review

A separate terrain-culling defect was found in the actual WebGL2 fallback with
`coordinateSystem=2000` and reversed depth. Fix `2745f60` makes frustum construction
follow the camera's coordinate/depth convention. The controlled diagnostic recovered
107 visible tiles from zero; settled views then selected the smaller visible sets
below. These are distinct counters.

| View | Boundary comparisons | Settled terrain tiles | Additional checks |
|---|---|---|---|
| Stora range, top view | 100, zero mismatches | 38 | All 30 traced mats hit by geometry probes |
| Stora range, oblique | 100, zero mismatches | 29 | Visible terrain in the rendered WebGL canvas |
| Mellan green 1 | 64, zero mismatches | 4 | Runtime retains all 9 greens and 23 tee platforms |

Each settled view had zero loading/failed terrain tiles, no no-data samples and
no application errors. [runtime-validation.json](runtime-validation.json) preserves
the metrics, camera settings, model hashes and capture digests. The top view used a Playwright presentation
PNG. The oblique presentation capture timed out, so the actual rendered WebGL canvas
was exported; Mellan also used a canvas capture. CPU raycasts are not used to judge
shader-displaced terrain. No source orthophotos were copied into this report.

## Geographic limits and next review

The GIS export contains **5,811 records**, including 27 routes, 27 green references,
111 tee references and 29 context boxes. It is not a census of 5,811 surveyed physical
objects. Crown candidates are not surveyed stems, rendering species are not botanical
observations, and imagery pixel spacing is not absolute positional accuracy.

Source accuracy and many heights remain unknown. Priority gaps include 35 Stora tee
platform records without rated source evidence, especially inferred pads on holes
13/15; 15 fairways with existing satellite-derived provenance; road/trail widths and
missing links; small equipment; and concealed drainage. Ten tagged culverts remain
preserved. Trenches, individual species, seasonal high grass and cottage identities
remain unresolved. [scope.json](scope.json) records every requested category;
[README.md](README.md) describes adopted evidence and its limits.

## Reproduce

From the repository root, with dependencies and source build inputs installed:

```sh
# Default projection is cs2cs. For the explicit real Python backend:
export COURSE_GEO_PYPROJ_PYTHON=/path/to/python-with-pyproj
node tools/refresh-upsala-mapping.mjs
node packages/course-geo/migrate-legacy.mjs --check
node packages/course-geo/check-manifests.mjs
npm test
node upsalabuild/check3d.mjs
node packages/course-pack/check-pack.mjs apps/golf/public/courses/upsala/pack.bin upsala3d.html upsalabuild
node tools/check-packs.mjs
node tools/lint-app.mjs
node geobuild/lint-page.mjs upsala3d.html
```

The overview renderer separately needs numpy/matplotlib; select its Python with
`--python` when needed. The [reproduction runbook](README.md#reproduce) explains
canonical current-Mellan selection, routing rebinding and scoped checksum updates.
Against a locally served app, reproduce the bounded legacy browser check with
`node tools/check-app.mjs http://127.0.0.1:8620 --only=upsala,upsala-mellanbanan`.
Inspect required-v2 views with `?bana=upsala&v2=require&det=1&q=lo` and the equivalent
Mellanbanan slug; capture cameras and methods are recorded in `runtime-validation.json`.
