# Ribbingsfors Golf & Kultur: walkthrough

A nine-hole park and pasture course (par 36) by Janne Lundvall, opened in 1991 in the Ribbingsfors manor grounds
beside Lake Skagern at Gullspång, published as `ribbingsfors` and built in September 2026 with its own builder
([ribbingsforsbuild](../../ribbingsforsbuild)), before [pipeline v2](../pipeline-v2.md). Sources and rights are
in the [source dossier](ribbingsfors-source-dossier.md), and this page is the list any later upgrade starts from.

<!-- generated:summary -->
## What is there

|  | Park & hagmark |
| --- | --- |
| Holes and par | 9, par 36 |
| Tees on the card | Vit 3,110 m, Gul 2,966 m, Röd 2,525 m |
| Greens, tee decks, fairways, bunkers | 9, 15, 13, 18 |
| Waste areas | none |
| Tee marks against the card | not measured |
| Outlines looked at ring by ring | no record |
| A second, blind look at them | none |
| Tee decks on level ground in the terrain | not measured |
| Posters, prepared data, scorecard | 5, 4 of 4, yes |

- **Ground:** 469 terrain tiles (terrain a mosaic of flights from 2022-12-14 to 2023-04-16, photo undated, laser 2023-03-31), 13 lakes and ponds, 18 creeks and ditches, 0 bridges. Generation `45c8d0edb7e6`.
- **Trees:** automatic (245 object tiles, 254 stand tiles); not placed one by one.
- **Buildings:** 44 mapped, 44 with a roof colour measured on the photo; an authored campus of 44 parts (clubhouse-main, estate-barn-east, estate-barn-north, estate-barn-south, estate-outbuilding-northeast, estate-outbuilding-northwest, estate-shed-east, estate-small-l-wing-east, estate-small-l-wing-west, lakeside-boathouse, maintenance-east-shed, maintenance-north-shelter, maintenance-small-green-shed, maintenance-south-shed, maintenance-southern-hut, manor-garden-hut-west, manor-main, manor-outbuilding-east-north, manor-outbuilding-east-south, manor-small-shed-north, manor-west-conservatory, manor-wing-north, manor-wing-north-west-porch, manor-wing-south, manor-wing-south-porch, range-divider-1, range-divider-2, range-divider-3, range-divider-4, range-divider-5, range-divider-6, range-divider-7, range-divider-8, range-mat-01, range-mat-02, range-mat-03, range-mat-04, range-mat-05, range-mat-06, range-mat-07, range-mat-08, range-mat-09, range-picnic-table-estimate, range-shelter), 12,408 triangles.
- **Quality gate:** 1 errors, 1 warnings (`tools/check-course-quality.mjs`); each is on its hole below. Not tied to a hole: facilities-v1: material "RIBB | white" linear luminance 0.8349 exceeds bloom-safe ceiling 0.82 (GLOW.threshold=0.86) (error).
- **Release:** policy `advisory`, frame `pending-control-approval`, open: `canonical-origin`, `authoritative-playing-surfaces`, `reference-rights`.
<!-- /generated:summary -->

## What is known not to be right

This list was drawn from the repository's records on 25 November 2026, and nobody has looked at the course again
for it. "§" is a section of the [source dossier](ribbingsfors-source-dossier.md).

- **The quality gate fails on a white campus material.** `RIBB | white` has linear luminance 0.8349, over the
  glow-safe ceiling of 0.82 (`check-course-quality.mjs`). It is the `white` of
  `ribbingsforsbuild/facilities/geometry.py`, on the clubhouse awnings and the range shelter's posts. A dimmer
  white means a rebuild in Blender and a new pinned checksum, and it changes how the clubhouse looks
  ([pipeline v2](../pipeline-v2.md), "Not done yet").
- **A tee deck on hole 2 stands at a pond's own level.** The quality gate warns that the hole's second deck lies
  within 0.3 m of the level of water 6, which is 6 m or less away. The records do not say whether it floods in
  the picture; a first look from hole 2's tee would.
- **The outlines have never been checked ring by ring.** The ground was built before the shared tracer: it has
  no decision files, no ring review, no second look and no deck or sand measurement, and its tee marks are not
  measured against the card (`course-doctor.mjs`, "known"; the summary above). Its own tracer's review sheets
  are in an ignored cache. A trace under pipeline v2's stage 3 would fix it.
- **The holes were traced from one Esri picture, not from the Lantmäteriet orthophoto.** Greens, decks, fairways
  and routes were read by rule off the leaf-off capture of 28 April 2023 and the laser (§19), with 1-2 m of
  error and under a licence that blocks redistribution (§19.5, §15.6); the rule refuses all nine greens on the
  second dated capture, of 2 June 2019 (§20.2). The source manifest keeps `authoritative-playing-surfaces` and
  `reference-rights` open. The 0.16 m orthophoto of 17 May 2024 was acquired for the campus on 10 September; no
  record shows the holes traced on it, and §19.5 says a licensed orthophoto would halve the error.
