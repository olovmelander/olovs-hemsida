# Visby Golfklubb: walkthrough

Visby Golfklubb's eighteen holes on Kronholmen at Västergarn, on Gotland's west coast: a links where the median
green stands 82 m from the Baltic, built in [visbybuild](../../visbybuild) in September 2026 and the first ground
here that is mostly sea. Sources and rights are in the [source dossier](visby-source-research.md); it was built
before [pipeline v2](../pipeline-v2.md), so this page is the list an upgrade under that process starts from.

<!-- generated:summary -->
## What is there

|  | Kronholmen |
| --- | --- |
| Holes and par | 18, par 72 |
| Tees on the card | 63 6,230 m, 59 5,819 m, 55 5,490 m, 51 4,926 m, 46 4,609 m, 41 4,216 m |
| Greens, tee decks, fairways, bunkers | 18, 59, 14, 81 |
| Waste areas | none |
| Tee marks against the card | not measured |
| Outlines looked at ring by ring | no record |
| A second, blind look at them | none |
| Tee decks on level ground in the terrain | not measured |
| Posters, prepared data, scorecard | 5, 3 of 3 (its water is kept live, by design), yes |

- **Ground:** 469 terrain tiles (terrain a mosaic of flights from 2024-02-03 to 2026-04-10, photo 2026-04-10, laser 2024-03-16), 40 lakes and ponds, 0 creeks and ditches, 0 bridges. Generation `61515d2112e9`.
- **Trees:** automatic (116 object tiles, 256 stand tiles); not placed one by one.
- **Buildings:** 32 mapped, 31 with a roof colour measured on the photo; an authored campus of 18 parts (way/530655627, way/530655628, way/530655629, way/530655630, clubhouse, way/530655632, way/530655633, range-parking-building-2026, service-west-north-2026, service-west-south-2026, service-north-small-2026, range-firing-mats-west-2026, range-firing-mats-central-2026, range-firing-mats-east-2026, range-east-net-base-2026, range-east-shelter-2026, skansudde-lighthouse, shoreline-shed), 56,897 triangles.
- **Quality gate:** 1 errors, 0 warnings (`tools/check-course-quality.mjs`); each is on its hole below. Not tied to a hole: facilities-v1: material "Visby / trim" linear luminance 0.8690 exceeds bloom-safe ceiling 0.82 (GLOW.threshold=0.86) (error).
- **Release:** policy `advisory`, frame `pending-control-approval`, open: `hole-routing-unresolved`, `playing-surfaces-incomplete`, `canonical-origin-unapproved`, `current-ortho-access`, `media-derivative-rights`, `vegetation-and-objects`, `playable-runtime-pending`.
<!-- /generated:summary -->

## What is known not to be right

This list was drawn from the repository's records on 25 November 2026; nobody has looked at the course again for it.

- **The outlines have never been checked ring by ring.** The ground was built with its own builder before the
  shared tracer, so it has no decision files, no ring sheets, no second look and no deck or sand measurement
  (`course-doctor.mjs`: "known"). The fix is a trace from decisions under pipeline v2, stage 3. Its photos are
  now on this machine. On 27 November `visbybuild/stac-ortho-discovery.mjs` found every Lantmäteriet flight
  over Kronholmen from 2012 to 2026 readable with the account (September's dossier had the 2026 COGs refused).
  `visbybuild/run-ortho-intake.mjs` fetched the 10 April 2026 leaf-off flight at 0.16 m in four windows with
  a 0.32 m overview, the 14 May 2024 flight at 0.16 m, and the 4 June 2022 summer flight at 0.25 m: 876 MB in
  `visbybuild/cache/ortho/`, with their records in `geo_data/course-v2/visby/acquisition/orthophoto-*.json`.
  The records are not yet in the source manifest; they go in with the generation the trace makes. Still
  missing for stage 3: a `trace-config.json` and the decision files. A look before any re-trace is nearer: the
  Ängsö session's `packages/course-geo/mapping/export-model-surfaces.mjs` (branch `feat/angso-pipeline-v2`, not on
  main on 27 November) writes an older ground's published outlines as a build's `playing-surfaces.geojson`, so the
  ring sheets, `deck-ground.mjs`, `audit-sand.py` and the ring review can run on Visby's outlines as they stand.
