# Upsala facilities: runtime and Blender integration reference

Read-only production audit, 2026-09-10. This packet prepares modelling references; it does not replace building geometry, adopt building heights, change terrain, or install a GLB renderer. The new municipal reference outlines in this directory remain separate from the currently shipped model. No applicable `AGENTS.md` was found in the repository or its parent directories.

## Current geometry and appearance

`upsalabuild/course-model.json` and `upsalamellanbuild/course-model.json` contain **444 identical building records**. All have `h: null`; none has `roofSurface`. The current inventory is 401 retained OSM records plus 43 adopted municipal records. `upsalabuild/ground-mapping.mjs:29` removes the 13 superseded OSM records and adopts the reviewed municipal selection from `upsalabuild/mapping/municipal-buildings.json`, stripping source-only coordinates. `tools/build-nine.mjs:341` shares the parent infrastructure with Mellan. Future appearance assets should refer to this shared ground once, while both routing slugs resolve the same asset.

The shipped clubhouse is **`w221193965`**, named `Upsala golfklubb`: a 14-vertex stepped outline, 946.565 square metres in the persisted course frame, bounding box x=-3.5..34.0, z=-305.0..-250.8. This is an existing mapped outline, not a new surveyed wall plan. The exact EPSG:3006 transform of the same outline measures 949.325 square metres because the persisted course frame is an approximation to the projected grid.

The following current model building centroids lie within 250 m of the clubhouse. Area and positions below use the persisted course frame. A `sport`, `hut` or `outbuilding` tag alone does not establish the building's present function.

| Current ID | Current kind | Area m² | Centre x, z (m) |
| --- | --- | ---: | --- |
| w221193965 | yes; named clubhouse | 946.565 | 17.783, -279.143 |
| w438967932 | yes | 84.480 | -4.550, -285.550 |
| uppsala-building-92448 | outbuilding | 25.899 | 31.182, -311.924 |
| w438967931 | yes | 59.775 | 45.856, -254.395 |
| w221193959 | sport | 131.320 | 66.950, -312.900 |
| w221193957 | sport | 132.640 | 43.250, -213.350 |
| w221193967 | sport | 21.450 | -30.600, -189.850 |
| w221193968 | sport | 428.291 | 101.593, -199.524 |
| uppsala-building-592773 | outbuilding | 168.656 | 108.017, -365.383 |
| w221193963 | sport | 223.738 | 131.204, -220.908 |
| w221193971 | sport | 285.769 | 120.523, -181.963 |
| w438967927 | yes | 56.700 | 172.121, -245.285 |
| w438967940 | yes | 49.180 | 139.250, -381.050 |
| uppsala-building-1390787 | outbuilding | 24.842 | 140.561, -399.558 |
| w221193969 | sport | 169.790 | -133.500, -190.050 |
| w438967947 | hut | 13.340 | -25.350, -472.650 |

The newly acquired municipal comparison is indexed separately by B01… in [building-reference-inventory.json](building-reference-inventory.json), including candidate matches to current IDs. B01 is municipal object 1215269, the main clubhouse complex, and B02 is the attached west component. Those IDs and outlines must not silently be conflated with the single current OSM clubhouse polygon. The municipal service exposes geometry Z values, but their meaning is unverified and includes 0/-999 sentinel values. The reference inventory correctly leaves eave, ridge, floor and wall heights unknown.

Three current appearance paths differ:

* `apps/golf/src/engine/scenery/upsala.js:13` specifies cream walls, orange-brown roof, 4.4 m generic wall height and one window row. Its descriptive comment mentions gables, but it exports no authored roof geometry.
* `apps/golf/src/engine/scenery/index.js:38` registers `upsala` but has **no `upsala-mellanbanan` alias**. Mellan therefore uses the generic 5.4 m/two-window-row clubhouse defaults in `apps/golf/src/main.js:777`, despite sharing exactly the same ground and building IDs.
* `upsala3d.html:3460` has an independent generic clubhouse implementation, including 5.4 m height and dark-red roof. It does not automatically consume the app scenery module or future GLB assets.

These are concrete future integration fixes, not evidence that either generic height describes the real building. No production fix is made by this reference task.

## Facilities already represented

`upsalabuild/mapping/facilities.json` supplies 20 reviewed features: four practice greens, one non-turf island, four range tee platforms, six range target surfaces and five range bunkers. The current model has **53 mapped scenery features** after adding 30 individually mapped range mats, two short-game bunkers and one paved practice path. There are seven parking polygons and 235 mapped infrastructure point records; these points have varied tags and must not all be treated as the same object type.

