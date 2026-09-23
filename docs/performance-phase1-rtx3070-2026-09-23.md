# Phase 1 RTX 3070 verification

Status: stationary and tour A/B/B/A complete in normal use and deterministic
mode; individual-control timing and all 35 hardware captures complete.
The application baseline is merged PR #89 (`a93f79e6`), built with source
revision `acbce9219025e4efd1550d7e85789c42596496d96ccd6cd238459af11976a4e7`.
The owner's uncommitted shadow-rest edits are excluded in a separate worktree.
Reports' `build` field identifies the measured immutable application; `source`
records the harness checkout's Git HEAD, which also contains documentation work.

Initial attempts were discarded: the laptop was on battery at 210 MHz, then
other automated Chrome sessions reopened during the comparisons. No numbers
from those attempts should enter the performance plan or support a saving.

## Accepted normal-use results

RTX 3070 Laptop, driver 572.47, Chrome 153.0.8010.53, charger connected.
The values below average the two runs' medians, rather than treating correlated
timestamp samples as independent repeats. Both before runs bracket both after
runs. Raw samples, per-window clocks/power/temperature, adapter proof and shadow
refresh counts are in [normal.json](graphics/performance-phase1-rtx3070-2026-09-23/normal.json).

| Puttom view | Four-toggle before, GPU ms | Merged defaults, GPU ms | Reduction |
|---|---:|---:|---:|
| 1 tee, golden | 28.77 | 19.43 | 32.5% |
| 12 orbit, golden | 51.05 | 46.17 | 9.6% |
| 14 tee, golden | 38.67 | 33.91 | 12.3% |

Uncapped rAF frame intervals (average of the two run medians/percentiles):

| Puttom view | Before p50 / p95, ms | After p50 / p95, ms |
|---|---:|---:|
| 1 tee | 29.2 / 30.7 | 19.9 / 21.2 |
| 12 orbit | 51.9 / 54.3 | 46.6 / 48.5 |
| 14 tee | 39.0 / 44.5 | 34.4 / 48.2 |

Hole 14's p95 does not improve despite the lower median/GPU cost. These windows
had zero terrain tiles loading throughout; the two after runs had 10 and 14
frames above 50 ms out of 600, versus 10 in each before run. This is not evidence
that all frame-time tails improved.

The merged subset has not reached the original full-Phase-1 projection. That
projection included still-deferred finer culling/caster/grid work (1.3, 1.5,
1.10), and the noise-removal ablation was an upper bound rather than a measurement
of the landed per-vertex implementation. At the first tee, the old path requests a
shadow refresh on every frame; the merged path requests about one per 60 frames
in normal use. The screenshot/readback comparison below establishes matching
shadow depth and records the foliage color approximation separately.

## Individual normal-use controls

Each row uses its own before/after/after/before sequence against the same
immutable build, with all other controls at their merged defaults. Rest
windows contain 450 measured frames after 90 warm frames. Values average
the two runs' medians, as above; individual savings are not added together.

| Control | View | Before GPU, ms | After GPU, ms | Before frame p50, ms | After frame p50, ms |
|---|---|---:|---:|---:|---:|
| `shadowcell=0` | Puttom 1 tee | 25.10 | 19.30 | 25.65 | 19.80 |
| `foliagenoise=pixel` | Puttom 12 orbit | 51.02 | 45.91 | 51.35 | 46.35 |
| `flagcull=0` | Puttom 1 tee | 19.43 | 19.50 | 19.85 | 19.80 |
| `shadowalpha=0` | Veckefjärden 45 s tour | 21.76 | 21.92 | 23.65 | 23.05 |

The shadow-cell saving is 5.80 GPU ms at the affected first tee. The landed
per-vertex noise evaluation saves 5.11 GPU ms (10.0%) at hole 12 orbit, versus
the original 20–25% ceiling measured by removing noise altogether. Color
interpolation differences are quantified with the captures below.
The flag-culling comparison has no meaningful frame-time improvement in this
GPU-bound view. It does not establish or refute the CPU saving on a slower CPU;
both sides' frame p95 is about 21 ms, and neither has a frame above 50 ms.
The shadow-alpha tour has the same mean frame interval (26.03 ms), p95
(46.0 ms) and ~2.1% frames above 50 ms on both sides. Its two before frame
medians vary 24.2/23.1 ms against 23.1/23.0 ms after. These windows do not
establish a repeatable end-to-end gain or independently measure the earlier
CPU bookkeeping claim; the shadow-depth proof does pass.

