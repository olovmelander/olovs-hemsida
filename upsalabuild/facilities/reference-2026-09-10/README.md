# Upsala GK clubhouse and facilities: Blender reference package

Start with the [searchable reference gallery](index.html). The package combines
native Lantmäteriet orthophotos, municipal building outlines, real clubhouse
photographs, the 2026 service-house design drawings and original laser returns.
It supports architectural modelling in the course coordinate frame. The Blender
file is a reference scene; the detailed building models are still to be authored.

[Package validation](package-validation.json) passed: 68 hashed source files,
19 Blender outlines, 18 packed images, the laser samples and gallery links.

## What is ready

| Source | Coverage | Use in modelling |
| --- | --- | --- |
| June 14, 2025 orthophotos | Native 0.16 m campus and range images, plus wider overview; GeoTIFF, PNG and world files | Position, roof plan, surrounding paving, parking, paths, terrace and range arrangement |
| Municipal building geometry | 19 numbered parts B01–B19; eight have confirmed existing/measured provenance | Metre-scale plan references; the service does not establish whether every outline is a wall or roof edge |
| Real web photographs | Clubhouse elevations, roof overview, terrace, neighbouring buildings, range and interior context | Roof configuration, visible materials, doors, windows, dormers, porches and small structures |
| 2026 service-house references | Dimensioned 7.2 × 6.4 m plan, elevations, design visualization and opening photographs | Design intent; confirm the constructed exterior before committing its roof and exact placement |
| March 2021 laser campaign | 99,607 returns over a 250 × 250 m central window, verified SWEREF 99 TM / RH 2000 | Candidate roof surfaces and ground context; class 1 is unclassified, and no class 6 building returns occur |
| Existing facility geometry | Parking and practice surfaces, with retained source provenance | Surrounding facilities and circulation; see the context files |

The curated collection contains **15 image references**: eight exterior/aerial
photographs, three interior context photographs, three drawings and one design
visualization. Publication/upload dates are recorded separately; exact photo
capture dates remain unknown. The Blender scene contains **60 additional parking,
practice and fixture references**, including 30 independently traced range mats.
The [supplemental inventory](supplemental-context.json) also retains nearby tree
and distant fixture records without importing them all into the facility scene.

Read the [orthophoto notes](orthophoto-notes.md),
[photo observations](web-photo-notes.md),
[building inventory](building-reference-inventory.json), and
[laser evidence](lidar-roof-evidence.json) for source-specific limitations.
The source images and point cloud are stored in the ignored local cache. Each
manifest records their paths and hashes. They are local modelling references;
web photographs are not automatically licensed game textures.

## Blender scene

The prepared local file is
[upsala-facility-references.blend](../../cache/facilities-2026-09-10/upsala-facility-references.blend).
Its scene is named `Upsala GK | Facility references 2026-09-10`.
It contains native image planes, numbered source outlines, packed photo/drawing
boards, an orthographic review camera and a separate laser reference collection.

The orthophotos use a flat mapping datum at Z=0. This is not terrain or a building
floor. The laser collection is hidden initially; enable it in the Outliner for
height study. Ground, unclassified returns and noise are separate objects. No
roof surfaces have been fabricated from those points. Photo boards are excluded
from map rendering and carry their evidence type and source URL.

The scene uses metres around the current clubhouse centroid:

- Local course anchor: `[17.7829326741, -279.1431474155]` in X/Z.
- EPSG:3006 anchor: `[639837.5643452, 6636394.1873265]`.
- Blender X = course X − anchor X; Blender Y = anchor Z − course Z.
- Laser Blender Z = RH2000 height − 34.968 m. The 34.968 m value is a rounded
  terrain datum at the anchor, not a surveyed finished floor.

Use the exact EPSG:3006-to-local transform in the manifest for measurements.
The four-corner orthophoto mesh is a display approximation. Runtime Y uses
absolute RH2000 heights for Uppsala; restore the anchor when placing exported
geometry. The [integration report](runtime-integration.md) defines the complete
Blender/glTF/course transform and the shared Stora/Mellan handling.

