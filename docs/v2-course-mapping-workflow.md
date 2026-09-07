# Mapping a v2 golf ground: sources, decisions and reproducible updates

Verified against repository tools on 2026-09-07, including mapping checkpoint
`7dbe4e3`. This practical companion covers geographic investigation and adoption.
The [v2 course runbook](v2-course-runbook.md) owns the architecture, ground/course
vocabulary, coordinate contract, compilation, runtime and release gates.

The goal is complete, accurate geography with a defensible source for every
claim. “Perfect” describes the ambition; it is not an accuracy certificate.
Passing tests, filling a map, or accepting one object's outline does not prove
absolute accuracy, a complete inventory, current condition or survey approval.
Record which gates remain open and keep improving the strongest available data.

For the current worked example, read the
[Upsala handoff](../upsalabuild/mapping/NEXT-SESSION.md),
[mapping scope](../upsalabuild/mapping/scope.json) and
[source inventory](../upsalabuild/mapping/source-inventory-2026-09-07.md).
They contain ground-specific decisions, not values to copy into another course.

## 1. Choose the kind of work before changing geography

| Work | Start with | Deliverable |
|---|---|---|
| New physical ground | Ground identity, source manifest, property/playing extent, current club material, independent controls | Approved frame, evidence inventory and reviewed layers; follow the runbook for initial terrain/graph publication |
| New routing on an existing ground | Existing ground/frame and all current course manifests | Another course referencing the same physical ground; new routing/card, no duplicate terrain or objects |
| Update an existing course | Current model, accepted evidence, generator, published hashes and previous validation | A reviewed difference with preserved stable identities and an exact before/after record |
| Improve visual design | Accepted dimensions, materials and geography, plus dated object photographs | Better rendering with evidence-backed dimensions; document any appearance defaults separately |

Inspect `git status --short --branch` and the latest commits first. Preserve user
changes. On the current Upsala branch, main is the user's source of truth for
conflicts: inspect/fetch it and preserve accepted nonconflicting mapping work.
Do not silently replace working geometry with a newly downloaded live feed.

Find the real authoring path before editing: source evidence -> adoption helper
-> generated model -> pack/migration -> routing/ground references -> app.
Do not hand-edit generated JSON, packed bytes or an embedded standalone model.
Determine whether the change affects one routing, shared physical geography,
terrain, published vegetation or only an evidence/review document.

