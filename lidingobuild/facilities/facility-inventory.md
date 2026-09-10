# Lidingö facilities reference inventory

This package inventories **34 mapped physical features** and **16 unresolved facility/detail groups**. Five buildings have dated supported roof meshes; this is an evidence pack and editable-model starting point, not a complete surveyed facility model.

Coordinates use EPSG:3006 and RH2000. Blender origin is E 677700.5, N 6586399.5, H 25 m; X points east, Y north and Z up. One unit is one metre.

The [JSON inventory](facility-inventory.json) preserves exact geometry, IDs, bounds, source hashes, height evidence and unknowns. Its numbered overlay is private at `lidingobuild/cache/facilities-reference-2026-09-10/ortho/facilities-inventory-overlay.png`.

| Overlay | Exact feature/footprint ID | Physical feature | Evidence / remaining work |
| ---: | --- | --- | --- |
| 1 | `way/32262183` | Restaurant/reception building (north clubhouse) | 2021 roof 33.50–40.80 m RH2000; 89.75% supported. Eaves/facades unmeasured. |
| 2 | `way/32262176` | Lower clubhouse courtyard pavilion | 2021 roof 32.19–34.06 m RH2000; 92.28% supported. Eaves/facades unmeasured. |
| 3 | `way/32262169` | South clubhouse annex | 2021 roof 31.43–32.11 m RH2000; 100.00% supported. Eaves/facades unmeasured. |
| 4 | `way/26408210` | West range-side barn/building | 2021 roof 25.17–35.87 m RH2000; 99.84% supported. Eaves/facades unmeasured. |
| 5 | `way/26408211` | East range-road barn/building | 2021 roof 24.48–33.32 m RH2000; 99.92% supported. Eaves/facades unmeasured. |
| 6 | `way/221846983` | Small range-side utility building candidate | insufficient planar support; roof withheld |
| 7 | `way/40895787` | Small building beside south practice area | not established |
| 8 | `lidingo-courtyard-putting-green-2019` | Puttinggreen vid klubbhuset | retained source geometry; not surveyed; no 2025 retrace performed |
| 9 | `lidingo-courtyard-hardstanding-2019` | courtyard hardstanding 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 10 | `lidingo-clubhouse-parking-2019` | clubhouse parking 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 11 | `lidingo-upper-parking-north-2019` | upper parking north 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 12 | `lidingo-upper-parking-south-2019` | upper parking south 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 13 | `lidingo-range-field-2019` | range field 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 14 | `lidingo-range-north-platform-2019` | range north platform 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 15 | `lidingo-range-south-platform-2019` | range south platform 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 16 | `lidingo-range-east-platform-north-2019` | range east platform north 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 17 | `lidingo-range-east-platform-south-2019` | range east platform south 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 18 | `lidingo-range-target-green-2019` | range target green 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 19 | `lidingo-range-east-access-2019` | range east access 2019 | retained source geometry; not surveyed; no 2025 retrace performed |
| 20 | `lidingo-clubhouse-practice-green-osm` | Stora puttinggreenen | retained source geometry; not surveyed; no 2025 retrace performed |
| 21 | `lidingo-south-practice-green-osm` | Övningsgreen söder om rangen | retained source geometry; not surveyed; no 2025 retrace performed |
| 22 | `way/32428950` | Northwest overflow parking candidate | retained source geometry; not surveyed; no 2025 retrace performed |
| 23 | `way/52583105` | South range-road parking | retained source geometry; not surveyed; no 2025 retrace performed |
| 24 | `way/32428969` | Upper parking aisle east | retained source geometry; not surveyed; no 2025 retrace performed |
| 25 | `way/32428972` | Upper parking aisle west | retained source geometry; not surveyed; no 2025 retrace performed |
| 26 | `way/41197227` | South range service access | retained source geometry; not surveyed; no 2025 retrace performed |
| 27 | `way/221846977` | East range service path | retained source geometry; not surveyed; no 2025 retrace performed |
| 28 | `way/79550926` | North clubhouse service access | retained source geometry; not surveyed; no 2025 retrace performed |
| 29 | `way/427426698` | Clubhouse parking approach | retained source geometry; not surveyed; no 2025 retrace performed |
| 30 | `way/427426716` | Clubhouse one-way service approach | retained source geometry; not surveyed; no 2025 retrace performed |
| 31 | `way/427429857` | Courtyard gravel footway | retained source geometry; not surveyed; no 2025 retrace performed |
| 32 | `way/836722128` | South range parking aisle | retained source geometry; not surveyed; no 2025 retrace performed |
| 33 | `way/221846979` | Upper parking paved footway | retained source geometry; not surveyed; no 2025 retrace performed |
| 34 | `way/52583080` | West driving-range fence/net alignment | retained source geometry; not surveyed; no 2025 retrace performed |

