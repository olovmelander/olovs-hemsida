# Performance audit plan: review and first findings (2026-09-18)

This reviews the plan "Performance audit with unchanged visuals" and adds
findings from a first measurement pass and three code sweeps. Nothing in the
app was changed. Every proposed fix keeps the picture identical: same terrain,
trees, shadows, water, resolution and animation.

Measured on this PC: Chrome, NVIDIA RTX 3070 Laptop, WebGPU, the production
build in `apps/golf/dist` (source revision `7e1e0e3d3adb`, which equals the
current working tree), painted look, `q=hi`, no network throttling. Raw
evidence is in `output/performance-audit/`. Single runs, so treat the numbers
as sizes, not as p75.

## 1. What the first pass measured

| Course | Boot total | Ready marker | Largest stages |
|---|---:|---:|---|
| Veckefjärden | 20.2 s | 22.6 s | terrain 5.8 s, forest 5.1 s, first view 2.4 s |
| Puttom | 15.9 s | 18.9 s | terrain 5.6 s, forest 4.8 s, first view 2.0 s |
| Visby | 21.3 s | 24.8 s | **water 6.3 s**, forest 4.8 s, terrain 4.4 s, first view 3.5 s |

Frame time, Puttom, uncapped, 1600 x 900 (`tools/frame-time.mjs`):

| View | CPU median / p95 | Triangles | Draws |
|---|---:|---:|---:|
| Hole 1 tee, golden | 30.9 / 56.4 ms (GPU 40.9 ms) | 37.5 M | 295 |
| Hole 12 tee, golden | 23.9 / 72.7 ms | 41.5 M | 333 |
| Hole 12 orbit, golden | 27.6 / 49.3 ms | 39.6 M | 325 |
| Hole 7 top, noon | 6.3 / 33.2 ms | 15.1 M | 118 |

The tee views run near 30 fps on this GPU. `docs/puttom-performance-status.md`
recorded about 10 M triangles and over 100 fps for the same views on
2026-09-04, before the authored painted trees. The census
(`census-puttom-h1.txt`) shows where it goes: painted crowns at 1,500 to 3,750
triangles each are about 10 M per pass, the terrain is about 5 M per pass
(every tile is the same 257 x 257 grid whatever its level), and the shadow
pass draws both again.

## 2. Findings the plan does not yet contain

Ranked separately for loading and smoothness. "Measured" means from the runs
above. "Read" means from code, not yet timed.

### Loading

**L1. The prepared ground colours and prepared water are rejected on the
current build, and nothing reports it. Measured.**
All three profiles show `preparedTint: false` and `prepared false` for water.
The prepared files are bound to a hash of all of `main.js`, `engine/`,
`loader/` and `packages/course-v2` (`tools/course-source-revision.mjs`). Any
edit there, including HUD work in `main.js`, expires every course's prepared
data. The last bake predates several such commits. The Pages workflow builds
and deploys with no bake and no check, so the live site very likely runs the
slow path too. Cost: 1.5 to 2.2 s of tint work plus about 0.5 s of water on
desktop, and the startup doc measured the tint step at 11.7 s under 4x CPU
slowdown. Fix, in order:
1. A gate (`tools/check-prepared-current.mjs`) that computes the identities
   for the built revision and fails, or at least warns loudly in the deploy
   log, when the catalogue does not match.
2. Narrow the revision to the modules the tint and water calculations can
   reach. `groundAt` and `vistaGround` live in `main.js`, so this means
   moving them into an engine module first. Exact output, moderate effort.
3. Re-bake as a release step.

**L2. The main thread is idle for about 10 s of Puttom's boot. Measured.**
Bucketing the CPU profile per second (`cpu-puttom.cpuprofile`): 4 s idle while
waiting on the terrain worker, first frontier and backend preflight, then 6 s
idle during shader compilation and the GPU completion wait. Between them run
6 s of forest construction, strictly in series. Visby shows 3.4 s idle. Fixes:
- Run construction that only needs the CPU ring sampler (far vista, shore
  field, reed lattice, species templates, water sheets, roads) during the
  `terrainV2.prepare` wait. All placement is hash-based, so order of execution
  does not change results as long as the order of pushes is kept.
- Start `compileAsync` for branches that already exist (terrain, water, roads,
  landmarks, sky) while the forest is being planted, and keep the final
  preparation pass as the gate. Also compile the shadow and post pipelines,
  which are still built inside the first frame (first frame 0.85 to 1.7 s).
Expected: 3 to 6 s on desktop. Less on a phone, where the CPU is the limit.

**L3. Visby spends 4.1 s in one function. Measured.**
`waterShoreDistance` (`engine/water-shore.mjs`) calls `ringSDIndexed` with no
cutoff for every subdivided sea vertex. For a vertex far offshore the index's
growing-square search expands across the whole grid. The existing spans
attribute under 1 s of the 6.3 s water stage, so this was invisible. A cutoff
would change the interpolated shore ramp, so the exact fixes are a
nearest-segment tree for unbounded queries (same per-segment formula, same
minimum), or adding the per-vertex shore distance to the prepared water file.
Lidingö and Norrfällsviken should be checked for the same cost.

