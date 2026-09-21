# Production integration: Puttom and Johannesberg

Integration baseline: main `00a8d269e1d53abd57e1155210283a8e37e17d94`
(2026-09-21). Read the [workflow](course-production-workflow.md) for approval,
candidate identity and promotion rules. These adapters build **v2 + Ghibli**
candidates; they do not approve geography or change the supported player.

## Why these pilots

Before editing, `course audit --check` confirmed ten grounds, thirteen layouts,
198 holes, 469 terrain tiles per ground, no authoritative surface tiles and
pending independent frame approval throughout. All sixty workflow stage commands
were null. Existing acquisition, mapping, terrain and vegetation compilers were
substantial but outside the receipt chain. This integration configures twelve
commands on two grounds; the remaining forty-eight are still unconfigured.

The focused comparison used the source manifests, acquisition evidence, mapping
readmes, ring registry and existing tests. “Acquired” below describes retained
evidence; it does not mean raw private caches are included in Git.

| Ground | Available source/tool evidence | Geographic review gap / integration cost | Selection |
|---|---|---|---|
| Puttom | Pinned 1 m terrain/ring evidence; two laser campaigns; 45 dated, fully valid RGBI windows; generic pack and vegetation compilers; recorded tee corrections | Independent origin, microterrain, inherited geometry/rights and human tree review remain open. One layout simplifies initial wiring. Retained surface-preview dependency complicates player preparation. | First integration pilot: broad existing shared-tool coverage with a bounded 18-hole mapping task, **not** a quality winner |
| Johannesberg | Shared terrain and 2021 laser; 74 recorded orthophoto windows; reviewed water, tee and estate corrections; generic pack compiler | 18 + 9 layouts must share one ground; campaign seam crosses easting 680000; unresolved colour ownership, OB continuation and route controls | Second pilot tests sibling inventory, combined vegetation exclusions and one-ground assembly |
| Tortuna | Explicit terrain/laser/2026 imagery evidence; current card resolved; source-aware canopy exclusions and tests | Specialized stand/object builders; incomplete tee census and human acceptance | Borrow exclusion gates; higher adapter cost for first pass |
| Visby | 2026 orthophoto review; 2024 canopy; RGBI/crown experiments; coastal-water and ring guards | Coastal nodata/shoreline handling, incomplete playing boundaries and course-specific builders | Borrow review methods and water topology checks; do not generalize detector thresholds |
| Upsala | Two layouts; acquired terrain, bounded imagery, control/residual and refresh tools | Partial surface review, pending independent origin; refresh tooling also writes publication paths | Useful later shared-ground/control pilot; requires separation of authoring and publication |
| Veckefjärden | Two layouts; 2024 imagery and generic ring/vegetation chain | Older pack fields, regulated lake benchmark and inherited surfaces need care | Preserve older-schema pack support; defer lake/control integration |
| Ängsö | Terrain/playing-ground imagery and standard rings | Retained fairway cuts, source snapshot drift, surrounding lineage and controls | Later adoption after ledger reconciliation |
| Norrfällsviken | 2024 surface/facility review; measured vegetation; coastal runtime tests | Dunes, water/coast, exact building heights and source snapshot drift | Use coastal validation evidence; higher first-pilot cost |
| Lidingö | 2025 tee reviews, measured stands and mapped national water | No individual object tiles; unapproved playing geometry and controls; specialized stand exclusions | Useful representation-diversity test after these pilots |
| Ribbingsfors | Standard rings and 2023 canopy with source records | Guide-constrained synthetic playing surfaces; incomplete authoritative scorecard | Unsuitable for proving measured mapping integration |

## Techniques selected by layer

