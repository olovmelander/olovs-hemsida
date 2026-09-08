# Upsala source review, 7 September 2026

The municipality's public primary map supplies a substantial new source of
measured objects at **Upsala GK, Håmö Gård, Läby**. This is not Uppsala Golf in
Uppsala-Näs. Existing reviewed golf surfaces were preserved during this research.

[Machine-readable inventory](source-inventory-2026-09-07.json) records exact
requests, retrieval dates, response hashes, coordinate systems and exclusions.
[Object evidence](municipal-objects-2026-09-07.json) contains 83 reviewed source
records, complete source geometry, explicit local geometry, nearby existing
objects and the source-image comparison hashes. The separate
[GeoJSON](municipal-objects-2026-09-07.geojson) contains these observations plus
148 road-side lines, **231 records total**. These are observations with different
acceptance decisions, not 231 automatically added rendered objects.

The final application adds **24 model observations**: four drainage lines and
19 boundary lines available through GIS/the review viewer, plus one rendered
horizontal bridge footprint. No ditch channel, water body, fence height or wall
thickness is invented. Nine existing streams receive source corroboration with
their continuous geometry unchanged. The 50 tree observations remain separate
from the rendered crown population. Each source feature carries explicit
`appAdoptionStatus` and `renderStatus` metadata; surrounding-context scope is
preserved and does not imply golf-club ownership.
Six road-edge observations also identify their contribution to the separately
reviewed [practice-path polygon](practice-path-review-2026-09-07.md); the original
open lines remain available for comparison and are not themselves filled.

## Municipal survey data

