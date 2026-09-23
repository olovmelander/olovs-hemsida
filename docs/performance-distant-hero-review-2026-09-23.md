# Distant Hero review prototype

Status: prototype implemented, rebaked, tested and measured on the RTX 3070;
owner visual review pending. The default remains the geographic Hero/Impostor
policy. This experiment does not authorize changing that default or merging.

Use `?distanthero=16` or `?distanthero=24` (`1` aliases 24). Missing, disabled,
empty and unrecognised values leave the experiment off. In geographic mode,
only a zone A/B tree assigned Hero by the geographic policy may use its own Hero-baked
impostor when it becomes small on screen. Outer zones remain impostors even
when the camera approaches; forced diagnostic tiers retain their precedence.

The measurement uses the existing projected **whole-tree height** at the
tree's centre distance, rather than just the crown's height. It retains:

- 10% hysteresis: a 24 px tree demotes below 21.6 px and promotes above 26.4 px
  (14.4/17.6 px for the 16 px variant);
- six consecutive decision frames before a visible tree changes detail;
- complementary 0.3 s high-quality / 0.25 s low-quality crossfades, with the
  existing instant deterministic capture policy;
- approved Hero geometry/atlases, geographic zones, planting, cell bounds,
  dirty upload ranges, shadow update policy and four-sample MSAA.

The flag is classified as display-only by prepared-startup eligibility, so a
review URL does not accidentally disable prepared colors, water or vegetation.
The source revision is
`25202cc6903ffb8f909d97adb7673e84e9cb9e4fab87b9721e97801268b6a972`.
All 13 courses were actually rebaked with the existing tint, water and vista
tools (the last also bakes scatter), and the prepared-startup release gate
passed. All 26 tint, 26 vista and 26 scatter records retain identical content;
all ten supported water payloads retain identical field bytes and metadata
apart from their required source identities. The other three courses retain
their existing unsupported-water path. The changed water filenames result
from identities embedded in the payload, not changed geometry.

[Publication identity comparison](graphics/performance-distant-hero-2026-09-23/publication-identity.json)
and its [audit script](graphics/performance-distant-hero-2026-09-23/check-publication.mjs)
compare against PR #89. Original bake receipts are retained for
[tint](graphics/performance-distant-hero-2026-09-23/tint-publication.json),
[water](graphics/performance-distant-hero-2026-09-23/water-publication.json) and
[vista/scatter](graphics/performance-distant-hero-2026-09-23/vista-publication.json).

## Verification and decision

The focused tests execute the application's actual tier update and slot/fade
code across high/low detail heights and both backend coordinate systems. They
check default geographic detail, threshold dwell and hysteresis, fade drain,
outer-zone invariance, forced tiers and the absence of retired Full/Lite slots.
The existing default-vs-baseline replay tests retain exact state/upload parity.

Validation: 1,314 Vitest tests pass; the complete Node list passes 478 tests
with three environment skips. Production build, app-build isolation check,
prepared-startup release gate, no-undef lint and course-workflow check/audit
pass. Windows fixture support
uses directory junctions where symlink privileges are unavailable, and replay
counter anchors normalize line endings and do not depend on explanatory comments.
The offline COPC test dependency was installed from its existing lockfile; two
unmodified source fixtures needed their exact committed bytes restored after
checkout newline conversion. Those source fixtures are not changed in this PR.

GPU comparisons use the same built prototype with the flag absent, 16 and 24,
in order off / 16 / 24 / 24 / 16 / off. The charger is connected, other browsers
are closed and the idle-GPU check is enforced without an override. Conditions:
RTX 3070 Laptop, driver 572.47, Chrome 153.0.8010.53, WebGPU, high quality,
1920 × 1080, DPR 1, golden lighting. Every arm records the actual NVIDIA
adapter, locked quality, tree policy and exact planting fingerprint.

### Stationary GPU result

Normal-use timing has no `det` pin. Each view warms for 90 frames, then records
600 uncapped frame intervals and the available timestamp-query samples.
Values below average the two run medians; GPU timestamps resolve in batches,
so these are 6–10 GPU samples per run, not 600 independent GPU measurements.

