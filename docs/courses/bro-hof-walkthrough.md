# Bro Hof Slott Golf Club: walkthrough

Two 18-hole courses by Robert Trent Jones Jr. on one ground beside Mälaren, published 24-25 November 2026 (pull
requests 174 and 175): The Stadium Course (`bro-hof-stadium`, built in [brohofbuild](../../brohofbuild)) and The
Castle Course (`bro-hof-castle`, in [brohofcastlebuild](../../brohofcastlebuild)). Sources and rights are in the
[source dossier](bro-hof-source-research.md). It is the first ground built with [pipeline v2](../pipeline-v2.md),
and this page is the list any later upgrade starts from.

The tables and commands between the `generated` markers are written by `tools/course-walkthrough.mjs` from the
build's own records, and a test fails when they fall behind. Everything else is written by hand.

<!-- generated:summary -->
## What is there

|  | The Stadium Course | The Castle Course |
| --- | --- | --- |
| Holes and par | 18, par 72 | 18, par 72 |
| Tees on the card | Svart 7,294 m, Vit 6,646 m, Gul 5,744 m, Blå 5,541 m, Röd 4,710 m | Vit 6,133 m, Gul 5,535 m, Blå 5,023 m, Röd 4,218 m |
| Greens, tee decks, fairways, bunkers | 18, 84, 18, 62 | 18, 71, 20, 48 |
| Waste areas | none | 10, with 40 grass islands |
| Tee marks against the card | 90 marks, median 0.0 m, 89 within 5 m, worst 8.8 m (hole 9, rod) | 72 marks, median 0.1 m, 63 within 5 m, worst 14.3 m (hole 18, gul) |
| Outlines looked at ring by ring | 2026-11-25: 182 rings, 7 redrawn | 2026-11-25: 167 rings, 8 redrawn |
| A second, blind look at them | 2026-11-25: 0 doubts, 0 stand, 0 kept as faults; 1 it could not judge | 2026-11-25: 9 doubts, 6 stand, 3 kept as faults; 11 it could not judge |
| Tee decks on level ground in the terrain | 78 of 84 measured | 58 of 70 measured |
| Posters, prepared data, scorecard | 5, 4 of 4, yes | 5, 4 of 4, yes |

- **Ground:** 469 terrain tiles (terrain a mosaic of flights from 2010-11-06 to 2025-06-14, photo 2025-06-14, laser 2021-03-23), 44 lakes and ponds, 48 creeks and ditches, 8 bridges, water edges: 2 stone and 4 boulders. Generation `a78474a435dd`.
- **The ground's age:** where the course is newer than the terrain under it, by what was measured. Stadium 2 (1 bunker without a bowl in the terrain); Castle 7 (4 bunkers built or reshaped since the 2021-04-16 photo, 1 bunker without a bowl in the terrain, 4 decks not on level ground); Castle 16 (2 bunkers built or reshaped since the 2021-04-16 photo); Castle 17 (1 bunker built or reshaped since the 2021-04-16 photo). Tee decks only: Stadium 5 (1), Stadium 9 (1), Stadium 10 (2), Stadium 17 (1), Stadium 18 (1), Castle 1 (1), Castle 2 (1), Castle 5 (1), Castle 6 (1), Castle 10 (1), Castle 11 (1), Castle 18 (2). A deck that is not level is newer than the terrain or off its deck; both photo years say which. The older photo cannot say for 4 bunkers in shade.
- **Sand:** the 2025-06-14 photo was read round every hole against the model's 120 bunkers and waste areas: 3 of them hold little sand or have sand outside their line, and 20 areas of bright sand are not in the model, 9 of those on nothing the map holds. Each has a verdict; 1 is kept as a fault.
- **Trees:** 15,199 placed one by one (review-2026-11-24); on unseen trees precision 0.784, recall 0.807, F1 0.795: the 90% gate is **missed**; 2,076 doubtful trees held back. [Review](../../geo_data/course-v2/bro-hof/vegetation/review-2026-11-24/README.md).
- **Buildings:** 467 mapped, 459 with a roof colour measured on the photo; an authored campus of 22 parts (castle, castle-terrace, pavilion, halfway-stadium, halfway-stadium-walls, halfway-castle, halfway-castle-garden, courtyard, avenue-gate, flagpole-a, flagpole-b, flagpole-c, flagpole-d, flagpole-e, flagpole-f, flagpole-g, flagpole-h, terrace-parasols, practice-green-flags, range-mat-line, range-grass-tee, range-targets), 27,087 triangles; 26 golf carts in 3 rows.
- **Quality gate:** 0 errors, 1 warnings (`tools/check-course-quality.mjs`); each is on its hole below.
- **Release:** on the owner's acceptance of 2026-11-27, with 4 items open:
  - `canonical-control-pending`: No independent horizontal or RH 2000 ground control has been measured at Bro Hof. The frame is the 1 m national terrain and the 0.16 m orthophoto, which agree with each other.
  - `canonical-frame`: The ground's origin is fixed in software and has not been approved against independent control, as at every other ground.
  - `release-review`: The 14-gate release review does not exist: no phone timings, no per-hole review by a person, no offline or rollback rehearsal on this candidate.
  - `surface-intake-pending`: All 36 holes were traced on the 2025 orthophoto and looked through hole by hole by the agent on 24 November (paired overlays); the owner has not reviewed the outlines.
