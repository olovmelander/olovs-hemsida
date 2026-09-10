# Lidingö facility implementation coverage

This register reconciles the original [34 mapped features and 16 unresolved groups](facility-inventory.json) with **21 authored facility groups**, the course's retained surface/path rendering, and remaining evidence gaps. An authored group is a scene parent, not necessarily a separate building. The 21 groups comprise seven replacements of exact source building IDs, six additional roofed structures/canopies, and eight courtyard, equipment, net or marking groups.

The authoritative exported group list is the [runtime manifest](../../apps/golf/public/models/lidingo/facilities-v1.json). Export and browser status belong to [production validation](production-validation.json) and [environment validation](environment-validation.json); this document describes implementation coverage and does not replace those checks. The two final ancillary IDs are `cafe-9` and `toilet-15`.

## Authored groups

| Authored ID | Physical coverage | Evidence boundary |
| --- | --- | --- |
| `clubhouse-restaurant` | North restaurant/reception building, balcony, awnings, glazing and roof details | Exact `way/32262183` source association and retained roof envelope; facade detail is photo-informed |
| `clubhouse-pavilion` | Lower courtyard pavilion and east veranda/stairs | Exact `way/32262176`; veranda/facade dimensions are display estimates |
| `clubhouse-annex` | South annex with modest glazed porch | Exact `way/32262169`; current room use unassigned |
| `courtyard` | Tiered terrace, stairs, balustrades and sparse furniture | Photo-informed appearance; retained display elevations, not new survey levels |
| `clubhouse-green-kerb-and-rope` | Kerb and rope around courtyard putting green | Retained green ring; this adds no new practice-green surface |
| `clubhouse-courtyard-entrance` | White entrance wall and pillars | Photo-informed dimensions and ornament approximations |
| `range-west-barn` | Red west barn, dark roof, siding and restrained openings | Exact `way/26408210`; measured-envelope display geometry retained |
| `range-east-barn` | Red east barn, dark roof, doors and sparse windows | Exact `way/26408211`; internal hitting-bay arrangement not modeled |
| `range-side-small-shed` | Small building beside range road | Exact `way/221846983`; appearance/height estimated, function unverified |
| `south-practice-small-building` | Small building beside southern practice area | Exact `way/40895787`; ownership/use unverified; not labeled toilet or kiosk |
| `range-north-covered-bays` | North tee canopy and estimated covered bays | Actual 2025 roof trace; eave/support dimensions estimated |
| `range-south-covered-bays` | South range shelter and estimated covered bays | Actual 2025 roof trace; hidden support/bay count estimated |
| `range-north-ball-hut` | Separate red hut, dispenser appearance and nearby bin/planter | Actual roof trace plus club photo; machine/fixture details estimated |
| `range-south-shelter-end-hut` | Small east-end shelter enclosure | Actual roof trace; function unverified |
| `range-north-open-mats` | Eight exposed mats, trays and low dividers | Visible positions traced individually; tree-occluded positions omitted |
| `range-south-open-mats` | Ten exposed mats, trays and low dividers | Visible positions traced individually; dimensions estimated |
| `range-west-safety-net` | West net, poles and open wire strands | OSM alignment with north-end canopy correction; height/pitch estimated |
| `range-road-safety-net` | Road-side range net, poles and sparse truss detail | Approximate visual alignment; height and fine weave estimated |
| `upper-parking-central-markings` | Central double bank of parking paint | Visible 2025 endpoints; repeated divider spacing regularized; paving untouched |
| `cafe-9` | Café 9 kiosk main volume and covered sales-area appearance | New guide/orthophoto location agreement; roof trace, estimated facade/heights; no matching OSM building ID |
| `toilet-15` | Small toilet/water-point facility at tee 15 | New guide/orthophoto location agreement; roof trace, estimated facade/heights; no matching OSM building ID |

The source [range layout](authored-layout.json) records the original canopy/hut/mat traces; [ancillary location evidence](ancillary-location-review.json) records the two later outlying buildings. Photo pixels and orthophoto textures are not exported into application assets.

