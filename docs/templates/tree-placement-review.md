# Tree placement review: <ground-id> / <review-id>

Copy this into `geo_data/course-v2/<ground-id>/vegetation/reviews/<review-id>/plan.md`. This is a review record, not executable configuration. Follow the [tree workflow](../tree-placement-workflow.md); update this link to `../../../../../../docs/tree-placement-workflow.md` in the copied file.

## Scope and authority

- Ground ID, name and frame fingerprint:
- Course slugs, actual hole counts and shared practice areas:
- Work type: existing ground / new routing / new ground.
- Review date, author/reviewer kind, code revision and working-tree state:
- Authorized scope and desired outcome; default: existing data, agent-led review, existing assets, local preview.
- Prior accepted root/course/ground hashes and rollback location; for a new ground, identify the initial provisional checkpoint instead:
- Source-relative crown placement or independently surveyed stems? State the claim:
- Important shot corridors, signature trees and known problem areas:
- Raw cache/staging paths and verified ignore policy:
- Exact local preview build/serve/capture commands:

## Coverage plan — freeze before inspection

- Scope polygons and union areas: property, playing/practice surfaces + 30 m, additional shot-critical areas:
- Shared-area ownership, review-cell size/IDs, source-panel overlap and affected routings:
- Half-open centre ownership, full crown geometry, detector halo and actual source-panel bounds:
- Valid source coverage per date/band; missing or unsuitable evidence by cell:
- Reference-window overlap, kept separate from systematically inspected area:
- Cell status layer: unreviewed / reviewed / ambiguous / no-data; source, date, reviewer and linked issues:
- Inspected area versus passed area; excluded evaluation area; older sample windows kept separate:
- Reviewed negative/treeless areas and woodland represented as measured stands:
- Evaluation cells reserved before tuning; any later use recorded:
- Completion scope and remaining blocked/unreviewed area; screenshots/sample presence do not establish completeness:

## Source and coordinate inventory

| Source/item | Coverage and missing areas | Capture date/interval | CRS/datum, bands, native resolution | Hash/cache | Uncertainty and usage limits |
|---|---|---|---|---|---|
| LiDAR campaign(s) | | | | | |
| Accepted terrain | | | | | |
| RGB orthophoto | | | | | |
| Infrared, or explicitly unavailable | | | | | |
| Older seasonal image, if useful | | | | | |
| Other corroborating evidence, if available | | | | | |

- Local return-density/completeness measurement, including first/all-return definition:
- Alignment controls/residuals, pixel convention, lattice and seam checks:
- Canopy normalization method and difference from published terrain:
- Unresolved source gaps and the area where claims remain limited:
- Offline tool versions, executable/package hashes and source/code locks:

## Reference and benchmark protocol — complete before seeing evaluation output

- Reference authoring method and reviewer kind; date/hash frozen:
- Interpretable crowns: at least 100; ambiguous crowns recorded separately:
- Calibration areas and representative canopy types:
- Size/height classes, small/young trees below detection threshold, isolated/groups/edges, shadow, seasonal and campaign-seam strata:
- Spatially separate evaluation areas: at least 30 scorable crowns; whole crown groups kept together:
- Clearings, forest-edge segments, scoring polygons and ambiguity masks:
- Matching rule/tolerance, crown IoU definition, centre and edge/gap metrics:
- Full matched-subset and common-reference paired geometry protocol; retain reference IDs and per-crown results:
- Bidirectional edge distances and omission/commission areas; clearing occupancy, gap size and opening connectivity:
- Precision/recall target: at least 90% each for clearly distinguishable references.
- Predeclared boundary/centre improvement tolerances and known sample limits:
- Node baseline and candidate methods; same inputs/masks; parameter search budget:
- Selected settings, selection rule, code/version/input hashes and freeze time:
- Evaluation date, results path, TP/extra/missed counts and per-condition results:
- Metric intervals/assumptions; spatial clustering, sample-selection and generalization limits:
- Residual error classes and next calibration experiment; any post-evaluation diagnostic labelled:
- Did this evaluation inform later edits/tuning? If yes, label it used and name the next unseen sample:

## Placement and stand decisions

- Correction catalogue and QGIS layer paths, geometry CRS and position semantics:
- Decision counts: retain / add / adjust / merge / split / remove / hold:
- Evidence and ID lineage for each correction; reserved/retired IDs:
- Rejected structures, merged source IDs and unique-cell LiDAR centre/height calculation:
- Date ambiguity, confidence interpretation, horizontal/vertical uncertainty:
- Individually mapped play-relevant crowns and remaining stand representation:
- Union of all routings' playing/practice surfaces; near-play 1 m tiles and remaining 4 m tiles:
- Crown footprint, clearing, semantic-exclusion and seam masks:
- Held additions retain prior stands unless a separate clearing/removal decision authorizes a change:
- Unaffected records/cells preserved; any explicitly justified eligibility expansion:
- Residual measured canopy outside individuals/stands; coarse-mask omissions and exclusion reasons reviewed:
- Base-placement versus crown-overhang conflicts and unresolved cases:
- Cross-pass issue index: stable issue IDs, geometry, play impact, related records, reason, required evidence and status:
- Runtime-suppressed records reconciled separately from source ambiguity; repeated observations deduplicated:
- Loaded/planned/drawn populations; analytic, atlas, apron and facility-filter probes; inferred versus directly reported rejection reasons:
- Asset catalogue, pivot/scale convention, height/width limits and visual-only species/type defaults:
- Ground adapter entrypoint; reviewed assumptions and preservation of non-tree objects:
- Explicit ground/frame/source/routing/path inputs; second-ground exercise and remaining manual steps before claiming generic reuse:

## Verification and decision

| Gate | Command/evidence | Result and limits |
|---|---|---|
| Source coverage, alignment, band/nodata and density | | |
| Review-cell accounting, all-hole status and explicit blocked/unreviewed areas | | |
| Frozen held-out detector comparison | | |
| Paired geometry metrics, bidirectional forest edges and gap preservation | | |
| Stable IDs, deterministic rebuild, retained data and tile seams | | |
| Every accepted tree visible; terrain bases and exclusions | | |
| Individual/stand/legacy duplicate ownership and clearings | | |
| Every-hole matched overhead/tee and signature close views | | |
| Actual WebGPU / WebGL / low-quality mode | | |
| At least three interleaved performance runs; >10% regressions investigated | | |
| Shared routings, startup packages, cache/offline/rollback as applicable | | |
| Applicable independent-control and visual-review release gates | | |

- Status: source-reviewed local improvement / local pilot closed with exceptions / held-out target met / ready for release / still provisional.
- Automatic target met? If not, state that the baseline/default is retained:
- Reviewed area/coverage, not just accepted-tree count:
- Review map, matched views, findings and exact reproduction commands:
- Actual release status: local only / published within existing authorization; reference:
- Remaining issues, missing evidence and next useful action:

## Bounded completion

- Final pass selection, finite scope and stopping condition:
- Every selected case has a recorded disposition; accepted edits have completed validation:
- Local delivery closed? Separate full-representation, detector, surveyed-accuracy and release status:
- Prioritized exceptions linked to the full issue ledger, with exact evidence or change needed:
- Ground-boundary error versus valid grass with a source-supported tree versus uncertain base; source polygon IDs/distances and runtime probes:
- No canopy-shaped ground holes or source-centre relocation used to bypass exclusions:
- Any required exclusion-policy change explicitly scoped with source trust, hard-surface and procedural-woodland controls:
- Runtime evidence freshly measured or inherited? If inherited, record unchanged graph/build/assets/records/stands and evidence hashes:
- Frozen accepted local checkpoint, comparison URL, reproduction command and default/production disposition:
- Explicit reopening triggers; no automatic next pass on unchanged ambiguous evidence:

## Coverage and maintenance

Add one row for each hole of each routing; do not assume 18 holes. Record shared physical areas once and reference them from affected rows. State each geometric denominator; do not sum overlapping hole buffers. Link a second treatment/visual ledger if needed for readability.

| Slug / hole | Scope area / cell IDs | Valid source area / dates | Inspected / ambiguous / no-data / unreviewed area | Issue IDs | Treatment / visual check / generation |
|---|---|---|---|---|---|
| | | | | | |

All cells must be accounted for before claiming completion. Ambiguous/no-data cells remain blocked and do not count as passed; accepted-tree counts and review-window overlap are reported separately.

Triggers for the next review: confirmed planting/removal, source campaign change, edited playing surfaces/exclusions, alignment failure, new routing, or changed asset dimensions. Preserve this checkpoint and start a new dated review rather than overwriting frozen references.

## Full-facility scope and mixed tree treatment

- Facility polygon path, source/date/hash and boundary interpretation (not a legal boundary unless evidenced):
- Area and every included routing, clubhouse, parking, range, practice/service area and connecting woodland:
- Minimap/display bounds versus actual facility scope:
- Stable base grid, complex subareas requiring finer review, and unique crown ownership:
- Individual-tree review/accepted crown layer:
- Measured dense-woodland treatment layer and preserved gaps/edges:
- Prior reviewed area carried forward, newly added area and unresolved/protected/no-data area:
- Completion denominator: full facility; list any deliberately separate surrounding-land scope.
- Viewer legend distinguishing facility, cell, review-history and vegetation-treatment geometry; confirm individual placement is allowed outside any latest-review polygon:
- Whole-facility supported-height audit: native grid, threshold, unknown-height area, published individual footprints excluding suppressed records, and eligible woodland coverage:
- Before/after represented area, unrepresented height geometry, structure/protected overlap, and unresolved gap cases including small components:
- Focused residual selection threshold, selected area/percentage, every selected patch's source/exclusion review, and retained smaller patches:
- Separate physical crown/stand improvements from building explanations; exact resolved subgeometry and prior issue lineage:
- Distinct crown versus broad fairway/practice-mask conflicts: runtime probes, ground-boundary evidence, no unsupported base relocation:
- Crown-size edits: retained base/ID/height, irregular footprint versus approximate asset radius, rendered width checks and matched close views:
- State separately whether every editable cell was inspected and whether complete tree representation is established; do not infer the latter from the former:
