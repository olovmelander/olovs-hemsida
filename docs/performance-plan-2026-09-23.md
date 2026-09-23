# Performance audit and plan — 23 September 2026

Measured on the owner's machine with the real GPU. This updates
[performance-plan-2026-09-18.md](performance-plan-2026-09-18.md) and its review.
The three CPU batches since then
([reconstruction](performance-reconstruction-2026-09-22.md),
[tree updates](performance-frame-stability-2026-09-22.md),
[terrain plans](performance-terrain-plans-2026-09-22.md)) were measured on
software rendering and saved fractions of a millisecond. The frame-rate problem
is on the GPU, plus a few specific CPU stalls, and none of it had been measured
on hardware since the painted Hero trees landed.

## 1. Summary

- **Hero tree crowns are about three quarters (72–83%) of the GPU frame** in
  every tree-heavy view (Puttom hole 12 orbit: 41 of 51 ms at 1080p).
  Terrain, water, sky, bloom and everything else together are 5–10 ms.
- **Most of that is spent on trees nobody can see in detail.** 15–37% of the
  drawn Hero crowns are entirely off-screen, because culling is per 128 m cell.
  Of the on-screen ones, 73–98% are under 32 px tall and mostly 500–2000 m
  away along other holes. Each still draws ~4,500 sub-pixel triangles under 4×
  MSAA.
- **Two per-pixel noise calls in the foliage shader cost 20–25% of the whole
  frame.** They depend only on the tree template's own vertex positions, so
  they can be precomputed with no visible change.
- **In some views the shadow map is redrawn every frame at rest.** A
  ±1e-13 m float jitter in the sun position defeats the on-demand shadow
  check. That costs 5 ms at Puttom's first tee, and the `det=1` harnesses
  cannot see it.
- **Flights stall on the main thread:** each streamed terrain tile is prepared
  there (30–60 ms), and every hole change triggers 14–36 shader builds, mostly
  for overlay materials created anew for each hole. A worker path for the
  terrain already exists behind a flag. It removes those spikes and also saves
  1.3 s at boot.
- **On a phone-class CPU the shadow pass costs more than the scene:** three.js
  recomputes a cache key for every shadow caster, every frame (21 ms/frame at
  4× slowdown). Flags (4.4 ms) and the minimap (2.2 ms) follow.
- **Loading:** Veckefjärden opens in 15.6 s on localhost, 20.7 s at 50 Mbps
  and 67 s in the phone proxy (24.6 MB). The Sept 18 loading phases remain the
  right structure; today's numbers re-rank them below.

The exact fixes (Phase 1) should take the heavy tee views on the RTX 3070 from
27–39 ms to about 15–27 ms. Reaching 60 fps in the heaviest views and on
phones needs one decision from the owner about distant Hero crowns (Phase 2).
Its measured ceiling is 2–4× in those views.

## 2. Method, and two measurement traps

- Machine: NVIDIA RTX 3070 Laptop (driver 32.0.15.7247), Ryzen 7 5800H,
  Windows 11, Chrome 153.0.8010.52, WebGPU, `BANVY_GPU=1`.
- Build: current `main` (`9046f6e6`), built into a private output folder.
  Diagnostic questions used an unminified copy with read-only hooks and two
  URL toggles (`nonoise`, `msaa`). Nothing in `apps/` was changed.
- Normal use: `qualitylock=1` without `det=1`, high quality, 1920×1080 at
  DPR 1. Cost is measured with vsync lifted; what a visitor sees is measured
  with vsync on. GPU time comes from timestamp queries. They resolve only
  every ~66 frames, so windows are ≥ 300 frames.
- Phone proxy: `q=lo`, 412×915 (390×844 @2× for boot), Chrome CPU throttling
  4×, 20 Mbps / 80 ms. It is a proxy, not a phone.
- At the start of the session the owner's own app tab held the GPU at 100%
  (110 W). All numbers here were taken after it was closed.

**Trap 1 — `det=1` makes frames look slower than they are.** Under `det`,
`poseFlagCloths` skips its distance culling and `stepFlagDynamics` takes the
cold 24-iteration path for all 18 flags every frame. That is 77% of the main
thread (`relaxFlagClothPose`), and it gives a flat ~40 ms frame at every
Puttom view. Normal use at Puttom's first tee is 27 ms. Every frame time taken
by `frame-time.mjs` or the boot profiler's first frames includes this.

**Trap 2 — `det=1` also hides a real cost.** The sun-jitter bug in §3.4 does
not occur under `det`, so harnesses report shadows as skipped at rest while
visitors pay for them every frame.

## 3. Frame rate

### 3.1 GPU by component

Puttom, 1080p, normal use, GPU ms (timestamps; rAF agrees where GPU-bound):

| View | As is | Sun jitter fixed | Hero crowns hidden | Terrain hidden | Terrain only |
|---|---:|---:|---:|---:|---:|
| Hole 1 tee, golden | 27.1 | 22 | 6.2 | 21.8 | 5.0 |
| Hole 12 orbit, golden | 51.4 | 51.5 | 10.2 | 46.0 | 6.9 |
| Hole 14 tee, golden | 38.7 | 38.4 | 6.6 | 35.4 | 4.1 |
| Hole 7 overhead, noon | 23.8 | 23.2 | 5.3 | 20.5 | 4.1 |

Trunks, the impostor tier, the far vista and water each changed the frame by
less than 1 ms. At 960×540 the hole 12 orbit takes 30.7 ms, 4.8 ms with the
crowns hidden. So the crowns are about 21 ms of fixed geometry work plus
20 ms that scales with pixels at 1080p.

### 3.2 Where the drawn Hero crowns are

Instances in the Hero crown meshes at each view. "Off-screen" means the
tree's bounding sphere is outside the view frustum. Height is the projected
crown size at 1080p.

| Course, view | Hero crowns drawn | Off-screen | On-screen < 16 px | On-screen < 32 px | On-screen > 500 m |
|---|---:|---:|---:|---:|---:|
| Puttom 1 tee | 4,729 | 26% | 37% | 87% | 64% |
| Puttom 12 orbit | 11,799 | 19% | 87% | 98% | 97% |
| Puttom 14 tee | 8,183 | 15% | 72% | 97% | 85% |
| Puttom 7 overhead | 4,418 | 37% | 19% | 89% | 90% |
| Puttom 5 tee | 4,555 | 26% | 29% | 73% | 30% |
| Veckefjärden 1 tee | 6,332 | 25% | 32% | 88% | 66% |
| Veckefjärden 14 tee | 4,482 | 27% | 74% | 96% | 94% |
| Veckefjärden 9 orbit | 6,810 | 23% | 69% | 95% | 86% |
| Veckefjärden 5 overhead | 5,144 | 30% | 58% | 98% | 100% |

The zone rule makes every tree within 300 m of *any* hole line Hero. From
any tee, that includes the corridors of holes 1–2 km away. Since 21 September
those zone-B trees are Hero (4,032–4,500 triangles) instead of Full
(~1,700). Together with the painted crowns, this took the golden views from
~10 M triangles per pass on 4 September to 30–65 M today.

### 3.3 What inside a crown costs

Upper bounds by removal, sun jitter fixed, frame ms at 1080p:

| Change (diagnostic only) | Puttom 12 orbit | Puttom 1 tee | Puttom 14 tee |
|---|---:|---:|---:|
| Baseline | 50.6 | 23.1 | 39.9 |
| Wind sway off | 50.8 | 23.0 | 39.8 |
| Crown triangle order reversed | 51.0 | 23.1 | 39.5 |
| **Foliage noise removed** | **40.3** | **17.7** | **30.3** |
| MSAA off (not proposed) | 27.2 | 15.4 | 21.7 |
| MSAA off and noise removed | 22.2 | 11.9 | 17.2 |

