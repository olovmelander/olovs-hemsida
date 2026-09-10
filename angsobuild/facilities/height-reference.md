# Angso facilities: 2021 laser height evidence

290,512 classified returns acquired in two bounded windows; 2,627 unique returns retained in planar supports.

Source capture interval: 2021-03-08 to 2021-04-01. LAS class 1 is unclassified, not a building label. Roof assemblies require visual review against the newer imagery.

| Reference ID | Nearby ground RH2000 | Planes | Candidate gable ridge RH2000 |
| --- | ---: | ---: | --- |
| B01 | 7.611 m | 4 | 15.46–15.47 m |
| B02 | 7.507 m | 1 | unresolved |
| B03 | 7.936 m | 2 | 14.88–14.90 m |
| B04 | 8.84 m | 4 | 14.86–14.88 m |
| B04a | 8.535 m | 2 | unresolved |
| B05 | 7.965 m | 1 | unresolved |
| B06 | 7.973 m | 1 | unresolved |
| B07 | 8.177 m | 1 | unresolved |
| B08 | 8.061 m | 1 | unresolved |
| B09 | 8.234 m | 2 | 12.41–12.44 m |
| B10 | 9.078 m | 1 | unresolved |
| B11 | 6.229 m | 1 | unresolved |
| B12 | 6.294 m | 2 | 10.63–10.64 m |
| B13 | 12.917 m | 2 | 23.25–23.25 m |

Detailed plane coefficients, support hulls, point counts, residuals, ground estimates, candidate ridge coordinates and caveats are in `height-reference.json`.

Blender point-cloud frame: E0=605530, N0=6605140, H0=8.0 m RH2000; X east, Y grid north, Z up. The `.ply` uses this same origin. If the modelling workspace chooses a different H0, apply the explicit vertical difference.

Raw source points, `roof-support-points.ply`, and `roof-plane-review.png` are in `angsobuild/cache/facilities-2026-09-10/laser/`.

Ground fits are surrounding terrain planes, not finished-floor levels. Planar hulls are sampled inner envelopes, not surveyed eaves or walls. Internal fit residuals are not total survey accuracy. Small sparse roofs can remain unresolved. Adjacent buffered queries can share returns; these plane studies are not separate established roof components.

Outside the laser windows: N01, N02, N03, N04. No height evidence is claimed for these neighbouring structures.

Attribution: Laserdata Nedladdning, skog, © Lantmäteriet, bearbetad, CC BY 4.0. [Source COPC](https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/21c036/m21c036-660_60.copc.laz). [Terms](https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor-for-laserdata-nedladdning-skog.pdf).
