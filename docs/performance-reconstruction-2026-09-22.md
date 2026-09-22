# Performance reconstruction — 22 September 2026

The previous local performance branch (`f221ce8`) was no longer available after
workspace maintenance. It was absent from GitHub and no recoverable archive was
found. This work starts from GitHub `f5f1e18840d83088c9f30f113a347178b8464dc6`.
It reconstructs a tested first batch; it does not claim to recover those commits
or all the previous optimizations. Main has not been updated.

The supported presentation remains v2 terrain + Ghibli. There are no changes to
course geometry, tree populations or detail, resolution, lighting, shadow policy,
water appearance, animations or camera behavior. Complete-course readiness is
retained. The shared engine changes apply to all 13 layouts.

## What changed

| Priority | Change | Evidence and expected benefit | Effort / visual risk |
| --- | --- | --- | --- |
| Loading 1 | Rebuild prepared terrain colors and water; require current identities and verified assets before Pages publication | All 26 painted high/low variants and 10 supported water datasets are prepared. Three existing unsupported paths require a fresh bake receipt. Prevents silently doing this work at runtime after a source edit. No whole-boot saving estimated. | Medium; low with field parity |
| Loading 2 | Restore Visby's lossless startup package | 842 original chunks become four packs and one manifest. Transport including manifest falls from 10,952,883 to 6,670,874 bytes (39.1%). Authoritative terrain/vegetation chunks stay unchanged. | Low; byte parity required |
| Loading 3 | Encode mowing bearings once; skip unnecessary interior edge distances; pack four texture channels in one traversal | All 13 complete atlas outputs match the original implementation exactly. See isolated timings below. | Low; boundary/partial-group tests |
| Loading 4 | Avoid private consumer copies during complete-course verification | Verification still executes every integrity check and shares pending work. Mutable consumers still receive private copies. No peak-memory or full-boot claim. | Low; cancellation/integrity/ownership tests |
| Loading 5 | Bound shoreline search work by visiting only new border cells; scan remaining edges when an unbounded search becomes expensive | Exact segment mathematics and finite-cutoff semantics retained. Adversarial and real-ring tests cover this change. No new real-course shoreline timing claimed in this batch. | Medium; exact distance tests |
| Loading 6 | Load up to three tree assets concurrently | Catalogue and variant order, asset checksums, geometry fitting and complete readiness preserved. Real asset tests check ordering and concurrency. No network-latency saving claimed from local filesystem delivery. | Low; exact world parity |
| Frame work 1 | Skip identical marker DOM writes | 180 browser update snapshots match exactly through camera movement, edge docking, obstacle movement, FOV changes, hole selection and hiding. Observed mutations fall from 1,120 to 452. Stationary repeat frames fall from 354 writes to zero. Projection/layout calculation still runs. | Low; exact DOM parity |

## Isolated CPU measurements

Chromium 140 in ChatGPT Work, software rendering. These are Vite diagnostic
module replays of real startup inputs, stopped after atlas construction. They
are not normal-use performance runs and are not hardware FPS or full boot times.
Both implementations run in the same page. Six paired batches alternate A/B and
B/A after two warm-up rounds. Each batch averages three calls; ranges are cloned
outside the timer to rebuild their index as startup does. Garbage collection is
requested between pairs, outside the timers. Construction/allocation inside the
routines is included. No build, test suite or second browser ran concurrently.
The capture uses the painted look, locked low quality, WebGL2 and a 1000 × 700
viewport. These settings are identical on both sides; they are a diagnostic
configuration, not an optimization or a change to the player's defaults.

Combined mowing-direction and texture-packing median per batch:

| Course | Original ms | Reconstructed ms | Reduction |
| --- | ---: | ---: | ---: |
| Ängsö | 236.4 | 84.2 | 64.4% |
| Norrfällsviken | 117.1 | 73.0 | 37.7% |
| Puttom | 119.9 | 74.8 | 37.6% |
| Upsala | 180.5 | 108.4 | 40.0% |
| Upsala mellanbanan | 175.3 | 100.9 | 42.5% |
| Johannesberg | 280.2 | 135.8 | 51.5% |
| Johannesberg 9 | 221.1 | 124.6 | 43.6% |
| Veckefjärden | 149.3 | 97.9 | 34.4% |
| Veckefjärden korthålsbanan | 136.8 | 95.6 | 30.1% |
| Ribbingsfors | 215.8 | 56.5 | 73.8% |
| Visby | 146.6 | 97.1 | 33.8% |
| Tortuna | 120.3 | 75.1 | 37.6% |
| Lidingö | 118.9 | 71.7 | 39.7% |

Identical-source A/A calibration showed 141.9 versus 145.7 ms for Veckefjärden
and 151.1 versus 149.3 ms for Visby. Treat these timings as medium-confidence
component evidence; exact-array equality is high confidence. Raw pairs, p75,
spread, faster-pair counts, source hashes and asset identities are retained in
`performance-reconstruction-2026-09-22-evidence.json`. Savings from different
stages must not be added to predict whole startup.

The atlas stop occurs before shoreline-field construction; it captured zero
unbounded shoreline queries. Those empty diagnostic samples are not evidence of
zero shoreline cost. The algorithm is covered by exact tests, and requires a
separate real-query timing capture before ranking its measured loading value.

