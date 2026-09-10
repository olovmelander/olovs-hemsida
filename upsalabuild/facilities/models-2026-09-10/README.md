# Upsala facility models

The exterior asset set replaces 13 older building renderings with 12 Blender-authored facility groups on **both Stora banan and Mellanbanan**. It covers 19 municipal building parts: the clubhouse and west veranda, parking barn, red house, practice building and deck, covered range and small range building, service buildings and northern outbuildings.

[View the finished clubhouse preview](preview.png). The placed asset set contains 39,479 authored triangles; its optional app chunk is approximately 253 kB with gzip compression.

Open [upsala-facilities.blend](upsala-facilities.blend) to edit the model. The clearly named review collection contains a native DTM surface, lighting and camera; it is excluded from [upsala-facilities.glb](upsala-facilities.glb) and the runtime mesh export. Each building has its own collection and semantic mesh objects, with original procedural materials. There are no copied web-photo textures in the production assets.

The app consumes [upsala-authored-meshes.json](../../../apps/golf/src/engine/scenery/upsala-authored-meshes.json), exported from the actual Blender mesh vertices and triangles. It loads this as an optional Vite chunk and inserts geometry into the existing scenery triangle batch. It does not create a second GLTF renderer or add a material draw call for each window. The GLB is also supplied for reuse and editing.

## Coordinates and evidence

- Placement uses the existing Upsala course frame: origin 59.839°N, 17.4952°E; 111320 m per latitude degree and 55930.68 m per longitude degree. Runtime vertices are `[xCourse,heightRH2000,zCourse]`.
- Blender uses metres near the clubhouse. Its origin is course XZ `[17.78293267410761,-279.14314741547946]`, RH2000 `34.968`. Blender XY points east/north; Z points up. These values are also stored as scene properties.
- Plans come from the municipal source outlines, reviewed against Lantmäteriet's native 16 cm orthophoto captured 2025-06-14. The source service does not specify whether every outline follows ground-level walls or roof edges.
- Eight coherent 2021 laser planes support the main clubhouse roofs; ten further planes support B02, B04, B05 and B06. Two additional fits close the northwest annex and central junction. The source returns retain LAS class 1, unclassified. They were interpreted as roof planes only after comparison with orthophotos and photographs. They are not a surveyed as-built reconstruction.
- The main wings, taller crossing gable, two terrace dormers, plaster/trim, tile roofs, glazing, terrace and canopies use the club's exterior photographs. Exact window spacing, opening dimensions, trim and terrace construction remain visual interpretations. Unmeasured auxiliary roof heights remain explicit estimates.
- The B07 narrow attached part is modelled as a practice deck/porch, not a second tall building. The range has an open front with structural posts and hitting bays.

Source links, acquisition dates and image interpretations are retained in [the reference package](../reference-2026-09-10/README.md). Detailed roof measurements, source support counts and uncertainties are in [roof-measurements.json](roof-measurements.json) and [roof-measurement-notes.md](roof-measurement-notes.md). [model-plan.json](model-plan.json) records every display asset's source references and exact older replacement rings.

[Roof reproduction notes](roof-reproduction.md) document the tracked fitting scripts, manual domain choices and closure stages. The accepted parameters and output hashes remain the authoritative reviewed inputs until the source interpretation is deliberately revised.

The new 2026 Halfway House has design drawings but no confirmed mapped as-built position. Its [separate Blender design study](unplaced-design/Halfway-design-unplaced.blend) uses the labelled 7.2 × 6.4 m plan with estimated elevations, and is excluded from the installed campus assets. The small freestanding terrace pavilion also lacks a confidently identified source outline; neither is silently assigned to a nearby unrelated building.

## Runtime safeguards and review

The original course building records remain available for GIS, vegetation exclusions and `buildingGeometry=source`. Before replacing a building, the renderer checks the asset's course frame, finite positions, triangle indices, declared source bounds, exact current replacement rings and terrain contact. A changed/missing source, incompatible terrain or unavailable optional asset chunk falls back to the existing building rendering. Each asset is emitted once even when it replaces multiple records.

Roof and facade heights stay fixed in RH2000. Only foundation skirts sample runtime terrain at intervals of at most 1 m. Terrain is not used to bend roofs or move independent vertices of the architecture.

[model-build-report.json](model-build-report.json) records export hashes, triangle counts, Blender version and preservation of the live user's scene/file. [runtime-validation.json](runtime-validation.json) records the independent built-app checks and screenshots for both course slugs, terrain modes, source view and a failed optional mesh download. Raw screenshots and review terrain remain in the ignored cache.

Final verification passed: 24 focused/regression tests, production/PWA build, and all seven browser scenarios, including hardware WebGPU. The 60 roof-ray comparisons differed by at most 0.089 m from exported vertices; the debug picker itself rounds hits to 0.1 m. This is a runtime coordinate check, not a claim of centimetre-level source accuracy. Every served vertex, index, material, foundation and replacement record matched the final export; all 444 source building records remained unchanged. The native DTM review renders were also inspected from six views.

## Rebuild

From the repository root in PowerShell, with the existing Blender MCP running on 9876:

```powershell
$upsalaPython = 'upsalabuild/cache/review-venv/Scripts/python.exe'
& $upsalaPython upsalabuild/facilities/prepare_model_plan.py
# Re-run the roof evidence/facet scripts only when their source interpretation changes.
& $upsalaPython upsalabuild/facilities/prepare_preview_terrain.py
& $upsalaPython upsalabuild/facilities/run_model_builder.py
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background upsalabuild/facilities/models-2026-09-10/upsala-facilities.blend --threads 4 --python upsalabuild/facilities/export_and_review_models.py
```

The MCP step creates a separate scene and writes only its asset library. The independent background process converts that library to a directly openable `.blend`, exports GLB and renders the review views. It does not save over the file currently open in the user's Blender window.

## Driving range status

The owner's follow-up request to model and align the driving range was cut off
before it started; [range-alignment-2026-09-10.md](../range-alignment-2026-09-10.md)
records what is already measured, the one real misalignment (the OSM field
polygon cuts through the tee line) and the model-rebuild order that fixes it.
