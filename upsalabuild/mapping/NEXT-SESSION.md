# Continue Upsala mapping in Codex / VS Code

Saved 2026-09-07. Repository: `C:\Users\olov_\repos\olovs-hemsida`.
Branch: `codex/upsala-ground-mapping`.

## Start here

Open this repository in VS Code, select this branch, and give Codex this prompt:

> Read upsalabuild/mapping/NEXT-SESSION.md, upsalabuild/mapping/README.md,
> upsalabuild/mapping/scope.json and the latest validation report. Inspect the
> working tree and fetch origin/main. Continue the highest-priority unresolved
> mapping work using recorded evidence. Main is the
> source of truth for conflicts. Preserve existing user changes, route/card
> references and terrain. Do not invent hidden geometry or claim a complete
> survey. Rebuild both courses, validate, update this handoff and commit completed
> improvements. Ask only when a missing fact actually prevents progress.

First run `git status --short --branch`, `git fetch origin main`,
`git rev-list --left-right --count origin/main...HEAD`, and
`git log -6 --oneline`. At this checkpoint the branch contains `origin/main`
`002c91c`. Merge `727b82f` kept main's complete terrain implementation and tests
when resolving conflicts. Commit `5187128` fixes Windows rebuild/review tooling.
Mapping checkpoint `f440974` contains the September 6 surface/tee work;
`975099b` is the previous handoff. Consult the log for the September 7 checkpoint
instead of treating those older commits as the final state. The terrain
implementation and tests remain byte-identical to main `002c91c`. No push or
deployment was performed during this continuation.

## Current state

- Stora has **54 physical tee records: 52 imagery-reviewed outlines** (49 new
  plus 3 earlier) and 2 provisional originals. September 7 adds the long rear
  H11 platform. Mellan has **24 own platforms**, including the newly reviewed
  northern H8 platform. Both generated models contain this H8 ring exactly once.
- H13 and upper H15 remain provisional after wider 2015/2017/2018/2020/2023
  archive review. Stora H8/9/11/12/13/14/15/18 and Mellan H8 retain partial census
  status. Accepted individual boundaries do not prove every platform was found.
- All 14 Stora par4/5 fairways have image-reviewed boundaries: 12 from September 6,
  plus earlier H13/15. H4 has two polygons separated by the visible water crossing.
- All 18 Stora green sites were visually reviewed. H16 was corrected to remove
  overlap with a bunker; H17 was already corrected. The other OSM outlines were
  retained. Smaller differences have not been accepted as corrections.
- The unsupported coarse par3 fairway polygons at H2/H6/H14 were retired;
  H10 was already empty. This does not determine an exact rough type or grass
  height. H8's Sahara bunker gained a reviewed **85.98 m²** footprint.
- A **116.240 m²** practice-area path polygon replaces the complete old 61 m
  service track `w438967934`. Surveyed edges, digitised northern edges and three
  interpreted joins have different uncertainties; the joins/caps are qualified
  at 2 m. Unknown physical material is retained as `unverified-hard-surface`;
  the gravel appearance is a display default. Polygon boundaries and holes are
  preserved in both rendering paths, with path precedence over forest cover.
- Four new ditch lines and 19 typed boundary lines are retained for GIS/source
  review only. They do not excavate terrain or invent flowing water, fence height
  or wall thickness. The southern surveyed bridge brings the rendered deck count
  to **4**; its approaches and vertical dimensions still need review.
- Both models/packs, standalone page, GIS export, migration and checksum
  registries have been refreshed. The GIS export contains **5,851 records**.
  Routes, daily marker references, scorecards, terrain and vegetation were
  preserved. The final rebuild and full `npm test` passed; see the current
  validation report for exact checks, browser results and limitations.
- The separate municipal source layer has **231 observations**: 83 reviewed
  object records plus 148 open road-edge lines. Of those road edges, 120 have
  usable method/accuracy metadata and 28 report unknown/50 m accuracy. They are
  evidence, not 148 automatically accepted new roads.
- **444 building footprints and 4,181 published crown candidates remain**.
  Fifty municipal tree points (32 broadleaf, 18 conifer) have no proven botanical
  species or one-to-one crown identity. They remain separate observations;
  `completeSurvey` is deliberately false.
- An independent comparison of the published 1 m DTM against municipal heights
  used **250 points**, with **42 outside complete 1 m coverage**. Median residual
  is **+0.0627 m**, RMSE **0.2252 m**; all outliers remain. Terrain was unchanged.
  These clustered observations do not certify every playing surface.