## Validation and reproducibility

Runtime input and output hashes are recorded in the companion evidence file.
Raw browser reports are under `output/performance-audit/reconstruction-2026-09-22/`.
The large raw directory is excluded locally; the compact evidence is committed.

Verified source identity:
`de3bb826cfff7cb0aa312404e5745b4ebae852d5feff16d56912945e03397ae9`.

- Vitest: 160 files, 1,262 tests passed.
- Node suite: 477 passed, zero failures, three skipped. The skips concern a
  retained Lidingö source terrain raster and two opt-in Python PROJ checks;
  they do not provide additional validation of this performance batch.
- Production build, app isolation, application lint and course-workflow checks
  passed. Workflow checks validate metadata; existing source-review blockers
  remain outside this performance work.
- Startup packages: all 8,662 chunks across 10 grounds/13 courses decoded
  identically, including 310,430,300 authoritative terrain samples.
- Complete atlas output arrays match the original implementation on all 13
  courses. Fresh original/reconstructed terrain colors match all 26 variants.
- Prepared-data gate and live/restored water parity passed all 13 courses,
  retaining the three existing unsupported prepared-water paths.
- Veckefjärden, Puttom and Visby passed complete, GPU-completed opening checks
  on WebGL2/SwiftShader. Original and reconstructed implementations produced
  identical world and water fingerprints. Prepared tint was accepted and every
  chunk source was complete with no fallback reasons.

Opening checks used live animations, locked low quality and a 1000 × 700
viewport. The renderer was stopped only after the application's ready marker
so hashing would not wait behind another expensive software-rendered frame.
These are functional checks, not normal-use frame samples. Full-scene WebGPU,
high-quality opening comparisons and deterministic owner-GPU screenshots remain
unmeasured in this batch.

The Vitest and Node portions of `pnpm test` were run separately with two workers
each. This checkout also requires the locked offline reader dependencies:
`npm ci --prefix packages/course-geo/copc-reader --ignore-scripts`.

Use the locked dependencies and Node 22 or newer. For Work, point
`BANVY_CHROME_PATH` to the installed Chromium executable. Do not use `BANVY_GPU=1`
in this software-GPU environment. It selects the owner's Windows adapter path.

```sh
pnpm install --frozen-lockfile
node tools/build-startup-packs.mjs
pnpm --filter @banvy/golf build
# Serve the current dist in the same execution session as the browser tools.
node tools/bake-water.mjs http://127.0.0.1:8662 --report output/water-publication.json
pnpm --filter @banvy/golf build
node tools/bake-ground-tints.mjs http://127.0.0.1:8662 --report output/tint-publication.json
pnpm --filter @banvy/golf build
node tools/check-prepared-startup.mjs --public apps/golf/dist
node tools/check-prepared-water.mjs http://127.0.0.1:8662 --out output/water-parity.json
node tools/audit-reconstruction.mjs
node tools/audit-reconstruction.mjs --calibration --courses veckefjarden,visby
node tools/audit-opening-readiness.mjs
```

`build-reconstruction-baseline.mjs` creates a diagnostic control with the six
original implementations and identical prepared assets. Its directory is marked
DIAGNOSTIC-ONLY and must not be deployed. This control supports world/output
parity, not a before/after full-boot timing claim.

To reproduce the companion evidence, save the publication/parity reports using
the filenames listed in its `rawFiles` inventory. Build the diagnostic control,
serve it, and use `bake-ground-tints.mjs --public` pointing to that control's
directory to produce `baseline-tint-publication.json`. Capture both production
and diagnostic complete openings using `audit-opening-readiness.mjs --out`.
Finally run `node tools/reconstruction-evidence.mjs`; it rejects differing
source revisions, paired samples, fresh color outputs or opening fingerprints.
Save the complete test logs as `vitest.txt` and `node-tests.txt` in the same
report directory; their parsed totals and hashes are included in the evidence.
Never serve the diagnostic control to users.

## Remaining work

This reconstruction does not yet restore the lost minimap invalidation,
settled tree-cell decision skips, or immutable terrain-layer reuse and sparse
upload follow-ups. They must be reconstructed against the present code and
independently revalidated; the missing branch's old figures are not new evidence.

After preserving this branch remotely, the highest-value next investigation is
Veckefjärden flight and hole transitions, with Puttom and Visby comparisons:

1. Attribute repeated tree visibility/tier decisions, terrain planning, marker
   layout, allocations, GC and actual buffer-upload bytes/calls during motion.
2. Reconstruct only measured redundant work. Retain fade clocks, dwell/reset
   behavior, terrain residency/retries/release grace, and panel/camera updates.
3. Check exact world data and deterministic owner-GPU screenshots, then run
   interleaved normal-use frame-time comparisons on real hardware. Report frame
   median/p95/p99 and long stalls separately from CPU and GPU measurements.
4. Check Android Chrome and iPhone Safari on physical phones. Viewport or CPU
   stress in this environment cannot establish phone FPS or thermal stability.

No hardware GPU gain, sustained FPS improvement, physical-phone result,
whole-course screenshot equivalence, or full startup speedup is claimed here.
