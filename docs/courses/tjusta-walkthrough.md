# Tjusta Golfklubb: walkthrough

Tjusta Golfklubb's one eighteen runs round a working farm at Tjusta Gård, Rosersberg, south-east of Arlanda: half
of it over open fields with ponds and ditches, half through spruce wood, home to a red barn that is the clubhouse.
It was built on 26 November 2026 with [pipeline v2](../pipeline-v2.md) from the sources in
[its dossier](tjusta-source-research.md); the club publishes no hole map, so the routing is read from four photo
years, the laser and a guide's hole plates, and nobody who has played it has looked at it yet.

<!-- generated:summary -->
## What is there

|  | Tjusta Gård |
| --- | --- |
| Holes and par | 18, par 72 |
| Tees on the card | Gul 5,878 m, Röd 4,959 m |
| Greens, tee decks, fairways, bunkers | 18, 37, 35, 14 |
| Waste areas | none |
| Tee marks against the card | 36 marks, median 0.1 m, 32 within 5 m, worst 13.7 m (hole 18, rod) |
| Outlines looked at ring by ring | 2026-11-27: 104 rings, 15 redrawn |
| A second, blind look at them | 2026-11-27: 15 doubts, 9 stand, 6 kept as faults; 4 it could not judge |
| Tee decks on level ground in the terrain | 33 of 36 measured |
| Posters, prepared data, scorecard | 5, 4 of 4, yes |