Raw independent runs: [shadow cell](graphics/performance-phase1-rtx3070-2026-09-23/individual-shadowcell.json),
[foliage noise](graphics/performance-phase1-rtx3070-2026-09-23/individual-foliagenoise.json),
[flag culling](graphics/performance-phase1-rtx3070-2026-09-23/individual-flagcull.json),
[shadow alpha](graphics/performance-phase1-rtx3070-2026-09-23/individual-shadowalpha.json).

## Normal-use Veckefjärden tour

The 45-second tour uses vsync and the same before/after controls, starting from
hole 1 in golden lighting. Values average the two independently launched runs'
statistics; [raw tours](graphics/performance-phase1-rtx3070-2026-09-23/tour-normal.json)
include camera samples and individual long frames.

| Metric | Before | Merged defaults |
|---|---:|---:|
| GPU p50 | 28.84 ms | 21.79 ms |
| Frame p50 | 30.45 ms | 23.20 ms |
| Frame p95 | 53.45 ms | 46.15 ms |
| Frame p99 | 55.40 ms | 53.20 ms |
| Frames over 50 ms | 7.72% | 1.80% |
| Mean frame interval | 32.18 ms | 26.58 ms |

The after runs still contain 420 ms maximum stalls. A lower median and fewer
slow frames do not mean the flight is free of stalls. This matched 45-second
comparison is distinct from the original audit's 30-second tour and its separate
45-second CPU profile; historical tour numbers are not its control arm.

## Deterministic timing (kept separate)

The same A/B/B/A under `det=1`, with the same backend/quality/viewport/light:

| Puttom view | Before GPU, ms | After GPU, ms | Before rAF p50, ms | After rAF p50, ms |
|---|---:|---:|---:|---:|
| 1 tee | 27.20 | 18.19 | 57.3 | 52.9 |
| 12 orbit | 50.66 | 44.07 | 54.2 | 54.6 |
| 14 tee | 37.42 | 32.47 | 52.9 | 53.1 |

These frame intervals include the deterministic cloth solve; the normal-use
table above is the performance result. The old first-tee shadow path refreshes
on every frame even in this deterministic camera sequence. The original audit's
observation that `det=1` masked that bug is therefore not universal.

[Raw deterministic runs](graphics/performance-phase1-rtx3070-2026-09-23/deterministic.json)
record a resumed final before pass: the browser guard interrupted its predecessor
before its second view. Three completed, clean runs were retained; the partial
fourth run was discarded and repeated, preserving A/B/B/A order and build/settings.

The [deterministic tour](graphics/performance-phase1-rtx3070-2026-09-23/tour-deterministic.json)
also completed A/B/B/A: mean of run GPU medians 30.83 → 25.40 ms. Frame medians
were 48.6/45.9 ms before and 48.1/46.3 ms after; the cloth-bound deterministic
path does not show the normal-use frame-time improvement. Its >50 ms fraction
varied widely (22.4–48.8% before, 29.9–30.5% after), so it is not a visitor-FPS
or tail-latency result.

## Puttom visual and shadow evidence

[Side-by-side gallery](graphics/performance-phase1-rtx3070-2026-09-23/puttom/index.html)
uses the original full-resolution PNGs; labels `cell`, `noise`, `flag` and
`alpha` disable that one control against the `after` reference. All three
views have identical shadow-depth SHA-256 hashes for all four comparisons.
Shadow-cell, flag and shadow-alpha screenshot differences have a maximum
channel error of 1/255, with no pixels above 2/255. `det=1` bypasses flag
culling on both sides, so these flag captures establish deterministic parity,
not normal-use culling behavior by themselves.

The foliage-noise interpolation is an approximation:

| View | Mean RGB error /255 | Max channel error /255 | Pixels above 2/255 |
|---|---:|---:|---:|
| 1 tee | 0.0413 | 8 | 0.3044% |
| 12 orbit | 0.0924 | 14 | 0.8379% |
| 14 tee | 0.0095 | 13 | 0.0261% |

These percentages use the whole canvas, not a foliage-only mask. The real GPU
therefore does **not** meet a strict maximum-2/255 criterion. Visual inspection
of the original captures shows the same layout, tree silhouettes and shadows;
the numerical differences are small color changes within the crowns. Keep
the original maximum-error target and this measured exception explicit.
[Pixel metrics and hashes](graphics/performance-phase1-rtx3070-2026-09-23/puttom/pixel-diff.json)
also reject black or flat captures.

## Veckefjärden visual and shadow evidence

