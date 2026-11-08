# Johannesberg tree placement, Stage A (review 2026-11-08)

**Status (round 2):** local pilot, evidence and a candidate set only. Round 2 (below) tried a type-aware detector against a new held-out sample; the gate is still not met and the round-1 candidate set stands. Nothing here is
published, and the accepted generation (`ground-v2-fd6ebbe8…`), its pins and
its assets are unchanged. **The 90% precision and recall gate is not met.** The
new method misses fewer trees and places them better than either today's
published population or the current detector, but its held-out precision is
0.82.

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

## Candidate tree set, inner ring

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

## Per-tree play zone and type (for publishing)

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

Decisions are unchanged from round 1. The type column now carries the
confidence-gated type.

| Placed (retain / adjust / add) | Conifer | Broadleaf | Unknown | Total |
|---|---|---|---|---|
| near | 3,871 | 1,630 | 229 | 5,730 |
| woodland | 15,407 | 4,816 | 881 | 21,104 |

The holds split 71 near and 262 woodland. Merges: 42 near, 144 woodland.

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
node tools/johannesberg-tree-pilot/build-candidates.mjs   # round-1 lock; adds play and type confidence
node tools/johannesberg-tree-pilot/type-check.mjs
```

Re-pin tools (dated outputs, accepted pins untouched):

```sh
node packages/course-geo/acquisition/discover-ground.mjs --ground johannesberg --write --out geo_data/course-v2/johannesberg/acquisition/d2-discovery-2026-11-08.json
node packages/course-geo/acquisition/record-laser-campaigns.mjs --ground johannesberg --skip-scan-metadata --write --out geo_data/course-v2/johannesberg/acquisition/laser-campaigns-2026-11-08.json
node --env-file=<.env> packages/course-geo/acquisition/run-copc-census.mjs --ground johannesberg --campaigns <that file> --out geo_data/course-v2/johannesberg/acquisition/copc-hierarchy-census-2026-11-08.json --write
node --env-file=<.env> packages/course-geo/acquisition/access-preflight.mjs --provider lantmateriet --ground johannesberg --discovery geo_data/course-v2/johannesberg/acquisition/d2-discovery-2026-11-08.json
```

Attribution: Laserdata Nedladdning, skog, © Lantmäteriet, bearbetad, CC BY 4.0; orthophotos © Lantmäteriet.
