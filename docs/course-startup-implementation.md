# Complete-course startup optimization

The visual checkpoint is `811642024758a689248a1b0f4c7f989b5fe06491`, pushed to
`claude/golf-strategies-modes-audit-ciaejw`. Subsequent tree-study work is independent.
The eight atmosphere modes, both looks, existing quality profiles, measured
terrain and complete logical forest are acceptance constraints.

## Readiness and targets

Opening means the requested course and opening frame are ready, including GPU
completion. All terrain and vegetation for the ground must be available locally
before the cover disappears. Switching holes or starting a tour must not require
downloading missing course chunks. GPU terrain residency can still follow the
camera using those local bytes and the existing quality policy.

Targets, to be measured at p75 over at least ten runs per configuration:

| Configuration | Target |
| --- | ---: |
| Desktop cold, 50 Mbps / 40 ms | 8 s |
| Phone cold, 20 Mbps / 80 ms | 15 s |
| Phone cold, 10 Mbps / 80 ms | 25 s |
| Cached reopen, desktop / phone | 3 s / 5 s |

Desktop mobile emulation is a CPU/network stress test. Physical iPhone 12 and
Galaxy A54-class verification is required before claiming the mobile targets.

## Delivery sequence

1. Measure navigation-to-course-ready; parallelize independent loads; share
   verified course data; publish lossless bounded packages; tolerate unavailable
   browser storage. Preserve the original v2 path for comparisons and fallback.
2. Prepare deterministic water, tint, vegetation and spatial data during
   publication, using the same calculation functions and input fingerprints.
   Preserve global tree indices, Float64 intermediate precision and iteration
   order. Atmosphere/light remain dynamic.
3. Reduce tier buffer allocations to actual resident populations, including
   crossfades. Prepare shaders against the final scene, lighting, camera and
   render targets. Retain WebGPU validation and first-frame completion gates.
4. Reuse renderer/shared assets across course sessions, with explicit disposal;
   bound persistent cache generations by bytes; prevent unrelated precache
   downloads from competing with the selected course.
5. Compare all 13 courses, both looks and all eight modes; test both backends,
   offline hole changes/tours, corrupt/stale data and resource lifetime. Measure
   deployment alternatives only after identical optimized artifacts exist.

Current implementation status:

| Stage | Complete so far | Remaining |
| --- | --- | --- |
| 1 | Shared loading, lossless packages, whole-course verification and measured readiness | Release-scale timing confirmation |
| 2 | Exact prepared ground colors for all courses/looks/qualities; indexed ring-height lookup | Prepared water, forest and other spatial construction |
| 3 | Opening-camera residency and growing drawable tree buffers | Shader preparation and further GPU startup scheduling; evaluate opt-in terrain worker |
| 4 | Byte-bounded generation cache, selected-course PWA loading and offline scenery | Renderer/shared-asset reuse across course sessions and disposal |
| 5 | Unit/build/data gates, representative visual/offline checks and tier lifetime tests | Full course/backend/device matrix, long tours and physical-phone p75 measurements |

This is an implementation checkpoint, not acceptance of the timing targets.

## Indexed ring-height lookup

Compact ring levels now use a bounded array of tile references for coordinate
lookup. Heights still come from the original mutable U16 payload, through the
same interpolation and finest-level-first rules. Empty cells, tile boundaries,
duplicate-cell precedence and water carving retain their previous behavior.
Sparse or nonstandard levels keep the original map instead of allocating a
large rectangular array. The index adds no terrain samples or scenery assets.

An alternating Node benchmark against the saved original sampler checked
500,000 identical random queries on each of Veckefjarden, Puttom and
Norrfallsviken. All 1.5 million heights matched exactly. Median CPU lookup time
over eight measured passes fell 44.1%, 41.0% and 42.7%, respectively. This is a
lookup microbenchmark, **not a course-ready or physical-phone improvement**.
`tools/reference/startup-ring-lookup-benchmark.json` records individual runs.
`?startup=unindexed` retains the previous map while keeping other optimizations.