The open [tee sheet](stora-tee-review.svg) shows the current 54 Stora records.
[Overview](overview.svg) shows the shared ground. Review the new
[par3/Sahara comparison](stora-par3-sahara-review.svg),
[height residual plot](municipal-ground-height-check.svg) and
[validation](validation-2026-09-07.md). The earlier
[continuation comparison](stora-followup-review.svg) and September 6 validation
describe historical checkpoints, not today's full counts.

## Highest-value next work

1. **Use surveyed road edges to review parking and path topology.** Start with
   the 120 eligible municipal edge lines in the interactive source map. Establish
   which edges bound the same physical surface, then review junctions, islands,
   closures and widths against dated imagery. Open lines alone do not define
   closed parking polygons. Keep the 28 unknown/50 m records out of precise
   placement. Follow the accepted practice-path helper's source assertions and
   per-segment uncertainty; do not buffer every line or move adjoining paths by
   proximity alone.
2. **Resolve the southern bridge approaches.** Municipal area 64915 and line
   111560 describe the same bridge. The horizontal deck is adopted; investigate
   how paths meet it and whether an OSM approach needs correction. Deck height,
   rails, abutments and clearances need dimensional evidence. Do not mechanically
   snap the surrounding network to the deck or invent a channel from a line.
3. **Match tree observations to actual crowns before adding trees.** Compare the
   50 surveyed points, 228 existing OSM tree points and 4,181 crown candidates.
   Record confidence in individual identity and acquisition differences; avoid
   duplicate tree populations. Broadleaf/conifer codes are not botanical species
   and point semantics do not separately establish trunk-base position. Municipal
   botanical and furniture queries returned no records, which is a coverage gap.
4. **Obtain stronger evidence for hidden tees and census gaps.** H13 and upper
   H15 remain obscured after five archive years; re-tracing the same shadows will
   not resolve them. Seek survey geometry, controlled aerial data or ground
   observations. Mowing continuity near H15 does not establish terrace division.
   Mellan H8's `middle-path` gap is resolved, while `east-road` and `north-corridor`
   remain open. The maintained oval near H6 remains unclassified; flat ground
   alone does not establish a tee. Keep original route/card/marker references.
5. **Locate the 2026 Halfway House and obtain dimensions for detailed objects.**
   Official updates confirm demolition/replacement and opening, and a plan gives
   7.2 × 6.4 m, but no defensible geographic footprint was found. Municipal
   rectangles 1512570 and 1520169 must not be relabelled as the new house. Seek an
   as-built/site plan with coordinates. Equipment, practice pads, irrigation,
   fences, building/bridge heights and drainage profiles likewise need measured
   dimensions and identifiable locations before detailed placement.
6. **Continue the remaining categories with dated evidence.** Rough, high grass,
   fields, cottage uses and maintenance equipment remain in `scope.json`. Generic
   land-edge records do not identify turf type; historic excavation trenches are
   not permanent course drainage. Published plans for practice-green changes do
   not establish completion: keep the reviewed 2025 outlines until newer evidence
   resolves the change. Investigate the height report's 12 >0.5 m outliers in
   context before proposing terrain changes; do not fit a global offset.

## Evidence and tools

September 7 evidence and implementation entry points:

- [Tee site decisions](tee-sites-review-2026-09-07.md) and its JSON record explain
  accepted and rejected sites. `stora-tees-review-2026-09-07.json` adds H11
  (340.526 m², 3 m boundary interpretation uncertainty);
  `mellan-tees-review-2026-09-07.json` adds the northern H8 platform
  (63.97 m², 2.5 m uncertainty). Their matching `*-tee-terrain-review-*` files
  record evidence-only slope/planarity checks. Historical service years are
  archive product labels, not exact capture dates. The Mellan helper
  `tools/apply-mellan-tee-review-2026-09-07.mjs` is used in both pipelines;
  `tests/upsala-mellan-tee-pipeline-2026-09-07.test.mjs` checks the actual generated
  rings and preserved archive-year qualifier.
- [Par3/Sahara review](par3-sahara-review-2026-09-07.md) and
  `stora-par3-sahara-review-2026-09-07.json` preserve original fairway assertions,
  the bunker trace, georeference and source hashes. Apply through
  `tools/apply-reviewed-stora-par3-sahara.mjs`.
- [Practice path review](practice-path-review-2026-09-07.md) and its JSON record
  preserve all six contributing source objects, segment order, source accuracy,
  interpreted joins and the retired track's complete original record. Apply
  through `tools/apply-upsala-practice-path.mjs`. The 0.025 m network-RTK attribute
  on core source edges does not apply to the complete interpreted polygon.
