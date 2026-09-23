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
| 2 | Exact prepared ground colors; indexed ring-height lookup; prepared lake masks and bed fields | Prepared forest and other spatial construction |
| 3 | Opening-camera residency, growing drawable tree buffers and bounded opening-scene shader preparation | Further GPU/CPU overlap; evaluate opt-in terrain worker |
| 4 | Byte-bounded generation cache, selected-course PWA loading and offline scenery | Renderer/shared-asset reuse across course sessions and disposal |
| 5 | Unit/build/data gates; all-course opening checks in both looks/backends; representative atmosphere/offline comparisons and tier lifetime tests | All-course atmosphere/device matrix, long tours and physical-phone p75 measurements |

This is an implementation checkpoint, not acceptance of the timing targets.

## Opening-scene GPU preparation

`prepare-opening-gpu.mjs` prepares the requested view before starting the render
loop. It uses the public `renderer.compileAsync(object, camera, scene)` API on
the original scene branches, with at most four calls in flight. The target scene
supplies the actual lights, environment and fog. Branches keep their original
parents, materials, geometry and instance buffers.

The high-quality path compiles against the actual scene-pass target, matching
its HDR format, MSAA, working color space and reversed float depth. The direct
path keeps the renderer's canvas configuration. Render target, MRT, tone mapping,
color space and error hooks are restored before rendering. The first-frame GPU
completion and whole-course data gates remain mandatory. The optimization
applies to both looks and both rendering backends.

Three r186 can log a failed asynchronous pipeline or TSL build and still resolve
its compile promise. Preparation captures that error channel and checks the
backend validation scope. A failure stops new jobs, drains in-flight jobs,
restores state and keeps the cover closed with the existing retry message.

`?startup=unprepared-gpu` retains compilation during the opening draw while
keeping prepared water, tints and the other startup improvements. It is the
comparison path, not `startup=0`, which disables several optimizations together.
`V3D.perf().gpuPreparation` records preparation time, branch completion, concurrency
and target settings. The corresponding span includes opening tree-buffer setup.

The initial native-API trace found 117 pipelines created during the opening
WebGPU frame and about 76 MB of buffer allocation. That frame took 1.4 seconds
on the CPU, followed by a 9.6-second queue-completion wait. Actual draw timestamps
in the later trial totaled about 0.18 seconds. These are distinct measurements:
API call durations are CPU time, GPU pass timestamps measure execution, and
the fence includes outstanding driver compilation, uploads and queued work.
Texture trace records deliberately call the supplied array size
`sourceViewBytes`: an array view can cover an entire atlas even when one layer
is copied, so its size is not transferred GPU bytes.

Pausing subsequent frames did not improve that initial wait. Compiling the whole
scene in a single call merely moved 9.6 seconds before the draw. Four concurrent
branch jobs reduced that preparation to 3.2 seconds in the trial; the subsequent
wait was 2.0 seconds. Full navigation-to-ready comparisons, rather than a smaller
fence number alone, decide whether the optimization helps.

Reproduce the diagnostics and uninstrumented alternating timings against the
same frozen production build:

```sh
BANVY_GPU=1 node tools/profile-gpu-startup.mjs http://127.0.0.1:8645 --startup unprepared-gpu --timestamps --out tools/reference/gpu-startup-profile.json
BANVY_GPU=1 node tools/benchmark-gpu-startup.mjs http://127.0.0.1:8645 --runs 10
BANVY_GPU=1 node tools/check-course-startup.mjs http://127.0.0.1:8645 --baseline unprepared-gpu --courses veckefjarden --q hi
BANVY_GPU=1 node tools/check-startup-gpu-failure.mjs http://127.0.0.1:8645
```

On PowerShell, set `$env:BANVY_GPU='1'` before the Node command. Timing runs use
fresh browser processes, alternate AB/BA order, verify identical world/tint
fingerprints and record the adapter and GPU utilization before each visit.
Do not run bakes or browser visual gates alongside the timing batch. Desktop
CPU/network throttling remains a stress test, not physical-phone evidence.

