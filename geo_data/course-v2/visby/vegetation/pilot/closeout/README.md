# Visby tree-placement pilot: closed with exceptions

2026-09-16. The bounded **local pilot is complete**. Its retained placement is [round six](../round6/README.md), root `70e22f94d875123830352aaf7f991f5fc31d6c279efd5341f32e67ae7e28d65d`. Complete tree representation, the 90% detector target, surveyed stem accuracy and production release are **not established**. Production keeps its baseline.

Open the [final review](http://127.0.0.1:8650/pilot-review/closeout/index.html), [full facility map and comparisons](http://127.0.0.1:8650/pilot-review/round6/review.html), or [local course](http://127.0.0.1:8650/?bana=visby&v2=require&ghibli=1). Start the retained server if needed:

```powershell
node tools/visby-tree-pilot/round6-preview.mjs serve round6 8650
```

## Final bounded improvement

This closeout audits the frozen ground geometry at **all 27 distinct-crown conflict patches**, links each to its actual source polygons and previous issue IDs, and reinspects six clear examples in RGB, CIR, seasonal imagery and LiDAR. It delivers a finite, prioritized [exception catalogue](ground-conflicts.json), a [QGIS layer](ground-conflicts.geojson), associated [ground polygons](ground-features.geojson), and a [compact table](ground-conflicts.csv). All 27 remain unresolved; patches are not unique trees. The other 21 retain their earlier detailed source interpretation rather than receiving a new visual approval.

**No tree positions, dimensions, counts, ground geometry or runtime rules change in this final audit.** The earlier six crown-size corrections and all full-facility placements remain the accepted local comparison. A diagnostic gap centre is not a proposed stem.

The ground review refines the earlier recommendation: a visible tree does not necessarily mean the grass polygon is wrong. Clear trees can occur within mown grass. In `gap-009`, near hole 13, the diagnostic point is approximately **3.74 m outside** the frozen fairway polygon while the retained runtime probe reports a mown margin. The analytic probe's unrelated hole identifier must not be used as ownership; nearest routing is reported separately for orientation. The other detailed examples are `gap-017`, `018`, `022`, `050` and `064`, around holes 2, 16, 6, 9 and the practice/range area.

These conflicts cannot be resolved just by running another detector. Any future correction must distinguish an inaccurate ground boundary from a valid grass surface with a real tree and from an uncertain base beneath overhang. Correcting the latter requires a separately scoped exclusion-policy change with explicit source trust and hard-surface controls. Cutting canopy-shaped holes into fairways, shifting centres until they pass a filter, or relaxing every tree exclusion would not establish more accurate placement. Attribution to a particular filter is an inference from retained analytic/atlas probes, not a direct runtime rejection report for newly planted candidates.

The held road candidate retains reserved ID `tree-visby-003535`. Bunker and tee cases retain their base-position questions. Connected crowns retain identity uncertainty. No stands are cleared for held candidates; no protected evaluation geometry is edited.

## What is complete, and what remains

| Item | Final status |
|---|---|
| Facility review scope | 1.237 km², 156 cells, including holes, clubhouse, range, practice/service areas and woodland. Review extent, not a surveyed property boundary. |
| Systematic source inspection | All editable area inspected; 95.17% of total facility area. Protected evaluation remains separate. |
| Cell outcomes | 29 reviewed, 127 ambiguous in the retained cell ledger; zero unreviewed editable area. An ambiguous cell is inspected, not passed. |
| Individual trees | 3,524 records / 3,516 rendered individuals. Eight older suppressed records remain in the issue ledger. |
| Woodland | Measured density treatment retained; 24 fine 1 m tiles, 4 m elsewhere. High-quality rendering has 43,861 stand representatives, not measured individual stems. |
| Latest physical refinement | Six existing crowns widened in round six; 183 additional native height pixels represented. |
| Representation exceptions | 10,525.32 m² unresolved height gaps. They include crowns, overhang and mask conflicts and do not count missing trees. |
| Smaller residuals | 1,546 components / 4,512.82 m² were not individually inspected in the focused residual pass; their spatial ledger is retained. |
| Prior issues | All 472 prior case identities remain linked. This audit does not close them or add their overlapping areas as unique trees. |
| Detector accuracy | Frozen result remains 71.4% precision / 62.5% recall; 90% targets missed. No new independent score. |
| Runtime and performance | Retained passing checks apply to the same frozen graph, build and assets. No regression above 10% in the retained three-repeat comparison. |
| Release | Local comparison delivered; production unchanged. |

The 40 matched all-hole pairs, 18 close-view pairs, WebGPU/WebGL/low-quality checks, stable IDs, grounding, duplicate prevention, protected data, source tests and deterministic rebuild are linked in [closeout.json](closeout.json). They are inherited evidence, not fresh benchmarks. The input lock verifies the complete retained preview overlay and application build, vegetation records and stand files, selected source rasters/boards, production-root identity and previous evidence.

## Stop and reopen conditions

**No automatic next review pass is recommended for this local pilot.** Every selected closeout patch has a disposition and a specific dependency. The remaining uncertainty is visible without keeping the task open indefinitely.

Reopen a new, bounded task when there is a confirmed tree change, new source evidence, a demonstrated defect, or an explicitly scoped ground/exclusion correction. Production adoption is a separate task with its outstanding gates; closing the pilot does not waive them. Retain the complete old issue ledger rather than treating the six priority examples as the entire backlog.

For another course, use the [general workflow](../../../../../../docs/tree-placement-workflow.md) and [template](../../../../../../docs/templates/tree-placement-review.md). Both now include local-pilot stopping criteria and the distinction between ground-boundary errors and source-supported trees on valid grass surfaces. These scripts are Visby adapters, not a generic one-command course mapper.

## Reproduce the closeout

Keep every earlier checkpoint unchanged. The final audit needs only the retained cached data; it does not rebuild the app or acquire sources.

```powershell
$pilotPython = 'upsalabuild/cache/review-venv/Scripts/python.exe'
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/closeout.py
node tools/visby-tree-pilot/closeout-check.mjs
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/closeout.py --seal
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/closeout.py --check
```

`viewer-check.json` records the final page/map/case selection, source-image and export-link checks. `input-lock.json` pins unchanged historical inputs; `reproduction-lock.json` pins this final package and guide revision. A later guide edit should preserve this closeout as historical evidence and record the new guide revision separately.