| Layer | Implemented choice | Evidence and limit |
|---|---|---|
| Terrain | `compileTerrainRings` from pinned, finite Float32 source rasters; complete seven-level lattice; compare every finest decoded sample against the pinned baseline (11 mm maximum) | All ten grounds use the shared ring contract. `terrain-rings.node-test.mjs`, terrain-grid/graph checks and coastal ring guards provide structural precedents. The comparison is regression evidence, not independent survey. No published terrain chunks are used as compilation input. |
| Mapping | Shared pure `compilePack`; actual PROJ horizontal conversion of the pinned structured model; card agreement; ring checks; deterministic per-hole vector sheets and source overlay plans | Puttom's recorded orthophoto/tee corrections and Johannesberg's two-layout mapping survive unchanged. All three fresh packs match published hashes in the integration run. Retained scalar heights and unreviewed geometry keep their uncertainty. New source interpretation is a reviewed input revision, never an unrecorded rebuild-time AI decision. |
| Vegetation | Existing campaign-bounded CHM detector, semantic exclusions over **all** sibling layouts, deterministic identities, exact emitted-terrain bases, object chunks and stand fields | Existing compiler/identity/exclusion tests, Visby's crown-review workflow and Tortuna's newer exclusion evidence inform the choice. Replay the recorded `machine-v1` decision; label independent canopy evaluation and human zone-A review pending. Preserve unrelated object classes and reject incompatible terrain bases. No botanical/species authority inferred. |
| Water | Preserve reviewed polygon holes, stream topology and runtime water metadata in the pack; inventory shared water in each nearby hole sheet | Johannesberg's `mapping/check-water-source-review.mjs` and `scenery/johannesberg-water.test.mjs`, plus Visby/Norrfällsviken coastal tests, are stronger references than copying one course's water level. No new flattening or arbitrary datum offsets. National hydrology/control acquisition remains a separate source revision. |
| Infrastructure | Preserve pinned modeled infrastructure, reviewed references and existing exported runtime facilities; expose mapped lines/rings for source inspection | Existing facility asset/placement tests provide format and registration checks. No Blender session or new building measurements are claimed. Exported Hero/Impostor/facility assets are player dependencies, not generated by the geographic stages. |

No single course supplies a complete production method. Pure library functions
are used instead of the older publication CLIs that rewrite source manifests or
read/write the live public tree as part of compilation.

## Executable contract

`course-workflows/<ground>/production.json` records the frame, retained baseline,
source/evidence hashes, models, cards, compatibility heightfields, optional cover,
retained sidecars, campaign evidence, review rules and capture settings.
The existing ground-ring registry remains the single lattice configuration.

| Stage | Real work | Isolated output beneath `output/course-workflow/<ground>/` |
|---|---|---|
| sources | Validate ledger/catalogue, pinned artifacts, baseline chunks, raw raster hashes and canopy grids | `stages/sources/sources.json` |
| terrain | Read all seven rasters, validate dimensions/georeferencing/no-data, compile terrain and compare finest samples | `stages/terrain/` |
| mapping | Compile fresh packs from model/heightfield inputs; transform geometry; verify card and rings; prepare review | `stages/mapping/` |
| vegetation | Process measured CHM campaigns with sibling exclusions; reconcile IDs; sample rebuilt terrain; compile objects/stands | `stages/vegetation/` |
| assemble | Emit content-addressed course/ground/routing assets for every layout; verify one shared ground; generate fresh lossless startup packs | `public/` |
| validate | Verify graph and binary references, lattice, layout inventory, pack streams and mapping errors; bind capture preparation to candidate files | `stages/validate/` |

Failed stages remove partial temporary outputs and preserve the last complete
generation. Interrupted promotion backups must be inspected and recovered before
rerunning. Receipt validity still depends on the full input/code/output hashes,
the stage dependency chain and execution identity (Node/zlib plus actual Python
PROJ metadata or the selected `cs2cs` executable hash). Failed or missing inputs
never earn a passing receipt. Raw raster filenames are explicit dependencies so
ignored cache directories cannot disappear from fingerprinting.

## Restore inputs, inspect and rebuild

Use Node 22+, `pnpm install --frozen-lockfile` and the repository's locked Pixi
geographic toolchain. Horizontal mapping can alternatively use an explicitly
selected real pyproj installation via `COURSE_GEO_PYPROJ_PYTHON`; this does **not**
provide the vertical grid/control approval. Overlay preparation uses Python 3.12
and `python -m pip install -r packages/course-workflow/requirements-review.txt`.
Keep the same toolchain for repeat builds; changed runtimes invalidate receipts.

