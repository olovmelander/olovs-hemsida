# Visby coastal rendering and mapping review

Base commit: `70c65bc`. The broad environment request is being worked on in
`claude/visby-golf-course-v2-7058k5`.

## Coastal rendering

The previous global sea mesh covered the entire 4096 m fallback heightfield,
including the course, mainland and islands. It depended on depth alone to hide
water beneath land. Its slope-scaled polygon offset grows at grazing angles.
It also stopped at the fallback boundary even though the default world reaches
16,384 m. The distant terrain tint used elevation alone to identify sea.

`coastal-water.mjs` replaces that sheet for measured coastal grounds. Inside
Visby's 4096 m water-source window, original water polygons remain authoritative.
Outside it, the visual extension uses finite low terrain connected to the mapped
sea, checking cell centres, corners and edge centres. No extension quad overlaps
the source window. Disconnected low pockets remain dry. The far tint and tree
exclusion read the same field. Source terrain, shoreline polygons and declared
water levels are unchanged.

The display sheets have an explicit 0.06 m vertical separation above the laser
surface; the extension uses the sea tolerance plus 0.01 m. This is a rendering
clearance, not measured bathymetry or a revised water level. Measured water uses
constant depth bias only. Other courses retain their existing water treatment.

`node visbybuild/check-coastal-water.mjs` reconstructs the current published
terrain and checks the real source topology without raw acquisition caches.
The retained report records 1,257 played points, 65,536 source-window queries,
ten islands with 11,631 interior probes, and 64 low dry samples protected from
the old contour test. The extension uses 636 quads for approximately 13,275 ha
outside the source window; calculation took 237 ms here. This is CPU timing,
not device frame-rate evidence. The 32 m distant sampling does not establish
exact positions of smaller coastal features.

The local production build and Visby artifact/source gates pass. Camera-angle,
WebGPU, mobile-device and visual acceptance remain open: the available cloud
browser rejected the local preview address. No screenshot or GPU performance
claim is made. `V3D.coastalWater()` exposes the installed geometry and clearance
for a subsequent browser check.

## Mapping work

The existing source research already flags the H9 green/approach complex and
incomplete physical tee inventory. A fresh georeferenced 2022 municipal crop
around H9 and the clubhouse was acquired for review. No disputed boundary is
moved merely to agree with scorecard length or the older GolfTraxx target.

The adopted source-pixel review adds a 955.53 m² putting green immediately west
of the clubhouse and two H1 platforms of 250.31 m² and 75.69 m². All three
polygons are valid and clear the mapped water and building footprints. The
club's training page corroborates the putting green's identity. The raw crop
is not shipped; `facilities-review.json` records its request, exact extent,
pixel vertices, SHA-256 and interpretation limits. Image boundaries have an
estimated 2 m interpretation uncertainty, with independent registration and
post-2022 changes still unverified.

Five H1 virtual camera references move 2.0–6.7 m from earlier card-offset
positions into the visible platforms. All six now start on mapped tee turf.
The original back platform and its camera are retained. This does not assert
the daily marker positions or conclusively assign numbered tees to platforms.
The six tee labels, all 108 official lengths and all 18 route lines are retained.

The authoring overlay is idempotent and used by both full generation and the
cache-independent adoption command. `apply-tee-marks.mjs` now preserves explicit
source references. The source-ledger refresh also tolerates the current canopy
evidence schema without changing acquired laser identities. The compatibility
pack, projected migration, ledger and v2 fallback binding are regenerated.
The 469-tile ground, all terrain samples, stand and tree assets remain the same
published generation.

## Extent of this pass and remaining work

| Area | Result / remaining evidence |
| --- | --- |
| Sea, shore and low mainland | Blanket ocean removed for measured coastal grounds; mapped islands and dry terrain protected; low-angle rendered acceptance still required. |
| Tees and training green | Two observed H1 platforms and clubhouse putting surface added. The rest of the physical tee inventory, including H12, still needs source review. |
| Greens, fairways and bunkers | Existing source geometry and official routing retained. H9 remains disputed; no arbitrary displacement is adopted. Current mowing edges and bunker completeness are not established by 2022 imagery. |
| Rough, fields, forest and trees | Existing measured canopy and land-cover layers retained. Detected crowns and stand representatives are not independently surveyed single trees. |
| Clubhouse, finish and range | Existing mapped buildings, lighthouse and range field retained; new putting surface restores a missing part of the arrival area. Exact equipment, Trackman bays, furnishings and building finishes still need contemporary positional evidence. |
| Banguide and Spelsinne | Existing 18 hole-specific guide notes and verified scorecard retained. No new strategic advice is presented as club-authored. |
| Textures and camera experience | Coast topology/depth treatment changed; a rendered inspection at tee height, aerial height and grazing angles remains open. No device FPS claim. |

## Reproduction and validation

Run from the repository root, in order:

```sh
node visbybuild/mapping/apply-reviewed-facilities.mjs --write
node packages/course-pack/emit-pack.mjs visbybuild apps/golf/public/courses/visby visby
node packages/course-pack/emit-manifest.mjs
node tools/rebind-v2-fallback.mjs --slug visby
node visbybuild/update-source-manifest.mjs
node packages/course-geo/migrate-legacy.mjs --ground visby --write
node visbybuild/update-source-manifest.mjs
node visbybuild/check-coastal-water.mjs --write
npm run check:visby
npm --prefix apps/golf run build
node packages/course-v2/check-app-build.mjs
```

38 Visby tests, the source-manifest gate, actual-terrain coastal regression,
production build and complete published-graph build gate passed. The new
boundaries were visually checked on the registered source overlay, with
polygon validity and water/building overlap checks. This is source-image QA,
not an in-app camera screenshot.

## Integration with main

Main advanced to `00854a0` during publication. Its release-audit fixes were
merged without textual conflicts, including the restored Upsala ground cover
and full CI test command. The offline COPC reader is now installed for that
expanded CI suite, and the coastal unit tests are registered in the main test
command. The per-hole acquisition registry's Visby model/migration hashes are
refreshed to this reviewed generation. `check:visby` also runs the repository
hole-source planner, so future model changes cannot silently leave that second
registry stale. When regenerating Visby, update its reviewed hashes in
`hole-source-controls.mjs` and `hole-source-inventory.mjs` alongside the ledger.

The combined tree passes 519 Vitest tests and the complete Node suite (387
passed, three existing environment-dependent skips), the production build,
published-graph gate, Visby migration currency check and all-course source
planning for 180 holes. Source-image and in-app visual QA remain distinct.
