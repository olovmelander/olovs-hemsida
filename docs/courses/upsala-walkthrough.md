# Upsala Golfklubb: walkthrough

Upsala Golfklubb at Håmö gård west of Uppsala: Stora banan (18 holes, Gregor Paulsson 1964, rebuilt by Bob Kains
2007-2010) and Mellanbanan (9 holes, Nyberg and Jansson 1978) side by side on one ground, with the club's third
nine (Lilla banan) north of them and not modelled. It was built with its own older builder and taken to the 1 m
terrain in September 2026 ([source dossier](upsala-source-dossier.md),
[September mapping handoff](../../upsalabuild/mapping/NEXT-SESSION.md)); on 27 November 2026 its outlines were
traced again from decisions with [pipeline v2](../pipeline-v2.md), and that tracing is not yet the published
model (see [Pipeline v2: where the work stands](#pipeline-v2-where-the-work-stands)).

<!-- generated:summary -->
## What is there

|  | Stora banan | Mellanbanan |
| --- | --- | --- |
| Holes and par | 18, par 72 | 9, par 35 |
| Tees on the card | 62 6,192 m, 59 5,888 m, 56 5,565 m, 51 5,118 m, 47 4,722 m, 42 4,222 m | Vit 2,601 m, Gul 2,499 m, Blå 2,307 m, Röd 2,115 m, Orange 1,814 m |
| Greens, tee decks, fairways, bunkers | 18, 65, 33, 58 | 9, 29, 13, 22 |
| Waste areas | none | none |
| Tee marks against the card | 108 marks, median 0.1 m, 97 within 5 m, worst 7.5 m (hole 7, 42) | 45 marks, median 0.7 m, 31 within 5 m, worst 25.1 m (hole 8, orange) |
| Outlines looked at ring by ring | 2026-11-27: 174 rings, 7 redrawn | 2026-11-27: 73 rings, 3 redrawn |
| A second, blind look at them | 2026-11-27: 5 doubts, 3 stand, 2 kept as faults; 6 it could not judge | 2026-11-27: 2 doubts, 2 stand, 0 kept as faults; 2 it could not judge |
| Tee decks on level ground in the terrain | 61 of 65 measured | 28 of 29 measured |
| Posters, prepared data, scorecard | 5, 4 of 4, yes | 5, 4 of 4, yes |

- **Ground:** 469 terrain tiles (terrain a mosaic of flights from 2021-03-07 to 2025-06-15, photo undated, laser undated), 24 lakes and ponds, 42 creeks and ditches, 4 bridges. Generation `a4bda01ea991`.
- **The ground's age:** where the course is newer than the terrain under it, by what was measured. Stora banan 8 (1 bunker built or reshaped since the 2021-04-16 photo, 1 bunker without a bowl in the terrain); Stora banan 12 (1 bunker without a bowl in the terrain); Stora banan 15 (2 bunkers built or reshaped since the 2021-04-16 photo, 1 bunker without a bowl in the terrain, 1 deck not on level ground); Mellanbanan 3 (1 bunker built or reshaped since the 2021-04-16 photo). Tee decks only: Stora banan 5 (1), Stora banan 7 (1), Stora banan 14 (1), Mellanbanan 6 (1). A deck that is not level is newer than the terrain or off its deck; both photo years say which. The older photo cannot say for 23 bunkers in shade.
- **Sand:** the 2025-06-14 photo was read round every hole against the model's 80 bunkers and waste areas: 2 of them hold little sand or have sand outside their line, and 295 areas of bright sand are not in the model, 173 of those on nothing the map holds. Each has a verdict; 0 are kept as a fault.
- **Trees:** automatic (234 object tiles, 256 stand tiles); not placed one by one.
- **Buildings:** 444 mapped, 398 with a roof colour measured on the photo.
- **Quality gate:** 0 errors, 0 warnings (`tools/check-course-quality.mjs`); each is on its hole below.
- **Release:** policy `advisory`, frame `pending-control-approval`, open: `canonical-origin`, `authoritative-assets`, `legacy-imagery-rights`.
- **Faults the second look and the sand audit found, kept until they can be put right:**
  - `stora-green-08`: the 8th was reworked after April 2021: its green stood in bare ground then, and its large left bunker (stora-bunker-08-1) was turf. The ring follows the 2025 putting surface; the terrain under the hole may be older than the work (the bunker has no bowl in it). Put right by a newer laser flight over the 8th, or by reshaping the terrain there in a new ground generation
  - `stora-bunker-08-1`: built after April 2021 (96% turf on that photo) and 0.08 m under the ground round it: the terrain was flown before it and has no bowl for it, so it is drawn as nearly flat sand. Put right by a newer laser flight, or by carving its bowl in a new ground generation
<!-- /generated:summary -->

## What is known not to be right

- **The app still draws the September model.** The outlines traced on 27 November (below) are records for the next
  sitting: the layers, the compile, the six stages, the promotion and a bake have not been run on them. Until they
  have, every fault of the older model stands in the app, and the three below are the largest.
- **Mellanbanan has no bunkers in the app.** Its 22 bunkers are tan sand, as Tjusta's, and the older builder never
  drew them. The tracing has all 22 (and Stora banan's 58), with Upsala's own sand bands (`sand` in
  `upsalabuild/mapping/trace-config.json`). Publishing the tracing puts them right.
- **Water 22 is a creek drawn as a pond.** The 447 m2 ring `t1` north of the 4th green is a 4 m strip over the ditch,
  and east of the footbridge (E 639945) it runs 2-3 m south of the channel; the 0.84 m spread of the ground inside it
  is the creek's own fall (`audit-water-levels.mjs` names it). Put right in the layers step: leave `t1` out of the
  ponds and let the creek line carry the water.
- **The 8th was reworked after the laser was flown.** On the April 2021 photo its large left bunker was turf (96%
  grass) and the green stood in a bare surround seen at no other green (the blind look); the bunker lies only 0.08 m
  under the ground round it, so the terrain has no bowl for it, and the ground round the green may be the old shape.
  Stora 12's first bunker and 15's third (the strip along the pond) also lie only 0.12-0.13 m under the ground. Each
  is drawn as nearly flat sand until the terrain is renewed (a newer laser flight, or the ground reshaped in a new
  generation).
- **Five bunkers in shade are drawn by hand.** Stora 3's left greenside bunker, 10's front right, 12's right,
  Mellanbanan 6's short of the green and a small pot bunker by Mellanbanan 1 lie half in a tree's shadow on the 2025
  photo, where the sand extraction stopped at the shadow; each is drawn whole from the year it is lit (`add` in
  `sand-decisions.json`), good to about a metre. The pot bunker was in no map: the sand audit found its lit half.
- **The forward tees are marks on the fairway, drawn as small decks.** Stora's 42 tee on 3, 4, 5, 7, 8, 11, 12, 13
  and 15 and Mellanbanan's Orange on 2, 3, 4, 6 and 8 have no built deck: each is a 6 by 4 m deck at the September
  review's site, kept as drawn. Four of them slope with the fairway (Stora 5, 7 and 15, Mellanbanan 6 at 18.5%). The
  model will show a small tee where there is only a marker.
- **Two decks under crowns are drawn from the laser.** Stora 13's forward deck (51 and 47) and 15's upper deck (62)
  lie in shade on every photo year; each is drawn round the laser's level ground, and no photo shows its edge.
- **Twenty-five tee marks are more than 5 m from the card.** On Stora 18 every tee is 5.4-7 m short and on
  Mellanbanan 3 all four are 7.3-8.3 m short: the line through those holes' bends is shorter than the card's, so the
  bends are the doubt, not the decks. Stora 2 (51 and 56, +6.6 m), 3, 4 and 7 (the 42 marks, 6.4-7.5 m), 9 (62,
  -6.6 m), and Mellanbanan 2, 5 and 6 (+5.2 to +9.1 m) stand where the decks are. Mellanbanan 8's Orange is 25.1 m
  short: the September review placed it at the club guide's fairway entrance with a 12 m allowance, and nothing
  since has placed it better.
- **The practice grounds are not traced.** The range, the putting green west of the 1st tee and the short-game green
  south of the clubhouse road are masked out of the fairways (`fairwayExclude`); their bunkers and target discs are
  not in the tracing. They belong to the practice layer.
- **Stora 14's 47/42 deck slopes 3.5%** across 7 m (0.3 m): a crowned deck in plain sight on both photo years, not a
  ring off its deck. It stands.
- **The terrain's source changed a little since September.** Read again on 26 November the DTM differs from the
  published 1 m tiles by 2.5 mm on average and 7.5 cm at worst (E 641766, N 6634483, outside the course). The tracing
  read the new read (`l0.f32` sha `d112a9c3…`); the published terrain is the September read. The new evidence
  record was not committed: it belongs with the next terrain generation.
- **The sand audit cannot date the tan bunkers.** It reads the older photo's sand level from the white bunkers, so
  on April 2021 Mellanbanan's tan sand reads as shade, and its "was sand then" says nothing for them.
- **Granite reads as sand.** 174 bright places by the holes, mostly outcrops in the rough, gravel cart paths that no
  map has, and pond weed, each carry a verdict in `sand-audit.json`; none is a bunker.
- **Older faults that stand:** Lilla banan (the third nine, north of the course) is not modelled; the trees are
  automatic; Mellanbanan's stroke index is the club's guide column and unverified; the release still lists
  `legacy-imagery-rights` (the published outlines descend from Esri imagery; the tracing, from Lantmäteriet's photo,
  is the exit once it is published), `canonical-origin` and `authoritative-assets`; no independent control.

## Worth looking at

At its best: **3**, Bob Kains' own favourite, over the water to the green with its curving wall along the lake; the
**18th**, with the pair of fairway bunkers no map had; **Mellanbanan 5 and 6**, whose tan bunkers the app has never
shown.

Most likely wrong: **Stora 8** (the new bunker on old ground), **13** and **15** (the decks under crowns), **18**
and **Mellanbanan 3** (lines shorter than the card), **Mellanbanan 8** (the Orange mark), and water 22 by the 4th
green.

<!-- generated:holes -->
## Hole by hole

"Card" is the worst distance between a tee's mark and its card length. "To look at" lists what the checks flag;
an empty cell is no promise that the hole is right.

### Stora banan

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Vänlig start | 4 | 7 | 374 m | 4 | 5 | water | 0.7 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=1&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=1&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=1&karta=1) |
| 2 | Banans kortaste | 3 | 17 | 147 m | 2 | 3 |  | 6.6 m | 51 tee +6.6 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=2&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=2&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=2&karta=1) |
| 3 | Signaturhålet | 4 | 5 | 324 m | 2 | 4 | water, creek | 6.4 m | 42 tee -6.4 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=3&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=3&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=3&karta=1) |
| 4 | Längs dammen | 4 | 3 | 396 m | 4 | 1 | water, creek | 6.5 m | 42 tee -6.5 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=4&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=4&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=4&karta=1) |
| 5 | Klockan | 5 | 13 | 481 m | 4 | 4 | water | 1.5 m | 42 deck not on level ground in the terrain (9.1% slope) | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=5&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=5&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=5&karta=1) |
| 6 | Längsta korthålet | 3 | 9 | 204 m | 4 | 2 | water | 2.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=6&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=6&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=6&karta=1) |
| 7 | Vackraste inspelet | 4 | 1 | 415 m | 4 | 3 |  | 7.5 m | 42 tee +7.5 m against the card; 42 deck not on level ground in the terrain (3.6% slope) | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=7&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=7&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=7&karta=1) |
| 8 | Sahara | 5 | 15 | 467 m | 3 | 1 | water, creek | 0.1 m | second look: `stora-green-08` is a fault; second look: `stora-bunker-08-1` is a fault; `stora-bunker-08-1` has no bowl in the terrain: built after it was flown; `stora-bunker-08-1` was 96% grass on the 2021-04-16 photo: built or reshaped since | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=8&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=8&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=8&karta=1) |
| 9 | Hem till klubbhuset | 4 | 11 | 353 m | 3 | 2 |  | 6.6 m | 62 tee -6.6 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=9&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=9&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=9&karta=1) |
| 10 | Nedför | 3 | 14 | 184 m | 4 | 4 |  | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=10&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=10&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=10&karta=1) |
| 11 | Dammen vid green | 4 | 4 | 376 m | 2 | 2 | water | 1.6 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=11&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=11&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=11&karta=1) |
| 12 | Längs sjön | 5 | 10 | 521 m | 3 | 2 | water, creek | 2.8 m | `stora-bunker-12-1` has no bowl in the terrain: built after it was flown | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=12&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=12&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=12&karta=1) |
| 13 | Sjön hela vägen | 4 | 12 | 333 m | 2 | 1 | water | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=13&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=13&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=13&karta=1) |
| 14 | Uppför korthål | 3 | 16 | 153 m | 2 | 3 |  | 0.1 m | 47/42 deck not on level ground in the terrain (3.5% slope) | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=14&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=14&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=14&karta=1) |
| 15 | Index 2 | 4 | 2 | 337 m | 2 | 3 | water | 3.1 m | 42 deck not on level ground in the terrain (4.9% slope); `stora-bunker-15-3` has no bowl in the terrain: built after it was flown; `stora-bunker-15-1` was 17% grass on the 2021-04-16 photo: built or reshaped since; `stora-bunker-15-2` was 16% grass on the 2021-04-16 photo: built or reshaped since | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=15&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=15&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=15&karta=1) |
| 16 | Blint över krönet | 5 | 6 | 468 m | 4 | 4 |  | 2.3 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=16&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=16&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=16&karta=1) |
| 17 | Bunkrarna | 4 | 18 | 270 m | 3 | 5 | water | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=17&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=17&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=17&karta=1) |
| 18 | Mot klubbhuset | 4 | 8 | 389 m | 4 | 4 |  | 7.0 m | 56 tee -7 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=18&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=18&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&hal=18&karta=1) |