The reproducible published-data gate is:

```sh
node tools/check-ring-height-index.mjs --out tools/reference/startup-ring-index-all.json
node tools/check-ring-height-index.mjs --courses veckefjarden,puttom,norrfallsviken --queries 500000 --passes 8 --out tools/reference/startup-ring-index-repro-benchmark.json
```

All 13 courses passed 650,000 random height comparisons and 33,228 edge
inspections, including the identity of the selected tile. Unit tests also cover
empty cells, duplicate-cell precedence, no-data fallback, in-place carving and
huge sparse levels. The final focused build uses source revision
`3487dd70cd5c72a34dfb3716136fb334c18800c7bf84c1d3857533a62775c0f4`.
It has 12 matching tint variants for the three representative courses in its
isolated output, without changing the live catalog. Validation includes 1,096
Vitest tests, 40 Node terrain/runtime tests, lint, the production build and all
13 published graph/isolation checks.

Veckefjarden `q=hi` passes both looks, all eight atmospheres (16 pixel-identical
comparisons), all 18 offline hole changes and flight startup:
`tools/reference/startup-index-review-high/report.json`.

Puttom and Norrfallsviken also pass in both looks at `q=lo`: four pixel-identical
opening-mode comparisons, exact world tables, all 18 offline holes per look and
flight startup (`tools/reference/startup-index-review-courses/report.json`).

Veckefjarden's WebGL fallback passes both looks, all eight atmospheres and all
18 offline holes per look. Its maximum channel difference is 1/255, with exact
world tables (`tools/reference/startup-index-review-gl/report.json`). These
checks still do not replace the full course/device release matrix.

The persistent-profile test also passes on this build: after closing Chrome
and stopping the HTTP server, a restarted browser reopens with all 962 ground
chunks cached, prepared tint applied and exact world/model fingerprints:
`tools/reference/startup-index-offline/report.json`. Its 26.56 s offline boot
was measured during concurrent visual tests; it is a correctness check, not a
cached-performance result or acceptance of the cached target.

## Terrain preparation after water carving (opt-in experiment)

Shared loading deliberately decodes raw heights without preparing GPU texels:
CPU construction needs the heights, and water-bed carving subsequently changes
them. Previously, the shared renderer prepared the final height/parent/normal
texels synchronously on the main thread. With `?startup=terrain-worker`, the
terrain loader sends those final carved heights to a dedicated worker, using
the existing calculation. The default remains main-thread preparation until
isolated device measurements establish a complete startup improvement.

Preparation is part of the request scheduler's bounded work: at most three
desktop or two mobile requests are in flight. A transferred private copy leaves
the construction payload attached and unchanged. Only the finished resource is
published to the terrain controller, so the whole-course and opening-frame
readiness gates still apply. Aborted requests discard late worker replies; the
runtime disposes the additional worker with its owned loader. Worker failure
rejects future requests instead of leaving them waiting for a dead worker.

`check-course-startup.mjs --baseline 1 --candidate terrain-worker` compares the
two preparation paths in the same build through the existing exact-world,
visual and offline checks. The default `--baseline 0 --candidate 1` remains the
complete optimization comparison. `--baseline unindexed` isolates the lookup
change. Tree and color design can continue without changing a frozen test build.

The first worker timing experiment used build
`b98450d6a64bc439089a049225a5535c8ee14bdbf34065487c34ea4d0fdc6927`,
whose temporary `startup=1` enabled the worker and `startup=main-thread` disabled
it. Means were 34.50 s and 39.01 s for main/worker over two runs each, but GPU
utilization was already 99-100% before three of the four runs. This contended
batch establishes neither a reliable improvement nor an isolated regression;
it does not justify enabling the experiment by default. The preserved receipts
are `tools/reference/startup-terrain-paired-summary.json` and its linked runs.

The opt-in worker also passes a same-build painted Veckefjarden `q=lo` smoke
comparison against the default path: exact world tables, a pixel-identical
opening-mode capture, all 18 offline holes and flight startup
(`tools/reference/startup-index-worker-experiment/report.json`). This verifies
correctness for that case; the experiment remains disabled by default.

Experimental builds and their tint publications are isolated under
`tools/reference`; they do not overwrite the parallel design build or publish
its intermediate colors to the live course catalog. Prepared colors must be
rebaked for the final agreed source revision before release.

## Lossless transport implementation

`node tools/build-startup-packs.mjs` verifies the existing source manifests and
chunks, publishes packages of at most 2 MiB, then adds an optional `startup`
reference to `courses/index.json`. Existing v2 contracts remain untouched.
Courses sharing a ground reuse the same packages. The index is updated last.

The terrain codec predicts each integer sample from left + up - upper-left,
zigzags the signed residual modulo 65536, separates its byte planes and applies
deflate. It preserves every height and no-data sample exactly. The publisher
round-trips every terrain sample before advertising the generation.

The new manifest and packages have their own SHA-256 identities. The manifest
binds to the verified ground-manifest SHA. Terrain transport reconstructs a
**raw** BVCH envelope whose new encoded identity is included in that manifest;
the existing verifier checks its schema and the **original decoded identity**.
It does not reproduce or claim the original deflate encoder's encoded hash.
Other chunk types retain their original envelopes and hashes.

One course source owns package bytes, bounded network/decode concurrency,
in-flight deduplication and a 16 MiB terrain decode cache. Consumers receive
private payload copies. Packages stay local for the course lifetime so decoded
eviction cannot cause a network request during a tour. Missing/incompatible
packages fall back to the original verified chunks for that same ground.

Persistent source data is grouped by ground-manifest generation. A 128 MiB
budget evicts whole older generations while preserving the current ground.
Interrupted generations are reclaimed first. Cache denial/quota failures cannot
reject valid online data. Decoded terrain retention is separate from this disk
budget; background verification does not evict the opening view's hot tiles.

## Prepared ground colors

`node tools/bake-ground-tints.mjs http://127.0.0.1:8628` runs a built app against
the published sources, through its normal terrain preflight and existing color
calculation, then captures the near/far RGBA rasters. This runs before forest
construction in a dedicated publishing page. Lossless compressed records are
published for both looks and both quality profiles. Identical payloads share
files, while each variant retains its own identity.

The fingerprint includes source revision, Three version, pack and sidecar
identities, ground-manifest identity, look and quality. Windows checkout
newlines are normalized when computing the source revision. The publisher
refuses to advertise results from a stale build or sources that change during
publication. The runtime verifies encoded and decoded hashes and both raster
layouts before applying either layer. Stale, absent or invalid records use the
existing calculation. Custom construction flags bypass the prepared path.
Changing an atmosphere still uses the normal dynamic lighting and shaders.

Declared inputs must also have loaded and decoded successfully. A missing
land-cover, mowing, surroundings or required marine source keeps its normal
fallback calculation; the publisher refuses to bake a degraded source. Vite
development/HMR also keeps live tint calculation, because its build-time revision
can outlive a source edit. Production builds use prepared tints when valid.

Rebuild the app before running the tint publisher, and rebuild afterward to
include the newly published records in `dist`. Source changes invalidate tints
conservatively; re-run publication to restore the acceleration.

For parallel runtime work, use an isolated Vite output directory. The build emits
`course-startup-build.json` and fails if runtime sources change during bundling.
The publisher accepts `--snapshot <that-file>` to bind a bake to that coherent
build even while the working tree advances. Copy the published catalog and
referenced prepared files into that same isolated output before comparing it.
A later build still requires matching publication; the snapshot option never
relaxes the runtime identity check.

## Application cache

The PWA precache excludes other courses' scenery modules. On-demand JavaScript,
including module workers, receives its own runtime cache so those exclusions do
not break reopening offline. Mowing sidecars now join the existing pack and
land-cover cache. The isolated build's shell precache contains 56 entries /
2,041 KiB. This is an uncompressed precache size, not a wire-transfer measurement.

`tools/check-startup-offline.mjs` owns a local server and a fresh persistent
Chrome profile. It opens the course, repeats the visit under service-worker
control, closes Chrome, stops the server, verifies HTTP is unavailable, then
reopens the same course. The second controlled visit is the persistence boundary
tested; first-ever-visit offline persistence is not claimed. The generated
profile and report are kept under ignored `tools/reference/` for inspection.

## Opening view and drawable tree storage

The optimized path updates OrbitControls and terrain selection for the URL's
actual opening camera before waiting for residency. Previously the final wait
still described the construction camera; the next rendered frames selected more
terrain. Resident terrain textures are uploaded with `renderer.initTexture()`
before the full scene uses them. The first submitted frame now contains the
settled opening frontier. The original `startup=0` path remains a comparison.

This ordering removes the observed multi-second synchronous texture-write stall;
it does not itself prove less total GPU work or faster readiness. A diagnostic
that passed bounded layer views to `GPUQueue.writeTexture` did **not** improve
readiness and was not shipped. Its reported BufferSource lengths are not GPU
transfer byte measurements. `tools/trace-course-startup.mjs` records the CPU
profile, upload calls and first-frame windows for checking these distinctions.

Drawable tree tiers begin with at most 2,048 slots per template and grow
geometrically to the population ceiling when a view or crossfade needs more.
Logical placements, indices, full-precision transform/tint tables and incoming/
outgoing slot order remain unchanged. Each drawable owns its geometry. Growth
preserves its object/material/render order while disposing the old geometry and
render-object bindings before replacing the instance attributes. Capacities are
retained for reuse; this is bounded high-water allocation, not per-frame shrinking.

`tools/check-tree-tier-capacity.mjs` compares forced detail changes, an active
crossfade and its reversal against full allocation. It also repeats warmed
detail cycles and checks exact renderer memory stability. On WebGPU, painted
Veckefjarden at 700 x 500 / `q=lo`, all six images were pixel-identical. Opening
drawable storage fell from 45,929,156 to 4,784,128 bytes. After the forced-detail
stress cycle, Three's tracked GPU resources were 650,090,843 versus 350,005,279
bytes; these are renderer accounting values, not operating-system VRAM readings.
Both paths remained stable over repeated cycles. The report is
`tools/reference/startup-capacity-growth/report.json`.
The WebGL2 version passes too: at most 1/255 in a color channel across the six
comparisons, with identical warmed resource accounting over repeated cycles
(`startup-capacity-growth-gl/report.json`).

The preceding opening-view change also passed both looks, all eight modes and
all 18 holes offline at high quality (`startup-review-view`). The first combined
capacity smoke test passed exact tables, its captured image and all offline hole
changes. The full suite now has 1,088 passing tests in 143 files. Broader combined
backend/course validation and new timing results are still being collected.

Two exploratory desktop runs with the combined view/capacity changes took
28.53 and 28.40 seconds at the same configured 50 Mbps / 40 ms. They were run
later than the first checkpoint and several unchanged CPU stages were slower,
so they do not isolate a code regression or establish a further speedup. A
contemporary comparison is required. Their exact world tables still match;
reports are in `startup-profile-desktop-capacity.json`. The memory improvement
is established separately by same-build comparisons, not inferred from timings.

All 52 ground-color records have now been republished for revision
`33944f8044ff5bcaa4eab24f719d1e63b0b8ab2146b1547507ace4745ff5c211`.
The 26 unique compressed payloads remain exactly the same 12,233,043 bytes;
only their source-bound identities changed. `startup-tint-publication.json`
records the publication. This build includes the parallel tree implementation
that was subsequently committed separately as `4b2da271`; the startup work
remains separate working-tree changes.

The combined final build passes all 16 high-quality Veckefjarden atmosphere
comparisons with identical pixels (`startup-review-capacity-high`) and a
persistent-browser offline restart with identical complete world data
(`startup-offline-capacity`). The production isolation/graph proof passes all
13 courses against that output (`startup-capacity-app-isolation.log`).

A contemporary alternating comparison, with other browser/build jobs stopped,
ran previous/current/current/previous at 50 Mbps / 40 ms. Previous shared/prepared
loading took 28.91/28.71 s; current view/capacity changes took 28.62/28.79 s.
Means are 28.81 and 28.70 s: **effectively unchanged loading time**, with too few
runs to establish a 0.4% difference. Exact world tables match throughout.
`startup-paired-summary.json` records those runs. Thus the additional changes
establish memory/responsiveness improvements, not another loading-time win.
An actual device-request probe confirms NVIDIA / Ampere with
`isFallbackAdapter: false` (`startup-profile-adapter.json`). The profiling tools
now record the requested adapter rather than relying solely on launch flags.

## Validation recorded during implementation

The original browser decoder and the new transport were compared over all
13 courses / 10 grounds: **8,662 chunks and 310,430,300 terrain samples** match,
including every decoded header and object payload. Total ground transport,
including new manifests, is 158,399,283 bytes versus 297,153,990 original bytes
(46.7% less). This includes whole grounds, not just opening-view subsets.

The initial Veckefjärden WebGPU comparison preserves exact tree-instance,
near-tint and far-tint fingerprints. Two isolated cold contexts using packages
needed 120 page requests; the source itself fetched 9 packages and 1 manifest
(18,575,650 bytes), with no fallback. The measured local navigation-to-ready
times were 28.27 and 27.33 seconds **before prepared tints**. These are exploratory
desktop runs, not p75 results or mobile timings. CPU/GPU startup still requires
the remaining stages; the performance targets have not been achieved.

Useful reproducible gates:

```sh
node tools/check-startup-packs.mjs
node tools/check-course-startup.mjs http://127.0.0.1:8628 --courses all --q lo
node tools/check-course-startup.mjs http://127.0.0.1:8628 --courses veckefjarden,norrfallsviken --backend webgl2 --q lo
```

The browser gate compares both loaders in one build, exact world fingerprints,
all eight atmosphere captures, every hole with the network disabled immediately
after opening, tree-slot consistency and a flight startup. It records image
deltas separately and does not label desktop runs as physical-phone evidence.
An entire real-time tour and physical-device release checks remain separate.

The first WebGPU smoke comparison (Veckefjarden, painted, `q=lo`) produced
pixel-identical captures in all eight modes and visited all 18 holes after
network access was disabled. Ground tint bytes and the existing rounded tree
export matched. The current harness additionally checks unrounded Float64
placements and Float32 GPU-input tables through `V3D.startupWorldFingerprint()`.
The initial smoke build did not yet expose that full-precision hook.

The first persistent-browser offline test caught an existing scenery-cache gap:
Veckefjarden's landmarks/facilities fell back offline, changing tree exclusions
despite all 962 ground chunks remaining verified and local. The service-worker
rules now include those models and Visby's stable facility publication. A boot
success alone is therefore insufficient evidence of an identical offline world.

The corrected persistent-profile gate passes on the final isolated build:
`tools/reference/startup-offline-final/report.json`. With the HTTP server stopped
and Chrome restarted, all 962 chunks come from the application cache, prepared
tints apply, and the full-precision placement/GPU-input hashes, landmark status
and facility asset identity match the controlled online visit. This is desktop
Chrome evidence; Safari storage eviction remains a separate device check.

WebGL2 Veckefjarden passed both looks, all eight atmospheres, all 18 offline hole
changes and tour startup. The largest image-channel difference was 1/255;
`tools/reference/startup-review-gl/report.json` records the per-mode results.

The final WebGPU matrix passed Veckefjarden, Puttom and Norrfallsviken in both
looks at `q=lo`, plus Veckefjarden in both looks at `q=hi`: **64 pixel-identical
mode comparisons**, identical full-precision CPU/GPU tree tables, and every hole
visited offline. The missing-landcover injection also matched the original
fallback exactly and correctly bypassed the prepared tint. Reports are in
`tools/reference/startup-review-final`, `startup-review-high` and
`startup-review-sidecar-failure`. These are representative browser cases, not
the full 13-course/device/backend release matrix.

