# Banvy course-v2 asset graph

This package is the D3 distribution-format and streaming-loader foundation. It
is an offline/runtime contract shared by WebGPU and WebGL2. A single generic
selection boundary in the app decides the v2 terrain source per course behind
the explicit flag (`?v2=1` falls back explicitly, `?v2=require` fails closed);
today it serves the retained Puttom pilot through its fail-closed live adapter,
while the generic manifest-driven streaming renderer stays gated until a real
published course/ground graph passes the same adapter contract. `GPK1`
stays the default course path until every activation gate passes.

## Graph contract

Only the small root index is mutable and revalidated. It points to a
content-addressed course manifest. Every course manifest points to one
content-addressed physical-ground manifest, so `upsala` and
`upsala-mellanbanan` can share the same terrain, surface and object chunks while
retaining separate card/routing data. Every v2 root entry also carries an exact
v1 fallback reference.

```text
fresh root index
  course manifest <sha256>
    routing chunk <sha256>
    ground manifest <sha256>
      coarse shell chunk <sha256>
      terrain/surface/object tile chunks <sha256>
    v1 fallback (GPK1)
```

The seven JSON Schema documents in `schemas/` (one shared type library plus
root/ground/course/chunk, published-object and authoritative-surface intake
contracts) describe the
interchange contract. The
strict semantic validators in `schema.mjs` additionally enforce relationships
that JSON Schema cannot express conveniently: canonical CRS and axis mapping,
sorted capabilities, safe relative URLs, full hashes in immutable filenames,
tile ownership, hole-to-tile references and exact parent-ground sharing.

## Binary envelope

Every `.bvch` file starts with this fixed 16-byte little-endian preamble:

| bytes | value |
|---:|---|
| 0–3 | ASCII `BVCH` |
| 4 | envelope version `2` |
| 5 | codec (`0` raw, `1` raw deflate) |
| 6 | header encoding (`1` canonical JSON) |
| 7 | reserved, must be zero |
| 8–11 | canonical JSON header byte length |
| 12–15 | encoded payload byte length |

The header records owner, bounds in EPSG:5845, payload format, required
features, decoded size and decoded SHA-256. The manifest records the complete
file size/SHA-256 and repeats the decoded identity. Verification is deliberately
ordered before expensive or dangerous work:

1. safe URL and manifest schema;
2. exact encoded byte count and SHA-256;
3. preamble, canonical header, bounds and capability gate;
4. per-chunk decoded-size budget;
5. decompression;
6. decoded byte count and SHA-256;
7. payload semantics and manifest/header cross-checks.

An individual chunk is capped at 16 MiB encoded and 64 MiB decoded. The terrain
spike uses little-endian uint16 RH 2000 heights with an explicit offset and
scale; the 1 cm test profile has a maximum quantization error of 5 mm. Surface
tiles use a fixed 14-byte sample with lossless primary/secondary class IDs,
signed boundary distance, owning feature, mow coordinates/direction and four
normalized material fields. Object chunks use canonical JSON with stable IDs,
source date, confidence, accuracy and review metadata; zone A rejects
procedural placement and accuracy tiers below C. Nodata, row direction and
column direction are explicit, never inferred.

## Executable synthetic gate

```sh
node --test packages/course-v2/course-v2.node-test.mjs
node --test packages/course-v2/authoritative-surface-source.node-test.mjs
node --test packages/course-v2/surface-object-contract.node-test.mjs
node --test packages/course-v2/surface-preview.node-test.mjs
node --test packages/course-v2/terrain-pyramid.node-test.mjs
node --test packages/course-v2/terrain-compiler.node-test.mjs
node --test packages/course-v2/runtime/runtime.node-test.mjs
node --test packages/course-v2/runtime/terrain-tile-manager.node-test.mjs
node --test packages/course-v2/runtime/terrain-stream-controller.node-test.mjs
node packages/course-v2/check-synthetic.mjs
```

The fixture creates two courses, one shared ground, a coarse shell, two terrain
tiles, one surface tile, one approved zone-A object registry and two separate
routing chunks entirely in memory. Its routing accuracy is deliberately
`unrated` and stroke indexes are unverified/not applicable; a test fixture
cannot accidentally promote third-party geometry to surveyed truth.

