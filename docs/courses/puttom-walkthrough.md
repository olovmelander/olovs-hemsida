# Örnsköldsviks Golfklubb: walkthrough

An 18-hole forest and parkland course of par 72 round Lill-Rössjön and Stor-Rössjön at Arnäsvall, north-east of
Örnsköldsvik, opened with nine holes in 1967 (architect Nils Sköld) and grown to eighteen in 1975 (`puttom`, built
in [puttombuild](../../puttombuild); sources and rights are in the [source dossier](puttom-source-dossier.md)).
It was built from 28 August 2026 with its own builder, before [pipeline v2](../pipeline-v2.md), as the pilot for
the 1 m ground, and this page is the list any later upgrade starts from.

<!-- generated:summary -->
## What is there

|  | Örnsköldsviks GK |
| --- | --- |
| Holes and par | 18, par 72 |
| Tees on the card | Vit 6,050 m, Gul 5,705 m, Röd 4,950 m, Orange 4,050 m |
| Greens, tee decks, fairways, bunkers | 18, 34, 24, 40 |
| Waste areas | none |
| Tee marks against the card | not measured |
| Outlines looked at ring by ring | no record |
| A second, blind look at them | none |
| Tee decks on level ground in the terrain | not measured |
| Posters, prepared data, scorecard | 5, 4 of 4, yes |

- **Ground:** 469 terrain tiles (terrain a mosaic of flights from 2020-06-16 to 2024-06-27, photo 2024-06-27, laser undated), 13 lakes and ponds, 23 creeks and ditches, 0 bridges. Generation `fe68ef6aa152`.
- **Trees:** automatic (251 object tiles, 256 stand tiles); not placed one by one.
- **Buildings:** 40 mapped, 39 with a roof colour measured on the photo; an authored campus of 25 parts (clubhouse, harbre, maintenance-hall, maintenance-long, maintenance-small, north-courtyard-building, range-east-hut, range-l-building, range-west-hut, site-camper-fence, site-courtyard-fence, site-courtyard-flags, site-range-apron, site-range-ball-dispenser, site-range-east-net, site-range-mats, site-range-west-near-net, trace-shed-c, trace-shed-d, west-cabin-a, west-cabin-b, west-lakeshore-pavilion, west-red-house, west-south-dark-shed, west-south-rust-shed), 34,445 triangles; 7 golf carts in 1 rows.
- **Quality gate:** 1 errors, 0 warnings (`tools/check-course-quality.mjs`); each is on its hole below. Not tied to a hole: facilities-v1: material "PUT MODEL | flagpole-white.002" linear luminance 0.8443 exceeds bloom-safe ceiling 0.82 (GLOW.threshold=0.86) (error).
- **Release:** policy `advisory`, frame `pending-control-approval`, open: `canonical-origin`, `authoritative-assets`, `legacy-imagery-rights`.
<!-- /generated:summary -->

## What is known not to be right

This list was drawn from the repository's records on 25 November 2026; nobody has looked at the course again for it.

- **The outlines have never been checked ring by ring.** Puttom was built with its own builder before the shared
  tracer: no decision files, no ring sheets, no second look, no deck or sand measurement (`course-doctor.mjs`).
  In their place stands the [orthophoto review of 9 September](../puttom-orthophoto-alignment.md), which redrew
  16 greens, 27 tee decks, 18 fairway rings and 34 bunkers on the June 2024 photo, where the model has 18, 34, 24
  and 40. Greens 3 and 15 lay in tree shadow and, like everything not redrawn, keep their older outlines.
  The fix is a `trace-config.json` and decisions for this ground, then the ring review.
- **Seventeen of the 72 tee marks stand on no mapped deck** (`puttombuild/mapping/alignment-audit.json`). Fifteen
  were never identified: Orange on 2, 4, 6-10 and 13-18, Vit on 11, Röd on 15. Two stand on a deck the photo
  shows but nobody outlined (1 Orange, 14 Röd), and eleven more on a deck whose edge was not reviewed. Holes 14,
  15 and 17 have no reviewed deck. The record asks for a numbered station or a visit to settle the fifteen.
