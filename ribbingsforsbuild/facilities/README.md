# Ribbingsfors facilities: Blender models and application integration

Ribbingsfors was the one course with no authored architecture: a generic
extruded clubhouse in a photo-derived palette, six exaggerated satellite
rectangles for the estate, three sheds drawn over an open arena, and a
"clubhouse annex" that the native orthophoto shows to be the clubhouse's own
cast shadow. The Codex pass of 2026-09-10 acquired the 2024-05-17 Lantmäteriet
0.16 m orthophoto and the club's 2024-07-12 photographs, reviewed 45 features
on them ([reference/reviewed-ortho-traces.json](reference/reviewed-ortho-traces.json),
[reference/independent-visual-review.md](reference/independent-visual-review.md)),
and wrote the modelling scripts; the usage limit cut it off before Blender ran.
This pass runs them, exports the runtime asset and wires it into the app.

## What the application now loads

[facilities-v1.json](../../apps/golf/public/models/ribbingsfors/facilities-v1.json)
is the mutable receipt; it names a content-addressed GLB
(`facilities-<sha256>.glb`, 1.47 MB, 44 facilities, 1,064 meshes, 12,408
triangles) that the loader verifies by byte count and SHA-256 before anything
is installed. The pack is authored directly in the EPSG:3006 grid frame, so the
Blender scene's metres ARE the course's local metres and the runtime applies a
height bridge of exactly zero on the 1 m ground.

| Group | Modelled features | Evidence |
| --- | --- | --- |
| `clubhouse-main` | Pale yellow board-and-batten walls, weathered clay gable roof with tile courses, chimney, photographed south and gable openings, wraparound timber deck with X-braced railings, stair, awnings, illustrative furniture | orthophoto roof rectangle; club-127/128/136 photographs; heights are estimates |
| `range-shelter`, `range-mat-01..09`, `range-divider-1..8`, `range-picnic-table-estimate` | Open red-timber shelter on white posts, nine mats on hitting slabs between low masonry dividers with timber copings, a picnic table | `range-mats-detail` native panel; `range-bays-review.jpg` |
| `manor-*` (10), `lakeside-boathouse` | Yellow-walled manor massing with hipped main roof, wings, porches, garden huts and outbuildings that the retained model never had | `manor-close` panel; club/estate aerials for colour |
| `estate-*` (8) | Red farm roofs with ochre lower walls, replacing the satellite rectangles | `estate-close`, `estate-north-close` panels |
| `maintenance-*` (5) | The narrow northern shelter, the long eastern metal-roof shed, the southern sheds | `maintenance-close` panel |

Every roof outside the clubhouse and shelter is orthophoto roof massing with
unresolved facades, and says so in its `modelDetail`. No photographic pixels
are exported: materials are procedural colours.

## Source ownership

An authored roof REPLACES the retained source building whose centroid it
contains (five: the clubhouse, three estate barns, one yard shed); a retained
building an authored roof merely overlaps is SUPERSEDED and suppressed with the
review's reason in `suppressedSourceBuildingIds` (the shadow annex, two farm
rectangles, two yard boxes). Thirty-four retained buildings, all of them
Skagersvik houses, are untouched. Only new ROOFS enter the vegetation
exclusion: the mats, dividers and picnic table must never clear a woodland.
A failed or cancelled load leaves every retained building standing, and the
palette in `apps/golf/src/engine/scenery/ribbingsfors.js` remains the
clubhouse's fallback appearance.

## Reproduction

```powershell
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background --python ribbingsforsbuild/facilities/build_blender_scene.py
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background ribbingsforsbuild/cache/facilities-model-2026-09-10/ribbingsfors-facilities.blend --python ribbingsforsbuild/facilities/export_runtime_model.py
BANVY_GPU=1 node ribbingsforsbuild/facilities/check-facility-runtime.mjs http://127.0.0.1:5173/            # authored view, 15 gates
BANVY_GPU=1 node ribbingsforsbuild/facilities/check-facility-runtime.mjs http://127.0.0.1:5173/ --fallback # blocked GLB
npx vitest run apps/golf/src/engine/scenery/ribbingsfors-facilities.test.mjs
```

`build_blender_scene.py` refuses to overwrite an existing document; the
generated `.blend` (230 MB, with the packed orthophoto panels, photographs and
a 1 m terrain context) stays in the ignored cache because it carries other
people's photographs. [blender-build-report.json](blender-build-report.json)
and [runtime-export-validation.json](runtime-export-validation.json) pin the
inputs, the document hash and the exported asset. Review renders from the
generated cameras are written beside the document.

Verified on the workstation GPU against the dev server: the authored view
passes all 15 gates (asset checksum, one node per facility, replaced and
suppressed buildings absent from the generic batch, zero vertical bridge, every
anchor within 0.6 m of the visible ground, no tree trunk inside a new roof,
no browser errors), and the blocked-GLB variant restores every retained
building.

## Limits

Building heights, eaves, wall insets, terrace dimensions and all facades not
photographed are estimates. The lakeside pier is traced but not modelled. The
range field polygon, `rangeTee` and `rangeFacilities` in the course model are
unchanged, so the engine's target flags still stand at the end of the field
nearest the clubhouse.
