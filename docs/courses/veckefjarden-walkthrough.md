# Veckefjärdens Golfklubb: walkthrough

The two courses of Veckefjärdens Golfklubb in Örnsköldsvik, on one ground beside the lake Veckefjärden: the 18-hole
Mästerskapsbanan (`veckefjarden`, built in [geobuild](../../geobuild)) and the nine-hole Korthålsbanan
(`veckefjarden-korthalsbanan`, in [veckefjardenkortbuild](../../veckefjardenkortbuild)), with their sources and
rights in the [source dossier](veckefjarden-source-dossier.md), the [course map](veckefjarden-course-map.md) and
the [orthophoto alignment record](../../geobuild/mapping/README.md). It is the ground the engine was first written
for, built with its own older builder before [pipeline v2](../pipeline-v2.md), and this page is the list a first
upgrade under that process starts from.

<!-- generated:summary -->
## What is there

|  | Mästerskapsbanan | Korthålsbanan |
| --- | --- | --- |
| Holes and par | 18, par 72 | 9, par 27 |
| Tees on the card | 65 6,436 m, 61 6,121 m, 58 5,804 m, 55 5,502 m, 48 4,743 m, 40 4,043 m | Gul 932 m, Röd 770 m |
| Greens, tee decks, fairways, bunkers | 18, 54, 19, 53 | 9, 18, 0, 0 |
| Waste areas | none | none |
| Tee marks against the card | not measured | not measured |
| Outlines looked at ring by ring | no record | no record |
| A second, blind look at them | none | none |
| Tee decks on level ground in the terrain | not measured | not measured |
| Posters, prepared data, scorecard | 5, 4 of 4, yes | 5, 4 of 4, yes |

- **Ground:** 469 terrain tiles (terrain a mosaic of flights from 2020-06-18 to 2024-06-27, photo 2024-06-27, laser undated), 16 lakes and ponds, 26 creeks and ditches, 0 bridges. Generation `2ca0c5507168`.
- **Trees:** automatic (236 object tiles, 256 stand tiles); not placed one by one.
- **Buildings:** 344 mapped, 332 with a roof colour measured on the photo; an authored campus of 20 parts (R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, S01, S02, S03, S04, S05, S06, S07, S08), 44,422 triangles.
- **Quality gate:** 3 errors, 1 warnings (`tools/check-course-quality.mjs`); each is on its hole below. Not tied to a hole: veckefjarden-korthalsbanan: median green relief 2.57 m exceeds 1.6 m (error); facilities-v1: material "VECK MODEL | white.002" linear luminance 0.8956 exceeds bloom-safe ceiling 0.82 (GLOW.threshold=0.86) (error); facilities-v1: material "VECK MODEL | translucent.001" linear luminance 0.8267 exceeds bloom-safe ceiling 0.82 (GLOW.threshold=0.86) (error).
- **Release:** policy `advisory`, frame `pending-control-approval`, open: `canonical-origin`, `authoritative-assets`, `legacy-imagery-rights`.
<!-- /generated:summary -->

## What is known not to be right

This list was drawn from the repository's records on 25 November 2026; nobody has looked at the course again for it,
except the white stakes, which the owner found ruling good shots out while playing (27 November).

- **The outlines have never been checked ring by ring.** The ground was built with its own older builder, before
  the shared tracer: it has no pipeline-v2 decision files, no ring sheets, no recorded ring review or second look,
  and no deck or sand measurement (`course-doctor.mjs`; the "no record" and "not measured" rows above). What it has
  is the September review on the 27 June 2024 orthophoto: 71 records (16 greens, 30 bunkers, 18 tee inventories,
  7 fairways), each passing a source-to-model audit (alignment record). To fix: a `trace-config.json` and
  decisions for the ground, then stage 3 of pipeline v2 with a full ring review.
- **The Korthålsbanan's greens are placeholders, and the quality gate fails on them:** a median relief of 2.57 m
  round the green rings against the 1.6 m line (the Mästerskapsbanan's is 1.17 m). All nine share one 26 m shape
  ([the map mode](../course-map-mode.md)) at the ends of published GPS routes, not at surveyed centres; its
  fairways and tee pads are synthesised too, hole 4's pad slopes 13.1% (the gate's warning), and it has no bunkers
  because nothing published shows them ([the second courses](../second-courses.md)). No record ties the 2.57 m to
  the placeholder shape in so many words. To fix: trace its greens and decks on the 2024 photo.