### Mellanbanan

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Öppningen | 4 | 9 | 286 m | 2 | 0 |  | 1.8 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=1&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=1&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=1&karta=1) |
| 2 | Pliktområdet vänster | 4 | 7 | 335 m | 2 | 0 | water | 6.3 m | gul tee +6.3 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=2&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=2&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=2&karta=1) |
| 3 | Intern OB | 5 | 5 | 435 m | 2 | 0 |  | 8.3 m | vit tee -8.3 m against the card; `mellan-bunker-03-1` was 10% grass on the 2021-04-16 photo: built or reshaped since | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=3&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=3&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=3&karta=1) |
| 4 | Över vikens hörn | 4 | 11 | 307 m | 2 | 0 | water | 2.6 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=4&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=4&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=4&karta=1) |
| 5 | Lilla korthålet | 3 | 17 | 109 m | 3 | 0 |  | 9.1 m | gul tee +9.1 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=5&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=5&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=5&karta=1) |
| 6 | Bäcken framför green | 5 | 3 | 455 m | 4 | 0 | creek | 10.8 m | orange tee -10.8 m against the card; orange deck not on level ground in the terrain (18.5% slope) | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=6&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=6&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=6&karta=1) |
| 7 | Över bäcken | 3 | 15 | 155 m | 4 | 0 | creek | 0.0 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=7&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=7&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=7&karta=1) |
| 8 | Signaturhålet | 4 | 1 | 338 m | 2 | 0 | water, creek | 25.1 m | orange tee -25.1 m against the card | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=8&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=8&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=8&karta=1) |
| 9 | Över dammen | 3 | 13 | 181 m | 3 | 0 | water | 0.1 m |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=9&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=9&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=upsala-mellanbanan&hal=9&karta=1) |
<!-- /generated:holes -->