| Puttom view | Default GPU ms | 16 px GPU ms | 24 px GPU ms | Hero trees: off / 16 / 24 |
|---|---:|---:|---:|---:|
| 1 tee | 19.33 | 15.43 | 11.67 | 4,729 / 3,064 / 1,838 |
| 12 orbit | 45.81 | 20.77 | 13.01 | 11,799 / 3,726 / 1,680 |
| 14 tee | 33.65 | 18.38 | 9.27 | 8,183 / 3,816 / 1,406 |

The 24 px prototype saves 39.7%, 71.6% and 72.4% GPU time in these views.
Its two run medians are 11.67/11.67, 12.91/13.11 and 9.24/9.31 ms; the
bracketing default is 19.14/19.53, 45.55/46.07 and 33.55/33.75 ms. Planting
fingerprints match, terrain loading remains zero and no tree switches occur
inside these settled windows.

| Puttom view | Frame p50: off / 16 / 24, ms | Frame p95: off / 16 / 24, ms |
|---|---:|---:|
| 1 tee | 19.70 / 15.90 / 12.10 | 20.90 / 31.65 / 12.40 |
| 12 orbit | 46.25 / 21.20 / 13.50 | 48.10 / 22.75 / 14.30 |
| 14 tee | 34.05 / 18.75 / 9.70 | 49.75 / 22.90 / 10.50 |

The 16 px first-tee p95 worsens despite its lower median. Neither enabled
variant records a >50 ms frame in these stationary windows; the default does
at holes 12 and 14. This is GPU cost evidence, not a universal FPS guarantee.

### Moving tour result

Six 45-second Veckefjärden runs retain normal clocks and vsync. The table
averages each pair of run summaries, rather than pooling unequal frame counts.

| Metric | Default | 16 px | 24 px |
|---|---:|---:|---:|
| GPU p50, ms | 21.76 | 21.43 | 17.17 |
| Frame p50, ms | 23.70 | 23.40 | 18.20 |
| Frame mean, ms | 26.16 | 22.03 | 18.09 |
| Frame p95, ms | 48.40 | 30.60 | 24.25 |
| Frame p99, ms | 48.60 | 31.10 | 24.35 |
| Frames >50 ms | 0.81% | 0.44% | 0.40% |
| Maximum frame, each run, ms | 317.8 / 254.5 | 283.0 / 290.8 | 290.9 / 290.9 |
| Tree detail switches, each run | 0 / 0 | 1,777 / 1,777 | 2,768 / 2,769 |
| Fade reversals, each run | 0 / 0 | 0 / 0 | 0 / 0 |

The 24 px variant reduces median frame time 23.2% and mean frame time 30.9%
against its matched default. Its p95 is roughly halved, but this still does
not deliver a steady 60 fps tour or eliminate the longest stalls. At 16 px,
the median change is small compared with run variation (default 23.2/24.2 ms,
16 px 22.6/24.2 ms); the mean and p95 improvements are more consistent.
Moving terrain loading reaches 20 concurrent tiles in every arm. Endpoint
visible-tree counts vary slightly because sampling ends on a rendered frame;
the camera samples and complete planting fingerprints are retained.

These are fresh matched runs, not a subtraction from the earlier Phase 1
tour's 1.80% >50 ms result. This block's bracketing default is 0.87%/0.75%.
Use the comparison within each block to judge the causal effect.

Raw runs: [stationary](graphics/performance-distant-hero-2026-09-23/normal.json),
[tour](graphics/performance-distant-hero-2026-09-23/tour.json), and
[unrounded pair summaries](graphics/performance-distant-hero-2026-09-23/summary.json).

### Screenshot review

Open the [side-by-side viewer](graphics/performance-distant-hero-2026-09-23/index.html)
and switch its right-hand image between 16 and 24 px. It includes all three
Puttom views and four identical Veckefjärden tour poses, using original
1920 × 1080 PNGs. Click an image to inspect it at its original size.

All 21 images were visually inspected. At these poses the foreground trees,
course layout and major silhouettes remain consistent. The distant forest
does change: small crown gaps, local silhouettes, color and bright trunk
pixels differ. The differences are easiest to see across Puttom's lake at
holes 12/14 and across the distant half of Veckefjärden `tour-2`. The 24 px
variant gives the distant crowns a smoother, less finely speckled appearance;
16 px affects fewer trees. This is a visible approximation, not pixel parity.