The implementation was checked against the installed Three 0.186.0 sources and
the public [Renderer compilation API](https://threejs.org/docs/pages/Renderer.html#compileAsync)
and [PassNode configuration](https://threejs.org/docs/pages/PassNode.html).

The final GPU build includes the parallel canopy contrast work and the default
`continuous-canopy-2026-09-13` catalogue. All 15 authored models, the five species,
their distance levels and the richer green palettes are retained. Its runtime
revision is `c2aa90b36bae20ee210a3954ad467955dea29dfe4c6c0ca10f1702d647c3cac3`.
All 10 water records and 52 tint variants have been refreshed for that revision;
the 36 unique referenced files total 16,519,091 bytes. Publication rechecks source,
course identities and file hashes before updating the catalogue.

This build passes 1,112 Vitest tests in 146 files, lint, the production build and
the 13-course graph/isolation proof. All 13 courses also pass four opening checks:
natural and painted at WebGPU/high quality and WebGL2/low quality. Each of the
52 checks requires the entire course, prepared data, valid tree slots and a drawn
opening frame. Painted checks verify the loaded canopy revision and all model
and foliage-atlas files. These are opening checks, not an all-course comparison
of every atmosphere or a physical-phone qualification.

The final painted desktop comparison uses ten visits per path in ABBA order,
Chrome on the RTX 3070 Laptop, `q=hi`, 50 Mbps / 40 ms, fresh browser processes
and blocked service workers. Driver/shader caches are not reset. Mean
navigation-to-ready improves from **27.51 s to 23.47 s (14.7%)**; nearest-rank p75
improves from **27.61 s to 23.51 s**. Mean GPU startup, including preparation,
first-frame CPU submission and the completion wait, falls from **9.11 s to
5.11 s (43.9%)**. The preparation itself costs 2.56 s; the subsequent completion
wait falls from 8.02 s to 1.67 s. The end-to-end measurement includes the cost of
preparing the shaders.

These measurements use the same frozen build and exact world/tint tables.
Other automated browser tests and bakes were stopped during the timing batch;
background workstation GPU activity is recorded before every visit in
`tools/reference/gpu-startup-painted-timing/report.json`. This is one workstation
measurement, and the full startup targets remain unmet.

Two visits per path provide additional, smaller comparisons:

| Configuration | Mean ready, baseline | Mean ready, prepared GPU | Mean GPU startup, baseline / prepared |
| --- | ---: | ---: | ---: |
| WebGL2, painted, `q=lo`, 50 Mbps / 40 ms | 29.72 s | 24.04 s | 10.53 / 4.88 s |
| Phone viewport on the desktop GPU, painted, `q=lo`, 4x CPU slowdown, 20 Mbps / 80 ms | 66.49 s | 64.95 s | 10.26 / 8.83 s |

The latter is a modest 2.3% readiness improvement in desktop emulation, not a
physical-phone result or release-scale p75 evidence. First-frame CPU blocking
falls from 5.93 s to 0.84 s; the earlier asynchronous preparation takes 6.40 s.
CPU course construction still dominates, including model preparation, the far
vista and reeds/shore fields. Preparing those deterministic fields and forest
data remains necessary for substantially faster phone loading.

The persistent-profile WebGPU gate passes with Chrome restarted and the HTTP
server stopped: all 962 chunks, water fields and exact world/tint fingerprints
are preserved. A single offline reopen took 19.07 s on the comparison path and
19.45 s with GPU preparation. The controlled online reloads were 11.05/11.07 s.
These establish offline correctness; no cached-reopen speedup is established.

The final appearance gate covers both looks, all eight modes and all four
backend/quality combinations on Veckefjarden: **64 comparisons**, with a maximum
difference of 1/255 in a WebGL color channel. Each configuration also passes all
18 offline hole changes and flight startup. Persistent offline reopening passes
on WebGL2 as well. The injected native shader failure keeps the cover closed
and preserves the Swedish retry message.

[The checked-in validation summary](gpu-startup-validation-2026-09-13.json)
records the build identity, configurations, every timing run, world fingerprints,
course coverage, exact tree assets, image differences and offline results.
The GPU preparation implementation is complete; the wider startup plan still
requires prepared CPU construction, session reuse and physical-device acceptance.

## Prepared water fields

The ten courses using detected lake flats now have a publication path for their
exact flat-water labels, masks, component metadata, bed levels, depths and
shoreline-neighbor masks. A single file serves both looks, both quality profiles
and all eight atmospheres. Visby, Tortuna and Lidingo retain their existing
measured-water path; they do not run this lake detection/bed construction.

Lake levels are still measured against the resident uncarved terrain, using the
same original shoreline points and percentile. That inexpensive measurement is
also an input check. A prepared field only applies when the current source
revision, pack, ground and surroundings identities match, along with the actual
water rings/levels, coordinate bridge and ocean source. Stale, missing, damaged,
unsupported or degraded data keeps the live calculation. Development/HMR and
unknown construction switches keep that calculation too.

The prepared file is fetched and verified while the uncarved terrain rings
load. Float32 and Int32 values retain their exact bits, including no-data NaNs;
there is no reduced-resolution or lossy representation. Decompression fills one
bounded destination instead of holding another approximately 60 MB copy of the
field. The same query functions serve calculated and loaded arrays. The same
carving code updates the CPU ring payloads and subsequently loaded GPU tiles.
Water sheets, terrain colors, tree exclusions and the readiness gate therefore
continue to use the same ground and water.

Compressed files use the existing byte-bounded course-generation cache and
remain available on an offline reopen. Only the selected course fetches its
file. Water modules stay behind the terrain's dynamic import boundary and out
of service-worker shell precache.

Publication and verification (use an isolated build during parallel design):

```sh
node tools/bake-water.mjs http://127.0.0.1:8642 --public tools/reference/startup-water-final-build --snapshot tools/reference/startup-water-final-build/course-startup-build.json
node tools/check-prepared-water.mjs http://127.0.0.1:8642
node tools/check-prepared-water.mjs http://127.0.0.1:8642 --only veckefjarden,puttom,norrfallsviken --rounds 4 --cpu 4
node tools/check-course-startup.mjs http://127.0.0.1:8642 --baseline live-water --courses veckefjarden
node tools/check-startup-offline.mjs --dist tools/reference/startup-water-final-build --port 8643 --expect-water
```

The publisher verifies a lossless round trip and writes catalog references last.
`?startup=live-water` disables only prepared water, preserving the other startup
optimizations for comparisons. `V3D.perf()` reports application and load timings
separately: fetching/inflation overlaps other work and is not part of the final
water-application span. `V3D.startupWaterFingerprint()` hashes every field and
every carved ring payload on demand. The all-course gate compares those bytes,
component metadata and measured levels, before spending GPU time on rendering.

Prepared tints must also be regenerated after a water/runtime revision. Both
publications deliberately share the conservative runtime revision check;
parallel tree/color edits cannot silently reuse outdated derived data.

The earlier prepared-water checkpoint used revision
`139e19b5a94e8b9f3e13a87404ee10d623d281f54bf85efd241f18c62a123711`.
All 13 course paths pass the byte comparison (10 prepared, three unchanged),
including every flat/bed field, measured level and carved CPU ring tile.
Blocking the prepared file also passes exact comparisons for Veckefjarden and
Norrfallsviken. Unit tests cover damaged/stale/oversized payloads, bounded stream
sizes, cached corruption, offline cache reuse, shoreline queries, no-data samples
and ocean exclusion. Validation includes 1,104 Vitest tests, 21 selected Node
water/terrain tests, lint, the production build and the 13-course graph/isolation
proof. Reports: `tools/reference/prepared-water-final-review.json`,
`prepared-water-missing-review.json` and `prepared-water-final-publication.json`.

That checkpoint published matching files in `apps/golf/public`: 10 water records and
52 refreshed tint variants, using 36 unique files totaling 16,519,064 bytes.
The publication checks the current runtime and course identities again before
updating the catalog. The water files range from 78,469 to 660,540 bytes.

Veckefjarden passes all eight atmospheres in both looks on WebGPU (`q=hi`, 16
pixel-identical comparisons) and WebGL2 (`q=lo`, maximum difference 1/255).
Both backends also pass all 18 offline hole changes and flight startup for each
look. Reports: `tools/reference/prepared-water-visual-gpu/report.json` and
`tools/reference/prepared-water-visual-gl/report.json`.

The persistent-browser test closes Chrome, stops the HTTP server, and reopens
the course from its profile. All 962 chunks remain available, prepared water
and tint apply, the water file is a verified cache hit, and exact water/world
fingerprints match. `tools/reference/prepared-water-offline/report.json` records
the result. Its 20.04 s offline reopen is a correctness result, not acceptance
of the cached-load target.

All three representative courses also pass four alternating pairs under 4x CPU
slowdown, varying look and quality between pairs. Later runs overlapped rendered
validation, so `tools/reference/prepared-water-cpu4-review.json` is a CPU-stress
correctness check, not an isolated mobile timing or physical-phone result.

Four sequential desktop runs on the RTX 3070 Laptop, Veckefjarden painted at
`q=hi`, used 50 Mbps / 40 ms and the same build in ABBA order. Water preparation
averaged **827 ms live versus 282 ms prepared (66% less)**. Its earlier overlapping
fetch/verify/inflate averaged 304 ms. Exact tree tables, placements and tint
bytes match across all four runs. These are two runs per path, not p75 evidence.

**No additional end-to-end boot improvement is established by that batch.**
Course-ready means were 31.43 s live and 33.02 s prepared; GPU completion after
first submission varied from 8.5 to 11.8 s. GPU utilization before the runs was
0%, 13%, 0% and 63%. Forest construction still took about six seconds. These
measurements motivated the opening-scene GPU preparation described above.
Prepared forest/scenery remains future work, and the full startup targets remain
unmet. The complete runs, including the slower
overall result, are in `tools/reference/prepared-water-performance-summary.json`.

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

## Terrain preparation after water carving (default since 2026-09-23)

Shared loading deliberately decodes raw heights without preparing GPU texels:
CPU construction needs the heights, and water-bed carving subsequently changes
them. Previously, the shared renderer prepared the final height/parent/normal
texels synchronously on the main thread. The terrain loader now sends those
final carved heights to a dedicated worker, using the existing calculation.
Measured on the owner's RTX 3070 (docs/performance-plan-2026-09-23.md, 3.5 and
4) it removed the 30-60 ms per-tile stalls in flights and 1.3 s of boot, so it
became the default. `?startup=terrain-main` keeps the main-thread path, as does
the `?startup=0` baseline; `?startup=terrain-worker` still selects the worker.

Preparation is part of the request scheduler's bounded work: at most three
desktop or two mobile requests are in flight. A transferred private copy leaves
the construction payload attached and unchanged. Only the finished resource is
published to the terrain controller, so the whole-course and opening-frame
readiness gates still apply. Aborted requests discard late worker replies; the
runtime disposes the additional worker with its owned loader. Worker failure
rejects future requests instead of leaving them waiting for a dead worker.

`check-course-startup.mjs --baseline terrain-main --candidate 1` compares the
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
changes. The suite at that checkpoint had 1,088 passing tests in 143 files;
the subsequent validation and measurements are recorded below and in the GPU section.

Two exploratory desktop runs with the combined view/capacity changes took
28.53 and 28.40 seconds at the same configured 50 Mbps / 40 ms. They were run
later than the first checkpoint and several unchanged CPU stages were slower,
so they do not isolate a code regression or establish a further speedup. A
contemporary comparison is required. Their exact world tables still match;
reports are in `startup-profile-desktop-capacity.json`. The memory improvement
is established separately by same-build comparisons, not inferred from timings.

At the capacity checkpoint, all 52 ground-color records were republished for revision
`33944f8044ff5bcaa4eab24f719d1e63b0b8ab2146b1547507ace4745ff5c211`.
The 26 unique compressed payloads remain exactly the same 12,233,043 bytes;
only their source-bound identities changed. `startup-tint-publication.json`
records the publication. This build includes the parallel tree implementation
that was subsequently committed separately as `4b2da271`; later checkpoints
include both the startup and visual work.

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