- **The Korthålsbanan's card is not verified.** Neither column sums to its printed total (Gul 932 of 936, Röd 770
  of 776), it has no stroke index, and the club's own text says 60 to 120 m where hole 1 is 136 m
  (`geobuild/card-korthalsbanan.json`). The dossier (section 2.4, 4 September) found the cells to be GolfPass's
  yards read as metres, and a Hole19 column that sums to 936 with a stroke index of its own; it left the card as
  it was, as "a card decision". To fix: that decision, then the card and a rebuild of the nine.
- **Two campus materials are brighter than the glow's ceiling of 0.82** (quality gate): `white.002` at 0.8956,
  above the glow's own threshold of 0.86, and `translucent.001` at 0.8267. The buildings batch of 25 September
  measured this ground's white under the midnight sun (0.84, 99% of its pixels over that light's threshold) and
  took none of its options ([the buildings batch](../visual-buildings-2026-09-25.md)). The model's checksum is
  pinned in the ground's validation records and in the tree review's input lock, so a dimmer white means
  rebuilding the model with `geobuild/facilities` and validating it again (pipeline v2, "Not done yet").
- **Twenty-one of the 108 tee references are tied to no platform,** and 17 of them stand outside every mapped deck
  and draw no marker pair ([tee review, 9 September](../../geobuild/mapping/tee-alignment-review-2026-09-09.md);
  [playing positions, 13 September](../tee-playing-positions.md)). The 14th, the signature hole, has none of its
  six tied: its pads lie under trees and shadow on the photo. Tee 40 is unresolved on eleven holes. To fix: a
  leaf-off photo year in the ring sheets, or someone who has stood on the tees.
- **Some outlines were kept, not seen.** The greens of holes 2 and 10 are unresolved; seven tee platforms on holes
  6, 7, 9, 11 and 14 keep historical outlines with at least 3 m uncertainty; the 5th's shaded upper tee is not
  traced; and the fairways of 15 to 18 are OpenStreetMap's, which the 9 September review could not follow along
  the dry mow line (`geobuild/mapping/ortho-turf-review-limits-13-18.json`) and the 19 September check found to
  follow the mowing, without re-tracing them (alignment record). To fix: the ring review, on two photo years.
- **The trees are the automatic ones.** The tree pipeline has not been run here (`course-doctor.mjs`). The
  September review's own benchmark is marked not passed against its 0.9 precision and recall, on a purposive
  sample read by one agent (`geo_data/course-v2/veckefjarden/vegetation/reviews/2026-09-16/benchmark.json`).
  Which species a tree is, is a rule and not a measurement: alder and birch in the reserve, spruce and pine above
  46 m (`scenery/veckefjarden.js`). To fix: a round of the tree pipeline, in its own sitting.
- **The white stakes are drawn from the club's words, not surveyed.** The 2025 local rules say on which side of
  ten holes the out-of-bounds runs (`geobuild/course-rules.json`), and `reconcile.mjs` draws each run beside its
  hole: snapped to OpenStreetMap's course boundary where a vertex of it lies within 95 m on that side, else half
  way to the neighbour the rules name, else 6 m past the mown edge; "behind" and "around" a green are arcs
  16 and 14 m past its rim. Where a stake landed on a hole's fairway, green or tee it is moved 3 m past that
  ground's nearest edge (27 November: six stakes, on the 1st's and the 5th's tee decks and the 2nd's and the
  13th's fairways).
  So a line's course is right and its exact place is not: the 5th's left and the 2nd's left still zigzag between
  boundary vertices. Spela rules a ball out by counting crossings of these lines, so a line that is wrong by
  metres only moves where a ball beside it is out, and the quality gate holds that no shot onto a hole's own
  fairway or green is. To fix: the stakes' positions, from the club or someone who has walked them.
- **Paths and bridges are thinner than the ground.** The model has OpenStreetMap's 69 paths; the laser shows more,
  not traced. The club's rules name five bridges (holes 6, 8, 10, 11 and between 16 and 17) and the summary above
  counts none: the course map (section 5, 5 September) says they exist only where a mapped path crosses a
  modelled water line, and no record says whether all five are drawn. To fix: trace the paths, name the bridges.
