# Ängsö facility implementation

The authored environment replaces the six matching source building blocks and
the two coarse parking surfaces after the complete Blender asset loads. The
existing range shelter and mat strip replace the procedural range. Remaining
course and neighbouring buildings keep their source geometry.

## Delivered geometry

| Group | Modelled features |
| --- | --- |
| B01 | Restaurant main pitched roof, dark northwest slope, terracotta courtyard slope, ten dormers, white entrance balcony/porch, glazed rear extension and service return |
| B03 | Detached red reception wing, pitched tiled roof, white openings and chimneys |
| B04/B04a | Annex with white lower facade and doors, red upper timber, dormers, rooflights, south balcony and external stair; smaller north extension |
| B05–B08 | Two courtyard canopies, open cart shelter with carts, kiosk/toilet building |
| B09–B11 | South shed, long eastern outbuilding and small utility roof; unconfirmed uses are not assigned |
| B12/S04 | Existing approximately 21 m range shelter, provisional six shelter bays, 18 outdoor mats and low dividers |
| B13/S07 | Northern roof and separate terrain-following yard; neutral unseen elevations, ownership/use unconfirmed |
| S01/S02 | Traced parking, 14 camper pads/insets, seven documented charging posts with estimated positions, continuous courtyard and practice paths, approximate benches/bins |
| S05/S06 | Kiosk timber deck and restaurant terrace with white railings and representative furniture |

This is a reconstruction from the dated evidence, not a surveyed as-built model.
Wall offsets, eaves, opening spacing, concealed elevations and small fixtures
include estimates. Proposed range/bag-store construction is excluded. Toilets
documented at holes 5 and 15 lack confirmed footprints/exterior evidence and are
not assigned invented positions. The putting green retains the course terrain.

## Decisions from visual review

- B02 remains in the original reference trace inventory, but is omitted from
  architecture. Authentic rear and aerial photographs show the glazed extension
  without a separate long canopy; the dark band is consistent with roof shadow.
  Its sparse laser support (about 2% within the candidate envelope) does not
  establish a separate structure.
- Courtyard and annex dormer tops use terracotta; restaurant rear dormer tops
  follow the dark northwest roofing. Dormer cheeks retain dark cladding.
- Paths use continuous joined outlines to close wedges at bends. Ground overlays
  follow the original 1 m DTM. The northern yard is its own site node so that its
  geometry and vegetation treatment remain distinct from the roof footprint.
- Twenty-eight exact surface rings keep generated rocks, grass and tree trunks
  out of paving, decks and range mats. Roof checks account for tree crown width
  and height. Surface normals are smoothed to avoid visible triangle bands in
  the parking areas.

## Coordinates and integration

Editable Blender geometry uses metres in EPSG:3006 relative to E 605530,
N 6605140, with Z equal to RH2000 minus 8 m. Export transforms every vertex
through PROJ to WGS84, then applies the app's original east/south coordinate
equations. Runtime Y is absolute RH2000, with Ängsö's zero vertical datum offset.

The GLB contains static meshes and procedural materials only. Components remain
editable in the source file and are batched by facility/material for the app.
Neither web reference photographs nor orthophotos are runtime textures.

The loader verifies the asset checksum, coordinate frame, facility inventory,
original building IDs, source parking rings, finite geometry and placement. Only
a successful installation suppresses source objects and activates roof vegetation
exclusions. Failed or cancelled loads retain the original environment. Precise
ground rings handle site clutter separately; site bounding boxes never define
landscape clearing.

The public manifest uses network-first caching; the GLB filename contains its full
SHA-256 and can be cached immutably. The standard Ängsö view loads these models
automatically; no special query parameter is required.

## Rebuild

The live Blender MCP bridge must be running on port 9876. The builder creates a
new versioned scene/file and preserves the current file, scene, selection and
existing object transforms. Review/export reopens only that owned file in a
background Blender process.

```powershell
$facilityPython = 'geobuild/cache/ortho-venv/Scripts/python.exe'
& $facilityPython angsobuild/facilities/prepare-model-inputs.py
& $facilityPython angsobuild/facilities/blender_mcp_client.py --script angsobuild/facilities/build_facility_models.py --timeout 240
$facilityBuild = Get-Content angsobuild/facilities/model-build-report.json -Raw | ConvertFrom-Json
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background $facilityBuild.blendPath --python angsobuild/facilities/render-export-models.py
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background $facilityBuild.blendPath --python angsobuild/facilities/audit-model-file.py
node --test apps/golf/src/engine/scenery/angso-facilities.test.mjs
node tools/check-angso-facilities.mjs http://127.0.0.1:5173
npm --prefix apps/golf run build
```

The original DTM and reference caches must be present; their source hashes are
checked before model construction. Export verifies the saved source file and
builder inputs before writing its asset. To change geometry, edit the model
modules and rebuild a new revision. Existing versioned Blender files are kept.

## Review artifacts

- [Latest editable model and build receipt](model-build-report.json)
- [Independent saved Blender file audit](model-file-audit.json)
- [Export receipt and six Blender review cameras](model-export-validation.json)
- [Public manifest](../../apps/golf/public/models/angso/facilities-v1.json)
- [Browser acceptance report](../cache/facilities-model-2026-09-10/browser/report.json)
- [Browser courtyard](../cache/facilities-model-2026-09-10/browser/angso-courtyard.png)
- [Browser campus](../cache/facilities-model-2026-09-10/browser/angso-campus.png)
- [Browser range](../cache/facilities-model-2026-09-10/browser/angso-range.png)

The reviewed model is
[angso-facilities-v4.blend](../cache/facilities-model-2026-09-10/angso-facilities-v4.blend):
19 facility groups, 255 editable meshes and 51,807 authoring vertices. The public
GLB contains 84,653 triangles in 141 material batches and occupies 4,050,992 bytes.
Its SHA-256 is `03ec1d92965315bef789d2fab2a3ab33f7d8c4d48c4be2a81830139860cc1ce6`.

The independent Blender reopen and source hashes pass. All 15 Ängsö loader tests
pass; the complete related regression selection totals 65 passing tests across
seven files. `npm --prefix apps/golf run build` passes. Browser acceptance and
visual inspection use the real WebGPU renderer and are recorded in the linked
browser report, including forced-asset-failure source geometry restoration.
