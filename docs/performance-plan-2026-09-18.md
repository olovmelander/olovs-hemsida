# Performance plan: faster opening and smoother frames, same picture

Prepared 2026-09-18. It replaces the draft "Performance audit with unchanged
visuals" and folds in the review and first measurements in
[performance-audit-plan-review-2026-09-18.md](performance-audit-plan-review-2026-09-18.md).
It continues [course-startup-implementation.md](course-startup-implementation.md);
everything that document established still holds.

## 1. Goal and rules

Make every course open faster and run smoother on every device, with no
visible change.

**Fixed constraints. No work item may touch these.**

- The whole course is locally ready before the cover lifts. Opening earlier
  with missing scenery does not count.
- Terrain, tree population and placement, tree detail by zone, lighting,
  shadows, water, both looks, all eight atmospheres, animation, camera
  behaviour, resolution and quality profiles stay as they are.
- A fix ships only with proof of identity: equal world and tint fingerprints,
  and pixel-identical deterministic captures (at most 1/255 on WebGL2).
- Anything that cannot be proved identical is listed in section 9 and needs
  the owner's decision. It is never slipped into a ranked fix.

**Targets** (p75, at least ten runs, from the startup document):

| Configuration | Target | Today |
|---|---:|---:|
| Desktop cold, 50 Mbps / 40 ms | 8 s | 23.5 s (Veckefjärden) |
| Phone cold, 20 Mbps / 80 ms | 15 s | about 65 s in desktop emulation |
| Cached reopen, desktop / phone | 3 s / 5 s | 11 s / unmeasured |
| Frame time, desktop tee view | 16.7 ms p95 | 31 ms median (Puttom hole 1) |
| Frame time, phone | 33.3 ms p95 | unmeasured |
| Stalls over 50 ms during a tour | 0 | unmeasured |

## 2. Reference courses

Veckefjärden is the heaviest course and the reference for every work item: 18
holes plus a second course on the same ground, 155,000 trees, 378,000 vista
cones, 3,840 ha of carved water, 51 lake flats, landmarks and facilities. A
fix is accepted when it holds on Veckefjärden and regresses nothing elsewhere.

| Role | Course | Why |
|---|---|---|
| Reference, everything | Veckefjärden | heaviest overall |
| Forest and triangle load | Puttom | 210,000 trees, 597,000 cones, 30 fps tee views |
| Sea and measured-only policy | Visby | 4 s in one water function; no carved beds |
| Two courses, one ground | Upsala | shared manifests, re-grounded pack |
| Coverage | all 13 | screened at every phase gate |

A course joins the deep set automatically when any of its boot stages exceeds
twice the median of that stage across the 13.

## 3. Phase 0: measurement that can be trusted (2 to 3 days)

Nothing is optimised before this lands. Every later phase is judged by it.

**0.1 `tools/audit-performance.mjs`.** An orchestrator, not a new profiler. It
drives `boot-profile`, `trace-course-startup`, `benchmark-gpu-startup`,
`frame-time`, `frame-at-rest`, `scene-census`, `goldens/write-buffer` and
`boot-requests`, and owns four things: the run matrix, run rejection,
aggregation (median, p75, spread, failures) and the report. Evidence goes to
`output/performance-audit/<date>/`, which becomes git-ignored; only summaries
are committed.

**0.2 Run rejection.** A run is discarded when the adapter is a fallback, the
build revision changed, quality changed unexpectedly, readiness was
incomplete, prepared data was in an unlabelled state, or GPU utilisation
before the visit was above 10%. No other browser job runs during a timing
batch.

**0.3 Two URL families.** Controlled runs use `det=1&qualitylock=1`.
Normal-use runs use neither, so the quality governor, live clocks and the
service worker behave as a visitor sees them. Reports never mix the two.

**0.4 New instruments.**
- Main-thread idle per second of boot, from the CPU profile. This found 10 s
  of idle time in one run.
- Span coverage: the share of each stage no span accounts for. Add spans to
  the fairways, water, flags and light stages, split the tree-asset wait out
  of "reeds", and fail the audit when a stage is under 80% attributed.