## Worker and cache harness

`runtime/` now consumes this exact graph through a Web Worker-compatible path:

- encoded and decoded SHA-256 verification use Web Crypto;
- raw-deflate output is read incrementally and stopped at the declared decoded
  byte count rather than collected without a bound;
- `ChunkWorkerClient` transfers buffers and suppresses late replies after an
  abort;
- `AssetRequestScheduler` keeps stable priorities, deduplicates shared URLs and
  aborts transport only when the last consumer leaves;
- the mutable root is network-first with a validated offline fallback;
- an authoritative HTTP response such as 404 cannot resurrect a stale root
  from offline cache;
- course and parent-ground manifests are independently size/SHA/canonical-JSON
  verified before any chunk is requested;
- immutable bytes enter Cache Storage only after Worker verification, and a
  corrupt cached copy is evicted and fetched once from the network;
- `ResourceLeasePool` reference-counts and LRU-evicts decoded/GPU resources.

The player keeps this code out of its default critical path. One selection
boundary (`v2-terrain-select.mjs`) decides which v2 terrain source serves a
course: a published, verified course/ground graph first, then the retained
Puttom fixed-frontier preview, then the explicit GPK1 fallback state. The
generic manifest resolver (`v2-graph-source.mjs`, a dynamic chunk over
`CourseV2ManifestLoader`) runs only for slugs in `V2_PUBLISHED_GRAPH_SLUGS`, so
an unpublished course never probes the network for a root that cannot exist;
`check-app-build` fails when that registry and the built
`courses/v2-index.json` disagree in either direction, and additionally verifies
a registered graph offline chunk-by-chunk against the live GPK1 index before it
can ship. `puttom` is registered: its full-AOI graph is published under
`courses/` and `grounds/` and resolves in the live app. Every manifest in the
graph must be BYTE-EXACT canonical JSON, because the runtime re-serialises what
it parsed and refuses anything that differs — a trailing newline on the root,
the ordinary courtesy for a committed JSON file, makes the whole graph
unloadable while passing every structural check, so `check-app-build` now
asserts the bytes as well as the schema. A resolved graph must declare the exact live GPK1 pack as its v1
fallback or selection refuses it. Because the generic streaming renderer has
not yet passed the adapter contract on real published data, a verified graph is
reported (`mode: 'graph'`, reason `graph-renderer-not-activated`) and the
course stays on the strongest source that can actually serve. `?v2=require`
fails closed instead of quietly serving GPK1: a corrupt or missing published
graph, a preview that cannot verify, a gated graph renderer with no ready
pilot, or a later preflight/installation fallback each become an explicit boot
error rather than a silent downgrade. Without the flag the selection makes no
request and loads no v2 chunk — proven at runtime by the capture harness's
no-flag boot, which fails the proof on any `/v2/`, root-manifest or v2-chunk
request. On Puttom,
`?v2=1` dynamically loads both the strict provisional terrain descriptor and
the matching migration-surface descriptor, then all 16 finest terrain and
surface BVCH tiles. It verifies encoded and decoded identities, the common
frame/frontier, the terrain-descriptor SHA and the already verified active GPK1
pack SHA before bridging EPSG:5845 into the current GPK1 +x-east/-z-north
coordinates. That bridge is a translation, a meridian-convergence rotation and
the legacy frame's own metre-per-degree scale, all derived in
`apps/golf/src/engine/geodetic-frame.mjs` from the two frames' declared
constants -- grid north is 3.52 degrees off true north at Puttom, so a
translation alone lands the pilot 47 m out at the corner of the course. The same indexed 1 m CPU sampler then feeds terrain, camera and
object placement while a one-draw texture-array batch renders on both WebGPU
and WebGL2. Its material adapter reads verified surface tiles; it does not use a
second hand-written material. Missing, misaligned, corrupt or source-mismatched
data falls back to GPK1 before the legacy core is cut. The batch, material and
no-data-free 16-tile frontier are compiled and drawn offscreen before legacy
CORE construction. `V2TerrainLiveAdapter` owns this frontier validation, batch
lifecycle and the separate construction/visible-height gates. A ready Puttom
preview then omits 56,169 of 123,175 legacy base-grid points (45.60%) behind an
8 m guard -- planned on the axis-aligned rectangle INSCRIBED in the rotated v2
footprint, since the legacy builder can only omit a rectangle and anything
wider would punch a hole the rotated mesh does not reach. The reviewed post-normalisation
CORE is also pinned to its exact bounds, 4 m spacing and 325 by 379 dimensions;
capture acceptance reads that grid and the builder's actual emitted/skipped
counts. Any later installation failure disables v2
height sampling and rebuilds the full GPK1 CORE before boot continues. This is a partial pilot optimization,
not removal of the remaining legacy CORE, MID or FAR meshes. The dynamic
loader/renderer chunks and BVCH data are excluded from install-time PWA precache
and cached only after the explicit opt-in. A production-build gate keeps all v2
preview chunks below 64 KiB and out of initial HTML/service worker.