- **No tee mark is measured against the card, and ten back-tee lines are more than 5 m off it** (`lineLen` in
  `puttombuild/course-model.json`): hole 10 is 407.8 m against 428, 4 is 450.2 against 465, 16 is 275.7 against
  289, 6 is 337 against 350, 18 is 337.6 against 348, and 2, 8, 13, 15 and 17 are 6-9 m short. The review moved
  marks to the decks the photo shows and kept the card; the records explain none of the ten. The club's own
  card also gives hole 11 index 6 and hole 16 index 12 (swapped here) and 350 m for 14's Röd tee (405 here).
- **The frame is not approved, and Puttom is still the pilot.** The source manifest leaves the origin unset
  (`pending-control-approval`) and records no independent origin anchor. The pack lives in a flat local frame
  about 63.2992 N, 18.9413 E facing true north, turned 3.52° onto the grid; its height step to RH 2000
  (23.6263 m) is measured, because the old heights never recorded their datum. It is the one course that
  `v2-terrain-select.mjs` sends through its own `PUTTOM_PREVIEW_CONFIG`, with a surface layer marked
  `migration-vectors-not-survey-approved`. Unreviewed Esri and GolfTraxx derivatives are still in the model
  (`legacy-imagery-rights`). The records read for this page do not say what would retire the pilot configuration.
- **The terrain is older than Lantmäteriet's current one.** The published ground was read on 11 September 2026.
  When the production pilot read it again (its baseline is 21 September), 10.2% of the finest samples differed
  beyond rounding, by up to 2.85 m across the ground and 1.09 m in the central 2,048 m, where the change "reaches
  the course core" (`docs/course-production-integration.md`). The staged build stops there on purpose. The fix
  is to review the revision, accept or correct it, and rebuild; the records do not say that this was done.
- **The trees are automatic and unreviewed.** Machine rules approved them: "no person reviewed them, by the owner
  decision of 2026-09-02" (`geo_data/course-v2/puttom/vegetation/vegetation-evidence.json`). The tree pipeline
  has not been run here, so there is no unseen benchmark and no measured conifer or broadleaf, and species come
  from the default mix (58% pine, 36% spruce, 6% birch). Two laser campaigns meet through the course at
  N 7025000 (June 2023 north, June 2026 south). The fix is a tree round in its own sitting.
- **One campus material is over the glow's ceiling**, the quality gate's one error: `PUT MODEL |
  flagpole-white.002` at linear luminance 0.8443 against 0.82. Dim it in the campus model
  (`puttombuild/facilities/models-2026-09-10`) and export again, or accept it.
- **Parts of the campus are estimated** ([geometry notes](../../puttombuild/facilities/models-2026-09-10/geometry-notes.md)):
  the connector's gable, Härbre's side shelter, the north courtyard roof, and two sheds at approximate places
  (`trace-shed-c`, `trace-shed-d`). The net's height is assumed. The pump house and junior cabin are not located.
- **The model lacks things the club's rules and plans describe** (dossier §12, §14): the pack holds no bridge
  where the rules name four (8, 10, 13, 18), and cart paths on fourteen holes, bell posts, the drop zones on 14
  and 15 and the pond by the 4th's Röd tee are missing. Lill-Rössjön's outline runs 34-46 m past the water at its
  south tip (dossier §5); the records do not say what is drawn there since the shores were redone on 7 November.
- **Nobody has given a verdict on any hole:** 0 of 126, and all fourteen release gates are pending
  (`course-workflows/puttom/review.json`), the phone's among them.
- **The old page no longer matches the pack:** `puttom3d.html`'s vector comparison fails, while its heights and
  108 card values pass (`docs/legacy-url-compatibility.md`). The records do not say whether to regenerate it.

## Worth looking at

At its best, by the records: the 12th over the bay of Stor-Rössjön (the posters' hole, and where the shores were
redone), 13 to 15 round the same lake, 4 round Lill-Rössjön, the 16th's 16 m climb, the 7th's blind hump that only
the laser showed, and 18 down to the campus: the clubhouse's glazed gable, Härbre, the range with its 17 mats, the
motorhome lot and the seven carts. Most likely to be wrong: hole 15 (no outline on it was redrawn and two of its
tees stand on no deck), green 3, the decks on 14 and 17, hole 10's length, the 14th's inlet where the lake's
outline is 14.9 m off the laser's shore, the south tip of Lill-Rössjön by the 4th, and the four bridges the
rules name.

<!-- generated:holes -->
## Hole by hole