- **Sixteen of the eighteen greens are OpenStreetMap's outlines.** Only 3 and 9 were redrawn on the April 2026
  photo (`sourceIds` in `visbybuild/course-model.json`). [The photo pass](../../visbybuild/mapping/ORTHOPHOTO-2026.md)
  leaves the other greens' edges, most mowing lines and the fringes to review; bunker edges under crowns on 1, 5
  and 16 were left alone ([bunker audit](../visby-bunker-audit-2026-09-21.md)). The same trace would settle them.
- **Hole 12 has no tee deck.** No source shows its platform: the model says `unresolved-physical-platform`, all
  six marks stand on one approximate point on the fairway, and the line is 203 m against a card of 321 m
  ([dossier](visby-source-research.md): -36.7%). The GolfTraxx survey places the tee, but it is a cross-check
  and moved nothing. It wants the deck found on the 2026 photo or on the ground, never a pad made up. On
  27 November the 2024 and 2026 photos were looked at round the card's length, on the line's extension, which
  is just east of hole 11's green (local 380, 297). No deck shows there: only the green's surround and worn
  grass by the path. The next ways are the rounds (`tools/rounds-evidence.mjs`) or someone on the ground.
- **33 of the 108 numbered tees are not tied to a deck.** 59 decks are mapped and 75 pairings corroborated
  ([tee review, 9 September](../../visbybuild/mapping/tee-alignment-review-2026-09-09.md)). Hole 15's deck across
  the path has no number, and on 13 and 14 the club's hole plans draw two tees where the card gives one length.
  The model's lines on 15 and 13 are 312 m and 299 m against cards of 413 m and 376 m (read from
  `course-model.json` for this page; no record measures the marks against the card, as stage 3 would).
- **Hole 1 is being rebuilt.** The club's notice of 13 August 2026 has the work start in late October 2026 and
  the hole open in spring 2027: a larger green, the right bunker gone, two new ones on the left, a new tee 41.
  The model shows autumn 2026 (dossier); the records do not say whether the work began. It wants a newer photo.
- **The hole guide's caveats on 3 and 9 are out of date.** `visbybuild/guide-notes.json` still says that green 9
  measures 1,670 m2 and that hole 3 is traced on the 2022 photo. Both greens were redrawn on 9 September, and
  `visbybuild/mapping/green-9-review.json` still reads "not corrected". Rewrite the caveats; close the record.
- **The trees are the automatic ones**, from a leaf-off laser flight of 2024. A pilot closed on 16 September at
  precision 71.4% and recall 62.5% against the 90% gate and published nothing
  ([closeout](../../geo_data/course-v2/visby/vegetation/pilot/closeout/README.md)). The fix is a tree-pipeline round.
- **The coastal pine's shadow misses its gate at a low sun:** 0.795 and 0.785 against 0.80 at 9.4 degrees, kept
  as a known gap on 4 November ([realistic trees](../visual-trees-realistic-2026-11-03.md)). No fix is recorded;
  thicker pads moved it from 0.75 to 0.79.