| Capture | Mean RGB error /255, 16 / 24 px | Canvas pixels >2/255, 16 / 24 px |
|---|---:|---:|
| Puttom 1 tee | 0.0052 / 0.0222 | 0.0397% / 0.1539% |
| Puttom 12 orbit | 0.2055 / 0.5102 | 1.2811% / 2.8565% |
| Puttom 14 tee | 0.0541 / 0.1425 | 0.3493% / 0.8376% |
| Veckefjärden tour-0 | 0.0431 / 0.2148 | 0.3116% / 1.3476% |
| Veckefjärden tour-1 | 0.0469 / 0.1722 | 0.3534% / 1.1934% |
| Veckefjärden tour-2 | 0.5497 / 0.9274 | 3.5577% / 5.6644% |
| Veckefjärden tour-3 | 0.0078 / 0.0428 | 0.0576% / 0.3361% |

Errors use the entire canvas denominator, not a foliage mask. Individual
pixels differ by up to 214/255 at changed silhouettes. Native shadow-depth
hashes differ in all 14 enabled comparisons: changed tree representations
also change their shadow coverage, despite retaining the same shadow policy,
light and shadow matrix. These are not claimed to preserve shadow pixels.
Raw [Puttom](graphics/performance-distant-hero-2026-09-23/puttom/pixel-diff.json)
and [tour](graphics/performance-distant-hero-2026-09-23/veckefjarden/pixel-diff.json)
metrics retain every image and shadow hash.

Every capture uses `det=1`, settled tree tiers, terrain `loadingTiles === 0`
and two further frames. Exact camera positions/targets/FOV, light positions
and shadow matrices match across the three arms; planting fingerprints match.
One initial Puttom capture run stopped when another Chrome window opened.
The partial run was discarded, the window closed, and all three Puttom arms
were captured afresh; the report retains the resume provenance. The earlier
timing windows completed before this interruption and passed browser checks.

With the flag **off**, all seven views match the original PR #89 build to
at most 1/255 per channel, and all native shadow maps are bit-identical.
The [Puttom](graphics/performance-distant-hero-2026-09-23/default-puttom-diff.json)
and [tour](graphics/performance-distant-hero-2026-09-23/default-veckefjarden-diff.json)
comparisons support keeping the default behavior unchanged in this PR.

### Motion probes

The existing meters use **1600 × 900**, DPR 1, high quality, WebGPU and
`det=1`, with `lodmode=zone` explicit. This is a separate pixel experiment
from the 1080p frame timings. The pop meter drives the 0.3-second fade clock
and takes 180 samples at 0.25 m spacing in each of three roughly 45 m dollies.
At each position it compares the frozen tiers with the subsequent tier/fade
update, discarding camera motion alone. All three variants completed without
page errors and record their actual geographic policy and selected threshold.

| Puttom dolly | New tree switches, off / 16 / 24 | Max pixels changing >24/255, off / 16 / 24 | Worst 16×16 block mean change /255, off / 16 / 24 |
|---|---:|---:|---:|
| 5 tee, noon | 0 / 24 / 50 | 0 / 0 / 21 | 0 / 0 / 2.29 |
| 1 tee, golden | 0 / 8 / 6 | 0 / 4 / 9 | 0.04 / 0.82 / 2.04 |
| 13 tee, golden | 0 / 0 / 3 | 1 / 45 / 112 | 1.39 / 1.72 / 2.35 |

No 16×16 block exceeds the meter's 6/255 mean-change threshold in any run.
The worst 24 px step affects 112 of 1,440,000 pixels above 24/255 (0.0078%);
its per-view p95 is 0.0012%, 0.0003% and 0.0062%. Changes at 16 px on hole
13 occur mostly in the first 18 samples without new switches, consistent
with draining fades already created during view setup; they are retained,
not discarded. A switch can also concern an occluded or off-screen tree in
a visible cell, so a switch count with zero changed pixels is not proof
that every transition is invisible. These probes show small local changes,
not a guarantee of pop-free motion everywhere.