**L4. The painted tree assets load as 21 serial requests, late. Read.**
`engine/ghibli-trees.mjs:202-241` awaits the manifest, then each atlas and GLB
in turn (2.75 MB), starting only when the forest stage begins
(`main.js:4357`). The wait is recorded inside the span named "reeds", which is
why Visby shows 0.88 s of "reeds" for zero reeds. Fix: start at boot, fetch in
parallel, assemble in the same order. About 1 to 1.5 s at 40 ms latency, about
3 s at 80 ms.

**L5. One decode worker serves everything. Read.**
`engine/course-startup.mjs:5` creates one worker; rings, frontier tiles, 492
vegetation chunks and background verification queue on it without priority.
The decode counter reads 1,055 to 1,106 for 962 chunks, so 100 to 150 chunks
are decoded twice after eviction from the 16 MiB cache. Each result is also
deep-copied again on the main thread (`course-chunk-source.mjs:173-177`), and
each terrain chunk is hashed twice (`startup-decode.mjs:21-24`). Fix: a pool
of 2 to 4 workers with a priority queue, no second copy for read-only
consumers. About 1 to 2 s.

**L6. Package byte order is the reverse of need order. Read.**
`tools/build-startup-packs.mjs:42` packs level-0 tiles first. The 213 ring
tiles the boot needs first sit in packages 5 to 8, so all 18.5 MB gate the
renderer start. Publishing in need order cuts the gating bytes to roughly
10 MB: about 1.5 s at 50 Mbps and 5 to 7 s at 10 Mbps. Costs one turn of the
pack registry chain.

**L7. The request chain is serial before any terrain byte. Read.**
index.json, pack, scenery module, v2-index, course manifest, ground manifest
(577 KB), the startup module import, startup manifest, first package: six or
seven round trips in sequence after 1.55 MB of JS. `loadRings` also waits for
the frontier selection it does not depend on (`main.js:323`, `458`), and
landmarks and facilities are fetched at their point of use (`main.js:2985`,
`1995`, `6820`). Fix: start everything the slug determines from `entry.js`.
0.5 s on desktop, 1 to 2 s on a phone link.

**L8. Yield and tick timers. Read.**
`yieldWork` uses `setTimeout(0)`, which clamps to 4 ms when nested, and `tick`
waits `setTimeout(20)` eleven times. Use `scheduler.yield()` with a
`MessageChannel` fallback. About 0.4 to 0.6 s.

**L9. Accept masks for the far vista, tree planning and ground cover. Read
plus measured spans.**
The far vista costs 1.9 to 2.9 s for 210k to 600k cones, plan and push about
1 s, ground cover 0.5 s. Most of it is rejection tests that are a pure function
of published bytes. A 1-bit accept mask per lattice cell, baked with the same
identity binding as the tints, keeps positions in Float64 and the fingerprint
unchanged. Also: `isFacilityInterior` has no bounding-box reject, and the
vista build allocates one small array per cone. About 1.5 to 2.5 s, more on a
phone. Depends on L1, or the masks will expire as silently as the tints did.

**L10. Smaller, all exact.**
- Roads compute `horizonAO` (12 height samples per vertex) in branches that
  discard it (`main.js:3524`).
- The chooser prefetches the pack without the `?v=` query the player uses, so
  the bytes are never reused and the stray entry can evict a real offline file
  from a cache sized at exactly 13 x 4 (`hub.js:25`, `loader/pack.js:65`).
  Fixed the same day by the chooser session (uncommitted): the warm-up and the
  player now share `packRequestUrl(meta)`, and touch no longer triggers it.
- The `banvy-stable-facilities` service-worker rule has no network timeout and
  feeds a top-level await, so a weak connection can stall a cached reopen.
- Course switching is a full navigation. In-process reuse is worth 1.5 to
  2.5 s; the per-course CPU construction remains either way.

### Smoothness

**S1. Triangle load in tee views is 3 to 4 times the September 4 level.
Measured.** This is the reason for 30 fps. Exact-picture options, each needing
a pixel proof before it counts:
- Cull shadow casters to the shadow box. The box is 260 to 1,150 m, but the
  shadow pass draws every planned terrain tile and every tree tier
  (`frustumCulled = false`). Geometry outside an orthographic frustum writes
  no depth, so a layer-masked proxy with only intersecting tiles and cells is
  identical by construction. Compare shadow-map readbacks.
- The once-a-second blind shadow refresh (`main.js:7923`) repeats that whole
  pass at rest for identical content. Replace it with a cheap hash of caster
  count, geometry, instance count and transform on the same cadence.
- Distant terrain tiles use the full 257 x 257 grid. A coarser grid for tiles
  under a pixel-error bound is not provably identical; list it as "needs
  proof", not as a ranked fix.
The zone rule for trees is the owner's and stays.