- **Faults the second look and the sand audit found, kept until they can be put right:**
  - `castle-tee-11-1`: The terrain has a flat deck 5 by 13 m at 23.5 m under the western two thirds of the ring (E 648716-648721, N 6598936-6598948). The OSM ring is 8 m wide and hangs 2-3 m over the east bank (9% slope inside it). To redraw as a laser platform at the next trace.
  - `castle-tee-18-3`: Right: the blue deck mown in June 2025 lies 8 m to the east, on ground that is water in the terrain (the pond corner was filled after it was flown). The ring was drawn on the level strip beside it (1.0% slope). Right again when the terrain is renewed.
  - `castle-tee-18-2`: Right: the yellow deck mown in June 2025 lies about 12 m to the north-east. The pond corner was filled after the terrain was flown, so that ground is water in the model, and the ring was drawn on the level ground beside it (1.1% slope). Right again when the terrain is renewed.
  - `castle-waste-sand-15-1`: The June 2025 photo shows dark brown bare ground here, not tan sand (0% by the tracer's measure); it lies in shade on the 2021 photo. Drawn by hand on 24 November as a waste area, and the club's drawing does not settle it. Needs someone who has seen the hole to say what it is.
<!-- /generated:summary -->

## What is known not to be right

- **The trees miss their gate.** By the owner's rule of 24 November ("publish if better") they ship, because the
  automatic first generation scores lower on the same unseen trees (precision 0.662, recall 0.530, F1 0.589). In
  park and building surroundings their precision is lower than the automatic ones' (0.419 against 0.467): lawn
  under a leafless April crown reads as conifer, so one broad park crown becomes several trees. 392 crowns the
  2025 photo does not show were removed by a rule, not by eye. Trees planted after 2021 are missing. The unseen
  sample is now used up, so a second round needs a new one.
- **Castle 18's yellow and blue tees stand 12 and 8 m from the real decks.** The pond corner there was filled after
  the 2020 laser flight, so the terrain still has water under today's decks, and both stand on the laser's own
  platforms beside them. This is the 14.3 m in the card row above. It is right again when the terrain is renewed.
- **The ground is older than the photo in places.** 3.4% of the inner 2,048 m differs from the 2020 surface by
  0.4 m or more, mostly the building site in the west. The terrain is a mosaic of flights: the date its source
  record carries (14 June 2025) is its newest patch, and under the spots below it is the ground of 2020-21.
- **Eighteen tee decks are not on level ground in the terrain** (6 on Stadium, 12 on Castle; each is named on its
  hole below). A deck that is on its deck slopes under 2%; these slope 5-25% or step. Each was looked at on both
  photo years, against the terrain's heights (`deck-ground.mjs --around`) and against the terrain's own platforms:
  - **Fifteen are newer than the terrain, and their outlines are right.** The April 2021 photo shows bare soil, a
    square pad, uncut wood or another layout where June 2025 has a mown deck: Stadium 5 red, 9 yellow, 10 black,
    10 and 17 and 18 yellow/blue, Castle 1, 2, 5, 6, 10 and 18 red, and three on Castle 7 (yellow/blue, red and
    the unused deck). Castle 7 was rebuilt between the two photos, its four bunkers with it: the red deck now
    reaches 4 m further south than the terrain's platform, and the upper decks follow the 2025 mowing. They are
    drawn on the older ground.
  - **One is off its deck:** Castle 11 white. Hole 11 was not rebuilt; the terrain has a level platform of 6 by
    10 m under the ring's west side, and the OpenStreetMap outline is 8 m wide and hangs 2-3 m over the east
    bank. It wants one decision changed to the laser platform, and a trace.
  - **Two are not settled:** Castle 7 white is a 5 m circle drawn by eye on bare ground 122 m from the green,
    where the card says 128 m and neither photo shows a deck; Castle 18 white is on a slope with level ground
    5 m south of it, and the 2021 photo is in shade. Both want someone who has stood on the tee.

  On 25 November three of Castle 7's decks were first sorted as off their decks, from the heights alone. The two
  photo years showed that to be wrong: the terrain under a rebuilt hole shows the old decks.
- **Eight bunkers are newer than the terrain.** Measured two ways (the ground's age, above). Seven Castle bunkers
  were partly or wholly grass on the April 2021 photo: hole 7's four, hole 16's two and hole 17's first. Their
  outlines follow the 2025 sand, and the terrain holds the older, smaller bowls. Two bunkers have no bowl at all
  and are flat sand on a slope: Castle 7's first, and Stadium 2's first, which the 2021 photo shows as a building
  site (bare soil reads as sand there, so only the terrain shows it). For four more Castle bunkers (three on 15,
  one on 17) the older photo is in shade and cannot say. Putting the bowls right means reshaping the terrain
  under them, which is a new ground generation and a bake.
- **Two red tees are far from their card length** (Castle 6, +13.8 m, and Castle 10, +11.6 m). The photo shows no
  deck where the card puts them; the marks stay on the decks that exist.
- **Bare rock and bare ground are not drawn.** The sand audit named them: about 900 m2 of bedrock and shore
  stones beside Stadium 8's back tee, 1,200 m2 of bare works ground in the wood by Castle 13's tee, the gravel yard
  of the maintenance buildings (not mapped as hard ground), and a shed north-west of Castle 14 that is not in the
  building map. The model draws rough or forest floor there.
- **Castle 15's "waste area" may not be sand.** It was drawn by hand on 24 November; the June 2025 photo shows
  dark brown bare ground beside the green, and the audit measures no sand in it. Someone who has seen the hole
  has to say.
- **Stadium 14:** the club's 2026 drawing shows about 12 small bunkers the June 2025 photo does not have. Not modelled.
- **Stroke index:** the hole plates give 14 as 3 and 18 as 17; the 2024 card and the club's page give 17 and 13. The
  card is used.
- **Out of bounds on 18** is only schematic in the sources and is not staked.
- **Which broadleaf a tree is, is a rule and not a measurement:** oak, alder and birch in stated shares
  (`scenery/bro-hof.js`). The laser and the April photo tell conifer from broadleaf and no more.
- **Parts of the campus are estimated:** the south façade, railings and the halfway houses' walls; the list is in its
  [README](../../brohofbuild/facilities/README.md). The courtyard wings, the long red-tiled building and the range
  shelter are house-kit drawings on their footprints.
- **Trees felled since the laser still stand on the western building site.** Round the new road and the building
  site west of Castle 18 (about E 648070-648390, N 6597800-6598450), and in the works yard by Castle 13's tee, the
  2021 photo has woodland and the 2025 photo bare ground, gravel or low scrub. Crowns the laser measured there in
  2020-21 are still placed. The scrub reads as vegetation, so the gone screen kept them; tall trees still stand among
  it, so the clearing cannot be outlined by eye. Lantmäteriet's 2025 photo-matched surface model would decide it, but
  the account is refused it until "Ythöjdmodell" is added on Geotorget (round r1b in the
  [tree review](../../geo_data/course-v2/bro-hof/vegetation/review-2026-11-24/README.md)).
- **Poles and lamp posts (round r1b, 27 November).** The castle's eight flagpoles were in the tree data as thin
  conifers; they are now decided not-tree and the campus models the poles at those records. Every placed crown was
  screened for poles and none is left. Lamp posts are narrower than a metre and were never placed; the ten held
  pole-like crowns round the castle, range and car parks are decided. The other 194 pole-like crowns in the window
  stay held.
- **The rest of the grounds' furniture (27 November) is placed from the photos, not surveyed:** the range's distance
  boards give metres from the middle of the mat line, not the club's own figures, and its flags' colours, the practice
  greens' and the putting course's cups and the bags in the bays are invented.
- **Two flat slabs stand in the pond between Stadium 14's green and 15's tees** (about E 649160-649235,
  N 6598335-6598380), with straight edges. Mälaren's stair-stepped shore beside it was the reach's coarse lattice and
  is fixed (27 November); these are not. The laser has the pond as one plate at 0.83 m and its water stands at 0.91 m,
  but the carved bed rises to a dead-flat 0.00 m inside it. `?waterreach=0` removes them, so the pond's own reach carve
  makes them. The pond also lies inside Mälaren's 8 m flat-water component (level 1.06 m), so two carves may overlap
  there. Next step: read the bed field at a slab (the carve's refined and broad depths), with the prepared water off.
- **What grows on the islands is not mapped.** They are drawn as rough with the laser's trees. Three small ones in
  Mälaren (156, 36 and 2 m2; the largest at E 650263 N 6597235) lie at or below the water's level in the laser and are
  drawn as land at the waterline; they may be reed beds.
- **Reeds still stand thinly on some pond banks outside play,** where the 2025 photo shows mown banks: since
  27 November none stands in open water or in a tee's line of play, but the reed scan cannot tell a mown bank from
  rough. Putting it right needs the mown banks as a record (the photo's turf) or an opt-out in the scenery module.
- **A ball on an island's low ground is still in the water** for the lie and Spela: they read the outer ring and the
  ground's height (land more than 0.3 m above the water is not water). No island is near play.
- **Lätt 3D, from the blind look of 27 November after these fixes** (kept as faults in `visual-review.json`): the
  sun's glitter on Castle 17's lake reads as static at the hole view's zoom (`map-gl.mjs`). The same look's cut-off
  carry pills (Stadium 11, 13 and 16, Castle 12) were put right the same evening: every hazard pill whose middle is on
  the screen is shown whole, and a bunker's takes the side of its sand that fits (`map-overlay.mjs`); and the map
  draws the islands a lake holds as land (`map-course.mjs` `islands`, holes in the lake's path in `map-paint.mjs`;
  `?waterislands=0` draws them under the water, as in the detailed course). The recorded look predates both.
- **The review's pictures draw the water without its mirror of the shores.** They are taken at `det=1`, which keeps
  MSAA, and the reflection of trees and banks runs only with the temporal AA a high-quality desktop uses, so from the
  tee a pond shows the bright sky alone and the first blind look of 27 November called Stadium 7's "like ice". Drawn
  as a golfer's desktop draws it, the same pond mirrors its trees.
- **Never looked at:** a real phone; the game (Spela) on either course; storm, mist, the blue hour and autumn by eye;
  low quality beyond a clean start.

## Worth looking at

Stadium 17 (the island green and its stone wall), 18 (home under the castle, the wall short of the green), 16 (the
boulder point out in Mälaren) and 9 and 11 (the lake they share). Castle 4, 6, 8 and 10 (the waste areas and their
grass islands, also on the phone map), 5 and 9 (the creek), and 18 round its pond. The forecourt: the castle, the
fountain in its clipped ring, the avenue gate and the 26 carts the photo shows.

<!-- generated:holes -->
## Hole by hole

"Card" is the worst distance between a tee's mark and its card length. "To look at" lists what the checks flag;
an empty cell is no promise that the hole is right.

### The Stadium Course

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Slottet i ryggen | 5 | 8 | 578 m | 5 | 7 | water | 0.1 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=1&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=1&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=1&karta=1) |
| 2 | Åsen på green | 4 | 4 | 445 m | 3 | 2 | water | 2.6 m | `stadium-bunker-02-1` has no bowl in the terrain: built after it was flown | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=2&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=2&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=2&karta=1) |
| 3 | Sydlig vändning | 4 | 18 | 395 m | 4 | 3 | water | 0.8 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=3&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=3&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=3&karta=1) |
| 4 | Långjärn mot kiosken | 3 | 16 | 219 m | 5 | 2 |  | 0.1 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=4&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=4&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=4&karta=1) |
| 5 | Över trädridån | 4 | 2 | 468 m | 5 | 1 | water | 2.1 m | rod deck not on level ground in the terrain (7.9% slope) | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=5&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=5&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=5&karta=1) |
| 6 | Bunkerporten | 4 | 14 | 472 m | 5 | 3 | water, creek | 3.8 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=6&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=6&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=6&karta=1) |
| 7 | Dammen till vänster | 3 | 12 | 228 m | 5 | 2 | water | 2.0 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=7&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=7&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=7&karta=1) |
| 8 | Kanotgreenen | 4 | 10 | 451 m | 4 | 0 | water | 2.6 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=8&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=8&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=8&karta=1) |
| 9 | Vändningen vid sjön | 5 | 6 | 581 m | 5 | 5 | water | 8.8 m | rod tee +8.8 m against the card; gul deck not on level ground in the terrain (8.2% slope, 0.1 m off a plane) | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=9&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=9&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=9&karta=1) |
| 10 | Vattenomgiven green | 4 | 3 | 430 m | 4 | 5 | water | 0.1 m | svart deck not on level ground in the terrain (10.7% slope); gul/bla deck not on level ground in the terrain (13.1% slope, 0.1 m off a plane) | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=10&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=10&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=10&karta=1) |
| 11 | Vattenbär mot kiosken | 3 | 15 | 191 m | 4 | 3 | water | 0.1 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=11&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=11&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=11&karta=1) |
| 12 | Österut i vinden | 5 | 7 | 525 m | 5 | 7 | water, creek | 0.4 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=12&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=12&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=12&karta=1) |
| 13 | Mälarviken | 5 | 9 | 565 m | 4 | 2 | water | 2.0 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=13&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=13&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=13&karta=1) |
| 14 | Ondulerad återkomst | 4 | 17 | 416 m | 4 | 2 |  | 0.4 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=14&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=14&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=14&karta=1) |
| 15 | Finalens början | 5 | 1 | 569 m | 5 | 3 | water | 1.7 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=15&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=15&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=15&karta=1) |
| 16 | Mälarens monster | 3 | 11 | 238 m | 4 | 1 | water | 0.1 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=16&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=16&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=16&karta=1) |
| 17 | Ö-greenen | 3 | 5 | 150 m | 7 | 0 | water | 0.0 m | gul/bla deck not on level ground in the terrain (1.1% slope, 0.51 m off a plane) | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=17&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=17&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=17&karta=1) |
| 18 | Upp mot slottet | 4 | 13 | 373 m | 6 | 3 | water | 4.5 m | gul/bla deck not on level ground in the terrain (11.8% slope) | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=18&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=18&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-stadium&hal=18&karta=1) |

