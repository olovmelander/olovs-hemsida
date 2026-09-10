# Upsala facilities orthophoto and plan references

The entry point is `orthophoto-manifest.json`. The package changes no production course geometry. Plain source images remain in the ignored `upsalabuild/cache/facilities-2026-09-10/` directory.

## Coordinate placement

- EPSG:3006 is SWEREF 99 TM, metres, easting/northing.
- The course frame uses origin longitude 17.4952, latitude 59.839; `mPerLon=55930.68`, `mPerLat=111320`.
- `longitude = origin.lon + localX / mPerLon`; `latitude = origin.lat - localZ / mPerLat`. Transform each coordinate between EPSG:4326 and EPSG:3006; do not substitute a fitted shift, rotation, or a recomputed cosine scale.
- The agreed clubhouse scene anchor is local XZ `[17.78293267410761, -279.14314741547946]`, the area centroid of the existing `w221193965` local outline. It is a scene datum, not a surveyed control point.
- Flat Blender reference coordinates are `[localX-anchorX, anchorZ-localZ, 0]`. One Blender unit is one metre. No building height or floor elevation is implied by Z=0.
- Each manifest image includes its affine transform, four exact projected pixel-edge corners, and local/Blender coordinates. The projection is slightly nonlinear across the raster; exact point measurements should use the stated per-point transform, not bilinear interpolation of four corners.

## Image references

| Image | Resolution | Coverage |
|---|---:|---|
| `facilities-campus-native.png` / `.tif` | 0.16 m | Clubhouse, nearby buildings, parking and southeast service yard |
| `facilities-range-native.png` / `.tif` | 0.16 m | Complete driving-range roof and tee-mat line |
| `facilities-range-overview.png` / `.tif` | 0.64 m | Campus, driving range and practice-area context; averaged overview |

All three windows have complete image coverage from 14 June 2025, established by intersecting their bounds with the published source image mosaic polygons. The TIFFs retain measured RGB plus near-infrared as four bands; NIR is not alpha. PNG RGB pixels exactly match the first three TIFF bands. The `.pgw` files use pixel-centre coordinates, while the manifest transforms and corners use pixel edges.

The `*-numbered.png` files and `clubhouse-numbered-native.png`, `service-yard-numbered-native.png`, and `north-buildings-numbered-native.png` are review aids. Labels obscure some pixels: use the separate plain source images when measuring or texturing.

## Geometry and evidence

`building-reference-inventory.json` contains 19 numbered source parts, B01–B19, with source EPSG:3006 XY/XYZ, local rings, flat Blender rings, horizontal dimensions, original source attributes and existing-model comparisons. B01 is the main clubhouse complex, B02 its west attached part, B08 the visible driving-range shelter. Other functions remain candidates until matched to club photographs or plans.

`measured-footprints.geojson` and `measured-footprints-local.json` contain only the eight source parts whose municipal status is confirmed existing and whose plan method is geodetic. `building-footprints-reference.geojson` also includes the eleven uncertain-status parts. GeoJSON geometry uses WGS84 longitude/latitude; the inventory preserves exact EPSG:3006 source geometry. Status 0 means no information, not demolished.

The municipal layer does not declare whether the horizontal outline represents ground-level walls or a roof edge. Accordingly, no record is asserted to be a verified ground footprint or traced roof perimeter. The directly reviewed orthophotos show several relevant distinctions:

- B01/B02 closely identify the clubhouse components, but roof overhangs, the western terrace/cover and the exact enclosure line require oblique photographs.
- B06/B07 and B17/B18 are adjoining or overlapping source parts. Their records must not become duplicated solids automatically.
- B08's rectangular source part does not describe every visible roof extension or shelter edge. Native imagery is the reference for that additional roof structure.
- B14/B15 identify a small eastern building and a separate source part. Their combination and wall/roof convention remain unresolved.
- Tree cover limits some northern parking and small-structure interpretation.

`context-geometry-local.json` retains current model building alternatives, six local parking features labelled P01–P06, and the existing 20 practice-surface features. These are comparison/reference data with original provenance, not newly measured building boundaries.

## Heights remain unknown

An explicit municipal `returnZ=true` query returns some vertex elevations around 29–39 metres and other values of 0 or -999. The exposed response supplies no vertical CRS or feature-level ground/eave/ridge meaning; its Z values are therefore retained only as unverified source evidence. No extrusion height, floor level, roof pitch or ridge height is derived from them. Source edit timestamps are not survey dates. Independent terrain/point-cloud and photographic evidence belongs in a separate assessment.

## Reproduction and checks

Run `acquire-orthophoto.py` with the repository review Python environment to acquire the bounded imagery using the established authenticated reader. It does not persist credentials. The municipal source was fetched with the existing `geobuild/imagery/acquire-upsala.py --provider buildings` command for EPSG:3006 bbox `639590 6636120 640120 6636540`; a second query added `returnZ=true`. Exact URLs, raw-response hashes and times are in the cache request ledgers and manifest.

Run `compile-reference.py` to compile the package from those cached inputs. Checks cover source hashes, image dimensions/transforms, RGBI interpretation, valid masks, PNG/TIFF RGB equality, capture-date coverage, polygon validity and exact coordinate round trips. The observed largest projection round-trip error is below 0.000001 m; this is numerical consistency, not source positional accuracy.