The provider-access workflow builds a short-lived Puttom preview from
authenticated terrain, verifies every BVCH in the browser and captures forced
WebGL2 plus WebGPU-preferred views. A separate allow-listed artifact may leave
the runner with only the strict provisional descriptor and its 16 referenced
finest-level BVCH tiles for the opt-in interactive preview. The authenticated
COG, XYZ samples, shell and coarser LOD tiles remain ephemeral. This is not an
authoritative v2 publication; D1 origin approval remains a production gate.
The reviewed run-29 terrain bundle is retained under
`apps/golf/public/v2/puttom/`: an 8,080-byte descriptor plus 16 full-SHA BVCH
files (1,074,238 encoded bytes). A matching 16-tile surface bundle is generated
from the current GPK1 migration vectors with 14,794,976 decoded bytes and
589,871 encoded bytes. Its descriptor labels the source as
`gpk1-vector-migration-v1`, pins the current pack SHA and marks moisture, wear,
exposure and vegetation density as unmeasured zero fields. It is a material,
integrity and seam proof—not authoritative planimetric surface publication.
The app locks both descriptor hashes and the common frame before any legacy mesh
is replaced. Low-quality WebGL2 keeps the full 1 m CPU sampler but uses a 2 m
render frontier (129 x 129 samples per tile), reducing the terrain submission
from 2,129,920 to 540,672 triangles without adding draw calls.

### Puttom migration-surface compiler

```sh
node packages/course-v2/compile-puttom-surface-preview.mjs
```

The command reads the already retained terrain-preview frontier and the current
hash-verified `courses/puttom/pack.bin`, recreates the shared runtime surface
precedence, writes only full-SHA surface BVCH paths and refuses to replace a
different existing artifact. It is reproducible migration output, not a route
to promote the vectors to surveyed truth.

### Full-AOI Puttom ground-graph compiler

```sh
node packages/course-v2/compile-puttom-ground-graph.mjs \
  --xyz <aoi.xyz> --info <gdalinfo.json> --out <dir> --item-id 702_69
```

Runs on the authenticated provider workflow against the reviewed aligned
full-course window (8 x 8 tiles, 2,049 x 2,049 samples at 1 m, anchored to the
retained preview's tile lattice so the verified 16-tile frontier is an exact
subgrid at column offset 2, row offset 1). The window is derived from the
committed CORE cutout contract and preview constants — never typed twice — and
the CLI fails closed if the workflow's projwin, the STAC item id, the
geotransform or the pyramid shape disagree with the reviewed values. Before
anything is emitted, every committed preview sample (1,056,784 of them) must
agree with the freshly compiled master on the shared 1 cm quantization
lattice: zero no-data mismatches, at most one quantum of float-tie drift and
at least 99.9% exact equality. `emit-ground-graph-node.mjs` then assembles the
publishable root/course/ground graph — routing heights sampled from the
compiled pyramid, hole-to-tile priority mapping behind an 80 m buffer, the
exact live GPK1 fallback identity — and self-verifies it through the same
`verifyAssetGraph` gate as the synthetic contract. The workflow uploads the
tree as the `puttom-ground-graph-*` artifact; committing it to the public app
and registering the slug is a separate, gated publication step. The emitted
frame follows the shared provisional convention and is not a D1 origin
approval.