- **Much of the campus is estimated.** No building height was measured: the clubhouse's eave (7.25 m) and ridge
  (10.10 m) are read off photographs, good to 1.5 m, and the range's 25 mats and 22 poles are interpreted
  positions ([modelling review](../../geobuild/facilities/modeling-review-2026-09-10.md)). The church and the K90
  jump are photo-referenced, with estimated heights ([landmarks](../../geobuild/landmarks-2026-09-13/README.md)),
  and the kit's house types are inferred, not surveyed. To fix: building laser returns, drawings or a survey.
- **Nothing in the release is approved.** The policy is advisory and the frame is `pending-control-approval`; the
  origin and the lake's RH 2000 benchmark are unset, and traces still depend on Esri, GolfTraxx and club-guide
  derivatives (`geo_data/course-v2/veckefjarden/source-manifest.json`). All 14 gates of
  `course-workflows/veckefjarden/review.json` are pending, and 0 of 189 hole-by-hole verdicts are given.

## Worth looking at

By the records' own choices: the 14th, the island green in its collar of granite boulders, which the posters and
the start menu's backdrop use; the 2nd and the 18th, the other poster holes; the 13th tee, the gallery's view; the
campus (clubhouse, hotel and pool, padel court, range); and beyond the course Själevads kyrka, the K90 jump and
the kit houses by the 10th. The ground's card says that why those poster holes were chosen was not recorded.

Most likely to be wrong: the 14th's tees, the greens of 2 and 10, the decks of 6, 7, 9 and 11, and every hole of
the Korthålsbanan, its 4th tee and its 136 m 1st before the others.

<!-- generated:holes -->
## Hole by hole

"Card" is the worst distance between a tee's mark and its card length. "To look at" lists what the checks flag;
an empty cell is no promise that the hole is right.

### Mästerskapsbanan

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Rakt uppför | 4 | 8 | 334 m | 3 | 2 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=1&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=1&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=1&karta=1) |
| 2 | Eaglechansen | 5 | 18 | 506 m | 3 | 2 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=2&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=2&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=2&karta=1) |
| 3 | Ett av de svåraste | 4 | 4 | 396 m | 1 | 5 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=3&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=3&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=3&karta=1) |
| 4 | Håll vänster | 3 | 10 | 177 m | 4 | 1 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=4&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=4&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=4&karta=1) |
| 5 | Strategiskt andraslag | 5 | 14 | 494 m | 2 | 6 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=5&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=5&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=5&karta=1) |
| 6 | Diket | 4 | 2 | 417 m | 3 | 4 | water, creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=6&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=6&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=6&karta=1) |
| 7 | Räcker klubban? | 3 | 16 | 158 m | 2 | 2 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=7&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=7&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=7&karta=1) |
| 8 | Generöst utslag | 4 | 12 | 365 m | 3 | 2 | water, creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=8&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=8&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=8&karta=1) |
| 9 | Vattnet till höger | 4 | 6 | 404 m | 3 | 3 | water, creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=9&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=9&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=9&karta=1) |
| 10 | Placera andraslaget | 5 | 9 | 530 m | 4 | 3 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=10&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=10&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=10&karta=1) |
| 11 | Ser lätt ut | 4 | 15 | 344 m | 3 | 2 | water, creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=11&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=11&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=11&karta=1) |
| 12 | Inbunkrad green | 3 | 11 | 174 m | 3 | 3 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=12&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=12&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=12&karta=1) |
| 13 | Banans tuffaste | 4 | 1 | 424 m | 3 | 4 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=13&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=13&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=13&karta=1) |
| 14 | Signaturhålet | 3 | 5 | 163 m | 2 | 1 | water |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=14&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=14&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=14&karta=1) |
| 15 | Valmöjligheterna | 4 | 13 | 266 m | 2 | 2 | water |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=15&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=15&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=15&karta=1) |
| 16 | Favoritklubban | 4 | 17 | 309 m | 5 | 5 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=16&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=16&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=16&karta=1) |
| 17 | Kanondrive | 4 | 3 | 422 m | 4 | 1 | water, creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=17&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=17&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=17&karta=1) |
| 18 | Över bäcken hem | 5 | 7 | 553 m | 4 | 5 | water, creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=18&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=18&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden&hal=18&karta=1) |