- Vertex maths and in-crown draw order do not matter.
- The two `mx_noise_float` calls in `paintedFoliageColour`
  (`engine/ghibli-foliage-material.mjs:35, 43`) cost 20–25% of the frame. The
  same test on Veckefjärden gives hole 1 tee 28.1 → 21.2 ms and hole 9 orbit
  32.5 → 25.6 ms. On Visby it gives hole 10 orbit 29.7 → 19.7 ms and hole 6
  tee 12.1 → 7.7 ms.
- 4× MSAA doubles the cost of sub-pixel foliage. A triangle smaller than a
  pixel is shaded whenever it touches any of four samples, not just the pixel
  centre. MSAA stays: it cut tree shimmer 4× on 10 September. It explains why
  distant Hero crowns are so expensive.

### 3.4 The shadow map is redrawn at rest

At Puttom's first tee, `V3D.shadowRest()` records 300 renders in 300 frames at
rest, with the reason `sun`. `sun.position` alternates by ±1.1e-13 m every
frame, because OrbitControls re-clamps its target each update
(`target.sub(cursor).clampLength(...).add(cursor)`), which flips the last bits
of world-scale coordinates. `shadowRest` (`main.js:7694`) compares positions
exactly. Whether it happens depends on the view's coordinates: hole 1 tee
yes, hole 12 orbit no. Where it happens it costs 5 ms (27.1 → 22 ms). The
shadow pass also draws ~29 M triangles.

### 3.5 Flights

Veckefjärden tour, 1080p, vsync, 30 s: **24.6 fps**, frame p50 38.4 ms, p95
59, p99 75, max 407. 58 frames were over 50 ms and 7 over 100 ms. GPU p50 was
36.7 ms, with 62 M triangles per frame including the shadow map, which is
redrawn every flight frame.

Stall attribution (45 s, sampled CPU profile against frame boundaries): 12.6%
of frames are over 50 ms. Inside them:

- `prepareTerrainRenderData` and `terrainNormal` run on the main thread for
  each streamed tile, 30–60 ms per tile, 2.3 s in total. With the existing
  `?startup=terrain-worker` they leave the main thread: frames over 50 ms
  drop 176 → 137 and p99 72.7 → 58.2 ms (one 45 s run each). Only the
  water-bed carve (34 ms in total) stays on the main thread.
- Shader builds after boot: each hole change makes 14–36 node builds and 1–12
  new pipelines, 140 builds within minutes. `buildStrategy()` allocates new
  materials for the tactical guide on every hole (on by default), plus lines
  and sprites. The longest frames are mostly GPU-side waits (130–230 ms
  idle), which fits pipeline compiles and uploads.
- The rest is GPU-bound frames, i.e. the crowns.

### 3.6 CPU on a phone-class processor

Veckefjärden flight at `q=lo`, 412×915, 4× CPU slowdown, per frame:

| Cost | ms/frame | Cause |
|---|---:|---|
| Shadow pass bookkeeping | 21.5 | three.js recomputes `getCacheKey` per caster (see below) |
| Main pass encoding | ~8–10 | ~120–300 draws |
| Flags | 4.4 | cloth solve and `computeVertexNormals` |
| Minimap | 2.2 | full canvas redraw with text every frame |
| Visibility (terrain + trees) | 1.9 | |
| Terrain streaming | 1–2 | tile preparation |

The frame interval is 43 ms, CPU-bound. The GPU also receives 21.6 M
triangles per frame (26.5 M at most), because the Hero zone rule is the same
at low quality.

The shadow bookkeeping has one cause. three's shadow pass copies each
caster's `alphaTest` onto one shared override material, and three's
`Material.alphaTest` setter bumps `version` whenever the value crosses zero.
Foliage (0.5) interleaves with trunks, terrain and buildings (0), so the
version changes many times per frame. Every following caster then walks its
node graph for a new key (`getMaterialCacheKey`, `customProgramCacheKey`,
`_getNodeChildren`). three 0.186.0 is the latest release (npm, today).

On the desktop the same flight spends 10.6 ms per frame in `frame()`
(shadow bookkeeping 3.7, flags 3.1) and waits ~23 ms on the GPU.

### 3.7 The four candidates from the last session

