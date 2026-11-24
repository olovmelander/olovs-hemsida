# Bro Hof Slott Golf Club: source research and initial intake

Research date: `2026-11-24`. This dossier records all primary geospatial,
hydrologic, elevation, imagery, scorecard, and club reference sources gathered
for **Bro Hof Slott Golf Club** (`groundId: "bro-hof"`), hosting both Robert
Trent Jones Jr. championship layouts on one shared `EPSG:5845` ground:

- **The Stadium Course** (`bro-hof-stadium`, Par 72, 5 tees)
- **The Castle Course** (`bro-hof-castle`, Par 72, 4 tees)

All raw Lantmäteriet imagery/point clouds and official club/Caddee media remain
strictly inside gitignored local caches (`brohofbuild/cache/`). Only provenance
ledgers, SHA-256 checksums, factual scorecard data, and vector derivatives enter
the repository.

## 1. Geodetic Frame & Terrain Acquisition (`EPSG:5845`)

- **Canonical Origin (sample-centre locked):**
  - `EPSG:3006` (`SWEREF 99 TM`): `E 649,094.5`, `N 6,598,568.5`
  - `WGS84` (PROJ 9.9.0): `59.49897348570647° N, 17.633748664771936° E` (`mPerLon = 56,500.89`)
  - Measured `RH 2000` at origin (Lantmäteriet 1 m DTM): **`4.7628 m`**
- **Standard 7-LOD Ring Topology (`469` tiles, `16,384 × 16,384 m` root):**
  - `LOD 0` (`1 m`, `16 × 16` = 256 tiles, `4,096 × 4,096 m`): `E 647,046.5 .. 651,142.5`, `N 6,596,520.5 .. 6,600,616.5` — encloses both 18-hole courses, Bro Hof Slott, *Puttingbanan*, driving range, and Lake Mälaren shore with `> 1,000 m` margin on every side.
  - `LOD 0..6` acquired in full via `build-ground-rings.mjs --ground bro-hof` (`geo_data/course-v2/bro-hof/acquisition/ground-rings.json`): `100.00%` finite samples across all 7 levels (`LOD 0` elevation band `0.60 .. 48.07 m RH 2000`; `16 km` root `0.13 .. 80.40 m RH 2000`).
- **10 km Lantmäteriet DTM Items & Seam Verification:**
  - All 7 levels touch the exact same four 10 km COGs: **`659_64`, `659_65`, `660_64`, `660_65`** (catalogue capture span `2010-11-06 .. 2025-06-14`, modified `2026-02-27`).
  - Measured 1 m step across **`E = 650,000`** (eastern edge of Stadium Holes 6 & 13): median `|ΔH| = 0.1000 m`, p95 `0.2300 m`, max `1.0568 m` (normal slope, zero vertical datum step).
  - Measured 1 m step across **`N = 6,600,000`** (north of Castle Course): median `|ΔH| = 0.0848 m`, p95 `0.2807 m`, max `1.7564 m` (normal slope, zero seam step).
- **Key Measured Landmarks (1 m RH 2000 DTM):**
  - Bro Hof Slott ridge ground: `13.30 m RH 2000`
  - Stadium Hole 17 Island Green: `3.61 m RH 2000`; surrounding pond: `2.71 m RH 2000` (`0.90 m` perimeter retaining wall rise)
  - Lake Mälaren open water: `0.99 m RH 2000`

## 2. Hydrology & Water Breaklines

- All four Lantmäteriet `brytgeometri.gpkg` files (`659_64`, `659_65`, `660_64`, `660_65`) downloaded, verified byte-for-byte against STAC SHA-256 digests, and clipped to the 4,096 m LOD0 square (`geo_data/course-v2/bro-hof/mapping/water-breakgeometry-epsg3006.geojson`).
- Extracted **38 3D RH 2000 water polygons** spanning Lake Mälaren bays (`0.70 .. 1.16 m`), Stadium interior ponds (`1.83 .. 2.87 m`, including the `2.71 m` Hole 17/18 lake), and upper Castle ponds (`3.56 .. 12.06 m`), retaining interior island rings.

