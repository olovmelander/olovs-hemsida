# Phase 1 RTX 3070 verification

Status: normal-use stationary A/B/B/A complete; deterministic, tour and image
evidence in progress.
The application baseline is merged PR #89 (`a93f79e6`), built with source
revision `acbce9219025e4efd1550d7e85789c42596496d96ccd6cd238459af11976a4e7`.
The owner's uncommitted shadow-rest edits are excluded in a separate worktree.

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

The original estimate overstates the implemented foliage saving in the heavy
views. Its noise-removal ablation was an upper bound, not a measurement of the
landed per-vertex implementation. At the first tee, the old path requests a
shadow refresh on every frame; the merged path requests about one per 60 frames
in normal use. The screenshot/readback comparison is still needed to assess
appearance and depth identity.

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
  but bypasses flag culling and masks the original shadow jitter, so it cannot
  establish those two normal-use savings.
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

Results belong with this report once all runs pass device/exclusivity checks
and the screenshots have been inspected. The expected-results table is updated
in a separate PR after startup measurements are available too.
