# Banvy course-v2 asset graph

This package is the D3 distribution-format and streaming-loader foundation. It
is an offline/runtime contract shared by WebGPU and WebGL2. The production
selector now has an isolated opt-in validation path, but the v2 terrain renderer
is not enabled. `GPK1` remains the only rendered course path until a real pilot
and the D3/D4 streaming gates pass.

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

The five JSON Schema documents in `schemas/` (one shared type library and four
root/ground/course/chunk contracts) describe the interchange contract. The
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
scale; the 1 cm test profile has a maximum quantization error of 5 mm. Nodata,
row direction and column direction are explicit, never inferred.

## Executable synthetic gate

```sh
node --test packages/course-v2/course-v2.node-test.mjs
node --test packages/course-v2/terrain-pyramid.node-test.mjs
node --test packages/course-v2/terrain-compiler.node-test.mjs
node --test packages/course-v2/runtime/runtime.node-test.mjs
node --test packages/course-v2/runtime/terrain-tile-manager.node-test.mjs
node --test packages/course-v2/runtime/terrain-stream-controller.node-test.mjs
node packages/course-v2/check-synthetic.mjs
```

The fixture creates two courses, one shared ground, a coarse shell, two terrain
tiles and two separate routing chunks entirely in memory. Its routing accuracy
is deliberately `unrated` and stroke indexes are unverified/not applicable; a
test fixture cannot accidentally promote third-party geometry to surveyed
truth.

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

The player keeps this code out of its default critical path. `?v2=1` dynamically
loads the v2 selector, validates any published root/course/ground graph and then
uses the root's exact GPK1 fallback while the D4 renderer remains unavailable.
`?v2=require` fails closed on a missing, corrupt, unsupported or currently
unrenderable v2 graph. No synthetic fixture is copied into `public/`, and a
missing public v2 root is therefore an honest 404 rather than fake production
data. The debug chunk is excluded from the PWA precache and a production-build
gate keeps it below 64 KiB and out of both initial HTML and the service worker.

The next D4 work package is one retained real coarse shell and active-hole
visual proof behind the existing URL flag. Authenticated D2 terrain access and
the backend-common renderer adapter are now proven independently;
authoritative publication still waits for D1 origin approval and a tile-aligned
retained pilot build.

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
decode Worker. One RGBA16UI texel stores the fine uint16 height, its
even-sample parent height and an upper-octahedral two-component normal. The
main thread therefore installs a ready-to-upload buffer instead of expanding a
257 x 257 tile into positions and normals. Nodata is rejected before a terrain
pit can be rendered, and the same retained resource supplies the CPU height
sampler.

`apps/golf/src/engine/v2-terrain-batch.mjs` is the Three.js r185 adapter shared
by WebGPU and the renderer's WebGL2 backend. Regular tiles use one grid/index
topology, one partially updated `DataArrayTexture` and one `InstancedMesh` draw.
Two packed instance buffers keep the layout below WebGPU's vertex-buffer limit.
New child tiles start at their parent surface and geomorph to full detail;
shared boundary samples are primary seam control and a bounded skirt remains
the final crack guard. The desktop/mobile tile budgets set texture-array
capacity before allocation.

`apps/golf/src/engine/v2-terrain-runtime.mjs` wires that batch to the verified
asset loader, SSE manager and stream controller, converts the Banvy camera back
to EPSG:5845, forces active-hole tiles, frustum-culls requests and exposes the
finest ready CPU height. `v2-terrain-proof.html` is a non-production synthetic
shader/build harness; `node packages/course-v2/check-renderer-build.mjs` bundles it against the
installed Three.js r185 API. The production selector still reports
`rendererAvailable: false`: activation waits for a retained real pilot,
WebGPU/forced-WebGL2 screenshots and approved canonical origin.
