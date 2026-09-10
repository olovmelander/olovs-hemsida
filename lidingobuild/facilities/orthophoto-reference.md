# Lidingö orthophoto reference package

**Twelve georeferenced reference images are ready for Blender:** a full facility-corridor overview and five detail crops, each paired with 2025 national imagery and a 2019 municipal comparator. All raster pixels remain in the ignored local cache.

A live Lantmäteriet STAC check at `2026-09-10T07:42:58.909Z` confirms `orto-o2-2025` remains the latest complete campaign covering the course and its selected asset identities/sizes match the retained imagery. See [catalog evidence](orthophoto-catalog-check.json).

The 2025 pixels were captured **31 May 2025** at **0.16 m/pixel**. Exact contributing frame timestamps and image IDs are attached per crop in the [manifest](orthophoto-reference.json). The municipal images belong to the **2019 campaign**; exact capture date and product GSD remain unknown. Their original sampled grid is 0.5 m/pixel in EPSG:3011, reprojected here to EPSG:3006 at 0.5 m/pixel using nearest-neighbour sampling.

## Import coordinates

- Horizontal CRS: **EPSG:3006**, SWEREF 99 TM; all bounds below are metres and pixel outer edges.
- Vertical evidence: **RH2000 / EPSG:5613**. Orthophotos contain no building-height measurement.
- Blender origin: **E 677700.5, N 6586399.5, H 25.0 m**. Use `X=E−677700.5`, `Y=N−6586399.5`, `Z=RH2000−25.0` and metres.
- Images are north-up. Plane width is `maxE−minE`, plane height is `maxN−minN`; its Blender XY centre is the bounds midpoint minus the horizontal origin. Place a reference plane below terrain as appropriate; its display elevation is not measured image data.
- Pixel centres: `E=minE+(col+0.5)*resolution`, `N=maxN−(row+0.5)*resolution`. Every PNG has a `.pgw` worldfile and `.prj`; every GeoTIFF embeds EPSG:3006.
- The application uses X east, Y RH2000 height and Z south. An exported Blender GLB with the stated vertical origin needs a +25 m height translation in that application frame.

## Crop register

All image paths are relative to the repository. Bounds are `[minE, minN, maxE, maxN]`. Full SHA-256 values for PNG, GeoTIFF, worldfile, CRS file and original source raster are in the manifest.

| Image ID | Bounds EPSG:3006 | Pixels | m/pixel | Capture |
| --- | --- | --- | ---: | --- |
| `facilities-overview-lm-2025` | 677500.00, 6586029.92, 677730.08, 6586570.08 | 1438 × 3376 | 0.16 | 2025-05-31 |
| `facilities-overview-municipal-2019` | 677500.00, 6586029.58, 677730.50, 6586570.08 | 461 × 1081 | 0.5 | 2019 campaign; day unknown |
| `clubhouse-detail-lm-2025` | 677600.00, 6586409.92, 677705.12, 6586550.08 | 657 × 876 | 0.16 | 2025-05-31 |
| `clubhouse-detail-municipal-2019` | 677600.00, 6586409.58, 677705.50, 6586550.08 | 211 × 281 | 0.5 | 2019 campaign; day unknown |
| `upper-parking-detail-lm-2025` | 677500.00, 6586429.92, 677625.12, 6586545.12 | 782 × 720 | 0.16 | 2025-05-31 |
| `upper-parking-detail-municipal-2019` | 677500.00, 6586429.62, 677625.50, 6586545.12 | 251 × 231 | 0.5 | 2019 campaign; day unknown |
| `range-north-detail-lm-2025` | 677564.96, 6586344.96, 677655.04, 6586410.08 | 563 × 407 | 0.16 | 2025-05-31 |
| `range-north-detail-municipal-2019` | 677564.96, 6586344.58, 677655.46, 6586410.08 | 181 × 131 | 0.5 | 2019 campaign; day unknown |
| `range-buildings-detail-lm-2025` | 677609.92, 6586180.00, 677710.08, 6586320.00 | 626 × 875 | 0.16 | 2025-05-31 |
| `range-buildings-detail-municipal-2019` | 677609.92, 6586180.00, 677710.42, 6586320.00 | 201 × 280 | 0.5 | 2019 campaign; day unknown |
| `range-south-detail-lm-2025` | 677524.96, 6586034.88, 677710.08, 6586200.00 | 1157 × 1032 | 0.16 | 2025-05-31 |
| `range-south-detail-municipal-2019` | 677524.96, 6586034.50, 677710.46, 6586200.00 | 371 × 331 | 0.5 | 2019 campaign; day unknown |

Base directory: `lidingobuild/cache/facilities-reference-2026-09-10/ortho/`. Each crop ID names its `.png`, `.tif`, `.pgw`, `.prj` and `.json`. Primary modeling image: `facilities-overview-lm-2025.png`. Native source mosaic: `facilities-native-source-lm-2025.tif` (four measured bands: RGB + NIR; the fourth band is not alpha). Detail reference GeoTIFFs contain RGB only.

## Provenance and rights

- 2025: **Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0**. The authenticated byte-range intake is recorded locally in `ortho/native-acquisition.json`; no credentials are stored in reports. [Official terms](https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor_for_vardefulla_datamangder_pu.pdf).
- 2019: **Lidingö stad, CC0-1.0**. The [official municipal distribution metadata](https://metadata.lidingo.se/store/3/resource/32) explicitly licenses the retained `wms_ortofoto_2019_oppendata` service. Checked-in primary evidence is `geo_data/course-v2/lidingo/mapping/municipal-ortho-2019-licence.json`.
- The exact 2019 source image and worldfile are reused from `lidingobuild/cache/municipal-ortho-2019/`; their hashes are retained. The older municipal public-map LM layer has unknown capture date and is not used as the current reference.
- Acquisition and reference files stay local under the existing ignored cache. This task does not publish source pixels.

## What the references can establish

The images support plan shape, building orientation, facility placement and comparisons across dates. At roof edges, relief displacement, eaves, shadow and vegetation can separate the apparent roof perimeter from the ground wall footprint. Photo views and the dated laser roof evidence are needed for facade proportions and elevations. 0.16 m GSD does not imply 0.16 m positional accuracy. Changes after May 2025 require more recent evidence.

The [facility inventory](facility-inventory.md) identifies retained footprints/surfaces and missing covered tees, practice greens, net details and outlying facilities. Its overlay displays historical source geometry over 2025 pixels as a review aid; it does not approve a retrace.

The [validation report](geospatial-reference-validation.json) verifies all file hashes, exact PNG/GeoTIFF RGB equality, worldfile pixel centres, EPSG:3006 grids and exact retained feature joins.

Rebuild with the existing environment:

```powershell
node lidingobuild/facilities/recheck-orthophoto-catalog.mjs
upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/facilities/prepare-geospatial-reference.py
upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/facilities/build-facility-inventory.py
upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/facilities/verify-geospatial-reference.py
```