- **Ground:** 469 terrain tiles (terrain a mosaic of flights from 2021-03-23 to 2025-06-14, photo 2025-06-14, laser 2021-04-17), 29 lakes and ponds, 26 creeks and ditches, 0 bridges. Generation `144cc658696e`.
- **The ground's age:** where the course is newer than the terrain under it, by what was measured. Tjusta Gård 7 (2 bunkers built or reshaped since the 2021-04-18 photo, 2 bunkers without a bowl in the terrain); Tjusta Gård 11 (1 bunker built or reshaped since the 2021-04-18 photo, 1 bunker without a bowl in the terrain); Tjusta Gård 13 (2 bunkers built or reshaped since the 2021-04-18 photo, 2 bunkers without a bowl in the terrain); Tjusta Gård 16 (1 bunker built or reshaped since the 2021-04-18 photo, 1 bunker without a bowl in the terrain). Tee decks only: Tjusta Gård 4 (1), Tjusta Gård 10 (1), Tjusta Gård 18 (1). A deck that is not level is newer than the terrain or off its deck; both photo years say which.
- **Sand:** the 2025-06-14 photo was read round every hole against the model's 14 bunkers and waste areas: 0 of them hold little sand or have sand outside their line, and 92 areas of bright sand are not in the model, 86 of those on nothing the map holds. Each has a verdict; 0 are kept as a fault.
- **Trees:** automatic (169 object tiles, 179 stand tiles); not placed one by one.
- **Buildings:** 216 mapped, 205 with a roof colour measured on the photo; an authored campus of 5 parts (clubhouse, clubhouse-terrace, machine-hall, grey-hall, range-shelter), 1,276 triangles.
- **Quality gate:** 0 errors, 0 warnings (`tools/check-course-quality.mjs`); each is on its hole below.
- **Release:** on the owner's acceptance of 2026-11-26, with 5 items open:
  - `canonical-control-pending`: No independent horizontal or RH 2000 ground control has been measured at Tjusta. The frame is the 1 m national terrain and the orthophotos of four years, which agree with each other.
  - `canonical-frame`: The ground's origin is fixed in software and has not been approved against independent control, as at every other ground.
  - `release-review`: The 14-gate release review does not exist: no phone timings, no per-hole review by a person, no offline or rollback rehearsal on this candidate.
  - `routing-unconfirmed`: The club publishes no hole map and no hole-by-hole card. The routing is read from four photo years and the laser's tee decks against the card Golf i Sverige and Caddee print alike, and from Golf i Sverige's hole plates registered on the photo (16 of 18 fit; the two par 3s were read by eye). The red tees of holes 4 and 18 are on no plate and stand 8.9 and 13.7 m from the card. Nobody who has played the course has confirmed it.
  - `surface-intake-pending`: All 18 holes were traced on the 2025 orthophoto with three more photo years beside it; the agent's look at every ring is recorded, and a blind second look's 19 doubts are answered (12 stand, 7 are stated faults: six bunkers and the 18th tee's extension are newer than the 2021 laser). The 10th green's front shows on no photo. The owner has not reviewed the outlines.
- **Faults the second look and the sand audit found, kept until they can be put right:**
  - `tjusta-bunker-07-1`: built after the laser was flown (turf on the April 2021 photo, sand in 2025): the terrain has no bowl under it and it is drawn as flat sand. A newer laser flight puts it right
  - `tjusta-bunker-07-2`: built after the laser was flown (turf on the April 2021 photo, sand in 2025): flat sand on the old ground. A newer laser flight puts it right
  - `tjusta-bunker-11-1`: built after the laser was flown (rough on the April 2021 photo, sand in 2025): flat sand on the old ground. A newer laser flight puts it right
  - `tjusta-bunker-13-1`: built after the laser was flown (rough on the April 2021 photo, sand in 2025): flat sand on the old ground. A newer laser flight puts it right
  - `tjusta-bunker-13-2`: built after the laser was flown (rough on the April 2021 photo, sand in 2025): flat sand on the old ground. A newer laser flight puts it right
  - `tjusta-bunker-16-1`: built after the laser was flown (turf on the April 2021 photo, sand in 2025): flat sand on the old ground. A newer laser flight puts it right
<!-- /generated:summary -->

## What is known not to be right

- **The routing is not the club's word.** Golf i Sverige's hole plates fit the photo on 16 holes and the two
  par 3s were read by eye; the card is the one Golf i Sverige and Caddee print alike, and its stroke indexes are
  unverified. A club map, a printed card or the owner's rounds (`tools/rounds-evidence.mjs`) would settle it.
- **Four tee marks are more than 5 m from the card.** 18 Röd −13.7 m and 4 Röd −8.9 m: no plate draws a red tee
  on either hole and no photo year shows a box, so each stands on the laser's nearest level platform. 18 Gul
  −6.3 m and 11 Gul +6.4 m: the tees are where the plates put them, and the lines between are the plates' too.
- **The 10th green's front is a guess.** Its rim shows round the north end and the north-west side; the mown
  tongue runs on as the approach with no rim across it, and the east side lies in the wood's shadow on all four
  photo years. The front is set where the 2021 leaf-off photo turns from green to dormant turf. It may be 3 m out.
- **A green's edge is good to about a metre.** On the dry 2025 photo each putting surface ends in a pale band a
  metre wide, its last mowing pass; a ring may lie on either edge of it.
- **The ground is older than the course in nine places.** Six bunkers (two on 7, one on 11, two on 13, one on 16)
  were built after the April 2021 laser: they are flat sand with no bowl. The 4th hole's yellow deck was built
  after it too and slopes 6.3% in the terrain; the 18th yellow tee was lengthened and its south-west half lies on
  the old ground; 10 Röd is a mown platform the laser does not show level. Each is right when the terrain is renewed.
- **Some tee rings are the laser's platform, not the mown deck.** On 1, 6 and 16 the level platform is larger
  than the deck mown on it (16's lies under crowns on every photo); 9 Röd and 12 Röd are level platforms no
  photo year shows an edge of. The blind look doubted each, and each stands on the laser and the card alone.
- **The trees are automatic.** No crown is placed or typed; the species are a rule by place (spruce and pine in
  the woods, birch, alder and oak round the farm and the water), written from the leaf-off photo and not measured.
  The tree pipeline's sitting, and its 90% gate, are still to come.
- **The canopy rasters cover the whole 16 km ground, of which only the 4 km core is read.** They were built
  without `--tight-grid`: four campaigns of 16,384 cells a side, 16 GB in the private cache where Bro Hof's are
  1.5, and the tree stage takes 27 to 35 minutes for it (found on 27 November, when the stage was profiled). Not
  a tree is gained: only the core's tiles are read into them, and the rest is void. Build them again bound to the
  core at the tree sitting, when the rasters and their pins change anyway; `build-canopy.mjs --ground-document`
  does that by itself now.
- **The far lakes are not in the land cover.** Its water rule needs 2,000 labelled cells and Tjusta's ponds give
  523, so Fysingen and Halmsjön are classed as trees. The lakes themselves are drawn from the laser's level
  ground; what is wrong is the far ground's colour round their shores.
- **Five buildings are modelled, from the laser's levels; much of their walls is estimated.** The clubhouse
  barn, its terrace, the two machine halls and the range's shelter are a Blender model
  ([what is measured and what is not](../../tjustabuild/facilities/README.md)). Their roofs, ridges and eaves are
  the laser's. The barn's north front, its west wing and the terrace follow the club's photographs. No photograph
  shows the halls' walls or the barn's yard side from the ground: their colours and doors are estimates. The grey
  hall's main eaves rest on four returns. The other farm buildings are still the house kit's.
- **The ditches were not checked one by one.** Water is drawn wherever the laser shows a cut channel (22 of 26),
  as wide as the channel and as blue as a pond; whether each holds water in summer was not looked at.
- **The range's targets are the engine's, not the club's.** The photos of 2019 and 2021 show four targets in the
  range field, at about 50, 100 and 150 m from the tee line (two at 150); the engine plants its own flags along the
  field. The mats are its generic bays, one every 3 m along the measured line; their number on the photo is
  about the same.
- **No independent control.** The frame is Lantmäteriet's own grid and heights; no surveyed point has been held
  against it.

## Worth looking at

At its best: **18**, round the farm pond to the green under the barn, the clubhouse with its terrace beside it; **10**, round the west pond to the green at
the head of the strip; **12**, a short hole over the pond's edge; **4**, its green with two tan bunkers behind;
**2**, north over Kimstavägen with the field beside it; **13**, up along the ditch.

Most likely wrong: **18** (the red tee, the lengthened yellow tee), **4** (the red tee, the sloping yellow deck),
**10** (the green's front, the red deck), **11** (the line's bend), **7** and **13** (flat bunkers), **16** (a tee
ring under crowns), and the modelled buildings where their walls are estimates: the halls by the 9th green and the barn's yard side.

<!-- generated:holes -->
## Hole by hole

"Card" is the worst distance between a tee's mark and its card length. "To look at" lists what the checks flag;
an empty cell is no promise that the hole is right.

### Tjusta Gård

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Längs Kimstavägen | 4 | 5 | 400 m | 2 | 1 |  | 0.9 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=1&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=1&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=1&karta=1) |
| 2 | Över vägen norrut | 4 | 11 | 370 m | 2 | 0 | creek | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=2&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=2&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=2&karta=1) |
| 3 | Gläntan | 3 | 15 | 133 m | 1 | 0 |  | 0.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=3&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=3&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=3&karta=1) |
| 4 | Över dungen | 4 | 13 | 257 m | 4 | 2 |  | 8.9 m | rod tee -8.9 m against the card; gul deck not on level ground in the terrain (6.3% slope, 0.21 m off a plane) | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=4&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=4&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=4&karta=1) |
| 5 | Långa rakan | 5 | 9 | 436 m | 2 | 0 | water | 0.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=5&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=5&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=5&karta=1) |
| 6 | Vid gårdsvägen | 3 | 17 | 127 m | 1 | 2 |  | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=6&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=6&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=6&karta=1) |
| 7 | Ängen | 5 | 3 | 505 m | 2 | 2 | water, creek | 0.1 m | second look: `tjusta-bunker-07-1` is a fault; second look: `tjusta-bunker-07-2` is a fault; `tjusta-bunker-07-1` has no bowl in the terrain: built after it was flown; `tjusta-bunker-07-2` has no bowl in the terrain: built after it was flown; `tjusta-bunker-07-1` was 92% grass on the 2021-04-18 photo: built or reshaped since; `tjusta-bunker-07-2` was 100% grass on the 2021-04-18 photo: built or reshaped since | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=7&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=7&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=7&karta=1) |
| 8 | Över fältet | 4 | 7 | 310 m | 2 | 0 | water, creek | 2.9 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=8&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=8&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=8&karta=1) |
| 9 | Västra gången | 4 | 1 | 393 m | 2 | 0 |  | 0.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=9&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=9&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=9&karta=1) |
| 10 | Runt dammen | 4 | 8 | 346 m | 2 | 0 | water, creek | 2.4 m | rod deck not on level ground in the terrain (6% slope) | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=10&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=10&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=10&karta=1) |
| 11 | Utmed diket | 5 | 2 | 500 m | 2 | 1 |  | 6.4 m | gul tee +6.4 m against the card; second look: `tjusta-bunker-11-1` is a fault; `tjusta-bunker-11-1` has no bowl in the terrain: built after it was flown; `tjusta-bunker-11-1` was 100% grass on the 2021-04-18 photo: built or reshaped since | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=11&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=11&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=11&karta=1) |
| 12 | Över dammkanten | 3 | 18 | 130 m | 2 | 0 | water | 1.6 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=12&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=12&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=12&karta=1) |
| 13 | Uppför längs diket | 4 | 14 | 323 m | 2 | 2 | creek | 0.1 m | second look: `tjusta-bunker-13-1` is a fault; second look: `tjusta-bunker-13-2` is a fault; `tjusta-bunker-13-1` has no bowl in the terrain: built after it was flown; `tjusta-bunker-13-2` has no bowl in the terrain: built after it was flown; `tjusta-bunker-13-1` was 100% grass on the 2021-04-18 photo: built or reshaped since; `tjusta-bunker-13-2` was 100% grass on the 2021-04-18 photo: built or reshaped since | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=13&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=13&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=13&karta=1) |
| 14 | Tillbaka över fältet | 4 | 4 | 365 m | 2 | 0 | water | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=14&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=14&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=14&karta=1) |
| 15 | Ut ur fältet | 4 | 12 | 332 m | 2 | 0 | water, creek | 0.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=15&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=15&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=15&karta=1) |
| 16 | Mittgången | 5 | 16 | 395 m | 2 | 1 |  | 0.9 m | second look: `tjusta-bunker-16-1` is a fault; `tjusta-bunker-16-1` has no bowl in the terrain: built after it was flown; `tjusta-bunker-16-1` was 99% grass on the 2021-04-18 photo: built or reshaped since | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=16&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=16&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=16&karta=1) |
| 17 | Rundgreenen | 3 | 6 | 180 m | 2 | 0 |  | 0.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=17&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=17&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=17&karta=1) |
| 18 | Hem runt gårdsdammen | 4 | 10 | 376 m | 3 | 2 | water | 13.7 m | rod tee -13.7 m against the card; gul deck not on level ground in the terrain (0.3% slope, 0.13 m off a plane) | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=18&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=18&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=tjusta&hal=18&karta=1) |
<!-- /generated:holes -->