- **The bunkers are ellipses, and four are unsettled.** All 18 are ellipses at their measured sand, ten of them
  moved 1-5 m onto the laser's hollow (§17, §20.1). The greenside bunkers on 5 and 8 show no sand in 2019, and
  two guide bunkers (left of 9's green, in shade, and south of 8's) were dropped as inconclusive
  (`ribbingsforsbuild/sat-shapes.json`). The orthophoto or a visit settles them.
- **Nine of the 27 tee marks have no deck.** The back tees on 3, 6, 7, 8 and 9 and four other marks stand at
  their card distance on a pad the app makes; marks that found a deck moved up to 22.9 m from their card point
  (§19.2). The two decks on 8 were dormant brown on the picture (§19.5).
- **The card's hole rows are not the club's.** Only the three nine-hole totals are official. The white rows are
  Caddee's and the yellow and red rows GolfTraxx's read as metres, so yellow is longer than white on 1, 4 and 5;
  the stroke indexes are unconfirmed (§3; `current-course-card`). A dated club card replaces every row at once.
- **The local rules are not drawn.** Out of bounds right of 3 and 9 and along the road on 6-8, and the one-sided
  red penalty areas left of 3, 5, 6 and 7, are open on the dossier's release list (§8, §13); the course model
  holds no geometry for them.
- **The trees are automatic.** They come from the 2023 laser, not placed one by one, and the protected-tree
  records are from 2005 and 2008 with no newer check (`vegetation-recency`). The tree pipeline has not been run
  here (`course-doctor.mjs`); it is its own sitting.
- **The lake's far shore is OpenStreetMap's, and two low islets are drowned** (§18, 5 September; the Noret islet
  crests 0.66 m above the lake). The neighbouring break-geometry items would put both right. The records do not
  say whether this still holds after the ring terrain of 11 September and the water rules of 7-8 November.
- **Parts of the campus are estimated:** heights, eaves, the terrace and every facade not photographed; all
  roofs but the clubhouse's and the range shelter's are roof massing. The lakeside pier is traced and not
  modelled, and the range has no measured tee ([README](../../ribbingsforsbuild/facilities/README.md), "Limits").
- **Not located or not traced:** the "Kraka-sten" landmark, exposed rock on mown ground, the boundary ditch
  south of hole 3, the peatland's drainage grid and any fences (§15.6).
- **No gate has been passed by a person.** The frame has no independent control, all 14 gates in the ground's
  `review.json` are pending, and the owner has given 0 of 63 hole-by-hole verdicts (`course-doctor.mjs`).

## Worth looking at