The source is the public [primary-map service](https://kartportal.uppsala.se/mapping/rest/services/nPlanBygg/Bygglov_Primarkarta_utskrift/MapServer).
Its native horizontal CRS is EPSG:3011. Queries requested EPSG:3006 for the
window `[639100,6635100,641200,6637200]`. Intersecting features can extend beyond
that envelope. Their presence does not establish ownership by the golf club.

| Layer | Returned records | Review and intended use |
| --- | ---: | --- |
| 6278, road-side lines | 148 | Keep open edges as observations. 120 have usable recorded methods and accuracy for further review. Exclude 27 unknown 50 m “other” lines and one unknown 50 m footway from precise placement. |
| 564, ditches | 13 | Three missing course segments and one surrounding-context segment have network RTK evidence. Nine others corroborate existing drainage corridors; preserve those continuous OSM networks. |
| 570, boundaries | 19 | Surveyed fences, screens, walls, retaining walls and hedges. Five are surrounding context. Heights, thicknesses and materials remain unmeasured. |
| 571, bridge area | 1 | Polygon 64915 fits a visible southern track crossing; no duplicate among the three previously reviewed bridges. Layer 568/111560 is the same object's line representation. |
| 562, tree points | 50 | 32 broadleaf and 18 conifer observations, with reported 0.1 m plan accuracy. Keep separate from LiDAR crowns and OSM tree points until identity is resolved. No botanical species inferred. |
| 6292 / 6291, ground / street elevations | 292 / 66 | Potential independent terrain comparisons. Heights have individual method, accuracy and original height-system codes. |
| 6287 / 6289, plinth / finished-floor elevations | 25 / 10 | Building-related elevations, not building height above ground. |
| 6288, roof-ridge elevations | 0 | No ridge measurements returned in this window. |
| 513 / 514, plan / height control points | 23 / 3 | Potential independent controls; inspect monument descriptions and status first. |
| 6179890, buildings | 145 | Mixed ages and methods. Preserve existing accepted footprints unless a specific newer record improves them. |
| 563, land-edge lines | 32 | Generic “other land” edges do not establish mowing class or grass height. |
| 575, electrical objects | 2 | Both report 10 m plan accuracy despite a network RTK method code; unsuitable for exact equipment placement. |

All reviewed object records report source status `3` (existing). Method `109`
means network RTK; `101` means total station; `324` means screen digitisation
from orthophotography. **Database registration and modification dates are not
independently known survey dates.** Many records were registered in May 2026,
after the 2025 imagery. This is recorded, not used as a reason to discard a
valid survey. Source accuracy describes that record and does not certify the
entire app's absolute geographic accuracy.

Thirty-six georeferenced comparison panels were inspected. Two extra small
orthophoto windows were acquired for features beyond the earlier cached imagery;
both flight-year rasters visibly identify 2025. Raw panels, imagery, metadata and
PDFs remain under `upsalabuild/cache/review-2026-09-07/source-inventory/`.

The [municipal tree database](https://kartportal.uppsala.se/mapping/rest/services/nParkNatur/Traddatabas_utan_fallda_trad/MapServer/0)
and [park furniture inventory](https://kartportal.uppsala.se/mapping/rest/services/nParkNatur/Inventering_parkmobler_titta/FeatureServer/2)
both returned zero records here. That means neither inventory covers the needed
objects in this window; it does not mean the objects are absent. Five
[nature-value areas](https://kartportal.uppsala.se/mapping/rest/services/iExternaKartan/Miljo/MapServer/27)
provide regional context, not current fairway/rough boundaries or species points.

## Practice-area survey report

The [Upplandsmuseet report 2024:23](https://www.upplandsmuseet.se/globalassets/publikationer/rapportserien/rapporter-2024/2024_23-gravfalt-och-boplatser_web.pdf)
is a primary fieldwork source commissioned for the club's practice-area project.
Pages 9–11 show a ground photograph and mapped greens, bunkers, exposed bedrock,
access paths, utilities and a sprinkler well. Page 11 identifies GPS/network RTK;
page 20 gives SWEREF99 TM and RH2000. The report inconsistently calls the fieldwork
April and May; the club announcement specifies 13–17 May 2024.

Figure 5's printed control labels do not support a trustworthy direct pixel
transformation: the two northing labels differ by 80 m, while their graphic
separation is about 99 m using the scale bar. Preserve the report for feature
identity and request its original survey geometry before using it as a control.
Do not turn archaeological excavation trenches, construction ropes or soil heaps
into permanent modern objects. Ancient oak/spruce charcoal is not evidence of
living tree species. The report states CC BY except indicated material; the
basemap has a separate copyright attribution.

## Confirmed 2026 facility change, still missing exact placement

The club's [service-house announcement](https://upsalagk.se/news/nytt-servicehus-2026/)
describes demolition of the old kiosk and toilet building beginning 3 March 2026.
It includes a dimensioned 7.2 × 6.4 m plan for a 46 m² replacement and directional
elevations. The [opening report](https://upsalagk.se/news/halfway-house-smygoppnat-2026/)
confirms operation from 14 May 2026. These establish the new facility's identity.

An exact, verified as-built footprint was not found. Municipal record 1512570
is a 371 m² cartographic rectangle with 10 m accuracy; record 1520169 is only
8.14 m². Neither can be labelled as the new house. The announcement's exterior
illustration is a marketing rendering, the opening photograph is indoors, and
the inauguration image is generic scissors. None supplies geographic control.

The [2024 practice-area announcement](https://upsalagk.se/news/vi-bygger-nytt-2024/),
[summer 2025 update](https://upsalagk.se/news/medlemsinformation-sommar-2025/) and
[August 2026 update](https://upsalagk.se/news/klubbchefsbrev-maj-2026-2-2/) describe
plans and continuing work. They do not prove the proposed merging of two
practice greens was completed. Retain the accepted 2025 outlines.

## Reproduce and continue

Run `node geobuild/acquire-upsala-survey.mjs`. It performs only public read
requests, verifies complete responses and saves the exact metadata/query bytes
and hashes beneath the ignored cache. Use `--out` for another cache directory
and `--layers 562,564,570,571,6278` for a narrower refresh. Changed responses
require a new review; never silently replace accepted geometry with a live feed.

For integration, copy only deliberate local geometry and scalar provenance into
the runtime model. Keep source coordinates and nearest-object research in these
evidence files. Preserve the three existing bridge decks and nine corroborated
drainage corridors. Store trees as a distinct survey observation class: proximity
to a crown does not prove identity, and a crown centre is not a surveyed stem.

The highest remaining evidence gap is a georeferenced 2026 as-built plan for the
service house, followed by the club's actual drainage/irrigation and equipment
inventory. Small-object dimensions, botanical species, seasonal grass classes,
hidden current tee edges and survey completeness remain explicit open work.