### Korthålsbanan

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Uppför från start | 3 |  | 136 m | 2 | 0 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=1&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=1&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=1&karta=1) |
| 2 | Från upphöjt tee | 3 |  | 96 m | 2 | 0 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=2&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=2&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=2&karta=1) |
| 3 | Nedför | 3 |  | 82 m | 2 | 0 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=3&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=3&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=3&karta=1) |
| 4 | Nians längsta | 3 |  | 125 m | 2 | 0 |  |  | tee pad slope 13.1% exceeds 12% | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=4&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=4&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=4&karta=1) |
| 5 | Svagt nedför | 3 |  | 100 m | 2 | 0 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=5&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=5&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=5&karta=1) |
| 6 | Nians kortaste | 3 |  | 70 m | 2 | 0 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=6&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=6&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=6&karta=1) |
| 7 | Svackan | 3 |  | 111 m | 2 | 0 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=7&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=7&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=7&karta=1) |
| 8 | Upp till green | 3 |  | 96 m | 2 | 0 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=8&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=8&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=8&karta=1) |
| 9 | Avslutningen | 3 |  | 116 m | 2 | 0 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=9&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=9&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=veckefjarden-korthalsbanan&hal=9&karta=1) |
<!-- /generated:holes -->

## How each fault was found

Faults the records describe as found while this ground was built, from September to November 2026. Where the
records do not say what found a fault, the row says so.

| Fault | Found by | Stage | Held now by |
| --- | --- | --- | --- |
| The plan-traced greens of holes 3, 5 and 7 had walked 19.4, 18.8 and 11.4 m from the survey: each run registered the plan on the last run's reading | reading the laser terrain and the imagery against the plan tracings | 5 September, the laser pass | the anchor is the surveyed green centre; since 9 September 16 of the greens are orthophoto records, each checked by `audit-ortho-alignment.py` |
| 13 of 20 plan-traced bunkers stood on ground with no dish, and the three guide-placed ones were 8 to 19 m off or on no dish at all | the sand-over-dish rule, calibrated on the 32 OpenStreetMap bunkers | 5 September, the laser pass | `check3d.mjs` fails if a guide-placed bunker comes back beside a laser one |
| Re-running `derive-dtm-features` on its own output dropped 9 ditches and 12 decks | the records do not say | 5 September, the second pass | the tool skips its own `prov:"dtm"` features; no test is named |
| The two courses, published in separate runs, got two ground manifests | `verifyAssetGraph` ("a ground referenced with conflicting manifests") | publishing the 1 m ground | `publish-ground-rings --slug a,b` and `publish-vegetation` emit every course of a ground against one hash |
| A vegetation publish dropped the ring tiles' parent links; every boot fell back to the fixed frontier, and the gate passed because that was the shape it asserted | the records do not say | after a vegetation publish | the publisher's unit test; `check-course-v2` fails when a declared ring graph does not serve |
| The Korthålsbanan inherited the parent's core cutout (at a fallback boot its trees stood on the old ground, bases 12.76 m off at p95), and its greens and tees were missing from the trees' exclusion mask | the records do not say; every numeric gate passed the second | the vegetation publish | its own measured cutout; the compile merges every model the registry's `courseModels` declares |
| The 5th was drawn with the short course's 4th and 5th fairways, and its own 400 m of mown turf as rough | the tee view's framing measurement: the hole lost its fairway from frame on every tee | 12 September, put right on the 19th | `reconcile.mjs` gives a hole a fairway only if its line runs through it; the 5th is traced on the orthophoto |
| The roadside rear tee was given to hole 6; it is hole 16's | reading both club guides together | 9 September, the tee review | the ledger keeps the guides' hashes and the trace, and the source-to-model audit checks it |
| Three penalty runs were yellow where the club has only red since 2022, and the white runs missed the club's list | reading the club's 2025 local rules | 4 September, the dossier | `course-rules.json`, which `reconcile.mjs` paints from |
| The clubhouse was cream with a dark red roof: the app had taken the engine's defaults | the club's photographs | 4 September, the dossier | the scenery module, then the campus model of 10 September; no test is named |
| A four-storey block of flats stood by the 10th | the owner, on a phone | 8 November, after the house kit | the `BLOCK_COMPANY` rule (90 m) and its tests in `house-kit.test.mjs` |
| Spela called balls on the fairway and the green out of bounds on five holes: every approach to the 2nd, 3rd and 5th, every tee shot onto the 12th and the 14th (5,469 of 33,681 replayed good shots). `reconcile.mjs` drew "behind the green" across its front (it read a = PI, back down the hole, as behind), "around the green" as a closed circle, and snapped the 13th's last right-hand stakes to the lake shore across the 14th. Six more stakes stood on a hole's own ground: the 1st's and the 5th's tee decks, the 2nd's and the 13th's fairways | the owner, playing Spela | 26-27 November; nothing looked at the stakes before | the arcs drawn on the far side and open to the approach; the white runs moved off every hole's ground and split where they cross a line of play, after the orthophoto review; quality gate item 8 (`tools/out-of-bounds-shots.mjs`, every course) and its test in `course-tools.node-test.mjs` |

