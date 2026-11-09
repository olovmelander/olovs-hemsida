# Johannesberg tree placement (review 2026-11-08)

**Status (2026-11-08, published):** the inner 2,048 m frontier now carries the round-2 reviewed generation, published by the owner's decisions below although the held-out gate is not met, with broadleaf calls narrowed by the owner's species check (see Publication). Round 2 itself is described further down.

**Round 3 (branch `trees-round3`, accepted by the owner on 2026-11-08):** the photo-refereed detector replaces round 2 in the inner frontier. It reaches P 0.984 / R 0.685 on a new unseen sample drawn from the strata near play (round 2 0.984 / 0.674, round 1 0.971 / 0.764), so the gate is still not met. The owner chose: "Round 3 (Recommended): Accept round 3 below the 90% target, as you did for round 2." Pine/spruce was measured but not published, and the pole-like crowns were reviewed. See Round 3.

**Round 4 (branch `trees-round4`, published 2026-11-09 under the owner’s answer "The best round go!"):** On its own sample: a learned crown detector (DeepForest) on the June 2025 photo confirms suppressed laser tops. On a new unseen sample of 132 crowns it reaches P 0.935 / R 0.758 / F1 0.837, against round 3’s 0.966 / 0.644 / 0.773. It beats round 3 on F1 and recall but misses the owner’s precision floor of 0.95, so it was not published on that sample. Round 4b then drew a second unseen sample (X1-X5, 126 crowns) and declared its rule before scoring. There round 4 as locked reaches P 0.971 / R 0.810 / F1 0.883 against round 3’s 0.976 / 0.643 / 0.775 and round 4b’s 0.978 / 0.714 / 0.826, so round 4 is published (32,073 placed, +4,832), gate not met (recall), under the owner exception pinned to benchmark-r4b. See Round 4 and Round 4b.

**2026-11-09 (branch `trees-round5`):** the same round-4 lock is re-published with the held trees decided. Crowns leaning over mapped water, paths, roads and played surfaces get a stem on the bank (24, including the eight standing shore trees the owner missed at the 18th). Crowns held on buildings or without June 2025 vegetation were decided on the photos (174: 10 trees beside buildings and 14 shaded conifers placed, 98 roofs and posts and 4 thinned trees not). 32,122 are placed (+49). Round 5, a width split for two trees drawn as one, was scored once on a third unseen sample, Y1-Y8. It reached P 0.890 / R 0.808 / F1 0.847 against round 4's 0.948 / 0.758 / 0.843 and is not published (precision below the declared 0.95). See Round 5 and the held trees.

The sections from Evidence ledger to What Stage B needs record **Stage A (round 1)**
as it stood before publication: there, nothing was published, and the round-1 held-out
precision of 0.82 missed the 90% gate. Their candidate counts are round 1's; the published
set is round 2's (Publication).

Scope: one physical ground, two routings (`johannesberg`, `johannesberg-9`).
The inner 2,048 m frontier is E 678403.5–680451.5, N 6624276.5–6626324.5, and
it is analysed with a 60 m halo. The frame is SWEREF 99 TM (EPSG:3006) with
RH 2000 heights. The only provider is Lantmäteriet: no Skogsstyrelsen data and
no orthophoto-derived surface model.

## Evidence ledger

The full record is in [`source-inventory.json`](source-inventory.json).
Raw bytes stay in the ignored `johannesbergbuild/cache/trees-2026-11-08/`.

| Source | Date | What was used | Integrity |
|---|---|---|---|
| Laserdata Skog 21C039, re-tiled to 2.5 km items (updated 2026-10-14) | 2021-04-17, leaf-off (ALS80-HP) | `y21c039-66225_6775_25`, `66225_6800_25`, `66250_6775_25`, `66250_6800_25`: 9,802,900 returns in the window | Whole files cached; size and SHA-256 match the new pin |
| Orthophoto `orto-o2-2025`, RGBI 0.16 m | 2025-06-14 (two items from 2025-06-13) | 784 COG tiles covering the window (100% valid) and a 0.32 m mosaic | Per-tile SHA-256; band order R, G, B, NIR from the TIFF tags (photometric RGB plus one non-alpha extra sample) and STAC `rgbi` |
| Orthophoto `orto-o2-2021`, RGBI 0.16 m | 2021-04-18 (two items from 2021-04-08), leaf-off, the day after the laser | 784 tiles, 0.32 m mosaic | As above |
| Published 1 m RH 2000 terrain (the app's) | DTM items `662_67` (2021) and `662_68` (contains the 2023-05-16 capture east of E 680000) | Normalisation check; heights of the candidate tree bases | Republished: both DTM files now have new bytes and checksums with unchanged dates |

The account can also read `orto-o2-2023` (2023-05-10) and `orto-o2-2019`
(2019-07-20, leaf-on), both HTTP 206. They were not fetched.

**Re-pin.** The accepted laser pin's 10 km items now return 404. A dated
re-pin was written with the repository's own tools, beside the accepted files
rather than over them, because `production.json`, the source manifest and the
canopy evidence pin the old files' hashes. Adopting the re-pin is a Stage B
step.

- [`../../acquisition/laser-campaigns-2026-11-08.json`](../../acquisition/laser-campaigns-2026-11-08.json): 12 items, all active
- [`../../acquisition/copc-hierarchy-census-2026-11-08.json`](../../acquisition/copc-hierarchy-census-2026-11-08.json)
- [`../../acquisition/d2-discovery-2026-11-08.json`](../../acquisition/d2-discovery-2026-11-08.json)

With the new discovery file, `access-preflight --provider lantmateriet
--discovery …` reports *ready*. Against the accepted file it reports HTTP 404.

**Laser density, inner window.** 2.09 returns/m², 1.78 first returns/m².
61.7% of 0.5 m cells and 12.2% of 1 m cells hold no return.

**Normalisation check.** The cloud's own ground (class 2/9, 1 m mean) minus
the published terrain, over 3,345,873 measured cells: median 0.000 m,
p05 −0.065 m, p95 +0.070 m, |d| p95 0.10 m, |d| p99 0.19 m. There is no step
at E 680000, where the 2023 DTM begins. The |p95| is 0.078 m west and
0.076 m east (smoothed ground).

**Registration** ([`registration.json`](registration.json)). Each photo is
correlated against the laser on open ground only: patches whose CHM is below
0.5 m, never treetops. The laser side is near-ground intensity.

- 2021 photo against the laser: 56 patches, median shift 0.07 m, residual
  median 0.44 m, p90 1.52 m.
- 2025 photo: June grass correlates poorly with the April laser (only 16
  patches, unstable). It was therefore chained through the 2021 photo, which
  gave 12 patches, a 0.06 m shift and a 0.17 m residual median, with heavy
  tails.

No shift is applied (rule: at least 0.25 m). Relief displacement of crowns
in the photos is handled as a search allowance of 0.3 × height + 1 m. The
photos confirm and classify; the laser places.

## Method

All code is under `packages/course-v2/vegetation/` (tested) and
`tools/johannesberg-tree-pilot/` (the ground adapter).

1. **Pit-free CHM, 0.5 m** (`pit-free-chm.mjs`). This follows the layered
   approach of Khosravipour et al. (2014): layers at 0, 2, 5, 10, 15, 20, 25
   and 30 m, keeping the per-cell maximum. Each layer is interpolated on the
   grid instead of with a TIN: an empty cell is filled only when that layer's
   returns lie within 1.5 m (2 m for the ground layer) in at least three
   quadrants, by inverse-distance weighting. A median pit pass follows.
   Result: 0.64% void, and 489,659 pit cells lifted (2.6%).
2. **Detector v2** (`tree-detect-v2.mjs`). Treetops are local maxima of the
   CHM smoothed with σ 0.4 m, in a circular window whose radius grows with
   height: `clamp(1.5 + 0.05·h, 1, 3)` m. Crowns use Dalponte-style growth,
   but **simultaneous**: a priority-queue watershed. crown-detect.mjs grows
   crowns tallest-first, so a tall crown swallowed its neighbours' tops, and
   that alone raised calibration recall from 0.47 to 0.90. Crowns extend down
   to 0.2 of the apex height, and the position is the crown centroid.
   - The coefficients were chosen from 13,824 combinations on the calibration
     windows only, ranked by F1, then IoU, then offset
     ([`detector-lock.json`](detector-lock.json)).
   - A prominence merge was implemented and tested, but calibration did not
     select it.
3. **Conifer or broadleaf** ([`type-rule.json`](type-rule.json)). The rule is
   searched on matched calibration crowns. The best single rule is the share
   of vegetated pixels in the April 2021 crown disc, at least 0.506 for a
   conifer: evergreen needles are green on 18 April, bare twigs are not.
   - Balanced accuracy: 0.91 on calibration (67 crowns), **0.81 held-out**
     (28 crowns; conifer recall 0.75, broadleaf 0.88).
   - Leaf-off laser structure alone (first returns stopped at least 2 m up) is
     0.81 / 0.76.
4. **Present in 2025?** An absolute June "tree-ness" score failed: pines on
   rock read low. The screen therefore looks at change, outside closed stands:
   the crown's own shadow is present in April 2021 and absent in June 2025.
   Sun positions are computed for both flights.
   - The 64 screened crowns were each reviewed against the 2021 and 2025
     panels ([`felling-review.json`](felling-review.json)): 13 felled after
     2021, 18 not trees (roofs, vehicles, heaps), 19 present, 14 unclear
     (held).
   - Another 74 placed-looking crowns have no vegetation at all in the June
     disc. They are held, unreviewed.
5. **Sparse-laser broadleaf recovery.** Two or more returns of at least 3 m
   left outside every crown, where June 2025 shows a crown, give a tree at the
   highest return with its laser height: 301 trees.
   - Laser clusters without a June crown (71) are not placed.
   - Neither are June canopy patches with no return of at least 2 m within
     3 m (317, a heuristic list). Both are in [`unresolved.json`](unresolved.json).
6. **Identity.** Candidates are matched to the current published records:
   one-to-one within 1.5 m keeps the ID (*retain* if moved ≤ 0.5 m and
   unchanged within 1.5 m of height and 1 m of radius, otherwise *adjust*); a
   second pass to 3 m keeps the ID and records the move.
   - A record whose canopy is now carried by a neighbouring crown is
     **merged**: its ID is retired into that crown.
   - New IDs start at `tree-johannesberg-014795`, after the ground's highest
     sequence.
   - The previous generation's 2,417 IDs (`ground-v2-1f0f72bb`, renumbered by
     the 2026-09-11 re-run) are carried as `previousGenerationId` where a
     current record stands within 0.5 m: 2,394 carried.
   - Bases use the published terrain.

## Reference sample and benchmark

[`reference-windows.json`](reference-windows.json),
[`reference-annotations.json`](reference-annotations.json),
[`reference.geojson`](reference.geojson),
[`reference-lock.json`](reference-lock.json),
[`benchmark.json`](benchmark.json).