- **The sea has no bed, and one seam is left.** The laser gives the Baltic as a flat plate at 0.23 m and a
  measured-only ground carves nothing, so the sheet is drawn opaque. Since 27 November the sea inside the mapped
  window has its own shore field ([the sea's own shore](../visual-sea-shore-2026-11-27.md)). The plate under it
  is masked past a 4.5 m strip, and the sheet fades in over 3 m from the mapped shore over a damp bank, so the
  narrow plate left open on 7 November is now drawn as wet silt under the faded edge. Still open: the straight
  colour seam where the window's shallows meet the extension's 32 m cells, about 2 km from the nearest hole, and
  a coast beyond the window drawn with no fade ([the water's shores](../visual-water-shores-2026-11-07.md)). No
  phone has seen the new shore.
- **The campus trim is too bright, and parts of the campus are estimates.** The quality gate's one error is
  "Visby / trim" at 0.869 linear luminance, over the 0.82 ceiling and the glow's own 0.86. The trim is
  `f1f0e9` in `visbybuild/facilities/model_primitives.py`; `e8e7e0` reads 0.797. A dimmer white means
  rebuilding the model with [its builder](../../visbybuild/facilities/README.md) and validating it again, which
  changes how the clubhouse looks; or it is accepted as it was looked at (pipeline v2, "Not done yet"). On
  27 November it could not be rebuilt here. The builder needs its reference kit and the pinned
  `terrain-1m.f32` from `visbybuild/cache/`, which this machine does not hold, and the Blender 4.5 it was
  validated on (this machine has 5.3). Eaves, some roof heights and the 9 m net are estimates, and the net along
  the road is not modelled.
- **The release is advisory, with seven items open** (each has its exit gate in
  `geo_data/course-v2/visby/source-manifest.json`): no independent control for the frame or the routing, surfaces
  and boundaries not fully reviewed, no grant to use the club's, Caddee's or the municipal imagery in production,
  trees and building sizes unapproved, no acceptance by a person on named devices. All 14 gates in
  `course-workflows/visby/review.json` are pending and the owner has given 0 of 126 hole-by-hole verdicts
  (`course-doctor.mjs`). No record shows a look on a real phone.
- **Not modelled:** the club's separate nine holes, and the local rules (internal out of bounds on 6 and 10, the
  red penalty area right of 11, the drop zone on 17; `visbybuild/mapping/NEXT-SESSION.md`).
- **The doctor also names** 9 built files (5.7 MB) that no published generation uses.

## Worth looking at

At its best, by the records: 6 along the shore (Svensk Golf, nr 6/2021: "ett av norra Europas absolut bildskönaste
par 5"), the tee shot over the bay on 2, the water down the right of 11, and 18 home along the sea; the posters
use 18, 6 and 1. Hole 1 for Skansudde's 1936 lighthouse beside the tee, and hole 4 over the sea at golden hour,
the view the owner sent on 25 September.

Most likely to be wrong: 12 (no deck), 13 and 15 (few decks, lines far short of the card), 14 (plan and card
disagree, and its tee 41 once lay in a bunker), 3 and 9 (redrawn greens with no recorded look), 1 (being rebuilt),
the coast north of the mapped window, and the clubhouse's white trim toward a low sun.

<!-- generated:holes -->
## Hole by hole

"Card" is the worst distance between a tee's mark and its card length. "To look at" lists what the checks flag;
an empty cell is no promise that the hole is right.

### Kronholmen

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Fyrhålet | 3 | 15 | 159 m | 3 | 2 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=1&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=1&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=1&karta=1) |
| 2 | Över havsviken | 4 | 7 | 411 m | 5 | 4 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=2&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=2&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=2&karta=1) |
| 3 | Längsta hålet | 5 | 5 | 525 m | 3 | 5 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=3&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=3&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=3&karta=1) |
| 4 | Rakt uppför | 4 | 13 | 310 m | 3 | 4 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=4&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=4&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=4&karta=1) |
| 5 | Havet i sikte | 3 | 11 | 170 m | 5 | 2 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=5&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=5&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=5&karta=1) |
| 6 | Längs kustlinjen | 5 | 3 | 447 m | 4 | 6 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=6&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=6&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=6&karta=1) |
| 7 | Upp till green | 3 | 9 | 200 m | 2 | 4 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=7&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=7&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=7&karta=1) |
| 8 | Index ett | 4 | 1 | 414 m | 4 | 7 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=8&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=8&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=8&karta=1) |
| 9 | In mot klubbhuset | 4 | 17 | 334 m | 4 | 5 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=9&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=9&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=9&karta=1) |
| 10 | Kortets lättaste | 5 | 18 | 476 m | 3 | 5 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=10&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=10&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=10&karta=1) |
| 11 | Vattendraget | 4 | 4 | 329 m | 4 | 6 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=11&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=11&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=11&karta=1) |
| 12 | Korta fyran | 4 | 8 | 321 m | 0 | 4 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=12&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=12&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=12&karta=1) |
| 13 | Skarp vänster | 4 | 16 | 376 m | 1 | 3 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=13&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=13&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=13&karta=1) |
| 14 | Korta trean | 3 | 12 | 155 m | 4 | 5 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=14&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=14&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=14&karta=1) |
| 15 | Lång och svår | 4 | 2 | 413 m | 2 | 6 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=15&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=15&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=15&karta=1) |
| 16 | Femman med vatten | 5 | 10 | 482 m | 4 | 4 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=16&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=16&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=16&karta=1) |
| 17 | Över vattnet | 3 | 14 | 192 m | 5 | 5 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=17&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=17&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=17&karta=1) |
| 18 | Längs havet hem | 5 | 6 | 516 m | 3 | 4 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=18&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=18&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=visby&hal=18&karta=1) |
<!-- /generated:holes -->

