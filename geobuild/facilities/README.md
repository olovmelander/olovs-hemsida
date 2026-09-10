# Veckefjärden facility modeling references — 2026-09-10

**Models are built and integrated:** see the [modeling review and Blender/GLB files](modeling-review-2026-09-10.md)
and [runtime integration review](runtime-integration-2026-09-10.md).
The reference pack below remains the evidence behind those models.

This pack prepares the clubhouse and surrounding facilities for reconstruction in
Blender. It contains measured image outlines, native Lantmäteriet orthophotos,
reviewed exterior photographs, provenance and a separate Blender reference scene.
It does not yet establish building heights or deliver finished replacement assets.

The pack contains six georeferenced panels, 25 reviewed image-edge outlines,
16 existing-model polygons for comparison, and 11 curated photographic references.

Open the [visual reference pack](../cache/facilities-2026-09-10/index.html),
[photo contact sheet](../cache/facilities-2026-09-10/reference-contact-sheet.jpg), or
[Blender reference file](../cache/facilities-2026-09-10/veckefjarden-facility-references.blend).
The [Blender campus preview](../cache/facilities-2026-09-10/blender-campus-preview.png)
shows the saved scene's orthophoto and geometry together.
The raw imagery and packed `.blend` remain in the local ignored cache. The
instructions, coordinates and source records in this directory are reproducible.

## Evidence and coverage

| Area | Evidence available | What still needs resolving |
|---|---|---|
| Clubhouse / former school | Main roof and annex outlines; both long elevations; gables; entrance porch; course-facing terrace; roof stacks; timber and joinery | Wall-base alignment, floor/eaves/ridge heights, exact porch and annex structure |
| Hotel | Linked low buildings, courtyard, roof plan and elevated exterior photos | Room/function assignment to each block, hidden elevations, heights |
| Pool and garden | Pool/deck plan, cover, gazebo and exterior photos | Cover position varies with use; fine dimensions and material details |
| Padel and adjacent building | Court enclosure and previously missing adjacent roof; official padel photos | Adjacent building function and unseen facades |
| Western buildings | Separate roof outlines and contextual photos | Ownership/use, obscured elevations, dimensions at wall bases |
| Range and practice area | Roof at tee end, curved apron, practice surfaces, course/range photos | Individual bay dimensions, full roof support structure, net heights and fixture positions |
| Parking and access | Native imagery and existing model polygons for comparison | Kerbs, ramps, signs, drainage and exact surface boundaries under trees |
| Northern neighbours | Dated imagery and separate context panel | Golf ownership/use is unverified; do not label these as maintenance facilities |

The [club's history](https://veckefjarden.com/om-oss/) identifies the old school as
the clubhouse. The [hotel's own description](https://hotellveckefjarden.com/om-hotellet/)
confirms the hotel, adjacent outdoor pool and parking. These sources establish
functions at site level; proximity alone does not identify every individual roof.

The clubhouse photographs `club-2041` and `club-2485` show **two full main window
rows, with an exposed lower level on the course side**, pale yellow timber, white
joinery, a dark roof with stacks, a projecting entrance porch and a terrace.
The current uniform three-row treatment is insufficient as an architectural
reference. `hotel-167` gives useful hotel roof, window, pool and deck detail.
See [photo-sources.json](photo-sources.json) for the original URLs and observations.
Web upload dates are not treated as camera dates.

The east entrance porch is visible in the exterior photograph but obscured by
shadow in the orthophoto. R01 explicitly leaves that roof component unresolved;
R02 is the separate west terrace-side porch. The old amber porch polygon is
comparison geometry, not a newly verified measurement.

## Coordinates and measurement limits

The orthophoto campaign is **2024-06-27**, from the previously acquired
`orto-u2-2024` RGBI TIFFs. Native pixel spacing is **0.16 m**. The overview is
resampled for navigation; detail panels preserve 0.16 m spacing. Each panel has
an EPSG:3006 affine, world file, source IDs and checksums in
[inventory.json](inventory.json). Source absolute horizontal accuracy is unknown.
The original [acquisition record](../../geo_data/course-v2/veckefjarden/acquisition/ortho-review.json)
retains the source access and attribution: Ortofoto Nedladdning © Lantmäteriet,
bearbetad information, CC BY 4.0.

Blender uses metre units, **X east, Y grid north, Z up**, with origin
**E 684390, N 7023040 (EPSG:3006)**. Map planes and outlines are at an arbitrary
flat reference datum. Their slight display offsets are not physical elevations.
Roof edges can be displaced from ground walls by roof overhang and relief
displacement; they must not be presented as surveyed ground footprints.

The legacy app uses true north and a different origin. To return a Blender XY
point to the course frame:

```python
from pyproj import Transformer
inverse = Transformer.from_crs(3006, 4326, always_xy=True)
lon, lat = inverse.transform(684390 + blender_x, 7023040 + blender_y)
course_x = (lon - 18.6735) * 50045.09
course_z = (63.2845 - lat) * 111320
```

Do not apply a simple translation or treat grid north as true north. Establish
wall-base elevations against the authoritative RH2000 terrain before building
massing. Eaves/ridges require building returns from a suitable point cloud,
survey/drawings, or explicitly labeled photo estimates; a bare-earth DTM cannot
measure roofs. An eventual glTF export also needs the app's origin and vertical
datum handling. The reference scene is not an export-ready replacement asset.

## Blender scene and reproduction

The scene has orthophotos, cyan reviewed image outlines, amber existing model
outlines, labels, a scale, individual photo boards and review cameras. Photo
boards lie east of the map; use Material Preview or Rendered shading. IDs match
the inventory and photo manifest. Source URLs and evidence are object properties.
All reference images are packed into the `.blend`.

The local Blender bridge is on `127.0.0.1:9876`. Creation uses data APIs and
`bpy.data.libraries.write` to save only the new scene and its dependencies.
Existing scenes, selection and the active file are preserved. The builder refuses
to overwrite an existing output or scene; use a new scene name/output when revising.

```powershell
$py = 'geobuild/cache/ortho-venv/Scripts/python.exe'
& $py geobuild/facilities/prepare-ortho.py
& $py geobuild/facilities/gather-photo-references.py
& $py geobuild/facilities/prepare-blender-spec.py
& $py geobuild/facilities/blender_mcp.py --script geobuild/facilities/build_blender_reference.py
& $py geobuild/facilities/audit-references.py
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background --factory-startup geobuild/cache/facilities-2026-09-10/veckefjarden-facility-references.blend --python geobuild/facilities/audit_blender_file.py
```

The Blender script defaults to this checkout's path; callers moving the repo can
set `VECK_REPO_ROOT` in the script execution globals. The preparation scripts
resolve their repository root from their own file location.

Reference photos have no identified redistribution grant and are not application
textures. Lantmäteriet attribution is retained in the orthophoto records. Course
models, tee coordinates, packages and runtime buildings are untouched by this pack.

## Validation

See [reference-audit.json](reference-audit.json) for source, affine and coordinate
checks, [blender-build-report.json](blender-build-report.json) for preservation of
the live Blender session, and [blender-file-audit.json](blender-file-audit.json) for
an independent background reopen of the saved file. The latter verifies packed
images, map orientation, outline positions and exclusion of unrelated scenes.
Both audits pass: 486 original-image pixel samples agree, the legacy coordinate
round trip differs by at most 0.000669 m from stored rounding, and Blender's local
coordinate storage differs by at most 0.0000123 m. These arithmetic checks do not
establish survey accuracy. All 17 reference images are packed in the 15.7 MB file.
