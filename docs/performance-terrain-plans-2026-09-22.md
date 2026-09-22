# Terrain planning performance — 22 September 2026

This batch starts from the published tree-update commit
`3ec71683da0abe78c762f95e417769eeb4b1c9e2` on
`codex/frame-stability-2026-09-22`. New work is isolated on
`codex/terrain-performance-2026-09-22`; this task does not merge either branch
to main.

## Findings and change

The shared terrain selector still plans every update, using the current camera,
visibility, active hole, quality budget, residency and measured render errors.
Three changes remove redundant CPU work inside that calculation:

1. Insert each refinement candidate into its sorted queue by binary search,
   preserving the existing comparator and stable tie order. Previously each
   inserted child sorted the entire queue again.
2. Build each tile's ancestor path once when constructing the manager. The
   verified hierarchy is fixed; its paths do not need rebuilding every frame.
3. Skip request-priority calculation for ancestors already resident. The
   existing request function rejected those requests anyway.

The same module serves all 13 courses and both rendering backends. No terrain
samples, tile-selection thresholds, tile budgets, detail, geometry, GPU data
formats, shaders, lighting, water, tree populations, animations or camera code
change. Streaming retries, release grace, arrivals and morph clocks retain their
existing execution paths. The additional retained state is 469 frozen ancestry
arrays containing 2,809 tile references per captured ground, plus their map.
This is a structural count, not a browser-memory measurement. Manager
construction time is outside the measured planner timer; no startup saving is
claimed for this tradeoff.

Before changing the selector, stationary component probes measured:

| Course | Complete terrain update | Planner with live frustum | Controller snapshot | Batch sync | Batch tick |
| --- | ---: | ---: | ---: | ---: | ---: |
| Veckefjärden | 0.344 ms | 0.162 ms | 0.016 ms | 0.017 ms | 0.001 ms |
| Puttom | 0.293 ms | 0.150 ms | 0.017 ms | 0.016 ms | 0.001 ms |
| Visby | 0.173 ms | 0.096 ms | 0.014 ms | 0.010 ms | 0.001 ms |

These are separate, overlapping diagnostic timers, not additive frame costs.
The selector is the largest individually measured component. During these
repeated settled updates, every terrain batch's texture-upload count, attribute
versions and render revision remained unchanged. Existing buffer invalidation
already avoids repeated settled uploads; this evidence does not justify
reworking upload policy. It does not characterize uploads during movement.

## Measured CPU savings

Median of six paired batch means, milliseconds per **terrain plan**:

| Course | Scenario | Before | After | Reduction |
| --- | --- | ---: | ---: | ---: |
| Veckefjärden | Rest | 0.1263 | 0.0862 | 31.8% |
| Veckefjärden | Orbit | 0.1354 | 0.1191 | 12.0% |
| Veckefjärden | Hole changes | 0.1806 | 0.1519 | 15.9% |
| Puttom | Rest | 0.1282 | 0.0945 | 26.3% |
| Puttom | Orbit | 0.1293 | 0.1046 | 19.1% |
| Puttom | Hole changes | 0.1588 | 0.1357 | 14.5% |
| Visby | Rest | 0.0625 | 0.0521 | 16.7% |
| Visby | Orbit | 0.0746 | 0.0551 | 26.1% |
| Visby | Hole changes | 0.0841 | 0.0750 | 10.8% |

Absolute savings are roughly **0.009–0.040 ms per plan** here. This is a modest
reduction in recurring CPU overhead, not a large FPS increase. Whole-frame
p95/p99, hardware GPU time, hardware FPS, phone performance and complete boot
time remain unmeasured in this batch. Do not add component percentages to the
previous tree or atlas percentages.

An identical-source A/A calibration varies by 0.5–2.8% in eight scenarios and
7.9% in Visby's orbit scenario. Timing confidence is medium. The paired samples,
median, p75, min/max and faster-pair counts are retained in the companion evidence
JSON; they are CPU batch statistics, not frame-interval statistics.

## Method and exactness

`tools/audit-terrain-plans.mjs` captures actual course manifests, measured render
errors, ready tiles and frustum visibility in Chromium with WebGL2, painted low
quality locked and a 1000 × 700 viewport. Service workers are blocked. It pauses
startup after the opening frontier settles and terrain textures are initialized,
before full-scene GPU preparation. This is deliberately a diagnostic session,
not a normal-use opening benchmark. No production application API is added.

The camera capture contains the opening view, 360 orbit positions and tee views
at each hole. It is discarded before replay to remove its background work.
Baseline and candidate execute in the same empty browser page. Two warm-up
rounds precede six measured rounds in alternating A/B and B/A order, each with
3,600 plans. Garbage collection is requested outside the timer. No other build,
browser or test suite runs during timing. Planner allocations remain timed;
frustum capture and manager construction do not. Captured visibility sets
explain why replay timings differ from the live-frustum component probes.