- A source-mapped audit build, so hot functions have names.
- Frame metrics both uncapped (cost) and vsync-capped (missed frames), with
  GPU timestamps per pass: shadow, scene, post.
- A 60-second scenario set per deep course: resting tee, orbit, flight, hole
  changes, water view, dense forest, atmosphere switches. Report interval
  median, p95, p99, stalls over 50 and 100 ms, and garbage-collection pauses.
- A ten-minute tour and ten repeated course visits for memory growth, with
  renderer counters labelled apart from process memory.

**0.5 Run matrix.** All 13 courses on WebGPU, three cold visits, painted look.
The deep set adds WebGL2, the natural look, ten cold and ten cached visits,
browser restart with caches kept, offline reopen, course switching, and the
throttled phone profiles. About 100 boots instead of 240.

**0.6 Budgets as gates.** Once the baseline exists, `check-performance-budget`
fails CI on requests, bytes, triangles per reference view and draw count
beyond a declared budget. Timings are reported, never gated, because CI has
no GPU.

**Exit:** a reproducible baseline report, two labelled states for prepared
data (accepted and rejected), and rankings for loading and smoothness.

## 4. Phase 1: restore and mechanical wins (3 to 4 days, about 5 to 6 s)

No output risk. Every item is exact by construction.

| # | Work | Where | Saving |
|---|---|---|---:|
| 1.1 | Gate prepared data: `tools/check-prepared-current.mjs` computes tint and water identities for the built revision and fails the Pages workflow on a mismatch | `pages.yml`, `tools/` | prevents silent loss |
| 1.2 | Re-bake tints and water for the current revision, all 13 courses | `bake-ground-tints`, `bake-water` | 2 to 3 s desktop, over 10 s on a phone |
| 1.3 | Narrow the source revision to what the calculations can reach: move `groundAt`, `vistaGround` and their inputs from `main.js` into an engine module, hash only that closure | `course-source-revision.mjs`, `main.js` | keeps 1.2 from expiring on HUD edits |
| 1.4 | Load painted tree assets at boot start, in parallel, assembled in the same order | `engine/ghibli-trees.mjs:202`, `main.js:4357` | 1 to 1.5 s, 3 s at 80 ms |
| 1.5 | Start every slug-determined fetch from `entry.js`: both indexes, manifests, startup manifest, landmarks, facilities, authored buildings, the bloom module; run ring loading beside frontier selection | `entry.js`, `main.js:234-458, 1995, 2985, 6820` | 0.5 s desktop, 1 to 2 s phone |
| 1.6 | `scheduler.yield()` with a `MessageChannel` fallback in `yieldWork`; one cheap yield in `tick` | `main.js:168-176` | 0.4 to 0.6 s |
| 1.7 | Skip `horizonAO` in road branches that discard it | `main.js:3524` | 0.1 to 0.4 s |
| 1.8 | Bounding-box reject before `ringSD` in facility and landmark hooks; typed arrays instead of per-cone arrays in the vista build | `veckefjarden-facilities.mjs:13`, `main.js:5817-5985` | 0.3 to 0.5 s |
| 1.9 | Network timeout on the `banvy-stable-facilities` rule. The chooser prefetch half is already fixed by the chooser session (uncommitted on 2026-09-18): `packRequestUrl(meta)` in `loader/pack.js` is shared by the warm-up and the player, touch no longer triggers it, gated by `tools/check-chooser-ui.mjs` | `vite.config.js:173` | removes the stall |

**Exit:** Veckefjärden desktop cold at or under 18 s, fingerprints identical,
`check-course-startup` green on all 13.

## 5. Phase 2: use the idle time (1 to 2 weeks, about 4 to 7 s on desktop)

The boot is a straight line with two long waits in it. This phase overlaps
them. Boot order is load-bearing, so each step lands alone behind a
`?startup=` comparison flag, as the earlier startup work did.