### The Castle Course

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Ut från gården | 5 | 5 | 563 m | 4 | 7 |  | 5.3 m | rod tee -5.3 m against the card; rod deck not on level ground in the terrain (5.4% slope) | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=1&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=1&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=1&karta=1) |
| 2 | Över klacken | 3 | 13 | 154 m | 2 | 2 |  | 1.6 m | rod deck not on level ground in the terrain (5.9% slope) | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=2&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=2&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=2&karta=1) |
| 3 | Skogskorridoren | 4 | 11 | 337 m | 4 | 2 |  | 0.1 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=3&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=3&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=3&karta=1) |
| 4 | Sandmarken | 3 | 9 | 215 m | 4 | 1 | waste | 0.9 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=4&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=4&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=4&karta=1) |
| 5 | Bäcken och dammen | 5 | 7 | 512 m | 4 | 6 | creek | 5.1 m | vit tee -5.1 m against the card; rod deck not on level ground in the terrain (8.5% slope) | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=5&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=5&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=5&karta=1) |
| 6 | Banans svåraste | 4 | 1 | 414 m | 5 | 1 | waste | 13.8 m | rod tee +13.8 m against the card; rod deck not on level ground in the terrain (7.9% slope) | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=6&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=6&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=6&karta=1) |
| 7 | Gläntan | 3 | 17 | 128 m | 4 | 4 |  | 5.8 m | vit tee -5.8 m against the card; tee pad slope 13.9% exceeds 12%; vit deck not on level ground in the terrain (24.9% slope); unused deck not on level ground in the terrain (20.2% slope, 0.24 m off a plane); gul/bla deck not on level ground in the terrain (2.1% slope, 0.09 m off a plane); rod deck not on level ground in the terrain (5.6% slope, 0.18 m off a plane); `castle-bunker-07-1` has no bowl in the terrain: built after it was flown; `castle-bunker-07-1` was 100% grass on the 2021-04-16 photo: built or reshaped since; `castle-bunker-07-2` was 54% grass on the 2021-04-16 photo: built or reshaped since; `castle-bunker-07-3` was 15% grass on the 2021-04-16 photo: built or reshaped since; `castle-bunker-07-4` was 24% grass on the 2021-04-16 photo: built or reshaped since | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=7&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=7&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=7&karta=1) |
| 8 | Sandstranden | 4 | 15 | 351 m | 4 | 2 | waste | 1.0 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=8&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=8&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=8&karta=1) |
| 9 | Bäcken före green | 5 | 3 | 496 m | 4 | 4 | water, waste | 1.9 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=9&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=9&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=9&karta=1) |
| 10 | Stora sanden | 5 | 4 | 545 m | 5 | 2 | waste | 11.6 m | rod tee +11.6 m against the card; rod deck not on level ground in the terrain (7.5% slope) | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=10&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=10&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=10&karta=1) |
| 11 | Långsmala greenen | 3 | 16 | 166 m | 5 | 0 |  | 0.1 m | vit deck not on level ground in the terrain (9.1% slope, 0.15 m off a plane); second look: `castle-tee-11-1` is a fault | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=11&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=11&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=11&karta=1) |
| 12 | Västerut i skogen | 3 | 18 | 144 m | 3 | 2 |  | 0.1 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=12&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=12&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=12&karta=1) |
| 13 | Upp till hörnet | 5 | 6 | 471 m | 4 | 0 |  | 0.1 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=13&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=13&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=13&karta=1) |
| 14 | Två sandmarker | 4 | 14 | 297 m | 4 | 2 | waste | 2.1 m |  | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=14&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=14&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=14&karta=1) |
| 15 | Smala vägen | 5 | 2 | 471 m | 4 | 5 | waste | 0.0 m | sand audit: `castle-waste-sand-15-1` is a fault | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=15&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=15&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=15&karta=1) |
| 16 | Längs sanden | 4 | 12 | 322 m | 3 | 2 | waste | 5.4 m | rod tee -5.4 m against the card; `castle-bunker-16-1` was 12% grass on the 2021-04-16 photo: built or reshaped since; `castle-bunker-16-2` was 39% grass on the 2021-04-16 photo: built or reshaped since | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=16&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=16&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=16&karta=1) |
| 17 | Över viken | 3 | 10 | 166 m | 4 | 2 | water | 0.1 m | `castle-bunker-17-1` was 97% grass on the 2021-04-16 photo: built or reshaped since | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=17&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=17&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=17&karta=1) |
| 18 | Runt dammen hem | 4 | 8 | 381 m | 4 | 4 | water | 14.3 m | gul tee +14.3 m against the card; vit deck not on level ground in the terrain (10.9% slope); rod deck not on level ground in the terrain (12.8% slope); second look: `castle-tee-18-3` is a fault; second look: `castle-tee-18-2` is a fault | [tee](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=18&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=18&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=bro-hof-castle&hal=18&karta=1) |
<!-- /generated:holes -->

