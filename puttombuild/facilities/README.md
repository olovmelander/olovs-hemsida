# Puttom clubhouse and facility modelling references

Open the [searchable reference gallery](../cache/facilities-reference-2026-09-10/index.html)
or the [Blender workspace](../cache/facilities-reference-2026-09-10/puttom-facility-references.blend).
This package assembles the evidence used to rebuild Puttom's clubhouse and nearby
facilities. The [production models and app integration](models-2026-09-10/README.md)
now replace all 17 inherited campus building entries and the old range equipment.
The reference scene above remains available separately from the authored models.

The package was prepared on 10 September 2026 through the live Blender bridge at
`127.0.0.1:9876`. Its scene is **Puttom | Facility references 2026-09-10**.
It is saved separately from the user's existing Blender work.

| Evidence | Included | Use |
| --- | --- | --- |
| Official orthophotos | Five native 0.16 m panels from 27 June 2024, with RGBI GeoTIFFs, RGB PNGs, world files and EPSG:3006 projection files | Roof plan, placement, parking, courtyard, range and neighbouring buildings |
| Reviewed roof observations | 20 roof/canopy observations, including seven components absent from the inherited geometry | Separate main roof, lower side extension, connector, long annex, L-shaped range and smaller structures |
| Site context | 15 records, including 17 visible mat centres, hitting apron, terrace and fence, plus inherited parking, practice and access geometry | Nearby facilities and circulation; each record retains its observation status |
| Public photographs | 25 inspected images, including 12 full-resolution oblique aerials captured 14 June 2014, official entrance/Härbre photos and newer range views | Facades, glazing, annex connections, roof construction, trim, entrances and equipment |
| Official laser | 335,390 original returns over a 370 × 300 m window from the June 2023 campaign | Ground context and supported elevated planes; original classification retained |
| Existing model comparison | 40 building records in the catalogue, including 17 campus pieces; only the campus comparison is imported into Blender | Identify discrepancies without promoting earlier approximate traces to measurements |

The 20 observations include uncertain small canopies and roof candidates. They
are not a certified count of buildings. Two inherited shed outlines remain
unmatched. Nearby lakeside houses have unverified ownership and function.

## What the photographs establish

The clubhouse has a tall glazed gable with glazing returning around its corners,
different upper/lower window proportions on the entrance facade, a lower roof
extension on the other long side, and an exposed blue-grey base in the aerials.
A narrow low connector joins the long red annex beside the caravan area. Those
parts need separate volumes. The roof appears brown-grey and tile-like in some
photos; its exact material and neutral colour remain unverified.

Härbret has horizontal logs, corner joints, a clock, upper double window, a small
door canopy and side shelter. The L-shaped range/shop has intersecting roof
sections; newer photographs show the ball dispenser, paving, mats and rope posts.
The production asset includes these features and keeps estimated dimensions explicit.

