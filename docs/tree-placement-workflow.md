# Tree placement workflow for every golf ground

Updated 2026-09-16. Use this for improving an existing course, adding a routing to an existing ground, or building a new ground. Start by copying the [course review template](templates/tree-placement-review.md). The [production guide](v2-course-runbook.md) still owns spatial, runtime and release contracts; the [mapping workflow](v2-course-mapping-workflow.md) owns general source acquisition and adoption.

Our recommended method is **LiDAR + RGB orthophotos + near-infrared imagery where available + visual review + an unseen evaluation sample**. Keep individual, play-relevant trees distinct from woodland represented by measured density. Keep the current tree assets while testing geography, then improve appearance separately.

This is the reusable quality process we want across the app. It is not a claim that one detector is universally best, that every course has sufficient source data, or that this is already a one-command pipeline. lidR explicitly describes detection and segmentation as data-dependent; algorithm and canopy-model choices change the result. Select settings for each ground through a benchmark. [lidR method documentation](https://r-lidar.github.io/lidRbook/itd.html)

## What Visby established

We are satisfied with the source-reviewed improvements and the reproducible comparison. We have **not** established accurate automatic placement of every tree or surveyed trunk positions.

The [second Visby pass](../geo_data/course-v2/visby/vegetation/pilot/round2/README.md) added 18 reviewed individuals to the first pilot, retained its 3,151 records, and left 11 further candidates unresolved. Its fresh evaluation had 64 scorable crowns. The new method and current Node detector both scored 66.7% F1; mean crown overlap increased from 51.5% to 57.3% on their respective matched subsets, while median centre disagreement worsened from 1.77 to 1.94 m. The 90% precision/recall target was missed. Production remains unchanged.

The subsequent [coverage and paired-accuracy audit](../geo_data/course-v2/visby/vegetation/pilot/coverage-audit/README.md) separates image availability from completed review. Recorded RGBI footprints cover the defined playing/practice corridor plus 30 m, but the first two passes' detailed review windows intersect only **26.4%** of it; even that is an upper bound on review opportunity, not completed inspection. At that checkpoint, hole 1 had no dedicated sample, 34 catalogue cases remained unresolved, and eight retained individual records were absent from exported renderer instances. On the **same 31 references matched by both detectors**, crown overlap improves from 51.8% to 59.3% and median centre disagreement from 1.71 to 1.32 m; p95 slightly worsens. This post-evaluation diagnostic does not change the failed detection gate or establish whole-course accuracy.

The [third Visby pass](../geo_data/course-v2/visby/vegetation/pilot/round3/README.md) adds **61 source-reviewed individuals**, retaining all 3,169 previous records, for **3,230 records / 3,222 rendered individuals**. It inspects 26 owned grid cells, including hole 1's full diagnostic corridor: **166,321 m² / 25.3%** of the whole corridor in this pass. Seven cells have no linked unresolved cases; 19 retain ambiguity after reconciling neighbouring and previous cases. This inspected-area measure must not be added to the older 26.4% sample-window measure. It rejects 12 structure detections, holds 11 ground-conflicting additions without clearing their prior stands, and provides a cross-pass issue index. The eight retained suppressed records remain unresolved after source/filter review. The frozen detector score and production default are unchanged.

The [full-facility Visby checkpoint](../geo_data/course-v2/visby/vegetation/pilot/round5/README.md) extends the completed fourth-pass corridor review to **1.237 km² in 156 cells**, including clubhouse, range, practice/service areas and connecting woodland. It adds **156 rendered individuals** over round four, for **3,524 records / 3,516 rendered individuals**. All editable facility area is inspected; protected evaluation leaves the full-area inspection measure at **95.17%**. The new full-facility representation audit retains **11,428 m² of unresolved height gaps** across 102 cells. These can include structures, overhang and inherited woodland-mask omissions, so they are not a missing-tree count. This distinction between completed review and incomplete representation is part of the reusable workflow.

The [focused sixth pass](../geo_data/course-v2/visby/vegetation/pilot/round6/README.md) inspects all **79 residual components at least 25 m²**: 6,915.5 m², about 60.5% of the prior unresolved gap area. It enlarges six existing crown estimates without moving bases, accounting for **183 m²** of additional height support. Six building patches explain another **720 m²**; this is an accounting correction, not added tree coverage. **10,525 m² remains unresolved.** The 27 distinct-crown patches conflicting with fairway/practice/path masks identify the next ground-geometry review; they are not 27 accepted new trees. Smaller residuals remain in the ledger. Tree counts and the frozen detector score are unchanged.

The [Visby closeout](../geo_data/course-v2/visby/vegetation/pilot/closeout/README.md) ends the bounded local pilot with the round-six placement unchanged. It audits all 27 distinct-crown ground conflicts and reinspects six clear examples. Each exception has a retained identity and a specific resolution dependency. All editable facility area was inspected, but ambiguous cells, incomplete tree representation and the failed detector gate remain explicit. No automatic next pass or production promotion follows from closing the pilot.

Reuse the process, evidence formats and checks. Do not copy Visby's dates, coverage, origin, annotation coordinates, tree IDs, species assumptions, detector settings or reported accuracy into another ground. Its scripts are a worked implementation requiring adaptation, not a generic course builder.

## 1. Define the ground, scope and baseline

Trees belong to the **physical ground**, not separately to each routing. List every course slug sharing that ground and include their playing and practice areas in exclusions, near-play refinement and review.

| Starting situation | Required starting point |
|---|---|
| Existing ground | Resolve the active root → course → ground manifests. Freeze that generation, records, stand fields, source hashes, assets, views and performance. Preserve accepted geometry and stable IDs. |
| New routing on an existing ground | Reuse the ground and its tree identities. Add the routing's playing surfaces to the shared review and exclusion geometry; inspect all affected routings. |
| Entirely new ground | Establish its identity, coordinate frame, terrain, playing geometry and registered routing/fallback through the production guide first. Current acquisition/compilation tools need a registered ground and an existing ground graph. Record an initial provisional or terrain-only checkpoint; do not invent an older tree census. |

Before changing anything, record the source and runtime authority, actual hole count, review ID, all affected slugs, and whether the task is a local pilot or an authorized release. Default to existing accessible data, agent-led source review, existing assets and an isolated local preview. A new source campaign or a later experiment gets a new review directory.

Capture matched overhead and tee views for **every actual hole**, plus close views of signature trees, narrow shot corridors, forest edges and known trouble spots. Freeze cameras, lighting, quality settings and the asset catalogue. Record the current population by placement source: individual records, stand representatives and legacy scatter.

### Make review coverage measurable

**Default to the full golf facility.** Freeze an explicit facility review polygon covering all routings, clubhouse/parking, driving range, practice areas, service buildings, connecting land and relevant woodland. Check a retained cartographic outline against dated imagery and the facility inventory; label it as a review extent unless a surveyed property boundary is actually available. Record the union of playing/practice surfaces plus 30 m as a separate refinement and priority layer, along with additional shot-critical areas/signature trees. The 30 m corridor is the minimum stand-refinement scope, not the limit of important tree placement. Record each denominator in square metres; shared holes/routings must not double-count physical area.

Track these separately:

| Coverage measure | What it establishes |
|---|---|
| Valid source footprints, by source/date | Evidence is available; this does not prove suitable density, alignment or visibility. |
| Reference/review-window intersection | Where detailed interpretation was possible; selected annotations do not certify every crown in a window. |
| Systematically inspected area | Where individuals, stands, gaps and exclusions were explicitly checked. Preserve reviewed negative/treeless areas too. |
| Accepted corrections and unresolved issues | What was decided, its evidence and what remains unknown. Counts are not an area-completeness measure. |
| Rendered-instance checks and matched views | Whether intended changes appear in the app; screenshots alone are not a tree inventory. |

Use a configurable review grid (100 m cells are a practical starting point), with overlapping source panels and unique cell ownership. Mark each cell `unreviewed`, `reviewed`, `ambiguous` or `no-data`, with review date, source references, reviewer and issue links. A reviewed cell may retain measured woodland interiors without inventing individual stems. Reserve evaluation cells before tuning and keep their evidence isolated from calibration.

Use the facility polygon to select cells; a minimap rectangle is only an orientation aid. Visby's minimap is the hole centre-line bounding box plus 90 m, so it can include unrelated land and does not establish full-facility coverage. Use a stable base grid for ownership and progress, then subdivide complex review work within it: distinct trees, woodland edges, paths, buildings and small gaps need closer inspection; dense woodland interiors and verified open grass can use larger treatment areas. This adaptive review effort must never silently remove low-priority cells from the coverage denominator.

Keep **scope**, **review history** and **vegetation treatment** separate in the viewer. A pink outline used to show newly reviewed area is never an individual-tree placement boundary. Show the complete cell frame, facility intersection and protected evaluation separately, with a clickable facility overview. Individual crowns may lie anywhere in the facility where source evidence supports them; full crown footprints can cross cell/review lines. Retain earlier placements outside the latest extension and make them visible in the same map.

Keep separate, inspectable geometry layers for **facility scope**, **grid cells**, **reviewed/uncertain areas**, **individual crown footprints**, **woodland treatment**, and **clearings/exclusions**. Clearly label every line in the review UI. Selecting a cell does not authorize filling it with trees. Dense woodland is populated only within measured, reviewed canopy/stand geometry; its generated bases are representatives, not surveyed stems. Distinct open-grown and play-, view-, facility- or path-relevant crowns should have individual records where the evidence supports identity, dimensions and a defensible base. Subtract accepted individual footprints from stand coverage. Record edge overhang separately from base eligibility.

Separate the owned review area from image context and the detector halo. Visby's third pass owns centres on half-open 100 m cells, displays 130 m source panels and detects with a 20 m halo; these dimensions serve different purposes. Keep full crown geometry across seams, but count each centre once. Compute inspected area from owned cells clipped to the scope and minus protected evaluation regions. Map imagery using its actual bounds, not the smaller ownership width. Record `inspected` separately from a passing `reviewed` status: an inspected cell with unresolved cases remains `ambiguous`.

Reconcile cell status against unresolved geometry from every pass and neighbouring cells, not only candidates whose centres belong to that cell. Link cross-boundary cases without counting them as separate trees. Native pixel counts can also round the displayed raster extent; use actual pixel-edge bounds for each layer and retain any difference from the nominal panel extent.

A corridor-only checkpoint must be explicitly named as such; never label it full-cell or full-facility mapping. Extending the scope requires a new polygon/denominator and reviews of the added portions, including cells partly inspected before. Carry forward existing individual IDs, stand decisions and unresolved cases.

Before claiming completion of a stated scope, account for **every cell**: all must be reviewed or explicitly listed as blocked by ambiguity/missing data. Blocked cells do not count as passed; report reviewed area, blocked area and unreviewed area separately. An all-hole screenshot set, a sample on each hole, or 100 reference crowns does not satisfy this coverage gate. Report exact union areas and per-hole status; overlapping diagnostic hole buffers must not be summed.

## 2. Inventory and qualify the source evidence

| Evidence | Main use | Limit to retain in the report |
|---|---|---|
| LiDAR point cloud and canopy-height model | Crown candidates, height, grouping, measured canopy, gaps and density | Sparse returns and seasonal coverage can hide or merge trees. A canopy centre is not a measured trunk. |
| RGB orthophoto | Crown interpretation, forest edges, clearings, paths and visible change | Image date matters; shadows and displaced treetops can mislead. |
| Near-infrared band / colour infrared | Supporting vegetation contrast and crown interpretation | Grass also responds; shadows, leaf-off conditions and radiometry prevent a universal tree threshold. |
| Older leaf-on imagery | Supporting crown shape and seasonal interpretation | Older evidence does not prove current presence, dimensions or a removal. |
| Accepted terrain | Normalization checks and final tree-base heights | Resolution and encoding precision do not establish survey accuracy. |
| Dated tree inventories, club photographs or surveys, when already available | Important tree identity, current condition, dimensions and stronger location evidence | Verify what was measured, its date and whether positions denote stems, crowns or approximate observations. |

For Swedish grounds, use existing Lantmäteriet access and the repository's acquisition adapters. Select campaigns that cover the full property and review surroundings; inspect capture metadata instead of assuming the newest catalogue item is locally suitable. Laserdata Skog's published nominal density is 1–2 points/m²; measure actual local density and completeness rather than applying that number to every tile. [Lantmäteriet product description](https://www2.lantmateriet.se/en/geodata/our-products/product-list/laser-data-download-forest/)

Record provider/item IDs, source URLs, hashes, actual capture date or known interval, coverage, native resolution, band identities, nodata rules, horizontal/vertical CRS, stated accuracy and applicable source terms. Keep download time separate from capture time. Reuse verified cached files; acquire missing coverage without overwriting an accepted snapshot. Keep raw bulk in a verified ignored cache or external working directory, and compact evidence in the ground's source ledger. Never store credentials in reports.

Use **SWEREF 99 TM (`EPSG:3006`) and RH2000 (`EPSG:5613`), compound `EPSG:5845`**, for this app's Swedish ground pipeline. Record the frame fingerprint and immutable origin. Check axis order, metres, image pixel edges versus centres, raster orientation, tile origins, seams, masks and transform residuals using stable ground-level features. Do not align sources using treetop centres. Standard orthophotos can displace elevated objects from their ground positions. [Lantmäteriet orthophoto explanation](https://www.lantmateriet.se/sv/geotorget-produktstod/fragor-och-svar/)

**Source gate:** unresolved systematic alignment errors, missing height support, uncertain vertical datum or incomplete coverage must be visible in a coverage map and addressed before claiming precise placement in the affected area. Valid areas may still proceed as a bounded local review. If infrared is unavailable, proceed with LiDAR + RGB and label the missing evidence; do not manufacture an IR band from RGB. If LiDAR is unavailable, do not silently substitute a surveyed-looking individual-tree layer from image colours.

## 3. Prepare consistent review layers

Build or reuse canopy height, source-ground, return-density and validity rasters. Check cloud-derived ground against the accepted terrain and document the normalization method. Tree bases must ultimately sample the exact terrain generation used by the app, even if canopy normalization uses the cloud's own ground returns.

Produce co-registered RGB, false-colour infrared, vegetation-contrast and LiDAR-height panels plus campaign/coverage overlays. Verify band meaning in metadata before choosing channel order. A ratio such as `(NIR − red) / (NIR + red)` from delivered image values is a **review contrast**, not automatically calibrated reflectance/NDVI; guard zero denominators and nodata. Retain optional RGBI reading without changing existing RGB callers.

Use a common input extent, resolution and validity mask when comparing detectors. A 1 m canopy grid is a starting point for the existing pipeline, not proof of one-metre location accuracy. Raster upsampling cannot create new height observations. Use overlap around processing tiles sufficient for the largest detection/growth window, then apply deterministic ownership at seams. Validate sparse crowns, missing cells and neighbouring tile results before a full run.

## 4. Freeze a reference sample and benchmark detection

Create at least **100 clearly interpretable reference crowns per ground**, distributed across isolated trees, small groups, woodland edges, crown sizes and the source conditions actually present. Record ambiguous crowns separately and include representative clearings and forest-edge segments. A reference is an interpreted crown centre/outline unless an independent stem survey exists.

Include small/young trees, conifer/broadleaf forms where interpretable, joined crowns, shadow, leaf-on/leaf-off differences and campaign seams. Record trees excluded by the detector's minimum-height rule as a separate class: for example, a 3 m cutoff must not silently turn a young tree into a correct negative. Report source support and detection results by height/size class; if height is indeterminate, retain the ambiguity instead of forcing it into the score.

Reserve at least **30 scorable crowns in spatially separate evaluation areas**, normally on two or more holes. Use the routing's actual hole count and distribution; holes 9 and 16 are not universal holdouts. Keep whole crown groups and adjacent windows together rather than randomly splitting neighbouring trees. Declare review/scoring polygons, ambiguity masks and the matching rule before looking at predictions. Freeze their hashes and the annotation time.

Compare the current Node detector with real lidR Dalponte and Silva implementations on the same inputs. Pin executable/package versions, algorithm code, source hashes and parameters. Tune only in calibration areas. Record window **diameter versus radius** explicitly; smoothing, minimum height and maximum crown extent can all change which trees are detected. Optional sparse-canopy recovery, image-assisted segmentation or point-cloud methods must earn their place in this comparison.

Rank calibration results by detection F1, then crown-boundary agreement, then centre disagreement. Freeze the selection before scoring evaluation areas. Report TP, extra/missed crowns, precision, recall, F1, crown IoU, median/p95 centre disagreement, and forest-edge/gap disagreement. Use one-to-one matching; the Visby default is 4 m, declared in advance and assessed against the new ground's uncertainty. Also inspect important misses and false positives individually. Report stratified results so a strong isolated-tree score cannot conceal poor woodland edges.

Report geometry metrics both on each method's full matched subset and on the **intersection of reference IDs matched by baseline and candidate**, retaining the IDs and per-crown measurements. This paired comparison makes a centre/boundary improvement easier to interpret when methods detect different trees; it must accompany full detection counts, since it omits misses. Predeclare this comparison for future experiments. An added post-evaluation diagnostic must be labelled as such and must not retrospectively choose the winner.

Measure forest boundaries in **both directions**, reference to predicted occupancy and predicted to reference, with declared sampling, mean/p95 distances and separate omission/commission areas. Score reviewed clearings by false occupied area, gap size and whether important openings remain connected. Two favourable edge segments or a one-way distance can miss extra forest and closed gaps. Keep individual-crown occupancy, stand coverage and rendered bases distinguishable in these checks.

**Benchmark gate:** the pilot target is at least 90% precision and recall for clearly distinguishable reference crowns, with better boundary/centre agreement than the baseline. Record counts, sample selection and metric uncertainty; a small purposive sample is not a course-wide accuracy certificate. Metric tolerances must be chosen before evaluation, not relaxed after seeing failures. If targets are missed, retain the accepted baseline/default and use candidates only for explicit local review. Do not infer that a named algorithm, more trees, or more detail is automatically better.

Include uncertainty intervals with their assumptions. Binomial intervals may describe the sample but do not account for spatially clustered, purposively selected crowns; use spatial blocks if making broader statistical comparisons. The minimum 30 held-out crowns is a starting sample requirement, not proof of 90% accuracy throughout a ground.

Let observed errors determine the next experiment. For merged/missed crowns, test canopy-model construction and smoothing, multi-scale height-dependent treetop windows, or point-cloud treetop detection on the same calibration evidence. Pin normalization, masks and height thresholds as well as segmentation settings. lidR documents both point-cloud and canopy-model approaches and their dependence on input quality. A finer raster or a more complex model is a candidate to benchmark, not an automatic improvement. [lidR detection and segmentation](https://r-lidar.github.io/lidRbook/itd.html)

Editing against a reference is source conformance, not a new held-out accuracy measurement. Preserve evaluation areas for future checks where possible. If evaluation annotations inform later edits or tuning, label that sample as used and create a genuinely unseen sample before claiming a new independent evaluation.

## 5. Make explicit placement decisions

Review play-relevant candidates over RGB, infrared where available, height, actual return support, existing individuals and playing geometry. Prioritize trees that shape a tee shot, landing area, green approach, recognizable silhouette or narrow woodland opening.

| Decision | Required evidence and action |
|---|---|
| Retain | An existing record represents the crown; preserve identity and accepted geometry. |
| Add / promote from stand | Distinguishable crown with defensible LiDAR height and source-relative position. Assign a stable ID and remove its footprint from stand eligibility. |
| Adjust | Explicit positional, height or crown-size evidence; retain the existing ID and before/after values. Do not move a tree merely to match an image centre. |
| Merge / split | Inspect actual source support and existing identity. Record lineage and retired/reserved IDs; never renumber the whole ground or reuse a removed ID. |
| Remove | Dated, corroborated evidence of absence/removal, accounting for visibility and source-date differences. A missing detection, empty query or low IR response is insufficient. |
| Hold | Ambiguous tree/shrub identity, joined crowns, clipped coverage, conflicting dates, unsupported height or uncertain base. Keep the reason and next useful evidence; do not invent a location. |

An image-only apparent new tree without defensible height support stays unresolved. Crown overhang and base position are separate claims: canopy above a fairway does not prove a trunk in the fairway. If the renderer's ground exclusion suppresses a proposed tree, inspect source and surface geometry; do not move it sideways merely to make it render. Correct an exclusion only with evidence. Any held overhang mask must itself be a documented decision, not an unrecorded clearing.

The offline correction catalogue must contain stable ID/lineage, source references/hashes/dates, crown geometry and CRS, position semantics, height support, before/after values, decision, reason, reviewer kind, uncertainty and unresolved status. Export a QGIS-compatible layer. Confidence settings are judgements unless calibrated; the existing 1.5 m floor is not measured accuracy. Never turn an unknown capture date into an invented exact date. If a runtime field requires a single date, record any compatibility bound explicitly in the catalogue.

Maintain one issue index across review passes, referencing the immutable source catalogues. Give each issue a stable ID, geometry, affected holes, play impact, reason, required next evidence, status and related record/crown IDs. Reconcile repeated observations before counting unique unresolved trees. Track ambiguous source crowns and runtime-suppressed registry records separately: neither automatically proves a missing real tree. Resolve source-supported high-impact cases first; preserve unresolved history rather than silently dropping it in a new pass.

Review height-supported candidates for buildings and other structures as well as vegetation. Height alone does not establish a tree; Visby's third pass rejected roof and lighthouse detections using the source panels. When two detections describe one crown, preserve both source IDs, union their supported geometry, and recompute dimensions/centre from unique LiDAR cells. Do not average image centres or double-count overlapping height samples. A defensible crown merge can still remain held if its inferred base conflicts with the ground.

Agent-led review is valid evidence of agent review. Do not relabel it as a survey, independent club confirmation or human visual approval. Follow the production guide's applicable independent-control and human-review gates, together with any explicit owner-authorized review policy. Local source review can proceed without waiting for a new approval request.

## 6. Build individuals, stands and asset dimensions together

Publish distinguishable, play-relevant crowns as individual records. Keep dense woodland interiors as **measured stand coverage/density/height**, with representative rendering rather than a claimed tree census. Preserve clearings, narrow gaps, woodland fingers and important edge trees.

Use **1 m stand fields on tiles intersecting playing/practice surfaces and their 30 m surroundings**, starting with the union across all routings. Keep **4 m fields elsewhere** unless a documented source/performance case warrants another choice. The 30 m rule controls stand resolution; it does **not** replace the larger gameplay truth zones in the production guide. A tile intersecting the corridor may be refined in full for format simplicity.

Subtract all individual-crown footprints and reviewed gaps from stand eligibility, including across tile seams. Keep semantic exclusions for played surfaces, water, buildings and infrastructure. When refining an existing field, preserve its conservative eligibility unless evidence explicitly justifies expansion; a finer grid alone does not recover canopy the old mask omitted. For incremental edits, retain unaffected records and stand cells instead of replanting the whole ground. Remove legacy scatter ownership inside authoritative v2 coverage.

For a proposed addition, subtract its footprint only after accepting the individual for the runtime generation. A held base does not authorize a clearing: rebuild from the prior field and retain its stand coverage unless a separate reviewed decision justifies removal. Keep reserved IDs in the offline catalogue so they cannot be reused accidentally. Verify all accepted additions in actual rendered instances before reporting their count.

Audit that inherited eligibility explicitly. Overlay measured residual canopy with current individual footprints, stand coverage and the exclusion reason, then inspect uncovered components and narrow woodland fingers. Distinguish crown overhang, real gaps, source noise, old coarse-mask omissions and incorrect surface geometry. Propose a local mask correction only where evidence supports it; do not globally relax exclusions or fill every LiDAR/IR patch. Inspect retained individuals suppressed at runtime through the same source/exclusion overlay.

Run a **full-facility representation audit**, including areas outside the latest review extension: on the native aligned height grid, identify supported canopy-height pixels outside both published individual footprints and eligible measured stand cells. Exclude suppressed individuals from representation. Preserve unknown-height pixels separately; a missing return is not evidence of open ground. Compare before/after using the identical scope, threshold and lattice. This diagnostic includes roofs and overhang, so it is not a missing-tree count, crown recall or surveyed accuracy.

Account spatially for every gap, including small components. Explicit source-reviewed structure geometry may explain its overlapping part; protected evaluation stays protected; remaining editable gaps stay unresolved, linked to their owner cells and previous issues. Grouping small gaps by cell is acceptable if their actual geometry and area are retained. Raster-centre counts and exact polygon-clipped areas can differ at boundary pixels; record both conventions. Never mark a gap resolved merely because its surrounding cell was inspected. Export individual footprints, measured woodland coverage and unresolved gap geometry as separate QGIS-compatible layers. A completed cell-review ledger can coexist with incomplete tree representation.

For a focused residual pass, predeclare the component priority/size threshold and the area it covers. Inspect RGB, CIR, seasonal context, height, current representation and the reason for exclusion together. Record structures, distinguishable missing crowns, connected woodland edges, overhang, subtraction fringes, retained suppressed records and protected edges separately. A narrow ring around an existing footprint is not automatically another tree. Preserve smaller components and unaccepted portions of mixed patches. Update older issues by exact subgeometry, with lineage; inspecting part of a cell does not close all its issues.

Do not treat a broad fairway or practice-area polygon as proof that no tree exists there. When a clearly visible, height-supported crown conflicts with it, record the actual runtime surface probes and review the ground boundary's source and reliability. Correct a boundary only where evidence supports the ground beneath the crown; otherwise retain the conflict. Do not shift the tree to an eligible pixel, globally relax exclusions or equate an overhead canopy with a surveyed trunk. This check can be more useful than running another detector over the same cells.

Separate **boundary errors**, **exclusion-policy conflicts**, and **uncertain bases**. A real tree can stand in correctly mapped mown grass; canopy alone does not justify carving a tree-shaped hole in that surface. A diagnostic point outside a fairway may still be rejected by its runtime margin. Record the source polygon identifier, inside/outside distance, actual atlas/analytic probe, and provenance separately. A residual-gap centroid is not an approved tree position, and a classifier's hole identifier may not establish ownership. If resolution requires changing the treatment of source-reviewed individuals on grass, scope and validate that runtime change explicitly, preserving hard-surface exclusions, source trust, duplicate prevention and the distinct rules for procedural woodland. Do not disguise a runtime-policy change as a ground-boundary correction.

For crown-size corrections, preserve the ID, base, height, heading and unaffected fields. Associate only the unambiguous height-supported crown portion; keep neighbouring crowns separate. Record the irregular source footprint and the approximate equivalent radius used by the current asset. Subtract the accepted extension from stand eligibility, then verify the changed width in actual rendered transforms and matched low-angle views. Report additional represented canopy separately from area explained as buildings, and report neither as improved detection precision without a new independent evaluation.

Trace suppression through every stage: source record → vegetation plan → drawn instance. Check analytic playing geometry, the actual sampled ground atlas, later green/tee aprons and post-planning facility filters. An analytic point can look eligible while the atlas excludes it; a planned tree can disappear at the facility filter. Record actual probes and label inferred filter attribution as inference unless the renderer reports the rejection directly. Crown evidence above a bunker or roof does not establish a safe stem base; do not move it into nearby open space merely to make it render.

Preserve the existing runtime object and stand chunk formats. Store detailed decisions and irregular crown geometry offline; compile only compatible placement/dimension fields to the app. Sample every base from the published terrain, preserve stable headings/variation seeds, and verify asset pivot, height and crown-radius scaling in actual rendered instances. Never jitter a measured position for visual variety.

Use the current species/type asset families first. Match height, crown width, spacing and group structure before commissioning new meshes. Where species is uncertain, label the asset choice as a visual/type default. Use identifiable dated photographs or stronger inventory evidence for signature-tree appearance; RGBI alone is not a botanical inventory. Changing assets is a separate visual comparison with its own LOD, shadow, wind and low-quality checks.

## 7. Compile an isolated comparison and verify the result

Compile into a new staging public root with the frozen terrain/surface/routing dependencies, root/catalogue and matching source evidence. Existing commands that default to `apps/golf/public` are publication commands, not preview commands. Do not run them against production during a local pilot. Shared-ground changes must re-emit every affected routing against the same ground generation.

Regenerate **startup packages for the new graph**; stale startup catalogues can cause hundreds of fallback requests despite valid chunk geometry. Use identical app build, assets and render settings for the comparison. Record the exact roots and source hashes; retain rollback bytes.

| Check | Evidence required |
|---|---|
| Data integrity | Band and nodata handling, coordinate/pixel conventions, density, campaign seams, stable IDs, deterministic rebuild, correct tile ownership and retained unaffected records. |
| Review coverage | Frozen scope/denominators; per-source valid area; reviewed, ambiguous, no-data and unreviewed cell areas; all-hole status and explicit incomplete regions. |
| Placement | Every accepted addition visible in actual exported instances; correctly grounded bases; no stand bases in individual footprints; no unintended bases in reviewed clearings or excluded surfaces; no legacy duplicate ownership. |
| Visuals | Matched overhead/tee views for every hole, plus close and grazing-angle views of important changes. Inspect real WebGPU and WebGL backends, low-quality mode, silhouettes and crown overhang separately from bases. |
| Performance | Same device/browser, viewport, scene, quality and assets; at least three interleaved runs per comparison/backend. Record startup, median/p95 frames, vegetation planning, requests, bytes and relevant memory/draw budgets. Run captures/profile serially and avoid competing workloads. Investigate changes above 10%; retain the original observation and any follow-up. |
| Integration | All shared routings, course/hole switching, object/stand streaming, startup generation, caching, offline reopening and rollback as required by the production guide. A local screenshot pass is not a production release pass. |

Use tolerances that account for diagnostic rounding and intentional asset-base offsets. For example, Visby's diagnostic included 0.25 m trunk burial; verify the current renderer before applying that correction elsewhere. Grounding consistency is not surveyed terrain accuracy.

**Completion status must be specific:**

| Status | Meaning |
|---|---|
| Source-reviewed local improvement | Bounded accepted edits have source and runtime checks; remaining gaps and detector failures are reported. |
| Local pilot closed with exceptions | The bounded delivery and its checks are complete. Exceptions remain open in the evidence ledger; no further automatic pass is scheduled. This is not a full-tree census or a release approval. |
| Detector target met on held-out sample | The frozen method passes the declared sample targets; this still does not establish every stem or every tree across the course. |
| Ready for release | The applicable source, review, runtime, performance and publication gates pass for the stated scope. Deployment follows the task's existing authorization and release process. |
| Surveyed stem accuracy | Only when independent stem measurements and measured residuals support that claim. |

We can be happy with a reviewed local improvement while keeping automatic rollout and survey-level claims open. If existing data repeatedly cannot resolve a play-critical tree, name the missing evidence. Further parameter tuning may not help; targeted club confirmation, newer imagery, denser LiDAR or a controlled survey are possible next steps, not assumed purchases or silently invented data.

### Stop a bounded pilot

Declare the final pass's selection and stop condition before extending work: for example, one review of a fixed set of important residuals. Close the local delivery when all selected cases have a disposition, accepted edits pass the applicable source/runtime checks, coverage and remaining gaps are accounted for, required regressions have been investigated, and the preview plus reproduction evidence is delivered. Retain failed accuracy/release gates explicitly; a delivered pilot may close even when these targets are missed. Do not label blocked cells as passed or imply that every tree was mapped.

Provide a short prioritized exception list linked to the complete issue ledger. For each exception, specify what would change the decision: source evidence, crown identity, a ground-boundary correction, or a separately scoped runtime fix. Keep uncertainty about real stems separate from known renderer suppression. Reopen only for a confirmed planting/removal, changed source campaign or ground geometry, a demonstrated defect, or a newly scoped integration/release task. Repeatedly processing the same unresolved evidence is not an automatic maintenance requirement.

If the final pass changes only review data and documentation, retain the existing runtime measurements after verifying the graph, application build, assets, records, stand fields and evidence hashes. State that those measurements are inherited. Do not claim fresh performance improvements or repeat expensive captures without a runtime change or an unresolved validation concern.

## 8. Keep a reusable evidence package and maintain it

Suggested per-ground layout (a documentation convention, not a new runtime schema):

```text
geo_data/course-v2/<ground-id>/vegetation/reviews/<review-id>/
  plan.md                    # completed review template and status
  source-inventory.json      # items, dates, hashes, coverage and tool versions
  baseline-lock.json         # root/ground/records/assets/camera identities
  coverage.geojson           # scope, source footprints and review-cell status
  coverage.json              # denominators, per-hole status and incomplete areas
  reference.geojson          # crown, clearing, edge and scoring-area annotations
  reference-lock.json         # freeze identity and calibration/evaluation split
  detector-lock.json          # code/tool versions, selected settings and inputs
  benchmark.json              # baseline/candidates, counts, metrics and limitations
  corrections.json           # offline decisions and uncertainty
  corrections.geojson        # source-relative review geometry
  issue-index.json           # reconciled unresolved cases across review passes
  validation.json            # data, runtime, screenshot and regression checks
  performance.json           # original measurements plus investigations
  README.md                  # findings, exact commands, preview and next work
```

Raw point clouds, rasters, source images, tool caches, generated graphs and screenshots belong in a verified ignored/external working directory. Link their checksums and reproduction instructions from the compact evidence. Existing Visby artifacts retain their original locations; do not move or overwrite them to fit this convention.

Maintain a coverage/status row for **each hole of each routing**: last source dates, reviewed region/area, individual/stand treatment, important unresolved trees, last visual check and accepted generation. Accepted-tree count alone does not measure completeness. Reopen affected areas when playing surfaces change, new planting/removal is confirmed, a new campaign arrives, an alignment issue appears or an asset change alters crown/base appearance. Preserve old decisions; review a difference, then evaluate on fresh samples if tuning has used the previous holdout.

The coverage and issue files above are an offline evidence convention, not implemented generic runtime schemas. Visby's [audit script](../tools/visby-tree-pilot/coverage_audit.py) reconstructs existing window coverage and detector diagnostics; it does not retrospectively mark cells reviewed or resolve issue identities. A new review must author those records from its actual inspection.

## Current tools: reuse boundaries

| Tool | Reusable capability | Adaptation or caution |
|---|---|---|
| [COPC canopy builder](../packages/course-geo/copc-reader/build-canopy.mjs) | `--ground`, `--out`, campaign/tile selection, density/height evidence; optional `--tight-grid` | Registered ground, pinned campaigns and active ground graph required. Resolves the current public graph. Use explicit evidence/output locations and sufficient halo; verify the lattice for the chosen ground. |
| [Node vegetation compiler](../packages/course-v2/vegetation/compile-vegetation.mjs) | Ground geometry, candidates, previous registry/IDs, approvals and standard stand output | Current CLI reads the active public ground; stock stand generation is 4 m. It does not consume the pilot correction catalogue or automatically provide near-play 1 m refinement. Do not equate machine approval with visual or survey verification. Use repository-relative `--raster` paths on Windows because of the colon parser. |
| [Object compiler](../packages/course-v2/vegetation/object-compiler.mjs), [ground sampler](../packages/course-v2/vegetation/ground-sampler.mjs), [stand format](../packages/course-v2/stand-field.mjs) | Reusable library primitives for compatible records, terrain bases and variable-resolution fields | A reviewed ground adapter must supply validated decisions, coverage and cell geometry. |
| [Vegetation publisher](../packages/course-v2/vegetation/publish-vegetation.mjs) | `assembleVegetationGraph` library; CLI supports a staged `--public` tree and all shared routings | CLI default is the real public tree; staging must already contain the referenced graph/resources. Protect unrelated object classes when assembling object layers. |
| [Startup pack builder](../tools/build-startup-packs.mjs) | `publishStartupPacks(stagedPublicRoot)` | Run against the staged catalogue and matching graph, not an inherited startup manifest. |
| [RGBI acquisition](../visbybuild/mapping/lm_ortho.py) and [reader](../visbybuild/mapping/lm_ortho_read.py) | Verified acquisition and optional four-band reading, with existing RGB behaviour retained | Visby adapters: review plan validation, cache, frame conversion, band metadata and output paths before another ground uses them. |
| GDAL/Rasterio, QGIS, lidR/terra/sf | Offline rasters/transforms, manual GIS/source review, detection benchmarking and crown geometry | Pin versions per experiment. QGIS is a review option; a checked source-overlay viewer can serve agent-led review. Existing acquisition remains preferred over an unvalidated replacement. |
| [Visby pilot scripts](../tools/visby-tree-pilot/README.md) | Worked references for annotation, benchmark, correction catalogue, 1 m refinement, isolated graph, browser comparison and performance | Ground IDs, origin, scenes, capture list, source dates and paths are embedded. Parameterize/implement a new adapter and test it on the next ground; changing a directory name is insufficient. |
| [Vegetation browser baseline](../tools/vegetation-baseline.mjs) | Population, source ownership and visual diagnostics | Supply fresh report/shot paths and the appropriate v2 label. Current provenance lookup has slug/ground assumptions; independently resolve the active root, especially for a shared routing. |

A reusable description and reusable primitives are in place. A fully parameterized acquisition-to-review-to-publication command has **not** yet been implemented. The next ground should use a small explicit adapter around these primitives, exercising the same evidence gates. Do not copy the Visby compiler unchanged: its tree-only object assembly is not a general merge policy for grounds that already contain other object classes.

Before calling an adapter reusable, exercise it on a second ground with different bounds/hole count. Make ground/frame, source dates and bands, coverage, review/evaluation regions, thresholds, cache/staging paths and routing list explicit inputs. Fail on missing metadata or frame mismatch instead of falling back to Visby constants. Verify identity preservation, seams, exclusions and non-tree objects on that second ground; document any remaining manual steps.

## Reusable task brief

> Improve tree placement for ground `<ground-id>` and all its course slugs `<slugs>`. Read `docs/tree-placement-workflow.md`, `docs/v2-course-runbook.md`, `docs/v2-course-mapping-workflow.md` and the ground's latest handoff. Complete `docs/templates/tree-placement-review.md` in a new review directory. Preserve the accepted generation, terrain, user changes, assets and stable IDs. Freeze review scopes and a cell-based coverage ledger; separate source availability, sample windows and completed inspection. Inventory verified LiDAR, RGB/IR and seasonal sources; check dates, coverage, density, alignment and datum. Freeze at least 100 interpretable reference crowns with at least 30 spatially separate evaluation crowns. Benchmark and freeze settings on calibration areas only; report full detection counts, paired geometry metrics and bidirectional edge/gap checks. Review play-relevant individuals and gaps, audit inherited exclusions, retain measured woodland interiors, refine near-play stands to 1 m where justified, and prevent duplicate ownership. Use existing object/stand formats through a ground-specific adapter; do not assume Visby scripts are generic. Deliver an isolated comparison, source map, all-hole matched views, WebGPU/WebGL/low-quality checks, performance measurements and an honest findings report. Reconcile unresolved cases across passes, report incomplete areas and retain the baseline/default if targets are missed. Implement only the authorized release scope; do not infer deployment from this local review request.

For a new ground, precede that brief with the production guide's [bootstrap workflow](v2-course-runbook.md#starting-without-an-existing-course-model). For an existing ground, begin from its exact accepted root and apply only the reviewed difference.