## How each fault was found

The faults the records describe as found while building, all in 2026. A fault that only a person's eye found is a
check that did not exist; the last column says whether one exists now.

| Fault | Found by | Stage | Held now by |
| --- | --- | --- | --- |
| All six numbered tees of a hole on one point, where the card spreads them about 112 m | the marks set against the card's lengths | mapping, 8 September | the guarded tee ledger of 9 September (`reviewed-tee-alignment.mjs`), which the generator reapplies |
| Hole 9's green a 1,670 m2 complex, its line 12.3% longer than the card | the GolfTraxx survey read against the model (`golftraxx-review.mjs`) | mapping, 8 September | the redrawn green in the dated photo overlay; its review record was never closed |
| The eye stood 7 m behind every tee, off the deck on 36 of 108 selections | feedback that the tees felt displaced (the record does not say whose) | after the first publication, 8 September | a camera test that runs `setCam` on all 108 references |
| Tee 41 on hole 14 in a bunker; hole 10's tees up to 66.8 m off; eleven decks missing | the tee review on the April 2026 photo | 9 September | `tee-polygon-validation-2026-09-09.json` (no tee on water, a green or a bunker) and the tee runtime harness |
| A phone's position read 23 m off (RMS) on a ground authored in the grid | 108 PROJ controls in the tee coordinate audit | 9 September | `tee-coordinate-audit-2026-09-09.mjs` and the GPS tests |
| The 16 km ground never drawn: its terrain failed silently to the old 2 km one while every data gate passed | the browser gate `check-course-v2` | the release pass | every config declares its grid origin and both readers throw; a missing v2 terrain is now a boot error |
| The Baltic on the wrong side of the 18th in the hole guide | the club's local rule ("pliktområdet till vänster") | the release pass | `tools/hole-geometry.mjs` takes a side at the closest approach; the records name no test |
| The 9th called the card's easiest hole beside its index 17 | not recorded; the guide's other four superlatives were then checked against the card by hand | the release pass | nothing: no check compares the guide's prose with the card |
| Water over foreground land, and the sea breaking up at a distance on WebGL2 | the owner, on a screenshot and on a phone | after publication, 9 September | the verified-sea terrain mask, `tools/v2-coastal-depth-review.mjs` and `visbybuild/check-coastal-water.mjs` |
| Dark 32 m rectangles along the whole coast: a see-through sea sheet with no bed under it | the owner's phone | after publication, 10 September | `waterSheetIsOpaque` and its test (`water-render-policy.test.mjs`) |
| Hole 3 without its southern fairway bunker; 14 sand areas missing and two false ones | the bunker audit against the 0.16 m photo and the Caddee hole plans | 21 September | the dated bunker ledger, applied after every older overlay; tests sample the atlas at hole 3's five bunkers |
| The coast beyond the mapped window a 32 m staircase, with about two dozen far trees in the sea | the owner, then the fix's own pictures | 7 November | `coastal-water-grow.test.mjs`; planting asks `isWaterAt` |
| Darker 32 m squares in the sea along the whole coast inside the mapped window: the water's reflection finding the laser's plate under the sheet in every cell the mask kept within 45 m of a shore | the owner's screenshot of hole 1, Kväll; `?waterreflect=0` removed them | 27 November | the sea's shore field masks the plate past a 4.5 m strip (`coastal-water-shore.test.mjs`); a picture only for the reflection itself |
| A sawtooth waterline with a pale rim: the opaque sheet cutting the laser's 1 m raster step from the flattened sea (0.23 m) to the land (0.64 m a metre inland) | the owner's screenshot of the south shore | 27 November | the sheet's 3 m fade and the damp bank (`water-road.test.mjs` holds the wiring); a picture only for how it looks |