- [Source inventory](source-inventory-2026-09-07.md) and its JSON include primary
  links, data coverage, service/layer meanings and request hashes.
  `municipal-objects-2026-09-07.json` holds the reviewed object decisions;
  its GeoJSON adds the open road-edge observations. Apply only the explicitly
  accepted subset through `tools/apply-upsala-municipal-objects.mjs`. Existing
  drainage also gained source corroboration without retracing its networks.
- [Municipal height comparison](municipal-ground-height-check-2026-09-07.md)
  links a sanitised JSON with all included/excluded points, datum/method codes,
  published terrain hashes and outliers. `geobuild/check-upsala-ground-heights.mjs`
  verifies the exact published manifest/chunk chain and all four 1 m sample
  corners; it neither fits an offset nor writes terrain. Rerun after a course
  reference rebuild to update identities; unchanged terrain reproduces metrics.

Retain the earlier accepted evidence:

- `stora-surfaces-2025.json`: 12 fairways and H16 green; original shapes, manual
  pixel traces, exact projected panel extents and source hashes. Boundary
  interpretation uncertainty is 3 m for fairways, 4 m for H5 and 1 m for the green.
- `stora-tees-followup-2026-09-06.json`: four archive-assisted outlines, complete
  prior pad arrays and explicit retain/retire decisions. Uncertainty is 2–2.5 m.
  Years 2020/2023 identify municipal archive services; exact flight dates are
  unknown. All four were visually crosschecked against the 2025 product.
- `stora-tees-followup-terrain-2026-09-06.json`: evidence-only 1 m terrain
  measurements, separating drainage slope from residual planarity. Terrain and
  absolute source accuracy were not changed or inferred.

Local source rasters and browser captures are **ignored**, not committed. The
earlier sources remain in `upsalabuild/cache/review-2026-09-06/`:
`lm-latest/` contains the 2025 product (flight-year image inspected),
`municipal-2024/` the comparison imagery, and `tees-source-2020/` /
`tees-source-2023/` the historical windows. Every retained source record contains
the request URL, raster hash and georeference. Reacquire if absent and compare
hashes; a changed response requires a new review, not silently reusing old traces.

New municipal data, metadata, photographs, documents and 36 comparison panels are
under `upsalabuild/cache/review-2026-09-07/source-inventory/`; height context and
browser checks are beside it. The practice-path aerial comparison is
`upsalabuild/cache/infra-review-2026-09-07/path-candidate-2025/survey-path.png`.
The five-year/four-site tee exports are in
`upsalabuild/cache/tee-review-2026-09-07/`. Source requests at 0.1 m pixel spacing
do not establish native image resolution or positional accuracy.

Reacquisition helpers, run from the repository root. These examples use separate
cache destinations so the September 7 source bytes remain available:

```powershell
node geobuild/acquire-upsala-survey.mjs --out upsalabuild/cache/next-session-source-inventory/primary-map
upsalabuild/cache/review-venv/Scripts/python.exe geobuild/acquire-tee-review-2026-09-07.py --out upsalabuild/cache/next-session-tee-review
```

The municipal helper saves public source bytes and hashes; `--layers` can narrow
the requested layer IDs. Inspect the helper before changing the acquisition;
`--help` makes no requests; acquisition refuses a nonempty destination. Use a
new destination for each later comparison. The municipal primary map uses EPSG:3011;
the stored queries request EPSG:3006 over
`[639100, 6635100, 641200, 6637200]`. Intersecting geometries may extend beyond
that window; nearby context is not proof of club ownership. Registration and
modification dates are not observation dates. Measurement codes and accuracy
attributes must be checked per record.

The municipal directory is
`https://kartportal.uppsala.se/cacheimage/rest/services/ortofoto?f=pjson`.
Historical services are `ortofoto2020/ImageServer/exportImage` and
`Ortofoto_2023_1800/MapServer/export`. Their exact export requests are preserved
in the follow-up evidence; JSON export responses contain the raster `href`.

`geobuild/render-mapping-review.py` renders georeferenced raw/overlay pairs from
acquisition request records and verifies source hashes. Use `--panels report.json`
for identical comparison extents and `--evidence FILE` to inspect candidates.
It only writes beneath a cache directory. Its infrastructure mode covers the
fixed nine-panel Upsala context window, not an exhaustive whole-ground census.
`geobuild/render-tee-review.py --followup FILE` checks displayed current rings
against the model; `geobuild/render-stora-followup.py` produces the extra vector
comparison. Full acquisition examples are in [README.md](README.md).

Use the interactive source map to compare current adopted geometry and municipal
observations without editing them. In a separate terminal:

```powershell
node tools/serve.mjs . 8631
```