## 3. Laserdata Skog COPC & Multi-Vintage 0.16 m RGBI Orthophotos

- **Laserdata Skog COPC (`geo_data/course-v2/bro-hof/acquisition/laser-campaigns.json`):**
  - Six 2.5 × 2.5 km tiles covering `100.00%` of the estate: `20c028` (`2020-11-06`, `3.24 returns/m²` over west/central estate) and `21c031`/`21c037`/`21c038` (`2021-03-07 .. 2021-04-18`, `2.69–3.17 returns/m²` over east/north estate).
  - Six bounded COPC microterrain & landmark targets streamed (`319,707` points total, `geo_data/course-v2/bro-hof/acquisition/microterrain-summary.json`): `bro-hof-slott` (peak `39.09 m RH 2000` over `13.30 m` ridge), `courtyard-proshop`, `driving-range`, `halfway-house-stadium`, `hole-17-island`, and `hole-18-green-shore`. Note: Lantmäteriet *Laserdata Skog* classifies buildings + canopy together as ASPRS Class 1 (unclassified), so building ridge/eave profiling clips Class 1 points inside verified footprints.
- **Lantmäteriet Ortofoto Nedladdning (`0.16 m` 4-band RGBI):**
  - Primary leaf-on campaign: **`orto-o2-2025`** (`2025-06-14T08:58:32Z`, 6 tiles, native `0.16 m` RGBI) — post-dates the 2020–2021 Stadium Hole 2 rebuild, *Puttingbanan* construction, 2023–2024 facade restoration, and 2024 Wedding Pavilion!
  - Leaf-off corroboration campaign: **`orto-o2-2021`** (`2021-04-16T13:07:06Z`, 6 tiles, native `0.16 m` RGBI) — same spring as the COPC LiDAR, ideal for bare-ground bunkers, cartpaths, stone walls, and trunk clearance beneath deciduous canopy.

## 4. OpenStreetMap Primary Intake & Geometry Gap Report

- Acquired from primary `https://overpass-api.de/api/interpreter` (`ageDays: 0`, `2026-11-24T18:37:23Z`, ODbL-1.0) into `geo_data/course-v2/bro-hof/reference/osm-{golf,context}-epsg3006.geojson`.
- Isolated Bro Hof Slott Golf Club (`relation/5509342`, `E 648,135.4 .. 650,054.9`, `N 6,597,574.5 .. 6,599,361.8`), rejecting 8 golf features belonging to neighbouring Bro Bålsta GK (`way/35935442`).
- **Baseline counts:** `17` Stadium `golf=hole` ways, `26` greens, `117` tees, `65` bunkers, `24` fairways, `12` water hazards, `56` cartpaths, `1` driving range, `3,267` surrounding context features (`way/319035128` Bro Hof Slott, `way/222073034` Bro kyrka, `way/576649595` bird watching tower).
- **Documented Gaps (resolved via 2025 0.16 m RGBI + Caddee corroboration):**
  1. **Stadium Hole 16 (`Par 3, HCP 11`)** is completely absent from OSM `golf=hole` ways — traced directly from 2025 `0.16 m` RGBI corroborated by official `stadium16.jpg` and overview map.
  2. **The Castle Course (`18 holes`)** has `0` OSM `golf=hole` ways and partial surface coverage — all 18 holes, tees, greens, bunkers, and Scottish `waste_sand` areas are extracted from 2025 `0.16 m` RGBI corroborated by `castleover_liggande.png`.
  3. **2024 Wedding Pavilion** (between Bro Hof Slott and Stadium 18th green) and **Puttingbanan** (18-hole Himalayas putting course behind Stadium 1st tee) are post-OSM additions mapped from 2025 `0.16 m` RGBI.

## 5. Official Scorecards, SGF Slope Ratings & Local Rules

29 official club/Caddee/SGF documents harvested into gitignored `brohofbuild/cache/club-sources/` (`geo_data/course-v2/bro-hof/reference/club-source-ledger.json`). Both cards passed `verify-scorecard.mjs` with zero arithmetic or permutation errors.