## How each fault was found

Every fault that was found while building, what found it, and what holds it now. A fault that only a picture found
is a check that did not exist; the last column says whether it exists now.

| Fault | Found by | When | Held now by |
| --- | --- | --- | --- |
| 13 tee decks on rough OSM sketches or on platforms from before the 2021 rebuild, 4 decks the photo does not show | a picture: the paired overlay of Stadium 17 | after the mapping had been committed as done | the ring review: every ring on a sheet, a record a test holds, a verdict for each ring under the score line |
| Every pond up to 0.75 m low, eight metres inside its own walls | the first GPU picture | after the first promotion | `deferWaterBedToWorld` and its test; the first-pictures list. No CPU check sees it yet. |
| Castle 18's tees under water | a GPU picture | after the first promotion | the quality gate names a tee on ground at a water's own level |
| Waste sand turning grey with distance (drawn by the ground and again as a gravel sheet) | a GPU picture | after the first promotion | the fix only; no test |
| Nearly every broadleaf a birch | a GPU picture | after the first promotion | the ground's species rule and its test |
| The phone map: waste areas solid sand (islands filled), the forecourt missing | a picture of the live site | after the deploy, live for 45 minutes | a test on every published pack: a kind or list the map does not know fails |
| The new release gate read private files, so the first CI run was red | CI | on the pull request | the gate reads the published ground alone; its test deletes the private inputs first |
| Models missing from the source inventory, hole counts, a journey that expected 13 courses, seven test files outside the suite | running the CI steps locally | before the pull request | `inventory-models.mjs`; the journey reads the catalogue; the suite lists them |
| All 60 boots "failed" on the sign-in probe's 404 | the GPU pass | after the pull request was opened | the harness ignores that probe |
| Rewriting one catalogue row dropped its baked records | the diff of `index.json` after the posters | posters | `emit-manifest` keeps them for the same pack |
| This page's numbers were stale the night it was written | reading it the next day | after release | the generated parts, and the test that holds them |
| The tree gate missed | its own benchmark | trees | working as meant; the owner's rule decided |
| Castle 11's white tee 3 m over its bank; Castle 18's two offset tees, found again unprompted; five bunkers newer than the terrain | a second reviewer who had seen only blind sheets: no decisions, no scores | the day after release | the second look (`ring-review.mjs --second`): each doubt is answered, or kept as a fault this page prints |
| 18 tee decks on ground that is not a deck in the terrain: 15 newer than it, 1 off its deck, 2 unsettled | measuring the terrain under every deck, after the second look doubted one | the day after release | `deck-ground.mjs`: a record tied to the outlines, each deck named on its hole |
| A hand-drawn waste area with no sand in it (Castle 15); bare rock and works ground the model does not draw | reading the photo round every hole against the model's sand, both ways | the day after release | `audit-sand.py` and its record: every ring it names and every area on nothing mapped has a verdict or is a fault this page prints |
| A bunker on Stadium 2 with no bowl; two more rebuilt bunkers on Castle 16 | measuring every bunker against its bowl, and reading every bunker on the older photo with that photo's own sand and turf levels | two days after release | `deck-ground.mjs` (bowls) and `audit-sand.py --compare` (the older photo): this page prints the ground's age by hole |
| The terrain's one date was its newest patch, four years newer than the ground under Castle 7 and 18 | the two finds above | the day after release | this page prints the flights' range; no check dates the ground under a hole yet |
| Reeds standing up to 17 m out in open pond water as lone dark spikes (Stadium 7, 11 and 15; Castle 17): the reed scan read a pond flown full as ground at its level, and its shore field reached both sides of an outline. On Stadium 1,120 of 13,023 reeds stood 4 m or more inside an outline | the blind visual review of every hole (course-reviewer, 27 November), from the tee | three days after release | a reed stands in still water only on a mapped bed (`inStillWater` in `ground-cover.mjs`, `?reedbank=0`), and never in a tee's line of play (`tee-corridors.mjs`); their tests. A picture found it; the probe that counts reeds inside outlines is local |
| Mälaren's island and its 39 laser trees drawn under the lake (Stadium 15 from above): the pack compiler dropped every water's islands, and the bed carve lowered the island 3.5 m | the blind visual review, from above | three days after release | the pack keeps `innerRings` (`runtime-water.mjs`, `water-shore.node-test.mjs`); the bed field, the reach and the sheet treat an island as land (`v2-water-bed.test.mjs`, `water-reach.test.mjs`; `?waterislands=0`) |
| A bush on Stadium 18's aim line from the yellow and blue tees, 41 m off the back tee's line (Johannesberg 3 had one too) | the blind visual review, from the tee | three days after release | the cover keeps off every tee's line of play to its landing area (`tee-corridors.mjs`, its test on Stadium 18's pack; `?teecorridor=0`) |

