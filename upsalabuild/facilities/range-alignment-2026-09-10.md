# Upsala driving range: where the alignment stands (2026-09-10)

The owner's last request to the Codex session that authored Upsala's twelve
Blender facility assets was "model and align the driving range". The session
was killed by its usage limit three read commands later; nothing changed. This
records what the range already is, what is actually misaligned, and the order
of the work that finishes it, so the next pass starts from evidence rather than
from the request.

## What is already measured and rendered

The range is one of the better-evidenced parts of the course. Two dated
orthophotos have been read on it (Uppsala kommun 2024 and Lantmäteriet 2025,
both 0.16 m), and the model carries, all in local metres with provenance,
`observedYear`, `notSurveyed: true` and a 0.5–1 m boundary uncertainty:

| kind | count | source year | rendered as |
|---|---|---|---|
| `range_tee_pad` (west 83 m², middle 153 m², east 147 m², east extension 57 m²) | 4 | 2024 | pale hardstanding footprint at +8.5 cm; the turf extension as atlas TEE |
| `range_mat` (west 01–08, middle 01–10, east 01–12) | 30 | 2025 | exact quads lifted 12 cm, `parentFacilityId` on each |
| `range_target_surface` (circles ~3.9 m across) | 6 | 2024 | pale flat footprint (material "unknown-bright-surface", not sand) |
| `range_bunker` | 5 | 2024 | atlas SAND |
| `practice_green` / `practice_bunker` | 4 / 2 | 2024–2025 | atlas GREEN / SAND |

The authored `upsala-range-shelter` (B08 monopitch roof over the west
platform, 24 parts, plus the B09 kiosk) comes from the 2025-06-14 native panel
and a 249 m² roof observation; the laser window does not reach B08, so its
pitch and eaves are estimates and the observation says not to move mats from
it. Ten of the 30 mats' 2025 edges are partly hidden by golfers in the
capture. The generic tee-line pass draws nothing here because
`scenery.rangeFacilities` is undefined, and the inferred target flags are off
because the course is `objectPlacement: mapped-only` with real target
surfaces — both correct.

## What is misaligned

One thing, and it is in the MODEL, not the display: `scenery.range` is OSM way
w221193966 verbatim (33,092 m², no date), and its north edge runs at z ≈ −181
across x −163…−112 while the tee line stands at z ≈ −178 to −197. The west
platform and all eight west mats have centroids OUTSIDE the range polygon, the
middle platform is half outside, and the shelter footprint is outside. Since
the polygon is the mown-fairway overlay, the atlas FAIRWAY class and the play
bounds, the tee line renders on rough and the "R" marker sits south of where
the hitting takes place. Two smaller items: the authored concrete platform
under the shelter (fixed height, z −197.1…−183.7) overlaps the
terrain-following mapped west platform (z −186…−179) by about 2 m, and no
divider, tray, net, distance sign or Toptracer unit is mapped, because none is
resolvable in either capture and OSM has no barrier line.

## Why this pass did not do it

Extending `scenery.range` north to take in the tee line is a model change:
`scenery.range` feeds `playB`, and `playB ± 150 m` is the reviewed v2
`legacyCoreCutout` for both Upsala slugs. It therefore goes through
`upsalabuild/mapping/` → `ground-mapping.mjs` → `tools/refresh-upsala-mapping.mjs`
(needs PROJ: `COURSE_GEO_PYPROJ_PYTHON`), re-emits both packs, the EPSG:3006
migrations and residual reports, and re-pins the source-manifest checksums and
`COURSE_MODEL_SHA256` — after which the two cutouts must be re-measured off
the assertion's own "got" line. Nothing on that list is display-only, and it
was not started in a checkout that two other sessions were committing to.
A display-only override of the polygon was considered and refused: it would
move the play bounds without moving the contract.

## The order that finishes it

1. Re-trace the range field's north edge on `upsalabuild/cache/facilities-2026-09-10/facilities-range-native.png`
   (0.16 m, 2025-06-14, geoTransform in `upsalabuild/facilities/reference-2026-09-10/orthophoto-manifest.json`)
   so it encloses all four platforms and the shelter, and the rest on
   `facilities-range-overview.png` (0.64 m). Write it as a reviewed
   `upsalabuild/mapping/range-field-2025.json` with the source pixels and hash,
   and fold it into `scenery.range` in `ground-mapping.mjs` the way the
   practice path is folded.
2. Run the Upsala refresh chain and re-measure both `legacyCoreCutout`s;
   `check-course-v2` must serve the ring graph on both slugs afterwards.
3. Decide one owner for the slab under the roof: drop the authored fixed
   platform where the mapped west platform stands, or drop the mapped one.
4. Optionally give the mats the Norrfällsviken treatment (least-squares
   platform planes, trays) through `applySurfaceAppearance` / `renderCourtyard`
   in `scenery/upsala.js`; the data is already in `mappedFeatures`, so this is
   display-only and needs no model change.
5. Gates: extend `tests/upsala-mapping.test.mjs` (mats/pads/ids), assert the
   range counts in `upsalabuild/facilities/check-authored-runtime.mjs` (it
   already shoots `range-front` and asserts nothing about it), then
   `tools/check-app.mjs`.

Nets, divider dimensions, the Toptracer unit and B08's eaves need evidence
that neither capture nor the laser gives; do not invent them.