| Candidate | Now | Status |
|---|---|---|
| Tree tier updates | 0.1 ms/frame at rest, 0.6 ms at 4× CPU | done (3ec71683), negligible |
| Dirty-range uploads | 0.2 MB and 128 small writes per frame at rest | no problem. `writeBuffer` time in profiles is the CPU waiting on the GPU |
| Terrain planning | 0.1–0.65 ms/frame | done (a8240c22), small |
| Minimap redraw | 0.5 ms desktop, 2.2 ms at 4× CPU | still open, worth doing for phones (1.9) |

## 4. Loading

| Veckefjärden | First frame | Ready marker |
|---|---:|---:|
| Desktop, localhost | 15.6 s | 17.7 s |
| Desktop, 50 Mbps / 40 ms | 20.7 s | 22.9 s |
| Phone proxy (4× CPU, 20 Mbps / 80 ms, `q=lo`) | 66.9 s | 69.5 s |

Puttom opens in 13.4 s and Visby in 8.7 s on localhost.

Stages for Veckefjärden, desktop / phone proxy, in seconds: terrain data
1.9 / 14.3, renderer 0.25 / 1.2, terrain 3.2 / 9.5, fairways 1.25 / 5.6,
water 1.0 / 5.6, **forest 4.2 / 17.7** (far vista 1.5 / 5.9, vegetation wait
1.0 / 2.0, reeds 0.5 / 3.0, ground cover 0.6 / 2.4), flags 0.4 / 2.0, light
0.85 / 3.2, first view 2.2 / 5.8 (GPU compile). The first frame then takes
0.77 s.

- 24.6 MB in 93 requests: terrain packages 19.9 MB, models 2.7 MB, other
  binaries 1.4 MB (including the 1.1 MB flag cloth), JS 0.6 MB, JSON 0.5 MB.
- Boot creates 161 pipelines (101 synchronously) from 147 node builds.
- `?startup=terrain-worker`: 14.6 s against 15.9 s, with the terrain stage
  2.1 s against 3.3 s. Single runs, consistent with the stage split.

## 5. The plan

### Phase 0 — measurement (1 day)

0.1 Promote this session's probes to `tools/`: normal-use GPU ablation, Hero
    census, crown experiments, flight timing, stall attribution and post-boot
    build log (currently in the local `output/perf-2026-09-23/`).
0.2 Every timing tool defaults to normal use (`qualitylock=1`, no `det`).
    `det` is for pixel captures only. Refuse a timing run when GPU utilisation
    is above 10% beforehand.
0.3 This document's tables are the baseline.

### Phase 1 — exact fixes (1–2 weeks, no visible change)

Each item lands alone, with before/after numbers from Phase 0 tools and the
usual identity proofs: fingerprints, goldens at `det=1`, and shadow-map
readback where shadows are involved.

