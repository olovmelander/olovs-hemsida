# Dated building geometry and roof heights

Five facility roof surfaces are reconstructed from the retained Lantmäteriet
laser campaign `21c031-658_67`, captured 2021-03-23. The OSM footprint is a
spatial hypothesis, checked visually against the municipal 2019 orthophoto.
The source has no building classification: roofs and vegetation are both
class 1. These are machine-reviewed, dated measurement candidates.

| Footprint | OSM association | Supported footprint | Roof surface RH 2000 range |
| --- | --- | ---: | ---: |
| `way/32262176` | Lidingö Golfklubb / clubhouse | 92.28% — partial | 32.19–34.06 m |
| `way/32262169` | Sport building, south annex | 100% | 31.43–32.11 m |
| `way/32262183` | Sport building, north facility | 89.75% — partial | 33.50–40.80 m |
| `way/26408210` | Building beside west range edge | 99.84% | 25.17–35.87 m |
| `way/26408211` | Building east of range road | 99.92% | 24.48–33.32 m |

The small footprint `way/221846983` has only 18 selected returns and insufficient
planar support. Its roof mesh is withheld. The 2019 image shows correspondence
with the six retained footprints; facility names beyond the explicit OSM tags
are descriptive associations, not confirmed current use.

The two partial roofs retain 45.60 m² and 80.03 m² of unsupported footprint.
These may include unroofed patios, source-outline differences or sparse/ambiguous
returns. They remain unknown in the source evidence. No roof fill or walls around
those internal gaps are inferred in the retained measurement mesh. The separate
display model described below closes its approximate architectural volumes.
The mapped footprints can still serve as conservative building
exclusions for vegetation.

## Reconstruction and checks

The bounded intake covers E 677610–677710, N 6586220–6586550, reading 68,601
points in 43 range requests (5,903,489 bytes). It pins the same source identity,
ETag and size as the canopy intake and verifies every decoded node count.
`building-laser-acquisition.json` records the point-file checksum. The full
point-cloud asset was not downloaded or independently checksummed.

`build-building-evidence.py` selects first returns at least 1.5 m above the
retained DTM, inside a footprint inset of 0.6 m. Deterministic RANSAC identifies
local supporting planes with a 0.18 m inlier band. Plane fits classify additional
actual edge returns only within 3 m of their support and 0.22 m height residual.
The mesh retains those original return heights. Boundary heights use the nearest
supporting plane only within 3 m; unsupported segments are omitted. Triangles
are clipped to the original footprint, and no edge spans more than 5 m.

This produces 7,069 upward-facing triangles. The independent checker verifies
source checksums, triangle winding, finite coordinates, lack of overlap,
footprint containment, explicit uncovered regions and boundary-wall placement.
Its 3,212 source-return vertices retain source heights within 0.000051 m of
encoding rounding. That is a data-preservation check, not a survey-accuracy claim.

## Integration

Read [`building-roof-meshes.json`](building-roof-meshes.json), check its input
hashes, and associate `buildings[].sourceFootprintId` with the exact model building.
Each `mesh` contains:

- `verticesEpsg3006RH2000`: `[easting, northing, heightRH2000]` vertices.
- `triangleIndices`: flat groups of three vertex indices.
- `boundaryWallSegmentsEpsg3006RH2000`: explicitly supported pairs of boundary vertices.
- `uncoveredFootprintGeometryEpsg3006`: MultiPolygon gaps, retaining interior rings.
- `statistics.footprintCoverageFraction`, supported wall length and uncertainty metrics.

Convert the horizontal pair using `x = E - 677700.5`, `z = 6586399.5 - N`.
The compatibility world already uses RH 2000 as vertical coordinates, so the
roof's `heightRH2000` stays unchanged. The separate v2 terrain frame has origin
height −0.05 m and its existing bridge performs that translation.

The source inspection path (`buildingGeometry=source`) renders the supplied roof
triangles directly, with walls descending from supported segments to the DTM.
The default scene uses a separate [architectural display model](../../docs/courses/lidingo-clubhouse-appearance.md)
for these five buildings. It replaces the visible TIN with smooth roof sections
and closed walls, informed by public clubhouse photos and retained roof heights.
The source TIN, unsupported regions, height fields and footprints remain intact
in the model and shipping pack. Generic roofs/decorations stay bypassed for both
paths; no roof-top height is assigned to the existing `h` wall/eave field.

Eaves, foundations, materials, windows and roof styles remain unverified as
measurements. Authored roof fill and facade/terrace estimates are explicitly
display geometry, not new laser/orthophoto mapping evidence. Runtime counters
distinguish retained source triangles from triangles actually rendered.

## Rebuild

```powershell
node --env-file=.env lidingobuild/acquire-building-laser.mjs
upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/build-building-evidence.py
upsalabuild/cache/review-venv/Scripts/python.exe lidingobuild/check-building-roofs.py
```

The acquisition command reuses checksummed local points unless `--refresh` is
explicitly supplied. Source review panels and raw points stay under the ignored
`lidingobuild/cache/buildings/` directory. Compact height and validation reports
are [`building-height-evidence.json`](building-height-evidence.json) and
[`building-roof-validation.json`](building-roof-validation.json).