Timing holds the opening resident set fixed, including during synthetic orbit
and instantaneous hole changes. It measures the selector's cost for those
inputs; it does not simulate download timing or a real flight's residency.
Correctness separately varies residency. Reused inputs are checked against the
current verified course and ground manifests; their original capture revision
and full input hashes remain in the report.

Exact comparison covers complete desired/retained/rendered tile lists, request
order, priorities and references, refined tiles, coverage and budget flags:

- 4,548 comparisons from the three real browser captures, each replayed with
  opening, empty, shell-only and fully resident tile sets.
- 9,504 cases over all 13 public courses and every hole, four backend/device
  budgets, two resolutions/FOVs, partial visibility, residency changes,
  measured-error changes and hysteresis resets.
- A permanent 1,200-frame regression against the immutable pre-change selector,
  with moving cameras, partial residency, errors, resets and tight budgets.
- Existing controller/runtime tests retain coverage of cancellation, fallback,
  retries, bounded retention, parent dependency and terrain transitions.

This verifies selector behavior and unchanged render inputs. It is not a new
screenshot comparison or a physical-device visual signoff. No GPU-facing code
was changed.

## Release validation

Production build, application lint, app isolation and course-workflow checks
pass. Vitest passes 1,273 tests in 161 files; the Node suite passes 478 tests
with three existing skips for a retained terrain raster and optional Python
PROJ checks. Existing course source-review requirements remain separate from
these code and metadata checks.

The prepared-data gate passes all 13 courses. All 26 rebuilt terrain-color
variants and all ten supported water datasets match the published tree batch's
color bytes and physical water fields/levels exactly. The other three courses
retain current unsupported-water receipts. This preserves the prior loading
improvements across the engine revision change.

Veckefjärden, Puttom and Visby pass complete, GPU-completed opening checks on
WebGL2/SwiftShader, with prepared terrain colors accepted, complete source data,
no chunk fallback reasons and exact world/water fingerprints. Animations stay
live until the application's ready marker; the harness then stops rendering
to collect fingerprints. These are functional gates, not player loading times.
The initial combined bake/opening execution lost its connection before saving
an opening result. Independent opening runs completed successfully; the
interrupted attempt contributes no measurement or passing result.

Final engine source identity:
`e947c6e9fa8f764e9909ff3a43c40ff29f6cf6a22f4e12081861bff31d7f90b0`.
The companion evidence JSON verifies these results and retains hashes of the
raw reports and test logs.

## Reproduction

Use locked dependencies and set `BANVY_CHROME_PATH` to Work's installed Chromium.
Do not set `BANVY_GPU=1` on this software-rendered host.

```sh
node tools/audit-terrain-plans.mjs
node tools/audit-terrain-plans.mjs --reuse-fixtures
node tools/audit-terrain-plans.mjs --reuse-fixtures --calibration
node tools/audit-terrain-plans.mjs --reuse-fixtures --parity-only
node tools/check-terrain-plan-parity.mjs
node --test packages/course-v2/runtime/terrain-tile-manager.node-test.mjs \
  packages/course-v2/runtime/terrain-stream-controller.node-test.mjs
```

Raw inputs and reports go to
`output/performance-audit/terrain-plans-2026-09-22/`; compact evidence is committed.
Use the established water/tint bake, prepared-data and opening tools against a
production build, rebuilding between publications. Keep software-rendered full
openings separate from the test suite. After saving their reports and test logs,
run `node tools/terrain-plan-evidence.mjs` to verify and aggregate the results.

## Next priorities

| Goal | Next investigation | Evidence needed before changing code |
| --- | --- | --- |
| Smoother frames | Measure the unconditional minimap redraw, including strategy mode. Assess reuse of unchanged overlay layers while preserving the live camera marker. | CPU/canvas profile; exact pixels through hole, tee, strategy, GPS and overlay updates. Cost and savings are currently unmeasured. |
| Faster loading | Profile the remaining decoded-terrain-to-render-buffer construction and parent/morph preparation on Veckefjärden, Puttom and Visby. Evaluate the existing opt-in worker preparation only if that work dominates. | Separate CPU construction, transfer/copy and critical-path timings; exact heights, normals and packed buffers; full-course readiness and prepared assets accepted. No worker speedup is assumed. |
| Confirm user-visible gains | Run the same build and camera paths on a physical GPU and phone when available. | Normal-use frame intervals and full opening times at unchanged quality, resolution and effects. |

Terrain-planner optimization has low visual risk because complete outputs are
unchanged, and medium-confidence component timing. Larger new loading gains or
overall FPS improvements require the next measurements rather than extrapolating
these small per-plan savings.