| # | Fix | Where | Measured / expected effect | Proof |
|---|---|---|---|---|
| 1.1 | Key the shadow refresh on the integer snap cell, fit and sun direction instead of float positions | `placeSun`, `shadowRest`, `main.js:7694–7768` | −5 ms at affected rest views | shadow readback identical |
| 1.2 | Take the two foliage noise terms off the per-pixel path. Fastest: precompute them per template vertex as one `vec2` attribute. Closest: a baked 3D noise texture. The shader samples the wind-swayed position within 140 m, and only the texture keeps that | `ghibli-foliage-material.mjs` | −20–25% GPU in tree views (upper bound measured) | close-up Hero captures ≤ 2/255 (per-vertex) or ≤ 1/255 (texture), goldens |
| 1.3 | Finer tree culling: 64 or 32 m cells, or a per-tree sphere test in boundary cells | `TREE_LOD.cell`, `updateTreeTiers` | removes the 15–37% off-screen crowns, est. 3–6 ms in heavy views | slot/state parity, goldens |
| 1.4 | Stop the shadow-pass cache-key churn: draw alpha-tested casters as one group (`renderOrder`), or a small local three patch, reported upstream | tree tiers, terrain, `pnpm patch` | −3.7 ms/frame desktop flight, ~−15 ms at 4× CPU | pixel identity |
| 1.5 | Limit shadow casters to the shadow box: separate shadow instance lists on a shadow-camera layer, intersected with today's visible cells | tree tiers, terrain batch | est. 3–6 ms per moving frame, needs measurement | shadow readback identical |
| 1.6 | Terrain preparation in the worker by default (the flag exists) | `v2-graph-terrain.mjs:560` | flight >50 ms frames 176 → 137, p99 73 → 58 ms; boot −1.3 s | byte-identical render data, mobile check |
| 1.7 | Reuse tactical-guide, line and sprite materials across holes; compile them at boot | `buildStrategy`, `main.js:9045` | removes 14–36 builds per hole change | goldens |
| 1.8 | Flags: do not pose flags outside the frustum (clocks keep running); fewer solver iterations for flags a few px tall | `poseFlagCloths`, `main.js:6337` | 2.5–3.3 ms desktop, 4.4 ms at 4× CPU | off-screen skip identical; size rule sub-pixel |
| 1.9 | Minimap: redraw only when its inputs change; cache the puck | `drawMini`, `main.js:10260` | 0.5 ms desktop, 2.2 ms at 4× CPU | canvas pixels identical |
| 1.10 | Allow the reduced 129² grid for distant WebGPU tiles when measured error is sub-pixel | terrain runtime stride policy | terrain is 4–7 ms; est. 1–3 ms | pixel diff; the planner already accounts render error |

#### Phase 1 progress

- **1.1 landed.** `placeSun` keys the light on its integer snap cell
  (`engine/shadow-cell.mjs`: texel cell in the light's right/up plane, the
  depth along the sun in the same texel, the fit and the sun direction). The
  same cell leaves `sun.position` bit-identical, so orbit-target float noise no
  longer requests a render. `?shadowcell=0` is the before. Unit-tested; the
  5 ms saving at Puttom's first tee still has to be measured on the RTX 3070.
- **1.2 landed as per-vertex evaluation, not a per-template attribute.** In
  three 0.186 the fragment's `positionLocal` is the final vertex-stage value:
  after `instancedMesh()` applies the instance matrix and after the wind
  `positionNode`. So the noise is sampled in instance (world) space and differs
  from tree to tree; a template attribute would give every tree of a variant
  the same pattern. The two noise terms are now one `vec2` varying computed in
  the vertex shader from that same position (confirmed in the generated GLSL).
  Isolated SwiftShader renders of all five Hero species, pixel vs vertex:
  mean 0.11–0.31/255 on the tree, max 2–8/255. The oak exceeds the 2/255
  target on 3–4% of its pixels (sun-dab bands on the lit tops); side by side
  it is not visibly different. `?foliagenoise=pixel` is the before. The GPU
  saving still has to be measured on the RTX 3070.

### Phase 2 — owner decision: distant Hero crowns

The zone rule in CLAUDE.md says trees on or around the course do not change
detail with camera distance. That rule is why 73–98% of on-screen Hero crowns
are drawn with ~4,500 sub-pixel triangles under 4× MSAA.

Measured ceiling, using the existing screen-size machinery (trees below 24 px
become their own Hero-baked impostor, noise removed, 1080p):

| View | Today | Ceiling |
|---|---:|---:|
| Puttom 12 orbit | 50.9 ms | 12.6 ms |
| Puttom 14 tee | 39.2 ms | 9.8 ms |
| Puttom 1 tee | 22.3 ms | 10.8 ms |
| Veckefjärden 1 tee | 28.1 ms | 10.8 ms |
| Veckefjärden 9 orbit | 32.5 ms | 13.4 ms |
| Visby 10 orbit | 29.7 ms | 9.6 ms |

This test also promotes some nearby outer-zone trees to Hero, which a real
policy would not do.

