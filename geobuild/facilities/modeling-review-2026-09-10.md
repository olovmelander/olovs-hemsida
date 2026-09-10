# Veckefjärden facility models — 2026-09-10

The clubhouse and surrounding facilities have now been modeled through the local
Blender MCP bridge. The model uses the reviewed 2024 roof and surface outlines,
the collected architectural photographs, and the published RH2000 terrain.

Open the [render gallery](../cache/facilities-model-2026-09-10/index.html),
[Blender workspace](../cache/facilities-model-2026-09-10/veckefjarden-facilities-workspace.blend),
[complete facility GLB](../cache/facilities-model-2026-09-10/veckefjarden-facilities.glb), or
[clubhouse GLB](../cache/facilities-model-2026-09-10/veckefjarden-clubhouse.glb).
In the running Blender, choose **Veckefjarden | Facility architecture 2026-09-10 v2**.
The earlier reference and first-pass scenes are retained separately.

## What is modeled

| Source features | Model |
|---|---|
| R01, R02, S01 | Clubhouse main bar, intersecting roof sections, annexes, east entrance porch, south balcony/entry, timber cladding, white trim, arched window heads, round entrance window, exposed downhill basement, terrace, dining paving, furniture and stairs |
| R03–R05 | Low accommodation buildings with roof seams, vents, gable infill, cladding, doors/windows, deck, awning and representative furniture |
| R06, R07, S02 | Unidentified translucent structure, polygonal gazebo, pool surround and partly retracted arched cover |
| R08, S03 | Adjacent roofed building and blue padel court with glass/mesh enclosure, net and lights |
| R09, S08 | Range shelter, curved apron, 25 interpreted mat positions, 22 interpreted pole positions and plain flags |
| R10–R12 | Western buildings with neutral estimated facade detail and reviewed roof plans |
| S04–S07 | Three parking surfaces and entrance island; surfaces follow interior terrain as well as perimeter heights |

There are **20 source-feature groups**, represented by 2,083 editable mesh objects.
The clubhouse has 44 modeled windows, four doors and six roof stacks. Small trim,
roof seams and furniture remain separate for editing. These counts describe the
reconstruction, not an architectural or facility survey. The GLBs retain this
editable hierarchy. The application uses a separate runtime export with 89
material meshes, retaining all 44,422 triangles. See the
[runtime integration review](runtime-integration-2026-09-10.md).

The Blender scene includes terrain and existing mapped access routes as context.
Road/path widths are estimates. Context terrain and access routes, lighting and
cameras are excluded from the facility GLBs. Northern neighbouring properties
N01–N05 are not included as golf facilities. Unidentified structures retain their
uncertain function; no commercial use is assigned merely from their location.

## Geometry and remaining uncertainty

Plan positions use [inventory.json](inventory.json). The main clubhouse roof bar
is approximately 35.26 × 10.90 m, fitted independently of the crosswing and annexes.
Wall insets, roof plane decomposition, window rhythm and hidden facades are modeling
interpretations. The east entrance porch and small south entry annex are estimated
from photographs where the orthophoto does not resolve their outlines.

Two full main storeys and the exposed downhill basement follow the photographs.
The main eave is estimated at 7.25 m above the entrance floor and the ridge at
10.10 m; the module records an interpretation uncertainty of 1.5 m. Hotel eaves
and ridge rise are estimated at 2.95 m and 2.35 m above their building bases.
Pool-cover configuration, furnishings, fence heights and covered-bay details are
also estimates. **No building height has been measured from survey or building
laser returns.** The DTM supplies ground elevations only.

The 2024 roof plan controls where it differs from older exterior photographs.
The west annex lower facade uses pale-yellow cladding following the exterior
review. Roof heights and obscured wall junctions in that extension remain uncertain.
No downloaded photograph is embedded as a model texture.

## Coordinate contract

Blender uses metres with **X east, Y grid north, Z up** and origin
**E 684390, N 7023040, H 30.673 m RH2000**. The 2 m modeling terrain is bilinearly
sampled from nine checksum-verified published 1 m terrain tiles. Terrain provenance,
feature ground samples and the extraction grid are recorded in
[model-ground.json](model-ground.json).

The GLB export uses **X east, Y up, Z south**. Its scene extras explicitly carry
that axis contract and the EPSG:3006/RH2000 origin. Thus:

```text
Easting  = 684390 + glTF.x
Northing = 7023040 - glTF.z
RH2000 H = 30.673 + glTF.y
```

For the legacy course frame, convert E/N through the full inverse projection
documented in the [reference notes](README.md). Do not use a simple translation
or add the legacy height-datum offset to a scene already using canonical RH2000.
Both Veckefjarden course views now load the optimized assets, replacing ten
matching source-building placeholders and three parking surfaces. The runtime
applies the existing height-datum bridge exactly once. Only six ground paving
meshes receive additional fitting to the visible terrain; architecture retains
its authored heights. See the runtime review for the conversion and validation.

## Validation and reproduction

The live MCP build preserves existing scenes and the current file. Background
Blender reopens only the generated architecture, checks finite geometry, material
and source-ID coverage, renders six views, exports the GLBs and saves a normal
workspace copy. An independent Python reader then inspects GLB buffers, indices,
axis metadata and facility bounds against the reopened Blender geometry.

The checked exports contain 44,422 triangles for all facilities and 16,299 for
the clubhouse. Their bounds match the Blender audit exactly. The source ledger
and artifact hashes are in [model-build-report.json](model-build-report.json),
[model-audit.json](model-audit.json) and [model-export-audit.json](model-export-audit.json).
These arithmetic checks establish correct transport of the authored coordinates;
they do not establish absolute survey accuracy.

```powershell
node geobuild/facilities/prepare-model-ground.mjs
$py = 'geobuild/cache/ortho-venv/Scripts/python.exe'
& $py geobuild/facilities/blender_mcp.py --script geobuild/facilities/build_facility_models.py --timeout 180
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background --factory-startup geobuild/cache/facilities-model-2026-09-10/veckefjarden-facilities-v2.blend --python geobuild/facilities/render-export-models.py
& $py geobuild/facilities/audit-model-exports.py
```

The builder refuses an existing scene/output; use a new version when deliberately
rebuilding an already loaded asset. Only the generated cache outputs are written
by the background render/export step. The normal workspace opens on the clubhouse
camera and retains separately editable components and six review cameras.