### What the height model can and cannot say about golf surfaces

```sh
node packages/course-v2/analyse-puttom-derivatives.mjs \
  --out geo_data/course-v2/puttom/analysis/dtm-derivative-probe.json
```

`terrain-derivatives.mjs` derives slope (Horn), ruggedness, priority-flood
depression filling, local relief and closed-depression candidates — pure
functions over bytes already downloaded and verified, so no new source and no
new licence. The probe runs them over the published Puttom LOD0 tiles and is
fully offline: no credentials, no network, reproducible by anyone with the
repo.

**It was written to confirm that a 1 m DTM can find bunkers, and it proved the
opposite.** Bunkers are cut hollows, so the reasoning seemed safe. Measured
over all 41 OSM bunker positions — a source that never entered the height
model — against 256 control points on the same played ground:

| | median relief | 90th pct | maximum |
|---|---:|---:|---:|
| at known bunkers | 0.429 m | 0.66 m | 0.817 m |
| ordinary course ground | 0.273 m | **0.726 m** | 2.114 m |

There is a real shift, and it is useless: ordinary ground's 90th percentile
passes the bunkers' median and all but reaches their deepest, so no depth
threshold separates them. The detector's 28 strongest depressions match none
of the 41 within 12 m, and the median distance from a bunker to the nearest
candidate is 148 m — the detector finds natural hollows at the AOI edges,
because those are the only depressions that stand out. The national DTM is a
smoothed bare-earth grid built from sparse returns; a 5–20 m wide, half-metre
feature does not survive it.

The control is what makes this trustworthy. `reliefSeparability()` therefore
takes control points as a required argument and reports `separable: false`
rather than a number a reader could mistake for a detection rate. The lesson
generalises: **shape cannot deliver a mowing boundary, and here it cannot
deliver a bunker either.** Surface truth needs reflectance — the orthophoto —
or the club's own drawings.

**And the orthophoto is not ours to read yet.** The first authenticated run
returned HTTP 403 on all four `orto-u2-2024` assets, using the same
credentials that read Markhöjdmodell successfully seconds earlier in the same
job. Ortofoto Nedladdning is a separate, free order whose intended USE
Lantmäteriet reviews under GDPR, at
Geotorget: an account can hold complete image metadata and be refused every
pixel, which is precisely what the discovery snapshot shows — `sha256: null`
on every image asset while terrain assets carry real checksums.
`probeOrthoAccess()` now asks that question directly with one bounded range
request per asset, so the answer is a recorded entitlement finding rather than
four GDAL warnings and a bare exit 1, and it distinguishes a 403 from a 503
because only one of those is about the account. The measurement step is
`continue-on-error`: an exploratory probe must never decide whether the
release capture runs, which is exactly what it did on its first attempt.

### Streaming-runtime probe

`?bana=puttom&v2=1&v2stream=1` runs `CourseV2TerrainRuntime` against the
published graph inside the real app: after boot, into a detached scene, behind
its own flag, rendering nothing and selecting nothing. It records the plan's
budget quantities — time to first resident tile, time to a refined active
hole, resident tiles, draw calls, request stats — and compares its CPU heights
against the verified pilot sampler over the ground both cover, so the worker
decode and tile selection are checked against heights that have already been
accepted rather than asserted. Correctness and speed are reported separately:
a run that ran out of time says so.

**A software rasteriser cannot complete this, at any deadline.** A single
`update()` uploads a texture array of 257x257 layers, and under SwiftShader
that one synchronous call can block for minutes — so the probe times out no
matter how long it is given, and its timings are never performance evidence.
Every wait is nonetheless raced against a timer, because a deadline checked
only between frames bounds nothing: the first version parked for 21 minutes
inside an await that a stalled rAF never resolved.