Proposal: keep today's rule for everything near the camera. Let a zone A/B
tree use its Hero-baked impostor only while it projects below ~16–24 px, with
the existing hysteresis, dwell and 0.3 s crossfade. The case that this is
*equally good or better*: the distant glitter measured on 10 September comes
from sub-pixel crown gaps, and a mip-mapped impostor twinkles less.

Evidence for the owner's eye before anything ships:

- side-by-side videos of the golden views and a full tour flight
- the pop meter's dolly, and switch counts from the flight probe
- `glitter-meter.mjs` before and after

Without this decision, phones stay geometry-bound (21.6 M triangles per frame
in flight at low quality) whatever else lands.

### Phase 3 — loading (2–4 weeks; the Sept 18 phases, re-ranked)

3.1 Terrain worker (1.6): −1.3 s desktop.
3.2 Compile while the forest is planted, and include the shadow and bloom
    pipelines in the opening preparation. Boot has 161 pipelines, a 2.2 s
    compile and a 0.77 s first frame. Also reduce distinct pipelines.
3.3 Overlap CPU construction with the terrain and vegetation waits (Sept 18,
    2.1).
3.4 Decode pool and need-ordered startup packages (Sept 18, L5/L6). 19.9 of
    the 24.6 MB are terrain packages.
3.5 Prepared construction for phones (Sept 18, phase 3). The phone proxy
    spends 17.7 s planting the forest, 9.5 s on terrain and 5.6 s each on
    fairways and water. CPU work cannot be overlapped away on a phone.
3.6 Cached reopen and session reuse (Sept 18, 5.1/5.2).

### Phase 4 — devices

An iPhone 12-class Safari and a Galaxy A54-class Chrome: cold, cached, a tour,
thermal state. Desktop emulation does not stand in for either.

## 6. Expected results

Projections from the ablations above, not measured implementations. Savings
overlap, so they are not added naively.

| | Today | After Phase 1 | + Phase 2 |
|---|---:|---:|---:|
| Puttom 1 tee, GPU ms at 1080p | 27 | ~15–16 | ~10 |
| Puttom 12 orbit | 51 | ~35 | ~12–15 |
| Puttom 14 tee | 39 | ~27 | ~10 |
| Veckefjärden tour, median frame | 38 ms (25 fps) | ~26–28 ms | ~15 ms |
| Veckefjärden tour, frames > 50 ms | 12.6% | a few % | < 1% |
| Veckefjärden desktop open, localhost | 15.6 s | ~14 s | Phase 3: ~9–10 s |
| Phone-proxy CPU frame in flight | 43 ms | ~20–25 ms | GPU-bound until Phase 2 |

## 7. Decisions for the owner

1. Distant Hero crowns (Phase 2): the largest remaining lever, and the only
   route to 60 fps in the heaviest views and to a smooth phone.
2. Shadow casters (1.5): today, trees just outside the view cast no shadow
   into it, and their shadows pop in at the screen edge. Limiting casters to
   the shadow box can keep that exactly, or also correct it (a visible
   change).
3. Foliage noise (1.2): per-vertex precomputation (fastest, ≤ ~2/255) or a
   3D noise texture (≤ 1/255, slightly slower).
4. MSAA stays at 4×. It is recorded here only as the reason distant foliage is
   expensive.

## 8. Reproduction

Probes are in the local, git-excluded `output/perf-2026-09-23/`:
`gpu-ablation.mjs`, `tree-ablation.mjs`, `hero-census.mjs`,
`crown-experiments.mjs`, `views-gpu.mjs`, `flight-time.mjs`,
`profile-frame.mjs`, `profile-flight.mjs`, `stall-attribution.mjs`,
`midflight-builds.mjs`, `upload-census.mjs`, `sun-drift.mjs`. They need
`BANVY_GPU=1`.

The diagnostic build is `vite build --minify false` into a scratch folder,
with read-only hooks added to the built `main-*.js`: `V3D.scene`, `renderer`,
`camera`, `treeLod`, the `nonoise` and `msaa` URL toggles, and a node-builder
log in `three.webgpu-*.js`. Existing tools used: `frame-time.mjs`,
`boot-profile.mjs`, `boot-requests.mjs`.