The glitter meter creeps through Puttom 12 orbit for eight samples at 0.12 m
and 0.04° yaw per sample. It counts isolated luminance changes >40/255 when
the eight neighbours change by less than 10/255 on average:

| Camera-creep metric, median per frame | Off | 16 px | 24 px |
|---|---:|---:|---:|
| Isolated flashes | 2,796 | 2,782 | 2,727 |
| Pixels changing >24/255 | 88,544 | 85,900 | 81,688 |
| Bright isolated points | 2,342 | 2,250 | 2,198 |

Every pixel metric in every frame repeats exactly on the second identical
creep in all three variants. The isolated-flash reduction is only 0.5% at
16 px and 2.5% at 24 px: this does **not** establish a large improvement in
shimmer. It also does not measure live wind animation. The main demonstrated
benefit remains lower GPU cost, with small transition changes in these paths.

See the [motion summary](graphics/performance-distant-hero-2026-09-23/motion-summary.json),
raw pop runs [off](graphics/performance-distant-hero-2026-09-23/pop-0.json),
[16](graphics/performance-distant-hero-2026-09-23/pop-16.json),
[24](graphics/performance-distant-hero-2026-09-23/pop-24.json), and raw glitter
runs [off](graphics/performance-distant-hero-2026-09-23/glitter-0/results.json),
[16](graphics/performance-distant-hero-2026-09-23/glitter-16/results.json),
[24](graphics/performance-distant-hero-2026-09-23/glitter-24/results.json).
The glitter directories also contain the original annotated diagnostic PNGs.

### Recommendation

**Review 24 px first.** It delivers substantially more GPU headroom than
16 px, especially in the two heaviest stationary views, and the bounded
motion probes show no large block changes. The screenshots show a real
trade-off in distant forest texture, gaps, highlights and shadows; 16 px is
the more conservative alternative if that difference is objectionable.
Neither setting eliminates the longest tour stalls or most shimmer.

Keep the default off in this PR. These probes and a 45-second tour do not
qualify every hole of a complete course flight or establish phone FPS. A
default-change proposal still needs the owner's visual acceptance and the
plan's side-by-side full-tour video evidence. The HTML review viewer was
checked in Chrome: all seven pairs load, both threshold selectors work, and
full-size links resolve without page errors.

## Reproduction

Build this branch, run `node tools/serve.mjs apps/golf/dist 8649`, then run the
following sequentially in PowerShell with other browsers and GPU jobs closed:

```powershell
$env:BANVY_GPU='1'
$variants='before=|far16=distanthero=16|far24=distanthero=24'
$order='before,far16,far24,far24,far16,before'
node tools/performance-ab.mjs --base http://127.0.0.1:8649 --variants $variants --order $order --out tools/reference/prototype-normal
node tools/performance-ab.mjs --base http://127.0.0.1:8649 --kind tour --course veckefjarden --variants $variants --order $order --out tools/reference/prototype-tour
node tools/performance-ab.mjs --base http://127.0.0.1:8649 --kind shots --variants $variants --order before,far16,far24 --out tools/reference/prototype-puttom
node tools/performance-ab.mjs --base http://127.0.0.1:8649 --kind shots --course veckefjarden --poses docs/graphics/performance-phase1-rtx3070-2026-09-23/tour-poses.json --variants $variants --order before,far16,far24 --out tools/reference/prototype-veckefjarden
```

For each threshold 0, 16 and 24, run the motion probes sequentially:

```powershell
$threshold=24
$query="lodmode=zone&qualitylock=1&q=hi&distanthero=$threshold"
node tools/tree-pop-meter.mjs http://127.0.0.1:8649 --modes C --frames 180 --step 0.25 --query $query --out "tools/reference/prototype-pop-$threshold.json"
New-Item -ItemType Directory -Force "tools/reference/prototype-glitter-$threshold"
node tools/glitter-meter.mjs http://127.0.0.1:8649 --view 12:orbit:golden --frames 8 --query $query --conds 'as is,as is again' --out "tools/reference/prototype-glitter-$threshold"
```

The recorded `source` field is the harness checkout commit; `build.revision`
identifies the application source used by the immutable build. Raw timing
arrays, adapter proof and individual run summaries are retained with the
captures so results can be recomputed without averaging rounded table values.