Visby also passes the persistent-browser restart with its server stopped,
including its facility identity (`tools/reference/startup-offline-visby`).
The first measured checkpoint matched tint publication revision
`a5e52fe1ee0571b7824376d3eabae5d579a6ca4d25d440de38db38ed4432e348`.
All 52 variants were published; 26 unique compressed payloads occupy 12,233,043
bytes. Subsequent runtime edits deliberately invalidate these records.

Validation also includes 1,085 passing Vitest tests, 31 selected Node runtime/
water tests, `no-undef`, the production build and the existing course-v2 app
isolation/graph proof against the isolated output. The latter used an ignored
copy of `check-app-build.mjs` with only its filesystem/import roots redirected;
the user's independently built `apps/golf/dist` was not replaced.

`?startup=0` exercises the original path. `?startup=raw` uses shared loading of
original chunks without the new transport. Neither flag changes visual quality.

`V3D.perf()` retains the previous stage/spans fields and adds navigation-based
readiness and course-source diagnostics. Network byte counters on the source
measure response bodies; they are **not wire-transfer measurements**. The
profiler uses CDP encodedDataLength for page traffic, explicitly identifies SW
exclusions, and can block SWs for reproducible isolated comparisons.

Examples:

```sh
node tools/build-startup-packs.mjs
node tools/boot-profile.mjs http://127.0.0.1:8628 --course veckefjarden --q hi --startup 1 --frames --fingerprint --out tools/reference/startup.json
node tools/boot-profile.mjs http://127.0.0.1:8628 --course veckefjarden --q lo --mobile --cpu 4 --mbps 20 --latency 80 --out tools/reference/startup-mobile.json
```

Use `BANVY_GPU=1` for the real local adapter. The measurements below are
exploratory; release targets still require the full device matrix. No hosting
change is required by this package format.

## First measured checkpoint, 2026-09-13

Veckefjarden, painted look, Chrome on the RTX 3070 Laptop, identical application
build and exact world fingerprints. These compare `startup=0` with `startup=1`;
parallel pack/sidecar loading is shared by both paths, so this is not a checkout
comparison with the old visual checkpoint. Fresh browser contexts and blocked
service workers isolate page traffic; driver/shader caches are not reset.

| Case | Runs per path | Original path | Prepared path | Reduction |
| --- | ---: | ---: | ---: | ---: |
| Desktop, `q=hi`, 50 Mbps / 40 ms | 2 | 33.10 s | 25.76 s | 22.2% |
| Mobile viewport, `q=lo`, 4x CPU slowdown, 20 Mbps / 80 ms | 1 | 85.52 s | 67.15 s | 21.5% |

Desktop values are arithmetic means, **not p75**. The second row runs on the
desktop GPU and is **not a physical-phone timing**. The prepared desktop pair
was repeated after the independent build-isolation check finished; that isolated
pair is the one reported here. No concurrent browser validation ran during the
timing comparisons. The 8/15/25-second and cached 3/5-second targets remain unmet.

Desktop page requests fell from 1,071 to 96 and transferred bytes from about
42.66 MB to 24.01 MB. Mobile-emulation requests fell from 952 to 95 and bytes
from 32.86 MB to 24.00 MB. The original mobile path loads a smaller initial
terrain subset; the prepared path guarantees the whole ground is local. These
are CDP page measurements, excluding service-worker traffic.

The tint calculation fell from about 2,070 ms to 0.3 ms on desktop and from
11,725 ms to 1.3 ms under CPU slowdown, excluding its earlier overlapping fetch
and decompression. The application still spends substantial time constructing
the world and preparing the first GPU frames. That is the next implementation
work, not a reason to reduce scenery or remove the readiness gate.

`tools/reference/startup-performance-summary.json` links the measured runs.
The detailed `startup-profile-*.json` reports preserve phase timings, exact
fingerprints, network conditions and the distinction from real-device evidence.
