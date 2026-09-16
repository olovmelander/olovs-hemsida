# Visby: full-facility tree placement review

This local checkpoint adds **156 rendered individual trees** to round four: **3,524 records / 3,516 rendered individuals**. It preserves all previous records and current assets. Production remains unchanged. It is a source-reviewed improvement, not a complete stem census or a demonstrated 90% precision/recall result.

## Facility coverage and treatment

The reviewed facility polygon covers **1,237,266 m² (1.237 km²)** in **156 stable 100 m cells**, including all 12 inventoried club-facility footprints plus the centre-only lighthouse landmark, the main holes, supplementary golf land, clubhouse, range, practice areas and connecting woodland. Its source is the cached OSM golf outline, unioned with the previous corridor to retain a small shoreline margin. This is a cartographic review scope, not a cadastral boundary.

All **153 added-area source boards** were visually inspected against RGB, infrared, LiDAR height and 2022 seasonal imagery. Three cells retain their previous review without new extension. Across passes, every cell's editable area is inspected: **1,177,453 m² / 100% of editable area / 95.17% of full facility area**. The remaining **59,813 m²** is protected evaluation, excluded from inspection totals. Cell status is **29 reviewed without linked unresolved cases, 127 inspected with ambiguity**. Inspection is not a claim that every tree has a verified position.

**The pink line marks newly reviewed area only. Individual trees can be placed on either side of it.** The full facility boundary controls scope; cell boundaries control ownership. Crown geometry may cross both cell and review-history lines. The viewer has a clickable facility overview, a separate woodland layer, individual footprints and actual rendered bases. Pink review history is optional and initially hidden.

Connected woodland stays in measured density fields. Distinguishable open-grown, path-side, facility-side and woodland-edge crowns are individuals. The catalogue records **156 accepts, 119 source holds, one held base, 326 retained-stand segments, 126 nearby retained representations, 54 protected detections and 11 rejected non-tree segments**. These are review decisions, not a stem count. The held base lies on a path according to the runtime probe; its ID is reserved and prior woodland cells remain. No position was shifted to force rendering.

The 24 existing 1 m stand tiles and remaining 4 m fields are retained; only accepted individual footprints are subtracted. There is no new clearing or automatic expansion of stand eligibility. Existing runtime object/stand formats are unchanged.

## What remains incomplete

The native 1 m height audit now covers the entire facility, including earlier reviewed area outside the pink line. Of **177,627 height-supported pixels at least 3 m high**, **164,931** intersect published individual footprints or eligible woodland cells, versus **164,118** before: a net gain of **813 m²**. This diagnostic includes roofs and overhang and is **not tree recall**.

**12,696 pixels** remain outside both representation layers. Exact polygon clipping gives **12,695.82 m²**: **806.5 m² protected**, **461 m² overlapping explicitly reviewed non-tree segments**, and **11,428.32 m² unresolved**. Every remaining editable gap is retained in **102 spatial cell cases**, including tiny components. No gap is certified merely because its cell was inspected. Native raster-centre counts differ slightly from polygon-clipped area at boundary pixels.

There are also **230,655 unknown-height pixels** within the raster-centre scope. They include open/water areas and incomplete height sampling; they are never treated as proof of tree absence. Young roadside and pond-side trees visible in imagery without defensible height remain unresolved.

The cumulative issue index retains **472 cases**: 238 previous cases, 120 new candidate/base holds, 12 low-vegetation observations and 102 gap cases. They overlap and are not unique trees. The eight previously suppressed individual records remain unchanged. Next useful work is targeted review of the unresolved gap geometries, especially old coarse-mask omissions and young trees; automatic filling would add structures, duplicate canopy or unsupported stems.

The frozen detector evaluation remains **71.4% precision / 62.5% recall**, below the 90% target. This pass did not tune or rescore it. Positions are LiDAR-weighted crown centres, not surveyed trunks. The 2 m uncertainty, 1.5 m vertical setting and confidence value are review defaults, not measured accuracy.

## Validation and comparison