## How each fault was found

Faults found while taking Upsala to pipeline v2 (27 November 2026). A fault that only a picture found is a check that
did not exist; the last column says whether it exists now.

| Fault | Found by | Stage | Held now by |
| --- | --- | --- | --- |
| Mellanbanan's tan bunkers not in the model: the white-sand bands found no sand in 21 of OSM's bunkers | matching the tracer's sand candidates against OSM's bunkers, then the photo | 3 | Upsala's measured two-sand `sand` bands; the sand audit holds every ring to its sand |
| Three bunkers no map had (Stora 7's fairway bunker, the pair on 18's fairway) | the tracer's unmatched sand candidates, looked at on both photo years | 3 | `EXTRA` in `make-sand-decisions.py`; the sand audit names any sand left out |
| A pot bunker by Mellanbanan 1 that no map had, half in shade (its lit half first dismissed as a bare spot) | the sand audit: an area of sand on nothing mapped, then the May 2023 photo | 3 | its hand ring in `sand-decisions.json`; the sand audit |
| A granite outcrop on 17 kept as a bunker (OSM and the old model) | the deck measure (it lies 0.53 m above the ground round it), then the blind look | 3 | its removal in `edit-sand-2026-11-27.mjs`; the deck measure's bowl test |
| Four bunkers cut off at a tree's shadow | the first look at the bunker sheets and the blind pass | 3 | the hand rings in `sand-decisions.json`. No check finds a ring that stops at a shadow |
| Three tee rings over their banks (Stora 3 and 7, Mellanbanan 8) | `deck-ground.mjs`: 3.3-5.1% under the rings | 3 | the laser platform decks; `deck-ground.json` |
| A provisional box on 15 over a path and trees, and a deck on 13 down a slope beside the real one | the tee sheets, then the laser heights | 3 | decks drawn round the laser's level ground; `deck-ground.json` |
| The laser platform drawn for 15's upper deck ran into the lower deck and the cart path | the blind first pass | 3 | a deck drawn from the laser's levels. No check names two decks that overlap |
| The range and two practice greens given to holes as fairway | a sand area the audit named (two bunkers by a small green), then the photo | 3 | `fairwayExclude` with its reason. No check finds a practice ground among the fairways |
| The sand audit crashed on a ground note containing the word "core" | the audit itself | 3 | `audit-sand.py` reads only the band keys now |
| Water 22 is a creek drawn as a pond | `audit-water-levels.mjs`, then the photo | 5 (on the published model) | the audit's water lines; not yet fixed |

