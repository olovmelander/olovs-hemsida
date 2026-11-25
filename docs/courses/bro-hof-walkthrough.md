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
| Posters, prepared data, scorecard | 5, 4 of 4, yes | 5, 4 of 4, yes |

- **Ground:** 469 terrain tiles (terrain 2025-06-14, photo 2025-06-14, laser 2021-03-23), 44 lakes and ponds, 48 creeks and ditches, 8 bridges, water edges: 2 stone and 4 boulders. Generation `30268b63b950`.
- **Trees:** 15,206 placed one by one (review-2026-11-24); on unseen trees precision 0.784, recall 0.807, F1 0.795: the 90% gate is **missed**; 2,079 doubtful trees held back. [Review](../../geo_data/course-v2/bro-hof/vegetation/review-2026-11-24/README.md).
- **Buildings:** 467 mapped, 459 with a roof colour measured on the photo; an authored campus of 9 parts (castle, castle-terrace, pavilion, halfway-stadium, halfway-stadium-walls, halfway-castle, halfway-castle-garden, courtyard, avenue-gate), 20,377 triangles; 26 golf carts in 3 rows.
- **Quality gate:** 0 errors, 1 warnings (`tools/check-course-quality.mjs`); each is on its hole below.
- **Release:** on the owner's acceptance of 2026-11-24, with 4 items open:
  - `canonical-control-pending`: No independent horizontal or RH 2000 ground control has been measured at Bro Hof. The frame is the 1 m national terrain and the 0.16 m orthophoto, which agree with each other.
  - `canonical-frame`: The ground's origin is fixed in software and has not been approved against independent control, as at every other ground.
  - `release-review`: The 14-gate release review does not exist: no phone timings, no per-hole review by a person, no offline or rollback rehearsal on this candidate.
  - `surface-intake-pending`: All 36 holes were traced on the 2025 orthophoto and looked through hole by hole by the agent on 24 November (paired overlays); the owner has not reviewed the outlines.
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
  0.4 m or more, mostly the building site in the west.
- **Two red tees are far from their card length** (Castle 6, +13.8 m, and Castle 10, +11.6 m). The photo shows no
  deck where the card puts them; the marks stay on the decks that exist.
- **Stadium 14:** the club's 2026 drawing shows about 12 small bunkers the June 2025 photo does not have. Not modelled.
- **Stroke index:** the hole plates give 14 as 3 and 18 as 17; the 2024 card and the club's page give 17 and 13. The
  card is used.
- **Out of bounds on 18** is only schematic in the sources and is not staked.
- **Which broadleaf a tree is, is a rule and not a measurement:** oak, alder and birch in stated shares
  (`scenery/bro-hof.js`). The laser and the April photo tell conifer from broadleaf and no more.
- **Parts of the campus are estimated:** the south façade, railings and the halfway houses' walls; the list is in its
  [README](../../brohofbuild/facilities/README.md). The courtyard wings, the long red-tiled building and the range
  shelter are house-kit drawings on their footprints.
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
| 1 | Slottet i ryggen | 5 | 8 | 578 m | 5 | 7 | water | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=1&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=1&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=1&karta=1) |
| 2 | Åsen på green | 4 | 4 | 445 m | 3 | 2 | water | 2.6 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=2&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=2&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=2&karta=1) |
| 3 | Sydlig vändning | 4 | 18 | 395 m | 4 | 3 | water | 0.8 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=3&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=3&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=3&karta=1) |
| 4 | Långjärn mot kiosken | 3 | 16 | 219 m | 5 | 2 |  | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=4&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=4&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=4&karta=1) |
| 5 | Över trädridån | 4 | 2 | 468 m | 5 | 1 | water | 2.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=5&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=5&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=5&karta=1) |
| 6 | Bunkerporten | 4 | 14 | 472 m | 5 | 3 | water, creek | 3.8 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=6&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=6&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=6&karta=1) |
| 7 | Dammen till vänster | 3 | 12 | 228 m | 5 | 2 | water | 2.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=7&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=7&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=7&karta=1) |
| 8 | Kanotgreenen | 4 | 10 | 451 m | 4 | 0 | water | 2.6 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=8&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=8&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=8&karta=1) |
| 9 | Vändningen vid sjön | 5 | 6 | 581 m | 5 | 5 | water | 8.8 m | rod tee +8.8 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=9&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=9&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=9&karta=1) |
| 10 | Vattenomgiven green | 4 | 3 | 430 m | 4 | 5 | water | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=10&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=10&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=10&karta=1) |
| 11 | Vattenbär mot kiosken | 3 | 15 | 191 m | 4 | 3 | water | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=11&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=11&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=11&karta=1) |
| 12 | Österut i vinden | 5 | 7 | 525 m | 5 | 7 | water, creek | 0.4 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=12&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=12&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=12&karta=1) |
| 13 | Mälarviken | 5 | 9 | 565 m | 4 | 2 | water | 2.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=13&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=13&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=13&karta=1) |
| 14 | Ondulerad återkomst | 4 | 17 | 416 m | 4 | 2 |  | 0.4 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=14&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=14&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=14&karta=1) |
| 15 | Finalens början | 5 | 1 | 569 m | 5 | 3 | water | 1.7 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=15&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=15&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=15&karta=1) |
| 16 | Mälarens monster | 3 | 11 | 238 m | 4 | 1 | water | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=16&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=16&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=16&karta=1) |
| 17 | Ö-greenen | 3 | 5 | 150 m | 7 | 0 | water | 0.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=17&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=17&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=17&karta=1) |
| 18 | Upp mot slottet | 4 | 13 | 373 m | 6 | 3 | water | 4.5 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=18&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=18&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-stadium&hal=18&karta=1) |