All 156 accepted additions render in WebGPU/high, WebGL/high and WebGL/low. High quality renders **47,377 trees = 3,516 individuals + 43,861 woodland representatives**; low quality renders **32,223 = 3,516 + 28,707**. There are no stand bases inside individual footprints and no bases inside reviewed clearings. All previous records and **61,206 protected stand cells** are unchanged. **16,886 stand cells** change through footprint subtraction.

There are **40 matched screenshot pairs**, including tee and overhead views for all 18 holes and WebGL/high/low views for holes 9 and 16. A byte-identical rebuild passed, as did the 18 existing offline tests. Of the 156 new crowns, 28 had no previous stand-base centre inside their footprint; that is not proof that no rendered canopy previously reached them.

The 18 serial, interleaved performance runs found **no measured regression above 10%**. Median frame intervals were 6.4 → 6.2 ms (WebGPU/high), 18.2 → 18.2 ms (WebGL/high), and 6.1 → 6.1 ms (WebGL/low). Median startup changed by −0.7%, −2.1% and +0.3%; vegetation planning by +4.7%, +3.3% and +1.0%. Transfer bytes fell 0.13%. Maximum all-instance terrain residual, accounting for the renderer's intentional burial, was 0.007 m. This is grounding consistency, not surveyed accuracy. RAF intervals include browser scheduling and are not isolated GPU timings; see `performance.json` for raw identities and limits.

The facility viewer passed its browser checks for **278 source scenes / 1,125 linked assets**, pixel extents, cell navigation, treatment/history toggles and matched comparisons. See `scope-check.json`, `validation.json` and the working directory's `review-page-check.json` for details.

## Sources and reproducibility

Use the retained verified caches and locked inputs: 2024 LiDAR, 10 April 2026 four-band 16 cm orthophotos, and 2022 seasonal RGB with unknown exact date. Coordinates are SWEREF 99 TM / RH2000. RGB/CIR panels use their actual raster edge bounds; the maximum nominal-panel difference is 0.08 m. Cached detections were reused for 114 matching windows and imagery for 88. Offline detector settings and pinned toolchain remain unchanged.

Run from the repository root using `upsalabuild/cache/review-venv/Scripts/python.exe`. Do not regenerate the plan, reannotate decisions, modify prior locks or rebuild the frozen application to reproduce this checkpoint. Stop browser captures/performance before changing its graph. Initial preparation used `round5.py --plan`, `round5_cache.py`, the pinned R 4.5.3 `round5-placement.R`, `round5.py`, `round5.py --candidates` and `round5_boards.py`. The retained `round5-decisions.json` is the actual manual review journal, not an automatic approval rule.

```powershell
$pilotPython = 'upsalabuild/cache/review-venv/Scripts/python.exe'
& $pilotPython tools/visby-tree-pilot/round5_author.py
node tools/visby-tree-pilot/round5-compile.mjs
& $pilotPython tools/visby-tree-pilot/round5_rebuild_check.py
node tools/visby-tree-pilot/round5-probe.mjs
node tools/visby-tree-pilot/round5-preview.mjs capture round5
& $pilotPython tools/visby-tree-pilot/round5_validate.py
& $pilotPython tools/visby-tree-pilot/round5_evidence.py
& $pilotPython tools/visby-tree-pilot/round5_canopy_audit.py
& $pilotPython tools/visby-tree-pilot/round5_gap_accounting.py
& $pilotPython tools/visby-tree-pilot/round5_evidence.py
& $pilotPython tools/visby-tree-pilot/round5_scope_check.py
node tools/visby-tree-pilot/round5-performance.mjs
& $pilotPython tools/visby-tree-pilot/round5_finalize.py
& $pilotPython tools/visby-tree-pilot/round5_review.py
node tools/visby-tree-pilot/round5-review-check.mjs
node tools/visby-tree-pilot/round5-preview.mjs serve round5 8649
```

New measurements can change the performance investigation and diagnostic hashes; retain the original results and record a new evidence checkpoint. The immutable preview root is **50d2d31b10c6b5d02adb499ae40f87e14464b94ec070504624c14c86beb36db6**. The local review is at `http://127.0.0.1:8649/pilot-review/round5/review.html`.

Reuse the general workflow in `docs/tree-placement-workflow.md` for other grounds. These Visby scripts contain ground-specific paths and source assumptions; they are a worked reference, not a fully parameterized pipeline.
