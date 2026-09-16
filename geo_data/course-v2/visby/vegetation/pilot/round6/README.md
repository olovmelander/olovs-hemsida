# Visby: focused crown and residual-gap review

2026-09-16. Local source-reviewed refinement of the frozen [round-five facility checkpoint](../round5/README.md). Production remains unchanged. Preview root: `70e22f94d875123830352aaf7f991f5fc31d6c279efd5341f32e67ae7e28d65d`.

Open [the comparison](http://127.0.0.1:8650/pilot-review/round6/review.html), or start it from the repository root:

```powershell
node tools/visby-tree-pilot/round6-preview.mjs serve round6 8650
```

## Result

All **79 previously unresolved components at least 25 m²** were inspected using six aligned panels: 2026 RGB, CIR, 2022 seasonal imagery, 2024 LiDAR height, current crown/woodland representation, and source exclusions. They cover **6,915.5 m²**, approximately **60.5%** of the prior unresolved area. All 1,546 smaller components remain explicit; their 4,512.82 m² was not individually reviewed in this focused pass.

Six existing trees have revised crown extents and wider equivalent rendering radii. **No trees were added or removed, and no base positions, heights or IDs changed.** The source footprint now accounts for another **183 native 1 m² height pixels**. Six structural patches explain another **720 m²** of the diagnostic: clubhouse, range, maintenance and lighthouse roofs. Explaining roofs does not add tree coverage.

| Diagnostic | Round five | Round six |
|---|---:|---:|
| Individual records / rendered individuals | 3,524 / 3,516 | 3,524 / 3,516 |
| Height-supported pixels represented by individual footprints or eligible stands | 164,931 | 165,114 |
| Unrepresented height pixels, including protected and structural returns | 12,696 | 12,513 |
| Explicitly reviewed non-tree overlap | 461 m² | 1,181 m² |
| Remaining editable unresolved gap area | 11,428.32 m² | 10,525.32 m² |
| Protected gap area | 806.5 m² | 806.5 m² |

The full facility remains 1.237 km² in 156 cells. Previous source inspection covers all editable area and 95.17% of total facility area, with protected evaluation separate. This pass does not establish complete tree representation or a surveyed tree census. The frozen detector evaluation is still **71.4% precision / 62.5% recall**, below the 90% targets; no new independent score is claimed.

## What the remaining patches mean

The [review journal](review-journal.json) records a separate decision for every inspected component, its exact geometry, source hashes/dates, runtime point probe and linked prior cases. Counts are patches, not unique trees:

| Interpretation | Patches | Treatment |
|---|---:|---|
| Distinguishable crown(s) with a ground-mask conflict | 27 | Retain unresolved positions; review underlying ground evidence next. |
| Connected edge / base conflict | 4 | Do not plant at a merged gap centroid. |
| Crown overhang or uncertain edge association | 27 | Preserve base exclusions and unresolved crown geometry. |
| Existing crown resized | 6 | Same ID/base/height; source-supported extension only. |
| Structure | 6 | Explain only the inspected non-tree geometry. |
| Crown-subtraction fringe | 4 | Do not interpret a thin raster border as another stem. |
| Existing suppressed record | 3 | Retain prior identity and suppression issue. |
| Protected-window edge | 2 | No edits to the crown or protected stand cells. |

The 27 distinct-crown cases include isolated trees and low crowns around the practice area. Several height-supported source positions fall inside broad fairway/practice polygons; another remains on a road. These observations warrant a **ground-boundary/source review**, not automatic planting or a global exclusion override. The source canopy is not a surveyed stem, and some components contain multiple crowns. The held round-five road candidate and its reserved ID remain held.

The [issue index](issue-index.json) retains all 472 prior case identities. [Resolution history](resolution-history.json) records exact portions accounted for; remaining geometry in all 102 gap-owner cells stays unresolved. Other source/base cases are not silently closed. Related cases overlap and must not be summed as unique missing trees.

## Geometry and validation

The [correction catalogue](corrections.json) keeps before/after records and irregular source geometry. Only unambiguous height pixels nearest the named crown were accepted; other portions remain unresolved. Equivalent circular radius is an approximation for the existing asset, not an exact canopy outline or measured trunk accuracy. All six corrections retain the previous uncertainty fields and source-relative base positions.

Only 37 stand cells change, subtracting the accepted crown extensions. No eligible stand canopy is added; 24 fine 1 m stand tiles and the remaining 4 m fields are retained. All **61,206 protected stand cells** are unchanged. Rendered counts remain **47,377** at high quality and **32,223** at low quality. The actual instance comparison verifies that only six horizontal tree scales change; unaffected instances, base positions, heights, headings and species choices are identical.

Evidence:

- [Validation](validation.json): stable IDs/positions, six rendered radius ratios, no stand bases inside individual footprints, no clearing intrusions, protected data, current startup packages and actual WebGPU/WebGL/low-quality captures.
- [Matched all-hole views](screenshots.json): 40 before/after pairs across all 18 holes, plus [18 matched low-angle pairs](closeups.json) covering every edited crown in all three modes.
- [Performance](performance.json): serial interleaved comparison, three repeats per backend/quality, with any >10% observations and their investigation recorded there.
- [Deterministic rebuild](rebuild-check.json): the object records, stand index/hashes, source manifest, graph and startup catalogues reproduce byte for byte.
- [Image grid checks](source-grid-checks.json): exact 16 cm mosaic extents on the native height-grid edges, four-band cached source hashes and separately retained seasonal sampling.
- [Viewer checks](viewer-check.json): focused decisions, full-facility source map, source/layer toggles, close comparisons and linked assets.
- Existing 18 Python source/band/alignment/stand-review tests pass. No detector or runtime code was retuned in this pass.

The completed 18-run performance comparison has **no >10% regression**. Median frame intervals are unchanged: WebGPU high **6.2 ms**, WebGL high **18.2 ms**, and WebGL low **6.1 ms**. Median startup changes are +0.01%, −0.58% and −1.01%, respectively. These are local browser measurements, not isolated GPU timings or predictions for every device. The review-page check passes across 357 source scenes, 79 focused boards, 18 close-up pairs, 156 facility cells and 1,557 linked assets.

Sources remain LiDAR 2024 (campaign bounds 3 February–28 April), RGB+NIR 10 April 2026, and seasonal RGB 2022 with unknown exact capture date. Analysis stays in SWEREF 99 TM / RH2000. The native height diagnostic includes unknown cells and structures; it is not a detector score. It uses source footprints and eligible stand cells, not rasterized rendered leaves. Pixel-centre counts and exact facility-clipped areas are reported separately.

## Reproduce this checkpoint

Retain the earlier cached inputs, frozen application build and rounds one through five unchanged. `input-lock.json` checks their identities. Use the existing pinned Python GIS environment. All outputs below stay under `output/visby-tree-pilot/round6` and this evidence directory.

```powershell
$pilotPython = 'upsalabuild/cache/review-venv/Scripts/python.exe'
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6.py --plan
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6.py --probes
# runtime-probes.json and gap-probe-points.json are retained evidence, not publication approvals.
node tools/visby-tree-pilot/round6-probe.mjs
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6_author.py
node tools/visby-tree-pilot/round6-compile.mjs
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6_canopy_audit.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6_accounting.py
node tools/visby-tree-pilot/round6-preview.mjs capture round6
node tools/visby-tree-pilot/round6-closeups.mjs
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6_validate.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6_rebuild_check.py
node tools/visby-tree-pilot/round6-performance.mjs
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6_finalize.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6_review.py
node tools/visby-tree-pilot/round6-review-check.mjs
# Freeze the final viewer/diagnostics and copy the completed evidence into exports.
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6_finalize.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/round6_review.py
```

Run GPU captures, graph writes and performance measurements serially. Re-running a probe/capture changes diagnostic identities; refresh the final reproduction lock after the final review package is created. Retained decisions can be rebuilt without repeating visual approval: they are explicit agent source interpretations, not a survey or club confirmation. Do not rerun older checkpoint finalizers over locked evidence.

For another ground, use the [general workflow](../../../../../../docs/tree-placement-workflow.md) and its template. These scripts are a Visby adapter. The new reusable lesson is to review residual canopy with exclusion reasons, distinguish crown width from base position, preserve partial issue history, and separate genuine canopy gains from roof explanations.
