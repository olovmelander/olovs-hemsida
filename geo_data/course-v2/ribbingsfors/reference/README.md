# Ribbingsfors reference evidence

This directory contains normalized, non-runtime evidence for the first
Ribbingsfors reconstruction pass. It deliberately does **not** approve a
canonical origin, a played-surface boundary, a tree object registry or any
build output.

## Contents

| File | Features | Source and licence | Authority/use |
|---|---:|---|---|
| `osm-course-boundary.geojson` | 1 polygon | OpenStreetMap way [779352687](https://www.openstreetmap.org/way/779352687), © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) | Tier D, coarse extent/context only |
| `protected-trees-250m.geojson` | 88 points | Länsstyrelsen Västra Götalands län, *LstO Skyddsvärda Träd*, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | Tier C, individual-tree evidence pending recency and position checks |
| `provenance.json` | — | Immutable source snapshot identifiers, hashes, filters and checks | Audit/control document |

The two licensed datasets are kept in separate GeoJSON files so
OpenStreetMap's ODbL lineage is not blurred with the county inventory's CC0
lineage. Preserve the OSM attribution anywhere its geometry is used.

## Coordinate and selection contract

GeoJSON geometries follow RFC 7946/OGC:CRS84 order: `[longitude, latitude]`.
The complete OSM boundary is additionally retained as an `EPSG:3006` polygon
in `properties.geometryEpsg3006`. Every protected-tree feature retains the
source `eastingEpsg3006` and `northingEpsg3006` values; its WGS84 point is a
deterministic projection of those values.

The provisional 2,048 × 2,048 m evidence envelope is:

- CRS/axis order: `EPSG:3006`, easting then northing
- centre: `[448975.5, 6536024.5]`
- upper-left origin: `[447951.5, 6537048.5]`
- bbox: `[447951.5, 6535000.5, 449999.5, 6537048.5]`

This is a source-efficient acquisition envelope, not approved survey control.
It contains the full OSM boundary and all 88 selected tree records. Tree
selection uses planar minimum distance in EPSG:3006: `distance to OSM polygon
<= 250 m`, followed by a full-envelope containment check. Counts are
cumulative: 4 lie inside the polygon, 20 within 25 m, 33 within 50 m, 50
within 100 m and 88 within 250 m.

## Authority tiers and safe use

- **Tier A** is independent controlled survey evidence and is required for the
  final canonical frame and play-critical geometry.
- **Tier B** is authoritative national measurement data suitable as a
  candidate base after checksum, coverage and residual checks.
- **Tier C** is measured or inventoried supporting evidence. The protected-tree
  points belong here: their biological attributes are unusually valuable, but
  the selected observations date from 2005 or 2008, and the source metadata
  gives no uniform numeric position accuracy for individual points.
- **Tier D** is supplemental context. The OSM way has only
  `leisure=golf_course`; it has no tee, green, fairway, bunker or hole-routing
  geometry and no survey-accuracy statement.
- **Tier E** is legacy/inferred comparison material and is not present in
  these normalized inputs.

Do not publish the 88 points directly as live trees. First reconcile each
against the 2023 Lantmäteriet laser campaign, the 2024 orthophoto and—where it
affects play or a signature view—site/control evidence. A missing current
return or crown is a review signal, not automatic proof of felling.

## Provenance and normalization

The raw snapshots stay outside git. `provenance.json` pins their download URLs,
fetch times, byte sizes and SHA-256 values, plus the hashes of the GeoPackage,
ISO metadata XML and alias CSV used from the county ZIP. The source OSM
response is the official `way/full` JSON, preserving way version, changeset
and edit timestamp. The county GeoPackage declares EPSG:3006; normalization
verified that every selected record's GeoPackage point envelope agrees with
its exported coordinate fields within 0.051 mm. The higher-precision exported
coordinate values are retained.

Source field mapping used in the tree GeoJSON:

| Normalized property | Source field |
|---|---|
| `sourceObjectId` | `OBJECTID` |
| `sourceTreeNumber` | `TRADNR` |
| `sourceTreeId` | `TRADID` |
| `speciesSv` | `TRADSLAG` |
| `circumferenceCm` | `OMKRETS` |
| `giantTreeSv` | `JATTETRAD` |
| `hollowTreeSv`, `hollowStageSv` | `HALTRAD`, `HALSTADIUM` |
| `redListedSpeciesSv`, `indicatorSpeciesSv` | `HOTART`, `SIGNALART` |
| `pollardedSv`, `vitalitySv` | `HAMLAT`, `VITALITET` |
| `recommendedActionSv`, `threatSv` | `INSATS`, `HOTBILD` |
| `inventoryDate` | date part of `INVDATUM` |
| `eastingEpsg3006`, `northingEpsg3006` | exported `X_KOORD`, `Y_KOORD`, cross-checked against GeoPackage geometry |

Dataset catalogue: [Länsstyrelsernas Geodatakatalog](https://ext-geodatakatalog-forv.lansstyrelsen.se/PlaneringsKatalogen/GetMetaDataById?id=97d7c820-f382-458c-aeb8-89ca6a519f34_C).
OpenStreetMap attribution: [copyright and licence](https://www.openstreetmap.org/copyright).
