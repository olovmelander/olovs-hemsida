# Visby / Kronholmen geospatial evidence

Acquired and checked 2026-09-07 following the [v2 runbook](../../../../docs/v2-course-runbook.md).
This is source intake for the shared 27-hole property; only the main `visby`
course slug is registered in this discovery. A nine-hole route needs its own
verified card and associations. No origin control, course routing, surveyed
surface, individual tree, or independent human visual approval is established
by these source files.

## Coordinates and OSM observations

The current [official OSM map API extract](https://www.openstreetmap.org/api/0.6/map?bbox=18.105,57.429,18.145,57.455)
is retained locally with its SHA-256 in [osm-acquisition.json](osm-acquisition.json).
Its derived [WGS84](osm-golf-wgs84.geojson) and
[EPSG:3006](osm-golf-epsg3006.geojson) GeoJSON retain stable OSM IDs, versions,
edit timestamps and original tags. Attribution is **© OpenStreetMap contributors**,
under [ODbL](https://www.openstreetmap.org/copyright).
The projected file explicitly uses `[easting, northing]` and has no heights.

The golf boundary is [way 199830330](https://www.openstreetmap.org/way/199830330):

| Extent | Minimum | Maximum |
|---|---:|---:|
| Longitude | 18.1172488 | 18.1398209 |
| Latitude | 57.4384421 | 57.4518335 |
| SWEREF 99 TM easting, m | 687076.1035647502 | 688432.1488042905 |
| SWEREF 99 TM northing, m | 6370516.74000113 | 6371989.725481339 |

The mapped boundary encloses approximately 1,237,163 m²; it is neither a
cadastral parcel nor an approved playing-area boundary. The discovery AOI is
larger: WGS84 `[18.105,57.429,18.145,57.455]`, projected with densified edges to
`[686275.809,6369400.060,688808.445,6372403.068]` in EPSG:3006.

There are 171 spatial observations, including 17 greens, two tees, five
bunkers, 15 `golf=water_hazard` features, 26 golf paths, 32 buildings, two
coastline ways and two `golf=hole` records. The extract is incomplete as a golf
model: it contains no fairway polygons or complete course routing. Golf tags
are observations, and a `water_hazard` tag does not establish standing water
or a surveyed penalty-area limit.

Both hole records say `ref=2`, `par=4`, `handicap=7`, without explicit course
membership. Way 1553919218 is a five-vertex closed line only 51.90 m long;
way 1553919219 is a two-point open line 347.59 m long. They cannot be used as
two valid hole routes. Their August/September 2026 edits are newer than the
initial Overpass fallback snapshot (base timestamp 2026-06-01), which had no
hole records. Current official API evidence supersedes that fallback for the
tracked GeoJSON; both original snapshots remain in local cache. None of these
records is assigned to the main course or the nine-hole course here.

## National terrain, laser, imagery and water

The canonical [discovery report](../acquisition/d2-discovery.json) pins complete
STAC coverage, item IDs, asset URLs, native footprints, source sizes,
multihashes, metadata verification and candidate alternative image campaigns.
Discovery uses the official [height STAC](https://api.lantmateriet.se/stac-hojd/v1/)
and [imagery STAC](https://api.lantmateriet.se/stac-bild/v1/).

| Layer | Pinned evidence | Acquisition status |
|---|---|---|
| 1 m Markhöjdmodell | `636_68`, `637_68`; EPSG:5845, SWEREF 99 TM + RH 2000 | Authenticated byte ranges passed. The separate terrain pipeline owns the compiled window. |
| Water break geometry | `m636_68_brytgeometri.gpkg`, `m637_68_brytgeometri.gpkg`; EPSG:3006 | Both complete GPKGs downloaded, 348,160 bytes total; source multihashes verified. |
| Laserdata skog COPC | `24e002-636_68`, `24e002-637_68`; EPSG:5845 | Header and metadata access verified; full/cropped point clouds and tree derivation remain pending. |
| National RGBI orthophoto | `orto-f2-2026`, 0.16 m; four `o63675_*` / `o63700_*` items, capture 2026-04-10 | All four pixel assets returned HTTP 403 with the configured account; metadata is available. |

The [access report](lm-access-preflight.json) distinguishes measured account
authorization from the generic discovery status. Terrain and laser returned
HTTP 206; national orthophoto returned 403, not missing-credential 401. The
[official orthophoto product page](https://geotorget.lantmateriet.se/dokument/projects/ortofoto-nedladdning/released/2025.02/)
states that access is free but needs a product order, a review of intended use
under GDPR and acceptance of special terms. No order or account changes were
made during this intake.

The [retained national asset ledger](lm-retained-assets.json) covers ten public
metadata files and two authenticated GPKGs (670,103 bytes combined). Water break
polygons describe flattened DTM water, not bathymetry or golf penalty areas.

The [2026 product update](https://www.lantmateriet.se/sv/geodata/vara-produkter/Produktnyheter/Geografisk-information/markhojdmodell-nedladdning-utokas-med-mer-innehall/)
introduces nominal 10 km items, but Visby's coastal COGs are cropped:
`636_68` is `[685000,6365000,690000,6370000]`, 5000 × 5000 pixels;
`637_68` is `[685000,6370000,690000,6380000]`, 5000 × 10000 pixels. A decoder
must use actual georeferencing, not assume that item `68` starts at E680000.

Intersecting the retained terrain-origin polygons with the OSM property shows
92.89% airborne laser source dated 2024-02-03 and 7.11% dated 2024-02-05.
Both declare 0.3 m plan / 0.1 m height uncertainty. The broader selected DTM
items also contain a 2026 image-matching patch outside this OSM boundary; the
item-wide capture range must not be presented as the course's capture date.
These are source metadata statements, not measured independent residuals.

The COPC info `boundary.boundary_json` uses northing/easting while its WKT
boundary uses easting/northing. Do not consume that JSON as GeoJSON without an
explicit axis correction. Its extreme raw Z range includes unsuitable returns;
classification, ground normalization and noise filtering are required before
canopy or tree claims. No minimum raw Z is adopted as ground height.

## Region Gotland imagery and historical sources

The [official image-service catalog](https://imageserver.gotland.se/arcgis/rest/services/Ortofoto)
was retained with 21 service metadata responses in
[gotland-imagery-services.json](gotland-imagery-services.json). It provides
island-wide 2005, 2010, 2012, 2014, 2016, 2018, 2020 and 2022 campaign services,
plus historical economic maps, local special flights and a height raster.
Coverage must be checked individually; the Visby-city and Roma special imagery
do not automatically cover Kronholmen. The generic `Ortofoto/Ortofoto` service
describes 2018 imagery, so its generic name does not mean newest.

The 2022 image window covers the full golf property plus a margin:
EPSG:3006 `[686900,6370350,688650,6372150]`, 3500 × 3600 pixels at 0.5 m output
spacing. The service's native grid is EPSG:3015 and advertised product spacing
is 0.25 m. The public export performs the declared grid transformation and
resampling. The [image ledger](gotland-ortho-2022.json) records exact export
request, returned extent/dimensions, SHA-256 and a pixel-centre worldfile.

Original image: `visbybuild/cache/geodata-2026-09-07/gotland-2022-0p5m.png`
(22,144,608 bytes); worldfile: same stem `.pgw`; quick inspection:
`gotland-2022-preview.jpg`. All are ignored local evidence. Visual inspection
confirmed a complete nonblank course overview with coastline, facilities,
golf surfaces, ponds and surrounding land; no per-hole boundary was approved.

The footprint query returned two source datasets (`637_68_0050_2022`,
`637_68_0075_2022`) and six overview records. Eight query records are not eight
independent source flights. No exact capture dates were supplied. The 2022
service's copyright field is empty; rights cannot be inherited from another
service. Municipal imagery remains local review input with redistribution
terms unresolved. It is not a rendered ground material.

The municipal height raster is 1.25 m, derived by linear triangulation from
Lantmäteriet LAS data, in EPSG:3015 + RH 2000. Its vintage and independent
accuracy have not been established, so it does not supersede the 1 m national
terrain. Municipal survey/base-map geometry, independent origin controls and
as-built club data remain acquisition gaps.

## Reproduction and checks

Run from the repository root. The dated source cache is reused only after
hash verification; a new source vintage needs a new snapshot directory.

```powershell
node geo_data/course-v2/visby/reference/acquire-geodata.mjs
node --env-file=.env geo_data/course-v2/visby/reference/acquire-access-evidence.mjs
& upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/visby/reference/acquire-municipal-ortho.py
& upsalabuild/cache/review-venv/Scripts/python.exe geo_data/course-v2/visby/reference/verify-geodata.py
```

Python dependencies are Pillow, pyproj and Shapely; acquisition uses the
existing local review environment. Credentials are consumed only by the
existing clients and never serialized. The [validation report](geodata-validation.json)
verified 38 source assets / 25,183,750 bytes, all 171 vector geometries valid,
and 3,588 coordinate pairs reproduced exactly with pyproj. These checks establish
byte integrity, consistent projection and parseable geometry. They do not
establish a complete playable routing, rights for municipal-derived production
features, or independent survey accuracy.