Start with `clubhouse-2018`, `flickr-34163073056`, `flickr-34163074006`,
`flickr-34163072946`, `flickr-34163073026`, `harbre-2018` and `range-2025`.
The [photographic findings](web-reference.md) link each claim to its source.
The [club's aerial album](https://www.flickr.com/photos/puttom/albums/72157682928372255/)
is valuable historical evidence; compare it with the newer orthophoto and range
photos before fixing movable equipment or altered structures.

## Working in Blender

The normal `.blend` document opens on the Puttom site plan. It includes five
georeferenced image planes, cyan observed roof outlines, amber inherited building
outlines, green site references, photo boards, review cameras and embedded source
catalogues. All map and photo images are packed. Photo boards lie east of the map;
choose **Photograph camera** for their overview or frame an individual board.
Use Material Preview or Rendered shading to see reference images.

The laser collection is hidden initially. Enable collection 07 and select its
point object to inspect the original returns in Edit Mode. Its integer
`source_classification` attribute preserves the source labels. There are no
class-6 building returns: elevated roof evidence is interpreted using planarity
and imagery, not an automatic building classification. The
[height catalogue](height-reference.json) and [height notes](height-reference.md)
retain the fitting support and unresolved cases. No roof or wall mesh is fabricated
from the point cloud in this reference scene.

One Blender unit is one metre:

```text
Blender X = EPSG:3006 easting − 697365
Blender Y = EPSG:3006 northing − 7025190
Blender Z = RH2000 elevation − 44
```

The orthophoto planes use a flat display datum. They are not a terrain surface or
finished floor. The 44 m vertical origin is a rounded local reference, not a
surveyed entrance threshold. The image roof edge and the actual laser roof may
be displaced relative to one another by aerial relief displacement and overhang.
Use both sources before choosing the ground wall footprint.

To return Blender plan coordinates to Puttom's legacy authoring frame:

```python
from pyproj import Transformer
inverse = Transformer.from_crs(3006, 4326, always_xy=True)
lon, lat = inverse.transform(697365 + blender_x, 7025190 + blender_y)
course_x = (lon - 18.9413) * 50019.58
course_z = (63.2992 - lat) * 111320
height_rh2000 = blender_z + 44
```

Grid north differs from the legacy true-north frame by about 3.5 degrees. A simple
offset or axis swap is insufficient. Runtime export must also apply the app's
current terrain placement and vertical datum handling.

## Remaining evidence gaps

- Exact wall bases, finished floors, entrance thresholds and individual opening
  dimensions need photo/laser reconciliation or field measurements.
- The club names Björnakojan and Juniorstugan as overnight facilities, but their
  specific roofs are not securely identified. Golfhallen's interior photo does
  not identify its external building. Pump-house exterior and position remain
  unresolved in this package.
- Obscured small sheds/canopies and neighbouring ownership/use remain uncertain.
- Net heights, sag and current pole arrangement need newer measured evidence.
  The club reported damaged range net poles in April 2026.
- The 2023 laser, 2024 orthophoto and dated photographs represent different site
  states. Photo upload/publication dates are kept separate from camera dates.

## Source records and verification

- [Orthophoto catalogue](orthophoto-reference.json) and [facility inventory](facility-inventory.json)
- [Photo catalogue](web-reference.json) and [laser evidence](height-reference.json)
- [Source pixel and coordinate audit](reference-source-audit.json)
- [Package source validation](reference-pack-validation.json)
- [Live Blender preservation/build record](blender-build-report.json)
- [Independent saved-file audit](blender-file-audit.json)
- [Blender site preview](../cache/facilities-reference-2026-09-10/blender-site-preview.png)
- [Blender clubhouse plan preview](../cache/facilities-reference-2026-09-10/blender-clubhouse-preview.png)

The source audit compares 2,185 samples with original TIFF pixels, checks the full
PNG against its exported raster and validates the world files and coordinate
round trip. The independent Blender audit checks packed images, map orientation,
outline coordinates, point classifications, embedded catalogues and startup scene.
These checks establish software preservation, not survey accuracy.

## Reproduction

Run from the repository root using a Python environment containing NumPy,
Rasterio, Pillow, pyproj, Shapely and Matplotlib. The existing review environments
under `geobuild/cache/ortho-venv` and `upsalabuild/cache/review-venv` are available
in this checkout. Original orthophoto acquisition is documented in
[the mapping README](../mapping/README.md).

```powershell
$puttomPython = 'geobuild/cache/ortho-venv/Scripts/python.exe'
& $puttomPython puttombuild/facilities/prepare-ortho-reference.py
& $puttomPython puttombuild/facilities/prepare-ortho-inventory.py
node puttombuild/facilities/refresh-web-reference.mjs
node --env-file=.env puttombuild/facilities/acquire-facilities-laser.mjs
& $puttomPython puttombuild/facilities/prepare-height-reference.py
& $puttomPython puttombuild/facilities/audit-reference-sources.py
& $puttomPython puttombuild/facilities/prepare-reference-pack.py
& $puttomPython puttombuild/facilities/blender_mcp_client.py --script puttombuild/facilities/build-blender-reference.py
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background puttombuild/cache/facilities-reference-2026-09-10/puttom-facility-references.blend --python puttombuild/facilities/package-blender-reference.py
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background puttombuild/cache/facilities-reference-2026-09-10/puttom-facility-references.blend --python puttombuild/facilities/audit-blender-reference.py
```

The builder refuses to overwrite an existing scene or file. For a new iteration,
choose a new scene/output in the specification and retain any artist edits.
Packaging and saved-file verification run in separate background Blender
processes, preserving the live interactive session.

Raw imagery, downloaded photos, laser data and `.blend` files remain in ignored
`puttombuild/cache/`. Public photos are local modelling references; no production
texture reuse licence has been established. Official orthophoto and laser
attribution: © Lantmäteriet, bearbetad information, CC BY 4.0. The application and
its runtime building assets use the separately authored procedural geometry
documented in [the production package](models-2026-09-10/README.md).
