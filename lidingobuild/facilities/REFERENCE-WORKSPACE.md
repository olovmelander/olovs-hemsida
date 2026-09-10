# Lidingö Golfklubb: Blender facility reference package

This records the reference-gathering stage. The subsequent authored model and
application integration are documented in [README.md](README.md).

Prepared 10 September 2026. Open the local
[Blender workspace](../cache/facilities-reference-2026-09-10/lidingo-facilities.blend)
to begin detailed facility modelling. It contains the existing app buildings as
editable parts, dated measured geometry, georeferenced aerial plans and reviewed
exterior photographs. It does not represent a completed architectural remodel.

## What is ready

- [Orthophoto reference](orthophoto-reference.md): native 16 cm Lantmäteriet
  imagery captured 31 May 2025, an overview and five detail areas, plus matching
  2019 municipal comparisons. PNG, GeoTIFF, worldfiles, projection files, bounds,
  timestamps and checksums are retained.
- [Photographic reference](web-reference.md): actual oblique clubhouse aerials,
  restaurant facades, balcony/terrace, pavilion, range structures and entrance
  details. The curated selection is packed into Blender; the larger local photo
  archive and contact sheets remain available alongside it.
- [Facility inventory](facility-inventory.md): building and facility identities,
  evidence dates, geometry availability and remaining gaps.
- Five existing app building models and the courtyard terrace, split into 76
  editable meshes by architectural part and material. These retain the current
  display estimates, including details that still need correction against photos.
- The original five 2021 roof meshes (7,069 triangles) in a separate hidden
  collection, with unsupported regions retained in object metadata.
- Six primary building footprints, 14 mapped facility surfaces including the
  courtyard's interior ring, and 14 additional OSM building/parking/fence/access
  references. The additional building is an outline, with unknown use/height.
- Published 1 m terrain sampled at 2 m for the workspace, with exact source-grid
  heights used for the architecture and boundary overlays.

## Using the Blender file

Choose a scene using Blender's scene selector:

1. **Lidingö | Facilities model reference** opens on the clubhouse courtyard.
   Individual building parts are editable. Other cameras cover the range buildings
   and the whole facility area. Toggle the measured-roof collection to compare
   source geometry with the authored display model.
2. **Lidingö | Orthophoto plan** shows the 2025 aerial and mapped outlines. The
   collection also contains detail crops and historical comparator images,
   initially hidden. Enable the relevant image and hide overlapping planes to
   compare. The plan lies on a flat reference datum, not the terrain surface.
3. **Lidingö | Photo references** contains the selected exterior images. Object
   custom properties carry source URLs, dates, rights, observations and limitations.

The packed text **LID | START HERE - evidence and modelling brief** repeats the
key handoff inside Blender. Original source imagery and the packed `.blend` stay
in the ignored local cache; public access to a photograph is not a texture licence.

Coordinate frame: one Blender unit is one metre. `X=E−677700.5`,
`Y=N−6586399.5`, `Z=RH2000−25`, with horizontal EPSG:3006 and vertical RH2000.
After Blender's normal glTF axis conversion, add 25 metres to app vertical Y.
The terrain fixture already supplies RH2000 heights; do not apply a second
−0.05 m terrain-bridge shift.

## Corrections and missing evidence

The photo review finds red timber range structures where the current app uses
pale generic walls. Establish each photo-to-footprint association before
remodelling those facades. The clubhouse's roof steps, recessed glazing, blue
awnings, balcony supports and multi-level timber terrace have stronger exterior
coverage and are the best starting point for detailed modelling.

The current club practice page describes covered bays at both ends of the range,
ball machines and multiple practice areas. Its total bay count and stated north/
south counts differ, so a precise bay count should come from photo/plan review.
The 2025 orthophoto predates the 2026 net work described in the club maintenance
report. Pole heights, hidden elevations, some smaller structures and completed
2026 changes remain unresolved. Conceptual drawings stay labelled as proposals.
[Club practice areas](https://www.lidingogk.se/trana/rangen-ovningsomraden/),
[2026 maintenance report](https://www.lidingogk.se/banan/banchefen-informerar-2026/).

No app asset was replaced by this reference-gathering task. The imported display
geometry is a baseline, and a detailed replacement needs to be authored and
reviewed before a production GLB is exported.

## Reproduction and validation

Run from the repository root. Python dependencies are available in the existing
`upsalabuild/cache/review-venv/Scripts/python.exe` environment.

```powershell
node lidingobuild/facilities/export-model-reference.mjs
& upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/facilities/prepare-workspace-spec.py
& upsalabuild/cache/review-venv/Scripts/python.exe upsalabuild/facilities/blender_mcp_client.py --script lidingobuild/cache/facilities-reference-2026-09-10/run-blender.py --timeout 180
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background lidingobuild/cache/facilities-reference-2026-09-10/lidingo-facilities.library.blend --python lidingobuild/facilities/package-blender-workspace.py
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background lidingobuild/cache/facilities-reference-2026-09-10/lidingo-facilities.blend --python lidingobuild/facilities/audit-blender-workspace.py
```

The builder refuses to overwrite an existing workspace or scene; choose a new
name/path for a new revision. The live Blender's existing scenes, active scene,
selection and file are checked for preservation. Packaging and renders happen in
a separate background Blender process.

See [geometry validation](model-reference-validation.json),
[workspace validation](blender-workspace-validation.json) and
[independent saved-file audit](blender-independent-audit.json). The workspace
spec pins every packed image and geometry input by SHA-256.
