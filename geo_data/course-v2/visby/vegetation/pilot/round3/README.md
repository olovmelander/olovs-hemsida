# Visby: third local tree-placement review

2026-09-16. **61 additional source-reviewed individuals**, all visible in WebGPU/high, WebGL/high and WebGL/low. All 3,169 previous records remain unchanged: the preview now contains **3,230 records and 3,222 rendered individuals**. The eight previously suppressed records remain held by runtime exclusions. Production and the earlier previews remain unchanged.

Open the [local source review and matched comparison](http://127.0.0.1:8647/pilot-review/round3/review.html), or [play the preview](http://127.0.0.1:8647/?bana=visby&v2=require&ghibli=1). Start the local server using the command below if it is not running. The [general workflow](../../../../../../docs/tree-placement-workflow.md) and [review template](../../../../../../docs/templates/tree-placement-review.md) incorporate the findings from this pass.

## What changed

We inspected 26 adjoining/targeted 100 m cells around holes 1, 2, 4 and 10 and nearby shared areas, using 2024 LiDAR heights, 10 April 2026 RGB/infrared and the retained 2022 seasonal image. The detector settings remain exactly those frozen in round two; candidate generation is a review aid, not a new detection experiment. Context panels extend 15 m outside the cell; detection uses a 20 m halo. Centre ownership is west/south inclusive and east/north exclusive, with full crown geometry preserved across seams.

| Candidate decision | Count | Treatment |
|---|---:|---|
| Accepted individual | 61 | LiDAR-weighted centre/height, stable ID, terrain-grounded base; subtract its footprint from stands |
| Ambiguous crown | 40 | Hold; preserve previous generation |
| Supported crown with unresolved base | 11 | Reserve ID, hold individual, retain prior stand coverage |
| Merged fragment | 1 | Two detections describe one crown; merged source geometry retained, but the resulting base remains held |
| Rejected structure | 12 | Roof/lighthouse detections rejected; no existing records deleted |
| Existing individual retained | 43 | Preserve ID, position and dimensions |
| Measured woodland retained | 49 | Preserve density-based stand representation |
| Protected evaluation overlap | 3 | Preserve the frozen evaluation area |
| **Total candidates** | **220** | Each has one explicit decision |

Three additional visible low/sparse vegetation observations lack defensible individual height or identity and remain unresolved. Low infrared response never removes a tree; no image-only tree or inferred stem relocation is introduced.

Eight of the 61 accepted crowns had no prior rendered stand-base centre inside their footprint. The others replace procedural representation with a source-grounded individual. This count does not prove those eight had no visible canopy from neighbouring assets. See [representation.json](representation.json).

We also recorded eight open-ground polygons totalling **5,416.5 m²**. Their sampled height cells have no returns above 3 m and 77.6–87.6% finite coverage. Both previous and new rendered populations keep these areas clear; this pass **preserves** these openings, rather than claiming to have reopened them. These authoring/conformance checks are not an independent forest-boundary score.

Only ten stand tiles change: 7,955 cells have changed bytes, removing 4,335 m² of encoded stand-canopy coverage beneath accepted footprints and explicit gaps. The established 24 near-play 1 m tiles and 232 remaining 4 m tiles are retained. No stand eligibility is expanded; other previous cells stay byte-identical. The source review map and local `review/r3-*-bases.png` panels distinguish actual individual bases from stand representatives.

## Coverage and unresolved cases

The frozen playing/practice-surface corridor plus 30 m is **658,651.8 m²**, partitioned into 119 intersecting grid cells. This pass systematically inspects **166,321.0 m² / 25.3%**, excluding protected evaluation regions. Of its 26 cells, seven have no linked unresolved cases and 19 remain ambiguous after reconciling previous and cross-boundary cases. Woodland interiors remain measured stands, not a stem census.

| Area status | Area (m²) |
|---|---:|
| Reviewed, without a linked unresolved case | 28,670.6 |
| Inspected, with ambiguity remaining | 137,650.5 |
| Unreviewed in this new ledger | 447,164.6 |
| Protected fresh evaluation | 45,166.1 |

The [coverage map](coverage.svg), [QGIS layer](coverage.geojson) and [per-hole accounting](coverage.json) retain the exact geometry and denominator. Hole 1's full diagnostic corridor is inspected. Diagnostic coverage is 76.2% for hole 2, 79.7% for hole 4 and 72.9% for hole 10. Each diagnostic scope is a hole line buffered 90 m and clipped to the corridor; these overlap and must not be summed or treated as approved hole ownership.

The previous **26.4%** result measured potential opportunity inside selected sample windows. It is a different measure and is not added to this pass's 25.3% inspected area. The new ledger deliberately does not retrospectively certify earlier windows as fully inspected. Substantial course area still needs systematic review.

The [cross-pass issue index](issue-index.json) contains **96 unresolved cases**, with a [spatial layer](issue-index.geojson): 34 previous catalogue cases, 51 new candidate holds, three low-vegetation observations and eight retained runtime cases. These are case entries, **not 96 unique trees**. Potentially related observations are linked by geometric overlap; no prior catalogue case is claimed resolved by these additions. The fresh reference's additional ambiguous crown remains separately recorded in the immutable round-two reference.

All eight retained suppressed records were checked against RGB, infrared, height and seasonal panels. Runtime probes show seven ground-exclusion conflicts and a further post-planning building conflict: round two loads 3,169 records, plans 3,162 individuals and draws 3,161. Analytic playing geometry alone misses some conflicts because the sampled ground atlas and later green/tee aprons also affect eligibility. `tree-visby-000284` lies inside the authored `service-west-south-2026` facility footprint and has visible canopy over the roof. See [suppression review](suppression-review.json). Filter attribution is inferred from probes, geometry and counts, not a newly instrumented per-instance rejection trace. Existing records remain unchanged; crown evidence is insufficient to invent unobstructed stems.

## Validation and limits

[validation.json](validation.json) checks real compiled/rendered outputs:

- 61/61 additions appear in each of three renderer modes; no accepted individual is silently excluded.
- Zero stand bases inside individual-crown footprints and zero tree bases in previous or new reviewed clearings.
- 40 matched camera/asset pairs: overhead and tee for all 18 holes in WebGPU; tee views of holes 9 and 16 in WebGL/high and WebGL/low. Source/base overlays and all-hole contact comparisons were visually inspected.
- Previous records, production/earlier roots, frozen references/settings and all 61,206 protected evaluation stand cells remain unchanged.
- A [deterministic rebuild](rebuild-check.json) reproduces the exact object records, footprint layer, stand index/hashes, source manifest, publication and startup/root catalogues used by the captured preview.
- Captures load the final 3,230-record generation without startup fallback; terrain bases and asset catalogues are retained.
- All 18 Python tests pass, including two added tests for half-open seam ownership and unique-cell height weighting when overlapping crown segments merge. All five changed/new JavaScript entrypoints also pass syntax checks.

There is **no new independent detector accuracy result**. Round two's frozen candidate score remains 71.4% precision / 62.5% recall, below the 90% targets. The original Node/candidate F1 tie and the later paired geometry diagnostic remain unchanged. This is a bounded improvement in reviewed source conformance, not a claim of complete or surveyed placement. Full-course bidirectional forest-edge accuracy remains unestablished.

Positions are LiDAR-weighted **crown centres**, not surveyed trunks. Horizontal uncertainty 2 m, vertical uncertainty 1.5 m and confidence 0.65 are judgements, not measured errors/probabilities. LiDAR dates span 3 February–28 April 2024; runtime `capturedAt: 2024-04-28` is the campaign upper bound. RGBI is dated 10 April 2026 at 16 cm source spacing. The 2022 image's exact capture date is unknown. Actual sparse LiDAR support and date differences remain limitations.

The interactive map uses actual GeoTIFF pixel-edge bounds for RGB/CIR, with a separate 130 m context view and 100 m ownership cell. Rounding native pixel counts produces up to 0.08 m difference from the nominal panel edge; the original candidate/contact images fitted that nominal square. [Source grid checks](source-grid-checks.json) record this small display difference, actual bounds and raster identities. LiDAR-derived positions do not use the image fit.

[performance.json](performance.json) retains the serial interleaved comparison with round two, at hole 16, in the same browser and viewport. It records startup, vegetation planning, transfer, median/p95 frames and terrain residuals, plus any investigation of changes above 10%. These are local browser measurements, not portable frame-rate guarantees.

Initial WebGPU/high median frames were unchanged at **24.3 ms**. WebGL/high median frames were unchanged at **48.4 ms**, but p95 increased **10.4%**. WebGL/low initially showed **18.2 → 30.2 ms** median frames and **25.52 → 32.04 s** startup. Those regressions triggered separate three-pair follow-ups after offline evidence processing stopped. High-quality WebGL then measured **54.5 → 54.6 ms** median and **60.7 → 60.7 ms** p95; low-quality measured **18.1 → 12.2 ms** median, **24.2 → 24.2 ms** p95 and **22.51 → 13.30 s** startup. No reported follow-up metric regressed over 10%.

The initial slowdowns did not reproduce, but substantial run-to-run variation remains, including a 54.735 s high-quality candidate startup outlier. Do not infer a speed improvement from the favourable follow-up. The initial WebGPU/early WebGL runs overlapped offline processing; their timing isolation was imperfect. Transfer decreases by 2,696 bytes with five requests unchanged. Maximum rendered-base disagreement with the retained terrain is below **0.007 m**, after the diagnostic's 0.25 m intentional burial offset; this is grounding consistency, not terrain survey accuracy.

## Reproduce the retained pass

Keep the frozen baseline, round-two graph/stand fields, verified source caches and pinned R 4.5.3 / lidR 4.3.3 / terra 1.9.50 toolchain. Do not rebuild the application from an unrelated working tree: use the retained `output/visby-tree-pilot/build` and frozen tree assets for both sides. All generated graphs/images/captures remain under ignored `output/visby-tree-pilot/round3/`; this directory holds compact evidence. These scripts remain Visby-specific.

Run from the repository root, sequentially. Wait for each process to complete before starting its dependent command. Stop captures and profiling before rebuilding the graph they serve. Keep other browser/GPU workloads and heavy offline processing out of performance runs.

```powershell
$pilotPython = 'upsalabuild/cache/review-venv/Scripts/python.exe'
$pilotR = 'output/visby-tree-pilot/toolchain/R-4.5.3/bin/Rscript.exe'
& $pilotPython tools/visby-tree-pilot/toolchain.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round3.py --plan
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round3.py
& $pilotR tools/visby-tree-pilot/round3-placement.R
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round3.py --candidates
node tools/visby-tree-pilot/round3-probe.mjs
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round3_author.py
node tools/visby-tree-pilot/compile-preview.mjs --round3
node tools/visby-tree-pilot/preview.mjs capture round3
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round3_validate.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round3_rebuild_check.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round3_evidence.py
node tools/visby-tree-pilot/performance.mjs --round3
& $pilotPython tools/visby-tree-pilot/round3_finalize.py
& $pilotPython tools/visby-tree-pilot/round3_review.py
node tools/visby-tree-pilot/round3-review-check.mjs
node tools/visby-tree-pilot/preview.mjs serve round3 8647
```

`round3-decisions.json` is the retained human-readable authoring input. Its 11 base holds were established using an initial 72-addition preview, then removed from the final generation and its stand masks. [base-hold-evidence.json](base-hold-evidence.json) preserves the initial publication and renderer-export identities; local `inspection-*` artifacts preserve that diagnostic generation. Replaying final decisions does not require overwriting it.

```powershell
& $pilotPython -W ignore::DeprecationWarning -m unittest discover -s tools/visby-tree-pilot -p 'test_*.py'
node --check tools/visby-tree-pilot/compile-preview.mjs
node --check tools/visby-tree-pilot/preview.mjs
node --check tools/visby-tree-pilot/performance.mjs
node --check tools/visby-tree-pilot/round3-probe.mjs
node --check tools/visby-tree-pilot/round3-review-check.mjs
```

If performance changes by more than 10%, retain the observation, inspect the raw spans and create a scoped follow-up with `--scenario <mode> --report-prefix <name>`. Refresh the hashed investigation before finalizing; do not present a noisy initial result as an improvement. New placement work should start another review rather than editing protected evaluation or overwriting this checkpoint. Next priority is the remaining near-play cells and source-supported ground/base conflicts; uncertain small vegetation and dense joined crowns need stronger evidence before individual placement.