**What the starved run still proved is why the probe exists.** Before it, the
streaming path had never run in a build — every unit test injects its own
loader, so the decode Worker was never exercised. The probe found it dead:
`new Worker(...)` was reached through an alias, which the bundler does not
recognise as a worker, so the ~90-byte entry was emitted verbatim (earlier,
inlined as a base64 data URL) and its own relative import resolved to a file
that was never built. The worker died on load, every decode job hung forever,
and nothing threw anywhere — 0 of 18 tiles resident after 180 s, two jobs
"running" that never finished. The construction is now the literal form a
bundler detects, and `check-app-build` asserts the emitted worker is real and
carries no unresolved imports.

### Authoritative surface intake boundary

`authoritative-surface-source.mjs` is the separate fail-closed route for future
club CAD/GIS, controlled survey or approved orthophoto-derived polygons. Its
canonical EPSG:5845 contract requires an approved source-manifest entry,
approved derivative licence, immutable upstream checksum, capture/acquisition
dates, measured accuracy, human review, stable feature ownership and valid
closed non-self-intersecting multipolygons. It rejects migration-only, OSM,
GolfTraxx, legacy imagery and course-guide data as sole surface authority.

The matching Node compiler proves deterministic, shared-edge-identical surface
BVCH output but creates no preview descriptor and writes nothing. It uses the
approved canonical origin directly, requires an exact terrain-frame binding,
replaces rather than merges the migration layer, and stores zero only for mow
and environmental fields explicitly declared unmeasured. Puttom's current
source manifest intentionally fails this gate until its origin, source asset,
accuracy and redistribution decision are approved.

### Puttom authoritative-surface preflight

```sh
pnpm course-v2:puttom-surface-preflight
pnpm course-v2:puttom-surface-preflight -- --source /absolute/path/reviewed-puttom-surfaces.json --require-ready
```

The first command is intentionally successful while reporting the current
release blockers. It does not promote the retained preview. The second command
adds a reviewed `authoritative-surface-source-v1` document and fails its process
only when `--require-ready` is requested. In both cases it reports the exact
canonical-origin, terrain-frame, source licence/checksum/date/accuracy and
review blockers in machine-readable JSON. A provisional terrain preview can
never make this check ready; an approved ground manifest and terrain frontier
remain required for publication.

## D4 terrain-pyramid foundation

`terrain-pyramid.mjs` compiles an aligned north-to-south Float64/Float32 height
grid into deterministic overlapping terrain tiles. LOD 0 is the finest level;
each following level samples the even vertices of its child level so a shader
can geomorph with bilinear even-sample reconstruction and no extra morph
payload. Every tile has `tileSegments + 1` samples, which makes adjacent edge
samples overlap.

All tiles in one ground use the same centimetre quantization origin. Shared
edges therefore contain identical uint16 values instead of independently
rounded heights that can form hairline cracks. Per-tile geometric error is the
maximum residual against the 1 m master plus the conservative quantization
bound. `TerrainPyramidSampler` selects the finest resident tile and falls back
through the same LOD hierarchy, providing the CPU height path needed by camera,
water, ball and object placement on both WebGPU and WebGL2.

`terrain-compiler-node.mjs` turns that pyramid into independently verified,
content-addressed `BVCH` resources. It emits a dedicated whole-ground shell,
all regular LOD tile references and the exact fields required by a ground-v2
manifest. Its Float32 reader enforces dimensions, byte order, nodata and a
source-byte budget before allocation; its writer creates immutable hash paths
and refuses to replace an existing path with different bytes. Source grids may
be rectangular: when the regular hierarchy cannot end in one tile, a bounded
rectangular shell is compiled separately for first-visible and CPU fallback.
Authoritative compiler inputs additionally require an independent power-of-two
tile count on each axis. `alignTerrainGridExtent()` expands a required AOI on
the source sample grid and returns the exact inclusive GDAL pixel window. Four
256-segment tiles therefore use 1,025 samples, not 1,024; the extra shared
sample is what makes adjacent 257 x 257 tile edges identical. This alignment
prevents an awkward whole-course extent from degenerating into hundreds of
coarse roots on mobile.