## How each fault was found

Every fault that was found while building, what found it, and what holds it now. A fault that only a picture found
is a check that did not exist; the last column says whether it exists now.

| Fault | Found by | Stage | Held now by |
| --- | --- | --- | --- |
| The frame centred on a golf facility south of the course that is not Tjusta's (OSM draws both as one way) | reading the club's address against OSM | 2 | the dossier's first section; the build's frame test |
| Tan sand read as no sand: no bunker found | the sand audit | 3 | the ground's measured `sand` bands and their test |
| The routing guessed from decks and lengths: 9 and 16 swapped, the tees of 4, 10, 11, 15 and 18 on the wrong decks | the blind look's doubts, then Golf i Sverige's hole plates | 3 | `register-guide-plates.py`; the build test holds every hole to its plate |
| Fairways as fragments (the 505 m 7th: 1,873 m² in four pieces), then one hole owning ten hectares | the first look, then a size test | 3 | the `fairways` switches; the build test "every hole has its own fairway" |
| The 4th hole's yellow tee on a shaded platform 10 m short | three blind looks, then the May 2023 photo | 3 | the redrawn ring and the recorded looks |
| Every green 20 to 100% too large: the outline lay on the collar's outer edge | the blind look named "spurs" on four; the photo with its contrast stretched showed all eighteen | 3, after two recorded looks had passed them | `greenInsetMetres`, twelve greens fitted by hand, the build test's sizes, and the pipeline's rule to look at greens stretched. No check measures a green against its collar yet |
| The fairways changed when a hole line moved 2 m | a build test that failed after the greens were redrawn | 3 | `fit: "settled"` and its test: the fairway model's fixed steps had never settled |
| A bare patch on the lip of the 7th hole's bunker drawn as sand | the blind look | 3 | `trimMetres` in the sand decisions |
| A stage run lost to a lock left by a stopped run, and another to app files edited while it ran | the runner | 5 | the pipeline's rule ("do not edit a watched file while the six stages run"); nothing new |
| No land cover: beyond the 1 m core the map's ground was 92% forest, Arlanda included | the map's test on each ground's forest picture | 5 | that test; `sidecars.landcover` in the production profile |
| The clubhouse drawn as a block of flats, forty windows in two rows | the first GPU picture, held against the club's photograph | 6 | the authored campus (26 November), and its test: the barn's ridge stands at the laser's 33.69 m |
| The modelled wing's eaves stuck out across the barn's front; the shelter's dividing wall stood through its roof | the facility pipeline's CPU previews, before the model was published | 5 | the previews; nothing checks a part against its roof |
| The practice ground drawn wrong: the putting green with its collar and the trees' shade (511 m2 for 294), the chipping green's mown apron as a diagonal piece of the 1st hole's fairway with a band of semi-rough round it, the short-game area north of the range as rough with none of its three target circles, and the tee line as a green strip with no mats | the owner, on a picture from the 1st tee (27 November) | 9 | the facility decisions, read on the 2025 and 2023 photos, and `fairwayExclude` over the apron in the trace config; the build test of the practice ground (its greens, its bays one every 3 m) |
| The Sverigekarta lost the keyboard when a group was opened under reduced motion (the groups were drawn twice, the second time over the group just focused) | the Cloudflare pipeline's browser journey `check-lobby-scale.mjs`, on main | 9, after the merge: the deploy stopped | the groups are drawn only when the zoom changes (`map.js`); that journey; the pipeline's rule to run the journeys before the pull request |


