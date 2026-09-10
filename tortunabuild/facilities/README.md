# Tortuna facilities modeled in Blender

This pass adds seven independently placed display models alongside the existing
clubhouse. [tortuna-facilities.blend](tortuna-facilities.blend) contains a separate,
editable metre-scale scene for each building and a geographic assembly scene.
It opens on the yellow entry outbuilding. The connected Blender MCP on port
9876 built the geometry; a separate Blender process saved the portable file and
rendered the review images.

| Existing source building | Model and preview | Appearance evidence |
|---|---|---|
| `way/1163533128` | [Yellow entry outbuilding](entry-outbuilding.png) | Yellow boards, white trim, two broad panel sections and a recessed southeast bay |
| `tortuna-range-shelter` | [Range-side hut](range-shelter.png) | Enclosed red hut, light mono-pitch roof and three white southwest panels; function unverified |
| `way/1163533113` | [Long northern barn](service-yard-long-barn.png) | Red walls/roof and small western facade openings |
| `way/1163533114` | [Small northern outbuilding](service-yard-small-outbuilding.png) | Measured gable; facade defaults pending photographs |
| `way/1163533115` | [Western northern barn](service-yard-west-barn.png) | Measured gable; facade defaults pending photographs |
| `way/1163533123` | [Barn west of the car park](carpark-west-barn.png) | Grey/brown roof, red wall sections and a large pale raised roof structure |
| `way/1163607303` | [Nearby house](nearby-house.png) | Measured T plan and intersecting roofs; facade defaults pending a confirmed photo |

The [reference review](reference-review.md) distinguishes observations from
estimates. [Geometry evidence](facility-geometry-evidence.json) records native
orthophoto, laser roof planes and ground heights. The source planes supply
RH2000 roof elevations, while wall insets, board spacing, trim, colours and
opening dimensions remain architectural estimates. The two small barn openings
are representative detail, not a surveyed window count. Unverified walls keep
neutral display colours and have no invented opening layouts. The house's lower
southwest canopy is unresolved and omitted; its corners are not filled as rooms.

The original course pack, footprints, measured roof meshes, terrain and existing
clubhouse asset remain unchanged. Each GLB is bound to its existing building ID
and exact source footprint hash. Normal rendering replaces that building's
source shell only after a verified load. `?buildingGeometry=source` shows the
retained source buildings. A failed asset load restores that building's source
geometry independently. Raw photographs and orthophotos remain in the ignored
cache; exported models contain geometry and materials without photo textures.

Rebuild with the existing Blender MCP running, from the Tortuna worktree:

```powershell
python tortunabuild/blender/mcp_client.py --exec tortunabuild/blender/build_facilities.py
& 'C:\Program Files\Blender Foundation\Blender 4.5\blender.exe' --background tortunabuild/facilities/tortuna-facilities.blend --python tortunabuild/blender/render_facilities.py
node tortunabuild/facilities/publish-models.mjs
node tortunabuild/check-facilities.mjs --base http://localhost:5174/
```

Review geometry and appearances before publishing a changed export. Exact
inputs and outputs are pinned in [published-models.json](published-models.json).
The browser harness independently decodes all eight authored models, compares
runtime positions and meshes, captures five facility views, checks source mode
and deliberately fails only the range-hut download. Software browser rendering
checks correctness; it does not establish native-device performance.

The [five-view browser report](browser/report.json) covers the initial complete
set. After widening the entry bay to match the photographed facade proportions,
the [final browser report](browser-final/report.json) rechecks all eight model
identities, positions and fallback modes, with front views of the
[entry building](browser-final/entry-building.png) and
[range hut](browser-final/range-shelter.png). The other six facility assets did
not change. [Validation](validation.json) pins the final assets, editable file
and review evidence.

Remaining nearby work includes the distinct small yellow hut without a source
building ID, the photographed grey-roofed neighbour `way/1163780657`, other
houses and unresolved facades. This is a seven-building refinement, not a claim
that all 309 mapped Tortuna buildings have finished architectural models.
