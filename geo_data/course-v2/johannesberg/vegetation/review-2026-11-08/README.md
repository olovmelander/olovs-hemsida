# Johannesberg tree placement (review 2026-11-08)

**Status (2026-11-08, published):** the inner 2,048 m frontier now carries the round-2 reviewed generation, published by the owner's decisions below although the held-out gate is not met, with broadleaf calls narrowed by the owner's species check (see Publication). Round 2 itself is described further down.

**Round 3 (branch `trees-round3`, accepted by the owner on 2026-11-08):** the photo-refereed detector replaces round 2 in the inner frontier. It reaches P 0.984 / R 0.685 on a new unseen sample drawn from the strata near play (round 2 0.984 / 0.674, round 1 0.971 / 0.764), so the gate is still not met. The owner chose: "Round 3 (Recommended): Accept round 3 below the 90% target, as you did for round 2." Pine/spruce was measured but not published, and the pole-like crowns were reviewed. See Round 3.

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
