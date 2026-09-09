# Lidingö mapping and placement

Lidingö opens at `?bana=lidingo` as a provisional 18-hole course. The 1 m
Lantmäteriet terrain and source water levels remain unchanged. This iteration
improves the features placed on that ground, using dated source evidence.

The [mapping completeness audit](mapping-completeness.md) checks every adopted
playing/facility outline, building footprint and vegetation boundary against the
actual served pack. It also lists all 18 holes for the current-orthophoto review,
including explicitly unresolved changes. Run
`node lidingobuild/mapping/audit-completeness.mjs --check` to verify that report.
Passing geometry preservation does not establish current completeness.

The review branch now has a 16,384 m terrain world with 277 tiles. Land cover,
water and measured canopy have separate source extents; expanding terrain alone
does not make those layers complete. The older fixed-pyramid compiler shown in
the historical rebuild instructions below now refuses to overwrite a published
ring graph. `publish-ground-rings.mjs --ground lidingo` owns ring publication
and requires the retained acquisition caches. It preserves existing finest
layers; changed canopy layers must be integrated and checked before publication.

## New 2025 imagery and surrounding water

Both 2025 RGBI tiles were read successfully after explicit approval of the
credentialed acquisition. All 110 adopted outlines have measurements from the
new imagery. The [first imagery review](ortho-2025-review.md) identifies three
bunker outlines for inspection, especially holes 15 and 16. Spectral flags do
not establish exact outlines or justify removing a bunker without image review.
The explicitly approved encrypted-image transfer is installed. Public Actions
[run 34326604307](https://github.com/olovmelander/olovs-hemsida/actions/runs/34326604307)
completed successfully and uploaded only the encrypted artifact, with one-day
retention. This public report contains the previously approved statistics;
private-image observations and decrypted crop metadata are not included.

The renderer now loads a checksummed 1.33 MB surrounding-water vector asset only
for Lidingö's ready v2 world. Its 144 polygons retain 180 interior rings and
source elevations, including six features with varying vertex heights. Nine
source-item batches add the water outside the original course crop; the seven
course polygons remain unchanged. No water rectangle, invented bed, shoreline
foam at crop edges or terrain leveling is introduced. The only height offset is
a 6 cm display clearance, matching the existing measured-water rendering.

The [independent topology check](environment-water-validation.json) compares
all 47,115 triangles against the original polygons, including islands and the
course exclusion, with zero horizontal area difference. Loader integrity,
island topology, height preservation and batching have automated checks.
The full suite passes 525 Vitest and 394 Node tests, with three source-cache
dependent skips. Production build and app asset checks pass. Browser
visual/performance review remains pending.

## Current inventory

| Layer | Result | Remaining limits |
|---|---|---|
| Playing surfaces | 110 polygons: 20 greens, 37 tees, 13 fairways, 40 bunkers. Eight more physical tee platforms and 12 more bunkers than the initial model; a displaced hole 10 bunker was replaced and eight source bunkers were associated with holes. | 2019 observations and supplementary OSM; incomplete current census. The proposed hole 13 approach extension failed overlay review and was rejected. |
| Facilities | 14 named surfaces: four practice greens/targets, one range field, four range platforms, two hardstanding polygons and three club parking fragments. | Individual mats, net poles, benches and current 2025 works remain unmeasured. Material is generic where unknown. |
| Paths and parking | Six unchanged source golf paths restored from the separate golf reference; 26 closed source parking ways interpreted as polygons. Together with observed club fragments, 29 lots render without inferred vehicles. | Two coarse club parking rings were retired entirely. Their unmatched remainder is unresolved, not asserted absent. Other OSM parking outlines are supplementary. |
| Buildings | Five retained roof sources contain 7,069 finite triangles from actual 2021 laser returns at absolute RH 2000 elevations. Original footprint alignment is preserved. The [display architecture](../../docs/courses/lidingo-clubhouse-appearance.md) is separate. | Source clubhouse/north facility coverage is 92.3%/89.7%; unsupported regions remain unknown in the evidence. Other three roofs cover 99.8–100%. The small shed is withheld. Closed display volumes and facades are approximations, not new measurements. |
| Vegetation and objects | 64 measured canopy stand tiles use updated surface/facility/parking exclusions. Random ground cover, reeds and range flags are disabled for the mapped/measured placement policies. | These are stand representatives, not surveyed individual stems. The source laser was captured in 2021. |
| Road elevations | Every submitted ribbon vertex follows its own terrain sample with a 3 cm display separation. | No invented road grading, crown or bridge height; widths/materials remain qualified renderer estimates. |

The courtyard paving retains an explicit putting-green island. Each physical
surface has one runtime owner: the two former generic practice greens now belong
to named facility records. A range field is distinct from its hardstanding and
practice platforms. Source range lines do not establish equally spaced bays.

## Source ownership and reproducible builds

| Authoring input | Generator | Reviewable output |
|---|---|---|
| [Initial traces](surface-traces-2019.json), [fairway review](fairway-traces-review.json), [refinements](surface-refinements-2019.json), retained OSM | [build-playing-surfaces.py](build-playing-surfaces.py) | [Playing surfaces](playing-surfaces.geojson), [review](playing-surfaces-review.json) |
| [Facility traces](facility-traces-2019.json), retained source worldfile and OSM | [build-facilities.py](build-facilities.py) | [Facilities](facilities.geojson), [review](facilities-review.json) |
| Original split OSM references and observed facilities | [normalize-infrastructure.py](normalize-infrastructure.py) | [Infrastructure](infrastructure.geojson), [normalization review](infrastructure-review.json) |
| Bounded 2021 point window, source footprints and DTM | [build-building-evidence.py](../build-building-evidence.py) | [Roof meshes](building-roof-meshes.json), [evidence](building-height-evidence.json), [independent checks](building-roof-validation.json) |
| All adopted layers | [build-course.mjs](../build-course.mjs) | Compatibility model, card and sampled fallback terrain |

Edit authoring inputs, inspect source overlays, and then regenerate the derived
layers. Preserve unknowns and rejected candidates. Never change the original
retained OSM snapshot to repair an adapter's interpretation. The official card,
OSM routes and daily tee/flag positions are separate sources of information.

From the repository root, with the retained raw caches available:

```powershell
$env:COURSE_GEO_PYPROJ_PYTHON = (Resolve-Path 'upsalabuild/cache/review-venv/Scripts/python.exe').Path
& $env:COURSE_GEO_PYPROJ_PYTHON lidingobuild/mapping/build-playing-surfaces.py
& $env:COURSE_GEO_PYPROJ_PYTHON lidingobuild/mapping/build-facilities.py
& $env:COURSE_GEO_PYPROJ_PYTHON lidingobuild/mapping/normalize-infrastructure.py
& $env:COURSE_GEO_PYPROJ_PYTHON lidingobuild/check-building-roofs.py
node lidingobuild/build-course.mjs
node lidingobuild/update-source-manifest.mjs
node packages/course-geo/migrate-legacy.mjs --write --ground lidingo
node packages/course-pack/emit-pack.mjs lidingobuild apps/golf/public/courses/lidingo lidingo
node packages/course-pack/emit-manifest.mjs --only=lidingo
node packages/course-v2/vegetation/compile-lidingo-stands.mjs
node packages/course-v2/vegetation/review-lidingo-stands.mjs
```

After reviewing the resulting model and migration, update only their Lidingö
SHA registrations in `hole-source-inventory.mjs` and `hole-source-controls.mjs`.
Then refresh the ledger and graph:

```powershell
node lidingobuild/update-source-manifest.mjs --runtime-validated
node packages/course-v2/compile-lidingo-ground-graph.mjs
npm run check:lidingo
node packages/course-geo/check-manifests.mjs
node packages/course-geo/migrate-legacy.mjs --check --ground lidingo
npm run build --prefix apps/golf
```

`--only=lidingo` preserves every other published course row during concurrent
work. It does not bypass Lidingö's pack/card checks. The graph compiler also
preserves unrelated ground manifests. Inspect `runtime-contract.json` after
changes; do not alter the pinned legacy cutout unless its source extent changes.

With the built app served locally at port 8634:

```powershell
$env:BANVY_GPU = '1'
node lidingobuild/check-runtime.mjs http://127.0.0.1:8634
node lidingobuild/check-runtime.mjs http://127.0.0.1:8634 --gl
node lidingobuild/mapping/placement-audit.mjs http://127.0.0.1:8634
node lidingobuild/review-facilities.mjs http://127.0.0.1:8634
node tools/check-app.mjs http://127.0.0.1:8634 --only=lidingo
node tools/check-course-v2.mjs http://127.0.0.1:8634 --course lidingo
```

Source overlays remain in ignored `lidingobuild/cache/facility-review/` and
`surface-mapping-2019/`. The roof source and mesh panels are in `cache/buildings/`.
[Building guidance](buildings.md), [placement audit](placement-audit.md) and
[next-session handoff](NEXT-SESSION.md) explain the interpretation limits.
The [geographic source README](../../geo_data/course-v2/lidingo/reference/README.md)
records actual acquisitions, coordinate systems and source access.

## Validation scope for this iteration

The checked reports identify their URL and source generation. The current local
review app is `http://127.0.0.1:8640/?bana=lidingo`, built through the normal
Vite/PWA configuration into `lidingobuild/cache/final-review-dist`. This separate
output directory prevents concurrent builds from clearing files during browser
checks; it excludes no course modules. Both backends were checked again after the final road-height fix.
An earlier isolated build on port 8638 allowed review while a concurrent Visby
module was absent; it is superseded by the normal-build reports.

The [WebGPU proof](3d-validation.json), [WebGL proof](3d-validation-webgl.json),
[facility/default-entry check](facility-runtime-validation.json) and
[placement audit](placement-audit.json) validate Lidingö in their recorded scope.
The focused Lidingö suite has 28 passing checks; eight renderer tests cover roofs,
road draping and courtyard/path topology. The normal build and published-graph
integrity check pass. The final full suite passes: 515 Vitest tests and 379 Node
tests, with two Node tests skipped. The shared acquisition fixture now includes
Visby's 30 source windows and 94 references; Lidingö remains at 25 windows and
86 references.
