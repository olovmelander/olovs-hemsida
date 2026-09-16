# Visby tree placement: second local pass

The [third local review](../round3/README.md) extends this checkpoint. This report and its frozen detector evaluation remain the evidence for round two.

This pass adds **18 source-reviewed individual crowns** around holes 6, 13 and 15, bringing the isolated preview from **3,151 to 3,169 records**. All 3,151 previous records are preserved. Eight candidates already represented by existing individuals are retained without alteration; eleven ambiguous candidates remain unresolved. Production and the first pilot remain unchanged.

Open the [source review and comparison](http://127.0.0.1:8646/pilot-review/round2/review.html), or [play the second preview](http://127.0.0.1:8646/?bana=visby&v2=require&ghibli=1). These links use the local server. Restart it from the repository root with:

```powershell
node tools/visby-tree-pilot/preview.mjs serve round2 8646
```

## Placement changes

| Area | Added crowns | Existing retained | Unresolved candidates |
|---|---:|---:|---:|
| Hole 6 review area | 3 | 1 | 2 |
| Hole 13 review area | 1 | 1 | 2 |
| Hole 15 eastern review area | 1 | 4 | 0 |
| Hole 15 western review area | 13 | 2 | 7 |

Agent visual review used verified **10 April 2026 RGB and near-infrared imagery at 16 cm**, and the existing **2024 LiDAR-derived 1 m canopy-height raster**. Candidate centres are weighted by source LiDAR heights; they are not shifted to apparent image centres. Geometry, source-window references, height, uncertainty, decisions and unresolved cases are recorded in `corrections.json` and the QGIS-compatible `corrections.geojson`.

The additions replace procedural stand representation within their measured crown footprints. Only **1,841 cells on four existing 1 m stand tiles** change; all other previous-pilot stand cells are retained. Crown masking removes 1,607 m² of stand eligibility, preventing double representation. The existing 24 fine tiles and 232 coarse tiles retain their resolutions. This mask represents crown occupancy, not surveyed stem exclusions.

The actual high-quality renderer now draws 3,161 individuals and 44,720 stand representatives, compared with 3,143 and 44,762 in the first pilot. All 18 additions render in WebGPU/high, WebGL/high and WebGL/low. The eight pre-existing records suppressed by runtime exclusions remain unchanged. Tree assets, style and terrain are unchanged.

## Fresh detector evaluation

The 65 newly interpreted crowns include **64 scorable crowns**, plus six representative clearings, on holes **5, 7, 11, 12, 17 and 18**. The non-overlapping sample and ambiguity regions were frozen before viewing new predictions. It is a purposive source-interpretation sample, not an independent field survey or course-wide estimate.

Original calibration areas alone selected among 52 configurations: current Node or actual lidR Dalponte/Silva segmentation, broader treetop windows, median smoothing and optional sparse-canopy recovery. The recovery pass consolidates detections within a small measured canopy island and recovers some sparse crowns lost during smoothing. It does not use an infrared threshold.

The frozen selection is **Dalponte, 5×5 median, window diameter clamp(9 + 0.1h, 3, 14) m, plus recovery of islands up to 80 m²**. Algorithm, reference and exact offline toolchain hashes are retained. Fresh results did not select or retune these settings.

| Method | TP / extra / missed | Precision | Recall | F1 | Crown IoU | Median centre disagreement |
|---|---|---:|---:|---:|---:|---:|
| Current Node | 39 / 14 / 25 | 73.6% | 60.9% | 66.7% | 51.5% | 1.77 m |
| First pilot Silva configuration | 50 / 50 / 14 | 50.0% | 78.1% | 61.0% | 47.2% | 2.20 m |
| New Dalponte + sparse-crown recovery | 40 / 16 / 24 | 71.4% | 62.5% | 66.7% | 57.3% | 1.94 m |

Matching is one-to-one within 4 m; crown boundaries are approximate visually interpreted ellipses. IoU and centre metrics describe the matched subsets, which differ between methods. The new method improves average boundary overlap but **does not improve overall F1 over Node**, and its median centre disagreement is worse. It therefore remains a review aid, not a replacement for automatic course-wide placement. Neither method meets the 90% precision/recall target. See `evaluation.json` for full metrics and limitations.

The six fresh evaluation areas receive **no subsequent placement edits**. Validation confirms their individual records and 61,206 intersecting stand cells remain unchanged. The 18 additions are in four separate placement-review regions. Their reviewed appearance is not counted as a new independent accuracy result.

## Validation and limitations

- 40 matched screenshot pairs: overhead and tee views for all 18 holes in WebGPU, plus holes 9 and 16 in WebGL/high and WebGL/low. Cameras, catalogues and actual renderer backends match the first pilot.
- All 18 accepted additions appear in actual exported instances in all three modes. Zero stand bases intersect individual footprints; zero bases enter the first pilot's reviewed clearings.
- Stable IDs, unchanged prior records, preserved baseline files and production root, unchanged first-pilot root, pinned detector/reference hashes, and unchanged fresh evaluation cells are checked from real outputs.
- 16 Python tests and 35 Node tests pass, covering band handling, coordinate conventions, nodata, halo consistency, duplicate prevention, stand seams, exclusions, identity and publication.
- Serial interleaved performance runs compare the first and second pilots at hole 16 in all three rendering modes. `performance.json` retains measurements and any regression investigation. These are local browser frame intervals, not isolated GPU timings.

Median frame intervals remain **24.2 ms WebGPU/high**, **54.5 → 54.4 ms WebGL/high**, and **12.2 ms WebGL/low**. Transfer decreases by 1,034 bytes and stays at five requests. Runtime bases agree with terrain within 0.007 m after accounting for the renderer's 0.25 m trunk burial and diagnostic rounding.

Initial WebGPU median startup increased **22.5%**, from 15.34 to 18.80 s. Named spans varied across unchanged terrain preparation, tint generation, vista and shader compilation; the first baseline startup also overlapped offline CPU validation. A focused follow-up of three further interleaved pairs measured **17.73 → 15.06 s**, with identical 24.2 ms median frames. The slowdown did not reproduce. Both runs remain in the report; this variation does not establish a loading-speed improvement.

All positions remain **inferred crown centres, not surveyed trunk locations**. Two metres horizontal uncertainty and confidence 0.65 are review judgements, not measured errors or calibrated probabilities. The existing 1.5 m floor is not an accuracy result. LiDAR campaign dates span 3 February–28 April 2024; runtime `capturedAt: 2024-04-28` is only the campaign upper bound required by the existing format. Exact individual-tree capture dates are unavailable. Imagery dates differ from LiDAR dates. No infrared-only deletion, image-only new tree, species inference, or automatic resolution of ambiguous stems is introduced.

## Reproduction

Keep the first pilot's frozen graph, caches, CHM and pinned toolchain. Work products for this pass live only in `output/visby-tree-pilot/round2/`; small evidence is retained in this directory. The source reference and detector lock must not be redrawn or replaced after evaluation. New tuning requires a new experiment and an unseen evaluation sample.

The reference and benchmark were prepared in this order:

1. `round2.py` creates new source panels; `round2-annotations.json` records blind visual annotations; `round2.py --reference` freezes them.
2. `round2-detect.R calibration` and the retained original-calibration Node outputs produce calibration detections. `round2_benchmark.py` selects and freezes settings.
3. `round2-detect.R fresh` and `detect-node.mjs --scenes output/visby-tree-pilot/round2/scenes.json --out output/visby-tree-pilot/round2/detections` produce fresh predictions. `round2_benchmark.py --fresh` evaluates the frozen selection.

For reproducing the reviewed preview from retained evidence:

```powershell
$pilotPython = 'upsalabuild/cache/review-venv/Scripts/python.exe'
$pilotR = 'output/visby-tree-pilot/toolchain/R-4.5.3/bin/Rscript.exe'
& $pilotPython tools/visby-tree-pilot/toolchain.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round2.py --placement-review
& $pilotR tools/visby-tree-pilot/round2-placement.R
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round2_candidates.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round2_author.py
node tools/visby-tree-pilot/compile-preview.mjs --round2
node tools/visby-tree-pilot/preview.mjs capture round2
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round2_validate.py
node tools/visby-tree-pilot/performance.mjs --round2
& $pilotPython tools/visby-tree-pilot/round2_finalize.py
& $pilotPython tools/visby-tree-pilot/round2_review.py
```

Do not run rendering captures or other GPU workloads concurrently with profiling. `review06`, `review13`, `review15` and `review15west` are review regions, not assertions that every crown in those holes is now individually mapped. The existing source caches and full original pilot remain available for further work.

The focused profiling command is `node tools/visby-tree-pilot/performance.mjs --round2 --scenario webgpu-high --report-prefix gpu-followup`. If a new profiling run reports a regression above 10%, inspect its spans and refresh `output/visby-tree-pilot/round2/performance-investigation.json` before finalization. The finalizer checks that the investigation references the actual run hashes and will reject stale findings.
