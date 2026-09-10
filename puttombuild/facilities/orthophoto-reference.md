# Puttom facility orthophoto reference — 2026-09-10

Five georeferenced native-pixel panels now cover the clubhouse, western lakeside
plots, range, parking and maintenance yard. Source imagery is Lantmäteriet
`orto-u2-2024`, captured **2024-06-27**, with **0.16 m** RGBI pixels in
**EPSG:3006**. This is the latest complete campaign found in the official catalogue
search recorded on 2026-09-09 in `../mapping/lm-ortho-discovery.json`; it is not a
new 2026 photograph. Attribution: Lantmäteriet, CC BY 4.0. Delivery access terms
are separate from the source attribution and from publishing aerial texture assets.

The reference pixels were reused from the hash-verified local windows under
`../cache/lm-ortho/`. No resampling, new acquisition or new authentication was
needed. Each panel provides a four-band GeoTIFF, RGB PNG, PNG worldfile and EPSG
projection WKT. TIFF/PNG hashes, exact source hashes, pixel-edge bounds and Blender
corner coordinates are in [orthophoto-reference.json](orthophoto-reference.json).
Raw files are in `../cache/facilities-reference-2026-09-10/ortho/` and remain
Git-ignored. PNGs are suitable for local Blender reference planes; the TIFFs retain
the infrared band for analysis.

| Panel | Coverage | Native PNG dimensions |
| --- | --- | --- |
| `facilities-overview` | Whole facility neighborhood, range, parking and practice context | 2782 × 2251 |
| `clubhouse-courtyard` | Main clubhouse, long west wing, connector, lower west roof, detached north building and camper edge | 501 × 625 |
| `western-cabins` | Lakeside context houses, pavilion candidate and southern shed candidates | 532 × 657 |
| `range-buildings` | L-shaped building, three detached huts/buildings, hitting apron and mats | 876 × 719 |
| `maintenance-yard` | Three main service roofs, yard and southeast attachment candidate | 626 × 719 |

Use each `*-review-overlay.png` to compare **amber inherited model rings**, **cyan
observed apparent roof edges**, and **magenta nonbuilding observations**. These
annotations are reference evidence, not accepted wall footprints. An optional
`*-inspection-2x.png` is a nearest-neighbor viewing aid; it is not georeferenced
native-resolution evidence and adds no detail.

## Coordinate contract

The Blender horizontal origin is **E 697365, N 7025190**, in metres. Blender X is
east, Y is grid north, Z is up. Vertical placement is defined separately by the
laser reference package; there is no height in an orthophoto worldfile.

The course model's inherited x/z coordinates must first be inverted through
`lon = 18.9413 + x / 50019.58`, `lat = 63.2992 - z / 111320`, then transformed
from EPSG:4326 to EPSG:3006. Adding x/z directly to a projected origin produces
the previously documented approximately 3.5-degree orientation error.

Worldfiles describe pixel **centres**. PNG bounds describe pixel **edges**. Manual
pixel annotations use continuous coordinates from the top-left image edge:
`E = minE + u × 0.16`, `N = maxN - v × 0.16`. The inventory stores projected,
Blender and legacy-local coordinates for each observed roof.

## Inventory and modelling implications

[facility-inventory.json](facility-inventory.json) contains all **40 inherited
building records**, including **17 on-site trace pieces** and **23 surrounding
OSM buildings**. The latter are included for completeness but are outside these
close-up panels and were not revalidated here. Club ownership and purpose of the
western lakeside houses are unverified; they must not all be called club facilities.

The canonical `roofObservations[]` array holds **20 deduplicated roof/canopy
observations**. Seven are components/candidates missing as separate inherited
records. This is not a verified count of physical buildings. Two inherited
annex pieces correspond to one continuous long west wing, and the two inherited
range arms correspond to one L-shaped roof. `facilities[].observedRoof` links to
the canonical physical roof ID and retains every original ID.

The clubhouse has a principal gabled roof, a lower roof along its west side,
a transverse connector and a long narrow western wing. Official historical
obliques `flickr-34163074006.jpg` and `flickr-34163073056.jpg` corroborate that
assembly and the glazed south gable. The existing clubhouse outline reaches
about 4–6 metres north into courtyard paving, as previously noted in
`../mapping/review-infrastructure.json`. Apparent roof outlines can themselves be
displaced from the ground by image relief effects. Preserve image observations
and 2023 laser support as separate evidence until reconciled.

The range L-shaped roof extends materially beyond the inherited eastern arm.
The southern maintenance hall's inherited outline includes a gravel apron:
the visible roof has roughly half the inherited north–south extent. Small western
service and range buildings also have orientation/extent differences. These are
clear reasons to replace simple inherited rectangles with photo- and laser-informed
assemblies when authoring final assets.

Two inherited southern lakeside sheds (`trace-shed-c`, `trace-shed-d`) remain
unmatched or occluded. New lake pavilion, small southern dark shed, small rust roof,
light conservatory/canopy and maintenance lean-to observations are explicitly
labelled by confidence. A possible roof is not enough evidence for a permanent
building or its function.

`nonBuildingFacilities[]` includes **15 records**: inherited parking, camper area,
court/cart strip, practice greens/bunker, range boundary and net alignment, plus
new observations of the curved hitting apron, **17 distinguishable green mat
centres**, terrace/stair area and camper boundary fence. Seventeen is a visible
mat count in this image, not a certified total range capacity. Inherited net
height and coarse representative bay anchors remain estimates.

`unlocatedFacilities[]` records the pump house and juniorstuga as unlocated,
plus missing measured wall footprints, entrances and net heights. Do not assign
those names to nearby roofs without labelled photographs or a club site-plan anchor.

## Reproduction

From the repository root, use the existing geospatial Python environment:

```powershell
geobuild/cache/ortho-venv/Scripts/python.exe puttombuild/facilities/prepare-ortho-reference.py
geobuild/cache/ortho-venv/Scripts/python.exe puttombuild/facilities/prepare-ortho-inventory.py
```

The first script recreates native imagery, source ledgers and inherited placements.
The second applies the explicitly recorded pixel observations in
[orthophoto-reference.observations.json](orthophoto-reference.observations.json)
and generates annotated review panels. Both leave the course model and runtime
assets untouched. Positional accuracy, as-built dates and wall/eave boundaries
are not established by 16 cm pixel spacing or internal plane-fit residuals.
