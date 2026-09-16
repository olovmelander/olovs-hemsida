# Visby tree-placement pilot — 16 September 2026

This records the first experiment. The [third local review](round3/README.md) is the latest checkpoint, with 61 further reviewed individuals, explicit coverage cells and a reconciled issue index. The earlier experiment and its measurements remain preserved below.

**Delivered as an isolated local experiment. The existing course remains the default.**

Open [the source review and comparison](http://127.0.0.1:8645/pilot-review/review.html), [baseline viewer](http://127.0.0.1:8644/?bana=visby&v2=require&ghibli=1), or [pilot viewer](http://127.0.0.1:8645/?bana=visby&v2=require&ghibli=1). Restart commands are below. Nothing was deployed.

## What changed

- Optional RGBI reading in `visbybuild/mapping/lm_ortho_read.py`; existing calls still return RGB. `bands=(1,2,3,4)` includes NIR; `(4,1,2)` produces colour infrared.
- 120 accepted source-reviewed crown edits: **111 promotions from stand coverage and 9 adjustments**. All 3,040 previous IDs survive; 3,031 previous records remain byte-equivalent as objects. The pilot has **3,151 individual records**. No individual removals or merges were accepted.
- 13 additional crowns have unresolved base/overhang conflicts with existing ground exclusions. Their reserved IDs are not published. Ten other annotated cases are outside the scoring area or insufficiently interpretable: **23 unresolved cases in total**. Low NIR response never deletes a tree.
- **24 tiles use 1 m stand fields**, covering tiles intersecting mapped playing surfaces and their 30 m surroundings. The other 232 tiles retain 4 m fields. Excluding individual crown footprints changes 119 stand tiles in total. Unresolved overhang footprints are also held out of procedural placement.
- The same object-registry and stand-field formats, terrain, routing and tree assets are used. Species and representative woodland stems remain rendering choices. Source crown dimensions do not establish surveyed stem dimensions.

## Sources and alignment

The pilot uses the existing acquisition pipeline and verified files, with missing imagery coverage acquired through the available Lantmäteriet account. All 68 windows in `geo_data/course-v2/visby/reference/lm-ortho-plan-2026-09-09.json` are available, including course context coverage.

| Source | Date | Use |
|---|---|---|
| Lantmäteriet RGB + NIR, four bands | 10 April 2026 | Native 16 cm colour/CIR review and uncalibrated `(NIR − red)/(NIR + red)` contrast |
| Lantmäteriet LiDAR, `24e002-636_68` and `24e002-637_68` | Campaign interval 3 February–28 April 2024 | 1 m canopy-height evidence, detection and approximate crown centres |
| Published terrain | Frozen baseline generation | Terrain-grounded object bases and identical runtime ground |
| Region Gotland seasonal ortho | Campaign 2022; exact capture date unknown | Older leafy crown outlines; never evidence of current presence by itself |

Coordinates are SWEREF 99 TM (EPSG:3006), heights RH2000 (EPSG:5613). The CHM raster's northwest **pixel edge** is E685700.5, N6372999.5, with 1 m cells and north-to-south rows. Native tree-source values are not upsampled into fictitious measurements. The displayed CHM review images use nearest-neighbour expansion.

Checks cover source hashes, dimensions, CRS, transforms, source masks, pixel edges, north/south ordering and tile seams. RGBI gaps fail closed. NaN canopy cells remain unmeasured. An optional `--tight-grid` acquisition argument bounds the output to selected finest tiles instead of the larger scenery rings; the previous default is unchanged.

The play corridor contains **945,294 first returns over 658,636 m²: 1.44 first returns/m²**, with first returns in about 80% of its 1 m cells. This is a measured first-return density, not the density advertised for the product or a claim that every tree is separable. Campaign-wide point/return totals are retained in the acquisition evidence; those larger areas include substantial sea and missing coverage.

LiDAR anchors the approximate crown positions. Standard orthophotos can show relief displacement of elevated crowns; image centres do not automatically move a tree. NIR is supporting vegetation evidence: grass responds too, shadows affect digital numbers, and April deciduous crowns may be leafless. The older image was explicitly reviewed for holes 9 and 16 and a woodland edge near hole 15. No independent absolute alignment or trunk survey is claimed.

The compatible runtime `capturedAt` field requires one date and carries the LiDAR campaign end bound, 28 April 2024. It is **not** an exact per-tree acquisition date; the full interval is retained in the correction catalogue. Edited records use a 2 m horizontal uncertainty allowance and a 1.5 m vertical floor. These are judgement allowances, and the 0.65 confidence value is not a calibrated probability.

## Reference and benchmark

`reference.geojson` contains agent-authored, approximate crown ellipses, scoring areas and eight reviewed clearings. The annotations were made from unlabelled RGB, CIR and height panels before detector outputs were examined. There are **140 interpreted crowns, 133 scorable**, including **53 evaluation crowns on holes 9 and 16**. The sample includes isolated trees, groups and woodland edges; it is purposive, not a statistically representative inventory.

The real installed lidR implementations were run, not a reimplementation with their names. Twelve combinations compare Dalponte 2016 and Silva 2016 segmentation, three local-maximum window functions and raw versus 3×3-median CHMs. All use the same measured LiDAR-derived raster and 20 m processing halo. `lidR::lmf` uses a window **diameter**; the existing Node detector specifies a **radius**. Raster alignment was matched before scoring. No synthetic point cloud was fabricated.

Parameters were selected by calibration F1, then boundary IoU, then centre disagreement. Evaluation scores do not choose the method. The selected method is **`silva-d5-s1`**: median CHM, local-maximum diameter `clamp(5 + 0.1 × height, 3, 10)` m, 3 m minimum treetop height, Silva maximum crown factor 0.6 and exclusion 0.3.

| Reserved holes 9 & 16 | Matched / extra / missed | Precision | Recall | F1 | Crown IoU | Median centre disagreement |
|---|---|---|---|---|---|---|
| Current Node detector | 29 / 12 / 24 | 70.7% | 54.7% | 61.7% | 51.5% | 1.51 m |
| Selected lidR Silva | 45 / 41 / 8 | 52.3% | 84.9% | 64.7% | 51.1% | 1.93 m |

**The 90% precision/recall targets were missed. A replacement detector is not justified by these results.** Silva finds more reference crowns but also more unmatched candidates; centre and boundary agreement do not improve overall. Each method matches a different subset, so the centre medians are not a paired estimate of positional improvement. Matching is one-to-one within 4 m. Ellipse/label IoU is approximate interpreted boundary agreement.

`benchmark.json` also contains a `published` diagnostic. **That diagnostic counts only the baseline individual registry, not its tens of thousands of rendered stand representatives. It must not be used as whole-course baseline tree recall.** The Node/Silva table compares detector outputs before publication filtering. The full current rendered population is measured separately in `validation.json`.

The reviewed preview deliberately uses source annotations after the automatic benchmark was frozen, including edits on holes 9 and 16. Its post-edit agreement with those same annotations is **source conformance**, not held-out accuracy. Two subsequently traced edge segments are also local source-conformance checks. The configured 1.5 m uncertainty floor is not a measured accuracy result.

## Stand treatment and rendered checks

Fine fields use observed 1 m LiDAR heights, retaining the baseline's conservative eligibility and semantic exclusions. The recent playing-surface polygons add a 0.5 m exclusion buffer. Every cell touched by an individual footprint, held overhang or reviewed clearing is blocked, including across tile boundaries. The 4 m fields elsewhere keep their resolution but receive the same footprint exclusion. This intentionally favours avoiding overlapping representatives; it can omit legitimate adjacent canopy and cannot recover canopy already omitted by baseline eligibility.

The baseline has 1,331 high-quality stand bases within its individual circular crown footprints; the pilot has **zero** within its individual footprints. This is an occupancy conflict count, not proof of 1,331 duplicate physical trees. All eight reviewed clearings have zero drawn base intrusions before and after. All 120 accepted edited records appear in WebGPU/high, WebGL/high and WebGL/low. Eight untouched baseline records remain suppressed by pre-existing runtime exclusions.

Actual high-quality drawn populations are 51,127 before and 47,905 after; low-quality populations are 34,952 and 32,318. The difference includes the conservative overlap masks and the change in procedural sampling resolution. Woodland interiors remain density-based representations with no surveyed-stem claim.

Two manually interpreted canopy-edge segments have mean one-way boundary disagreement of **2.46 → 0.64 m** near hole 16 and **1.54 → 0.95 m** near hole 15. These distances measure the field/individual occupancy boundary, not rendered mesh silhouettes or independent accuracy. The samples reuse the same remote evidence and cover only 209 m of edge.

The pilot includes **40 matched screenshot pairs**: overhead and tee views on all 18 holes in WebGPU/high, plus tee views on holes 9 and 16 in WebGL/high and WebGL/low. Cameras and asset catalogues match. Hole 16 tee/overhead and source views were visually inspected. The browser checks pass without page errors or renderer fallback.

Ten Python tests and 35 existing Node tests pass, covering RGB/RGBI selection, masks, integrity, alignment, seam exclusions, one-to-one matching, evaluation isolation, stand encoding, detection, identity and graph publication. Full-output checks additionally verify unchanged production root, all baseline IDs, accepted rendered positions, clearings, duplicate prevention and matched screenshots. Detailed results are in `validation.json`.

## Performance

The first local preview exposed an incompatible inherited startup manifest, causing 843 requests instead of the packaged baseline's five. The local compiler now emits matching lossless startup packages. This fixes the transport mismatch without modifying runtime formats or production assets.

`performance.json` records three serial cold-context runs per mode and renderer, interleaved before/after, at a fixed 1440×900 viewport on hole 16. It includes boot time, frame intervals, planting time, bytes and actual backend. These are local browser RAF intervals, not isolated GPU timings. See that file for measured regressions and their investigation.

Median frame intervals are **24.3 → 24.2 ms WebGPU/high**, **54.6 → 54.5 ms WebGL/high**, and **18.1 → 12.2 ms WebGL/low**. No measured median/p95 frame regression exceeds 10%; maximum median boot increase is 1.2%. Packaged ground transfer grows **5.64%**, from 6.67 to 7.05 MB, still in five requests.

The finer fields increase encoded vegetation bytes by **40.3% (+376 kB)** and vegetation-planning CPU by **10.2–30.7% (+14–32 ms)**. These regressions were investigated: the 24 refined tiles add 1,474,560 cells. They are retained for the local accuracy experiment; no runtime format or quality shortcut was introduced. Correcting the renderer's existing 0.25 m trunk burial, exported bases agree with runtime terrain within 0.007 m, including 1 cm export rounding. This is rendering conformance, not surveyed terrain accuracy.

## Files and reproduction

Small derived evidence is kept here. The correction catalogue links each decision to its hashed reference layer and source windows; its crown geometry is the referenced feature in `reference.geojson`. The separate edge reference is also QGIS-compatible. Raw images, point-derived rasters, downloaded tools, local builds and screenshots stay in the ignored `output/visby-tree-pilot/` and existing geodata cache. Older municipal imagery remains local review material with its existing licence uncertainty; it is not redistributed or used as a runtime texture.

Tool versions: **R 4.5.3, lidR 4.3.3, terra 1.9.50, sf 1.1.3, jsonlite 2.0.0**. Exact R installer/executable and dependency ZIP hashes, plus Python versions, are pinned in `tools/visby-tree-pilot/toolchain-lock.json`. The isolated cached environment is required for exact offline replay. `setup.R` restores cached pinned archives by default; `--resolve` is explicitly a new environment resolution and must not silently replace this experiment's lock.

From the repository root in PowerShell, start each viewer in its own terminal:

```powershell
node tools/visby-tree-pilot/preview.mjs serve before 8644
node tools/visby-tree-pilot/preview.mjs serve after 8645
```

To rebuild from the retained evidence, use the ordered commands in `tools/visby-tree-pilot/README.md`. Do not overwrite the frozen baseline or redraw the reference after seeing evaluation results. To extend the work, add new calibration areas and a new independent evaluation set; do not present these reviewed edits as a newly validated detector.

The practical recommendation remains **LiDAR + RGB + NIR + visual review**, with an explicit ambiguity queue. Keep the present assets. This pilot supports improving crown/stand separation and local edge representation, but does not establish an automatic best-in-class detector for this sparse, partly leaf-off LiDAR.

Method references: [lidR individual tree detection and segmentation](https://r-lidar.github.io/lidRbook/itd.html); [Lantmäteriet product questions, including orthophoto limitations](https://www.lantmateriet.se/sv/geotorget-produktstod/fragor-och-svar/).
