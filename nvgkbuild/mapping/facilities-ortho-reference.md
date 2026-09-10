# Norrfällsviken facilities: orthophoto modelling reference

The local reference bundle contains the clubhouse, its detached northern
building, practice building, range building, padel court, twelve range mats,
practice green and range surfaces. It uses the verified **27 June 2024**
Lantmäteriet orthophoto at **0.16 m per source pixel**. No new image download is
needed for this campus: the complete retained window already covers it.

The machine-readable inventory is [facilities-ortho-reference.json](facilities-ortho-reference.json).
It keeps EPSG:3006 coordinates, local runtime coordinates, source-pixel traces,
measured plan extents, bearings, confidence and separate inherited wall geometry.
The image crops are local working references, outside Git, under
`nvgkbuild/cache/facilities-reference/ortho/`.

## Source and reproducibility

- Source tile: `o69875_6775_25_mr24`, collection `orto-u2-2024`.
- Actual source photograph for this window: `24u215ss15_27~2024-06-27_134221_2070`,
  captured `2024-06-27T13:42:21Z`; source-mosaic coverage is 100%.
- Retained TIFF: `nvgkbuild/cache/lm-ortho/facilities-range.tif`.
- TIFF SHA-256: `acaea91ce6a0c9f2df3277bac57abe41b9e97c7e52c4074f026151fe40763d34`.
- RGB PNG SHA-256: `dc2c0996a6f9f2cd32d56c2b25d7e2d9b70133199edd20f0622f33d5dd8f06bc`.
- Source grid: 2564 × 1521 pixels, EPSG:3006, pixel-edge transform
  `[678519.36, 0.16, 0, 6988451.68, 0, -0.16]`.
- Attribution: Ortofoto Nedladdning © Lantmäteriet, bearbetad information,
  CC BY 4.0. The full acquisition and license evidence remains in
  `geo_data/course-v2/norrfallsviken/reference/lm-ortho-acquisition-2026-09-09.json`.

Rebuild the inventory and nine campus crop/worldfile/metadata sets with:

```powershell
geobuild/cache/ortho-venv/Scripts/python.exe nvgkbuild/mapping/build-facilities-ortho-reference.py
```

The builder verifies both source file hashes before reading pixels. Crops use
nearest-neighbour enlargement for inspection; this adds no source resolution.
Every clean PNG has a `.json` pixel-edge affine and a `.pgw` pixel-centre
worldfile. Annotated PNGs distinguish the image traces (yellow), approximate
visible ridge lines (red), and inherited OSM wall footprint (cyan).

## Building observations

Dimensions below are minimum rectangles around visible **roof** envelopes.
They must not be treated as surveyed wall dimensions. Local centres use the
unchanged golf application's east-positive x, south-positive z frame.

| Reference | Roof envelope | Local centre x, z | Observation |
|---|---:|---:|---|
| Main clubhouse roof | 15.54 × 12.04 m | −397.09, 130.59 | Red gable roof; two dark solar arrays on southwest-facing roof plane. Native outline corrects the earlier coarse review. |
| Clubhouse cross roof | 9.99 × 6.97 m | −391.05, 127.25 | Projecting cross gable; its visible ridge runs across the main roof direction. Intersection is partly hidden. |
| Detached northern building | 11.82 × 7.96 m envelope | −401.71, 115.61 | Missing from the previous model. Red roof and dark eastern portion/projection; exact roof division and use require photograph/LiDAR confirmation. |
| Range building | 14.44 × 11.19 m | −363.72, 239.73 | Red roof beside southern end of range mats; retained prior outline. Official range photograph separately confirms its facade. |
| Practice building | 9.11 × 9.10 m | −344.42, 184.53 | Grey roof immediately east of practice green; retained prior outline. Nearby tree shadow complicates the northern edge. |

The original main-roof trace was about 10 m wide and extended beyond the visible
southern eave. The native review retains the full roof planes. The previous
trace remains in the inventory for comparison rather than being silently
replaced in the source audit.

The OSM clubhouse wall polygon and visible roof have a several-metre positional
difference. Orthophoto roof lean can cause such a difference; neither source
alone proves the correct wall location. Use the independently acquired 2025
laser roof/ground measurements to constrain the Blender building, preserving
these orthophoto polygons as evidence rather than shifting walls to match them.

The detached northern building's dark eastern projection is especially
uncertain. Its full envelope is useful for finding the building in LiDAR and
photographs, but does not justify inventing a symmetric 11.82 m gable.

## Panels and surrounding facilities

The bundle includes `campus-overview`, `clubhouse-campus`, `clubhouse-detail`,
`north-annex-detail`, `practice-shed-detail`, `range-shelter-detail`, `range-pads`,
`padel-court`, and `parking-and-range-entrance`.

A tenth panel, `southern-construction-context`, expands the native orthophoto
around the pale rectangular surfaces clipped by the original campus window.
It covers 110.08 × 110.08 m (688 × 688 pixels) from the same 2024 tile. Its
source-mosaic evidence identifies the 13:42:14Z source photograph rather than
the clubhouse's 13:42:21Z photograph. TIFF, PNG and exact source-date coverage
are retained under `additionalSources` in the inventory. Its initial filename
`southern-maintenance-context` describes the search purpose; the buildings'
ownership and use are unconfirmed. The 2025 laser inspection separately finds
an elevated roof at the main 2024 construction surface, documenting a change
between the two source years.

Acquire that bounded extra context, then regenerate its inventory entry:

```powershell
geobuild/cache/ortho-venv/Scripts/python.exe nvgkbuild/mapping/acquire-facilities-extra-reference.py
geobuild/cache/ortho-venv/Scripts/python.exe nvgkbuild/mapping/build-facilities-ortho-reference.py
```

The retained surface traces cover twelve range mats, three observed target
surfaces, the range field, hardstanding, a practice green, terrace and padel
court. The wider panels show gravel parking, access paths and trees so these
can be placed in context. Vehicles and small portable objects are observations
of the 2024 flight, not permanent installations. Range target distances and
daily equipment positions remain unverified.

## Coordinate and accuracy rules

For original pixel-edge coordinates `(u, v)`:

```text
E = 678519.36 + 0.16 * u
N = 6988451.68 - 0.16 * v
```

Convert EPSG:3006 to EPSG:4326, then use the frozen runtime frame:

```text
x = (longitude - 18.53250) * 50568.51
z = (62.98250 - latitude) * 111320
```

Blender's horizontal plane can use `(x, -z)` with measured elevation as its
vertical coordinate. EPSG grid bearings in the inventory are undirected angles
clockwise from grid north modulo 180°. They are **not** runtime yaw values;
project the ridge endpoints to the local frame before orienting the model.

For direct Blender reference-plane setup, every `panels` record also includes
`cornersLocalXZ`, `cornersBlenderXY`, `widthMetres`, and `heightMetres`. Corners
are ordered top-left, top-right, bottom-right, bottom-left. Use those four
positions for the plane and map the image UVs to the corresponding corners;
this preserves the EPSG grid's rotation relative to true north. The image can
be enlarged in the UI while the reference plane keeps its original physical
extent. Height should be explicitly chosen as a reference-display level; an
orthophoto plane is not the surveyed terrain surface.

The manually interpreted roof envelopes have approximately 0.4–0.8 m tracing
uncertainty; this is not a statement of source absolute accuracy. Eave heights,
ridge heights, wall lines, window/door layouts and hidden facades cannot be
measured from this orthophoto. The source describes June 2024 facilities;
planned later redevelopment must remain separate from the as-photographed model.