The clubhouse putting green is `practice-putting-green-clubhouse`, centre [5.023, -234.326], with a 22.065 m² central island that must remain a hole. `practice-putting-green-range` is centred [-41.093, -179.994]. The four range platforms are `range-platform-west`, `range-platform-middle`, `range-platform-east`, and `range-platform-east-extension`; mapped mats have west-01…08, middle-01…10 and east-01…12 identities. Preserve these relationships when authoring shelters or furniture.

The source build ends with `infra.objectPlacement='mapped-only'` (`ground-mapping.mjs:121`). Current rendering accordingly suppresses inferred residential buildings, range hardware and generic parked cars. New facility meshes should identify exact physical objects and replace only those objects. Their presence must not reactivate generic repetitions.

## Coordinate and height contract

Use the persisted model constants, including the rounded longitude scale:

```text
origin latitude  = 59.839
origin longitude = 17.4952
mPerLat          = 111320
mPerLon          = 55930.68
longitude = 17.4952 + xCourse / 55930.68
latitude  = 59.839  - zCourse / 111320
```

The course is x east, z south. Convert EPSG:3006 through an explicit EPSG:4326 transform with longitude/latitude order, then apply the equations. Do not directly subtract easting/northing or fit a translation to an image. `apps/golf/src/engine/geodetic-frame.mjs:119` already derives the approximately 2.16-degree grid-to-course correction for the terrain. Applying that correction again to an asset authored in course coordinates would misalign it.

Preferred **horizontal authoring anchor**, the current clubhouse polygon area centroid:

| Representation | Exact or preserved value |
| --- | --- |
| Course x, z | 17.782932674107595, -279.1431474154793 |
| WGS84 longitude, latitude | 17.495517945940836, 59.84150757408745 |
| EPSG:3006 easting, northing, via pyproj | 639837.5643451979, 6636394.187326529 |

This is a reproducible model anchor, not a surveyed entrance point. It agrees with the guarded Upsala marker in `apps/golf/src/shell/map.js`. The repository projection and pyproj differ here by approximately 0.8 mm, far below the outline's unknown physical accuracy.

Use **RH 2000 absolute heights** for the reference scene. Upsala's legacy heightfields were rebuilt from the Lantmäteriet ground DTM; `upsalabuild/lib-v2.mjs` documents this and the zero vertical offset. `apps/golf/src/engine/v2-upsala-config.mjs:60` keeps `verticalDatumOffsetMetres:0`. The v2 terrain origin height 13.28 m is restored by `v2-graph-frontier.mjs:292` when terrain enters the legacy scene frame. A building attached to the scene root uses absolute RH 2000 world Y; it must not subtract 13.28 m a second time.

For a full reference scene, one Blender unit is one metre:

```text
xBlender =  xCourse
yBlender = -zCourse
zBlender =  heightRH2000
```