The offline COPC reader is a separate nested package, outside the pnpm workspace:
`npm ci --prefix packages/course-geo/copc-reader --ignore-scripts --no-audit --no-fund`.
Its lockfile now pins the transitive acquisition dependencies too. Install it
before the full test suite or laser acquisition.

Restore the original authenticated acquisition cache from its retained archive:

| Input | Required location / identity |
|---|---|
| Terrain, each ground | `packages/course-geo/toolchain/.cache/acquisition/<ground>-ground-rings/l0.f32` through `l6.f32`; SHA-256s from the pinned `acquisition/ground-rings.json` |
| Puttom CHM | `<cache>/puttom-vegetation/chm-26f015-702-69.f32` and `chm-23f028-702-69.f32`, each with its `.json` grid sidecar |
| Johannesberg CHM | `<cache>/johannesberg-vegetation/chm-21c039-662-67.f32` and `chm-21c039-662-68.f32`, each with its `.json` sidecar |
| Source pixels | `puttombuild/cache/production-orthophoto/` or `johannesbergbuild/cache/production-orthophoto/`; exact `rasterFile` names/checksums in `review.acquisition` |

Here `<cache>` means `packages/course-geo/toolchain/.cache/acquisition`.
Canopy rasters must use their documented full-world or finest-frontier grid;
campaign measured-cell totals are not the raster dimensions. Cropped/custom grids
require an explicit adapter rather than an inferred georeference.

From the repository root:

```sh
pnpm course:production --ground puttom --check-config
pnpm course:production --ground puttom --inspect
pnpm course:production --ground johannesberg --inspect
```

`--inspect` writes `output/course-production/<ground>/input-preflight.json` and
returns nonzero for missing/changed data. It does not silently acquire replacement
data or advance a stage. To execute with the locked geographic environment:

```sh
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen node packages/course-workflow/cli.mjs run --ground puttom --through validate
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen node packages/course-workflow/cli.mjs run --ground johannesberg --through validate
pixi run --manifest-path packages/course-geo/toolchain/pixi.toml --frozen node packages/course-workflow/cli.mjs plan --ground johannesberg
```

Or, with a deliberately selected installed pyproj interpreter:

```sh
COURSE_GEO_PYPROJ_PYTHON=python pnpm course run --ground puttom --through validate
COURSE_GEO_PYPROJ_PYTHON=python pnpm course run --ground johannesberg --through validate
```

Repeated unchanged runs skip verified stages. A changed model, source hash,
campaign, compiler or output invalidates its dependent work. Do not invoke the
internal `--stage` entrypoint directly; it requires the runner context.

If archives are unavailable, perform a **new acquisition revision** with authorized
Lantmäteriet credentials supplied in the environment. Existing commands are:

```sh
node packages/course-geo/acquisition/access-preflight.mjs --ground puttom --provider lantmateriet
node packages/course-geo/acquisition/build-ground-rings.mjs --ground puttom
node packages/course-geo/copc-reader/build-canopy.mjs --ground puttom --out packages/course-geo/toolchain/.cache/acquisition/puttom-vegetation --observed-on YYYY-MM-DD
python puttombuild/mapping/lm_ortho.py --cache puttombuild/cache/production-orthophoto --out puttombuild/cache/production-orthophoto/acquisition.json
```

The ring and canopy readers accept `--ground johannesberg` too. Its orthophoto
reader is `python johannesbergbuild/mapping/lm-ortho-acquire.py`; it uses its own
recorded plan and `johannesbergbuild/cache/lm-ortho/`. Deliberately point the
production profile at a reviewed acquisition and cache after reconciling it.
Acquisition needs its existing rasterio/NumPy/pyproj and COPC reader dependencies;
overlay-only preparation needs Pillow. These older acquisition commands rewrite
their evidence files in `geo_data`; use a source-revision branch and inspect the
diff. The existing credentialed workflows `ground-terrain-rings.yml` and
`veckefjarden-vegetation.yml` can acquire without publication. Their retained
artifacts now retain inputs for 90 days. Canopy inputs (CHM bytes, grid sidecars,
campaigns and evidence) are archived separately from compiled outputs. Archive
these externally before expiration for durable repeat builds; this finite CI
retention is not permanent source storage.