## Decisions

Nothing on this ground has been decided by the owner since the September reviews. Theirs to decide:

- whether the traced outlines replace the September model (the next sitting: the layers, the compile, the six
  stages, a bake);
- whether a forward tee with no deck is drawn as a small deck (as now) or only as a mark;
- the practice grounds, which are not traced;
- whether Lilla banan is modelled.

## Pipeline v2: where the work stands

On 27 November 2026 Upsala went through stage 3 of [pipeline v2](../pipeline-v2.md) (sitting 1, sources and
outlines). What exists, all of it records for the next sitting and none of it published:

- **Sources.** Lantmäteriet's orthophotos of 14 June 2025 (0.16 m, six windows and an overview), 11 May 2023, 16 April
  2021 (leaf-off) and July 2019 over the holes (`upsalabuild/run-ortho-intake.mjs`, records in
  `geo_data/course-v2/upsala/acquisition/orthophoto-*.json`); OSM's club relation 152116 (17 greens, 80 bunkers, no
  hole ways: `geo_data/course-v2/upsala/reference/osm-*.geojson`); the 1 m terrain read again. The pixels stay in
  `upsalabuild/cache/`.
- **Decisions.** Both routings' `decisions.json` were written once from the September reviewed model
  (`upsalabuild/mapping/make-decisions.mjs`: its 80 decks and 27 greens drawn on the same 2025 flight, its hole lines
  and its tee references) and changed after the look by `edit-decks-2026-11-27.mjs` and `edit-look-2026-11-27.mjs`,
  each change with its reason. The sand from `make-sand-decisions.py`, `edit-sand-2026-11-27.mjs` and `edit-look-2026-11-27.mjs`, then the pot bunker by hand; the cards in the
  pipeline's form in `reference/club-scorecard.json` (their totals agree with the printed ones).