### The Stadium Course (`bro-hof-stadium` — Par 72: 36 Out / 36 In)

Primary source: `© Caddee Golf 2024` printed scorecard (`scorekort_bro-hof-stadium-insida.png`), cross-checked against `brohofslott.se/banor/the-stadium-course` and SGF slope PDFs (rated `2017-05-05`):

| Tee | Out (m) | In (m) | Total (m) | Men CR / Slope | Women CR / Slope |
|---|---:|---:|---:|---|---|
| **Svart** | 3,837 | 3,457 | **7,294** | Unrated (Pro) | — |
| **Vit** | 3,516 | 3,130 | **6,646** | 77.3 / 140 | — |
| **Gul** | 3,050 | 2,694 | **5,744** | 73.1 / 132 | 80.1 / 139 |
| **Blå** | 2,884 | 2,657 | **5,541** | 72.0 / 130 | 78.9 / 137 |
| **Röd** | 2,457 | 2,253 | **4,710** | 67.9 / 122 | 73.8 / 126 |

- **Reconciliation note:** All 18 pars and all 90 tee distances agree 100% between the printed 2024 Caddee scorecard and live `brohofslott.se` HTML (including Hole 10 Svart `430 m`, total `7,294 m`). The printed 2024 scorecard lists Hole 12 Index `7` and Hole 13 Index `9` (while the club HTML page swaps them as `9` and `7`); the printed 2024 scorecard is retained as authoritative.
- **2026 Local Rules:** Red penalty area left of Hole 13 is infinite; Hole 17 island green features an official drop zone for balls in the penalty area; Halfway House pause occurs after Hole 11 (also passed after Holes 4, 8, and 14); Hole 18 features Out of Bounds along the western boundary (`stadium18.jpg`).

### The Castle Course (`bro-hof-castle` — Par 72: 36 Out / 36 In; 6×Par 3, 6×Par 4, 6×Par 5)

Primary source: `© Caddee Golf 2024` printed scorecard (`scorekort_bro-hof-castle_insida.png`), 100% cell-for-cell match with `brohofslott.se/banor/the-castle-course` and SGF slope PDFs (rated `2017-05-05`):

| Tee | Out (m) | In (m) | Total (m) | Men CR / Slope | Women CR / Slope |
|---|---:|---:|---:|---|---|
| **Vit** | 3,170 | 2,963 | **6,133** | 74.2 / 145 | — |
| **Gul** | 2,855 | 2,680 | **5,535** | 71.2 / 139 | 77.6 / 144 |
| **Blå** | 2,543 | 2,480 | **5,023** | 68.9 / 133 | 74.7 / 138 |
| **Röd** | 2,111 | 2,107 | **4,218** | 65.3 / 127 | 70.1 / 128 |

- **2026 Local Rules:** Infinite red penalty areas left of Hole 1, right of Hole 1 green, and left of Hole 15; three marked drop zones for red penalty area left of Hole 5; Halfway House passed after Holes 4 and 9. Signature playable sandy `waste_sand` areas across Holes 4, 6–10, and 13–15.

## 6. Architectural & Visual Look-Dev Notes (Verified from Official Plates & Photos)

- **Bro Hof Slott:** Built 1888 by architect Herman Holmgren (baroque/empire whitewashed stucco facade with corner cupolas/towers, copper/dark-slate mansard roof, lakeside terrace overlooking Hole 18 and Lake Mälaren). Calibrated warm white stucco strictly `< 0.82` linear luminance (below `GLOW.threshold = 0.86`).
- **Stadium Bunkers:** Crushed white marble (`marmorkross`) with deep sculpted faces and interior grass islands (`innerRings`) — calibrated below bloom glare across all 10 lighting presets.
- **Water Retaining Walls / Bulkheads (`infra.bulkheads`):** Official Caddee plates (`stadium17.jpg`, `stadium18.jpg`) confirm **stacked stone/granite masonry walls** encircling the 17th island green + cobbled stone access causeway AND retaining the 18th fairway/green shoreline, alongside timber/stone hazard revetments across Holes 9, 11, 13, 15, and 16 (verified against 2025 `0.16 m` RGBI).
