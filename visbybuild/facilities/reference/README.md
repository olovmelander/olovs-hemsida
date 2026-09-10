# Visby facilities: georeferenced modeling references

Prepared 10 September 2026. The kit contains 15 orthophoto panels, 37 building/roof outlines, the Skansudde lighthouse location, and nine non-building reference features. Thirteen structures are in the club facility scope; the other 25 are surrounding context with no ownership assertion.

The seven source windows were reacquired from Lantmäteriet's 10 April 2026 RGBI flight at native 0.16 m spacing. All seven rasters matched the previously retained acquisition hashes and have 100% valid pixels. Source TIFFs remain under `visbybuild/cache/lm-ortho/`. The PNGs here copy the RGB bands without resampling. Every panel has a world file and EPSG:3006 projection file; the manifest also retains its exact parent-raster pixel window.

## Use in Blender

- X = easting − 687748.5 metres.
- Y = northing − 6370951.5 metres.
- Z = absolute RH2000 height, in metres. Do not subtract the runtime frame's 0.10 m height offset while authoring.
- Image north is the top edge. `orthophoto-manifest.json` gives the plane centre and dimensions for every image.
- `../facility-inventory.json` provides `footprintBlenderXY`, `centerBlenderXY`, `groundEvidence`, and source height cells. Prefer `roofObservation.roofEnvelopeBlenderXY` when present, while retaining its interpretation uncertainty.
- `facility-ground-rh2000-2m.f32` is a small landscaping reference sampled directly from the retained 1 m terrain. Its JSON describes row-major Float32 dimensions, sample-centre origin and hashes.

Useful panels are `clubhouse-close`, `lighthouse-close`, `east-facilities-close`, `range-firing-line`, `range-net-north`, and `service-yard`. The overview panels establish their relationships to the course. Annotated images have the same transform as their clean counterparts: yellow denotes club-area outlines, blue surrounding OSM buildings, magenta newly traced roof envelopes, and green non-building traces.

## Findings that affect the model

The orthophoto reveals five roofs absent from the inherited OSM building list: the eastern range shelter, a long building behind the range parking, the two western service-yard roofs, and a small shed at the north of that yard. The current detached kiosk-like roof beside clubhouse parking is substantially wider than the inherited narrow footprint for `way/530655629`. These observations are retained in `observed-roofs-2026.json` and in the inventory; functional names remain provisional when ground photos do not establish them.

The clubhouse has multiple intersecting roofs and a faceted southern bay. Its west and south patios are separately traced. The open firing mats form three strips around the two range shelters. The eastern safety-net base follows a long curve from E687583.68 N6370977.60 to E687519.68 N6370846.24; northwest-projecting dark lines are pole shadows. Net height and current equipment are not measured; the mat count is detected on the `range-firing-line` panel by `trace-range-layout.py` (32 mats in three rows).

Ground elevations come from bilinear sampling of the existing 1 m Markhöjdmodell, with source hash retained. The clubhouse footprint centroid is 2.730 m RH2000; the lighthouse point is 5.022 m. These are terrain support levels, not finished-floor surveys.

Roof heights are supporting envelopes from the 2024 campaign `24e002`, using maximum non-noise returns in 2 m cells inset 1 m from each outline. They do not establish eaves or roof planes. The clubhouse's p90/p95 heights above ground are 6.496/6.572 m; the large northeast service hall's are 6.548/7.124 m. The range-parking building and southern western service roof contain tree-crown contamination and are explicitly rejected as roof-height measurements. The north yard shed and current kiosk roof have insufficient 2024 support. Keep modeled heights for these as estimates.

## Provenance and verification

`orthophoto-acquisition.json` retains current download evidence; `orthophoto-manifest.json` gives exact transforms, file hashes, acquisition source IDs and capture times. `building-footprints.geojson` carries the outline inventory in EPSG:3006. `inventory.md` provides a numbered table.

`validation.json` records successful checks of all 15 PNGs against their source TIFF pixel windows, exact affine transforms/world files, hashes, valid polygons, unique IDs and the Blender coordinate conversion. The reference preparation changes no runtime file or Blender connection.

Reproduce from the repository root with:

```powershell
& upsalabuild/cache/review-venv/Scripts/python.exe visbybuild/facilities/acquire-reference.py
& upsalabuild/cache/review-venv/Scripts/python.exe visbybuild/facilities/prepare-reference.py
```

Attribution: Ortofoto Nedladdning © Lantmäteriet, CC BY 4.0; Lantmäteriet Markhöjdmodell and Laserdata Skog for height evidence; © OpenStreetMap contributors for inherited footprints. Pixel spacing is not an independently measured positional accuracy. The manual roof traces carry approximately 1 m interpretation uncertainty and may include overhang or aerial building displacement. Source epochs differ: laser 2024, imagery April 2026, OSM snapshot September 2026.