**Sample.** 132 scored crowns, all at least 3 m. There are 94 in six
calibration windows: hole 10 south (the owner's example), 11/12 edge, 4/16
meadow, the 3/16 spruce edge, 17–18 (the owner's example) and 3 isolated.
There are 38 held-out crowns in three windows on four holes: 1/2, 13, and the
9-hole course's 5/6. Margin crowns (70) only absorb predictions at the window
edges; ambiguity boxes are excluded from scoring.

**Matching.** One-to-one, closest first, within 4 m, declared before scoring.

**How the reference was made.** It is agent-led interpretation (Claude) of
the CHM and both photos, assisted by numbered over-segmentation apexes, which
were never a detector under test. The reference was re-frozen twice before any
held-out scoring, to fix a freeze-script bug and the reference crown segments;
the annotations were unchanged.

The **held-out window E1 (hole 8) was dropped before scoring**: it was closed
leaf-off broadleaf that could not be interpreted crown by crown.

**Caveat.** Reference centres are interpreted on the same laser CHM, so
centre offsets measure agreement with the interpreted laser crown centre, not
a stem.

| Calibration (94) | TP | Miss | Extra | P | R | F1 | Offset median / p95 (m) | Crown IoU |
|---|---|---|---|---|---|---|---|---|
| Published individuals | 9 | 85 | 0 | 1.00 | 0.10 | 0.18 | 1.33 / 2.18 | 0.64 |
| Published individuals + stand trees | 58 | 36 | 48 | 0.55 | 0.62 | 0.58 | 1.86 / 3.41 | 0.41 |
| Current detector (1 m), all crowns | 40 | 54 | 5 | 0.89 | 0.43 | 0.58 | 1.44 / 3.08 | 0.46 |
| **New detector** | 79 | 15 | 11 | 0.88 | 0.84 | **0.86** | 0.92 / 2.61 | 0.63 |

| Held-out (38) | TP | Miss | Extra | P | R | F1 | Offset median / p95 (m) | Crown IoU |
|---|---|---|---|---|---|---|---|---|
| Published individuals | 10 | 28 | 0 | 1.00 | 0.26 | 0.42 | 1.12 / 1.78 | 0.66 |
| Published individuals + stand trees | 26 | 12 | 12 | 0.68 | 0.68 | 0.68 | 1.47 / 3.05 | 0.51 |
| Current detector (1 m), all crowns | 23 | 15 | 0 | 1.00 | 0.61 | 0.75 | 1.34 / 3.02 | 0.61 |
| **New detector** | 37 | 1 | 8 | **0.82** | **0.97** | **0.89** | 1.08 / 2.38 | 0.63 |

- **Wilson 95% intervals, new detector, held-out.** P 0.69–0.91, R 0.87–1.00.
  These are purposive, spatially clustered samples, so the intervals describe
  the sample only.
- **Recall by stratum, new detector.**
  - Calibration: isolated 13/14, group 14/19, edge 34/37, closed 18/24;
    conifer 43/51, broadleaf 19/19.
  - Held-out: isolated 6/7, group 26/26, edge 5/5; conifer 11/11, broadleaf
    16/16. There are no closed crowns in the held-out windows.
- **Paired geometry** (references matched by both methods, held-out):
  - Against published individuals + stands (26): offset median 1.47 → 1.11 m,
    p95 3.05 → 2.38 m, IoU 0.51 → 0.63.
  - Against the current detector (23): 1.34 → 1.08 m, 3.02 → 1.96 m,
    0.61 → 0.65.
- **Post-evaluation diagnostic** (labelled as such; no tuning followed). Most
  of the 8 held-out extras split broad broadleaf crowns, chiefly in the 9-hole
  5/6 clump, where the reference itself is a judgement.

## Candidate tree set, inner ring (round 1; superseded by the published round-2 set)

Summary: [`candidates-summary.json`](candidates-summary.json). The full table
is [`candidates.csv`](candidates.csv): a QGIS delimited-text layer in
EPSG:3006, with ID, decision, position, base, height, radius, type, source,
lineage, move, before values and reason. Crown outlines and per-tree evidence
are in the cache (`candidates/`).

| | Trees |
|---|---|
| Today: published individual records | 2,458 |
| Today: stand trees, high quality, at hashed positions | 16,272 (8,297 at low quality) |
| **Candidate: placed individual crowns** | **26,834** (round 2 typing: 19,278 conifer, 6,446 broadleaf, 1,110 unknown; 5,730 near play, 21,104 woodland) |
| – add | 24,573 (24,272 detector + 301 sparse-laser recovery) |
| – adjust (ID kept) | 1,725 |
| – retain (ID kept) | 536 |
| Hold (not placed) | 333: 175 on a mapped building, 74 with no June 2025 vegetation (unreviewed), 41 structure suspects, 24 on water/road/path, 13 felling unclear, 5 over a played surface, 1 record without a crown |
| Merge (published record retired into a neighbouring crown) | 186 |
| Remove (published record, felled after 2021) | 1 |
| Not placed (reviewed: 12 felled after 2021, 18 not trees) | 30 |

Laser canopy of at least 3 m covers 0.93 km² (22%) of the window. That makes
the candidate about 290 trees per hectare of canopy, against today's
18,730 trees, mostly stand trees at random positions.

## Review images

These panels are laser-only. Each shows today on the left (blue circles:
published records; orange dots: stand trees) and the candidate on the right
(green retain, yellow adjust, cyan add, orange hold, red/purple/grey crosses
remove/merge/not placed; a square marks a conifer). The legend is in
[`review/spots.json`](review/spots.json).

- [hole 10 south](review/hole10-south.png) (the owner's example)
- [holes 17–18](review/holes17-18.png) (the owner's example)
- [3/16 conifer edge](review/hole16-spruce-edge.png)
- [4/16 meadow](review/hole4-meadow.png)
- [1/2 groups](review/hole2-tee.png)
- [9-hole 5/6](review/nine5-6.png)
- [hole 1, tee to green](review/hole1.png)

The same spots over the 2025 colour infrared and the 2021 natural-colour
photos are in `johannesbergbuild/cache/trees-2026-11-08/review-panels/`.
They stay out of git because the source catalogue's orthophoto
redistribution review is still `pending`.

## Open problems

- **Gate missed.** Held-out precision is 0.82 and calibration recall 0.84.
  The errors are over-segmented broad broadleaf crowns and merged adjacent
  spruces in closed stands; calibration closed-stand recall is 18/24.
- **Tall closed broadleaf canopy cannot be checked.** The owner's hole 10
  example is 22–29 m canopy, continuous on a leaf-off 1.8 pulse/m² scan. Only
  one crown there was interpretable, so its 90 candidate crowns are
  detector-only and unverified.
- **Felling and thinning.** These are screened only outside closed stands.
  Two reviewed sites look thinned but are unresolved. A newer leaf-on laser,
  or the club, would settle them.
- **Roofs and vehicles.** 18 of 64 screened crowns were roofs, vehicles or
  heaps; 74 no-vegetation crowns and 41 structure suspects are held,
  unreviewed.
- **Weak inputs.** The 2025 registration rests on 12 patches. Relief
  displacement is an allowance, not a per-image model. The photo-only list is
  a heuristic.
- **The reference is interpretation.** It is not a stem survey, and is a
  judgement in clumps.

## What Stage B needs

1. **Adopt the dated pins.** Move the laser, census and discovery files into
   place, and update `source-manifest.json`, `production.json` and the canopy
   evidence together. Review the republished DTM files: their bytes changed.
2. **Choose the representation.** All 26.8k crowns as individual records, with
   the stand fields' eligibility minus crown footprints, or stands kept for
   closed interiors.
   - This is 43% more instances than today, and tree meshes are the frame's
     largest cost. Measure on the owner's GPU, low quality and phones.
3. **Add an import path to the compiler.** `compile-vegetation` re-detects; it
   needs a path that takes these reviewed candidates (IDs, decisions, merges,
   holds) instead.
   - Publish through `publish-vegetation` into a staging root for both
     routings.
   - Write review images per routing. The 9-hole run overwrote `hole-01..09`
     of the 18-hole set.
   - Re-bake the prepared data, the map trees (`tools/bake-map-trees.mjs`) and
     the startup packs.
4. **Carry the conifer/broadleaf type into the runtime.** Records carry
   `subtype: null` and `planV2Vegetation` picks species by hash, so this needs
   a scoped runtime change with its own tests.
5. **Decide the 333 holds and the unresolved lists.** Keep the current IDs;
   the old generation's IDs are lineage only.

## Round 2: type-aware detection and a new held-out sample

**Gate: not met.** The 90% precision and recall gate is still missed on a new
unseen held-out sample: round 2 reaches P 0.95 but R 0.79. Round 2 also does
not beat round 1 on that sample (F1 0.863 against 0.869), so it does not earn
its place. **The candidate set stays round 1's**; round 2 only adds the `play`
and type-confidence fields.

The photo-based crown detector (DeepForest on the GPU) was **not run**: the
owner deferred it. No GPU work, CUDA or PyTorch was used or installed.

### What changed in the method

Code: `tree-detect-v2.mjs` (`typeMapFromPhoto`, `detectTreetopsTyped`,
`detectTreesTyped`, `splitOversizedCrowns`) and `round2.mjs`. All of it is
tested.

1. **A conifer/broadleaf map before detection.** For every CHM cell of at
   least 2 m, it takes the share of vegetated pixels in the 2021-04-18 photo
   (the day after the laser) in a box of half-size 1.5 + 0.15·h m. A cell is
   conifer when that share is at least 0.35.
2. **Per-type detector settings.** Each type has its own smoothing, treetop
   window, minimum height, merge threshold and position. The minimum height
   is tested on the unsmoothed CHM, so smoothing no longer drops young trees
   below it.
3. **Broadleaf merge.** A broadleaf top less than 0.5 m above the saddle to a
   taller neighbour is merged into it (the valley-depth / crown-shape test).
4. **Oversized-conifer split.** Conifer segments much larger than a spruce of
   their height are re-searched for touching tops. This was implemented and
   tested, but calibration never selected it.
5. **Tuning.** 1,149 settings were tried by coordinate descent on the
   calibration windows only, starting from the round-1 lock and ranked by F1,
   then IoU, then offset ([`detector-lock-r2.json`](detector-lock-r2.json)).
   The selected settings:

   | Setting | Conifer | Broadleaf |
   |---|---|---|
   | Smoothing σ | 0.4 m | 0.4 m |
   | Treetop window radius | `clamp(1.5 + 0.05·h, 1, 3)` | `clamp(2 + 0.12·h, 1, 3)` |
   | Minimum height | 2 m | 3 m |
   | Merge into neighbour | — | top < 0.5 m above the saddle |
   | Position | centroid | centroid |

### The new held-out sample

Files: [`reference-windows-r2.json`](reference-windows-r2.json),
[`reference-annotations-r2.json`](reference-annotations-r2.json),
[`reference-r2.geojson`](reference-r2.geojson),
[`reference-lock-r2.json`](reference-lock-r2.json).

- **Frozen before any round-2 scoring.** The matching rule (4 m one-to-one)
  and the ambiguity boxes were declared at the same time.
- **The round-1 held-out windows are now `used-holdout`.** Their scores had
  been seen.
- **52 scored crowns on holes not used before:**

  | Window | Place | Contents |
  |---|---|---|
  | H1 | 9-hole course, 9th tee / 1st green | young broadleaves |
  | H3 | 7th green | closed mixed stand, 25 m square |
  | H4 | between the 8th and 12th | closed mature spruce, 25 m square |
  | H5 | 9th | woodland edge |

- **Strata:** 23 closed, 10 edge, 15 isolated, 4 group; 23 conifer,
  25 broadleaf.
- **Dropped before any scoring.** A clear-cut window whose regrowth is younger
  than the laser, and a young dense pine stand whose 2 m crowns are finer than
  the scan resolves.
- **Now used.** The new sample has been scored once, so any further tuning
  needs another unseen sample.

### Benchmark

From [`benchmark-r2.json`](benchmark-r2.json): one-to-one matching within
4 m; P = precision, R = recall.

| | Calibration (94) P / R / F1 | Used held-out (38) P / R / F1 | **New held-out (52)** P / R / F1 |
|---|---|---|---|
| Published individuals + stand trees | 0.55 / 0.62 / 0.58 | 0.68 / 0.68 / 0.68 | 0.75 / 0.58 / 0.65 |
| Current detector (1 m), all crowns | 0.89 / 0.43 / 0.58 | 1.00 / 0.61 / 0.75 | 1.00 / 0.44 / 0.61 |
| Round-1 detector | 0.88 / 0.84 / 0.86 | 0.82 / 0.97 / 0.89 | **0.92 / 0.83 / 0.87** |
| Round-2 detector | 0.94 / 0.84 / 0.89 | 0.90 / 0.92 / 0.91 | **0.95 / 0.79 / 0.86** |

**New held-out recall by stratum** (round 1 → round 2):

| Stratum | Round 1 | Round 2 |
|---|---|---|
| Isolated | 13/15 | 13/15 |
| Group | 4/4 | 4/4 |
| Edge | 8/10 | 7/10 |
| **Closed** | **18/23** | **17/23** |
| Conifer | 17/23 | 17/23 |
| Broadleaf | 22/25 | 21/25 |

**By window**, as hits / misses / extras, round 2:

| Window | Hits | Misses | Extras |
|---|---|---|---|
| H1 young broadleaves | 17 | 1 | 0 |
| H3 closed mixed | 7 | 2 | 1 |
| H4 closed spruce | 10 | 4 | 1 |
| H5 edge | 7 | 4 | 0 |

The published population gets 10/23 closed crowns, and stand-tree centres lie
2.07 m from the crowns they match.

**Paired geometry, new held-out:**

| Comparison | Shared crowns | Median offset | p95 offset | IoU |
|---|---|---|---|---|
| Round 1 → round 2 | 39 | 0.79 → 0.78 m | 2.17 → 2.30 m | 0.57 → 0.57 |
| Published individuals + stand trees → round 2 | 26 | 2.07 → 0.77 m | — | 0.35 → 0.57 |

### Why the gate fails

The failure is **closed stands**: 17/23. Of these, the closed spruce reaches
10/14 and the closed mixed stand 7/9, with the edge at H5 7/11.

Touching spruces 2.5–3 m apart at 14–20 m height usually share one maximum on
a leaf-off scan of 1.8 first returns/m². Every way of seeing more tops added
false trees as fast as real ones on calibration:

- smaller conifer windows;
- less smoothing;
- splitting by crown size.

For example, a conifer window base of 1.0 instead of 1.5 m gained 4 trees and
added 7 false ones. The reference in closed stands is itself interpretation
of the same data. Isolated trees, groups and broadleaves are close to or
above 0.9 recall.

**What could move it:** a leaf-on or denser laser, field checks of closed
stands, or the photo-based crown referee that was deferred.

## Publication (Stage B, 2026-11-08)

### Owner decisions of 2026-11-08

These are recorded here and in [`../RUN`](../RUN).

1. **Publish even though the gate is missed.** The workflow's 90% precision and
   recall gate is not met on the unseen held-out sample: round 2 reaches
   P 0.953 and R 0.788. The shortfall is in closed stands, where touching
   spruces in the 2021 leaf-off scan give recall 17/23. This is a limit of the
   data. Isolated trees (13/15), groups (4/4), broadleaves (21/25) and conifers
   (17/23) meet or approach the gate. The exception, the stratified numbers
   (Round 2 above), the holds and the unresolved lists stay recorded.
2. **Use the round-2 (type-aware) detector.** The owner chose it after the
   held-out scoring, for fewer false trees on open ground. This is a
   post-evaluation owner choice, not the declared F1 ranking, under which
   round 1 scored 0.869 against round 2's 0.863.
3. **Every placed tree stands on its own detected treetop as a record.**
   - `near` trees and `woodland` trees are both individual records.
   - Low quality thins the woodland records by id, at the stand field's keep
     share of 0.55.
   - Only canopy that no crown claims is topped up as a stand field.

### What was published

The candidate set was regenerated with the round-2 detector, using the same
decision rules and ID carry-forward as round 1, plus the new `play` and type
fields. That changes it from round 1's set:

- **More screened crowns were reviewed.** 13 felling-screened crowns appeared
  at new positions and were reviewed in [`felling-review.json`](felling-review.json),
  which now covers 77 screened crowns.
- **New published ground:** `ground-v2-0af708ff…` for both routings. (A first
  publication, `ground-v2-700fcf2d…`, was never committed: the owner's species
  check below replaced it the same day.)
- **Content:** `compile-vegetation.mjs --reviewed candidates.csv` with residual
  canopy, then `publish-vegetation`. It was published first to a staging copy of
  the public root (verified with `verify-staging.mjs`) and then adopted. The
  live root is identical to staging.
- **Prepared startup data** was re-baked for all 13 layouts (the engine
  changed), and Johannesberg's two routings again after the species check.

Inner 2,048 m frontier: 26,249 placed records.

| Placed records | Conifer | Broadleaf | Unknown | Total |
|---|---|---|---|---|
| near | 3,894 | 705 | 812 | 5,411 |
| woodland | 16,002 | 1,980 | 2,856 | 20,838 |
| **Total** | **19,896** | **2,685** | **3,668** | **26,249** |

A broadleaf call needs a clearly leafless April crown (Species check below).

Of the placed records, 24,027 are added, 1,662 adjusted (ID kept) and 560
retained (ID kept). Other decisions:

| Decision | Count |
|---|---|
| Hold | 211 |
| Merge (ID retired into a neighbouring crown) | 223 |
| Remove (felled) | 1 |
| Not placed (reviewed felled or not a tree) | 25 |

Holds by reason:

| Reason | Count |
|---|---|
| On a building | 77 |
| No June 2025 vegetation, unreviewed | 68 |
| Water, road or path | 25 |
| Structure suspect | 22 |
| Felling unclear | 13 |
| Over a played surface | 3 |
| Record without a crown | 3 |

ID carry-forward: 2,222 of the 2,458 published IDs are kept. The previous
generation's IDs remain as lineage (2,394). New IDs start after
`tree-johannesberg-014794`.

- **Residual canopy:** of 92.6 ha of canopy at least 3 m tall in the frontier,
  crowns claim 91.96 ha and exclusions 0.11 ha. The remaining 0.51 ha (0.55%)
  becomes a 4 m stand field: 35 stand trees at high quality.
- **Outside the frontier:** the 192 outer finest tiles keep the 2026-09-11
  records (12,336) and stands byte for byte.

| Trees drawn | High quality before | High quality after | Low quality before | Low quality after |
|---|---|---|---|---|
| Inner 2,048 m frontier | 18,730 | 26,284 | ~10,755 | ~16,892 |
| Whole 4,096 m level zero | 112,768 | 120,322 (+6.7%) | ~64,646 | ~70,783 (+9.5%) |

These counts are before the runtime's played-surface refusal. Low-quality
counts use the planter's own hashes.

**Runtime.** A conifer record draws pine or spruce, keeping the course rule's
choice when it is already a conifer. A broadleaf record draws the rule's
broadleaf or birch. An untyped record (unknown, or any other ground) keeps
today's rule. At Johannesberg, which has no species rule of its own, that is
the engine's background mix (58% pine, 36% spruce, 6% birch), with birch at 70%
within 28 m of water. The stand field (residual canopy and the outer tiles)
takes the same rule. Nothing falls back to broadleaf.

### Species check (owner request, 2026-11-08)

In the owner's before/after screenshots of the first publication, the
play-area trees and hole 17's far edge had turned mostly birch. On hole 1,
birches stood left of the fairway where spruces had stood. Johannesberg
(Gottröra, Uppland) should read as a conifer/broadleaf mix. Three questions
were checked.

**(a) Counts.** These are what the app plants: high quality, the
`johannesberg` routing, from `runtime-trees.mjs`. Zone A is within 90 m of a
hole line, B within 300 m, and C is beyond. Conifer means pine plus spruce.
"First publication" is the uncommitted `ground-v2-700fcf2d…`.

| Conifer / broadleaf (broadleaf share) | Before (main) | First publication | Published |
|---|---|---|---|
| Individual records, zone A (near play) | 391 / 21 (5.1%) | 4,016 / 1,078 (21.2%) | 4,523 / 571 (11.2%) |
| Individual records, zone B | 1,068 / 64 (5.7%) | 7,005 / 1,709 (19.6%) | 7,728 / 986 (11.3%) |
| Individual records, zone C | 12,553 / 683 (5.2%) | 21,540 / 3,127 (12.7%) | 22,722 / 1,945 (7.9%) |
| Stand field (fill), zones A and B | 9,083 / 459 (4.8%) | 549 / 36 (6.2%) | 549 / 36 (6.2%) |
| Stand field (fill), zone C | 83,841 / 4,490 (5.1%) | 76,991 / 4,111 (5.1%) | 76,991 / 4,111 (5.1%) |
| **All trees** | 106,936 / 5,717 (5.1%) | 110,101 / 10,061 (8.4%) | 112,513 / 7,649 (6.4%) |

The stand field never changed species: its broadleaf share is the background
rule's ~5% before and after. On the 9-hole routing, zone A goes from
155 / 43 (21.7%) to 64 / 178 (73.6%). There
the April photo shows leafless groves (grey crowns casting long shadows, all
in leaf in June), so these are real broadleaves, not shaded conifers.

**(b) Spot check on the photos.** Within 90 m of hole 1's line, the first
publication typed 74 of 125 placed crowns broadleaf; within 90 m of hole 17's,
it typed 111 of 256. `type-panels.mjs` drew a deterministic sample of 12
broadleaf calls per hole. Each was drawn on four images: April 2021 colour
infrared, April 2021 natural colour, June 2025 natural colour and June 2025
colour infrared. The panels are kept in the ignored cache only.

| Verdict on the photos | Calls | April vegetated share |
|---|---|---|
| Broadleaf: grey, leafless April crown, light June crown | 10 (3 uncertain) | 0–0.37 |
| Conifer: red in April colour infrared, in a neighbour's shadow or at an edge | 8 (3 uncertain) | 0.26–0.40 |
| Not a tree: a pole by the road or path (crown radius 0.28 and 0.75 m) | 2 | 0 |
| Unclear or mixed crown | 4 | 0.04–0.41 |

Below a share of 0.2, none of the 11 sampled calls was a conifer. Between 0.2
and the logistic's broadleaf limit of 0.41, 8 of 13 were conifers.

**(c) Where the fill gets its species.** The stand field (the residual canopy
inside the frontier, and every stand outside it) and every unknown record take
the engine's background rule: 58% pine, 36% spruce and 6% birch, with birch at
70% within 28 m of water. Nothing falls back to broadleaf. The extra birch came
from the classifier's broadleaf calls alone.

**The fix.** A broadleaf call now needs a clearly leafless April crown, a share
below 0.2 (`BROADLEAF_MAXIMUM_APRIL_SHARE` in `build-candidates.mjs`). This is
an owner-requested, post-evaluation change. The evidence for it:

- the spot check above;
- 17 of the 35 reference broadleaves lie below 0.2;
- none of the 60 reference conifers lies below 0.27.

Between 0.2 and the conifer call the type is now `unknown`, with no
`typeConfidence`, so the background mix chooses. That moves 2,591 rows from
broadleaf to unknown: 2,551 placed, 37 held, and 3 removed or not placed. No
position, height, radius, decision or ID changed. The residual rasters and the
stand fields are byte-identical to the first publication, and every placed
tree stands where it stood.

The type check against the references now reads:

| Sample | Correct of typed (unknown), after | Before |
|---|---|---|
| Calibration | 59 of 62 (8) | 60 of 64 (6) |
| Used held-out | 16 of 18 (9) | 22 of 25 (2) |
| New held-out (evaluation) | 39 of 40 (5) | 44 of 45 (0) |

The references were sampled across closed, edge, group and isolated
windows, and there the mid-share calls were mostly right. Near the holes they
were mostly shaded conifers. Calling them unknown loses some true
broadleaves to the conifer-led background, about 6% birch. That error is the
safer one.

**Still open.** 138 placed crowns are under 1 m in crown radius yet at least
5 m tall; 35 of them are near play. Two of the 24 sampled were poles. A
radius-and-photo hold for pole-like crowns is the next rule to test against
the references.

### Runtime cost

These were measured on the owner's RTX 5080 laptop GPU, with `BANVY_GPU=1`,
WebGPU and `tools/frame-time.mjs` at 1920 × 1080 with the frame cap lifted.
Each side had three runs of 240 frames each, interleaved before/after at each
quality. Before is main's build (`ground-v2-fd6ebbe8…`); after is this one.
The table gives the median over runs of each run's median frame interval, in
milliseconds.

| View | High quality, before | High quality, after | High p95, before → after | Low quality, before | Low quality, after | Low p95, before → after |
|---|---|---|---|---|---|---|
| Hole 1 tee | 3.6 | 4.2 | 5.1 → 5.2 | 3.7 | 3.3 | 6.4 → 5.8 |
| Hole 12 tee | 5.8 | 7.6 | 8.4 → 12.9 | 3.7 | 5.7 | 5.0 → 7.1 |
| Hole 14 tee | 4.4 | 5.6 | 5.5 → 7.7 | 1.0 | 1.2 | 3.4 → 4.6 |
| Hole 7 from above | 4.2 | 5.3 | 5.9 → 9.1 | 2.3 | 3.4 | 4.1 → 6.1 |
| Hole 12 orbit | 6.5 | 9.3 | 9.0 → 15.1 | 1.2 | 1.2 | 6.2 → 9.4 |
| Hole 5 tee | 4.6 | 5.5 | 8.0 → 12.2 | 3.3 | 3.9 | 5.2 → 7.6 |
| Hole 1 walk (moving) | 4.7 | 4.8 | 10.1 → 11.7 | 3.9 | 3.8 | 6.2 → 7.0 |

- **Trees drawn.** At high quality, 112,653 → 120,162; at low quality,
  64,578 → 70,666. Triangles rise most where the frontier's woods face the
  camera: hole 12 at high quality goes from 10.5 M to 15.2 M.
- **Repeatability.** The three runs of each side agree within 0.8 ms.
- **The cost.** The heaviest view, hole 12's orbit at high quality, goes from
  6.5 to 9.3 ms median and 9.0 to 15.1 ms p95. That is still inside the 60 fps
  budget of 16.7 ms, but with little room to spare.
- **Not measured.** Phones and the WebGL2 backend have no timing here.

### Checks

- `corepack pnpm test`: Vitest 2,161 of 2,161 passed in 260 files; Node 493 passed, 0 failed, 3 skipped.
- `node tools/lint-app.mjs`: clean.
- `node packages/course-v2/check-app-build.mjs`: passes, with all 13 published graphs.
- `corepack pnpm check:course-workflow`: passes.
- `node tools/check-prepared-startup.mjs --public apps/golf/dist`: passes after
  the Johannesberg re-bake.
- `tools/check-gpu-clean-boot.mjs`, both routings, WebGPU and WebGL2, at high
  and at low quality: all 8 boots clean (6.0–7.7 s; at most 14 vertex outputs).
- `verify-staging.mjs`, on both the staging and the live root: integrity true,
  38,585 tree records (19,896 conifer, 2,685 broadleaf, 16,004 untyped).
- `production.mjs --inspect`: every pinned input verifies except the seven
  ring rasters (see The republished terrain).
- `check-tree-shadows` was not run: no tree shader, catalogue or shadow code
  changed.
- `bake-map-trees` was not needed: the catalogue is unchanged. Map land was
  re-baked; its forest picture is unchanged, since the stands did not change.
- **Screenshots.** `tools/gfx-gallery.mjs --adhoc` took before/after shots at
  1920 × 1080 under the Dag light, waiting for `loadingTiles === 0` and two
  more frames. Views: hole 1 from the tee and from above, hole 17 from the tee
  and the green, hole 18 from the tee, and the 9-hole course's 5th. They are
  in the ignored `tools/goldens/gfx/jb-trees-before-vs-jb-trees-after/`.

### Pins adopted

The dated pins replace the accepted records, with no hand-edited hashes:

- `acquisition/laser-campaigns.json`: 12 re-tiled items;
- `copc-hierarchy-census.json`;
- `d2-discovery.json`;
- `vegetation/canopy-evidence.json`: rebuilt by `build-canopy` from the 6 items
  that reach the ground.

Each is re-pinned in `source-manifest.json` by `record-artifact-checksum.mjs`.
`course-workflows/johannesberg/production.json` changes:

- `baselineGround`: the new generation, `ground-v2-0af708ff…`;
- `vegetation.reviewMode`: `reviewed-candidates-v1`, pinning `candidates.csv`
  and the residual rasters;
- `workflow.json`: re-configured.

### The republished terrain

The two republished DTM files were reviewed by
`build-ground-rings.mjs`, recorded in
[`../../acquisition/ground-rings-2026-11-08-republished-dtm.json`](../../acquisition/ground-rings-2026-11-08-republished-dtm.json).

**Level 0 differs from the published terrain** over the 4,096 m level zero.

| Measure | Value |
|---|---|
| Mean absolute difference | 2.4 mm |
| Maximum difference | 0.18 m |
| Samples beyond the 0.011 m baseline tolerance | 39 |
| Samples beyond 5 cm | 8 |
| Worst sample | E 677830, outside the frontier |

**The published terrain is kept.** Adopting the republished DTM is a separate
terrain source revision.

**This blocks the production workflow's terrain stage.** `production.mjs
--inspect` now verifies every pinned input except the seven ring rasters,
which can no longer be rebuilt from the republished source. So
`pnpm course run` cannot rebuild the ground from source until a terrain
revision is reviewed. The vegetation was published through the ground
vegetation chain (`publish-vegetation`, staging first), which
the workflow's `reviewed-candidates-v1` adapter reproduces from the same pins.

### Review images

- **Per routing:** `../review/johannesberg-hole-NN.png` and
  `../review/johannesberg-9-hole-NN.png`. Names no longer collide; the old
  `hole-NN.png` files are removed.
- **Spots:** `review/*.png` here, before against after, including `hole1`.

## Per-tree play zone and type (introduced on the round-1 set; the published round-2 counts are under Publication)

These are columns in [`candidates.csv`](candidates.csv); the counts are in
[`candidates-summary.json`](candidates-summary.json) under `playTypeDecision`.

- **`play`** is `near` within 90 m of any hole's tee-to-green line of either
  routing (the app's zone A, `LEGACY_ZONE_A_METRES`), or of the driving range
  and practice greens. Otherwise it is `woodland`.
- **`type`** comes from a logistic fit of conifer probability on the April
  vegetated share, fitted on round-1 calibration examples only.
  `typeConfidence = max(p, 1 − p)`, and the type is `unknown` below 0.6.
  - It agrees with the interpreter on 42 of 45 typed new held-out crowns
    (2 unknown), and on 38 of 38 at confidence 0.8 or more.
  - On the used held-out sample it agrees on 22 of 25.
  - Since the species check of 2026-11-08 (Publication), a broadleaf call also
    needs an April share below 0.2, and an unknown carries no confidence.

Decisions are unchanged from round 1. The type column now carries the
confidence-gated type.

| Placed (retain / adjust / add) | Conifer | Broadleaf | Unknown | Total |
|---|---|---|---|---|
| near | 3,871 | 1,630 | 229 | 5,730 |
| woodland | 15,407 | 4,816 | 881 | 21,104 |

The holds split 71 near and 262 woodland. Merges: 42 near, 144 woodland.

## Round 3: a photo referee, a sample from the strata near play (accepted by the owner)

**Status: accepted by the owner on 2026-11-08, on branch `trees-round3`.** The
round-3 detector beats round 2 by the declared F1 on a new unseen sample, but it
does **not** meet the 90% gate.

The owner was asked: "Johannesberg trees: round 3 still misses the 90% target (finds 69% vs round 2’s 67% on 89 new hand-checked trees, both 98% right), but removes 12 roofs/poles drawn as trees and 2 felled trees, and adds 992 real ones. Which should go live?" He chose: "Round 3 (Recommended): Accept round 3 below the 90% target, as you did for round 2."

His exception is recorded in `course-workflows/johannesberg/trees.json` under
`ownerExceptions`, pinned to benchmark-r3 (SHA-256 `295c03ec…`) and restating
P 0.984 and R 0.685. It sits beside round 2's exception and does not replace it.
Until his decision the round was staged under `pendingOwnerApprovals`, now empty.

The owner's question was whether recall can reach 0.9 with precision at least 0.9,
on the newest Lantmäteriet data, with CPU-only methods. On a sample drawn from the
canopy near play it cannot: recall is 0.685.

### Data: still the newest available

Checked on the STAC catalogues on 2026-11-08 (metadata only):

| Source | Newest over the window |
|---|---|
| Laser, stac-hojd | `dsm-skoglig-copc`, scan 21C039 of 2021-04-17. The catalogue's only other collection is `dtm-cog`, whose `662_68` item says a 2023-05-16 capture east of E 680000 exists, but its point cloud is not offered. |
| Orthophotos, stac-bild | `orto-o2-2025` (2025-06-14), still used. Of the 90 collections from 2023 on, only it covers the window. `orto-o2-2023` (2023-05-10) exists and was not needed. No 2026 collection covers Johannesberg yet: `a2`, `b2`, `f2`, `g2`, `j2` and `n2` 2026 do not. |

Nothing newer or denser can be fetched. A denser or leaf-on laser would need a new
Lantmäteriet campaign over Gottröra.

### The photos are not where the trees are

Standard orthophotos are rectified on the ground model, so a crown top of height h
is drawn at **k × h** from its laser apex. The new `verify --relief` step measures k
for every 64 m block ([`relief-displacement.json`](relief-displacement.json)). It
correlates the photo with a hillshade of the CHM lit from the flight's own sun.

- The median |k| is 0.42 for June 2025 (p10 0.26, p90 0.68) and 0.37 for April
  2021 (0.23-0.56).
- k grows away from each image's nadir line and flips sign at the mosaic seams, so
  a 20 m spruce is drawn 5-15 m from its laser apex.
- The earlier evidence disc allowed 0.3 × h + 1 m, which is too small for about half
  the window. Rounds 1-2 did not use the photo to place anything, so their
  positions are unaffected.

Every round-3 photo reading uses this field: the panels, the referee, the
pine/spruce features and the chips.

### The new sample (frozen before any round-3 detector ran)

[`reference-windows-r3.json`](reference-windows-r3.json),
[`reference-annotations-r3.json`](reference-annotations-r3.json),
[`reference-r3.geojson`](reference-r3.geojson),
[`reference-lock-r3.json`](reference-lock-r3.json).

The windows were drawn by round 2's rules on holes that no earlier window used. The
strata follow the detect census **near play** ([`strata.json`](strata.json)):
53% closed, 32% edge, 10% group and 5% isolated apexes within 90 m of a hole line.
Round 2's sample had 29% isolated crowns; this one has 3%.

| Window | Place | Scored crowns |
|---|---|---|
| Q1 | closed conifer square in the wood south of the 5th green | 17 |
| Q2 | woodland edge along the 5th, with trees standing out from it | 21 |
| Q3 | the mixed tree band between the 18th and the 2nd | 17 |
| Q4 | the broadleaf grove north of the 4th green (touching crowns) | 26 |
| Q5 | closed mixed square by the 6th tee | 8 |

- **Strata:** 50 closed, 30 edge, 6 group, 3 isolated. **Types:** 44 conifer,
  39 broadleaf, 6 unknown. **Heights:** 3-8 m 9, 8-15 m 45, 15 m+ 35.
- **Calibration** keeps C1-C6 and adds two closed squares in the southern wood: K1
  (22 spruces between the 10th and 11th) and K2 (13 conifers north of the 9th
  green). It now has 129 scored crowns.
- The round-1 (E2-E4) and round-2 (H1, H3-H5) held-out windows are
  `used-holdout`: never tuned on, reported for comparison.
- **"Beats round 2"** was declared in the windows file before scoring: higher F1
  on Q1-Q5, with precision at least 0.9.
- **Interpretation** is agent-led (Claude), not a survey. It used the CHM and both
  photos at their native 0.16 m, moved onto the canopy (`reference --prepare
  --native`). The C, E and H windows keep their round-2 crowns verbatim; round 3
  added only pine/spruce calls.

**Limitation.** In closed stands the reference interprets the same laser and the
same photos the detectors read. Where touching crowns share one laser maximum and
one photo blob, the interpreter's split is a judgement. A field check of Q1, Q5, K1
and K2 would settle it.

### The method: photo-refereed recovery

[`tree-refine.mjs`](../../../../../tools/tree-pipeline/tree-refine.mjs),
[`detector-lock-r3.json`](detector-lock-r3.json).

The refined detector keeps round 2's type-aware settings. It then looks again at
every top the type-aware detector suppressed: a maximum of the CHM smoothed by
0.3 m in a 1 m window, at least 3 m. Such a top is taken back as a tree only when:

- **its own cone:** it stands at least 1.25 m above the lowest point toward every
  taller kept top within 6 m, and at least 2.5 m from the nearest one;
- **its own apex in the points:** at least 3 first returns within 0.75 m reach
  within 1.5 m of its height;
- **a separate crown in the June 2025 photo:** read where the photo draws each top
  (0.75 × k × h), the photo is at least 10% darker between the two tops than at the
  dimmer one.

Every crown is then regrown from the full set of seeds at once. The laser decides
where there is canopy and how tall each tree is; the photo never places a tree.

The settings came from a coordinate descent on calibration only (49 evaluations).
Before it, an exploration on calibration windows compared a laser-only rule, a
point-apex rule and photo valleys from April and June. The April photo and an AND of
both photos did worse than June alone. A laser-only recovery (dip and apex, no
photo) reached calibration recall 0.915 but precision 0.868.

### Benchmark

[`benchmark-r3.json`](benchmark-r3.json): one-to-one matching within 4 m.

| Detector | Calibration (129) P / R / F1 | Used held-out (90) P / R / F1 | **New held-out (89)** P / R / F1 |
|---|---|---|---|
| Published individuals + stand trees (before round 2) | 0.57 / 0.52 / 0.54 | 0.72 / 0.62 / 0.67 | 0.77 / 0.52 / 0.62 |
| Current 1 m detector | 0.90 / 0.34 / 0.49 | 1.00 / 0.51 / 0.68 | 0.96 / 0.28 / 0.44 |
| Round 1 | 0.905 / 0.814 / 0.857 | 0.870 / 0.889 / 0.879 | 0.971 / 0.764 / 0.855 |
| Round 2 (published) | 0.946 / 0.814 / 0.875 | 0.927 / 0.844 / 0.884 | 0.984 / 0.674 / 0.800 |
| **Round 3 (refined)** | **0.926 / 0.868 / 0.896** | **0.929 / 0.878 / 0.903** | **0.984 / 0.685 / 0.808** |

The gate result is **FAIL**: recall 0.685 against 0.9, over 89 scored crowns
(61 found, 28 missed, 1 extra). Wilson 95% intervals: P 0.91-1.00, R 0.58-0.77.
These are purposive samples, so the intervals describe the sample only.

**Recall by stratum, round 2 → round 3:**

| | New held-out | Used held-out (rounds 1-2) | Calibration |
|---|---|---|---|
| Closed | 35/50 → 35/50 | 17/23 → 19/23 | 42/56 → 48/56 |
| Edge | 20/30 → 21/30 | 12/15 → 13/15 | 34/40 → 35/40 |
| Group | 2/6 → 2/6 | 27/30 → 27/30 | 15/19 → 15/19 |
| Isolated | 3/3 → 3/3 | 20/22 → 20/22 | 14/14 → 14/14 |
| Conifer | 30/44 → 30/44 | 28/34 → 30/34 | 69/86 → 76/86 |
| Broadleaf | 24/39 → 25/39 | 35/41 → 36/41 | 19/19 → 19/19 |
| 3-8 m | 4/9 → 4/9 | 26/29 → 26/29 | 16/22 → 16/22 |
| 8-15 m | 29/45 → 29/45 | 35/44 → 39/44 | 34/40 → 36/40 |
| 15 m+ | 27/35 → 28/35 | 15/17 → 14/17 | 55/67 → 60/67 |

**By window, new sample, round 3 (hits / misses / extras):** Q1 13/4/0, Q2 13/8/1,
Q3 11/6/0, Q4 20/6/0, Q5 4/4/0.

**Round 2's old sample (H1, H3-H5):** round 3 finds 44/52 with 2 extras (P 0.957,
R 0.846), against round 2's 41/52 with 2 extras (P 0.953, R 0.788). The closed
spruce square H4 goes from 10/14 to 12/14.

### Why 90% is still out of reach here

1. **The referee works where the reference is spruce in closed stands.** On
   calibration, closed recall rises from 42/56 to 48/56 and K1's 22 spruces are all
   found. On the old held-out windows, closed rises from 17/23 to 19/23.
2. **The new sample's misses are mostly something else.** This is a tally made
   after scoring, labelled as such; nothing was tuned on it.
   - Of 28 misses, 15 are closed, 9 edge and 4 group, and 16 are 8-15 m tall.
   - 14 are broadleaves: Q2's edge and group trees, the grove of Q4 and the young
     mixed crowns of Q5. On the leaf-off CHM, bare twigs return few points, so
     touching broadleaf crowns merge with no sharp top to recover.
   - 14 are conifers, and 10 of those are crowns the interpreter called pine, in
     Q1, Q3 and Q4. A pine's rounded or flat crown, touching its neighbours, has no
     apex for the referee's point test; the referee was built on spruce, and
     calibration holds 16 pines against 47 spruces.
3. **Why round 1 finds more trees in closed stands on the new sample (38/50
   against 35/50), from calibration data only.**
   - **Closed spruce: the same.** On calibration, rounds 1 and 2 find exactly the
     same closed crowns (42/56) and the same 105 references overall (recall 0.814
     each). Round 2's conifer settings are round 1's.
   - **Broadleaves: where they differ.** Round 2 has a wider treetop window
     (`clamp(2 + 0.12 h, 1, 3)` against `clamp(1.5 + 0.05 h, 1, 3)`) and merges a
     broadleaf top less than 0.5 m above the saddle into a taller neighbour.
   - **How many broadleaf crowns each places.** Counted over the calibration
     windows by the leaf-off type at each crown:
     - round 1 places 55 broadleaf crowns, round 2 44 and round 3 43;
     - inside the calibration ambiguity boxes, which are mostly C1's closed
       broadleaf canopy of 22-29 m, round 1 places 26 broadleaf crowns and round 2
       20.
   - **What calibration can score.** It removed 5 extras (11 → 6) at a cost of 2
     edge crowns (36/40 → 34/40). The 19 scored calibration broadleaves are all
     isolated, group or edge trees, and both rounds find them all.
   - **What calibration cannot score.** Calibration holds **no scored closed
     broadleaf crown**: C1's are an ambiguity box because they could not be
     interpreted crown by crown. So calibration rewards the merge for its fewer
     extras and cannot weigh what it costs among touching broadleaves. The new
     sample's closed crowns include Q4's grove and Q5, which are just that.
   - **No calibration-only fix exists.** Every scored calibration signal favours
     round 2's broadleaf settings. Changing them now would be choosing by the
     held-out score, which the protocol forbids, so nothing was changed.
   - **What would fix it:** a round 4 with calibration windows of interpretable
     closed broadleaf crowns (a grove photographed leaf-on, say), the broadleaf
     settings re-tuned there, and a fresh unseen sample to trust the result.
     No detector was chosen by its held-out score.
4. **Literature.**
   - Kaartinen et al. (2012, *Remote Sensing* 4:950) found the extraction method
     mattered far more than point density, at 2-8 points/m² in southern Finland's
     spruce/pine/birch.
   - Eysn et al. (2015, *Forests* 6:1721) matched 47% of trees overall in Alpine
     plots, 35% in multi-layer conifer and 38% in multi-layer mixed stands. Below
     15 m, 14-32%. This held even at high densities.
   - Wang et al. (2016, *IEEE TGRS* 54:5011) found dominant trees detectable and
     intermediate or suppressed trees mostly missed.

   The interpreted reference here is mostly dominant and codominant crowns. Its 0.69
   recall in closed and edge canopy is in that published range, not beyond it.
5. **What would close the gap:**
   - a field check of the closed windows (Q1, Q5, K1, K2, H3, H4) to settle the
     reference;
   - a leaf-on or denser laser campaign (Lantmäteriet has none here yet);
   - the photo-based crown detector the owner deferred;
   - a reference sample with more broadleaf edge and grove crowns in calibration, so
     the broadleaf merge can be weighed there.

### Pine or spruce: measured, not published

[`subtype-rule-r3.json`](subtype-rule-r3.json), `benchmark --subtypes`.

The interpreter called 123 of the 163 reference conifers pine or spruce on chips of
both photos. Spruce reads dark, dense, pointed and regular; pine reads lighter and
loose, with a bare stem. These calls read the same photos the rule reads, so they
are not a field identification.

- **Features per detected crown:**
  - laser: radius over height, return-height quantiles, upper-crown share, apex
    sharpness and intensity;
  - photo, at the displaced crown: colour and NIR texture.
- **Chosen on 63 calibration conifers (16 pine, 47 spruce):** pine when April blue
  ≥ 64 AND radius/height ≥ 0.194. Balanced accuracy 0.873.
- **On 49 held-out conifers:** accuracy 0.694, balanced 0.628 (pine 27/33, spruce
  7/16). The new sample alone gives 21/26 pine and 0/1 spruce.
- **The publication rule, declared first,** needed 30+ held-out conifers, accuracy
  ≥ 0.9 and balanced ≥ 0.85. **Not met.**
- **Second look: a confident subset.** The bar for it was declared before it saw a
  held-out conifer.
  - A ridge logistic over the six best calibration features. The cut was chosen on
    calibration, where it kept 40 of 63 conifers at 95%.
  - On held-out it called 19 of 49, and 11 were right (balanced 0.556). On the old
    held-out windows all 11 were right (10 spruces, 1 pine); on the new sample all
    8 were wrong, pines called spruce.
  - The April photo's colour does not carry from one flight strip to the next.
  - **Not met either.**
- **So no subtype is published.** Every conifer keeps the runtime's pine/spruce mix
  (pine 0.58 : spruce 0.36 by hash). Pine/spruce drawn before and after: unchanged
  in proportion. The +992 records are mostly conifers, so the drawn pines and
  spruces grow by about that share.

**The plumbing is in place for a ground where the rule passes:**

- `object-registry-tree-species-v1` lets a record's `subtype` name a measured
  pine or spruce. A chunk carries the feature only when one of its trees does, and
  a runtime without the feature refuses the chunk.
- The compiler takes an optional `species` column.
- The runtime draws a measured pine or spruce as that species (`speciesForType`).
- The candidates stage writes the column only from a published rule.
- Tests cover all four.

Today's published chunks are unchanged. The engine and package edit does change the
source revision, so every course's prepared startup data is stale until the
combined re-bake.

At about 1.8 first returns/m² a crown holds too few returns for shape. Photo colour
changes with the flight strip and the light, and the ALS-only accuracies of 90-95% in
the literature (Holmgren & Persson 2004) used far denser scans.

### Pole-like crowns: reviewed

[`pole-review.json`](pole-review.json). The hold is on (`holds.poleLike`: radius
under 1 m, 5 m or taller). It held 206 placed crowns, and each was decided on
compact chips. The chips show June 2025 colour and April 2021 colour infrared at
0.16 m, centred between the laser base and the displaced top.

| Verdict | Crowns | What they are |
|---|---|---|
| Tree | 162 | narrow trees squeezed between neighbours in closed stands (many are recovered tops), regrowth and edges |
| Not a tree | 12 | 7 on roofs (ridges, a chimney, an edge), a flagpole, a lamp post, a power pole, a pole on a lawn, and a bare snag in the open; not placed |
| Unclear | 32 | held: 9 in a broadleaf band by the 6th tee thinned after the 2021 laser, 16 retention trees or snags in clear-cuts made before it, 7 others |

The two poles found in the earlier sample of 24 were of the same kind. Poles and
masts stand in the open by buildings, lawns and roads.

Three new felling-screened crowns were also reviewed
([`felling-review.json`](felling-review.json)): two conifers south of the 8th tee
are gone by June 2025, and one is present.

**An unresolved site.** The band of tall broadleaves between the 6th tee and the
5th green, about 70 × 100 m, was thinned or partly cleared after April 2021. June
2025 shows forwarder ruts and young growth there. The laser of 2021 still carries
its canopy, so most of its records stand, 9 pole-like ones are held, and the stand
is listed for the owner. Its 2021 crowns are visible to the felling screen only
where they stood outside the closed canopy.

### What is published on this branch

- **Candidates** ([`candidates.csv`](candidates.csv)) start from the published
  round-2 generation (`ground-v2-0af708ff…`), so its IDs carry forward. 26,164 of
  26,249 published IDs are kept in scope.
- **Staging:** `--stage publish --execute` compiled, published and verified it in
  `output/course-workflow/johannesberg/staging-public`. Integrity is true, with
  39,577 tree records.
  - It was first staged pending the owner. After his decision it was staged again
    under his exception, with the approved review statement.
  - The ground generation is the same, `ground-v2-4f2d022d…`: the statement lives
    only in the published vegetation report, not in the graph.
  - The publish receipt records the gate as passed by the owner's exception. It
    lists the owner checklist items that need the GPU as still open.
- **Adoption** into `apps/golf/public` on this branch: `ground-v2-4f2d022d…` for
  both routings.
- **production.json** pins it, together with `candidates.csv` (`944aad9c…`) and the
  residual rasters. Its note quotes the owner's decision.

| | Round 2 (published) | Round 3 (staged) |
|---|---|---|
| Placed records, inner frontier | 26,249 | 27,241 (+992) |
| retain / adjust / add | 560 / 1,662 / 24,027 (vs the 2026-09-11 generation) | 23,595 / 2,569 / 1,077 (vs round 2) |
| Hold / merge / remove / not placed | 211 / 223 / 1 / 25 | 238 / 40 / 8 / 31 |
| Conifer / broadleaf / unknown | 19,896 / 2,685 / 3,668 | 20,818 / 2,690 / 3,733 |
| Near play: records, broadleaf share | 5,411, 13.0% | 5,745, 12.2% |
| Residual canopy as stand field | 0.55% | 0.54% |
| Tree records, whole 4,096 m level zero | 38,585 | 39,577 |

The added trees stand in the conifer woods by holes 8, 10 and 12. Near-play records
there go up by 8%, 10% and 9% respectively. The broadleaf share near each hole
changes by at most two points from round 2. The species-mix flags are holes 4, 5, 6
and 15 and eight holes of the 9-hole course, where the April photos show leafless
groves; their shares are within two points of round 2's.

**Re-baked** (on the GPU, before the owner turned it off): the prepared ground tints,
water and far vista/scatter for both Johannesberg routings, and the map land record.
`check-prepared-startup` then passed for every course, and the map's forest picture
is unchanged.

The later pine/spruce plumbing edits `apps/golf/src/engine/v2-vegetation.mjs` and
`packages/course-v2`, which are part of the source revision. So **every course's
prepared startup data on this branch is now stale** until one combined re-bake.
That re-bake is to run after #156 and this branch are synced with main, where #157
and #158 re-baked every course. The offline detector itself lives in
`tools/tree-pipeline/` and expires nothing.

### Screenshots and frame time

Taken on the owner's RTX 5080 laptop GPU before he turned the GPU off. Before is
PR #156's public root (b9df07df) on this branch's code; no app, engine or package
source differed at the time.

**Screenshots:** `tools/gfx-gallery.mjs`, 1920 × 1080, Dag light, waiting for
`loadingTiles === 0` and two frames. Views: hole 1 from the tee and from above,
hole 6, 8, 10 and 12 tees, the 17th green and the 9-hole course's 5th tee. They are
in the ignored `tools/goldens/gfx/jb-r3-before-vs-jb-r3-after/` of the
tree-pipeline worktree.

The views read alike. The changes are recovered trees inside the closed woods and a
handful of poles by buildings. GPU time per view (timestamp queries) moved by -1.1
to +0.3 ms.

**Frame time:** `tools/frame-time.mjs`, WebGPU, 1920 × 1080, frame cap lifted,
240 frames, interleaved before/after. Values are milliseconds of rAF interval.

| View | High: median before → after | High: p95 before → after | Low: median before → after | Low: p95 before → after |
|---|---|---|---|---|
| Hole 1 tee | 4.2 → 4.3 | 5.0 → 5.3 | 3.4 → 3.3 | 6.4 → 6.6 |
| Hole 12 tee | 7.8 → 7.7 | 12.9 → 13.1 | 5.0 → 5.2 | 7.3 → 8.4 |
| Hole 14 tee | 5.9 → 6.2 | 8.1 → 8.6 | 1.1 → 1.1 | 4.8 → 4.9 |
| Hole 7 from above | 5.4 → 5.4 | 9.5 → 10.3 | 3.1 → 3.2 | 6.8 → 7.3 |
| Hole 12 orbit | 9.5 → 9.8 | 14.8 → 15.7 | 1.3 → 1.3 | 9.1 → 9.4 |
| Hole 5 tee | 5.7 → 5.6 | 12.9 → 13.1 | 3.8 → 4.0 | 7.7 → 8.4 |

- **High quality:** the median over three runs per side. Runs of one side agree
  within 0.5 ms.
- **Low quality:** the mean of two runs per side. The third pair was stopped when
  the owner turned the GPU off.
- **Trees drawn:** 120,162 → 121,146 at high quality and 70,666 → 71,336 at low.
  Triangles at hole 12 rise from 15.2 M to 15.8 M.
- **The cost** is within the run-to-run spread for medians and up to about 1 ms at
  p95. The heaviest view, hole 12's orbit at high quality, stays at 9.8 ms median
  and 15.7 ms p95, inside 16.7 ms.

These were taken before the pine/spruce runtime edit, which does not change what is
drawn while no record carries a species. Phones and WebGL2 have no timing here.

### Checks

Final runs, after merging main (#157, #158) and recording the owner's decision. All
ran on the CPU only, one at a time, at low priority on two cores.

- `pnpm exec vitest run apps/golf --maxWorkers=2`: 1,929 of 1,929 passed in 228
  files.
- Node tests (the `pnpm test` list, `--test-concurrency=1`): 522 passed, 0
  failed, 3 skipped. This includes the round-3 pipeline tests and the registry and
  compiler species tests.
- `node tools/lint-app.mjs`: clean.
- `node packages/course-v2/check-app-build.mjs`: passes, all 13 published graphs
  (vite build at low priority).
- `pnpm check:course-workflow`: passes.
- `check-prepared-startup --public apps/golf/dist`: **fails, as expected**.
  - The species runtime edit, together with main's changes, gives source revision
    `818ce1af…`. Against it, all 13 layouts are stale on every prepared record:
    both tints, the water, and the vista and scatter at both qualities.
  - They wait for one combined re-bake.
  - Before the runtime edit this check passed for every course.
- **The republish under the owner's exception** changed one published file only,
  `johannesberg-vegetation-graph-report.json`, which carries the review statement.
  The graph is byte for byte the same (`ground-v2-4f2d022d…`, 39,577 tree records,
  integrity true).
- **No map-land bake was needed:** the tree data did not change, and the map land
  record already names `4f2d022d…`.

### Open for the owner

1. ~~**The held-out gate** (round 3: P 0.984 / R 0.685 on 89 unseen crowns).~~
   **Decided 2026-11-08:** "Round 3 (Recommended): Accept round 3 below the 90% target, as you did for round 2."
2. **The felled and not-a-tree list:** 8 removals and 31 not placed, including the
   12 poles and structures.
3. **The species-mix flags**, unchanged from round 2.
4. **Screenshots and frame time** on his own view of the app.
5. **The thinned band by the 6th tee:** confirm it, or ask for a newer laser.
6. **The browser and GPU steps still to run** after #156 and this branch are synced
   with main: one combined prepared-data re-bake, the clean boots and new
   screenshots and timing. The owner turned the GPU off before them.

### Reproduce round 3

```sh
RAW=<the pilot cache with copc/ and ortho/>
node tools/tree-pipeline.mjs --ground johannesberg --stage detect --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --stage verify --relief --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r3 --stage reference --prepare --native --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r3 --stage reference --freeze --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r3 --stage benchmark --tune --raw $RAW   # calibration only
node tools/tree-pipeline.mjs --ground johannesberg --round r3 --stage benchmark --score --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r3 --stage benchmark --subtypes --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r3 --stage candidates --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r3 --stage review --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r3 --stage publish --execute --pending-owner --raw $RAW   # the gate passes under the owner's exception; --pending-owner only while his checklist items (screenshots, frame time, the felled list) are open
```

## Round 4: a learned photo crown detector on the GPU (missed the floor on its own sample; published by round 4b’s rule)

**Status: scored once on 2026-11-08, branch `trees-round4`. On its own sample it was not
published (below). On round 4b’s second sample it qualified under the rule declared there, and it is published:
see Round 4b.** On a new unseen sample of 132 crowns, the fused detector beats
round 3 on F1 (0.837 against 0.773) and on recall (0.758 against 0.644). Its precision
of 0.935 is below the owner's floor of 0.95. The 90% gate fails too (R 0.758).

**The owner's rule** for this round, as the main session relayed it from his answer of
2026-11-08 ("The best round go!"): round 4 is published only if, on the fresh sample,
it beats round 3's lock on F1 and on recall, with precision of at least 0.95. The rule
was written into
[`reference-windows-r4.json`](reference-windows-r4.json) before scoring
(`declaredBeforeScoring.beatsRoundThree`). It is not met, so no owner exception is
recorded and nothing was staged, adopted or re-baked.

**Why a learned detector.** The owner asked to "continue improving the tree work to reach 90% with ...
the learned crown detector on the GPU ... It reads the 2025 photo the way a person
does". Round 3's misses were touching broadleaves and flat or rounded pine crowns with
no sharp top in the leaf-off laser. Nothing newer exists: the laser is still 2021-04-17
and the newest photo `orto-o2-2025` (2025-06-14, 0.16 m RGBI).

### The new sample (frozen before any photo detector ran)

[`reference-windows-r4.json`](reference-windows-r4.json),
[`reference-annotations-r4.json`](reference-annotations-r4.json),
[`reference-r4.geojson`](reference-r4.geojson),
[`reference-lock-r4.json`](reference-lock-r4.json). Frozen and committed (`0ec810b0`)
before the photo detector ran anywhere.

The windows lie in parts of the inner area no earlier round used. They were chosen from
the detector-neutral apex census of the CHM and the play-zone distance only
([`photo/window-scan.mjs`](../../../../../tools/tree-pipeline/photo/window-scan.mjs)).

| Window | Place | Scored crowns |
|---|---|---|
| W1 | closed conifer square in the wood by the 8th tee (25 m) | 33 |
| W2 | closed stand between the 11th green and the 12th tee, on an opening (25 m) | 19 |
| W3 | woodland edge east of the 7th fairway, broadleaf-rich (40 × 35 m) | 35 |
| W4 | woodland edge round a gap by the 8th green and 9th tee (40 × 35 m) | 26 |
| W5 | groups and single trees between the 9-hole course's 1st and 4th (50 m) | 19 |

- **132 scored crowns.** Strata: closed 60, edge 52, group 14, isolated 6 (45/39/11/5%;
  the census near play is 53/32/10/5%). Types: 91 conifer, 40 broadleaf, 1 unknown.
  Heights: 3-8 m 13, 8-15 m 16, 15 m+ 103.
- **How it was interpreted.** Agent-led (Claude), not a survey. Each window was first
  drafted by the round-3 protocol's written grouping rule
  ([`photo/reference-draft.mjs`](../../../../../tools/tree-pipeline/photo/reference-draft.mjs):
  a numbered top within 2 m of a taller one, or less than 0.6 m above the dip toward a
  taller one within 3 m, is part of that crown; 3.5 m for a crown leafless in April
  2021). Each draft crown got a type from the April photo at its displaced position and
  a stratum from the census rule. Every window was then checked on large single panels
  at 0.06 m: the CHM hillshade, June 2025 colour and colour infrared, and April 2021
  colour, each photo moved onto the canopy. Four W2 crowns on its opening were changed
  from closed to edge. Unlike earlier rounds, no ambiguity boxes were drawn: every
  crown the rule and the panels gave is scored, the closed squares included.
- **Limitation, stated before scoring.** In closed stands the reference reads the same
  June 2025 photo the round-4 photo detector reads, and the same laser every detector
  reads. Where touching crowns share one laser maximum and one photo blob, the split is
  a judgement that may favour the photo detector. A field check of W1 and W2 would
  settle it.
- **A tree felled after the laser** (logs on the ground in June 2025, as in W3) stays a
  reference crown when the April 2021 photo and the laser show it.
- **"Beats round 3" was declared in the windows file before scoring**, as the owner's
  rule: higher F1 AND higher recall than the round-3 lock on W1-W5, with precision at
  least 0.95.
- Every earlier held-out window (round 1 E, round 2 H, round 3 Q) is `used-holdout`:
  never tuned on and never shown to the detector in training.

### The photo crown detector

- **Model.** DeepForest 2.1.0 (weecology, MIT licence): a RetinaNet (ResNet-50 FPN)
  trained on 10 cm RGB airborne imagery. Weights `weecology/deepforest-tree` from
  Hugging Face at commit `cc21436bc5d572dde8ff5f93c1e71a32f563cace`,
  `model.safetensors` SHA-256 `d37a7af0b5ba2754282a80d41b4c7b66e8c7149234df5bf3f41bdaf57d329fc8`.
  Neither weights nor imagery are committed.
- **Environment.** Python 3.14.7, torch 2.11.0+cu128, torchvision 0.26.0+cu128, on the
  owner's RTX 5080 laptop GPU (sm_120). Pinned in
  [`photo/requirements-photo.txt`](../../../../../tools/tree-pipeline/photo/requirements-photo.txt).
- **Input.** The June 2025 photo (`orto-o2-2025`) at its native 0.16 m, RGB, exported
  over the inner window plus 64 m into the ignored cache.
- **Scale.** The network resizes every patch to 800 px, so the ground size of a patch
  sets the scale a crown reaches it at. A 40 m patch gives the 20 px/m the model was
  trained at (400 px at 0.1 m, resized to 800). Upsampling the photo to 0.10 m first
  therefore changes nothing but the interpolation; the scales tried are the patch
  sizes 25-80 m.
- **Fine-tuning** used calibration windows only. Reference crowns became boxes at
  their relief-displaced position in the photo (0.8 × k × h from the laser crown), of
  half-size max(1.2 m, crown radius) + 0.1 × |k| × h. A box was moved onto the visible
  crown the pretrained model drew within 2.5 m, when there was one. The ambiguity boxes
  (canopy the interpreters could not split) were blacked out, so they were never taught
  as background. AdamW at 5 × 10⁻⁵, 12 epochs, random 40 or 64 m patches with flips and
  quarter turns. Each run took about 25 s on the GPU.
- **Cross-fitting.** For tuning, a fine-tuned source is trained on one half of the
  calibration windows and run on the other, and back (folds C1, C3, C5, K1 and C2, C4,
  C6, K2). The fusion is therefore tuned on crowns the detector did not train on. The
  scoring and candidates use weights trained on all eight.
- **Stage.** `--stage photo-detect` ([`photo-detect.mjs`](../../../../../tools/tree-pipeline/photo-detect.mjs),
  [`photo/crowns.py`](../../../../../tools/tree-pipeline/photo/crowns.py)) runs every
  declared source over the calibration windows and the whole inner window. It records
  the files' hashes in [`photo-detect-r4.json`](photo-detect-r4.json). It is optional
  per ground (`photoDetect` in trees.json) and is the only GPU stage.

### The fusion: photo crowns confirm laser tops

[`photo-fusion.mjs`](../../../../../tools/tree-pipeline/photo-fusion.mjs) (confirm mode).

- The round-3 lock runs unchanged: the type-aware detector, then the laser- and
  photo-refereed recovery.
- Every over-segmented laser top (a 1 m maximum of the CHM smoothed by 0.3 m, at least
  3 m tall) is moved forward to where the photo draws it, by its own height ×
  `projectionFraction` × the block's k. Photo boxes and tops are paired one to one,
  closest first, within `matchRadiusMetres`.
- A box claimed by a kept top confirms nothing new. A **suppressed** top whose box
  scores at least `minimumScore` is taken back only when it stands
  `minimumSeparationMetres` from every seed and `minimumDipMetres` above the lowest point
  toward the nearest taller seed within 6 m (its own crown in the laser).
- Every crown is regrown from the full set of seeds, so positions, radii and heights
  stay the laser's.
- **The photo never places a seed of its own.** Every seed is a laser maximum, so a
  photo crown over no laser canopy is never placed. This covers the brief's three uses:
  - a laser crown holding two photo crowns is split at its second top;
  - a suppressed top the photo confirms is recovered;
  - a tree is added only on laser canopy of its own height.
- **The first design moved each photo crown back to its trunk** (solving x + f k h(x) = p)
  and snapped it to the CHM. On calibration it never beat round 3: the mapping is too
  coarse for 2.5 m spacing, and it double-counted crowns already found. Matching in
  photo space with the laser tops' own heights does not have that problem.

### Tuning (calibration only)

[`detector-lock-r4.json`](detector-lock-r4.json), [`photo-detect-r4.json`](photo-detect-r4.json).

The round-3 lock's settings are kept. For each photo source, the fusion searched a
joint grid (576 settings) and then a coordinate polish: 3,652 evaluations in all, on
the 129 calibration crowns.

| Photo source | Boxes on calibration / whole window | Best calibration P / R / F1 |
|---|---|---|
| none (round 3) | | 0.926 / 0.868 / 0.896 |
| pretrained, 40 m patches | 2,443 / 112,788 | 0.919 / 0.884 / 0.901 |
| **pretrained, 50 m patches (locked)** | 1,634 / 73,471 | **0.896 / 0.930 / 0.913** |
| pretrained, 64 m patches | 1,026 / 47,176 | 0.914 / 0.907 / 0.911 |
| pretrained, 80 m patches | 675 / 32,193 | 0.927 / 0.884 / 0.905 |
| fine-tuned, 40 m (cross-fitted) | 1,843 / 93,530 | 0.926 / 0.876 / 0.900 |
| fine-tuned, 64 m (cross-fitted) | 1,038 / 52,975 | 0.927 / 0.884 / 0.905 |

- **Locked settings:** `projectionFraction` 0.6, `matchRadiusMetres` 3, `minimumScore`
  0.3, `minimumSeparationMetres` 1.5, `minimumDipMetres` 0, both types.
- **Fine-tuning did not beat the pretrained model.** On calibration it never did better
  once cross-fitted. Its first trial left the ambiguity boxes unmasked, so it learned
  trees as background, and photo-only recall fell from 0.85 to 0.33. With 129 crowns in
  eight windows, about 100 boxes per fold, there is too little to fine-tune on.
- **On its own the photo detector is far below the laser.** Matched to the trunk by the
  relief field, its best photo-only F1 on calibration was 0.71 (P 0.78, R 0.66, 64 m
  patches). Its value is as a referee of laser tops.

### Benchmark

[`benchmark-r4.json`](benchmark-r4.json) (SHA-256 `5d6a5434552db3f4260be416261568af88b2f28dd57e1ad71353e895fd1a483c`):
one-to-one matching within 4 m, scored once.

| Detector | Calibration (129) P / R / F1 | Used held-out E+H (90) P / R | Round 3's sample Q1-Q5 (89) P / R / F1 | **New sample W1-W5 (132) P / R / F1** |
|---|---|---|---|---|
| Published individuals + stand trees (round 2) | 0.93 / 0.78 / 0.85 | | | 0.977 / 0.636 / 0.771 |
| Current 1 m detector | 0.90 / 0.34 / 0.49 | | | 0.94 / 0.24 / 0.39 |
| Round 1 | 0.905 / 0.814 / 0.857 | 0.870 / 0.889 | 0.971 / 0.764 / 0.855 | 0.978 / 0.674 / 0.798 |
| Round 2 | 0.946 / 0.814 / 0.875 | 0.927 / 0.844 | 0.984 / 0.674 / 0.800 | 0.977 / 0.636 / 0.771 |
| Round 3 (published) | 0.926 / 0.868 / 0.896 | 0.929 / 0.878 | 0.984 / 0.685 / 0.808 | 0.966 / 0.644 / 0.773 |
| **Round 4 (fused)** | **0.880 / 0.907 / 0.893** | **0.878 / 0.878** | **0.932 / 0.775 / 0.847** | **0.935 / 0.758 / 0.837** |

- **Rounds 1-3 reproduce** their recorded Q1-Q5 numbers exactly.
- **On W1-W5** round 4 finds 100 of 132 (32 missed, 7 extra). Round 3 finds 85, with
  3 extra. Wilson 95% intervals: P 0.87-0.97, R 0.68-0.82.
- **The gate result is FAIL** (R 0.758 < 0.9).
- **The owner's publish rule is not met:** F1 and recall improved, but P is 0.935, not
  0.95.

**Recall by stratum on W1-W5, round 3 → round 4** (round 2, round 1 for reference):

| | Round 1 | Round 2 | Round 3 | **Round 4** |
|---|---|---|---|---|
| Closed | 39/60 | 39/60 | 39/60 | **48/60** |
| Edge | 35/52 | 29/52 | 30/52 | **36/52** |
| Group | 11/14 | 10/14 | 10/14 | **10/14** |
| Isolated | 4/6 | 6/6 | 6/6 | **6/6** |
| Conifer | 61/91 | 59/91 | 60/91 | **71/91** |
| Broadleaf | 28/40 | 25/40 | 25/40 | **29/40** |
| Unknown | 0/1 | 0/1 | 0/1 | **0/1** |
| 3-8 m | 8/13 | 8/13 | 8/13 | **8/13** |
| 8-15 m | 7/16 | 7/16 | 7/16 | **12/16** |
| 15 m+ | 74/103 | 69/103 | 70/103 | **80/103** |

**By window, hits / misses / extras, round 3 → round 4:**

| Window | Round 3 | Round 4 |
|---|---|---|
| W1 (closed conifer square) | 18/15/0 | 27/6/1 |
| W2 | 14/5/0 | 15/4/0 |
| W3 (broadleaf edge) | 20/15/2 | 25/10/4 |
| W4 | 18/8/0 | 18/8/0 |
| W5 | 15/4/1 | 15/4/2 |

### What it shows

1. **The photo moves recall where the laser could not.** Closed crowns go from 39/60 to
   48/60, almost all in W1's dense spruce, and broadleaves from 25/40 to 29/40 in W3's
   edge. The secondary sample gives the same picture: on Q1-Q5 recall goes from 0.685
   to 0.775 (Q3's mixed band from 11 to 15 of 17).
2. **It pays for that in precision.** Every crown the photo confirms is a real laser top,
   but in a leafless broadleaf crown or a broad spruce with several tops, a box can
   confirm a second top of the same tree. W3 gains 5 crowns and 2 extras. On the
   secondary sample precision falls from 0.984 to 0.932. A precision floor of 0.95 is
   exactly what this costs.
3. **The calibration choice was noisier than it looked.** The fusion was tuned on photo
   crowns detected window by window. The scored run used the whole-window detection,
   whose tiles fall differently. Scored with it, calibration gives 0.880 / 0.907 / 0.893
   against 0.896 / 0.930 / 0.913 in tuning (and round 3's 0.896). The detector's boxes
   depend on where the 50 m tiles fall, by a few crowns per window. **Lesson:** tune on
   the same detection run that is scored, and average out the tiling (overlapping tile
   offsets or flips) before trusting a 2-crown difference.
4. **90% is still out of reach** with these data. Even the best round finds 0.76 of a
   sample drawn from the canopy near play, and the misses left are closed and edge
   crowns of 15 m+ (23 of 32).

### Model provenance and reproducibility

- **The model and environment** are in the photo crown detector section above; the
  environment is also in `photo-detect-r4.json`. Model:
  `weecology/deepforest-tree`, Hugging Face commit `cc21436b…`, weights SHA-256
  `d37a7af0…`, MIT licence.
- **The photo raster** exported for the detector has SHA-256 in `photo-detect-r4.json`;
  every crowns file's SHA-256 is there too, and the lock pins the scored one
  (`3495cea2…`).
- **What stays in the cache:** the photo pixels, crops, weights and crowns files. They
  are photo-derived and are not redistributed.
- **GPU use** was tonight only, after the main session freed the GPU. The photo-detect
  stage took 951 s; tuning and scoring are CPU.

### What changed in the pipeline

- **`photo-detect` stage** ([`photo-detect.mjs`](../../../../../tools/tree-pipeline/photo-detect.mjs)):
  optional, configured by `photoDetect` in trees.json, and the only GPU stage.
- **`fused` detector kind** ([`photo-fusion.mjs`](../../../../../tools/tree-pipeline/photo-fusion.mjs)):
  benchmark tuning and scoring, and the candidates stage (not run, since the round is not
  published).
- **The Python** in [`tools/tree-pipeline/photo/`](../../../../../tools/tree-pipeline/photo/)
  with its pinned requirements.
- **Tests** for the config and for the fusion's laser-only placement.
- **Unchanged:** nothing in `apps/golf/src`, `packages/course-v2` or the published data,
  so the source revision is the same.

### Open for the owner

1. **Round 4 is not published under his rule** (P 0.935 < 0.95). He may still choose it,
   for its recall (0.758 against 0.644), as an exception pinned to benchmark-r4
   (`5d6a5434…`). Nothing of that is recorded here.
2. **A round 5 could address the extras**: tune on the scored detection run, average the
   tiling, and confirm a top only when its box is not also claimed by a taller crown's
   other tops. It would need a new unseen sample.

### Reproduce round 4

```sh
RAW=<the pilot cache with copc/ and ortho/>
node tools/tree-pipeline.mjs --ground johannesberg --round r4 --stage reference --prepare --native --only W1-h8-closed,W2-h11-closed,W3-h7-edge,W4-h8-9-edge,W5-n9-1-4-groups --raw $RAW
node tools/tree-pipeline/photo/reference-draft.mjs --raw $RAW --only W           # drafts and 0.06 m panels (cache)
node tools/tree-pipeline/photo/reference-annotate-r4.mjs                        # the annotations file, with the checked edits
node tools/tree-pipeline.mjs --ground johannesberg --round r4 --stage reference --freeze --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r4 --stage photo-detect --raw $RAW   # GPU, ~16 min
node tools/tree-pipeline.mjs --ground johannesberg --round r4 --stage benchmark --tune --raw $RAW   # calibration only
node tools/tree-pipeline.mjs --ground johannesberg --round r4 --stage benchmark --score --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r4 --stage benchmark --gate --raw $RAW
```

## Round 4b: a second unseen sample, and round 4 published

**Status: published on branch `trees-round4` under the owner's answer of 2026-11-08,
"The best round go!".** Round 4 had missed the owner's precision floor on its own
sample. The main session (23:43) then asked for one more attempt aimed at precision,
round 4b, judged on a second fresh sample.

### The rule, declared before scoring

[`reference-windows-r4b.json`](reference-windows-r4b.json), `declaredBeforeScoring.rule`,
committed before any round-4b code ran:

- Score round 3, round 4 (as locked) and round 4b once each on the new sample X1-X5.
- Publish the candidate with the highest F1 among those that beat round 3 on X1-X5 on
  both F1 and recall, with precision at least 0.95.
- If none qualifies, the trees stay at round 3.

### The second sample, X1-X5 (frozen before any round-4b code ran)

[`reference-annotations-r4b.json`](reference-annotations-r4b.json),
[`reference-r4b.geojson`](reference-r4b.geojson),
[`reference-lock-r4b.json`](reference-lock-r4b.json). It was committed as `6bbb1a02`, by
the same rules and interpretation method as W1-W5.

| Window | Place | Scored crowns |
|---|---|---|
| X1 | closed stand in the wood west of the 8th fairway (25 m) | 29 |
| X2 | closed stand north-west of the 9th green, round a gap (25 m) | 26 |
| X3 | woodland edge south of the 12th fairway (40 × 35 m) | 25 |
| X4 | woodland edge north of the 5th fairway (40 × 35 m) | 35 |
| X5 | groups and edges between the 9-hole course's 2nd and 4th (50 m) | 11 |

- **126 scored crowns.** Strata: closed 66, edge 49, group 9, isolated 2. Types: 96
  conifer, 22 broadleaf, 8 unknown. Heights: 3-8 m 9, 8-15 m 31, 15 m+ 86.
- Six X2 crowns on a gap inside the stand were changed from closed to edge.
- **A window dropped before freezing.** The first X3 (by the 7th green) was dropped
  before any detector ran on it: the June 2025 photo shows the stand felled after the
  2021 laser. X3-h12-edge replaced it.
- **X5 has young growth.** It lies by a stand that has grown up since 2021; only crowns
  with 2021 laser height are reference crowns.
- **The W1-W5 limitation holds here too:** in closed stands the reference reads the same
  photo the detector reads.

### Round 4b: aimed at precision (calibration only)

[`detector-lock-r4b.json`](detector-lock-r4b.json), [`photo-detect-r4b.json`](photo-detect-r4b.json).

- **Where round 4's extras came from, on calibration.** Only 2 of the 29 tops the photo
  confirmed inside calibration windows were extras themselves (13 lay in ambiguity
  boxes). The rest of the extra count came from regrowth: an added seed moves a
  neighbour's crown, and a broadleaf crown's centroid moves furthest.
- **Tiling-averaged sources.** Each region was tiled twice, from two origins half a stride
  apart, and the boxes merged by NMS (`offsets: 2`). Pretrained, 50 and 64 m patches.
- **An apex test for confirmed tops.** At least `minimumApexReturns` first returns within
  0.75 m reach within 1.5 m of the top's height, as round 3's referee asks.
- **Tuned on the scored detections.** The tuning read the whole-window detections that
  the score reads, not a separate calibration run. That removes round 4's tuning/scoring
  mismatch.
- **A precision floor.** The best calibration F1 among settings whose calibration
  precision is at least round 3's (0.926), as `photoDetect.tuning.r4b` declares.
- **Locked:** pretrained, 64 m patches, two offsets; `projectionFraction` 0.5, match
  2.5 m, score ≥ 0.4, separation 2 m, no dip test, apex ≥ 2 returns, both types.
  Calibration P 0.928 / R 0.899 / F1 0.913, against round 3's 0.926 / 0.868 / 0.896.

### Benchmark on X1-X5

[`benchmark-r4b.json`](benchmark-r4b.json) (SHA-256 `baf3630f0c3beb3280e9d1def532f88d453d65dd4e95b646dd1653d59210e29f`),
scored once.

| Detector | **X1-X5 (126) P / R / F1** | W1-W5 (132, used) P / R / F1 | Q1-Q5 (89, used) P / R / F1 | Calibration (129) P / R / F1 |
|---|---|---|---|---|
| Round 1 | 0.964 / 0.643 / 0.771 | 0.978 / 0.674 / 0.798 | 0.971 / 0.764 / 0.855 | 0.905 / 0.814 / 0.857 |
| Round 2 | 0.974 / 0.595 / 0.739 | 0.977 / 0.636 / 0.771 | 0.984 / 0.674 / 0.800 | 0.946 / 0.814 / 0.875 |
| Round 3 | 0.976 / 0.643 / 0.775 | 0.966 / 0.644 / 0.773 | 0.984 / 0.685 / 0.808 | 0.926 / 0.868 / 0.896 |
| **Round 4 (as locked)** | **0.971 / 0.810 / 0.883** | 0.935 / 0.758 / 0.837 | 0.932 / 0.775 / 0.847 | 0.880 / 0.907 / 0.893 |
| Round 4b | 0.978 / 0.714 / 0.826 | 0.968 / 0.682 / 0.800 | 0.940 / 0.708 / 0.808 | 0.928 / 0.899 / 0.913 |

- **Both round 4 and round 4b qualify** under the declared rule. **Round 4 has the
  highest F1**, so its lock is published. On X1-X5 it finds 102 of 126, with 3 extras.
- **The gate result is FAIL** (R 0.810). Wilson 95% intervals: P 0.92-0.99, R 0.73-0.87.
- **Round 4's W1-W5 numbers reproduce exactly** in this benchmark.
- **Round 4b bought precision with recall.** Its apex test keeps out the confirmed tops
  in closed spruce that the leaf-off scan gives few returns: on X1 18 → 20 crowns
  against round 4's 27.

**Recall by stratum on X1-X5:**

| | Round 3 | **Round 4** | Round 4b |
|---|---|---|---|
| Closed | 42/66 | **59/66** | 47/66 |
| Edge | 32/49 | **35/49** | 35/49 |
| Group | 6/9 | **7/9** | 7/9 |
| Isolated | 1/2 | **1/2** | 1/2 |
| Conifer | 65/96 | **84/96** | 71/96 |
| Broadleaf | 12/22 | **12/22** | 13/22 |
| Unknown | 4/8 | **6/8** | 6/8 |
| 3-8 m | 5/9 | **5/9** | 5/9 |
| 8-15 m | 18/31 | **21/31** | 18/31 |
| 15 m+ | 58/86 | **76/86** | 67/86 |

**By window, hits / misses / extras:**

| Window | Round 3 | **Round 4** | Round 4b |
|---|---|---|---|
| X1 | 18/11/0 | **27/2/1** | 20/9/0 |
| X2 | 18/8/0 | **25/1/0** | 21/5/0 |
| X3 | 17/8/2 | **19/6/2** | 19/6/2 |
| X4 | 23/12/0 | **26/9/0** | 25/10/0 |
| X5 | 5/6/0 | **5/6/0** | 5/6/0 |

**Reading the two samples together.**

- **Round 4's precision differs between the samples:** 0.935 on W1-W5 and 0.971 on
  X1-X5. Its extras sat in W3's leafless broadleaf edge and W5's groups. X1-X5 is more
  coniferous (96 of 126), and there the photo confirms real tops.
- **Recall rises on every sample:** +0.114 on W1-W5, +0.167 on X1-X5 and +0.090 on Q1-Q5,
  all against round 3.
- **Closed conifer stands gain most:** on X, closed recall goes from 42/66 to 59/66.
- **Broadleaves do not gain** (12/22 on X).
- **The owner's floor** was met on the sample the rule named (X1-X5), not on W1-W5. Both
  are recorded.

### What is published on this branch (round 4, by round 4b's rule)

- **The owner exception.** It is recorded in `course-workflows/johannesberg/trees.json`
  under `ownerExceptions` (round `r4b`, gate method `round4-detector`). It quotes the
  main session's question, "if round 4 beats round 3 but stays under 90%, should I
  publish it under the same kind of exception as round 3?", and the owner's answer,
  "The best round go!". It is pinned to benchmark-r4b (`baf3630f…`) and restates
  P 0.971 / R 0.81.
- **Round 4b's config `publishes: r4`.** The gate and the candidates stage therefore
  read the round-4 lock on round 4b's sample. `activeRound` is `r4b`.
- **Candidates** ([`candidates.csv`](candidates.csv), SHA-256 `2c856dfd…`) start from
  the round-3 generation (`ground-v2-4f2d022d…`), so its IDs carry forward.
- **The screens, decided on the compact chips**
  ([`photo/record-screen-review-r4.mjs`](../../../../../tools/tree-pipeline/photo/record-screen-review-r4.mjs)):
  - 447 new pole-like crowns: 439 trees and 8 unclear (held). Almost all are narrow
    tops the photo confirmed inside stands. The 8 unclear stand at lawn and meadow
    edges or in pre-2021 clear-cuts.
  - 9 new felling-screened crowns: 4 present, 3 absent (not placed), 2 unclear (held).
  - The chips are in the cache's review-panels (compact-poles-01 to 19, compact-felling-01).
- **Staging.** `--stage publish --execute --pending-owner` staged the generation. Its
  owner checklist items stay open: the felled list, the species-mix flags, and
  screenshots and frame time on his GPU. Result: `ground-v2-79b72b1d…`, 44,409 tree
  records, integrity true. It was adopted into `apps/golf/public` for both routings,
  and `production.json` re-pins the ground, `candidates.csv` and the residual rasters.
- **Synced with `trees-round3`'s re-bake** of every course (`db795d67`, revision
  `0bda108d`), by a merge (no rebase).
- **Re-baked for Johannesberg only** (the source revision is unchanged): the prepared
  tints, water, far vista and scatter for both routings, and the map's forest picture
  (`bake-map-land`). `check-prepared-startup` passes for every course.

| | Round 3 (published before) | Round 4 (now) |
|---|---|---|
| Placed records, inner frontier | 27,241 | 32,073 (+4,832) |
| retain / adjust / add (vs the previous generation) | 23,595 / 2,569 / 1,077 | 21,783 / 5,377 / 4,913 |
| Hold / merge / remove / not placed | 238 / 40 / 8 / 31 | 255 / 64 / 3 / 39 |
| Conifer / broadleaf / unknown | 20,818 / 2,690 / 3,733 | 24,943 / 2,918 / 4,212 |
| Near play: records, broadleaf share | 5,745, 12.2% | 6,590, 11.4% |
| Tree records, whole 4,096 m level zero | 39,577 | 44,409 |

The added trees are mostly tops recovered in closed conifer stands. Near play, records
rise by 15%. The species-mix flags are the same holes as before (4, 5, 6, 15 and most of
the 9-hole course), with shares within two points of round 3's.

### Screenshots, boots and checks (round 4)

- **Clean boots.** `check-gpu-clean-boot` on johannesberg and johannesberg-9, WebGPU and
  WebGL2, high and low quality: 8 of 8 boots clean, at most 14 vertex outputs.
- **Screenshots.** `gfx-gallery --adhoc` at 1920 × 1080, Dag. Views: holes 1, 6, 8, 10
  and 12 from the tee, the 17th green and the 9-hole course's 5th tee. Before is the
  round-3 public root on this build. They are in the ignored
  `tools/goldens/gfx/jb-r4-before-vs-jb-r4-after/` of the `trees-round4` worktree.
- **GPU time per view (timestamp queries), before → after:**
  - hole 1: 4.33 → 4.19 ms
  - hole 6: 3.87 → 3.87 ms
  - hole 8: 10.55 → 11.47 ms
  - hole 10: 8.13 → 6.95 ms
  - hole 12: 8.32 → 9.04 ms
  - 17th green: 4.00 → 4.59 ms
  - 9-hole 5th: 3.80 → 3.80 ms
- **The views read alike.** The added trees stand inside the woods. These timings are
  single passes, not interleaved frame-time runs, so the owner's frame-time item stays
  open.
- **CPU checks** (after the merge of `trees-round3`):
  - `pnpm exec vitest run apps/golf`: 1,933 of 1,933 passed in 228 files.
  - Node tests (the `pnpm test` list): first 524 passed, 1 failed, 3 skipped. The failure
    was the stale `course-workflows/johannesberg/workflow.json`; after regenerating it
    with `production.mjs --configure`, a rerun passed 525 of 528, with 3 skipped and none
    failed.
  - `lint-app`: clean.
  - `check-app-build`: passes for all 13 published graphs.
  - `check:course-workflow`: passes.
  - `check-prepared-startup --public apps/golf/dist`: passes for every course.
  - Pipeline tests: 31 of 31.

### Reproduce round 4b

```sh
RAW=<the pilot cache with copc/ and ortho/>
node tools/tree-pipeline.mjs --ground johannesberg --round r4b --stage reference --prepare --native --only X1-h8-closed,X2-h9-closed,X3-h12-edge,X4-h5-edge,X5-n9-2-4-groups --raw $RAW
node tools/tree-pipeline/photo/reference-draft.mjs --raw $RAW --round r4b --only X
node tools/tree-pipeline/photo/reference-annotate-r4b.mjs
node tools/tree-pipeline.mjs --ground johannesberg --round r4b --stage reference --freeze --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r4b --stage photo-detect --only pre-p50-x2,pre-p64-x2 --raw $RAW   # GPU; the other sources are reused from round 4
node tools/tree-pipeline.mjs --ground johannesberg --round r4b --stage benchmark --tune --raw $RAW    # calibration only, precision floor
node tools/tree-pipeline.mjs --ground johannesberg --round r4b --stage benchmark --score --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --stage benchmark --gate --raw $RAW      # round 4 lock, owner exception
node tools/tree-pipeline.mjs --ground johannesberg --stage candidates --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --stage review --only screens --raw $RAW
node tools/tree-pipeline/photo/record-screen-review-r4.mjs && node tools/tree-pipeline.mjs --ground johannesberg --stage candidates --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --stage review --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --stage publish --execute --pending-owner --raw $RAW
```

## Round 5 and the held trees (2026-11-09)

The owner reported trees missing by the water at the 18th, asked whether lone trees
can be placed this way, and then said: "Do whats recommended to improve the tree
placements, pipeline and agent." Two kinds of gap were found, and each got its own
fix.

1. **Trees found but held.** The detector found every one of the 18th's shore trees.
   They were held because the crown centroid lay over the mapped water. 255 crowns in
   the inner frontier were held, for reasons like that or with no June 2025
   vegetation in the crown disc.
2. **Two trees drawn as one.** Every crown round 4 missed on W1-W5 and X1-X5 (56 of
   258) stood within 7 m of a drawn crown (39 within 4 m). On calibration, 57 of 68
   such misses had their own over-segmented laser top that the detector suppressed.

### The held trees: the bank rule and the hold review (published)

- **The bank rule** (`holds.bank`, candidates step 3b). A crown whose centroid lies
  on mapped water, a path, a road or a played surface is a tree leaning over it when
  its own laser crown reaches land. Its stem moves to the nearest cell of its own
  crown 0.5 m clear of every surface that holds a tree, or to laser canopy (at least
  2 m) within 1.5 m of the crown. The June 2025 crown disc must be vegetated (0.15,
  the no-vegetation hold's share). Buildings are never banked by the rule.
- **The water outline at the 18th lies about 4 m over the west bank.** Inside it, the
  laser hit ground under the bank trees, while open water returned no pulses. So a
  cell inside a traced water outline counts as bank where the scan hit ground at
  least twice within 0.75 m (`groundReturnsForLand`).
- **Result: 24 crowns banked by the rule.** By surface: water 9 (all near play),
  paths 11, tees 2, a fairway 1 and a road 1. Eight of them are the 18th's standing
  shore trees (main-session check on the June 2025 photo). The ninth, a shore tree
  north of the 18th that the felling screen held as unclear, is present on the
  colour infrared (`felling-review.json`, re-reviewed).
- **The hold review** (`hold-review.json`,
  [`record-hold-review-r5.mjs`](../../../../../tools/tree-pipeline/photo/record-hold-review-r5.mjs)).
  The review stage draws compact chips of every crown held on a building or with no
  June 2025 vegetation (`--stage review --only holds`), and each gets a verdict.
  174 were decided:

  | Verdict | On a building | No June 2025 vegetation |
  |---|---|---|
  | bank (a tree beside the building, placed) | 10 | |
  | present (placed; conifers in shade, red in the April colour infrared) | | 14 |
  | absent (thinned since 2021; the owner confirms) | | 4 |
  | not-tree (roofs, sheds, vehicles, posts) | 82 | 16 |
  | unclear (held) | 3 | 45 |

- **The pit-free CHM keeps roofs as canopy.** The building hold is mostly roofs (82
  of 95), which is why buildings are decided on chips and never by rule.

| | Round 4 (live before) | Now |
|---|---|---|
| Placed records, inner frontier | 32,073 | 32,122 (+49) |
| Near play | 6,590 | 6,608 |
| Held | 255 | 112 |
| Decided felled since the laser (the owner confirms) | 16 | 20 |
| Not placed or removed as not a tree | 26 | 116 (the hold review adds 90 roofs, sheds, vehicles and posts) |

The detector lock is unchanged (round 4), so the gate result and the owner exception
pinned to benchmark-r4b stand. The publication statement in `trees.json` and the
production `reviewNote` record the re-publication.

### Round 5: the width split (scored, not published)

- **Method** (`photo-fusion.mjs`, the width split). It keeps the round-4 lock. A crown
  wider than `widthFactor` × typical(h) takes back its own suppressed laser tops.
  typical(h) = 2.131 + 0.0429 h m is fitted on the 387 calibration reference crowns.
  The tests are its cone, its separation and (when tuned on) a paired photo box.
  Split seeds are protected from the shallow-crown merge. Every seed is a laser
  maximum, and the photo never places a tree.
- **Calibration.** C1-C6, K1 and K2, plus W1-W5 and X1-X5, which were spent as
  held-out samples. Tuned on calibration only (1,395 evaluations), it locked
  `widthFactor 1.4`, separation 3 m, dip 1 m, height share 0.4, no photo box needed,
  protected, both types. Calibration score: P 0.926 / R 0.876 / F1 0.900, against
  the round-4 lock's 0.925 / 0.824 / 0.872.
- **A third held-out sample, Y1-Y8 (120 scored crowns).** It was frozen before any
  round-5 code ran, and committed first. It holds a closed square, three edges, a
  group window, two shore windows and a farmyard, the first shore and garden strata.
  The windows came from the detector-neutral apex census
  ([`window-scan-r5.mjs`](../../../../../tools/tree-pipeline/photo/window-scan-r5.mjs)),
  outside the 18th's shore that the main session had looked at. The interpretation
  was agent-led.
  - The drafts were checked on 0.06 m panels. One pair was merged into one broadleaf.
  - The farmyard window Y8 holds no scored tree: every draft crown inside it lay on
    a barn roof or a machine in the April 2021 photo (16 drafts rejected).
- **The rule, declared before scoring.** Round 5 replaces round 4 only if it beats
  round 4 on Y on F1 and recall with precision at least 0.95.

| Y1-Y8 (120 crowns) | TP | Missed | Extra | P | R | F1 |
|---|---|---|---|---|---|---|
| Round 4 (live detector) | 91 | 29 | 5 | 0.948 | 0.758 | 0.843 |
| Round 5 | 97 | 23 | 12 | 0.890 | 0.808 | 0.847 |
| Round 3 | 79 | 41 | 3 | 0.963 | 0.658 | 0.782 |

**Round 5 does not qualify.** It beats round 4 on F1 and recall, but its precision is
under 0.95. Nine of its 12 extras are splits of the farmyard's barn roofs (Y8). The
candidates stage holds crowns on mapped buildings, but the declared rule scores the
detector. The trees stay at round 4's detector.

**Secondary numbers (declared before scoring; they decide nothing).** These are the
decided candidates, what the app draws after the holds, scored on Y1-Y8
([`score-candidates-r5.mjs`](../../../../../tools/tree-pipeline/photo/score-candidates-r5.mjs)):

- Round 4 with the bank rule and the hold review (published): TP 90, missed 30,
  extra 2, P 0.978 / R 0.750 / F1 0.849. The farmyard's roofs are not placed.
- Round 5 through the same stage: P 0.969 / R 0.783 / F1 0.866, with 33,528 placed
  (+1,406). It would leave 515 held crowns, many of them new pole-like tops from the
  split, to review first. This is for the owner to weigh.

### Open for the owner

- The felled list (20, up from 16: four tall conifers thinned since 2021, `hold-review.json`
  145-148), the species-mix flags, and screenshots and frame time on his GPU, as before.
- Round 5 is not published. The owner chose the recommendation on 2026-11-09 ("Continue
  with what you recommend, you have access to the gpu"): keep round 4 live, and build
  a round whose split never touches a building, scored on a fresh sample.

### Re-baked (2026-11-09, on the owner's GPU)

The prepared data are keyed by the ground manifest's checksum, so
`check-prepared-startup` failed until these were re-baked. Each ran on the owner's
RTX 5080 (`BANVY_GPU=1`), `--only johannesberg,johannesberg-9`, against a served
build, with the app rebuilt between steps:

- **Water** (`bake-water`): new files.
- **Ground tints** (`bake-ground-tints`): the same bytes, new identities.
- **Far vista and scatter** (`bake-vista`): the same bytes, new identities.
- **Map land** (`bake-map-land`): only Johannesberg's terrain pin moves. The pictures
  are unchanged, since the stand field keeps its pins.

**Checks.** `check-prepared-startup`, `check-startup-packs` and `check-app-build`
pass. Vitest for `apps/golf` passes 1,933 of 1,933. The repository's node tests
show 528 passed, 0 failed and 3 skipped. The pipeline tests pass 34 of 34.

### Reproduce round 5 and the held trees

```sh
RAW=<the pilot cache with copc/ and ortho/>
node tools/tree-pipeline/photo/window-scan-r5.mjs --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r5 --stage reference --prepare --native --only Y1-h10-closed,Y2-h2-edge,Y3-h17-edge,Y4-h5-edge,Y5-h13-groups,Y6-n9-3-shore,Y7-n9-8-shore,Y8-h1-garden --raw $RAW
node tools/tree-pipeline/photo/reference-draft.mjs --raw $RAW --round r5 --only Y
node tools/tree-pipeline/photo/reference-annotate-r5.mjs
node tools/tree-pipeline.mjs --ground johannesberg --round r5 --stage reference --freeze --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r5 --stage photo-detect --only none --raw $RAW   # reuses round 4's detections, no GPU
node tools/tree-pipeline/photo/diagnose-r5.mjs --raw $RAW                                                 # calibration only
node tools/tree-pipeline.mjs --ground johannesberg --round r5 --stage benchmark --tune --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --round r5 --stage benchmark --score --gate --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --stage candidates --raw $RAW                          # round 4 lock, bank rule
node tools/tree-pipeline.mjs --ground johannesberg --stage review --only holds --raw $RAW
node tools/tree-pipeline/photo/record-hold-review-r5.mjs && node tools/tree-pipeline.mjs --ground johannesberg --stage candidates --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --stage review --only spots,mix --raw $RAW
node tools/tree-pipeline.mjs --ground johannesberg --stage publish --execute --pending-owner --raw $RAW
node tools/tree-pipeline/photo/score-candidates-r5.mjs
```

## Reproduce

Run from the repository root, with Lantmäteriet credentials in an env file
that is never committed.

```sh
node --env-file=<.env> tools/johannesberg-tree-pilot/fetch-copc.mjs
node --env-file=<.env> tools/johannesberg-tree-pilot/fetch-ortho.mjs
node tools/johannesberg-tree-pilot/build-chm.mjs
node tools/johannesberg-tree-pilot/register-ortho.mjs
node tools/johannesberg-tree-pilot/reference-panels.mjs   # interpretation panels (cache)
node tools/johannesberg-tree-pilot/freeze-reference.mjs
node tools/johannesberg-tree-pilot/benchmark.mjs --tune   # calibration only
node tools/johannesberg-tree-pilot/classify-types.mjs
node tools/johannesberg-tree-pilot/benchmark.mjs --score
node tools/johannesberg-tree-pilot/build-candidates.mjs
node tools/johannesberg-tree-pilot/render-spots.mjs
node tools/johannesberg-tree-pilot/source-inventory.mjs
# round 2
PILOT_SAMPLE=-r2 node tools/johannesberg-tree-pilot/reference-panels.mjs --windows geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/reference-windows-r2.json
PILOT_SAMPLE=-r2 node tools/johannesberg-tree-pilot/freeze-reference.mjs
PILOT_SAMPLE=-r2 node tools/johannesberg-tree-pilot/round2.mjs --tune   # calibration only
PILOT_SAMPLE=-r2 node tools/johannesberg-tree-pilot/round2.mjs --score
PILOT_SAMPLE=-r2 node tools/johannesberg-tree-pilot/build-candidates.mjs   # round-2 lock: the published set and the residual rasters
node tools/johannesberg-tree-pilot/type-check.mjs
node tools/johannesberg-tree-pilot/type-panels.mjs --holes 1,17   # species spot check (cache)
# publication (staging first; see Publication)
node packages/course-v2/vegetation/compile-vegetation.mjs --ground johannesberg --observed-on 2026-11-08 --out output/course-workflow/johannesberg/reviewed-compile --public <staging root> --reviewed geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/candidates.csv --scope 678403.5,6624276.5,680451.5,6626324.5 --residual-chm johannesbergbuild/cache/trees-2026-11-08/rasters/residual-chm-050.bin --residual-labels johannesbergbuild/cache/trees-2026-11-08/rasters/residual-labels-050.bin --review "<the review statement pinned in production.json>"
node packages/course-v2/vegetation/publish-vegetation.mjs --ground johannesberg --compile output/course-workflow/johannesberg/reviewed-compile --public <staging root>
node tools/build-startup-packs.mjs <staging root>
node tools/johannesberg-tree-pilot/verify-staging.mjs --public <staging root>
BANVY_GPU=1 node tools/johannesberg-tree-pilot/runtime-trees.mjs --base <served build>   # species by planter and zone
```

Re-pin tools (dated outputs, accepted pins untouched):

```sh
node packages/course-geo/acquisition/discover-ground.mjs --ground johannesberg --write --out geo_data/course-v2/johannesberg/acquisition/d2-discovery-2026-11-08.json
node packages/course-geo/acquisition/record-laser-campaigns.mjs --ground johannesberg --skip-scan-metadata --write --out geo_data/course-v2/johannesberg/acquisition/laser-campaigns-2026-11-08.json
node --env-file=<.env> packages/course-geo/acquisition/run-copc-census.mjs --ground johannesberg --campaigns <that file> --out geo_data/course-v2/johannesberg/acquisition/copc-hierarchy-census-2026-11-08.json --write
node --env-file=<.env> packages/course-geo/acquisition/access-preflight.mjs --provider lantmateriet --ground johannesberg --discovery geo_data/course-v2/johannesberg/acquisition/d2-discovery-2026-11-08.json
```

Attribution: Laserdata Nedladdning, skog, © Lantmäteriet, bearbetad, CC BY 4.0; orthophotos © Lantmäteriet.
