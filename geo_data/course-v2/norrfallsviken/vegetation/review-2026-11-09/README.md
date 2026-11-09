# Norrfällsviken tree placement (review 2026-11-09)

**Status (2026-11-09): published.** After seeing before/after screenshots on his GPU, the owner answered "Commit and merge to main in the recommended way". See Publication at the end. His checklist items stay open for him to mark.
This is the tree pipeline's second ground, the first after Johannesberg (owner request of 2026-11-09: "Can we try the brand new tree pipeline on a new course now, Norrfällsviken. So get the latest Lantmäteriet data from the api and start.").

- **The gate passes.** On 112 unseen held-out crowns (H1-H6) the chosen detector reaches P 0.938 / R 0.938. This is the first ground to pass the 90% gate without an owner exception. As the app would draw the trees (after the holds and reviews), P 0.953 / R 0.902.
- **Trees.** 39,450 trees are placed one by one in the inner 2,048 m window, against today's 4,246 individual records plus 17,358 stand trees.
- **Published.** Staged, checked on the GPU in before/after screenshots, adopted into the public root and re-baked (Publication, below).

Scope: one ground, one routing (`norrfallsviken`). The inner window is E 677939.5–679987.5, N 6987439.5–6989487.5, on the published ground's 256 m finest-tile edges. It holds all 18 holes and their 90 m play zone and is analysed with a 60 m halo. The frame is SWEREF 99 TM (EPSG:3006) with RH 2000 heights. The only provider is Lantmäteriet: no Skogsstyrelsen data and no surface model matched from aerial photos.

## Sources

The full record is in [`source-inventory.json`](source-inventory.json). Raw bytes stay in the ignored `norrfallsvikenbuild/cache/trees-2026-11-09/`.

| Source | Date | What was used | Integrity |
|---|---|---|---|
| Laser, Laserdata Nedladdning skog (`dsm-skoglig-copc`), scan area 25F014 | 2025-06-05, **leaf-on** | 3 COPC items of 2.5 km over the halo window (25f014-69850_6775_25, -69850_6800_25, -69875_6775_25), 216 MB. 1.85 first returns/m² in the inner window | size and SHA-256 pinned in [`laser-campaigns-trees-2026-11-09.json`](../../acquisition/laser-campaigns-trees-2026-11-09.json) |
| Orthophoto `orto-u2-2024` | 2024-06-27, leaf-on | presence: RGBI 0.16 m, 758 tiles; sun azimuth 236.6°, elevation 41.0° | per-tile SHA-256 |
| Orthophoto `orto-u2-2020` | 2020-05-22, as the birches came into leaf | leaf-off role: RGBI 0.16 m, 758 tiles; sun 176.7°, 47.5° | per-tile SHA-256 |

- **Newest data.** The laser is the newest campaign over the window. Lantmäteriet re-tiled its laser into 2.5 km items, and the ground's own accepted pin (`laser-campaigns.json`) names older ones that now return 404. The trees therefore have their own inventory over the halo window (`record-laser-campaigns --window`, added for this review): 97.9% coverage, and the rest is open sea where the fourth item does not exist. The ground's terrain pin is unchanged.
- **Photos.** There is no 2025 photo. 2024 is the newest; 2022 is older and leaf-on. The 2018 flight comes as separate RGB and CIR files at 0.25 m, which the pipeline's RGBI reader does not take.
- **Terrain.** The laser's ground agrees with the published terrain: median +0.01 m, |p95| 0.23 m.

### Photo registration (owner decision)

The leaf-on laser's near-ground intensity over this open heath is too smooth for the pipeline's patch correlation: only 2 and 3 patches of 111 and 74 were accepted, against the 30 the rule asks for. The new option `registration.highPassMetres` correlates both images minus a 6 m Gaussian. With it:

- 2024 sits 0.31 m from the laser on 19 accepted patches;
- 2020 sits 0.49 m from the laser on 11;
- the two photos agree with each other on 37 (bright band) and 40 (red band) patches;
- the loop closes within 0.15 m;
- sigma 1.5 m and 3 m gave the same 2024 shift within 0.05 m.

The owner accepted the direct shifts below 30 patches ("Apply measured shifts (Recommended)", 2026-11-09), recorded as `registration.ownerAccepted`, which is pinned to each pair and its patch count. The relief displacement |k| has a median of 0.31 (2024) and 0.22 (2020), so a 15 m pine is drawn 3-5 m from its laser apex.

## Method

The same pipeline and stages as at Johannesberg, with one difference in how the rounds are run.