- **Tracing.** `upsalabuild/mapping/trace-config.json`: the 2025 photo; Upsala's two sands as one set of bands;
  fairways taught from the holes' lines on three flights (2025, 2023, 2021), fitted to convergence, shared out within
  55 m of a line; the practice grounds masked. Stora banan: 18 greens, 65 decks, 58 bunkers, 33 fairway pieces;
  Mellanbanan: 9, 29, 22, 13.
- **Looks.** Every ring on the sheets in two photo years, every green alone and stretched beside the May 2023 photo,
  the laser under every deck (`deck-ground.json`), the sand both ways (`sand-audit.json`, every area with a verdict),
  the recorded first look (`ring-review.json`) and a blind second look on the final outlines, each of its doubts
  answered.

Still to do, in order: the layers (a `layer-decisions.json` for the shared `packages/course-geo/mapping/build-layers.py`: water, paths, bridges, the practice grounds and the campus,
from the September model's reviewed paths and municipal survey; water 22 out of the ponds), the compile, the
production profile (`course-workflows/upsala/production.json`), the six stages and the promotion, the first look on
the GPU, then a bake. The tree pipeline is its own sitting.

<!-- generated:checks -->
## Checking it yourself

```sh
node tools/check-course-quality.mjs --ground upsala          # terrain, card, tees, water, campus (CPU)
node tools/course-walkthrough.mjs --ground upsala --check    # this page against the records
node tools/course-walkthrough.mjs --ground upsala --pictures # the first pictures to take, as commands

pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641                      # then open http://127.0.0.1:8641/?bana=upsala&hal=1
BANVY_GPU=1 node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label look --adhoc upsala:1:tee:dag,upsala:18:green:kvall,upsala-mellanbanan:1:tee:dag,upsala-mellanbanan:9:green:kvall
BANVY_GPU=1 node tools/gpu-pass.mjs --only upsala,upsala-mellanbanan --from boot-hi
```

The GPU and browser lines are the owner's to start (in PowerShell: `$env:BANVY_GPU=1` first).
<!-- /generated:checks -->

## Befores

The app draws the September model as it was, generation `a4bda01ea991`: nothing published changed on 27 November.
Its builder (`upsalabuild/*.mjs`, `tools/refresh-upsala-mapping.mjs`) and its reviewed evidence
(`upsalabuild/mapping/NEXT-SESSION.md` and the reviews it links) stay as the before of the traced outlines.