"Card" is the worst distance between a tee's mark and its card length. "To look at" lists what the checks flag;
an empty cell is no promise that the hole is right.

### Örnsköldsviks GK

| Hole | Name | Par | Index | Back tee | Decks | Bunkers | Beside it | Card | To look at | Open |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Snäll öppning | 4 | 15 | 320 m | 1 | 2 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=1&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=1&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=1&karta=1) |
| 2 | Utslaget avgör | 4 | 5 | 326 m | 1 | 1 |  |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=2&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=2&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=2&karta=1) |
| 3 | Bunkrar runt om | 3 | 17 | 137 m | 2 | 3 | water |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=3&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=3&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=3&karta=1) |
| 4 | Runt Lill-Rössjön | 5 | 3 | 465 m | 2 | 4 | water |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=4&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=4&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=4&karta=1) |
| 5 | Lutande green | 3 | 11 | 175 m | 2 | 3 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=5&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=5&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=5&karta=1) |
| 6 | Håll vänster | 4 | 7 | 350 m | 1 | 2 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=6&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=6&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=6&karta=1) |
| 7 | Blint över kullen | 4 | 1 | 360 m | 2 | 2 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=7&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=7&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=7&karta=1) |
| 8 | Gratis skjuts | 4 | 13 | 346 m | 2 | 0 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=8&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=8&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=8&karta=1) |
| 9 | Nedför hem | 5 | 9 | 488 m | 3 | 3 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=9&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=9&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=9&karta=1) |
| 10 | Tvärdiket | 4 | 2 | 428 m | 3 | 2 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=10&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=10&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=10&karta=1) |
| 11 | Blinkfyren | 4 | 12 | 380 m | 2 | 3 | water, creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=11&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=11&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=11&karta=1) |
| 12 | Över Stor-Rössjön | 3 | 18 | 122 m | 3 | 1 | water |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=12&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=12&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=12&karta=1) |
| 13 | Runt sjön | 5 | 8 | 470 m | 2 | 4 | water |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=13&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=13&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=13&karta=1) |
| 14 | Över krönet | 5 | 10 | 466 m | 1 | 2 | water |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=14&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=14&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=14&karta=1) |
| 15 | En klubba extra | 3 | 14 | 180 m | 1 | 0 | water |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=15&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=15&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=15&karta=1) |
| 16 | Klockan | 4 | 6 | 289 m | 2 | 2 | water, creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=16&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=16&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=16&karta=1) |
| 17 | Minsta greenen | 4 | 4 | 400 m | 2 | 4 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=17&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=17&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=17&karta=1) |
| 18 | Utför mot klubbhuset | 4 | 16 | 348 m | 2 | 2 | creek |  |  | [tee](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=18&vy=tee) · [green](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=18&vy=green) · [map](https://banvy.olovmelander.workers.dev/?bana=puttom&hal=18&karta=1) |
<!-- /generated:holes -->

## How each fault was found

The faults the records describe as found while building, what found each, and what holds it now. Dates are 2026.

| Fault | Found by | When | Held now by |
| --- | --- | --- | --- |
| The names Stor- and Lill-Rössjön sat on the two largest rings, both 4 km from the course | the club's own text and the lake register, while the hole guide was written | open on 3 September, fixed on the 5th | `laser-features.mjs` stops unless each register coordinate lies inside the ring it names |
| The 7th's green stood 7.12 m above the ground: the old height model carries the canopy | `laser-features.mjs`, sampling the 1 m ground under every tee and green | 5 September | displayed heights come from the laser (`elevSrc: "laser"`); the tool reports `packGreenMinusLaser` |
| Four tee marks stood in Stor-Rössjön (12 Orange, 14 Röd, 15 Röd and Orange), and 16 Vit grazed its ring | the laser's water plate; the 16th earlier, by the pack gate's submersion probe | 5 September | `reconcile.mjs` slides a wet mark to the shore; the quality gate names a tee in water |
| Tee marks far from their decks: 14 Röd by 58.5 m, 16 Röd by 32 m, 6 Vit by 18.4 m, in the trees | the orthophoto review: the 2024 and 2022 photos against the club's numbered hole plans | 9 September | `alignment-audit.json` and `npm run check:puttom-mapping`; no ring review |
| The clubhouse was the wrong building, then had a blue lower storey read off a blue-hour photograph | the club's photograph, then the owner's drone photograph | the facilities trace; the notebook gives no date | the campus model of 10 September and its loader's checks; nothing checks a colour |
| OpenStreetMap's road cut the hub's bend by up to 10 m, so the car park sat on the road | a picture: the model drawn over the imagery (`tools/sat-mosaic.mjs`) | the facilities trace | the traced centreline and the `hubOverride` box in `sat-traces.json` |
| Six trees stood on the driving range while every numeric gate passed | a picture from overhead | 2 September, the first tree generation | the records name no check, only "look at the overhead before publishing" |
| A dark band, a gap and a lit skirt across hole 14, where the 1 m tiles met the older rings | seen on the course; the notebook does not say by whom | the first 64-tile pilot | one terrain to the horizon; `tools/world-capture.mjs` gates those views |
| Lakes a quarter metre up their banks, with straight chords for shores | the owner | 7 November | `water-plate-level.mjs` and `water-reach.mjs` with their tests; `audit-water-levels.mjs` |
| A white campus material over the glow's ceiling | `check-course-quality.mjs` | after the campus was published; the records give no date | nothing: open |
| This page's campus triangle count read 0, because the campus manifest carries no count a part | reading the page against the quality gate | 25 November, writing this page | the generator now takes the manifest's total, or the count the quality gate makes in the model |

## Decisions

Decided by the owner, with the date each record gives:

- **2 September 2026:** machine rules approve the measured trees and no person reviews them
  (`vegetation-evidence.json`; the notebook's vegetation chapter).
- **21 September 2026:** the orthophoto review runs for Puttom were authorized, which the record says "does not
  authorize unbounded acquisition, publication or geographic acceptance" (`docs/course-production-integration.md`).
- **7 November 2026:** no straight, sharp lines on the water, and "fix the water level in Puttom so it is aligned
  with the real measurements" (`docs/visual-water-shores-2026-11-07.md`): the lakes went to the laser's surface
  plus 6 cm, and under the one rule of 8 November a large measured lake stays within 10 cm of it.
- **8 November 2026:** the house kit and photo-measured roofs, at Puttom, Ängsö and Upsala first
  (`docs/visual-houses-2026-11-08.md`).
- **Undated in the notebook** (the facilities trace): the range's tee arc is open along its whole length, the
  range buildings stand square to the road as the owner drew them, and gravel roads take the lots' flat gravel.

Still the owner's to decide or do: the white flagpole material (dim it or accept it); the index of 11 and 16 and
the length of 14's Röd tee; a look through the 18 holes, and a real phone; whether to take the newer terrain and
to run a tree round; whether the 61 built files (21.1 MB) no published generation names may go (`course-doctor.mjs`).

<!-- generated:checks -->
## Checking it yourself

```sh
node tools/check-course-quality.mjs --ground puttom          # terrain, card, tees, water, campus (CPU)
node tools/course-walkthrough.mjs --ground puttom --check    # this page against the records
node tools/course-walkthrough.mjs --ground puttom --pictures # the first pictures to take, as commands

pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641                      # then open http://127.0.0.1:8641/?bana=puttom&hal=1
BANVY_GPU=1 node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label look --adhoc puttom:1:tee:dag,puttom:18:green:kvall
BANVY_GPU=1 node tools/gpu-pass.mjs --only puttom --from boot-hi
```

The GPU and browser lines are the owner's to start (in PowerShell: `$env:BANVY_GPU=1` first).
<!-- /generated:checks -->

## Befores

- `?waterlevel=before` stands Puttom's lakes by the ring-percentile rule again, a quarter metre up their banks;
  `?waterreach=0`, `?shorefade=0` and `?shoredamp=0` bring back the traced shores. Compare at `?bana=puttom&hal=12`.
- `?ditches=0` takes the water out of the ditches (8 November; 2.1 km of it here).
- `?reedlakes=0` plants reeds at the first lake's level only, as before 26 September (496 against 4,305).
- `?houses=before`, `?roofs=palette` and `?houseparts=all` are the house kit's befores (8 November).
- The records name no switch that draws the mapped footprints in place of the campus here.
- Three earlier ground manifests lie beside the published one in `apps/golf/public/grounds/puttom/`
  (`ground-v2-03ede20e…`, `2fe7fdb9…`, `a25ff2b3…`); the records do not say that any is kept for rollback.