## Decisions

The records attribute these to the owner (all 2026); none is an acceptance of this ground:

- **September** (no day is given): the coastal pine keeps three growth forms (wind leaning, forked, sheltered),
  and two darker, more windswept proposals were declined (`CLAUDE.md`).
- **25 September:** on a phone picture of hole 4, the sun's reflection on the sea was uneven and was to be made
  good; the open sea lost the lakes' dark far shore in that pass ([water road](../visual-water-road-2026-09-25.md)).
- **4 November:** the realistic trees became the default, and Visby's pine was to be remade to the kept forms.
- **7 November:** no sharp lines in Visby's water in the distance or along the waterline; its coast now grows one
  32 m cell, masked by height.
- **8 November:** the house kit and roofs measured on the photo for every course but Johannesberg, Visby among them.
- **27 November:** the owner reported the squares in the sea and the jigsaw at the waterline, and asked for Visby
  to be improved under the new pipeline. The same night the owner asked that nothing be put to them as a question
  overnight. So the sea's shore was fixed on the recommendation recorded here, the photos for a stage-3 trace were
  fetched, and the course model was left as it was.

Still the owner's to decide or do: the trim (rebuild the campus with a dimmer white, or accept it and say so here);
a look through the 18 holes and at a real phone on the coast; whether the ground is traced again under pipeline v2
and given a tree round; what to do about the image rights the release names; and the files the doctor would prune.

<!-- generated:checks -->
## Checking it yourself

```sh
node tools/check-course-quality.mjs --ground visby          # terrain, card, tees, water, campus (CPU)
node tools/course-walkthrough.mjs --ground visby --check    # this page against the records
node tools/course-walkthrough.mjs --ground visby --pictures # the first pictures to take, as commands

pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641                      # then open http://127.0.0.1:8641/?bana=visby&hal=1
BANVY_GPU=1 node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label look --adhoc visby:1:tee:dag,visby:18:green:kvall
BANVY_GPU=1 node tools/gpu-pass.mjs --only visby --from boot-hi
```

The GPU and browser lines are the owner's to start (in PowerShell: `$env:BANVY_GPU=1` first).
<!-- /generated:checks -->

## Befores

- `?seashore=0` draws the sea inside the mapped window as before 27 November: the plate kept in 32 m cells near
  every shore, the sheet opaque to its polygon, and no damp bank.
- `?waterreach=0` draws the coast beyond the mapped window in whole 32 m cells, and plants the far wood as before.
- `?opensea=0` shades the sea as a lake, with a far shore's dark band; `?waterroad=0&watermirror=0&waterrelief=0`
  with it is the water as it was before the road pass of 25 September.
- `?treeset=v1` is the painted catalogue, with the painted coastal pine the owner kept in September.
- `?houses=before` and `?roofs=palette` draw the houses as they were before the kit and its measured roofs.
- `?buildingGeometry=source` draws the mapped footprints instead of the campus (the baseline of
  `visbybuild/facilities/check-facility-runtime.mjs`).
- No record names a generation kept for rollback. Five earlier generation manifests lie beside the current one
  (`61515d2112e9`) in `apps/golf/public/grounds/visby/`; which of them, if any, is meant as the before is not
  recorded. The handoff's `?v2=0` (the old 2 km terrain) no longer applies: the player draws v2 terrain only.