## All 34 original mapped features

**Authored replacement** means the corresponding old building geometry is suppressed when the facility asset loads. **Retained surface/path** means the original course surface or centreline remains the runtime owner; it was not rebuilt as a second Blender surface. Source path widths are still generic rendering widths where OSM has no measured width.

| Original feature ID | Implementation owner | Status / remaining limit |
| --- | --- | --- |
| `way/32262183` | `clubhouse-restaurant` | Authored replacement; roof evidence retained separately |
| `way/32262176` | `clubhouse-pavilion` | Authored replacement; source club-name tag does not relocate the restaurant here |
| `way/32262169` | `clubhouse-annex` | Authored replacement; room use unverified |
| `way/26408210` | `range-west-barn` | Authored replacement; exact source ID |
| `way/26408211` | `range-east-barn` | Authored replacement; exact source ID |
| `way/221846983` | `range-side-small-shed` | Authored replacement; no supported source roof height |
| `way/40895787` | `south-practice-small-building` | Authored replacement; no confirmed club use |
| `lidingo-courtyard-putting-green-2019` | `scenery.mappedFeatures` plus `clubhouse-green-kerb-and-rope` | Retained green surface; authored edge detail |
| `lidingo-courtyard-hardstanding-2019` | `scenery.mappedFeatures` | Retained paving with turf island; appearance uses asphalt |
| `lidingo-clubhouse-parking-2019` | `infra.parking` | Retained parking polygon; no inferred cars |
| `lidingo-upper-parking-north-2019` | `infra.parking` plus central marking group | Retained historical surface; 2025 paint does not update its boundary |
| `lidingo-upper-parking-south-2019` | `infra.parking` plus central marking group | Retained historical surface; 2025 paint does not update its boundary |
| `lidingo-range-field-2019` | `scenery.range` | Retained range grass surface |
| `lidingo-range-north-platform-2019` | `scenery.mappedFeatures`, north canopy/mat groups | Retained apron; authored canopy, mats and details |
| `lidingo-range-south-platform-2019` | `scenery.mappedFeatures`, south canopy/mat groups | Retained apron; authored canopy, mats and details |
| `lidingo-range-east-platform-north-2019` | `scenery.mappedFeatures` | Retained turf strip; no separately verified equipment placement |
| `lidingo-range-east-platform-south-2019` | `scenery.mappedFeatures` | Retained turf strip; no separately verified equipment placement |
| `lidingo-range-target-green-2019` | `scenery.mappedFeatures` | Retained central target green; separate southern target remains a gap |
| `lidingo-range-east-access-2019` | `scenery.mappedFeatures` | Retained service hardstanding |
| `lidingo-clubhouse-practice-green-osm` | `scenery.mappedFeatures` | Retained southeastern pavilion putting green (`way/296422967`) |
| `lidingo-south-practice-green-osm` | `scenery.mappedFeatures` | Retained southern practice green (`way/221846981`); surrounding practice complex incomplete |
| `way/32428950` | `infra.parking` | Retained northwest overflow parking; no new full stall reconstruction |
| `way/52583105` | `infra.parking` | Retained southern parking; tree-covered stalls not invented |
| `way/32428969` | `infra.roads` | Retained upper-parking aisle centreline |
| `way/32428972` | `infra.roads` | Retained upper-parking aisle centreline |
| `way/41197227` | `infra.roads` | Retained south-range service centreline |
| `way/221846977` | `infra.roads` | Retained east-range service centreline |
| `way/79550926` | `infra.roads` | Retained north-clubhouse service centreline |
| `way/427426698` | `infra.roads` | Retained clubhouse approach centreline |
| `way/427426716` | `infra.roads` | Retained clubhouse service centreline; no new access-rule verification |
| `way/427429857` | `infra.paths` | Retained courtyard gravel footway centreline |
| `way/836722128` | `infra.roads` | Retained southern parking aisle centreline |
| `way/221846979` | `infra.paths` | Retained upper-parking paved footway centreline |
| `way/52583080` | `range-west-safety-net` | Authored net uses this source alignment, with its northern endpoint moved clear of the traced canopy; source line remains unchanged in evidence |