Local credentials are not required when using these GitHub Actions workflows:
they read `LANTMATERIET_USERNAME` and `LANTMATERIET_PASSWORD` from repository
secrets. Each supports a documented push trigger for callers with repository
contents access but no workflow-dispatch capability. On a separate `claude/**`
source-revision branch, change the relevant control file and commit it:

| Workflow | Control file | Acquisition-only settings |
| --- | --- | --- |
| `ground-terrain-rings.yml` | `geo_data/course-v2/<ground>/acquisition/RUN-terrain-rings` | `publish=false` and an empty `levels=` to acquire all seven levels |
| `veckefjarden-vegetation.yml` | `geo_data/course-v2/<ground>/vegetation/RUN` | `publish=false` and `observed_on=YYYY-MM-DD` |
| `course-orthophoto-review.yml` | `geo_data/course-v2/<ground>/acquisition/RUN-orthophoto-review` | `observed_on=YYYY-MM-DD`; currently reviewed for Puttom and Johannesberg |

Use one ground per branch/trigger commit: each workflow resolves the first
changed matching control file. These settings request acquisition and staged
compilation without live publication. A preflight failure prevents the raw
acquisition and archive steps. Terrain and canopy have been exercised for both
pilots. The orthophoto workflow uses each pilot's existing bounded reader and
pinned plan. It keeps raw RGBI windows in access-controlled artifacts for three
days, keeps the plan and acquisition evidence for fourteen days, and removes
the pixels from the runner. Deliberately trigger it only for an authorized
review; it never commits or publishes raw pixels.

Reacquisition may change provider bytes, campaign coverage, evidence timestamps or
grids. Preserve the previous manifest and compare measurements before updating
artifact/profile hashes and running `--configure`. Do not re-pin merely to make
a failure disappear. Never derive replacement “raw” rasters from published chunks.

## Mapping and source review without unavailable terrain caches

This explicit partial operation performs real mapping compilation without
pretending the six-stage build succeeded:

```sh
COURSE_GEO_PYPROJ_PYTHON=python pnpm course:production --ground puttom --prepare-review
COURSE_GEO_PYPROJ_PYTHON=python pnpm course:production --ground johannesberg --prepare-review
```

Use a fresh `--out output/course-production/<ground>/<name>` for a repeat run.
Outputs include freshly compiled packs, projected geometry, `mapping-report.json`,
per-hole SVG/HTML sheets, `per-hole-coverage.json`, `discrepancies.json`, and
`source-overlay-plan.json`. The latter contains the exact argument array for:

```sh
python packages/course-workflow/render-source-overlays.py --help
```

Execute that recorded array once the raw windows are restored, choosing a fresh
local cache output. The renderer verifies the acquisition hash, every raw hash,
grid, dimensions, dates and full window validity. It mosaics measured coverage,
preserves metric aspect ratio and treats RGBI's fourth band as NIR, not alpha.
Each panel pairs the real source with a vector overlay and records coverage,
source dates/hashes and its own image hash. Missing windows block generation;
uncovered areas stay explicitly uncovered. Partial-validity windows currently
require a mask-aware adapter and are refused. Vector-only sheets are never
labeled source overlays.

Counts distinguish hole-owned geometry from nearby shared features. A missing
feature yields a review question, not proof of absence. All seven category
statuses remain `unknown`; vegetation requires its own measured-canopy review.
Use the existing candidate-bound `course review-template` and record actual
reviewer decisions/evidence there. Review outputs do not edit approval files.

## Player preparation and captures

The candidate public tree is geographic data, not a complete application bundle.
Build the supported app (`pnpm --filter @banvy/golf build`) and prepare a separate
`output/course-production/<ground>/player/` using its app shell and existing
exported Hero/Impostor/facility assets. Overlay the **entire freshly assembled
candidate public tree**, including its catalogue and startup pointers, into that
isolated bundle. Never replace candidate graph/pack files with published ones.