**2.1 Construct during the terrain wait.** `terrainV2.prepare` and the
vegetation chunk wait leave the main thread idle for about 4 s. Keep both as
promises. Move work that needs only the CPU ring sampler into that window:
the shore field, reed lattice, species templates, water sheets, roads and
parking, the far vista. Placement is hash-based, so execution order cannot
change results as long as push order into each table is preserved. First
verify that `terrainH` returns construction heights before
`visibleGroundHeightAt` is assigned (`main.js:2981`); anything that differs
stays after it.

**2.2 Compile while planting.** Start `compileAsync` for branches that exist
by the forest stage (terrain, water, roads, landmarks, sky) and let driver
threads work during the 5 s of forest CPU time. Add the shadow-pass and
post-processing pipelines, which are still built inside the first frame. The
existing final preparation pass stays as the gate and becomes nearly empty.
Requires lights, fog and environment structure to be final earlier; verify
pipeline keys do not depend on uniform values.

**2.3 Decode pool.** Two to four workers sized from `hardwareConcurrency`,
with a priority queue: rings, opening frontier, vegetation, background
verification. Hand each worker a whole verified package. Drop the second deep
copy for read-only consumers and the raw-envelope rebuild with its second
hash. Re-measure the opt-in terrain worker on the pool; the first experiment
ran on a contended GPU and on the single worker.

**2.4 Shore distance.** Give `ring-index` an exact nearest-segment tree for
unbounded queries, same per-segment formula and same minimum, so
`waterShoreDistance` stops expanding across the whole grid. About 4 s on
Visby; check Lidingö, Norrfällsviken and Veckefjärden's fjärd.

**Exit:** Veckefjärden desktop cold at or under 13 s; main-thread idle under
15% of boot; first frame under 300 ms of CPU.

## 6. Phase 3: prepare deterministic construction (2 to 3 weeks)

This is what decides the phone targets. On a phone the CPU is the limit and
overlap buys little, so the work has to leave the boot.

Everything here uses the prepared-data pattern that already exists: baked by
the app's own functions, bound to the narrowed identity from 1.3, verified on
load, with the live calculation as the fallback.

**3.1 Accept masks.** One bit per lattice cell for the far vista, the stand
and individual exclusions, ground cover and reeds. The runtime recomputes
each position from its hash in Float64 and evaluates only load-dependent
tests live. About 115 KB per course. Saves 1.5 to 2.5 s on desktop.

**3.2 Prepared forest tables.** If 3.1 is not enough on a phone: publish the
planned tree tables (global index, Float64 placement, species, tier zone) in
iteration order, so the planner becomes a load.

**3.3 Prepared geometry.** Road ribbons, water sheets with their shore
distance and depth attributes, and the 1 m ground atlas are pure functions of
published bytes. Bake them as typed attributes.

**3.4 Need-ordered packages.** Rebuild the startup packages as rings, opening
frontier, vegetation, remaining level-0 tiles. Gating bytes fall from 18.5 MB
to about 10 MB. One turn of the pack registry chain per ground.

**Exit:** under 4x CPU slowdown Veckefjärden's construction stages fall by
half; fingerprints identical with every prepared input blocked one at a time.

## 7. Phase 4: frame time (1 to 2 weeks, runs beside phases 2 and 3)

Ordered by measured or estimated effect. Every item is verified with
`frame-time`, `frame-at-rest`, `write-buffer`, goldens and, for shadows, a
shadow-map readback comparison.