## Decisions

Decided by the owner, as the records give it:

- **8 November 2026** (owner request, [the houses](../visual-houses-2026-11-08.md)): the houses of the inner,
  detailed ring are modelled in Blender and not drawn as boxes, and their roofs take their real colours from
  Lantmäteriet's photo. This was the first ground with the house kit.
- **8 November 2026** (owner report from a phone at the 10th; the same document and `CLAUDE.md`): no blocks of
  flats stand close to this course. A footprint is a block only in the company of another within 90 m, and the
  one by the 10th is drawn as the house with its garage that the orthophoto shows.

The records give no owner decision on this ground's release, its cards or its outlines.

Still the owner's to decide or do: the two white campus materials (rebuild the model dimmer, or accept it as it
was looked at); the Korthålsbanan's card; the hole-by-hole look and the release's three open items; and the 132
built files (56.4 MB) that no published generation names, which the doctor lists as the owner's to prune.

<!-- generated:checks -->
## Checking it yourself

```sh
node tools/check-course-quality.mjs --ground veckefjarden          # terrain, card, tees, water, campus (CPU)
node tools/course-walkthrough.mjs --ground veckefjarden --check    # this page against the records
node tools/course-walkthrough.mjs --ground veckefjarden --pictures # the first pictures to take, as commands

pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641                      # then open http://127.0.0.1:8641/?bana=veckefjarden&hal=1
BANVY_GPU=1 node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label look --adhoc veckefjarden:1:tee:dag,veckefjarden:18:green:kvall,veckefjarden-korthalsbanan:1:tee:dag,veckefjarden-korthalsbanan:9:green:kvall
BANVY_GPU=1 node tools/gpu-pass.mjs --only veckefjarden,veckefjarden-korthalsbanan --from boot-hi
```

The GPU and browser lines are the owner's to start (in PowerShell: `$env:BANVY_GPU=1` first).
<!-- /generated:checks -->

## Befores

- The white stakes before 27 November are the packs `d6cb9ae7…` (Mästerskapsbanan) and `b08bb0dd…`
  (Korthålsbanan) in git history; their v2 course manifests stay on disk, and the packs changed in their
  white marking alone (the heightfields, the red stakes and every other key are byte for byte the same).
- `?buildingGeometry=source` keeps the mapped buildings in place of the campus model, as a comparison view.
- `?houses=before` draws every house as the building batch did, `?roofs=palette` keeps the kit with the palette's
  roofs, and `?houseparts=all` lays every part on every house however far from the holes (8 November).
- The standalone pages `veckefjarden3d.html` and `veckefjardensgc.html` are kept unchanged in the repository as
  historical sources; their public URLs redirect to the app ([legacy URLs](../legacy-url-compatibility.md)).
- Kept generations: 14 ground manifests lie in `apps/golf/public/grounds/veckefjarden/`, the published
  `2ca0c5507168` and the 9 September tee review's `ground-v2-2f0782ee….json` among them. No record read for this
  page names one of them as the generation to roll back to.