**One sample, four detectors, scored once.** Johannesberg built its detector over six rounds, each with a new held-out sample. Here the sample was frozen first: 11 calibration windows (C1-C11) and 6 held-out windows (H1-H6), in [`reference-windows.json`](reference-windows.json). Johannesberg's four steps were then tuned in order, on calibration only:

- r1 typed (from the defaults);
- r2 refined;
- r3 fused (DeepForest crowns from the June 2024 photo on the GPU, confirming suppressed laser tops);
- r4, the width split extending r3 and kept off buildings (Johannesberg's round 6).

The selection rule was written into the windows file before anything was scored: the highest held-out F1 wins, and a round more than 0.03 below the best held-out precision is passed over. Round r4's benchmark then scored all four locks once on H1-H6. Rounds r2-r4 carry the same sample byte for byte (`reference-r*.geojson` are identical).

**The reference sample.**

- **Interpretation.** Agent-led interpretation (Claude) of the CHM and both photos at 0.16 m, moved onto the canopy by the relief displacement. It is not a survey.
- **How windows were chosen.** Windows were measured before declaration by `photo/window-measure.mjs` (detector-neutral apexes by stratum, leaf-off class, play zone, and distance to water and buildings): [`window-measure.json`](window-measure.json).
- **Strata.** Isolated, group, edge and closed canopy, shore (C4, H4), and gardens among houses (C5, C11, H3). Calibration lies in the west and south; the held-out windows lie in the east and north-east, on holes 5, 6 and 14-17.
- **Edits.** Every draft crown was checked on four panels. Roofs, the padel court's walls and lamps were rejected; uncertain tops became ambiguity boxes. The edits are listed in [`photo/reference-annotate-norrfallsviken.mjs`](../../../../../tools/tree-pipeline/photo/reference-annotate-norrfallsviken.mjs).
- **Size.** 181 scored calibration crowns and 112 scored held-out crowns.

## Benchmark (held-out H1-H6, 112 crowns, matching one to one within 4 m)

| Method | Calibration P / R / F1 | Held-out TP / miss / extra | Held-out P / R / F1 |
|---|---|---|---|
| **r1 typed (chosen, published by r4)** | 0.959 / 0.912 / 0.935 | 105 / 7 / 7 | **0.938 / 0.938 / 0.938** |
| r2 refined | 0.966 / 0.928 / 0.946 | 105 / 7 / 9 | 0.921 / 0.938 / 0.929 |
| r3 fused | 0.966 / 0.939 / 0.952 | 105 / 7 / 8 | 0.929 / 0.938 / 0.933 |
| r4 split | 0.966 / 0.945 / 0.955 | 105 / 7 / 8 | 0.929 / 0.938 / 0.933 |
| today's published trees + stands (2026-09-04) | 0.845 / 0.541 / 0.660 | 41 / 71 / 7 | 0.854 / 0.366 / 0.513 |
| the 1 m published-method detector | 0.942 / 0.448 / 0.607 | 55 / 57 / 4 | 0.932 / 0.491 / 0.643 |

Held-out recall of r1 by stratum:

- isolated 30/31, group 28/31, edge 22/24, closed 25/26;
- by height: 3-8 m 15/17, 8-15 m 76/81, 15 m and over 14/14.

**Gate: PASS** (P 0.938 ≥ 0.9, R 0.938 ≥ 0.9, 112 ≥ 30) on the r1 lock. Record: [`benchmark-r4.json`](benchmark-r4.json), SHA-256 `3bfe61ad…`.

**Why the simplest detector wins here.** The refinements Johannesberg needed do not help on this ground; each adds one or two extras on H1-H6 and finds no more crowns. Two things make this ground easier:

- **The laser is leaf-on.** The June 2025 scan sees every crown in leaf, while Johannesberg's April scan saw bare broadleaves and shared maxima in closed spruce.
- **Pine dominates.** Norrfällsviken's heath and coastal wood are pine (94% of the census apexes are conifer-like), with separate crowns that a 1.85/m² scan resolves. Even closed stands score 25/26.

**Secondary score (decides nothing).** As the app would draw them, after the holds, the bank rule and the reviews, the trees score P 0.953 / R 0.902 / F1 0.927 on H1-H6 ([`decided-candidates-score.json`](decided-candidates-score.json)). The four crowns lost against the raw detector are:

- one garden crown in H3, where the hold review called a roof what the reference called a crown;
- one in the coast wood H6, not investigated;
- two shore trees by the 14th, held on mapped water (see Open).

## Candidates

`--stage candidates` ran the r1 lock over the inner window: [`candidates.csv`](candidates.csv) (SHA-256 `135b5156…`) and [`candidates-summary.json`](candidates-summary.json).

| Decision | Count |
|---|---|
| placed (add 35,370, adjust 3,289, retain 791) | **39,450** |
| merged into a neighbour | 157 |
| held | 39 |
| not placed: not a tree (roofs, sheds, decks, caravans, vehicles, a mast) | 300 |
| removed: not a tree | 1 |

**Type.** 39,168 conifer, 272 unknown, 10 broadleaf. Near play (within 90 m): 6,234 conifer, 16 unknown, no broadleaf ([`species-mix.json`](species-mix.json)).

**Bank rule.** 102 crowns over a path, water, a fairway, the practice ground or a building got their stem on the bank (water 15).

**Held (39).**

- 12 crowns over played surfaces: big pines whose crowns cover a mapped fairway or the practice ground.
- 4 on water or a path (two of them are the 14th's shore, see Open).
- 3 structure suspects.
- 6 records without a crown.
- 14 reviewed unclear.

### Reviews (agent-led on the photo chips; not a field check)

- **Hold review** ([`hold-review.json`](hold-review.json), recorded by [`photo/record-hold-review-norrfallsviken.mjs`](../../../../../tools/tree-pipeline/photo/record-hold-review-norrfallsviken.mjs)). All 965 held crowns were looked at on 41 sheets:
  - 651 present: heath pines in shade or on pale lichen rock;
  - 297 not a tree: 115 roofs on mapped buildings and 182 roofs, sheds, decks and caravans, most of them in the holiday village, where many houses were built after May 2020 and are not mapped;
  - 3 banked, beside a building;
  - 14 unclear.

  A second pass found six wide roofs the first pass missed (447, 527, 537, 557, 570, 578). It redrew every present hold with a radius of 4 m or more, and every one of 2.5 m or more under 6.5 m tall: 48 chips, all pines.
- **Felling screen** ([`felling-review.json`](felling-review.json)): 4 screened, all structures (roofs). No tree was found felled since the laser.
- **Pole-like hold:** none screened ([`pole-review.json`](pole-review.json)).
- **Species spot check.** All 22 broadleaf calls of the first run were checked on chips:
  - about 10 broadleaves;
  - 6 small pines in deep shadow;
  - 2 roofs of unmapped houses;
  - 4 unclear.

  Both calls near play were wrong. The May 2020 share cannot tell these apart (all are below 0.025), but the June share can: the broadleaves read 0.27-1.0 and the pines below 0.03. Two changes followed:
  - The type rule now also asks for a crown in leaf in June 2024: `typeRule.broadleafMinimumPresenceShare` 0.15, the no-vegetation hold's own threshold.
  - The roof the holds missed is removed by a `spot` verdict in hold-review.json.

  10 broadleaf calls remain, all in the woodland.

## Type rule

`typeRule.broadleafMaximumAprilShare` is 0.08, below every reference conifer: the lowest is a shaded 18 m pine at 0.09. At Johannesberg's 0.2 the rule would have called one reference broadleaf right and two conifers wrong. The 22 May 2020 photo was flown as the birches came into leaf: 15 of the 16 reference broadleaves read as vegetated there.

So this photo gives few broadleaf calls. Unknown records and the stand field take the engine's conifer-led background mix: birch is 6% of it, and 70% near water. Garden birches are therefore drawn by that mix, not by a call. [`type-rule.json`](type-rule.json) fits a logistic rule with balanced accuracy 0.83 on calibration, but only 0.51 on the five held-out broadleaves. Pine/spruce was not measured.

## Open for the owner

1. **His checklist items** stay open for him to mark (only the owner marks owner items):
   - `species-mix-screenshots` and `runtime-cost-measured`: he has seen the screenshots below. Phones and low quality are not timed.
   - `felled-list-confirmed`: 300 not placed and 1 removed. All are structures; none is a felled tree.
2. **The lake outline by the 14th green lies about 10 m inland of the shore.** The laser shows ground under the wooded bank. Two shore trees stay held as on water: under leaf-on crowns the laser hits too little ground to prove land. A traced-geometry revision of the pack would free them; that is its own reviewed step.
3. **Holiday-village houses missing from the map.** Many houses in the village south and south-west of the course are not mapped (built after May 2020). The trees avoid their roofs through the review, but the map lacks the houses (the "nothing left off the map" rule).

## Publication (2026-11-09)

**Decision.** At the owner's request ("Grab some screenshots"), the trees were staged and photographed. He then answered "Commit and merge to main in the recommended way". The gate passed, so no exception is needed. His checklist items stay open for him to mark.

**Staged.** `--stage publish --execute --pending-owner` compiled the candidates into `output/course-workflow/norrfallsviken/staging-public`:

- ground-v2-96c81584…, 48,254 tree records, integrity verified;
- 39,450 new records in the inner window, with 39,168 conifer, 10 broadleaf and 272 unknown;
- 8,804 records outside the window, kept from the 2026-09-04 generation;
- 6,250 near play and 33,200 in the woodland.

**Adopted** into `apps/golf/public` (only Norrfällsviken's files changed):

- the course manifest course-v2-dd2ab466…;
- the ground manifest;
- 49 object and 58 stand chunks;
- the startup packs;
- both course indexes and the vegetation graph report.

The ground has no `production.json`, and its `workflow.json` stages are unconfigured, so nothing there needed re-pinning.

**Re-baked** for the new ground, on the GPU:

- water, the ground tints (exact), the far vista and scatter;
- the map land (Norrfällsviken's forest picture).

`check-prepared-startup` and `check-startup-packs` pass.

**Screenshots** (`tools/gfx-gallery.mjs`, RTX 5080, WebGPU, high quality, 1920 × 1080, Dag light; ignored `tools/goldens/gfx/nfv-before-vs-nfv-after/`). Views: the 1st from the tee and from above, the 6th, 15th, 17th and 18th tees, and the 9th and 14th greens. The woods between the fairways fill out to what the June 2024 photo shows. The open heath keeps its single pines.

GPU time per view (timestamp queries) rose by 0.3-2.2 ms. The 9th green rose most, 4.8 → 7.0 ms, which is well inside 16.7 ms. Draws fell (e.g. 257 → 187 at the 18th tee).

The course guide's aim point at the 18th moved from 187 m to 114 m, because it aims around trees.

Phones, low quality and WebGL2 are not timed.

**Checks.**

- Vitest `apps/golf`: 228 files, 1,945 tests.
- `lint-app` and `check-app-build`.
- `course-workflow` check and audit.
- Tree pipeline: 37 tests.

## Reproduce

```sh
node --env-file=<repository .env> tools/tree-pipeline.mjs --ground norrfallsviken --stage acquire --fetch
node tools/tree-pipeline.mjs --ground norrfallsviken --stage canopy
node tools/tree-pipeline.mjs --ground norrfallsviken --stage detect
node tools/tree-pipeline.mjs --ground norrfallsviken --stage verify && node tools/tree-pipeline.mjs --ground norrfallsviken --stage verify --relief
node tools/tree-pipeline.mjs --ground norrfallsviken --round r1 --stage reference --prepare --native
node tools/tree-pipeline/photo/reference-draft.mjs --ground norrfallsviken --round r1 --mpp 0.08
node tools/tree-pipeline/photo/reference-annotate-norrfallsviken.mjs
node tools/tree-pipeline.mjs --ground norrfallsviken --round r1 --stage reference --freeze   # then -r2..-r4: the same windows and annotations, frozen in turn
node tools/tree-pipeline.mjs --ground norrfallsviken --round r1 --stage benchmark --tune --types
node tools/tree-pipeline.mjs --ground norrfallsviken --round r2 --stage benchmark --tune
node tools/tree-pipeline.mjs --ground norrfallsviken --round r3 --stage photo-detect          # GPU
node tools/tree-pipeline.mjs --ground norrfallsviken --round r3 --stage benchmark --tune
node tools/tree-pipeline.mjs --ground norrfallsviken --round r4 --stage photo-detect          # keeps r3's crowns
node tools/tree-pipeline.mjs --ground norrfallsviken --round r4 --stage benchmark --tune
node tools/tree-pipeline.mjs --ground norrfallsviken --round r4 --stage benchmark --score --gate
node tools/tree-pipeline.mjs --ground norrfallsviken --stage candidates
node tools/tree-pipeline.mjs --ground norrfallsviken --stage review --only holds
node tools/tree-pipeline/photo/record-hold-review-norrfallsviken.mjs
node tools/tree-pipeline.mjs --ground norrfallsviken --stage candidates && node tools/tree-pipeline.mjs --ground norrfallsviken --stage review
```

The GPU photo detector is not deterministic between runs. A later round therefore keeps the crowns an earlier record holds unchanged (`photo-detect` default since this review; `--redo-all` redoes them). The first round-3 lock was re-tuned once after the round-4 record had re-run the detector; no held-out window had been scored at that point.