`runtime/terrain-tile-manager.mjs` is the backend-neutral screen-space-error
planner. It derives the verified tile hierarchy, adds hysteresis, forces active
hole detail, emits stable shell/parent/child request priorities and resolves a
non-overlapping resident render frontier. WebGPU and WebGL2 call the same
planner; explicit desktop/mobile quality profiles only change error and tile
budgets. This keeps WebGL2 mobile bounded without creating a second terrain
truth or a separate renderer architecture.

`runtime/terrain-stream-controller.mjs` connects those plans to the existing
verified request scheduler and resource pool. It progresses coherently from
shell to parent to fine tiles, reprioritizes in-flight work, aborts obsolete
camera/hole requests, keeps decoded/GPU resources bounded and applies
exponential retry backoff.

`runtime/terrain-render-data.mjs` performs the GPU preparation in the verified
decode Worker. Two adjacent standard RGBA8 texels store little-endian fine and
even-sample parent uint16 heights plus an upper-octahedral two-component
normal. This uses the same eight bytes per sample as RGBA16UI while avoiding
optional normalized-16 and fragile integer-texture paths on WebGL2 mobile. The
main thread therefore installs a ready-to-upload buffer instead of expanding a
257 x 257 tile into positions and normals. Nodata is rejected before a terrain
pit can be rendered, and the same retained resource supplies the CPU height
sampler.

`apps/golf/src/engine/v2-terrain-batch.mjs` is the Three.js r185 adapter shared
by WebGPU and the renderer's WebGL2 backend. Regular tiles use one grid/index
topology, one partially updated `DataArrayTexture` and one geometry-instanced
draw.
The draw uses `InstancedBufferGeometry` with a regular `Mesh`, avoiding r185's
redundant identity-matrix binding because two packed instance buffers already
contain the full tile transform. This also keeps the layout below WebGPU's
vertex-buffer limit.
New child tiles start at their parent surface and geomorph to full detail;
shared boundary samples are primary seam control and a bounded skirt remains
the final crack guard. The desktop/mobile tile budgets set texture-array
capacity before allocation.

`apps/golf/src/engine/v2-terrain-runtime.mjs` wires that batch to the verified
asset loader, SSE manager and stream controller, converts the Banvy camera back
to EPSG:5845, forces active-hole tiles, frustum-culls requests and exposes the
finest ready CPU height. `v2-terrain-proof.html` is a non-production shader
harness: without input it renders an explicitly labelled synthetic fixture;
with a strict provisional preview descriptor it bounds, hashes, decompresses
and verifies real BVCH tiles before rendering. `terrain-preview-node.mjs`
creates that ephemeral bundle, while `capture-terrain-preview.mjs` refuses
synthetic, non-provisional, blank or missing WebGL2/WebGPU captures. Its acceptance
gate combines verified retained tiles, a positive one-draw topology and measured
PNG foreground; r185 fallback `renderer.info` counters remain diagnostic because
headless WebGL2 can report zero triangles after presenting visible geometry.
Actions uses explicit SwiftShader WebGPU/WebGL2 adapters for deterministic shader
parity only; hardware performance remains a separate reference-device gate.
`capture-puttom-app-preview.mjs` separately exercises the real app in mobile and
desktop forced-WebGL2 plus desktop WebGPU. It hides the HUD before presentation
analysis, rejects uniform central frames, requires the 16-tile provisional
surface frontier, inventories each verified tile's primary/secondary ID union
and requires non-zero signed/current coverage for every mandatory class. The
primary-only shader histogram remains diagnostic. It uses a bounded RGBA8
active-pipeline readback for WebGPU and strictly removes Three r185's 256-byte
row padding before PNG encoding. Its report retains the bounded raw, tight and
encoded byte counts plus the padding decision, not the pixel buffer.
A readback never claims that the headless or hardware canvas presented pixels.
`node packages/course-v2/check-renderer-build.mjs` bundles the complete path
against the installed Three.js r185 API. The retained fixed-frontier adapter is
now live behind the explicit flag after its WebGPU/forced-WebGL2 proofs. The
generic `CourseV2TerrainRuntime` remains unselected until real public course and
ground manifests, a coarse shell, a full parent hierarchy and an approved
canonical origin exist.
