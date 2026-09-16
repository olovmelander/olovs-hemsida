# Visby fourth local tree-placement checkpoint

This checkpoint finishes the **playing/practice surfaces plus 30 m** review scope. It is not full-facility coverage. The next pass expands to a separately recorded facility polygon.

All 91 previously uninspected editable cells were visually inspected against 2026-04-10 RGB/infrared, 2024 LiDAR and seasonal 2022 imagery. Together with the third pass, 117 of 119 cells have inspected portions: 613,485.7 m? / 93.14% of the corridor, or 100% of its editable area. Two cells are entirely protected; protected portions across the grid total 45,166.1 m?. Forty-five cells have no linked unresolved cases and 72 retain ambiguity.

The isolated preview adds **138 individuals**, retaining all 3,230 previous records, for **3,368 records / 3,360 rendered individuals**. Twenty-seven further source-supported crowns have unresolved bases rejected by existing renderer rules; their previous stand coverage remains. Source review also retains 96 connected woodland candidates as stands, rejects one practice-net return, and holds 103 uncertain candidates. The cumulative index contains 238 review cases, not unique trees, including 12 new low-vegetation observations and the eight previous suppressed records.

No detector retuning or new accuracy score is claimed. The frozen evaluation remains below the 90% precision/recall target. Positions are LiDAR-weighted crown centres, not surveyed trunks; uncertainty settings are interpretation judgements. Production and previous previews remain unchanged.

## Reproduce this checkpoint

Use the retained Python environment and R/lidR toolchain from the pilot. Run from the repository root; execute mutations and captures sequentially:

1. `python tools/visby-tree-pilot/round4.py --plan`
2. `python tools/visby-tree-pilot/round4.py` (verified imagery, resumable)
3. `Rscript tools/visby-tree-pilot/round4-placement.R`
4. `python tools/visby-tree-pilot/round4.py --candidates`
5. Inspect every selected cell; retain explicit choices in `round4-decisions.json`.
6. `python tools/visby-tree-pilot/round4_author.py`
7. `node tools/visby-tree-pilot/round4-compile.mjs`
8. `node tools/visby-tree-pilot/round4-preview.mjs capture round4`
9. `python tools/visby-tree-pilot/round4_validate.py`
10. `python tools/visby-tree-pilot/round4_evidence.py`
11. `node tools/visby-tree-pilot/round4-performance.mjs`
12. `python tools/visby-tree-pilot/round4_finalize.py` and `python tools/visby-tree-pilot/round4_review.py`

The deterministic rebuild check reauthors and recompiles the same decisions. Run it before captures, then rerun evidence reconciliation. Do not rebuild while a preview is being captured: its catalogue/startup files must remain a single immutable generation. Performance runs must be serial with no concurrent offline processing or captures.

The 40 matched screenshot pairs cover all 18 WebGPU overhead/tee views and WebGL high/low tee views at holes 9 and 16. Validation checks all accepted individuals, no stand bases in individual footprints, no tree bases in reviewed clearings, unchanged prior IDs/records, stable input identities and 61,206 protected stand cells. Consult `validation.json` and `performance.json` for finalized evidence. Performance uses three interleaved cold-context pairs per renderer/quality, with full terrain grounding checked on the first repeat and reused only after invariant population/catalogue checks.

## Coverage meaning

White source polygons identify the owned **corridor portion**, not the entire 100 m square. Outside that portion, existing individuals and measured woodland remain in the runtime; individual stem positions were not certified by this review. A source panel is 130 m wide and includes context. The full facility needs its own polygon, cells and denominator. Dense woodland can pass a treatment review while remaining density-based; this is not a census of stems.
