# Puttom facilities in Blender and the app

The Puttom environment now loads [facilities-v1.glb](../../../apps/golf/public/models/puttom/facilities-v1.glb)
through its [validated manifest](../../../apps/golf/public/models/puttom/facilities-v1.json).
Open the editable [Blender document](../../cache/facilities-model-2026-09-10/puttom-facilities-v1.blend)
or the [clubhouse render](../../cache/facilities-model-2026-09-10/clubhouse.png).
The authored scene was generated through the live Blender bridge on port 9876;
the existing interactive Blender scene, objects and selection were preserved.

## Included

25 facility groups contain 25 architectural volumes in 17 building assemblies,
plus eight groups of site equipment. All 17 inherited campus building IDs are
accounted for exactly once. The architecture includes the clubhouse's glazed
gable, side glazing, unequal window rows, entrance canopies, terrace and connected
lower wings; the joined range building; Härbre with logs, clock and side shelter;
maintenance buildings; and the observed nearby cabins, houses, sheds and pavilion.

The range has 17 orthophoto-positioned mats and trays, paving, rope posts, ball
dispenser and nets. Courtyard flags and fences are included. Existing surrounding
terrain, access, parking and practice surfaces continue to provide the site context.

The asset contains 34,445 triangles in 150 material meshes and is 2.34 MB. It uses
procedural colours and geometry. Downloaded photographs are retained as local
references and are not shipped as textures.

## Placement and integration

Authoring coordinates are EPSG:3006 east/north and RH2000 height, translated by
E697365, N7025190, H44 inside Blender. The exporter transforms every vertex through
pyproj into Puttom's existing local east/up/south frame and transforms normals
with the local projection Jacobian. In the current terrain mode, the app applies
the existing height datum offset once. In legacy terrain mode, each assembly is
anchored as a rigid object at its declared ground point. Paving samples the active
terrain at its subdivided vertices with a small display clearance. Individual
range mats, trays and rope posts follow their own ground anchors so they remain
usable above both terrain representations. Building source heights are preserved.

The loader verifies hash, byte count, source ownership, geometry bounds, coordinate
frame and budgets before installing any replacement. Failure preserves the generic
buildings and range. Successful installation suppresses the replaced generic
building details and old range equipment, and registers building footprints before
vegetation and parking placement. Wide site equipment groups do not exclude trees.

## Evidence and limits

See [geometry notes](geometry-notes.md), [model plan](model-plan.json),
[site plan](site-plan.json) and the [reference catalogue](../README.md).
The reconstruction combines 2023 laser, 2024 orthophoto and dated photographs.
Roof-supported heights and positions are distinguished from estimates for facades,
hidden sections and small details. The clubhouse roof is placed using laser support
approximately four metres west of its apparent aerial roof centre; source imagery
was not shifted. The range roof uses a clipped union to remove internal roof and
wall intersections, resolving the inner valley and lower outside hip separately.

The two unmatched inherited sheds remain approximate. Nearby houses have
descriptive labels without asserted club ownership. The pump house and junior
cottage remain unlocated references and have not been assigned invented locations.
This is an interpreted environment model, not a measured architectural survey.
Official orthophoto and laser attribution: © Lantmäteriet, processed information,
CC BY 4.0. Original evidence and editable Blender files are in the ignored cache;
the scripts, plans, receipts and public runtime asset are versionable repository files.

## Validation and reproduction

[Build receipt](blender-model-build.json), [authoring audit](authoring-audit.json), [export receipt](export-receipt.json),
[real loader audit](runtime-asset-audit.json) and [browser audit](browser-audit.json)
record the exact artifact and checks. The loader audit verifies source coverage,
world bounds, the height bridge, normalized normals and ownership-safe disposal.
The final suite passes 40 facility tests across four courses, five exporter tests,
the production build and the generated service-worker/CDN cache checks.
The browser harness checks both default and legacy terrain and captures the
clubhouse, range, maintenance area and campus.

Run from the repository root. The builder and packager refuse to overwrite an
existing authored scene/document; use a new output for a new authoring iteration
and preserve any manual edits. Exporting an existing document is read-only in Blender.

```powershell
$puttomPython = 'geobuild/cache/ortho-venv/Scripts/python.exe'
$puttomBlender = 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe'
& $puttomPython puttombuild/facilities/prepare-model-plan.py
& $puttomPython puttombuild/facilities/models-2026-09-10/prepare-site-plan.py
& $puttomPython puttombuild/facilities/models-2026-09-10/prepare-preview-ground.py
& $puttomPython puttombuild/facilities/blender_mcp_client.py --script puttombuild/facilities/models-2026-09-10/build-models.py
& $puttomBlender --background puttombuild/cache/facilities-model-2026-09-10/puttom-facilities-v1.library.blend --python puttombuild/facilities/models-2026-09-10/package-models.py
& $puttomBlender --background puttombuild/cache/facilities-model-2026-09-10/puttom-facilities-v1.blend --python puttombuild/facilities/models-2026-09-10/export-authoring.py
& $puttomPython puttombuild/facilities/models-2026-09-10/emit-runtime-assets.py
& $puttomPython puttombuild/facilities/models-2026-09-10/test-export.py
& $puttomBlender --background puttombuild/cache/facilities-model-2026-09-10/puttom-facilities-v1.blend --python puttombuild/facilities/models-2026-09-10/audit-authoring.py
npx vitest run apps/golf/src/engine/scenery/puttom-facilities.test.mjs
node puttombuild/facilities/models-2026-09-10/check-runtime-asset.mjs
$env:BANVY_GPU = '1'
node puttombuild/facilities/models-2026-09-10/check-browser.mjs http://localhost:5173
npm --prefix apps/golf run build
node puttombuild/facilities/models-2026-09-10/check-serving.mjs
```
