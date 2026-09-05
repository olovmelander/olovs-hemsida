# What the engine consumes — the course-model vocabulary

Every course here is one JSON model (`<build>/course-model.json`), baked into a
page's `GEODATA` block by `<build>/embed.mjs` and into the app's pack by
`packages/course-pack/emit-pack.mjs` as the `vec` stream. The two must agree byte
for byte (`check-pack`). This is the list of fields the engine
(`apps/golf/src/main.js` and its `engine/` modules) actually reads, so a build
knows what is worth supplying and a reader knows what a missing field costs. Read
counts are from a grep of the engine on 2026-09-05; anything not listed is carried
but never read.

## Frame

`origin {lat, lon}`, `mPerLon`, `seaLevel` (or `lakeLevel` on the old
Veckefjärden schema), `frame` — local metres about ORIGIN, north −z, east +x.
`seaLevel` is the floor below which nothing may sit; where a ring is `isSea` it is
the sea's level.

## Holes — `holes[]`

| field | read for |
|---|---|
| `n`, `par`, `idx`, `t[]` | the card: hole number, par, stroke index, one length per tee |
| `line[]` | the routed centreline; its end is the green centre, its start the back tee; distance plates, the flyover, the marker discs, `playB`/CORE |
| `pin` | the flag |
| `green.ring`, `green.c` | putting surface (atlas class GREEN, mow rings from the SDF), the apron that keeps trees off, submersion probes |
| `fairway.rings[]` | atlas class FAIRWAY |
| `tees.pads[].ring` | atlas class TEE; a card tee without a pad gets a synthesised deck (`engine/tee-pads.mjs`) |
| `tees.marks[] {c, b, m}` | the coloured marker pairs, one per card tee, at the card distance |
| `bunkers[].ring` | atlas class SAND; interior probes in `check-app` |
| `elev {tee, green, rise}` | the card's climb line |
| `tiers`, `name`, `note`, `shape` | the HUD card (note before shape) |

`prov` on greens/bunkers/pads (`osm`, `sat`, `plan`, `laser`, `synth`, `trace`) is
provenance for readers and gates; the engine ignores it.

## Water — `water[] {ring, level, isLake, isSea, area}`

`level` is the surface each ring floods to (a regulated lake behind a lock is
21.59 m, a sea is 0); `isLake` gives the wide shore bench, `isSea` the
coastline machinery; `area` sorts. `streams[] {line, w}` are carved as ditches or
streams by width; a path that crosses a stream or a water ring gets a footbridge.

## Marking — `marking[] {c, pts}`

Stake positions by colour (`r` red penalty, `y` yellow, `w` white OB), instanced;
a stake standing below its ring's level is dropped as drowned. Written by
Veckefjärden's reconcile and Johannesberg's (from the club's plans).

## Vegetation — `veg`

`forest[]`, `wood[]`, `scrub[]` tint the ground and seed the planter; `wetland[]`;
`sand[]` renders as sand like `scenery.bunkers`; `rock[]` is carried and NOT
rendered (rock tint comes from slope only). `cover` is the satellite tree-cover
raster the GPK1 planter obeys in both directions.

## Infrastructure — `infra`

| field | read for |
|---|---|
| `buildings[] {ring, h, kind, name, amenity, id}` | houses; the largest `amenity=clubhouse` or `/golfklubb\|klubbhus/` gets the clubhouse treatment (`CLUB_LOOK`), `kind: 'roof'` is a canopy on posts, `id` keys `SCENERY.buildingLooks` |
| `roads[] {line, kind, surface, lanes, oneway, name}` | ribbons and the PATH class band; trunk roads get edge lines |
| `tracks[]`, `paths[] {line, kind, surface}` | gravel ribbons and the path class; footbridges where they cross water |
| `parking[] {ring, surface, cars, vehicles}` | lots with instanced cars; `cars: false` for a square, `vehicles: 'motorhome'` for a ställplats |
| `landuse[] {ring, kind}` | field/garden/industry tints and scatter policing |
| `power {lines, towers, poles}`, `railway[]`, `piers[]`, `basins[]`, `reserves[]`, `farB[]` | the surroundings |

## Surroundings — `surround`

`clearfells[]` (planted at 6 % with stumps), `yard` (a gravel compound),
`hayfields`, `shallows[]` (silt margins under water). Absent on most courses.

## Scenery — `scenery`

| field | read for |
|---|---|
| `greens[]`, `fairways[]`, `tees[]`, `grass[]`, `range[]` | mown ground that is not this course's play (a sibling course, practice ground); greens rasterise as GREEN, grass as SEMI, the rest as FAIRWAY; `greens` and `range` also enter `playB`, so they widen CORE |
| `practiceGreens[]` | the putting greens the Ö marker names; without it every scenery green within 200 m of the clubhouse is taken for one |
| `bunkers[]` | practice bunkers, as sand |
| `rangeFacilities {bays, bayPitch, nets, netHeight}` | the tee line's mats, dividers and kerb, and the safety nets on poles |
| `cartPark {line, count}` | the cart fleet in a row |

## Per-course code — `engine/scenery/<slug>.js`

Not data, but the same kind of fact: `clubhouse` (colours, storeys, gable,
terrace), `species` (the planter's mix), `armour` (a riprap collar by hole),
`reedbed`, `clearings`, `farRing`, `buildingLooks`. A course without a module
downloads nothing.

## Not consumed

`pois[]`, `coast.chains` (built by reconcile for the sea), `vegetation.rock`,
`infra.pitches`, every `prov`, `notes`, `conf`, `lineSrc`, `teeSlide`,
`teePadDist`, `card.provisional`. They are for readers and gates.
