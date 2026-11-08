# Johannesberg tree placement, Stage A (review 2026-11-08)

**Status:** local pilot, evidence and a candidate set only. Nothing here is
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
| **Candidate: placed individual crowns** | **26,834** (18,647 conifer, 8,187 broadleaf) |
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
```

Re-pin tools (dated outputs, accepted pins untouched):

```sh
node packages/course-geo/acquisition/discover-ground.mjs --ground johannesberg --write --out geo_data/course-v2/johannesberg/acquisition/d2-discovery-2026-11-08.json
node packages/course-geo/acquisition/record-laser-campaigns.mjs --ground johannesberg --skip-scan-metadata --write --out geo_data/course-v2/johannesberg/acquisition/laser-campaigns-2026-11-08.json
node --env-file=<.env> packages/course-geo/acquisition/run-copc-census.mjs --ground johannesberg --campaigns <that file> --out geo_data/course-v2/johannesberg/acquisition/copc-hierarchy-census-2026-11-08.json --write
node --env-file=<.env> packages/course-geo/acquisition/access-preflight.mjs --provider lantmateriet --ground johannesberg --discovery geo_data/course-v2/johannesberg/acquisition/d2-discovery-2026-11-08.json
```

Attribution: Laserdata Nedladdning, skog, © Lantmäteriet, bearbetad, CC BY 4.0; orthophotos © Lantmäteriet.