### The Castle Course

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Ut från gården | 5 | 5 | 563 m | 4 | 7 |  | 5.3 m | rod tee -5.3 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=1&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=1&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=1&karta=1) |
| 2 | Över klacken | 3 | 13 | 154 m | 2 | 2 |  | 1.6 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=2&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=2&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=2&karta=1) |
| 3 | Skogskorridoren | 4 | 11 | 337 m | 4 | 2 |  | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=3&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=3&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=3&karta=1) |
| 4 | Sandmarken | 3 | 9 | 215 m | 4 | 1 | waste | 0.9 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=4&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=4&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=4&karta=1) |
| 5 | Bäcken och dammen | 5 | 7 | 512 m | 4 | 6 | creek | 5.1 m | vit tee -5.1 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=5&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=5&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=5&karta=1) |
| 6 | Banans svåraste | 4 | 1 | 414 m | 5 | 1 | waste | 13.8 m | rod tee +13.8 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=6&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=6&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=6&karta=1) |
| 7 | Gläntan | 3 | 17 | 128 m | 4 | 4 |  | 5.8 m | vit tee -5.8 m against the card; tee pad slope 13.9% exceeds 12% | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=7&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=7&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=7&karta=1) |
| 8 | Sandstranden | 4 | 15 | 351 m | 4 | 2 | waste | 1.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=8&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=8&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=8&karta=1) |
| 9 | Bäcken före green | 5 | 3 | 496 m | 4 | 4 | water, waste | 1.9 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=9&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=9&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=9&karta=1) |
| 10 | Stora sanden | 5 | 4 | 545 m | 5 | 2 | waste | 11.6 m | rod tee +11.6 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=10&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=10&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=10&karta=1) |
| 11 | Långsmala greenen | 3 | 16 | 166 m | 5 | 0 |  | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=11&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=11&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=11&karta=1) |
| 12 | Västerut i skogen | 3 | 18 | 144 m | 3 | 2 |  | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=12&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=12&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=12&karta=1) |
| 13 | Upp till hörnet | 5 | 6 | 471 m | 4 | 0 |  | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=13&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=13&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=13&karta=1) |
| 14 | Två sandmarker | 4 | 14 | 297 m | 4 | 2 | waste | 2.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=14&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=14&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=14&karta=1) |
| 15 | Smala vägen | 5 | 2 | 471 m | 4 | 5 | waste | 0.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=15&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=15&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=15&karta=1) |
| 16 | Längs sanden | 4 | 12 | 322 m | 3 | 2 | waste | 5.4 m | rod tee -5.4 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=16&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=16&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=16&karta=1) |
| 17 | Över viken | 3 | 10 | 166 m | 4 | 2 | water | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=17&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=17&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=17&karta=1) |
| 18 | Runt dammen hem | 4 | 8 | 381 m | 4 | 4 | water | 14.3 m | gul tee +14.3 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=18&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=18&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=bro-hof-castle&hal=18&karta=1) |
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
- The first generation (automatic trees) stays published for rollback: `grounds/bro-hof/ground-v2-bf788372….json`.
