# Puttom facility height reference

Measured 2026-09-10 from Lantmäteriet Laserdata Nedladdning, skog, item `23f028-702_69`. The campaign is June 2023 (STAC nominal date June 4; capture interval June 1–7; nearby scan metadata says June 7). All facilities are north of the N=7025000 campaign seam. The June 2026 southern campaign does not cover these buildings.

The focused 370 × 300 m window contains 335,390 returns, including 235,540 classified ground and 96,073 unclassified returns. There are no class-6 building labels. Plane support is inferred roof evidence, not automatic building classification.

[Source COPC](https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/23f028/m23f028-702_69.copc.laz) · [Licence and attribution](https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor-for-laserdata-nedladdning-skog.pdf)

## What the measurements mean

The table gives surrounding ground height, measured planar-support height range, and candidate gable-ridge heights. Plane height percentiles are sampled roof-surface evidence, not surveyed eave elevations. Ground planes are not finished floor or entrance thresholds. Ridge candidates pass opposing-slope and shared-support checks but must be associated with the correct roof assembly in photographs.

| Facility ID | Nearby ground RH2000 m | Planes / support returns | Plane support p05–p95 RH2000 m | Candidate ridge RH2000 m |
|---|---:|---:|---:|---:|
| roof-clubhouse-main | 44.03 | 2 / 617 | 50.31–53.48 | 53.61 |
| roof-clubhouse-west-lower | 43.51 | 2 / 386 | 47.83–53.17 | unresolved |
| roof-clubhouse-west-wing | 42.28 | 2 / 155 | 45.45–46.62 | 46.66 |
| roof-clubhouse-connector | 43.02 | 3 / 146 | 45.48–51.13 | unresolved |
| roof-north-courtyard-building | 43.73 | 2 / 32 | 46.47–47.13 | unresolved |
| roof-range-l-building | 44.40 | 4 / 887 | 47.22–49.01 | 49.06, 49.05 |
| roof-range-east-hut | 44.76 | 1 / 73 | 47.14–48.14 | unresolved |
| roof-range-west-hut | 43.75 | 1 / 88 | 46.17–47.94 | unresolved |
| roof-range-south-building | 43.95 | 3 / 134 | 45.31–49.87 | 49.94 |
| roof-maintenance-long | 51.90 | 2 / 339 | 55.97–58.35 | 58.49 |
| roof-maintenance-hall | 50.90 | 2 / 491 | 54.88–56.27 | 56.30 |
| roof-maintenance-hall-attachment | 50.67 | 1 / 31 | 54.91–55.73 | unresolved |
| roof-maintenance-small | 51.80 | 1 / 161 | 55.28–55.79 | unresolved |
| roof-west-cabin-a | 39.71 | 2 / 113 | 42.40–42.97 | unresolved |
| roof-west-cabin-b | 39.52 | 3 / 142 | 41.95–43.20 | unresolved |
| roof-west-red-house | 41.87 | 4 / 299 | 45.28–48.14 | unresolved |
| roof-west-red-house-canopy | 41.39 | 3 / 164 | 45.02–48.10 | unresolved |
| roof-west-lakeshore-pavilion | 37.85 | 2 / 63 | 40.36–45.39 | unresolved |
| roof-west-south-dark-shed | 42.77 | 0 / 0 | unresolved | unresolved |
| roof-west-south-rust-shed | 43.43 | 1 / 17 | 46.29–46.42 | unresolved |

Unresolved assemblies have their ridge interpretation suppressed. Lower-west/connector search areas overlap the main roof because the aerial roof appears displaced; do not treat those duplicated high planes as lower roofs. The 2023 laser and 2024 ortho remain in their original coordinates. The clubhouse overlay makes the displacement visible.

## Blender coordinates

Use metres, X east and Y north. Subtract E=697365 and N=7025190 from EPSG:3006 coordinates, and subtract 44 m from RH2000 elevations. This height origin is the rounded ground near the clubhouse; it changes only the local coordinate offset, not measured elevations.

`height-reference.json` contains the complete source lineage, per-plane coefficients, measured support hulls, hull heights, candidate ridges, ground planes and Blender XY coordinates. `laser/roof-support-points.ply` uses the same origin. These are reference surfaces; no final facade/wall geometry is claimed.

## Limits and follow-up

- The source predates the 2024 orthophoto and current website imagery; check any new structures or roof alterations.
- Roof query envelopes may be relief-displaced or inherited approximate traces. Buffers can include neighbouring roofs or tree returns. Individual planar subsets can therefore be duplicated across adjacent building queries.
- Support hulls are sampled inner extents, not wall footprints or exact roof overhangs. Use photographs to identify roof type and assembly.
- Internal plane residuals do not represent absolute survey accuracy. Allow at least roughly 0.3 m vertically and 0.5–1 m horizontally until independently checked; sparse returns, sloping ground or wrong assembly can increase uncertainty.
- Windows, doors, posts, stairs, terrace heights, roof materials, service equipment and building ownership/use remain photographic or field questions.
- The application’s bare-earth terrain does not contain roof height. These measurements use separate nonground laser returns.

## Reproduce and review

1. `node --env-file=.env puttombuild/facilities/acquire-facilities-laser.mjs`
2. Run `puttombuild/facilities/prepare-height-reference.py` with NumPy, Shapely, pyproj and Matplotlib.
3. Review `puttombuild/cache/facilities-reference-2026-09-10/laser/roof-plane-review.png` and `height-overview.png` against the ortho/photo reference panels.

Raw points, derived point subsets and review rasters stay in the ignored local cache. Acquired point bytes are SHA-256 checked before fitting. The catalogue checksum for the 1.06 GB source is pinned; bounded range acquisition does not verify that entire source checksum.

Laserdata Nedladdning, skog, © Lantmäteriet, bearbetad, CC BY 4.0