## Facilities and details still needing geometry or identity evidence

Search rectangles in the JSON are deliberately not building footprints. Public use descriptions do not by themselves identify a mapped building.

| Facility/detail | Evidence | Required follow-up |
| --- | --- | --- |
| North range covered tee structure | `range-north-detail-lm-2025` | Wall/roof footprint not traced; Eaves/ridge heights; Mat and bay count; Side elevations |
| South range covered tee structure | `range-south-detail-lm-2025` | Wall/roof footprint not traced; Eaves/ridge heights; Supports and net connections; Facade photos |
| Putting green northeast of restaurant terrace | `clubhouse-detail-lm-2025` | Current ring not traced; Reconcile with generic playing greens to prevent duplicate geometry |
| South target green within range field | `range-south-detail-lm-2025` | Exact ring; Target equipment and distances |
| Tiered timber terrace, stairs, rails, entry wall/pillars | `clubhouse-detail-lm-2025`, `docs/courses/lidingo-clubhouse-appearance.md`, [club source](https://www.lidingogk.se/nyheter/vikingaskeppet-6-7-juli/) | Precise deck outlines and elevations; Rail spacing; Stair rise/run; Entrance details and facade dimensions |
| East range netting, masts, mats and equipment | `facilities-overview-lm-2025`, [club source](https://www.lidingogk.se/trana/rangen-ovningsomraden/) | Current mast base coordinates and heights; Net runs and cable connections; Exact mat count; Locate photographed red hut before joining to way/221846983 or another structure |
| New practice area by upper parking | [club source](https://www.lidingogk.se/trana/rangen-ovningsomraden/), `upper-parking-detail-lm-2025` | Current as-built extent; Construction/completion date relative to 2025-05-31; Detailed bunker/green rings |
| Chipping and bunker practice south of range | [club source](https://www.lidingogk.se/trana/rangen-ovningsomraden/), `range-south-detail-lm-2025` | Full group boundary; Practice bunker and apron joins to generic golf-surface data; Current markers and equipment |
| Practice green at old hole 17 | [club source](https://www.lidingogk.se/trana/rangen-ovningsomraden/) | Geolocate historical hole 17; do not assume current hole 17 coordinates; Dedicated ortho crop and current dimensions |
| Kiosk between holes 9 and 10 | [club source](https://www.lidingogk.se/gaster/) | Exact footprint and coordinate; Exterior photos; Roof/wall dimensions; Current associated seating/paths |
| Maintenance, golf-cart/equipment and conference premises | [club source](https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf) | Join historical B2/B3/B4 and Västra Ladan labels to exact current footprints; Current room uses and exterior alterations |
| Starter hut outside B4 | [club source](https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf) | Identify B4 footprint; Hut coordinates and roof/wall footprint; Current exterior photos and height |
| B4/east-barn toilets, club washing and water points | [club source](https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf) | Exact B3/B4 and east-barn facade joins; Door positions, sinks, water point dimensions; Current condition; potable-water status not established |
| Toilet by tee 15 | [club source](https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf) | Exact coordinate and footprint; Exterior and roof height; Dedicated orthophoto crop |
| Electric vehicle charging bays by bag store | [club source](https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf) | Join bag store to exact footprint and side; Charger positions, models and markings; Current capacity |
| Indoor hitting bays in east barn upper floor | [club source](https://www.lidingogk.se/media/xiogpfrw/lgk-90-%C3%A5r-2023-05-23.pdf) | Confirm east barn footprint-ID association; Current exterior openings and bay arrangement; Current use and number of bays |

## Dates and interpretation

The orthophotos show 31 May 2025. Existing facility traces show 2019; the retained laser roof evidence was captured 23 March 2021. The September 2026 OSM retrieval date does not make every source footprint current. Five display buildings already have estimated architectural detail; unsupported laser regions and estimated facades must remain distinguishable from measurements.

The north restaurant, lower pavilion and south annex are separate buildings. OSM labels the pavilion footprint `way/32262176` with the club name, while existing photo-based architecture associates the restaurant/reception with `way/32262183`. Range-side barns and the small southern building must keep uncertain uses explicit.

The native orthophoto visibly contains additional covered tee structures and a third clubhouse putting green absent from the fourteen retained facility polygons. The inventory records these gaps without silently generating substitute geometry.

For source photographs, see [web-reference.json](web-reference.json). For registered imagery, see [orthophoto-reference.md](orthophoto-reference.md).