## Decisions

Decided by the owner on 24 November 2026:

- Bro Hof is released on a recorded acceptance, not on the full release review (the items it leaves open are listed
  under "What is there").
- The placed trees ship if they score better than the automatic ones on the same unseen sample.
- The GPU work of that night (bakes, boots, pictures, posters) was run in one sitting.

Still the owner's to decide or do: a look through all 36 holes; a real phone; whether to run a second tree round;
whether Stadium 14's new bunkers and the plates' stroke indexes are right.

<!-- generated:checks -->
## Checking it yourself

```sh
node tools/check-course-quality.mjs --ground bro-hof          # terrain, card, tees, water, campus (CPU)
node tools/course-walkthrough.mjs --ground bro-hof --check    # this page against the records
node tools/course-walkthrough.mjs --ground bro-hof --pictures # the first pictures to take, as commands

pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641                      # then open http://127.0.0.1:8641/?bana=bro-hof-stadium&hal=1
BANVY_GPU=1 node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label look --adhoc bro-hof-stadium:1:tee:dag,bro-hof-stadium:18:green:kvall,bro-hof-castle:1:tee:dag,bro-hof-castle:18:green:kvall
BANVY_GPU=1 node tools/gpu-pass.mjs --only bro-hof-stadium,bro-hof-castle --from boot-hi
```

The GPU and browser lines are the owner's to start (in PowerShell: `$env:BANVY_GPU=1` first).
<!-- /generated:checks -->

## Befores

- `?buildingGeometry=source` draws the mapped footprints instead of the campus.
- `?reedbank=0` plants the reeds in open water again, `?teecorridor=0` lets the reeds and the cover into the forward
  tees' lines of play, and `?waterislands=0` draws the islands under their water (27 November; each plants or carves
  live, since the prepared data hold the new plantings and beds). Together they reproduce the earlier counts exactly
  (Stadium 13,023 reeds and 3,565 bushes).
- The first generation (automatic trees) stays published for rollback: `grounds/bro-hof/ground-v2-bf788372….json`.
