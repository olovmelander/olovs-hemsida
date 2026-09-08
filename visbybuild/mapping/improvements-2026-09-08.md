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

## Continued tee and range environment pass

Continuation from published main `0d3dc03627e72d35f67f80139f59d72965333b4d`.
All 18 tee areas were inspected on retained municipal 2022 exports at 0.25 m
per pixel. A separate range window was checked against the club-linked Caddee
property overview and the club's training-area page. The overview establishes
feature identity only; every adopted vertex comes from the georeferenced image.

| Change | Result |
| --- | --- |
| Physical tee turf | 27 additional platforms on holes 2, 4, 5, 6, 7, 8, 9, 11, 15, 16, 17 and 18; 2,174.03 m² of additional observed turf. Total inventory: 19 → 46 platforms. |
| Virtual tee starts | 38 shorter-tee references move 1.6–24.6 m onto nearby observed turf. Back references are retained. Starts on observed platforms increase from 22 to 67 out of 108. |
| Short-game green | 576.31 m² surface beside the range, separate from the earlier clubhouse putting green. |
| Neighbouring course | 562.19 m² green at the end of the corridor east of the range, retained as scenery without playable nine-hole routing. |
| Generation | Both source overlays are applied by full generation and the cache-independent adoption command. Source records preserve original pixels, export grids and image hashes. |
| Coastal water | Existing protection rerun against the expanded played geometry; the measured ground generation and sea topology remain unchanged. |

Virtual camera corrections use the nearest platform interior, inset by 1.5 m,
only within 25 m of the earlier reference. This bounded display correction does
not establish which numbered marker occupies which platform. The 2022 mowing
edges carry an estimated 2 m interpretation uncertainty; independent geographic
control and later changes are still unverified. No surveyed daily tee positions,
new equipment, trees, building dimensions or current mowing precision are claimed.

`tee-platform-review.json` retains all inspected windows, accepted polygons,
old camera references and displacement measurements. It also records the areas
not adopted: the post-2022 third-hole rebuild, unresolved hole 12 platforms,
ambiguous connected turf at holes 10 and 14, and the possible turf nursery near
hole 13. The H9 green/approach discrepancy remains unresolved. The first-hole
renovation announced for October 2026 and spring 2027 opening is future work as
of this review and has not replaced the source model.

`environment-surfaces-review.json` keeps the short-game and neighbouring green
identities distinct. The two greens and all new tee polygons are valid, mutually
separate from other tee platforms, and have zero area overlap with mapped water,
buildings, bunkers or main-course greens. Their source overlays were inspected;
`facility-validation.json` retains these geometry results.

Additional reproducible source QA, using the existing Python mapping dependencies:

```sh
python visbybuild/mapping/acquire-facility-windows.py
python visbybuild/mapping/check-facility-review.py --write --overlay
```

The acquisition command replays committed review grids after cameras change;
raw images and overlays remain in ignored cache. The adoption and publishing
commands above regenerate the model, pack, fallback binding and migration.
Refresh the two Visby acquisition-registry hashes after migration as described
above. The final pack is 528,573 bytes; measured ground manifest remains
`98c29c691ccf425008e62758c3710203064e6016f133eb09801c186f5a9b76f5`.

Validation: 41 Visby tests, source-ledger gate, all-course source planning,
coastal topology regression, 519 Vitest tests and 390 Node tests passed (three
existing skips). Production build and the published-graph build gate pass.
The deployed page was opened, but the cloud browser could not create WebGPU or
WebGL2, failing at graphics initialization. These results are source-image and
software validation; in-app tee-height, aerial and grazing-angle acceptance is
still open.

## Tee camera and numbered-platform correction

Continuation from main `6cedb4f350a23270768a7f4415e4fdd1acc5dbf2`, following
feedback that the tees still felt displaced. Two different faults were found.

The application placed the eye seven metres behind every selected tee, along
the back route's initial bearing. This moved 36 references out of the very
platform containing them. Across all 108 Visby selections, only 38 actual
camera positions landed on any mapped platform, although 67 reference points
were inside one. The camera now stands at the selected reference at the shared
walking eye height of 1.7 m, and looks along 72% of the route remaining from
that reference. A forward tee after a dogleg no longer aims behind itself.
This is a shared camera correction; the source coordinates of other courses
are unchanged.

Separately, the retained Caddee plans establish the numbered platform groups
on holes 1 and 9. The plans supply identity and topology, not a metric image
registration; physical boundaries still come from the municipal orthophoto.

| Selection | Correction |
| --- | --- |
| Hole 1 / tee 59 | Back platform shared with 63, instead of the middle platform belonging to 55/51. Representative reference moves 8 m back, to local (-579, 166.25). |
| Hole 9 / tee 41 | Front roadside platform, instead of a route-derived point on the other side of the approach. Representative reference moves 37.665 m, to local (-353.88, 20.65). |

The two review records retain the guide asset URLs and hashes, printed-label
pixels, and all six platform associations per hole. Regeneration validates
membership in the associated platform: being inside some other tee polygon
is no longer sufficient. An explicit regression rejects the previous hole-1
placement. The larger hole-9 correction relies on the plan identity and is
recorded separately from the earlier bounded nearest-platform nudges.

Actual tee camera positions now match their references for all 108 selections;
68 are on mapped platforms. The remaining 40 reference positions still need
source work, and membership alone does not establish a numbered association
on the other holes. The 2022 image and guide disagree in several tee areas,
including the separate hole-5 platform across the path and hole-17 platform
sequence. Hole 12's start, the post-2022 third-hole rebuild and hole 9's green
outline remain unresolved. No current daily marker positions are claimed.
The contemporary public viewing request returned an empty body, so it supplied
no new usable imagery for those remaining decisions.

Validation: 521 Vitest and 391 Node tests passed, with three existing skips;
42 Visby checks, source manifests, 180-hole source planning, source-overlay
inspection, production build and published-graph build gate passed. The
application camera test executes the actual `setCam` function against all
108 Visby references and checks forward-tee framing and gesture handoff.
The source terrain and coastal-water geometry are unchanged, with all 1,392
played-area samples still protected. Cloud graphics initialization remains
unavailable, so rendered 3D visual acceptance is still outstanding.