For a deliverable asset near its own origin, choose and record H0, then author `[xCourse-x0, -(zCourse-z0), heightRH2000-H0]`. With glTF's Y-up export conversion, those vertices become `[xCourse-x0, heightRH2000-H0, zCourse-z0]`; load at app position `[x0,H0,z0]`, unit scale, identity rotation. This is a derived mapping from the two frame definitions and the exporter convention. Blender's manual documents the [Y-up glTF export option](https://docs.blender.org/manual/en/4.3/addons/import_export/scene_gltf2.html). Do not add another -90-degree rotation after export. Include a labelled one-metre east/north/up fixture in an export check, and check the reimported pivot and bounding box. Apply the anchor once, not both inside the scene transform and in the app.

**H0 remains an authoring choice, not a measured floor elevation.** Native 1 m DTM sampling gives approximately 34.968 m RH 2000 at the clubhouse centroid; legacy HF0 sampling gives approximately 34.990 m. HF0 heights at the current footprint vertices range approximately 34.737–35.200 m. The current `houseBase` helper (`main.js:5761`) uses the maximum active `terrainH` at outline corners plus 0.06 m, with a skirt. `terrainH` follows the visible terrain sampler when available, so an offline HF0 number is not a substitute for the current visible-mesh placement policy. Preserve the ground and fit a reference-backed foundation/contact treatment; never drape roof vertices onto the terrain.

The earlier municipal ground-height comparison, `upsalabuild/mapping/municipal-ground-height-check-2026-09-07.json`, contains ground measurements, not roofs. Its nearest eligible clubhouse control is about 48 m east: object 1693103, E639885.586669/N6636397.632798, ground 34.580 m RH 2000. The registration date is not the measurement date. Neither this point nor the DTM measures the clubhouse floor or eaves.

## Newly acquired laser reference

[lidar-roof-evidence.json](lidar-roof-evidence.json) records a **250×250 m** bounded window from the pinned 2021 campaign `21c037-663_63`, E639730…639980 / N6636270…6636520. The catalogue capture range is 2021-03-07…2021-04-01; its representative timestamp is 2021-03-19. No exact acquisition day is assigned to individual points.

The authenticated extraction independently checked the source length, LAS point count, complete hierarchy sum, exact decoded node counts, and LAS WKT. pyproj resolves that WKT to **EPSG:5845**, combining EPSG:3006 horizontal coordinates with EPSG:5613 RH 2000 heights. A total of 168 range requests transferred 2,534,131 bytes. The full gigabyte source file was not downloaded, so the catalogue full-asset SHA is explicitly distinguished from independently hashed extracted output.

There are **99,607 returns**: 81,213 class 2, 18,383 class 1 and 11 class 7. There are no class 6 returns. The [ASPRS LAS specification](https://www.asprs.org/wp-content/uploads/2019/03/LAS_1_4_r14.pdf) defines these as ground, unclassified, low/noise, and building respectively. Footprint membership does not promote unclassified returns to building or roof classes.

The report summarizes each class separately within a one-metre inward buffer of 13 current outlines and 16 newly acquired municipal reference outlines. The current clubhouse core contains 1,146 unclassified returns: RH 2000 p05/p50/p95 **38.770/40.525/42.977 m**, or **3.794/5.559/7.988 m** above the separately sampled 2023 DTM. These distributions can guide later point-cloud/photograph inspection. They are not estimated eave, ridge or wall heights. The same core contains 34 class-2 returns, median 34.975 m RH 2000. Mixed outlines, ground-visible portions, trees and 2021–2026 changes still require interpretation.

Ignored local assets, with hashes and formats recorded in the JSON:

* `upsalabuild/cache/facilities-reference-2026-09-10/lidar/clubhouse-central-2021.csv.gz`: all seven extracted LAS dimensions retained for the bounded window.
* `clubhouse-central-2021-course-frame.ply` in that directory: 99,607 reference vertices, no faces, full-course Blender frame x=xCourse, y=-zCourse, z=absolute RH 2000. **No anchor subtraction** is embedded in this PLY.
* `source-crs.wkt` and `window-acquisition.json`: CRS and extraction provenance.

Reproduce from the repository root:

```powershell
node --env-file=.env upsalabuild/facilities/reference-2026-09-10/acquire-lidar-window.mjs
upsalabuild/cache/review-venv/Scripts/python.exe upsalabuild/facilities/reference-2026-09-10/summarize-lidar-window.py
```

The raw cloud remains in ignored cache. No LAS returns or municipal source Z values have been adopted into a production roof, terrain or building height.

## Final package coverage audit

The final ASCII-escaped inventory SHA256 is `fa1beb5a1ab40367d51c9e28330a23966fb568961dc85a523b3eea5c0bb56a1b`; it matches the laser report's pinned footprint source. The model hash also matches. All five source hashes in the orthophoto manifest were checked against local files. The raw municipal response contains 19 features and the inventory retains all 19. Every source outline is fully covered by the union of the two native-resolution image windows.

The laser window covers 15 of those outlines completely and B17 partly. It excludes B08 (range shelter), B14 and B15 (eastern woodland-edge building parts). This bounded extraction therefore supports the clubhouse and most central buildings, not all 19 parts. Their orthophotographs are available; additional laser coverage would be a separate bounded acquisition.

`context-geometry-local.json` is a subset: 15 current building alternatives, six parking polygons and 20 practice surfaces. It does not include the current model's 30 individually mapped range mats, two practice bunkers, paved practice path, or mapped point fixtures. Those existing records can be added to an authoring reference from the current model and their source ledgers without a new acquisition. They must keep their original provenance; presence in the current model is not a fresh survey. The missing seventh model parking polygon and the sixteenth nearby building listed above are outside this packet's selected context inventory.

The requested supplement is now exported as [supplemental-context.json](supplemental-context.json): 30 range mats, two practice bunkers, one paved path, seven OSM fixtures and 228 OSM tree points. Each record retains the current model feature, source pointer, hashed evidence source and exact local/projected/WGS84/anchor-relative flat Blender coordinates. All 268 records match the shared Mellan model; OSM points also match the source OSM feature file. The seven fixtures are a flagpole, three fountains, two gates and a mast. They have no measured dimensions or confirmed current presence. Coverage flags distinguish image availability: all mats and the path are within native imagery, one practice bunker is fully covered by native imagery, both bunkers are covered by the overview, and only the flagpole is among the fixtures within the native windows. The three fountains are also in the overview. Other remote points remain explicit optional references. Reproduce with `upsalabuild/cache/review-venv/Scripts/python.exe upsalabuild/facilities/reference-2026-09-10/compile-supplemental-context.py`.

Even with complete image coverage, the package cannot yet establish ground-level wall lines versus roof edges, roof overhangs, floor/eave/ridge elevations, exact B01/B02 terrace enclosure, every function-to-building match, or door/window dimensions. The 2021 laser and 2025 imagery also cannot confirm later changes. Photographs and any original plans should resolve these component-level questions before a production solid is accepted.

## Concrete future asset insertion

`main.js:5903` exposes a synchronous `SCENERY.renderClubhouse({building,features,terrainH,tri,L})` hook. A truthy geometry result skips the generic building immediately. `renderArchitecture` similarly handles source-backed authored geometry, while `buildingGeometry=source` retains an explicit source view. The late `buildScenery` call at `main.js:6663` can add scene objects asynchronously, but no GLTFLoader or external GLB lifecycle exists today.

All generic building triangles are merged into one buffer/mesh at the end of that pass. An already-rendered clubhouse cannot be removed by its building ID afterwards. A safe pilot therefore needs either an isolated fallback group for its exact physical IDs, or a validated asset resolved before the merge. An async load must swap the fallback only after success; returning a truthy skip before an unverified load would leave a missing building on failure. Keep the geographic building record for spatial indexes, canopy exclusion and GIS even when its visible triangles are replaced.

The implementation sequence for a later production task is:

1. Freeze accepted outlines and photo/laser interpretations, record source confidence per component, and decide which current physical IDs the clubhouse asset replaces. B01/B02 reference parts need an explicit relationship to current `w221193965` and any overlapping current feature.
2. Author the reference scene in the contract above. Keep unconfirmed geometry in a separate reference collection. The parent operator reports Blender 4.5.9 connected on port 9876 with an unsaved Tortuna architecture scene active; the intended new Upsala scene is created through the data API without activating/replacing Tortuna, and written separately via `bpy.data.libraries.write`. This audit did not access the Blender connection.
3. Export a versioned GLB, explicit lower-detail meshes, bounded materials/textures, and an asset manifest with physical IDs, anchor, datum, orientation, dimensions, bounds, hashes, source references and redistribution status. `docs/v2-graphics-improvement-guide.md:511` proposes 8–15k near desktop / 2–4k phone or distant triangles, 2–3 materials and a shared 1k atlas for this pilot; these are project targets, not measured current asset costs.
4. Add a narrowly scoped loader and fallback lifecycle, register the same appearance module for both `upsala` and `upsala-mellanbanan`, and suppress only the replaced IDs. Retain source-view and load-failure fallbacks. Handle LOD, cache/disposal and offline asset URLs explicitly. The guide's `assets-src/golf/` and `apps/golf/public/assets/golf/` paths are a proposal, not an existing pipeline.
5. Decide explicitly whether the standalone `upsala3d.html` also loads the appearance asset; its separate renderer currently needs its own integration. `upsalabuild/embed.mjs` embeds model geography and does not itself deliver an appearance pipeline.
6. Validate footprint and orientation overlays, foundation contact in v2-required and legacy terrain modes, both routing slugs, the standalone page if supported, absence of duplicate geometry, finite bounds/material budgets, and failure/offline fallbacks. Changes solely to appearance must leave canonical terrain and routing coordinates unchanged.

If a future task also changes accepted building footprints, use a guarded source-to-model helper in the shared ground build and the established `tools/refresh-upsala-mapping.mjs` rebuild. Direct edits to a generated model or independent Mellan copies would be lost or diverge on refresh.