## Decisions

- **26 November 2026:** the owner asked for the course to be built "following the structure", then for one more
  round "to make sure it is perfectly implemented", then for it to be added to the app, and allowed the CPU and
  GPU at full speed.
- **26 November 2026: owner acceptance.** Asked how Tjusta should reach main, and told that it cannot pass the
  full release review yet, the owner chose owner acceptance, as for Bro Hof: Tjusta is admitted as advisory with
  five items named as open (`course-workflows/tjusta/owner-acceptance.json`): no independent control, the frame
  not approved, no 14-gate release review, the routing unconfirmed, the outlines not reviewed by the owner.

Still the owner's: the routing and the red tees of 4 and 18, the 10th green's front, whether the automatic trees
stay or wait for placed ones, and the posters (the five here were chosen by the agent from eight candidates).

<!-- generated:checks -->
## Checking it yourself

```sh
node tools/check-course-quality.mjs --ground tjusta          # terrain, card, tees, water, campus (CPU)
node tools/course-walkthrough.mjs --ground tjusta --check    # this page against the records
node tools/course-walkthrough.mjs --ground tjusta --pictures # the first pictures to take, as commands

pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641                      # then open http://127.0.0.1:8641/?bana=tjusta&hal=1
BANVY_GPU=1 node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label look --adhoc tjusta:1:tee:dag,tjusta:18:green:kvall
BANVY_GPU=1 node tools/gpu-pass.mjs --only tjusta --from boot-hi
```

The GPU and browser lines are the owner's to start (in PowerShell: `$env:BANVY_GPU=1` first).
<!-- /generated:checks -->

## Befores

- This is the ground's first published generation; there is none before it to return to.
- `?roofs=palette` draws the roofs without the colours measured on the photo, and `?houses=before` the buildings
  without the house kit.