With no existing model, use the runbook's
[bootstrap steps](v2-course-runbook.md#starting-without-an-existing-course-model):
source-backed authoring adapter, model/card/heightfields, registered GPK1 fallback,
canonical routing and a reviewed ground driver. Current v2 publication requires
that fallback. Freezing/migrating a previous course applies only when it exists;
do not invent legacy data to make an empty project resemble a completed build.

## 2. Inventory everything, and state what is actually known

Create a category ledger for the whole physical property and every routing.
For each category record source coverage, current objects, reviewed objects,
unresolved sites, dates, exclusions, next source and validation method.
Use stable source/feature IDs. A zero-result query means no records in that
dataset/window, not that the course has no objects of that category.

| Category | Geometry and information to establish | Common unsupported inference |
|---|---|---|
| Physical tees | Each platform footprint, terrace divisions, maintained edge, current presence | Card length, a flat patch or marker pair proves a platform boundary |
| Tee markers and signs | Dated marker positions, tee names/colours, sign identity and dimensions | Daily markers are permanent tee centres; colours alone identify a shared pad |
| Greens and collars | Putting-surface ring, holes/islands, collar/fringe boundaries, contours and survey epoch | The brighter green complex or a drawn flag identifies the exact green |
| Fairways and approaches | Maintained boundaries, separate components, crossings and transition areas | Every par3 has a fairway; a coarse route corridor is a measured surface |
| Rough and semi-rough | Dated maintenance zones and transition widths | All unclassified land is one measured rough class |
| High grass, meadows and fields | Seasonal extent, mowing/land use, habitat or crop evidence | Image colour determines grass height, species or permanent use |
| Bunkers and exposed sand | Sand footprint, islands, lips, depth and drainage where measured | Sand extent establishes lip height, rake locations or bunker depth |
| Ponds, lakes and wetlands | Shore rings, islands, current water extent, levels and dates | A flat DTM plate proves water identity or lake-bed depth |
| Streams, ditches and trenches | Channel/edge lines, flow direction, profile, culverts and permanence | Every linear depression is flowing water or a permanent drain |
| Drainage and irrigation | Inlets, outlets, pipes, sprinkler heads, wells, access covers and dimensions | Underground services can be reconstructed from surface colour |
| Buildings and cottages | Footprints, current use, height, roof, entrances, extensions and source epoch | A nearby map rectangle or an architectural render locates a new building |
| Driving range | Range extent, safety nets/poles, target greens, landing targets and bay arrangement | A practice plan proves all proposed equipment was installed |
| Range equipment and pads | Mats, concrete/gravel pads, shelters, dividers, dispensers, washers and signs | A visible rectangle proves material, equipment identity or exact height |
| Practice areas | Putting/chipping greens, practice bunkers, short-game tees, paths and shared ownership | Proposed merged greens are already one completed surface |
| Roads, paths and trails | Centre/edge semantics, width, material, junctions, crossings and grade | An open road-edge line is a centreline or a closed paved polygon |
| Parking and access | Outer rings, islands, bays, access lanes, curbs and material | Parallel lines automatically determine parking topology |
| Bridges and crossings | Deck footprint/axis, abutments, rails, clearance and approaches | A horizontal survey footprint establishes vertical dimensions |
| Fences, hedges and walls | Correct type, line, gates, height, thickness and retaining function | One generic boundary code permits a complete 3D fence or hedge |
| Poles, lights and utilities | Position, identity, height, overhead lines, electrical cabinets | A survey method label overrides a contradictory coarse accuracy field |
| Furniture and maintenance | Benches, bins, ball cleaners, toilets, storage and service equipment | A stock golf-course prop should be placed at every hole |
| Individual trees | Position semantics, crown/stem identity, height, canopy size, status and epoch | A crown centre is a surveyed stem; proximity proves identity |
| Forest, woodland and shrubs | Stand boundary, canopy cover/height, gaps, density and acquisition seams | Representative stand rendering is a census of individual trees |
| Species and vegetation type | Botanical record or explicit identification evidence | Broadleaf/conifer, 10 m leaf-type context or old charcoal proves species |
| Obstacles and natural features | Boulders, bedrock, retaining banks, ridges, monuments and local dimensions | Regional geology locates individual rocks |
| Terrain and microterrain | DTM coverage, RH2000 controls, breaklines, approved patches and seams | A 1 m raster or 1 cm encoding is centimetre survey accuracy |
| Routing and playing rules | Hole order, par, stroke index, tee lengths, guide lines and current edition | A schematic club plan supplies spatial control or daily pin positions |

Keep three layers distinct:

- **Source observation:** what a provider or dated image actually records,
  including uncertainties and ambiguous identity. It can remain review-only.
- **Accepted geographic claim:** a deliberate geometry/identity decision with
  original-source assertions, provenance and a stated accuracy limit.
- **Runtime representation:** the mesh/material/instance used to display that
  claim. A default gravel appearance is not evidence that the material is gravel.

For example, Upsala's municipal tree points remain separate from its published
LiDAR crowns. Reviewed boundary and ditch lines can be inspected in GIS without
inventing fence heights or excavating terrain. Acceptance of a source observation
does not require automatic placement in the 3D app.

## 3. Capture evidence before interpretation

Use the runbook's source hierarchy and current provider terms. Prefer club
as-built GIS/CAD and qualified survey, then suitable authoritative terrain,
orthophoto and municipal mapping; corroborate with club documents and dated OSM.
National product URLs in repository documents are dated references: verify
availability, item identity, local coverage and actual terms for each new intake.

For greens, bunker lips, narrow ditches, terrace edges and other microterrain,
request georeferenced as-built geometry or a suitable RTK GNSS/total-station
survey. Controlled drone photogrammetry or LiDAR needs independent checkpoints,
documented processing, capture conditions and the required vertical datum.
Ordinary aerial photos and a dense point cloud are not automatically controlled
survey. Use real, source-identified photographs for evidence; generated imagery
can illustrate a design idea but cannot establish an existing feature.

Distinguish the elevation products: a DTM represents ground, whereas a DSM can
include canopy and roofs. “DEM” alone does not specify which surface was measured.
A canopy-height model estimates height above ground and is not terrain. Inspect
classification, voids, resolution and acquisition epoch before using any raster.
Keep an approved fine survey patch tied to its source and integration boundary;
do not sculpt a green by eye and label the result measured microterrain.

For every downloaded source retain:

1. Exact request/item URL, provider/product/layer ID, byte count and SHA-256.
2. Original bytes in an ignored cache or approved external evidence directory.
3. Retrieval date, actual capture/measurement epoch when known, and separately
   the service/product year, publication date and database edit/registration date.
4. Native CRS, returned CRS, coordinate order, units, height datum and transform.
5. Raster dimensions, actual returned extent, pixel spacing and source resolution;
   vector geometry type, layer domains and transfer-limit/completeness result.
6. Method, source-declared accuracy, review uncertainty, reviewer and decision.
7. Applicable rights, attribution and derivative/distribution decision. Public
   viewing access alone does not establish redistribution rights.

Keep raw orthophotos and imagery-containing review panels out of committed or
shipped assets unless their rights explicitly permit that use. Commit compact
provenance, reviewed vectors, source hashes and vector-only comparison sheets.
Sanitise public exports: operator names, usernames and unrelated source comments
do not belong in runtime provenance. Never serialize credentials or auth headers.

### Coordinate and accuracy checks

Canonical master geometry is `[easting,northing]` in EPSG:3006, metres; heights
are RH2000/EPSG:5613, together EPSG:5845. The runbook defines the immutable
ground-local frame. Legacy `[x,z]` models retain their declared flat-earth frame
until deliberately migrated; those coordinates are not EPSG:3006.

The municipal Upsala primary map is natively EPSG:3011, but requests with
`outSR=3006` return EPSG:3006 geometry. Inspect the response CRS and sample it
directly in that frame. Do not apply the native-to-returned transformation twice.
Inspect domain meanings for status, survey method, accuracy and source datum.
`REGDATE` is database registration, not an independently established survey date.

Distinguish metre-based projected review files from RFC 7946 GeoJSON. The pond
candidate exporter deliberately produces an EPSG:3006 file; the ground-map
exporter produces longitude/latitude in OGC:CRS84. File extension alone does not
establish coordinate semantics. Image extents address pixel edges; worldfiles
address pixel centres. Preserve the half-pixel relationship.

Compare independent controls with the exact published terrain: verify referenced
manifest/chunk hashes, tile ownership, finest resolution and finite interpolation.
Retain excluded points and large residuals. Group by location and relevant source
epoch; registration-year groups must keep that qualifier. Assess whether points
are suitable ground controls and whether surface change explains disagreements.
Do not fit a global offset or warp trusted terrain to make traces look aligned.

Upsala's September 7 comparison used 250 of 292 municipal points and reported
0.225 m RMSE. It neither meets the runbook's 0.15 m target nor certifies every
playing surface. See the
[full diagnostic](../upsalabuild/mapping/municipal-ground-height-check-2026-09-07.md).

## 4. Review broad context before tracing small details

Start with whole-ground and every-hole source/model comparisons. Include access,
facilities, neighbouring shared holes and surrounding canopy. Centre a search
window on the plausible site extent, not only the existing polygon: a missing
rear tee may lie beyond that polygon's crop. Inspect all apparent platforms and
record a partial census where a full site inventory remains uncertain.

Use the newest suitable image plus older campaigns that clarify canopy, winter
covers, shadows and construction. Verify the flight-year layer where supplied.
An archive service name is a product label until an actual flight date is known.
Older visibility must be checked against current presence; do not replace newer
geometry merely because an old image is easier to trace.

Photos are useful for object identity, materials, dimensions with a known scale,
roof/rail detail and condition. A ground photograph usually lacks planimetric
control. Indoor opening photos do not locate a building; marketing renderings
and proposed plans do not prove as-built completion. A labelled scale bar and
printed grid must agree before digitising a report map as controlled geometry.

For each candidate, compare raw imagery beside the current model and candidate
overlay at the same bounds/scale. Record original vertices, proposed vertices,
source windows/hashes, decision and uncertainty. Do not infer tee identity from
flatness, putting-surface boundaries from brightness alone, or species from
colour. Orthorectification does not eliminate absolute registration uncertainty.
OSM provenance alone does not establish that an outline is independently surveyed.

Retain a good accepted implementation when the evidence does not support a clear
improvement. Record why it was retained so the next session does not retrace it.
When uncertainty is hidden by canopy or absent survey dimensions, change sources
or keep the gap explicit rather than repeatedly refining the same ambiguous edge.

### Optional desktop GIS review

QGIS is an optional external review tool, not a bundled repository dependency or
an alternative source of geographic truth. A useful working procedure is:

1. Create a project in EPSG:3006. Load original vectors and georeferenced imagery,
   checking each layer's declared CRS/extent. Keep source layers unchanged and
   place candidate edits in a separate file/layer with stable feature IDs.
2. Inspect overlays by category and source date. Review paths at junctions,
   water around islands, and playing surfaces together with adjacent features.
   Save the project with relative paths and record which source hashes it uses.
3. For an unreferenced scanned plan, use distributed, identifiable control
   points with known coordinates, select a justified transformation and retain
   the control-point file/settings/residual report. Check additional independent
   points. A fitted low residual on the same anchors is not independent accuracy.
   The [official Georeferencer guide](https://docs.qgis.org/3.44/en/docs/user_manual/managing_data_source/georeferencer.html)
   documents control entry, transformations and saved reports. Do not stretch
   trusted imagery or terrain to fit a schematic plan.
4. Trace only supported edges into the candidate layer. Set snapping tolerance
   deliberately in ground units; use it for proven shared endpoints/boundaries.
   It must not pull nearby but unrelated objects together. Preserve islands,
   separate components and a record of uncertain joins.
5. Run geometry validity checks and inspect reported errors; the
   [official vector geometry tools](https://docs.qgis.org/3.44/en/docs/user_manual/processing_algs/qgis/vectorgeometry.html)
   describe validity outputs. Also inspect semantic topology: a valid polygon
   can still cover the wrong green, close the wrong road edges or erase an island.
6. Export reviewed candidates with explicit CRS and source/decision attributes.
   Compare exported vertices and area with the working layer, then pass them
   through the repository's guarded adoption helper. A GIS save is not adoption.

## 5. Verified mapping tools and Windows setup

Run from the repository root. The installed interpreter used for Upsala review
is available in this workspace as follows; on another machine, select an
installed equivalent rather than copying a nonexistent executable path.

```powershell
$coursePython = (Resolve-Path upsalabuild/cache/review-venv/Scripts/python.exe).Path
& $coursePython -c "import pyproj, PIL, numpy, matplotlib; print(pyproj.__version__)"
$env:COURSE_GEO_PYPROJ_PYTHON = $coursePython
```

The explicit pyproj setting selects horizontal PROJ transformations only. It
does not replace vertical `cct` or the pinned SWEN17_RH2000 grid. Use the runbook's
frozen native toolchain for vertical controls and workflows requiring GDAL/PDAL.
For vegetation `--raster <campaign>=<data.f32>:<sidecar.json>`, use repository-
relative file paths: the current colon parser cannot accept a Windows drive
letter in the raster path. Use process arguments rather than shell-built commands.

| Tool | Existing flags and output | Scope and important limitation |
|---|---|---|
| [Primary imagery/buildings](../geobuild/imagery/acquire-upsala.py) | `--provider lm-latest\|municipal-2024\|buildings --output-dir DIR`; optional `--bbox E0 N0 E1 N1`, `--resolution`, `--prefix`, `--workers 1..4`, `--metadata-only`, `--skip-metadata` | Upsala service adapter. Network reads; saves metadata, PNG/worldfiles and hashes. LM export includes flight-year imagery to inspect. Use a fresh ignored directory. |
| [Municipal survey acquisition](../geobuild/acquire-upsala-survey.mjs) | `--out DIR [--layers 6278,562,564,570,571]`; `--help` | Fixed Upsala bbox/service, 29 default layers. Directory must be empty and beneath `cache`. Saves exact metadata/query bytes and `downloads.json`; rejects truncation/errors. No geometry adoption. |
| [Expanded archive tees](../geobuild/acquire-tee-review-2026-09-07.py) | `--out DIR [--years 2015,2017,2018,2020,2023]` | Fixed four Upsala review windows; Pillow required. Writes cached imagery and panels. Service year is not exact capture date. |
| [Source/model panels](../geobuild/render-mapping-review.py) | `--build BUILD --source-dir DIR --kind tees\|greens\|fairways\|infrastructure --out DIR`; optional `--holes`, `--evidence`, `--panels` | Pillow/pyproj; verifies image hashes, writes cache PNGs/report. Supports candidate rings and open lines, never adopts. Infrastructure defaults are Upsala-specific: supply `--panels` elsewhere. |
| [Tee terrain measurements](../geobuild/tee-platform-survey.mjs) | `--build BUILD --ground GROUND_OR_SLUG --out FILE [--repo REPO] [--evidence FILE]` | Reusable published 1 m DTM diagnostic. Candidate rings use the build's local frame. Reports slope/planarity and coverage; does not establish tee identity or flatten terrain. |
| [Pond measurements](../geobuild/pond-survey.mjs) | `--repo REPO --build BUILD --ground SLUG --out PREFIX [--ids id1,id2]` | Reusable diagnostic; this `--ground` selects a published course **slug**. Writes JSON and EPSG:3006 candidate GeoJSON. Keeps islands/components; incomplete floods do not produce replacement geometry. |
| [Municipal height check](../geobuild/check-upsala-ground-heights.mjs) | `--source-dir DIR --out FILE [--public DIR]` | Upsala-only, reads retained `groundheights-meta.json`, `groundheights-query.json`, `municipal-downloads.json`. New survey acquirer writes `6292-*`/`downloads.json`: these layouts need an adapter before connecting the commands. |
| [Height diagnostic plot](../geobuild/render-upsala-ground-height-check.py) | `--report FILE --out STEM` | Upsala context/layout; NumPy/Matplotlib. Writes SVG/PNG from the sanitised report, no terrain changes. |
| [Geographic export](../geobuild/export-ground-map.mjs) | `--build BUILD [--also-build BUILD] --out FILE [--ground GROUND] [--root REPO] [--no-v2]` | Reusable RFC 7946 longitude/latitude export; no network. Deduplicates shared geometry and can include published objects. Exporting does not improve source accuracy. |
| [Ground overview](../geobuild/render-ground-map.py) | `--source FILE --out FILE.svg` | NumPy/Matplotlib; writes SVG/PNG. Current annotations/insets are Upsala-specific and need review for another ground. |
| [Tee comparison sheet](../geobuild/render-tee-review.py) | `--build BUILD --evidence FILE --out FILE.svg`; repeat `--evidence`/`--followup`, optional `--title` | Vector-only SVG/PNG with unchanged source vertices. Review course/date-specific explanatory labels when reusing. |
| [Upsala refresh](../tools/refresh-upsala-mapping.mjs) | `[--python EXECUTABLE]`, `--help` | Upsala-only local regeneration and reference/checksum updates. No acquisition, dependency install, commit, push or deployment. See section 7. |

These are workflow adapters and diagnostics, not a generic one-command course
generator. Before reusing an adapter, inspect its fixed ground IDs, AOI, schema,
source years and output paths. Generalise those deliberately with another real
ground fixture; renaming a script does not generalise its assumptions.

### Upsala worked recipes: acquisition and review

Choose a new cache directory for a new source snapshot. Do not overwrite an
accepted acquisition and then update its hash to hide the difference.

```powershell
$reviewCache = 'upsalabuild/cache/next-mapping-review'
& $coursePython geobuild/imagery/acquire-upsala.py --provider lm-latest --resolution .25 --output-dir "$reviewCache/lm-latest"
& $coursePython geobuild/imagery/acquire-upsala.py --provider municipal-2024 --resolution .25 --output-dir "$reviewCache/municipal-2024"
node geobuild/acquire-upsala-survey.mjs --out "$reviewCache/primary-map" --layers 6278,562,564,570,571
& $coursePython geobuild/render-mapping-review.py --build upsalabuild --source-dir "$reviewCache/lm-latest" --kind tees --holes 11,13,15 --out "$reviewCache/tees-before"
& $coursePython geobuild/render-mapping-review.py --build upsalabuild --source-dir "$reviewCache/municipal-2024" --kind tees --panels "$reviewCache/tees-before/report.json" --out "$reviewCache/tees-2024"
node geobuild/tee-platform-survey.mjs --build upsalabuild --ground upsala --out "$reviewCache/tee-terrain.json"
node geobuild/pond-survey.mjs --repo . --build upsalabuild --ground upsala --out "$reviewCache/ponds"
```

Acquisition can take time and requires network access. The last four commands
review existing inputs/published terrain and write evidence only. After a
candidate exists, supply `--evidence <candidate.json>` and the same `--panels`
to review it; the evidence must declare the matching model frame.

The retained height-comparison cache can be replayed without a download:

```powershell
node geobuild/check-upsala-ground-heights.mjs --source-dir upsalabuild/cache/review-2026-09-07/source-inventory --out "$reviewCache/height-comparison.json"
& $coursePython geobuild/render-upsala-ground-height-check.py --report "$reviewCache/height-comparison.json" --out "$reviewCache/height-comparison"
```

If that old cache is absent, the committed sanitised report remains evidence.
Reacquire and adapt the input layout explicitly before claiming reproduction;
do not manufacture a matching acquisition manifest or reuse unrelated hashes.

## 6. Adopt reviewed claims transactionally

Keep source records and reviewed decisions separate from generated runtime data.
Each adoption should identify its original model/frame, exact old feature,
accepted change, supporting source hash and interpretation uncertainty.
Decisions are `retain`, `replace`, `add`, `retire`, or `unresolved`; rejection and
retention notes prevent future sessions from repeating inconclusive work.

Validate the complete change before mutating the model: frame equality, finite
coordinates, supported geometry/type, exact-original assertions, stable IDs,
duplicate absence, ring topology, area sanity and any shared ownership rules.
A changed upstream feature must fail and request re-review, rather than silently
overwriting a newer main/source change. Apply through the generating pipeline.

Whitelist runtime fields explicitly: intended local geometry plus deliberate
scalar provenance. Keep EPSG:3006 arrays, pixel traces, original assertions,
nearest-object research and raw source attributes in evidence files. The legacy
migration collector traverses numeric pairs; leaking evidence coordinates into
the runtime model can transform them as if they were local geometry.

Preserve polygon holes and independent components using the correct contract:
`mappedFeatures.rings` is `[outer, ...holes]`; `fairway.rings` is a list of
independent polygons. Check overlap priorities and network junctions. A surveyed
open road edge requires a justified partner/closure to form a physical surface.
Record interpreted joins separately and remove the whole superseded strip when
replacing it with an accepted polygon, so two surfaces do not remain painted.

Reference implementations from the September 7 pass are
[practice-path adoption](../tools/apply-upsala-practice-path.mjs),
[municipal-object adoption](../tools/apply-upsala-municipal-objects.mjs),
[par3/Sahara adoption](../tools/apply-reviewed-stora-par3-sahara.mjs), and the
[shared Mellan tee helper](../tools/apply-mellan-tee-review-2026-09-07.mjs).
They encode specific accepted Upsala decisions; call them through their existing
pipeline, and use their guard patterns when building another ground's adapter.

Unknown vertical dimensions remain unknown even when horizontal geometry is
strong. Ditches/fences may stay observation-only; tree points may remain unmatched.
A display default must be labelled as such. Do not promote imagery-reviewed GPK
surfaces into authoritative v2 surface tiles merely by updating a migration or
passing an atlas compatibility check; use the runbook's surface intake gates.

## 7. Regenerate the affected deliverables and validate the difference

Route/card edits change course-owned records; shared ground edits must reach all
child courses. Check both the played geometry and its shared scenery occurrence.
Daily marker references and routing should not move as a side effect of replacing
a physical tee outline. Test the actual generated models, not only helper output.

For accepted Upsala mapping edits, use the existing local rebuild:

```powershell
node tools/refresh-upsala-mapping.mjs --python $coursePython
```

It verifies the pinned original Git frame lineage, reconciles Stora, builds
Mellanbanan, generates the standalone model, both packs, migration, routing/
fallback references, exact artifact/checksum registrations and geographic review
outputs. It preserves the ground graph. It aborts at a failed step; earlier
successful outputs remain local for inspection. It is not a terrain, vegetation
or authoritative surface publisher and performs no remote release.

For another course, identify and document its real generating commands; there
is no generic `refresh-course-mapping` command. A terrain/vegetation change needs
the corresponding runbook pipeline and all shared course references published
together. Preserve a rollback generation and inspect immutable graph differences.

Run the applicable runbook fast/schema, data, pack, app and browser gates. Add
meaningful checks for changed original assertions, duplicate identity, topology,
source-frame leakage and shared-course ownership. Review source/model pairs with
the same recorded panels after regeneration. Inspect every changed site in the
actual app after loading has settled, on required v2 and compatibility paths.
Do not treat the presence of a canvas or a tiny nonblack pixel count as success.

### Upsala interactive source inspection

```powershell
node tools/serve.mjs . 8631
```

Open `http://127.0.0.1:8631/upsalabuild/mapping/source-review.html`.
This [Upsala-specific viewer](../upsalabuild/mapping/source-review.md) loads the
current ground GeoJSON and separate municipal observations. Search IDs, inspect
source/accuracy/unknown fields, and toggle categories. It has no external map
tiles and makes no new survey claims. Serve it over HTTP so adjacent GeoJSON can
load; it is not a generic viewer for arbitrary course directories.

## 8. Save a reviewable checkpoint and a useful next session

Use the following structure in a dated review/handoff document. Link evidence
instead of embedding raw licensed imagery or copying a previous success count.

```text
Checkpoint: <date, branch, commit/reference, ground and all affected slugs>
Inspect: current source/model/graph hashes; main comparison; accepted baseline.
Review: category/site scope; source IDs/requests/hashes; CRS/epoch/rights;
        before/candidate/after panel bounds; who reviewed; uncertainty.
Adopt: retained/added/replaced/retired features; exact-original assertions;
       runtime fields; observation-only records; duplicates/ownership decisions.
Validate: commands actually run; results/artifact paths; settled app views;
          before/after counts and geometry differences; untested limitations.
Handoff: unresolved facts; why current evidence is insufficient; next primary
         source or smallest useful action; exact rebuild/review commands.
Save: tracked changes/commit; local-only or remote status; rollback references.
```

Update category coverage independently from accepted-object counts. State which
surfaces were merely retained, which source dates are unknown, and which tests
do not establish real-world resemblance. Review `git diff --check` and the final
diff; save completed work according to the session's authorization. Local graph
publication, Git commit, remote push and deployment are different operations.

Ready-to-reuse next-session brief:

> Read docs/v2-course-runbook.md, docs/v2-course-mapping-workflow.md and this
> ground's latest handoff, scope, source inventory and validation report. Inspect
> the working tree, main and published references. Preserve user changes and
> accepted geometry; on the Upsala mapping branch, main is truth for conflicts.
> Continue the highest-value unresolved category with stronger dated evidence.
> Separate source observations, adopted geography and display defaults. Keep
> source bytes/hashes, CRS, dates and uncertainty; do not invent hidden outlines,
> species or dimensions. Make guarded changes through the authoring pipeline,
> rebuild every affected shared course, validate source comparisons and settled
> app views, and update the handoff with exact results and remaining gaps. Save
> completed work within the authorized scope and state local/remote status.