| # | Work | Where | Effect |
|---|---|---|---|
| 4.1 | Cull shadow casters to the shadow box: a layer-masked terrain proxy holding only tiles that intersect it, then the same per tree cell | `v2-graph-terrain.mjs:623`, `main.js:5374` | removes most of the second 17 M-triangle pass |
| 4.2 | Replace the blind once-a-second shadow refresh with a caster hash on the same cadence | `main.js:7923` | removes a 1 Hz spike at rest |
| 4.3 | Memoise the terrain plan at rest on camera matrix, viewport, hole and a controller epoch; plain comparison instead of `localeCompare` | `terrain-tile-manager.mjs:164`, `terrain-stream-controller.mjs:81` | 0.5 to 2 ms and the per-frame garbage |
| 4.4 | Hole-marker overlay: cache strings, early-out on an unchanged camera, `ResizeObserver` instead of 400 ms polling; same for the Kikaren tag and tour progress | `engine/hole-marker.mjs:89-199`, `main.js:9826, 8958` | removes forced layout and per-frame SVG |
| 4.5 | Reserve tree buffers to their exact zone maximum, one tier per idle callback after the first frame | `engine/tree-tier-capacity.mjs` | removes reallocation hitches in a pan |
| 4.6 | Merge dirty runs to 96 by smallest gap instead of uploading the whole span | `main.js:5461` | removes MB-scale uploads when cells leave view |
| 4.7 | Skip settled cells in `updateTreeTiers` in zone mode | `main.js:5612` | 0.2 to 0.9 ms |
| 4.8 | Minimap repaints only on change and only when shown | `main.js:10524` | per-frame raster |
| 4.9 | One mesh for the 18 flag cloths; one geometry per water material (pixel diff on coastal courses); `matrixAutoUpdate = false` on static objects | `main.js:6548, 3891` | 30 to 60 draws |

**Exit:** Puttom hole 1 tee at or under 16.7 ms p95 uncapped on the RTX 3070;
no stall over 50 ms in the ten-minute Veckefjärden tour; zero bytes written at
rest beyond the water and sky uniforms.

## 8. Phase 5 and 6: reopening, switching, devices

**5.1 Cached reopen (target 3 s, today 11 s).** After phases 1 to 3 the
remainder is loader time. A verified marker per cached generation lets the
package hash be skipped on reopen while chunk hashes still run. Prewarm from
the chooser on hover or idle for the last-opened course, gated on `saveData`.

**5.2 Session reuse.** Keep the renderer, device, tree assets, impostor
atlases, procedural textures and warm pipelines across course switches with
explicit disposal of per-course resources. Worth 1.5 to 2.5 s per switch.
Gate with the repeated-visit memory test from 0.4.

**5.3 Hosting.** Measure only after the artifacts above exist: Pages ignores
`_headers`, gzips already-deflated binaries and serves HTTP/2.

**6. Physical phones.** iPhone 12 Safari and a Galaxy A54-class Android
Chrome, with the protocol the audit tool prints: cold, cached, offline, a
tour, thermal state noted. Desktop emulation never stands in for this.

## 9. Not in the plan without the owner's decision

These would help and are not provably identical.

- A coarser vertex grid for distant terrain tiles (about 5 M triangles a pass).
- A distance cutoff on shore distance instead of the exact tree in 2.4.
- Fewer triangles in the painted crowns, or a different zone rule for trees.
- Lifting the cover before the whole course is ready.

## 10. Working rules

- Several sessions share this checkout. Announce owned paths, stage by path,
  never switch branches, build into a scratch output directory.
- Each work item lands alone, with its comparison flag, its fingerprint proof
  and its before and after numbers in the audit report.
- A rebake follows any change to the narrowed calculation closure, and the
  deploy gate from 1.1 enforces it.
- Timings are compared only within one tool, one build family and one quiet
  machine.

## 11. Order and expected result

| Phase | Duration | Veckefjärden desktop cold | Notes |
|---|---|---:|---|
| today | | 23.5 s | prepared data rejected |
| 0 | 2 to 3 days | 23.5 s | trusted baseline |
| 1 | 3 to 4 days | about 17 to 18 s | exact, mechanical |
| 2 | 1 to 2 weeks | about 11 to 13 s | overlap, decode pool |
| 3 | 2 to 3 weeks | about 8 to 10 s | decides the phone targets |
| 4 | 1 to 2 weeks, parallel | | 30 fps tee views to 60 |
| 5, 6 | after 3 | cached reopen toward 3 s | devices decide acceptance |

The savings are estimates until phase 0 measures them, and they overlap: the
sum of the items is larger than the total they will deliver together.