Thus every original mapped feature has either an authored replacement/detail association or a retained runtime owner. That statement does **not** mean all subsequently observed facilities or every current boundary has been reconstructed.

## All 16 original unresolved groups

| Original group ID | Result | Remaining work or evidence boundary |
| --- | --- | --- |
| `north-range-covered-tee-structure` | Modeled as `range-north-covered-bays` | True roof trace replaces the search rectangle; height/support count estimated |
| `south-range-covered-tee-structure` | Modeled as `range-south-covered-bays` | True roof trace replaces the search rectangle; height/support count estimated |
| `restaurant-terrace-putting-green` | **Reference only; surface gap** | NE restaurant-terrace green visible in 2025 imagery has no dedicated current course-model surface |
| `range-south-target-green` | **Reference only; surface gap** | Separate small southern range target is not the retained central target green |
| `clubhouse-terrace-stairs-entrance` | Modeled in `courtyard`, entrance and building details | Exact dimensions and unphotographed structure remain estimates |
| `range-east-net-and-equipment` | Modeled across net, canopy, hut and mat groups | Pole heights, hidden bays, machine identity and fixtures remain estimates |
| `upper-parking-practice-works` | **Reference only; surface gap** | Club-confirmed area and visible 2025 green/bunker complex need dedicated current surface tracing |
| `south-range-short-game-area` | **Partly retained** | Source south practice green exists; nearby practice bunkers/aprons have not been comprehensively reconstructed |
| `old-17-practice-green` | **Reference only; identity unresolved** | Historical old-hole-17 location cannot be assumed to equal current hole 17 |
| `halfway-kiosk` | Located and modeled as `cafe-9` | Location has guide/ortho agreement; facades and levels estimated |
| `maintenance-carts-equipment-conference` | Building envelopes modeled; **uses remain reference only** | Historical B2/B3/B4 and maintenance labels not securely joined to exact footprints; interiors not modeled |
| `starter-hut` | **Reference only; identity unresolved** | Do not rename the modeled north ball hut or range-side shed as the B4 starter hut without a spatial join |
| `clubhouse-range-sanitary-water` | **Reference only for B3/B4/east-barn details** | Exact toilet doors, club-wash points and building identity remain unresolved; separate tee-15 water point belongs to the ancillary model |
| `tee-15-toilet` | Located and modeled as `toilet-15` | Location has guide/ortho agreement; small roof edges and facades approximate |
| `bag-store-ev-charging` | **Reference only** | Historical six chargers are not located by a confirmed bag-store/footprint join; no speculative EV layout |
| `east-barn-indoor-range` | Exterior barn modeled; **interior use remains reference only** | Historical six hitting bays are not an exterior opening survey or a modeled interior |

## Credible remaining substantial site gaps

The authoring package substantially improves the architecture and range equipment. It should not be described as a complete current as-built facility model while the following visible surfaces remain unresolved:

- **Northeast restaurant-terrace green:** search bounds E 677670–677706, N 6586478–6586530. This is additional to the mapped courtyard green and southeastern pavilion green.
- **Southern range target:** E 677577–677605, N 6586181–6586212. This is additional to `lidingo-range-target-green-2019`.
- **Practice complex by upper parking:** source-confirmed group; its current green/bunker boundaries have not been adopted. Parking paint and the new 3D buildings do not fill this gap.
- **Southern short-game practice bunkers/aprons:** the retained green is present, but the full surrounding practice group is incomplete. The nearby hole-6 green and its bunker must not be relabeled as practice facilities to make the inventory appear complete.

This bounded coverage review checked current course-model hole greens, non-hole greens/bunkers and mapped facility surfaces against the retained observation search areas. It found no existing hole-green overlap for the NE restaurant green, southern target or upper-parking practice group. The exact new rings still require tracing and source review; this audit adds no invented geometry or business-use assignment.