Puttom additionally retains a pinned migration terrain/surface preview consumed
by the player. Its `compilePuttomSurfacePreview` library can compile surfaces from
the candidate pack plus its verified retained preview, but its descriptor hashes
must agree with `apps/golf/src/engine/v2-puttom-preview.mjs`. A changed descriptor
needs a reviewed app configuration revision. This compatibility preparation is
not yet part of the generic assembly stage. Prepared tint/water accelerators are
also not inherited; remeasure startup/performance rather than assuming equality.

After stage validation and player preparation, select a job from
`stages/validate/capture-plan.json`, for example:

```sh
pnpm course:production --ground johannesberg --capture --built output/course-production/johannesberg/player --job johannesberg-webgl2-lo
```

The command verifies every prepared candidate file against the validation
snapshot before and after invoking `tools/v2-graphics-review.mjs`. It records
the binding and exit status, and refuses existing capture outputs. The harness
waits for zero pending/failed terrain loads, stable residency and two further
frames, then closes its browser and internal server. Jobs cover every hole's
tee/top views, noon/autumn, high/low quality and WebGPU/WebGL2.

This harness uses software rendering: successful images would still require
inspection, and full scenes have rendered black in this environment. No physical
mobile/GPU acceptance or frame-time benchmark is inferred. Use the existing
`BANVY_GPU=1` device harnesses and interleaved A/B timings for those separate gates.

## Onboard another ground

1. Run `pnpm course init` with the actual ground ID, all layout IDs/hole counts and
   source bbox, or `course adopt` for an existing published ground.
2. Establish its own source ledger, coordinate/height frame, campaign coverage and
   independent-control questions. Register its ring specification in
   `packages/course-v2/ground-rings-registry.mjs`; no copied datum offsets or sea-fill rules.
3. Supply measured raster archives/evidence and reviewed structured model/card
   inputs. Record corrections with source IDs, dates, reviewer decisions and
   uncertainty in versioned inputs. This first adapter supports the retained
   model schema/legacy horizontal frame; a ground without that format needs an
   explicit source-authoring adapter. It fails rather than inventing a model.
4. Write one `production.json` with all siblings and input SHA-256s. The baseline
   is a pinned regression/identity reference; source compilation still uses raw
   data. A first-ever terrain generation needs a separately reviewed baseline
   policy instead of silently disabling that comparison.
5. Run `pnpm course:production --ground <id> --configure`, inspect the generated
   dependency lists, run `--inspect`, mapping preparation and the six-stage build.
6. Inspect overlays, resolve category discrepancies, evaluate canopy on held-out
   controls, inspect every hole on supported devices, measure performance and
   complete `course release`. A build can pass while release remains blocked.

## Verified in this integration, and still blocked

Real-input mapping runs processed 4,669 Puttom coordinate pairs and 9,405 + 9,104
Johannesberg pairs. They prepared 18 + 27 hole sheets, with 7 and 15 open
source/category discrepancies respectively. All three freshly compiled packs
match their published SHA-256s; no published pack was copied as a build result.

The September 11 terrain and vegetation artifacts expired on September 18, but
the repository's hosted acquisition credentials work. Initial refreshes failed
safely when provider byte counts no longer matched the pinned discovery. Fresh
public discovery on isolated branches confirmed changed bytes/checksums for the
three terrain assets and their break geometry; Puttom capture coverage now extends
to 2026-06-17. Laser and orthophoto item selections/checksums did not change. No
retained production pin was silently replaced.

Candidate-only runs then acquired and archived the real inputs and compile outputs:

| Ground | Terrain acquisition | Vegetation acquisition | Retention |
| --- | --- | --- | --- |
| Puttom | [35608574169](https://github.com/olovmelander/olovs-hemsida/actions/runs/35608574169) | [35605716827](https://github.com/olovmelander/olovs-hemsida/actions/runs/35605716827) | raw terrain, CHM and compile/review artifacts through 2026-12-20 |
| Johannesberg | [35608622245](https://github.com/olovmelander/olovs-hemsida/actions/runs/35608622245) | [35605878004](https://github.com/olovmelander/olovs-hemsida/actions/runs/35605878004) | raw terrain, CHM and compile/review artifacts through 2026-12-20 |

Keep the source-size guard enabled. Reacquisition is a source revision requiring
measurement comparison and review, not permission to re-pin production inputs.
The discovery and campaign-review commands are in stage 5 of the v2 runbook.

After accepting the candidate discovery record on isolated acquisition branches,
both terrain acquisitions completed successfully and archived all seven raw
rings for ninety days. Sample-for-sample comparison with the published finest
terrain deliberately keeps both revisions in review:

| Ground | Finest samples | Over quantization tolerance | Over 11 mm | Maximum difference | Worst EPSG:3006 sample |
| --- | ---: | ---: | ---: | ---: | --- |
| Puttom | 16,908,544 | 1,726,667 (10.212%) | 1,237,788 | 2.849 m | E 696850.5, N 7026586.5 |
| Johannesberg | 16,908,544 | 1,488 (0.0088%) | 39 | 0.184 m | E 677830.5, N 6625596.5 |

The shared acquisition comparison now also records mean absolute error, RMSE,
fixed-threshold counts and the worst tile/sample with both heights. These values
locate and size the revision; they do not approve it. Puttom is a broad terrain
revision and Johannesberg is localized, so both remain blocked on visual/source
review rather than raising the production tolerance.

The central 2,048 m review makes the distinction clearer. Puttom has 633,219 of
4,227,136 samples over per-tile quantization tolerance and a 1.086 m maximum;
Johannesberg has 195 such samples, nine over 11 mm, and a 0.024 m maximum. The
Puttom change therefore reaches the course core, while Johannesberg's largest
ground-wide difference is outside that central review area.

Fresh canopy acquisition completed for all four active campaigns. Every CHM
raster SHA-256 is identical to the retained September 11 evidence, so the canopy
compiler inputs are reproducible across acquisition dates. Fresh acquisition-only
compiles also completed without publication:

| Ground | Crown candidates | Machine-approved records | Object tiles | Stand tiles |
| --- | ---: | ---: | ---: | ---: |
| Puttom | 162,807 | 15,159 | 251 | 256 |
| Johannesberg | 98,143 | 14,787 | 223 | 256 |

The Johannesberg artifact exposed a review-output collision: both layouts used
`hole-01.png` through `hole-09.png`, overwriting the short-course panels. The
shared renderer now qualifies filenames by course slug on multi-layout grounds,
fails on duplicate identities and retains the established names on single-layout
grounds. Re-rendering the fresh Johannesberg rasters and candidates produced 27
unique per-hole panels plus the overview; this fixes evidence preparation but is
not geographic approval.

The candidate source stages verified 563 Puttom inputs and 560 Johannesberg inputs,
including the newly archived terrain and canopy rasters. The next terrain stage
then failed closed at 2.850 m and 0.180 m respectively after runtime quantization.
Mapping, vegetation, assembly and validation were not marked complete from that
partial run. Review and either accept or correct the terrain revision before
rebuilding those dependent stages.

Unit tests exercise raw raster refusal, grid registration, deterministic pack
compilation, stage failure/replacement, per-hole uncertainty, real shared-ground
assembly/validation adapters, startup generation, corruption rejection and capture
identity. Synthetic unit fixtures are expressly separate from course evidence.
Python image tests cover hash/geotransform/date/mask rejection, RGBI handling,
coverage and deterministic overlays. CI runs these tests and checks generated
pilot dependencies.

Real terrain/canopy rebuilding and acquisition-only vegetation compilation are
now verified. Orthophoto acquisition and real source-image overlays, the complete
six-stage candidate after terrain review, player preparation/captures, independent
geographic approval, named-device performance and mobile/offline/rollback
acceptance remain unverified. The implemented adapters and diagnostic reports
make these blockers explicit; no successful release is claimed.