Open [the local source review](http://127.0.0.1:8631/upsalabuild/mapping/source-review.html).
Search by object ID, category or hole; toggle layers and inspect provenance in
popups. Reload data after a rebuild. See [viewer instructions](source-review.md).
The viewer preserves coordinates but is not a new survey or an approval to adopt
every source observation.

Useful primary sources beyond the stored GIS layers:

- [Uppsala municipal primary map](https://kartportal.uppsala.se/mapping/rest/services/nPlanBygg/Bygglov_Primarkarta_utskrift/MapServer):
  layer 6278 road edges, 564 ditch lines, 570 boundaries, 571 bridge areas,
  568 bridge lines, 562 trees and 6292 ground heights. The inventory also records
  street, floor and plinth heights and control marks for possible later review.
- Official [Halfway House replacement](https://upsalagk.se/news/nytt-servicehus-2026/)
  and [opening](https://upsalagk.se/news/halfway-house-smygoppnat-2026/) updates
  establish the 2026 change, but the available images/plan do not geolocate it.
- [Upplandsmuseet's 2024 fieldwork report](https://www.upplandsmuseet.se/globalassets/publikationer/rapportserien/rapporter-2024/2024_23-gravfalt-och-boplatser_web.pdf)
  has useful practice-area photos/maps. Printed coordinate/scale inconsistencies
  prevent direct survey extraction; obtain the original survey geometry.
  Archaeological charcoal is not evidence of current living tree species.

## Rebuild on this Windows machine

Node dependencies are installed. A local ignored Python 3.12 environment exists
at `upsalabuild/cache/review-venv/` with pyproj, Pillow, numpy and matplotlib.
If absent, create an environment with those packages; `python` currently resolves
to a nonworking Windows app alias on this machine. The installed uv helper is
under `%TEMP%\upsala-mapping-tools`. No application dependency was added for it.

From the repository root, in PowerShell:

```powershell
$env:COURSE_GEO_PYPROJ_PYTHON = (Resolve-Path upsalabuild/cache/review-venv/Scripts/python.exe).Path
node tools/refresh-upsala-mapping.mjs --python $env:COURSE_GEO_PYPROJ_PYTHON
npm test
node upsalabuild/check3d.mjs
node packages/course-pack/check-pack.mjs apps/golf/public/courses/upsala/pack.bin upsala3d.html upsalabuild
node tools/check-packs.mjs
node packages/course-geo/migrate-legacy.mjs --check --ground upsala
node packages/course-geo/check-manifests.mjs
node tools/lint-app.mjs
node geobuild/lint-page.mjs upsala3d.html
node packages/course-v2/check-app-build.mjs
node packages/course-v2/check-renderer-build.mjs
```

Check each exit code. The refresh driver stops on failure; do not hand-edit
generated packs, migration coordinates or registry hashes to bypass a failure.
On another platform use the documented PROJ toolchain or an explicit pyproj
interpreter. Projection agreement is not a survey-accuracy certificate.

For browser checks, first build as above, then run
`node tools/serve.mjs apps/golf/dist 8620` in a separate terminal. Chrome is at
`C:/Program Files/Google/Chrome/Application/chrome.exe`.

```powershell
$env:BANVY_GPU = '1'
node tools/check-app.mjs http://127.0.0.1:8620 --only=upsala,upsala-mellanbanan
node tools/v2-graphics-review.mjs --base http://127.0.0.1:8620 --out upsalabuild/cache/next-v2-stora --course upsala --backend webgl2 --auto-fallback --q lo --graphics 1 --views 4:top:noon,16:green:noon --timeout 600 --chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node tools/v2-graphics-review.mjs --base http://127.0.0.1:8620 --out upsalabuild/cache/next-v2-mellan --course upsala-mellanbanan --backend webgl2 --auto-fallback --q lo --graphics 1 --views 1:green:noon,8:top:noon --timeout 600 --chrome 'C:/Program Files/Google/Chrome/Application/chrome.exe'
```

Run the software-browser reviews one at a time. Simultaneous runs timed out during this checkpoint; the sequential checks use a 600-second allowance.

Use `--graphics 1`: the existing review tool's `default` assertion does not match
the new main default. Required-v2 captures use software WebGL2 for correctness;
they are not performance measurements. Allow terrain to settle and inspect the
images. Keep logs/captures in cache, preserve their hashes/cameras in the next
validation record, and record failures honestly.

Before finishing, update `scope.json`, the comparison sheets and validation,
inspect `git diff --check` / `git status`, and commit the completed source and
generated changes. Keep raw imagery out of Git. Do not push or deploy unless the
user asks. If main advanced, integrate it using main's versions for conflicts,
then reapply only compatible, evidence-backed branch changes and validate again.
