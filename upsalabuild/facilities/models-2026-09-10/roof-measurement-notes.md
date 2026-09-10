# Interpreted roof measurements

`roof-measurements.json` contains the current modelling estimates. Coordinates use the declared course XZ frame, and roof plane outputs are RH2000 elevations. These are interpreted laser/photo measurements, not a surveyed reconstruction.

## Clubhouse

Eight coherent plane clusters from the original 2021 laser returns match the visible 2025 roof facets and the 2026 drone photograph. The source class remains 1, unclassified; matching the roof is a reviewed interpretation. Plane fits contain 57–210 returns with 0.039–0.051 m vertical RMS. That residual is internal consistency, not absolute accuracy.

| Component | Approximate roof domain | Pitch | Ridge RH2000 | Eaves RH2000 |
|---|---|---|---|---|
| North wing | 26.10 × 13.8 m | 23.2° | 41.65–41.67 m | 38.68–38.72 m |
| West terrace wing | 20.34 × 13.6 m | 23.0–23.3° | 41.65–41.66 m | 38.72–38.77 m |
| South wing | 15.38 × 13.8 m | 23.2–23.8° | 41.64–41.67 m | 38.60–38.72 m |
| Raised crossing gable | 18.03 × 7.9 m | 38.7° | 44.16–44.20 m | 40.99–41.03 m |

Each component includes an approximate image-derived rectangular roof domain, a ridge axis constrained to the intersection of its two fitted planes, and equations in the course frame:

`heightRH2000 = a*(xCourse-originX) + b*(-zCourse+originZ) + c`

Use the minimum of the two planes inside each component domain. Where roof domains overlap, retain the highest roof surface, and remove internal walls. Roof domains are not ground-floor wall footprints. Horizontal edge interpretation allowance is 0.8 m and vertical modelling allowance is 0.35 m; overhang offsets remain unknown.

The two terrace-facing gable dormers are directly visible in the drone photo. Their approximate image positions are recorded; width 2.7 m, projection 1.8 m and rise 1.1 m above the parent roof are photo-based modelling estimates with roughly 0.6–0.7 m uncertainty. They were not resolved as independent laser planes.

## Nearby buildings

- **B02:** lower white/glazed west extension. The laser supports two approximately 23.1° facets and a ridge near 39.72 m RH2000. The apparent white cover in the photograph should not be modelled as an assumed flat roof. Its municipal outline is approximately 10.66 × 5.42 m, with the short dimension following the ridge axis.
- **B04:** red north-parking barn, approximately 16.55 × 13.10 m including a rear lean-to. The main gable is approximately 8.6 m across, 32–35°, ridge 41.98 m RH2000; the separate rear roof is approximately 8°. The main roof domain is deliberately limited to the visible main/lean-to division. A few coplanar low returns must not extend the steep roof across the lean-to.
- **B05:** small red porch house, source outline approximately 9.67 × 6.27 m. Two approximately 38–39° facets support ridge 41.40–41.49 m RH2000 and eaves around 38.8–39.0 m. The front porch is visible in the drone photo but its smaller roof was not independently resolved here.
- **B06:** dark-roof practice building. Approximately 35° main gable, ridge 43.08–43.09 m RH2000; a distinct lower side roof is approximately 14°. Its ground outline is about 15.02 × 10.46 m. The 2026 club photograph confirms the pitched form and raised deck beside the sloping ground.
- **B07:** approximately 14.68 × 2.99 m adjoining strip. Only eight interior unclassified returns were available; no stable roof plane was fitted. Treat this as deck/porch evidence associated with B06, not a second invented tall gabled building.

Auxiliary roof planes and support hulls are included. Their domain boundaries are approximate; single-plane lean-to domains use a conservative support hull expanded by 0.6 m. The ground model supplies contextual terrain samples, not finished floor levels. Do not mistake height above the DTM on sloping ground for a surveyed wall height.

## Source epochs and review

The laser campaign is March–April 2021, the authenticated native orthophoto is 14 June 2025, and the principal drone photograph is a club-published June 2026 image. Visible matching roof forms support reuse of the older planes, but additions and hidden faces remain qualified. Municipal source Z values were not used.

Ignored review images are in `upsalabuild/cache/facilities-2026-09-10/roof-study/`: `clubhouse-plane-clusters.png`, `clubhouse-roof-domains.png`, and `auxiliary-plane-clusters.png`. Each was directly inspected. The new measurements do not modify production course data or the historical reference manifests.
