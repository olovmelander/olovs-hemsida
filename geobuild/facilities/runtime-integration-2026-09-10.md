# Veckefjarden facility integration — 2026-09-10

The clubhouse, accommodation buildings, pool, padel court, range shelter/apron,
western buildings, terrace and parking now load in both `veckefjarden` and
`veckefjarden-korthalsbanan`. The live development app serves the change at
[localhost:5173](http://localhost:5173/?bana=veckefjarden).

## Runtime asset

- [Optimized GLB](../../apps/golf/public/models/veckefjarden/facilities-v1.glb)
- [Manifest and source receipts](../../apps/golf/public/models/veckefjarden/facilities-v1.json)
- [Reproducible baker](prepare-runtime-models.py)
- [Binary and projection audit](runtime-model-build-audit.json)
- [Course loader](../../apps/golf/src/engine/scenery/veckefjarden-facilities.mjs)

The 2.77 MB asset contains 20 facility groups and 89 material meshes. It preserves
all 44,422 source triangles and 19 procedural PBR materials. Separately editable
Blender geometry remains in the original workspace; no reference photographs are
distributed as textures. Geometry is batched by feature, material and ground-contact
role, reducing the 2,083 original material draws by about 95.7%.

Every vertex is projected from the Blender grid origin E684390/N7023040 through
EPSG:3006 → WGS84 to the actual pack frame: origin 63.2845/18.6735,
50045.09 m per longitude degree and 111320 m per latitude degree. The baker
transforms normals with the inverse transpose of the projection Jacobian.
The binary keeps absolute RH2000 Y. The app adds its established 20.9924 m datum
bridge once when using Lantmateriet terrain. Arithmetic round-trip error below
0.000034 m describes numerical transport, not absolute survey accuracy.

## Replacement and ground contact

Both published packs lack building IDs. The loader therefore verifies each
stored outline and index before suppressing building indices
`0,1,3,4,5,6,24,25,26,28`, including the two hotel connectors. Parking indices
`0,1,3` are also replaced. Unmodeled neighboring structures remain in the source
batch. The existing range bay fixtures are suppressed after successful loading.

Only a complete asset with matching SHA-256, geometry bounds, coordinate frame
and source outlines can replace placeholders. A failed, cancelled or mismatched
load leaves the source buildings and parking available. `?buildingGeometry=source`
retains a comparison view. Existing tree exclusion hooks use the reviewed facility
outlines, and inferred cars cannot overlap the new facility footprints.

Six ground sheets (`S01,S04,S05,S06,S07,S08`) are tagged separately from buildings,
raised decks, furniture, stairs, mats and poles. Their original 2 m sampled planes
could intersect small ridges in the visible 1 m terrain. The loader samples their
triangles at at most 0.5 m spacing and lifts shared vertices where necessary with
0.10 m rendering clearance. Their X/Z coordinates remain unchanged; the source
GLB elevations remain unchanged. The runtime report records every affected group,
sample count, maximum lift and bounds before/after fitting. This is display ground
contact, not a surveyed paving thickness or a change to the terrain.

The six ground sheets also use a dedicated
[course material palette](../../apps/golf/src/engine/scenery/veckefjarden-ground-materials.mjs).
The imported linear greys were too bright under the app's lighting and rendered
as cream/white parking and apron slabs. Native 2024 imagery supports matte grey
hardstanding, a darker/cooler range apron and a darker island interior. The app
now applies explicit sRGB grey colours, converted once to linear, with the same
subtle grain texture as its gravel roads. Only the tagged ground sheets receive
these display materials; foundation materials shared with architecture remain
separate. Asphalt versus compacted aggregate is still unverified.
The dedicated [appearance check](check-ground-appearance.mjs) captures the campus,
parking, terrace and range under both `golden` (Kväll) and `noon` (Dag), asserting
the active UI preset. Its report and images are saved separately in
`geobuild/cache/facilities-model-2026-09-10/ground-appearance/`.

The three parking lots now contain 24 parked cars: six in `S04`, twelve in `S05`
and six in `S06`. Their rows follow the native orthophoto and leave access lanes
open; occupancy is illustrative. The [car module](../../apps/golf/src/engine/scenery/veckefjarden-parking.mjs)
checks each car footprint against its lot outline, then samples the fitted paving
at four wheel positions to set its elevation and tilt. Painted bodies, windows,
wheels and lenses use six instanced draws shared across all 24 cars. They load
with the facilities on both course aliases and are disposed when leaving the
course. The appearance check verifies counts, finite transforms and wheel
clearance, alongside the daytime and evening visual review.

Roof heights, hidden facades and small architectural details retain the
documented estimation limits in the [modeling review](modeling-review-2026-09-10.md).
The broader legacy courtyard apron and nearby landscape still use existing course
data; this integration does not establish their accuracy.

## Verification

The focused tests load the real GLB and exercise outline mismatch, corrupt assets,
navigation cancellation, disposal, datum mismatch and paving over an intermediate
terrain ridge. The shared Johannesberg loader tests also pass after the common
installation hook was extracted. The real Vite application compiles into an isolated
cache directory; this compilation check omits the multi-gigabyte public terrain copy.

The [browser acceptance report](../cache/facilities-model-2026-09-10/browser/report.json)
checks both course aliases on WebGPU and an intentionally blocked-asset fallback.
It checks actual scene geometry, original receipt bounds, declared paving adjustments,
source-building replacement, ground anchors and application/GPU errors. Ten
screenshots in the same folder support visual review, including clubhouse views,
the campus, hotel/pool, range and western buildings.

All three final browser cases pass with zero JavaScript/GPU errors. Each course
loads 20 groups, 89 meshes and 44,422 triangles; blocked loading retains all 344
source buildings. Maximum ground-anchor residual is 0.0352 m. The six paving
meshes use 105,884 terrain samples, with a maximum local lift of 0.306 m; the
final screenshots show the earlier terrace/parking grass intersections resolved.

```powershell
& geobuild/cache/ortho-venv/Scripts/python.exe geobuild/facilities/prepare-runtime-models.py
npx vitest run apps/golf/src/engine/scenery/veckefjarden-facilities.test.mjs apps/golf/src/engine/scenery/johannesberg-facilities.test.mjs
node geobuild/facilities/check-runtime-build.mjs
node geobuild/facilities/check-runtime-models.mjs http://127.0.0.1:5173
node geobuild/facilities/check-ground-appearance.mjs
```
