# Upsala authored architecture runtime contract

The app consumes `apps/golf/src/engine/scenery/upsala-authored-meshes.json`, exported from the Blender authoring scene. Both `upsala` and `upsala-mellanbanan` load `scenery/upsala.js`. The JSON becomes an optional Vite chunk and its triangles join the existing scenery mesh. The editable `.blend` and `.glb` deliverables are separate authoring assets; reference photographs are not bundled into the runtime material data.

Verified on 2026-09-10 against export SHA-256 `2f7105580c34071bb3a3101b594b6df34fb3d7a3d1ed6054d3d0d92b26920469`: 12 authored assets represent 19 reference parts and replace exactly 13 of the 444 retained source records. The package contains 39,479 authored triangles. All 24 focused/regression tests, the isolated production/PWA build and all seven actual-browser scenarios passed. The [runtime report](runtime-validation.json) records complete served-mesh equality, 60 roof intersections and 17 captures, including actual WebGPU. Source view and a deliberately blocked optional mesh chunk both restored all 444 generic buildings. The largest roof-hit discrepancy was 0.0884 m; this check uses debug ray-hit coordinates rounded to 0.1 m and is a rendering check, not a survey-accuracy claim.

```text
schemaVersion: 1
groundId: "upsala"
frame:
  origin: {lat: 59.839, lon: 17.4952}
  mPerLat: 111320
  mPerLon: 55930.68
  verticalDatum: "RH2000"
assets[]:
  id: stable authored asset ID
  renderOnBuildingId: one of the replaced building IDs
  replaces[]: {id, ring: [[courseX, courseZ], ...]}
  referenceOutlines[]: {sourceId, ring: [[courseX, courseZ], ...]} (optional)
  parts[]:
    name: component name
    color: integer 0xRRGGBB
    positions: [courseX, absoluteHeightRH2000, courseZ, ...]
    indices: [vertexIndex, vertexIndex, vertexIndex, ...]
  foundations[]:
    ring: [[courseX, courseZ], ...]
    topHeightRH2000: absolute authoring height
    color: integer 0xRRGGBB
    maxGroundGapMetres: default 3, maximum 6 (optional)
  evidence: concise provenance/interpretation statement (optional)
```

`referenceOutlines` records reviewed components extending beyond an older source outline, such as the eastern range structure. It never adds a source suppression ID. `replaces` must contain every exact current-model record to suppress; the runtime compares vertex count, order and coordinates within 1 mm to accommodate float packing. It validates all members of a multi-building asset before suppressing any one of them. Missing, duplicated or changed source records keep the original generic buildings.

Positions are already in app world coordinates. The runtime adds no anchor, rotation, scale, terrain offset or vertical datum correction to the authored parts. Roof vertices remain fixed. Foundation strips sample the active terrain at intervals no longer than one metre, with a buried skirt extending at least 1.2 m below their declared top and at least 0.2 m below sampled ground. This handles terrain LOD refinement without moving the roof or changing the DTM. A nonfinite sample or excessive ground discrepancy rejects that asset before emission.

Validation also checks package identity, fixed coordinate frame, finite vertices, indexed triangles, material colours, local proximity to declared outlines and bounded vertex/triangle counts. All preparation and colour conversion complete before any triangles enter the shared batch. The designated building emits each asset once; other replaced records return only explicit suppression metadata. New scene batches have independent state even when the same module serves both routings.

No new GPU geometry, materials, textures or scene objects are owned by this adapter. The existing scenery mesh owns emitted triangles and normal computation. Temporary triangle preparation is released after emission; per-batch state uses weak references. A missing or invalid optional chunk returns the generic renderer. `?buildingGeometry=source` bypasses the authored hook entirely. Runtime diagnostics are available as `V3D.stats.architectureAssets` and `V3D.stats.clubhouseDetails`.

Checks after the final export:

```powershell
node node_modules/vitest/vitest.mjs run apps/golf/src/engine/scenery/upsala-architecture.test.mjs apps/golf/src/engine/scenery/upsala-authored-assets.test.mjs tests/upsala-object-placement.test.mjs apps/golf/src/engine/scenery/lidingo.test.mjs --maxWorkers=1
node tools/lint-app.mjs apps/golf/src/engine/scenery/upsala.js apps/golf/src/engine/scenery/index.js apps/golf/src/main.js
Push-Location apps/golf
node node_modules/vite/bin/vite.js build --outDir ../../upsalabuild/cache/authored-runtime-build-2026-09-10
Pop-Location
# Serve this isolated build in a separate terminal:
upsalabuild/cache/review-venv/Scripts/python.exe -m http.server 8646 --bind 127.0.0.1 --directory upsalabuild/cache/authored-runtime-build-2026-09-10
$env:BANVY_GPU='1'
$env:UPSALA_ARCHITECTURE_URL='http://127.0.0.1:8646'
$env:UPSALA_ARCHITECTURE_DIST='upsalabuild/cache/authored-runtime-build-2026-09-10'
$env:UPSALA_ARCHITECTURE_QUICK='0'
node upsalabuild/facilities/check-authored-runtime.mjs
```

The browser checker defaults to the built app at `http://127.0.0.1:8636` and `apps/golf/dist`; the environment values above select an isolated build while other courses are being edited. It verifies served pack/module identity and decodes the actual served mesh chunk to compare every validated vertex, index, material, foundation and replacement against the current Blender export. It then checks both course slugs and terrain modes, exact replacement counts, preserved source records, ray intersections with exported roof coordinates, source-view restoration and a blocked mesh-chunk fallback. Four authored scenarios cover both routings and terrain modes on WebGL2; an additional Stora required-v2 scenario asserts actual WebGPU rendering. The two source/failure scenarios use WebGL2. All use hardware acceleration and make no performance claim. Screenshots remain in ignored cache. The tracked result is `runtime-validation.json` in this directory. Setting `UPSALA_ARCHITECTURE_QUICK=1` instead runs only one prototype scenario and writes an ignored report explicitly marked incomplete. The standalone page has its own renderer and is outside this app integration.

An existing tall dark parking/road edge remains visible east of the clubhouse in the v2 campus overview. A separate source-view capture with zero authored buildings reproduces it at the same location (`upsalabuild/cache/authored-facilities-runtime-2026-09-10/diagnostic-source-parking.png`). This integration does not alter that terrain/paving geometry. A read-only polygon overlap check also found no unreplaced source building intersecting the 19 reference outlines by more than 1 m².