The posters lead with holes 9, 5 and 2 (the ground's `ground.json`; why those was not recorded): by the guides,
9 doglegs round a large pond in a hollow, 5 passes several ponds and 2 plays over water (§3.2). Also the
clubhouse with its deck, the manor, the range shelter and its nine mats, and Skagern as one sheet over a carved bed.

Most likely to be wrong: hole 2's tees (the warning above; their marks moved 11-18 m from the card points),
hole 3 (two of its three marks without a deck, a route that bends 50° within 34 m of the tee, and one of §16's
two soft spots), hole 8 (dormant decks, a back tee without one, a doubtful greenside bunker) and the greenside
bunkers on 5 and 9.

<!-- generated:holes -->
## Hole by hole

"Card" is the worst distance between a tee's mark and its card length. "To look at" lists what the checks flag;
an empty cell is no promise that the hole is right.

### Park & hagmark

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  | 4 | 11 | 343 m | 2 | 1 | creek |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=1&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=1&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=1&karta=1) |
| 2 |  | 3 | 13 | 175 m | 2 | 2 | water, creek |  | tee deck 2 stands at the water's own level beside water 6; the laser may be older than the ground | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=2&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=2&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=2&karta=1) |
| 3 |  | 4 | 1 | 362 m | 1 | 1 | water, creek |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=3&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=3&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=3&karta=1) |
| 4 |  | 4 | 7 | 331 m | 3 | 2 | water, creek |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=4&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=4&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=4&karta=1) |
| 5 |  | 5 | 5 | 465 m | 1 | 1 | water |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=5&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=5&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=5&karta=1) |
| 6 |  | 4 | 9 | 387 m | 1 | 3 | water, creek |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=6&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=6&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=6&karta=1) |
| 7 |  | 4 | 3 | 370 m | 1 | 4 |  |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=7&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=7&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=7&karta=1) |
| 8 |  | 3 | 17 | 175 m | 2 | 1 | creek |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=8&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=8&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=8&karta=1) |
| 9 |  | 5 | 15 | 502 m | 2 | 3 | water, creek |  |  | [tee](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=9&vy=tee) · [green](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=9&vy=green) · [map](https://olovmelander.github.io/olovs-hemsida/?bana=ribbingsfors&hal=9&karta=1) |
<!-- /generated:holes -->

## How each fault was found

The faults the records describe as found while building, what found each, and what holds it now. This ground
predates the numbered stages, so "Stage" says when. A fault that only a person's eye found is a check that did
not exist.

| Fault | Found by | Stage | Held now by |
| --- | --- | --- | --- |
| Skagern as a pale sand plate with a sawtooth edge: three sheets at one level over one lake, and no bed carved under the fixed terrain window | the owner's phone screenshots | after publication (§18, 5 September) | one lake ring (`lake-union.mjs`, gated in `apply-surroundings.mjs`); the ring and the bed's depth in `tools/check-ribbingsfors-v2.mjs`, a browser run |
| The driving range traced on a hayfield between the 9th and the 1st | the owner, shown the render, who marked the right field in red | after the first range trace (§21.1) | `trace-practice.mjs` grows the field from the owner's mark; the records name no test |
| The 2,048 m terrain window showing as a square: another ground colour, a height step of up to 3.1 m, other trees outside it | the owner's phone, 10 September | after publication (§22, §23) | the ring terrain of 11 September replaced the fixed window; the far trees' calibration is in the browser gate |
| Hole 9's yellow tee on the asphalt road (62.9% of its pad) | the records do not say | the first build (§7.4) | `tee-controls.json`; `ribbingsforsbuild/tee-road-clearance.test.mjs` |
| Five guide-formula bunkers where the picture shows no sand; bunker positions read by eye 7-20 m off | measuring the sand in the picture (`detect-sand.mjs`) | the bunker pass (§17) | `apply-sat-shapes.mjs` throws on sand over no laser hollow |
| Routes through woods on 5 and 6; 12 of 27 card marks on rough; the 9th's 480 mark on the 406's deck | the rule trace (`trace-surfaces.mjs`) | the surfaces pass (§19) | the contract in `tee-road-clearance.test.mjs`: every mark on a deck or declared without one |
| The clubhouse a rectangle on the lawn, 8.5 m off and 63° across its roof; then an "annex" that was the clubhouse's own shadow | measuring the roofs in the picture (§20.3); the 0.16 m orthophoto review of 10 September | the second opinions, then the campus pass | the authored campus, whose manifest suppresses the annex; `ribbingsfors-facilities.test.mjs` |

## Decisions

The records attribute two decisions on this ground to the owner:

- **The driving range is the pasture east of the 1st.** The owner marked it in red on the render; recorded in
  the dossier's §21.1, which is dated 5 September 2026.
- **The houses are drawn with the house kit.** The owner's request of 8 November 2026 for every course but
  Johannesberg brought this ground in ([the houses](../visual-houses-2026-11-08.md)).

No acceptance of this ground by the owner is recorded; its release policy is `advisory`.

Still the owner's to decide or do: the white material (rebuild the campus dimmer, or accept it as it was looked
at and say so here); the hole-by-hole look; whether to retrace the holes with the shared tracer and to place the
trees; asking the club for a dated card, the road rule's wording and permissions (§14); and pruning the 60 built
files that no published generation names (`promote.mjs --ground ribbingsfors --prune` lists them).

<!-- generated:checks -->
## Checking it yourself

```sh
node tools/check-course-quality.mjs --ground ribbingsfors          # terrain, card, tees, water, campus (CPU)
node tools/course-walkthrough.mjs --ground ribbingsfors --check    # this page against the records
node tools/course-walkthrough.mjs --ground ribbingsfors --pictures # the first pictures to take, as commands

pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641                      # then open http://127.0.0.1:8641/?bana=ribbingsfors&hal=1
BANVY_GPU=1 node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label look --adhoc ribbingsfors:1:tee:dag,ribbingsfors:9:green:kvall
BANVY_GPU=1 node tools/gpu-pass.mjs --only ribbingsfors --from boot-hi
```

The GPU and browser lines are the owner's to start (in PowerShell: `$env:BANVY_GPU=1` first).
<!-- /generated:checks -->

## Befores

- `?buildingGeometry=source` draws the mapped footprints instead of the campus (the `--baseline` of
  `ribbingsforsbuild/facilities/check-facility-runtime.mjs`).
- `?houses=before`, `?roofs=palette` and `?houseparts=all` are the house kit's befores, here as on every course.
- `?v2=0` is no longer a before: old opt-out links serve the same v2 ground (`tools/check-ribbingsfors-v2.mjs`).
- No record names a generation kept for rollback. Seven ground manifests lie in
  `apps/golf/public/grounds/ribbingsfors/`, the current `ground-v2-45c8d0ed….json` among them; which of the
  others is the before is not recorded.
- A before-and-after of the 3rd tee in Höst (2 November):
  `docs/graphics/night-2026-11-02/before-after-ribbingsfors-h3-tee-host.png`.
