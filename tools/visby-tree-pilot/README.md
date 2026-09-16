# Visby local tree-placement pilot

Results: `geo_data/course-v2/visby/vegetation/pilot/README.md`.

Latest: [final local-pilot closeout](../../geo_data/course-v2/visby/vegetation/pilot/closeout/README.md).
The retained placement is round six. The pilot is closed with explicit exceptions;
complete tree representation, the detector target and production adoption remain open.
Serve `node tools/visby-tree-pilot/round6-preview.mjs serve round6 8650` and open
`http://127.0.0.1:8650/pilot-review/closeout/index.html`. The closeout README gives
the audit, viewer-check and hash-verification commands. No automatic next pass is scheduled.

Historical [third local pass](../../geo_data/course-v2/visby/vegetation/pilot/round3/README.md)
adds 61 source-reviewed individuals and a 119-cell coverage ledger, 26 inspected
cells, cross-pass unresolved-case index and source/renderer comparison. Its
reproduction commands use `round3.py`, `round3_author.py`, `compile-preview.mjs --round3`,
`preview.mjs capture round3`, `round3_validate.py`, `round3_evidence.py` and
`round3_review.py`. Serve with `preview.mjs serve round3 8647`; profiling compares
round two against round three using `performance.mjs --round3`.

For another ground, start with the [reusable tree-placement workflow](../../docs/tree-placement-workflow.md)
and [review template](../../docs/templates/tree-placement-review.md). These scripts
remain Visby-specific worked examples; inspect and adapt their ground/frame,
source, scene, identity, output and capture assumptions before reuse.

The [coverage and paired-accuracy audit](../../geo_data/course-v2/visby/vegetation/pilot/coverage-audit/README.md)
identifies remaining review gaps and compares geometry on the same matched
references. Run `coverage_audit.py` with the retained pilot Python environment;
it writes separate audit artifacts and checks that input evidence and runtime
root manifests are unchanged. It does not create new placement decisions or
certify complete review inside the sampled windows.

All generated runtime graphs, previews and raw evidence are isolated under `output/visby-tree-pilot/`. The compiler checks that the production root did not change. It never writes to `apps/golf/public`. Existing tree assets were frozen with the baseline.

## Replay the retained experiment

The completed second local pass is documented in `geo_data/course-v2/visby/vegetation/pilot/round2/README.md`. Its graph, captures, measurements and review page live in `output/visby-tree-pilot/round2/`. Use `compile-preview.mjs --round2`, `preview.mjs capture round2`, and `performance.mjs --round2` for that pass; the original defaults still reproduce the first pilot. Serve it with `preview.mjs serve round2 8646`.

Run from the repository root. Retain the existing `baseline.json`, `before/`, verified raster/image caches and pinned local toolchain. Reacquiring or re-annotating creates a different experiment and must be reviewed separately. Stop capture/performance processes before rebuilding a graph they serve.

```powershell
$pilotPython = 'upsalabuild/cache/review-venv/Scripts/python.exe'
$pilotR = 'output/visby-tree-pilot/toolchain/R-4.5.3/bin/Rscript.exe'
& $pilotPython tools/visby-tree-pilot/toolchain.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/prepare.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/reference.py
& $pilotR tools/visby-tree-pilot/detect.R
node tools/visby-tree-pilot/detect-node.mjs
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/benchmark.py
& $pilotPython tools/visby-tree-pilot/seasonal.py
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/author.py
node tools/visby-tree-pilot/export-inputs.mjs
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/stand_fields.py
node tools/visby-tree-pilot/compile-preview.mjs
node tools/visby-tree-pilot/preview.mjs capture after
& $pilotPython -W ignore::DeprecationWarning tools/visby-tree-pilot/validate.py
node tools/visby-tree-pilot/performance.mjs
& $pilotPython tools/visby-tree-pilot/finalize.py
& $pilotPython tools/visby-tree-pilot/review.py
```

`performance.mjs` writes the raw local summary; `finalize.py` retains its measurements plus this experiment's investigation in the evidence directory. Update that investigation if a new run changes the findings. The browser is Chrome via the existing Playwright dependency. Avoid concurrent GPU work during performance runs.

The initial baseline was captured with `preview.mjs freeze` then `preview.mjs capture before`. Freezing refuses to overwrite an existing snapshot. `placement-holds.json` records the 13 visually interpreted crown centres whose bases were suppressed during runtime review; these are retained as unresolved overhangs rather than shifted into nearby open ground.

## Initial acquisition commands used

These use the repository's existing access configuration. Authentication values are never written into derived evidence or logs.

```powershell
node --env-file=.env packages/course-geo/copc-reader/build-canopy.mjs --ground visby --tight-grid --out output/visby-tree-pilot/rasters --evidence output/visby-tree-pilot/canopy-evidence.json
& $pilotPython visbybuild/mapping/lm_ortho.py --plan geo_data/course-v2/visby/reference/lm-ortho-plan-2026-09-09.json
node tools/blender-tree-study/build_preview.mjs output/visby-tree-pilot/build
```

The 2022 seasonal source and its exact-date/licence limitations are recorded in `geo_data/course-v2/visby/reference/gotland-ortho-2022.json`. The local R installation and dependency archives are not committed. Verify the pinned cache before calling `setup.R` to restore it.

## Tests and preview

The latest focused checkpoint is [round six](../../geo_data/course-v2/visby/vegetation/pilot/round6/README.md).
It reviews 79 residual height patches, resizes six existing crowns and separates
building explanations from actual canopy representation gains. Use
`node tools/visby-tree-pilot/round6-preview.mjs serve round6 8650` and open
`http://127.0.0.1:8650/pilot-review/round6/review.html`. Its README gives the
reproduction sequence. Keep all earlier checkpoint files and locks immutable.

The preceding full-facility checkpoint is [round five](../../geo_data/course-v2/visby/vegetation/pilot/round5/README.md).
It has its own frozen inputs, 153 added-area source reviews, 156-cell coverage
ledger, individual/woodland layers and whole-facility canopy gap accounting.
Use its commands and `round5-preview.mjs serve round5 8649`; earlier defaults
below intentionally reproduce the original pilot. The pink extension polygon
records review history and does not restrict individual placements. These
scripts remain Visby-specific adapters; use the general workflow for another ground.

```powershell
& $pilotPython -W ignore::DeprecationWarning -m unittest discover -s tools/visby-tree-pilot -p 'test_*.py'
node --test packages/course-geo/copc-reader/canopy-build.node-test.mjs packages/course-geo/copc-reader/copc-nodes.node-test.mjs packages/course-v2/stand-field.node-test.mjs packages/course-v2/vegetation/object-compiler.node-test.mjs packages/course-v2/vegetation/publish-vegetation.node-test.mjs packages/course-v2/vegetation/compile-vegetation.node-test.mjs packages/course-v2/vegetation/vegetation.node-test.mjs
```

Start `preview.mjs serve before 8644` and `preview.mjs serve after 8645` in separate terminals, then open `http://127.0.0.1:8645/pilot-review/review.html`. The review page switches RGB, colour infrared, NIR contrast, LiDAR and older seasonal imagery, with reference/detection/reviewed-crown and actual rendered-base overlays. It also provides all matched course views and downloadable reference/correction layers.
