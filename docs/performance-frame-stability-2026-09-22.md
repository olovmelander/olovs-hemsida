# Tree update performance — 22 September 2026

This batch starts from merged main `fb3e6dd8e0378089d5dfa207cdb5376449961621`
(PR #79). It reduces shared CPU work during use. It does not change tree
populations, tree detail, frustum visibility, fades, wind, geometry, terrain,
lighting, water, shadows, resolution, camera behavior or complete-course readiness.
The changes are in the shared updater used by all 13 courses.

## Changes and attribution

1. **Reuse settled geographic tree decisions.** Geographic detail depends on
   each tree's immutable course zone. Once a visible cell has reached its target
   tiers, moving the camera does not require deciding them again. Keep checking
   every cell against the current frustum every frame. Revisit tree decisions
   on entry, reset, policy change, or while dwell is pending. Screen-size mode
   still makes its decisions every frame. Fade draining and clock rebasing run
   before any cell can reuse its decisions. A private numeric policy key adds
   one property per visited cell; it is not a new application API.
2. **Sort shared dirty slots once.** Matrices/positions, parameters and tints
   share the same changed slots. Previously, the updater copied and sorted the
   list separately for each attribute group. It now constructs the runs once
   and applies them with each group's original stride. Fade slots retain their
   separate list. Attribute versions, ranges, ordering and uploaded values are
   identical. The existing 96-range fallback is unchanged.

Veckefjärden has 86,269 trees in the captured input; Puttom 145,065 and Visby
34,944. Over the 360-frame Veckefjärden stationary replay, geographic decisions
fall from 4,769,280 to 13,248. During orbit they fall from 9,897,865 to 102,955.
During flight, including cuts between holes, they fall from 3,116,274 to 756,551.
The flight also sorts 2,897,550 slot entries instead of 5,599,199 (48.3% fewer).

The suspected broad-upload fallback did not occur in these three courses'
360-frame scenarios. There is no measured justification here for changing that
policy or trading more GPU write calls for fewer bytes. Requested upload bytes
and range counts remain unchanged. These figures do not measure driver calls,
GPU time or bandwidth.

## Measured CPU cost

Median of six batch means, in milliseconds per **tree update**:

| Course | Diagnostic scene | Before | After | Reduction |
| --- | --- | ---: | ---: | ---: |
| Veckefjärden | Rest | 0.183 | 0.067 | 63.3% |
| Veckefjärden | Orbit | 0.487 | 0.274 | 43.6% |
| Veckefjärden | Flight and hole cuts | 1.272 | 1.057 | 16.9% |
| Puttom | Rest | 0.217 | 0.082 | 62.2% |
| Puttom | Orbit | 0.836 | 0.461 | 44.9% |
| Puttom | Flight and hole cuts | 1.873 | 1.524 | 18.6% |
| Visby | Rest | 0.066 | 0.036 | 45.1% |
| Visby | Orbit | 0.314 | 0.164 | 47.8% |
| Visby | Flight and hole cuts | 0.543 | 0.520 | 4.1% |

These are isolated Chromium 140 CPU replays in ChatGPT Work, with synthetic
camera paths through real tree placements and hole centrelines. The browser
captures the unchanged painted/low-quality setup at 1000 × 700, with WebGL2 and
quality locked. It stops startup after tree construction, saves the inputs,
then discards the partial application before replaying. The replay uses the
actual application functions, real Three cameras/frusta and drawable attributes.
Dynamic buffer growth is retained, but proxy geometries omit static vertex
payloads, so full geometry-cloning cost during growth is not represented.
It does not render. Geometry/material setup, whole startup, the rest of the
frame and GPU execution are outside the timer.
Quality is held equal for comparison; no player defaults have been lowered.

Each batch has 360 updates. Two warm-up rounds precede six measured A/B and B/A
rounds. Garbage collection and camera matrix updates happen outside each timed
batch/update respectively; allocations inside tree updates remain included.
Correctness/counter runs are separate from timing. No other browser, build or
test suite ran during the timed comparisons. Batch mean CPU cost is reported
because browser timer granularity is too coarse for many individual updates;
the raw per-update p95 values are **not frame-interval p95**.

An identical-source calibration on Veckefjärden measured 0.174/0.178 ms at rest,
0.502/0.516 ms during orbit and 1.292/1.387 ms during flight. Timing confidence
is medium. In particular, Visby's 4.1% flight difference is small relative to
this calibration variation; do not treat it as a reliable FPS improvement.
Raw paired samples, p75, spread and faster-pair counts are in the companion
evidence JSON. Exact state/range parity has stronger evidence than timing.

## Verification

The new regression test executes the complete pre-change tree routines from
an immutable source fixture against the current application routines. It checks
both Three coordinate systems (including reversed WebGPU depth), both quality
profiles, geographic and screen modes, forced legacy tiers, resets, pending
dwell, freeze/unfreeze, cell exits/reentries, active fade reversals, instant
fades and clock rebasing. Every tested frame has identical slot ownership,
pending state, fade queues, matrices, positions, tint/fade attributes, counts,
visibility, attribute versions and update ranges. Sparse and >96-run uploads
also retain their exact range behavior.

Real-course replay compares all those mutable drawing inputs on every frame:
3,240 frames across the three detailed low-quality courses, another 1,800 across
the other ten courses, and 540 high-quality frames on Veckefjärden, Puttom and
Visby. All 5,580 comparisons pass. The high-quality captures contain 155,342,
209,936 and 51,119 trees respectively, so they cover the denser populations too.
This checks CPU inputs to drawing, not screenshot equivalence. Shaders,
materials and animation code are unchanged. New full-course hardware screenshots,
hardware frame intervals, phone FPS and sustained thermal behavior remain
unmeasured. SwiftShader cannot establish those results.

The prepared-data release gate passes all 13 courses. All 26 freshly rebuilt
painted terrain-color variants match main's bytes, and all ten supported water
datasets match main's physical fields and levels. The three existing unsupported
water paths retain current receipts. This preserves the earlier loading
improvements across the source revision change.

Final runtime identity:
`0f244b727986c55e2b90bfedb795560e42ee241ec6cbfe5db827cf85f450fd0c`.

Production build, application lint, app isolation and course-workflow checks
pass. Vitest passes 1,273 tests in 161 files; the Node suite passes 477 tests,
with three existing skips for a retained terrain raster and optional Python
PROJ checks. These skips provide no additional verification for this batch.
Existing course source-review requirements remain separate from these code
and structural checks.

Veckefjärden, Puttom and Visby pass complete, GPU-completed opening checks on
WebGL2/SwiftShader, with prepared tint accepted and no chunk fallback reasons.
Their world and water fingerprints match the committed merged-main controls
exactly. Animations remain live until the ready marker, after which the harness
stops rendering to collect fingerprints. These are functional opening checks,
not normal-use performance samples.

Run full software-rendered openings separately from the test suite. A concurrent
attempt hit the first-scene watchdog and two unrelated test timeouts. The serial
test and opening runs passed without changing timeouts. The pre-refresh test failure also
correctly detected stale prepared-data identities; rebuilding the assets resolved
it. Those abandoned verification attempts are not performance measurements.

## Reproduction

Use the repository's locked dependencies. Set `BANVY_CHROME_PATH` to the installed
Chromium executable in Work; do not set `BANVY_GPU=1` in this environment.

```sh
# Three representative courses: capture real inputs, verify and time updates.
node tools/audit-tree-updates.mjs
# Repeat using those exact placements; useful for subsequent candidate edits.
node tools/audit-tree-updates.mjs --reuse-fixtures
node tools/audit-tree-updates.mjs --reuse-fixtures --calibration \
  --courses veckefjarden --report tree-calibration-final.json
node tools/audit-tree-updates.mjs --parity-only --frames 60 \
  --courses angso,norrfallsviken,upsala,upsala-mellanbanan,johannesberg,johannesberg-9,veckefjarden-korthalsbanan,ribbingsfors,tortuna,lidingo \
  --report tree-parity-other.json
node tools/audit-tree-updates.mjs --parity-only --frames 60 --qualities hi \
  --report tree-parity-high.json
```

Raw inputs and reports go to `output/performance-audit/frame-stability-2026-09-22/`.
Large placement fixtures remain local; source revisions, pack identities and
input hashes are retained with the measurements. The baseline is taken from
the commit above. Reused fixtures intentionally preserve that earlier input
revision; the tool verifies their course pack identity. Recapture inputs after
any placement, geography or asset change.

Use the existing `bake-water.mjs`, `bake-ground-tints.mjs`,
`check-prepared-startup.mjs` and `audit-opening-readiness.mjs` against a production
build. Rebuild between water publication, tint publication and the final gate.
Serve and run browser tools in the same Work execution session. Save publication,
opening and test logs under the filenames consumed by `tree-update-evidence.mjs`,
then run that script to regenerate the compact committed evidence. It rejects
changed source revisions, differing colors/world/water, incomplete course
readiness, differing upload requests, missing course coverage or failed tests.

## Next investigation

Profile repeated **terrain streaming plans and reconciliation** while resting,
orbiting and crossing tile boundaries on Veckefjärden, Puttom and Visby. Separate
planning allocations from buffer construction and actual uploads. Reuse only
work whose inputs are unchanged, preserving terrain detail, residency, retries,
release grace and morph clocks. Also measure minimap redraw cost before adding
invalidation. These are hypotheses, not measured savings from this batch.

This batch targets shared frame CPU overhead. It does not claim a new boot-time
reduction or a percentage gain in overall FPS. Hardware measurements are still
needed to determine how much of the saved CPU work affects visible frame pacing.