**S2. The terrain plan is rebuilt from scratch every frame at rest. Read.**
`terrain-tile-manager.mjs:164-358` and `terrain-stream-controller.mjs:81-151`
build about eight Maps and Sets, run four `localeCompare` sorts over every
resident id and freeze an object per request, every frame. The earlier
recovery work measured only `tick + sync`. Memoise on camera matrix, viewport,
hole and a controller epoch, valid only when nothing is loading, releasing or
failed. Estimated 0.5 to 2 ms and tens of kB of garbage per frame.

**S3. The hole-marker overlay rewrites SVG paths every frame and forces
layout five times a second. Read.** `engine/hole-marker.mjs:127-199`, called
twice per frame, sets six `d` attributes unconditionally and polls
`getBoundingClientRect` every 400 ms. Cache strings, early-out on an unchanged
camera, use a `ResizeObserver`. Same for `kikTagUpdate` and the tour progress
bar.

**S4. Tree buffers grow in the middle of a pan. Read.** Tiers start at 2,048
slots and double on demand, cloning geometry and re-uploading whole buffers in
the frame a big cell enters view. In zone mode the exact maximum per tier is
known at boot; reserve it one tier per idle callback after the first frame.

**S5. `flushRanges` uploads nearly the whole tier once dirty runs exceed 96
(`main.js:5461`). Read.** A cell leaving the frustum does that at once. Merge
the smallest gaps down to 96 runs instead.

**S6. Smaller, all exact.** `updateTreeTiers` walks every tree in every
visible cell though zone tiers never change (measured 0.2 to 0.9 ms); the
minimap repaints every frame even when hidden; 18 flag cloths run 18 loops and
18 uploads a frame; 13 to 40 water sheets share one material and could be one
draw (needs a pixel diff on the coastal courses); static objects keep
`matrixAutoUpdate`.

## 3. Review of the plan itself

The plan is sound. These are the changes I would make before running it.

1. **Promote the prepared-data check from a baseline note to a stop
   condition.** The plan says to record mismatches and measure anyway. With
   L1 true, a baseline measured today describes a state that one bake changes
   by seconds. Measure both states and label them, because the deployed site
   is probably in the stale state.
2. **Do not write a new runner from scratch.** `boot-profile`,
   `trace-course-startup`, `benchmark-gpu-startup`, `check-course-startup`,
   `frame-time`, `frame-at-rest`, `scene-census`, `write-buffer` and
   `boot-requests` already exist. `tools/audit-performance.mjs` should
   orchestrate them and own only aggregation, run rejection and the report.
3. **Every existing profiler passes `det=1` and `qualitylock=1`.** The plan is
   right that these are not normal use; it should say that `det=1` also pins
   quality and clocks, and that the normal-use runs need a separate URL with
   neither flag.
4. **Add two instruments the plan lacks.** Main-thread idle per second of boot
   (it found L2 in one run), and span coverage: report the share of each stage
   no span accounts for. Visby's water stage was 85% unattributed. The
   fairways, water, flags and light stages have no spans at all.
5. **The CPU profile reads minified names.** Build the audit copy with source
   maps, or findings stop at `u` in `ring-index`.
6. **Scope the matrix.** 13 courses x 2 backends x 3 cold visits is 78 boots;
   the deep profiles are 4 x 2 x 20 = 160 more, plus 60-second scenarios. At
   25 s a boot that is hours of exclusive GPU time, and the startup doc shows
   contended batches produced unusable numbers. Screen all 13 on WebGPU only,
   add WebGL2 for the four deep courses, and record GPU utilisation before
   every visit as `benchmark-gpu-startup` already does.
7. **Add Visby-class courses to the deep set by rule.** The plan names four
   and adds "worst ranked". Say how: any course whose stage profile has an
   outlier stage over 2x the median course.
8. **Frame metrics need the uncapped and the capped view.** Uncapped rAF gives
   cost; capped gives what a visitor sees (missed vsyncs). Report both, and
   report GPU timestamps per pass (shadow, scene, post) since the shadow pass
   is the suspect.
9. **Treat the tree LOD zone rule, the complete-course gate and the
   one-second shadow tick as constraints with owners**, and say which findings
   touch them, so the ranking does not propose what has already been decided.
10. **`output/` is not git-ignored.** Decide whether raw evidence is committed;
    CPU profiles are tens of MB.
11. **The report date in the plan is 2026-09-16.** Name the file for the day
    the measurements are taken.

## 4. Suggested order of work after the audit

1. L1 gate and re-bake. Hours. Restores seconds that are already paid for.
2. L4, L7, L8, L10. Mechanical, no output risk. About 2.5 to 3 s.
3. L3. One function, 4 s on Visby.
4. L2. The largest structural win on desktop, 3 to 6 s.
5. S1 shadow culling and the shadow tick, then S2 to S5.
6. L5, L6, then L9 once L1 cannot silently expire it.

Verification for every step is the existing set: identical world and tint
fingerprints (`boot-profile --fingerprint`), `check-course-startup` for the
eight atmospheres and offline holes, goldens at `det=1`, and for shadow work a
shadow-map readback comparison.