[Tour-pose gallery](graphics/performance-phase1-rtx3070-2026-09-23/veckefjarden/index.html)
revisits four [recorded camera poses](graphics/performance-phase1-rtx3070-2026-09-23/tour-poses.json)
nearest 0, 15, 30 and 44 seconds of the first normal-use before tour. Each
capture is deterministic and waits for terrain and two further frames.
All 16 control/reference pairs have identical shadow-depth hashes. Cell,
flag and alpha images differ by at most 1/255 per channel. Noise differences:

| Pose | Mean RGB error /255 | Max channel error /255 | Pixels above 2/255 |
|---|---:|---:|---:|
| 0 | 0.0054 | 12 | 0.0095% |
| 1 | 0.0400 | 18 | 0.0913% |
| 2 | 0.0424 | 26 | 0.1065% |
| 3 | 0.0296 | 8 | 0.0395% |

The larger sparse maxima reinforce that per-vertex noise is not a strict
2/255-equivalent replacement, despite the small canvas-wide mean.
[Full metrics](graphics/performance-phase1-rtx3070-2026-09-23/veckefjarden/pixel-diff.json)
retain each image name and shadow hash. Static settled poses do not establish
the absence of every moving-camera artifact throughout a complete course tour.

## Conditions

- `BANVY_GPU=1`, NVIDIA WebGPU device verified at `requestDevice`, high quality,
  1920 × 1080, DPR 1, golden lighting, service workers blocked.
- Charger connected; other browsers and browser automation stopped. The GPU
  idle check must pass without an override. The Windows harness also checks
  for competing browser processes before and after every measurement window.
- Same immutable production bundle and settings for each side. Reversed depth,
  four-sample MSAA and the normal rendering pipeline remain enabled.
- Interleaved A/B/B/A, fresh Chrome process each run, 90 warm frames and 600
  measured frames per rest view. Record raw rAF intervals and GPU timestamp
  samples, not an estimated GPU cost from frame intervals.
- Rest timing is uncapped. The 45-second Veckefjärden tour keeps vsync enabled;
  its rAF percentiles and frames above 50 ms describe visitor-visible pacing.
- Run both normal use and `det=1`. `det=1` is mandatory for screenshot parity
  but bypasses flag culling and can mask shadow jitter (as in the original
  audit). This harness's explicit camera-selection sequence still reproduces
  the old first-tee shadow refresh on every frame under `det=1`; it also incurs
  the deterministic cloth solver cost. Keep its timing separate from normal use.
- Before every screenshot, wait for `loadingTiles === 0` and settled tree/camera
  state, then at least two further drawn frames. Capture the presented canvas
  and hash the actual sun-shadow depth texels read as `f32` via `textureLoad`
  (including `depth24plus`, whose native storage cannot be copied directly).

The combined before URL is
`?shadowcell=0&foliagenoise=pixel&flagcull=0&shadowalpha=0`.
This disables the four supplied controls, not every merged Phase 1 fix:
terrain workers, material reuse and minimap caching remain on both sides.
Individual-toggle screenshots distinguish shadow/flag identity from the
already-documented foliage-noise interpolation difference.

## Reproduction

From a built PR #89 checkout, serve `apps/golf/dist` on port 8648 and run
these commands **sequentially** in PowerShell:

```powershell
$env:BANVY_GPU='1'
node tools/performance-ab.mjs --out tools/reference/rtx3070/phase1-normal
node tools/performance-ab.mjs --det --out tools/reference/rtx3070/phase1-det
node tools/performance-ab.mjs --kind tour --course veckefjarden --out tools/reference/rtx3070/tour-normal
node tools/performance-ab.mjs --kind tour --course veckefjarden --det --out tools/reference/rtx3070/tour-det
node tools/performance-ab.mjs --kind shots --variants 'after=|cell=shadowcell=0|noise=foliagenoise=pixel|flag=flagcull=0|alpha=shadowalpha=0' --order after,cell,noise,flag,alpha --out tools/reference/rtx3070/puttom-shots
node tools/performance-gallery.mjs tools/reference/rtx3070/puttom-shots/report.json
```

The default rest views are Puttom 1 tee, 12 orbit and 14 tee. For tour
screenshots, save selected `cameraInfo` poses from the baseline tour's raw
`cameras` array into a JSON array and pass `--course veckefjarden --kind shots
--poses poses.json`; both sides then revisit the same position, target, FOV
and hole under `det=1`, with streaming settled before each capture.

Accepted results and inspected screenshots are retained with this report. The
expected-results table is updated in a separate PR alongside startup results.