The Blender MCP connection was verified at `127.0.0.1:9876`, Blender 4.5.9 LTS.
Scene creation uses data APIs and writes a separate file; it retains existing
Blender scenes and their active window. Source and scene validation are recorded
in [blender-scene-validation.json](blender-scene-validation.json).
The saved file was reopened and rendered in a separate Blender process;
[render validation](blender-render-validation.json) checks all 19 outlines,
18 packed images and 99,607 laser points. The file opens on the reference scene.
See the [map preview](../../cache/facilities-2026-09-10/blender-map-preview.png).

## Architectural decisions supported by the references

The clubhouse needs several connected roof masses, a taller central gable,
small dormers, lower projecting porch roofs and the west terrace/enclosure.
The photographs support light cream walls, dark grey trim and orange tiled
roofs. They also show a small terrace pavilion and red neighbouring buildings.
These features should be modelled as distinct components anchored to reviewed
plan geometry. Window and door placement should follow the photographed face;
unseen faces remain unresolved.

For the 2026 Halfway House, the club records demolition of the old service house
in March and opening of the new building on May 14. The 2025 orthophoto and 2021
laser cloud predate that replacement. Its design visualization and elevations
disagree about the roof form, so the visualization cannot settle the constructed
roof. The small pavilion visible on the clubhouse terrace is an independent
reference: it also appears in an image uploaded in 2025 and must not be conflated
with the 2026 replacement.

The main gaps before a defensible detailed reconstruction are exact eaves/ridges
and floor levels, the clubhouse's less-photographed parking-side elevations,
the service house's constructed exterior and position, and exterior/function
identification for several small buildings. The laser window excludes the range
shelter and two eastern source parts and only partly covers B17. A return-height
distribution is not a measured wall height.

## Modelling and integration order

1. Review B01/B02 against the native roof image and the actual drone/ground
   photographs. Resolve wall footprint versus overhang before tracing roof parts.
2. Segment candidate laser returns inside those parts and cross-check their roof
   planes against photographs. Keep the 2021/2025/2026 source dates explicit.
3. Author the main clubhouse roof masses, porch/terrace components and visible
   facade details. Use provisional parameters for unsupported dimensions.
4. Model the range shelter, nearby red buildings and service-yard structures from
   their own numbered references. Reconcile overlapping municipal parts before
   creating solids. Confirm the 2026 service house separately.
5. Export a clean GLB containing authored geometry only. Remove the replaced
   procedural buildings by stable source IDs and preserve fallback loading.
   Share the same asset between Stora and Mellan; update the separate standalone
   renderer when adopting the model. The current renderers use different generic
   clubhouse assumptions, as documented in the integration report.

## Reproduce the reference scene

From the repository root, with the acquired cache present and Blender MCP running:

```powershell
$py = 'upsalabuild/cache/review-venv/Scripts/python.exe'
& $py upsalabuild/facilities/prepare_reference_scene.py
& $py upsalabuild/facilities/build_reference_gallery.py upsalabuild/cache/facilities-2026-09-10/blender-scene-spec.json
& $py upsalabuild/facilities/blender_mcp_client.py --script upsalabuild/cache/facilities-2026-09-10/create-reference-scene.py
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background upsalabuild/cache/facilities-2026-09-10/upsala-facility-references.blend --python upsalabuild/facilities/verify_and_render_scene.py -- upsalabuild/cache/facilities-2026-09-10/blender-scene-spec.json
```

The scene builder refuses to overwrite an existing scene or file. To preserve an
earlier modelling session, prepare a new version with `--suffix=-v2`, then pass
the matching `blender-scene-spec-v2.json` and `create-reference-scene-v2.py` paths.
Acquisition and source summarization scripts live beside the manifests. They
use the existing local authentication setup without putting credentials in the
reference files.
