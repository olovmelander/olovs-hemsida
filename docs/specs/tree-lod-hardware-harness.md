# Frame time and tree-LOD pop meter on the RTX 3070: two harness tools and a set of additive V3D hooks (revised after review)

## Summary
Two new harness tools measure what the owner complained about on the RTX 3070: tools/frame-time.mjs records rAF intervals AND GPU timestamp-query frame times at six static views plus one moving-camera walk row (the only row that can see a crossfade's cost), with a second vsync-on launch for the cadence a user sees; tools/tree-pop-meter.mjs walks holes 1, 5, 12 and the hole-7 flyover in 1.5 m steps, screenshots the automatic tiers and a forced reference tier at identical poses, and gates on the same-pose LOD jump (j) and a 60x60-block peak (popPeak) instead of the whole-frame motion residual, with tier switches attributed EXACTLY from a per-cell state export rather than the totals formula the review showed can misfire on a frustum entry/exit. The hooks are all additive and text-anchored (line numbers are stale by up to 187 lines, verified): a switches counter, cellStates/cellCounts and threshold/force reporting in treeTiers, setTreeThresholds (the realistic positive control and the threshold sweep the owner's first ask needs), setShadowRadius (stepped flight poses otherwise get the interactive shadow fit, not the flight's fixed 580 m), quality() with an autoQualityDone flag (the 15 s toast wait was a race), rendererInfo/setFov, gpuFrameMs behind ?gputime=1 with the query-pool drain the review found, and Mode B frameDiff. Outputs use colon-free run ids (NTFS), the full arrays stay gitignored under tools/goldens/, and a ~15 KB summary is committed under geo_data/course-v2/puttom/perf/ where --baseline reads it by default. Every one of the 20 review issues is folded in; issue 5's assertion (warm+n) is stated to be wrong and issue 15's (warm+n+1) is used, with the reasoning. Nothing changes placement, tiers or rendering; boot-profile --fingerprint stays identical.

## Files
- tools/frame-time.mjs (new)
- tools/tree-pop-meter.mjs (new)
- apps/golf/src/main.js (additive: `switches: 0` in TREE_LOD.stats and `if (from && to) TREE_LOD.stats.switches++` in treeTierMove; treeTiers extended with heroPx/hysteresis/nominalHeight/force/cellStates/cellCounts; setTreeThresholds after setTreeLod; `let shadowRadiusOverride` + placeSun targetR override; `let autoQualityDone` beside `let lowfx` and set in the auto-quality block; `const GPU_TIME` + `trackTimestamp: GPU_TIME` in mkRenderer; rendererInfo/setFov/setShadowRadius/quality/gpuFrameMs/frameDiff/frameDiffReset after `frame: () => FRAME_NO,`; `frameDiff()` beside captureReadback)
- geo_data/course-v2/puttom/perf/frame-time-baseline.json (new, committed summary, LF)
- geo_data/course-v2/puttom/perf/pop-baseline.json (new, committed summary, LF)
- docs/tree-lod-plan.md ("Phase 0 measured" section after the first run)
- tools/goldens/puttom-perf/<runId>/ and tools/goldens/puttom-pop/<runId>/ (gitignored full records)

## Risks
- The two uncap flags (--disable-frame-rate-limit --disable-gpu-vsync) are still untested in headless Chrome 152 on this machine; the tool measures the hub-page cadence and, if the cap is still on, publishes the GPU timestamp column as primary and marks the rAF columns quantised rather than aborting — but then the rAF numbers are not frame times and must not be gated.
- The GPU timestamp value is the sum of every render context in the last frame of a resolved batch; a frame split by a resolve yields a partial sample. The sampler discards the first two samples and any below half the median and reports the discard count — if that count is large the GPU column is suspect and the view should be re-run.
- Whether an uncapped rAF interval tracks GPU time on a GPU-bound WebGPU canvas depends on Chrome's swapchain back-pressure; the gpu ≤ cpu + 1 ms consistency check flags it per view but cannot fix it.
- The auto-quality verdict (bloom zeroed, lowfx) is now gated exactly via autoQualityDone, but a run under ?q=lo would never set the flag; the tools do not pass q=lo, and the gate reads quality().lowq to skip the wait rather than hang.
- Pass order still matters in the pop meter: a forced reference tier rewrites every visible cell's state, so a second automatic pass in the same boot is a different experiment; repeats and threshold sweeps are one boot each, which makes a three-setting sweep ~30 min.
- GPU rendering may not be bit-reproducible pose for pose (driver scheduling, MSAA resolve); floor and floorPeak measure it and τ scales from it. If floorPeak is large, popPeak loses resolution on small pops — the run prints both so the loss is visible.
- The reference pass (tier 2 everywhere out to MIDR) is a different scene from the automatic one at far distances, so e[i] carries a constant representation error and j[i] a small motion-dependent residual; the p99-over-unattributed-steps τ absorbs it, but a course with few unattributed steps (short holes) gives a weaker τ — the count is printed.
- page.screenshot of a WebGPU canvas has been unreliable on headless SwiftShader (main.js comment at the capture hooks); on the GPU path the goldens prove it works, and the luminance guard on the first frame is required, not optional.
- Chrome exposes adapter.info.device/description as empty strings; identifying the RTX 3070 relies on the WebGL debug-renderer string from a scratch canvas. A future Chrome that masks that too would need --enable-webgpu-developer-features (untested here).
- The working tree is dirty (main.js, index.html, CLAUDE.md, check-flight.mjs modified; rangefinder/weather engine files untracked) and dist was built 19:12 today; the provenance header records exactly what was measured, but a baseline written from a dirty tree is attributable only to that tree — write the committed baselines from a clean, built commit.
- ?gputime=1 creates a 2048-query pool and two timestamp writes per pass; the cost is small but nonzero, so frame-time numbers with and without gputime are not like with like — the tool always boots with it on, and the vsync-on column too.
- renderer.info.render.triangles counts every render call in the frame (shadow pass included); a view's number moves with the shadow camera's fit, which is fine for like-for-like comparison but is not a scene triangle count. The setShadowRadius override on the cruise view makes that row match the flight it stands for.

## Open questions
- Reference tier for the pop meter: tier 2 (full template everywhere, what the plan's earlier comparisons used) is the default; tier 1 (hero everywhere) would measure the near switch against what the owner sees up close at ~6x the triangles per visible cell — does the owner want both recorded?
- Should --trees-only become the gated configuration rather than a diagnostic? The whole-scene block metric localises a pop regardless of the ground, but a trees-only run is the cleanest L1; the cost is a doubled run.
- Should the pop meter's flight path also sample the 180-degree green sweep (t between orbitT and duration), where cells rotate through the frustum edge fastest? It adds ~150 poses per pass.
- The regression percentages (median +10%, p95 +25%, trianglesMax +15%, popPeakMax 0.5x) are placeholders until the first record exists; the plan says the budget is set from the record — who signs off the numbers after the first run?
- Should tools/browser-args.mjs export a separate benchArgs() for the uncap flags, or do they stay private to frame-time.mjs (as specified)?
- Is a committed baseline per course wanted for all nine courses eventually (the tools take --course), or only Puttom while the tree work is on this branch?

## Evidence
- Repo state 2026-09-03: HEAD 0a37b07 on claude/tree-lod-phase-1; git status: M CLAUDE.md, M apps/golf/index.html, M apps/golf/src/main.js, D tmp-dump.mjs, M tools/check-flight.mjs, ?? apps/golf/src/engine/{rangefinder,weather}.{js,test.mjs}, ?? docs/banvy-blueprint.md. Working-tree main.js 8280 lines; HEAD's main.js 8153 lines. apps/golf/dist/index.html mtime 2026-09-03 19:12:16; dist assets include main-CSAq84oR.js, three.core-p_dLJhYJ.js, puttom-DCdvWyQJ.js.
- main.js anchors (working tree, verified by grep): `const DET` :85, `const time = DET ? float(3.25)` :88, `const LOWQ` :1131, `let lowfx = false;` :1134, `const FORCE_GL` :1142, `const mkRenderer = forceWebGL => new THREE.WebGPURenderer({ antialias: true, samples: 4,` :1143, `let renderer;` :1145, `renderer.setPixelRatio(LOWQ ? 1 : Math.min(devicePixelRatio, 2))` :1153, `const IS_GPU` :1160, `let captureReadbackTarget` :1163, `new THREE.PerspectiveCamera(48, …, 1.0, 14000)` :1167, `const PRESETS` :1271, `function setPreset` :1370, bloom strength set from lowfx :1396, `const TREE_LOD = {` :3776 (heroPx/switchPx/impostorPx/hysteresis :3781, force :3785, stats :3787), impostor batch `userData.tag = 'trees'` :3962, cell record `{…, lists: [[], [], []], state: 0, box }` :3977, tier InstancedMesh tag :4019, `function treeTierMove` :4068 (`TREE_LOD.stats.moves++` :4092), `function updateTreeTiers` :4096 (TREE_PROJ from camera.matrixWorldInverse :4098, `const thr = [...]` :4108, `desired = 0` outside frustum :4111, px formula :4117, force :4118, hysteresis loops :4125-4126, `TIER_FRAME = FRAME_NO` :4138, impostor `mesh.visible = tier.count > 0` :4145), vista tag :4280, `renderer.__bloomNode = bloomNode` :5652, `function renderActivePipeline` :5658, `function placeSun` :5665 (targetR line :5673, 14 m hysteresis :5675), `function flyTo` :5730, `function setCam` :5741 (tee at mark−7 m, terrainH+2.4, aim 72% +3 m :5751-5755; top +330 :5764; orbit 24+0.045·len :5772), `function goHole` :5782, VY2CAM :5796, LJUS2P :5798, `function toast` :5814, `const FL` :5938 (fovCruise 52, fovOrbit 46), `function flightSim` :6484, `let FRAME_NO = 0, TIER_FRAME = 0` :7675, `function frame()` :7676 (dt clamp :7677, terrainV2.update :7681, updateTreeTiers :7683, FRAME_NO++ :7684, fps :7685, controls.update + ground clamp :7738-7742, placeSun :7744, render unless captureRenderLocked :7750), ?ren=1 → setClean(true) :7769, `renderer.setAnimationLoop` :7778 (firstFrames ms = CPU wall time :7781-7784), `async function waitForSubmittedGpuWork` :7799, `async function captureReadback()` :7819 (samples:1 target :7822-7828), `window.V3D = {` :7886, `stats:` :7887, `rangefinder:` :7894, `perf:` :7895, `setWaterVisible` :7912, `setMeshesVisible` :7914, `cameraInfo` :8025, `placeCamera` :8027, `v2Terrain` :8032, `legacyTrees` :8089, `treeTiers: () => ({ ...TREE_LOD.stats, switchPx…, impostorPx…, cell… })` :8091 (no heroPx/force/hysteresis), `setTreeLod` :8093, `frame: () => FRAME_NO,` :8097, `settled` :8157, `flightSim` :8159, `fly` :8162, `probeH` :8164, `setView` :8165, `camInfo` :8187, `fps` :8189, `prepareCapture` :8190, `captureReadback: IS_GPU ? … : null` :8191, `bootEl.classList.add('done')` :8239, auto-quality block :8245-8280 (`if (!LOWQ) setTimeout(…, 4000)`, `setInterval(…, 1000)`, `if (!fps) return;`, `if (checked >= 10) { window.clearInterval(qt); if (bad >= 6) { lowfx = true; … renderer.setPixelRatio(1); … __bloomNode.strength.value = 0; toast('Låg bildfrekvens …', 10000) } }`; only the localStorage write is det-guarded :8266).
- `clampf` is imported into main.js from ./engine/geom.js at :48 (defined geom.js:4), so the placeSun override needs no new import. `legacyTreeExport` (:3721) returns total = Σ species counts, the same sum as stats.trees; check-app.mjs:235 gates `veg.total === veg.statsTrees`.
- three.js 0.185.1 (apps/golf/node_modules/three/src/renderers): Animation.js:71-83 re-registers rAF, then `if (this.info.autoReset === true) this.info.reset()`, then the loop; Info.js: autoReset default true (:31), render = {calls, frameCalls, drawCalls, triangles, points, lines, timestamp} (:60-74), update() adds instanceCount*count/3 (:156-162), reset() (:187-197) clears drawCalls/frameCalls/triangles/points/lines but NOT timestamp, dispose() (:205-213) resets timestamp; WebGPURenderer.js:60-78 passes constructor parameters to `new WebGPUBackend(parameters)`; Backend.js:76 `this.trackTimestamp = (parameters.trackTimestamp === true)`, :491 `timestampUID = prefix + ':' + id + ':f' + frame`, :597-618 resolveTimestampsAsync → queryPool.resolveQueriesAsync(), writes info[type].timestamp and returns duration; Renderer.js:2856-2860 returns the backend's value; Renderer.js:2000 getPixelRatio(); WebGPUBackend.js:294 `trackTimestamp && hasFeature(TimestampQuery)`, :839 initTimestampQuery per render pass, :2255-2268 pool created with 2048 queries and allocateQueriesForContext(uid); WebGPUTimestampQueryPool.js: maxQueries 2048 (:27), allocate returns null with warnOnce when currentQueryIndex+2 > max (:67-74), resolveQueriesAsync returns lastValue when index is 0 or a resolve is pending, _resolveQueries resets currentQueryIndex to 0 before GPU work, returns lastValue if resultBuffer is mapped, duration = Number(end−start)/1e6, returns framesDuration of the LAST frame in the batch (:218-260); BloomNode.js:147 `_nMips = 5`.
- Tier boundary distances (12 m tree, fov 48, tan 24° = 0.44523): 1080 rows → d_thr 132.3 / 363.9 / 1039.6 m; finer (d < d_thr/1.1) 120.3 / 330.8 / 945.1; coarser (d > d_thr/0.9) 147.0 / 404.3 / 1155.1 (the first draft's 145/400/1144 were d×1.1). 900 rows → 110.3 / 303.2 / 866.3; finer 100.2 / 275.7 / 787.6; coarser 122.5 / 336.9 / 962.6. Positive control switchPx 48: coarser 2|3 boundary at px < 43.2 ⟺ d > 336.9 m, so tier-2 cells between 337 and 404 m switch.
- Puttom model (puttombuild/course-model.json, holes[] with keys n, par, idx, t, line, lineLen, …, green, tees, pin): hole 1 par 4, line 2 pts, 320.0 m, first [-79.7,-250.4], green.c [-192.2,-550]; hole 5 par 3, 3 pts, 175.0 m; hole 7 par 4, 3 pts, 360.0 m; hole 12 par 3, 2 pts, 122.0 m, first [189.5,390.3], green.c [167.6,270.3]; hole 14 par 5, 3 pts, 466.0 m; 4 tee marks per hole.
- Adapter check run earlier for real (BANVY_GPU=1, playwright-core 1.55.0, channel 'chrome'): Chrome 152.0.7977.66 headless; about:blank → navigator.gpu undefined; http://127.0.0.1:8620/ → isSecureContext true, requestAdapter info {vendor:'nvidia', architecture:'ampere', device:'', description:'', isFallbackAdapter:false}, features include timestamp-query, limits.maxVertexBuffers 8; WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)'; hub-page rAF cadence under the default GPU flags: median 6.1 ms, min 6.0, max 6.2 over 40 frames.
- tools/browser-args.mjs: GPU = process.env.BANVY_GPU === '1'; GPU args ['--no-sandbox','--use-angle=d3d11','--enable-gpu','--force_high_performance_gpu','--ignore-gpu-blocklist','--force-device-scale-factor=1']. tools/tree-tiers-at.mjs settle = frame ≥ f0+2 && settled(), polling 500; tools/world-capture.mjs waits settled() then a further 1800 ms per shot, gates adapter.stream.drawCalls===1 and loadingTiles===0, writes fixed file names; tools/tree-lod-ab.mjs uses decodePNG from geobuild/png.mjs ({width,height,channels,data}); tools/check-app.mjs:314 luminance rule mean > 0.05·255 and dark fraction < 0.85; tools/boot-profile.mjs --fingerprint hashes legacyTrees({instances:true}) and writes only with --out; tools/make-posters.mjs POSTERS.puttom[0] at :129 is hole 12 orbit golden; tools/vegetation-baseline.mjs writes geo_data/course-v2/<course>/vegetation/phase0-baseline.json.
- engine/v2-graph-terrain.mjs snapshot() :698-717: stream.loadingTiles = runtime.stream.loadingTileIds.length, readyTiles, renderedTiles, drawCalls, triangles.
- .gitignore:3 `tools/goldens/`; .gitattributes: `geo_data/**/*.json text eol=lf`; packages/course-geo/check-manifests.mjs:27-45 reads only `<dir>/source-manifest.json` per directory under geo_data/course-v2 and validates the artifacts it lists — an unlisted geo_data/course-v2/puttom/perf/*.json is not hashed. geo_data/course-v2/puttom/source-manifest.json mentions no perf/ entry.
- geo_data/course-v2/puttom/vegetation/phase4-vegetation.json: runs[1].url = 'http://127.0.0.1:8620/?bana=puttom&det=1&v2=require', runs[1].stats.trees = 79407, runs[1].trees.total = 79407, stats.draws 39, backend 'webgpu'; runs[0] (GPK1) total 54601. phase0-baseline.json (2026-09-02) records 67,568 legacy trees on v2=require before the vegetation generation was planted.
- docs/tree-lod-plan.md: Transitions (:197-204) — crossfade 'at the cost of drawing both tiers during the fade'; What must not change (:206-216) — fingerprint identical; phase 0 (:220-226) still owed on hardware; phase 3 tier counts frame-settled: 5th tee noon 189/1970/8334/2882, 1st tee golden 191/494/8023/4575, 7th overhead 0/306/2124/0; boot 28.1 s harness, bake 1.65 s; harness lessons: wait for V3D.frame() to advance by two, first shot after boot differs (14th 9.05/255 vs 0.68/255). docs/puttom-performance-status.md: trees drawn 79,407 → ~13,600 at the 1st tee, draws 266 → 289, 'What is left' items 1 (look at it on the RTX 3070) and 3 (crossfade if the switch shows).
- Task-supplied facts used unchanged: RTX 3070 Laptop, 1600x900 det v2=require boot 16.5 s, 79,407 trees, 451 cells, 57,652 vista impostors, 56 draws at boot, first frames 1102/2226 ms then ~14 ms (BOOT_PERF.firstFrames.ms, a CPU wall time).

---

# Frame time and tree-LOD popping on the RTX 3070 — harness specification (rev. 2, after review)

Scope: two new harness tools under `tools/`, a set of ADDITIVE hooks in `apps/golf/src/main.js` (no behaviour change unless a hook is called or `?gputime=1` is on the URL), one small committed evidence file per tool, and the rules for reading the numbers. Nothing here changes placement, tiers or rendering; `tools/boot-profile.mjs --fingerprint` must hash identically before and after.

**Anchors are TEXT, not line numbers.** The working tree moved by 127–187 lines since the first draft (HEAD `0a37b07` has an 8153-line `main.js`, the dirty working tree 8280 lines, with a new `rangefinder:` hook inside `V3D`), so every insertion point below is given as a grep anchor that matches exactly once in the current working tree, with today's line number only as a hint. Re-grep before editing.

## 0. Verified API surface (`window.V3D`, anchor `window.V3D = {`, today :7886)

| hook | anchor / today | contract (verified) |
|---|---|---|
| `stats` | `  stats: { verts:` :7887 | boot snapshot: `trees`, `vista`, `draws`, `backend` ('webgpu'/'webgl2') |
| `goHole(n, recam, instant)` | `function goHole(n, recam, instant)` :5782 | `recam` re-applies the current cam mode, `instant` skips the tween |
| `setCam(mode, instant)` | `function setCam(mode, instant)` :5741 | `tee`: camera at `mark − 7 m` along the line, `terrainH + 2.4`, aim at 72% of the line +3 m; `top`: +330 m; `orbit`: behind the tee at 24 + 0.045·len m |
| `setPreset(name)` | `function setPreset(name)` :1370 | `golden`/`noon`/`mist`/`dawn`/`host` (`PRESETS` :1271); URL names via `LJUS2P` :5798 |
| `HOLES` | :7892 | `line` = `[x,z]` pairs, `green.c` = `[x,z]`, `pin`, `tees.marks[k].c`; Puttom hole 1 line 320.0 m (2 pts), 5: 175.0 (3), 7: 360.0 (3), 12: 122.0 (2), 14: 466.0 (3), 4 marks each — from `puttombuild/course-model.json` |
| `perf()` | :7895 | `BOOT_PERF` marks/spans/`firstFrames[12]` (`ms` is CPU wall time around `frame()`, NOT GPU time) |
| `setMeshesVisible({tag,minInstances,material,world}, on)` | :7914 | `{}` matches every mesh; `{world:true}` toggles `terrainV2.group` only and returns early |
| `setWaterVisible(on)` | :7912 | `WATER_MESHES` |
| `cameraInfo()` | :8025 | `fov, near, far, aspect, position` |
| `placeCamera(p, t)` / `setView(px,py,pz,lx,ly,lz)` | :8027 / :8165 | both `flyTo(…, 0)` → set `camera.position`, `controls.target`, `camTween.on=false` (`function flyTo` :5730) |
| `v2Terrain()` | :8032 | `.adapter.stream.loadingTiles` = `runtime.stream.loadingTileIds.length` (`engine/v2-graph-terrain.mjs` `snapshot()` :698–717), `.kind`, `.status` |
| `legacyTrees()` | :8089 | `{ total, species, reasons, zones, … }`; `total` equals `stats.trees` (check-app gates this, `tools/check-app.mjs:235`) |
| `treeTiers()` | `  treeTiers: () => ({ ...TREE_LOD.stats,` :8091 | today: `tier0..tier3, cells, cellsVisible, moves, updates, bakeMs, switchPx, impostorPx, cell` — no `heroPx`, no `force`, no per-cell state (extended in §1) |
| `setTreeLod(n)` | :8093 | `TREE_LOD.force` 1 hero / 2 full / 3 decimated / 4 impostor / 0 auto; force overrides hysteresis for every in-frustum cell every frame (`if (TREE_LOD.force) desired = TREE_LOD.force;` :4118) |
| `frame()` | `  frame: () => FRAME_NO,` :8097 | `FRAME_NO++` once per `frame()` (:7684) |
| `settled()` | :8157 | `!camTween.on && FRAME_NO >= TIER_FRAME + 2` (`TIER_FRAME = FRAME_NO` on any tier change, :4138) |
| `flightSim(n, step, transit)` | `function flightSim(n, step = 1 / 60, transit = false)` :6484 | `{duration, orbitT, transitT, track:[{t,x,y,z,lx,ly,lz,fov,clear}], …}`; null if `flying > 0`; resets `tourFlight.st` and leaves no state |
| `probeH(x, z)` | :8164 | `renderedGroundH` = `groundHeightSampler.heightAt` (:1576), the ground actually drawn |
| `camInfo()` / `fps()` | :8187 / :8189 | pos/look/mode rounded to 0.1; `fps` = frames/acc over 0.5 s windows (:7685) |
| `prepareCapture`, `captureReadback` | :8190–8191, def `async function captureReadback()` :7819 | GPU only; see §3.4 |

Not reachable today: `renderer` (module `let`, :1145) and `renderer.info`; `lowfx` (module `let`, :1134); `camera.fov` has no setter; `TREE_LOD.heroPx`/`hysteresis`/`force`. `LOWQ` (:1131) is `q=lo`, remembered 'lo', or a device sniff that `det=1` disables (:1128–1129) — on the harness the thresholds are the desktop 110/40/14 px.

Frame-loop facts the measurements rest on (all verified): `renderer.setAnimationLoop(() => { … frame() … })` :7778; three's `Animation.start` (`apps/golf/node_modules/three/src/renderers/common/Animation.js:71–83`) re-registers rAF FIRST, then `info.reset()` when `autoReset` (default true, `Info.js:31`), then the loop — so a harness rAF callback registered between ticks runs AFTER the app's frame in every tick, and `renderer.info.render` read there is that frame's total over every render call (`WebGPUBackend.js:1832/1860/1887` → `Info.update` :156 adds `instanceCount × count/3`). `Info.reset()` (:187–197) clears `drawCalls/frameCalls/triangles/points/lines` but NOT `timestamp` (only `dispose()` does, :212). `frame()` (:7676) clamps `dt` to 0.1 s, runs `terrainV2.update`, then `updateTreeTiers()` (which reads `camera.matrixWorldInverse` from the PREVIOUS render, :4098–4099), then `controls.update()` + the `terrainH + 1.7` clamp when `flying === 0` (:7738–7742), `placeSun()` (:7744), then `renderActivePipeline()` unless `captureRenderLocked` (:7750). `placeSun` (:5665): `targetR = flying > 0 ? 580 : clampf(distance×1.15 + 90, 260, 1150)` with a 14 m hysteresis. Post: `RenderPipeline` with a scene pass and a 5-mip `bloom` (`BloomNode._nMips = 5`), so a frame is roughly shadow + scene + ~11 bloom passes + output ≈ 14–16 render contexts; `rendererInfo().frameCalls` reports the exact number.

## 1. Hooks to add to `apps/golf/src/main.js` (all additive)

Each edit names its anchor; each anchor matches exactly once in the working tree today.

**1a. `switches` counter** (review issue 3). In `stats: { tier0: 0, … updates: 0, bakeMs: 0 }` (anchor `  stats: { tier0: 0, tier1: 0, tier2: 0, tier3: 0, cells: 0, cellsVisible: 0, moves: 0, updates: 0, bakeMs: 0 },` :3787) add `switches: 0`. In `function treeTierMove(s, k, from, to) {` (:4068), after `  TREE_LOD.stats.moves++;` add:
```js
  if (from && to) TREE_LOD.stats.switches++;   /* tier-to-tier, not a frustum entry (0→n) or exit (n→0) */
```

**1b. `treeTiers` extended** (issues 12, 13). Replace the one line beginning `  treeTiers: () => ({ ...TREE_LOD.stats,` with:
```js
  treeTiers: ({ cells = false } = {}) => ({ ...TREE_LOD.stats,
    heroPx: TREE_LOD.heroPx, switchPx: TREE_LOD.switchPx, impostorPx: TREE_LOD.impostorPx, hysteresis: TREE_LOD.hysteresis,
    nominalHeight: TREE_LOD.nominalHeight, cell: TREE_LOD.cell, force: TREE_LOD.force,
    /* plain arrays, not typed arrays: Playwright's evaluate does not carry a Uint8Array across */
    cellStates: cells ? TREE_LOD.cells.map(c => c.state) : null,
    cellCounts: cells ? TREE_LOD.cells.map(c => c.lists[0].length + c.lists[1].length + c.lists[2].length) : null }),
```
`TREE_LOD.cells[i]` carries `state` (0 = outside the frustum, 1–4 = tier) and `lists: [[],[],[]]` (:3977). Existing callers (`tools/tree-tiers-at.mjs`, `tools/tree-lod-ab.mjs`) call `treeTiers()` with no argument and keep their shape. 451 cells → ~2 KB per call with `cells:true`.

**1c. `setTreeThresholds`** (issue 13). After the line `  setTreeLod: n => { … },` (:8093):
```js
  /* the tier boundaries in projected pixels, changeable at run time: read every frame at `const thr = [...]` in updateTreeTiers */
  setTreeThresholds: ({ heroPx, switchPx, impostorPx } = {}) => {
    if (heroPx > 0) TREE_LOD.heroPx = +heroPx; if (switchPx > 0) TREE_LOD.switchPx = +switchPx; if (impostorPx > 0) TREE_LOD.impostorPx = +impostorPx;
    return { heroPx: TREE_LOD.heroPx, switchPx: TREE_LOD.switchPx, impostorPx: TREE_LOD.impostorPx };
  },
```
Verified: `updateTreeTiers` reads `const thr = [TREE_LOD.heroPx, TREE_LOD.switchPx, TREE_LOD.impostorPx], hy = TREE_LOD.hysteresis;` (:4108) every frame, so no rebuild is needed.

**1d. Shadow radius override** (issue 16). Before `function placeSun() {` (:5665; anchor the comment `/* the shadow camera follows the player`) add `let shadowRadiusOverride = null;`. In `placeSun`, replace the line `  const targetR = flying > 0 ? 580 : clampf(camera.position.distanceTo(t) * 1.15 + 90, 260, 1150);` with
```js
  const targetR = shadowRadiusOverride ?? (flying > 0 ? 580 : clampf(camera.position.distanceTo(t) * 1.15 + 90, 260, 1150));
```
(`clampf` is already imported from `./engine/geom.js`, :48.) A stepped flight (`setView` from `flightSim`'s track) leaves `flying === 0`, so without this the flight poses get the interactive fit and its 14 m hysteresis steps — a shadow configuration the real bansafari never shows.

**1e. Quality state** (issues 7, 18). Beside `let lowfx = false;` (:1134) add `let autoQualityDone = false;` (declared this early on purpose: a `let` after the `V3D` object would be in its temporal dead zone for a hook called before the module tail runs — the `skyState` lesson in CLAUDE.md). In the auto-quality block (anchor `    if (checked >= 10) {` :8257), directly after `      window.clearInterval(qt);` add `      autoQualityDone = true;`. Verified: the block is `if (!LOWQ) setTimeout(…, 4000)` → `setInterval(…, 1000)` with `if (!fps) return;` before `checked++`, verdict at `checked >= 10 && bad >= 6` → `lowfx = true`, `setPixelRatio(1)` (a no-op under `--force-device-scale-factor=1`), `__bloomNode.strength.value = 0`, `toast('Låg bildfrekvens …', 10000)`; `toast()` (:5814) sets `innerHTML` and only removes the `show` class on its timer, so the text persists but bloom-zeroing has no DOM tell. Under `LOWQ` the block never runs and `autoQualityDone` stays false.

**1f. `?gputime=1` and the renderer hooks** (issues 4, 14). Beside `const FORCE_GL = …` (:1142) add `const GPU_TIME = new URLSearchParams(location.search).get('gputime') === '1';`. In `const mkRenderer = forceWebGL => new THREE.WebGPURenderer({ antialias: true, samples: 4,` add `trackTimestamp: GPU_TIME,` to the parameter object. Verified path: `WebGPURenderer` passes its parameters to `new WebGPUBackend(parameters)` (`WebGPURenderer.js:60–78`); `Backend.js:76` reads `parameters.trackTimestamp`; `WebGPUBackend.js:294` keeps it only with the `timestamp-query` feature (the RTX 3070 adapter lists it); `beginRender` → `initTimestampQuery` (:839, :2255–2268) allocates 2 queries per render context from a 2048-query pool (`WebGPUTimestampQueryPool.js:27`) keyed `prefix:contextId:f<frame>` (`Backend.js:491`); `Renderer.resolveTimestampsAsync('render')` (:2856–2860) returns `Backend.resolveTimestampsAsync` (:597–618), which returns the pool's `resolveQueriesAsync()` value — the SUM of all contexts of the LAST frame in the resolved batch, in ms (`Number(end − start) / 1e6`) — and also writes `info.render.timestamp`. **Pool trap (issue 14):** when `currentQueryIndex + 2 > 2048` allocation returns null (`warnOnce`) and nothing is timed until a resolve resets the index; `_resolveQueries` returns `lastValue` while the result buffer is still mapped. With ~15 contexts a frame the pool holds ~68 frames, so it fills during boot and the first resolve returns a boot-era frame. The sampler in §2.5 handles this (continuous resolves, discard the first two).

After `  frame: () => FRAME_NO,` (:8097) insert:
```js
  /* the renderer's own per-frame counters, read in a rAF callback after the frame that produced them */
  rendererInfo: () => ({ ...renderer.info.render, memory: { ...renderer.info.memory }, autoReset: renderer.info.autoReset,
                         drawingBuffer: [renderer.domElement.width, renderer.domElement.height], pixelRatio: renderer.getPixelRatio() }),
  setFov: f => { camera.fov = +f; camera.updateProjectionMatrix(); return camera.fov; },
  setShadowRadius: r => { shadowRadiusOverride = r > 0 ? +r : null; return shadowRadiusOverride; },
  quality: () => ({ lowfx, lowq: LOWQ, autoQualityDone, pixelRatio: renderer.getPixelRatio(),
                    bloom: renderer.__bloomNode ? renderer.__bloomNode.strength.value : null }),
  /* GPU time of the last complete frame in the resolved batch, ms; null unless ?gputime=1 (see §2.5 for the pool discipline) */
  gpuFrameMs: GPU_TIME ? () => renderer.resolveTimestampsAsync('render') : null,
  frameDiff: IS_GPU ? frameDiff : null,
  frameDiffReset: () => { frameDiffPrev = null; },
```
`renderer.getPixelRatio()` exists (`common/Renderer.js:2000`).

**1g. Mode B `frameDiff`** (issue 8, §3.6). Beside `async function captureReadback() {` (:7819), reusing `captureReadbackTarget`, `captureRenderLocked`, `waitForSubmittedGpuWork` (:7799) and `contiguousRgba8Readback` (:78):
```js
let frameDiffPrev = null;
async function frameDiff() {
  if (!IS_GPU) throw new Error('frameDiff needs the WebGPU backend');
  if (!captureReadbackTarget) {
    captureReadbackTarget = new THREE.RenderTarget(innerWidth, innerHeight, { depthBuffer: true, stencilBuffer: false, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, samples: 1 });
    captureReadbackTarget.texture.colorSpace = THREE.SRGBColorSpace;
  } else if (captureReadbackTarget.width !== innerWidth || captureReadbackTarget.height !== innerHeight) captureReadbackTarget.setSize(innerWidth, innerHeight);
  const w = captureReadbackTarget.width, h = captureReadbackTarget.height, prev = renderer.getRenderTarget();
  captureRenderLocked = true;
  try {
    renderer.setRenderTarget(captureReadbackTarget); renderActivePipeline(); await waitForSubmittedGpuWork();
    const px = contiguousRgba8Readback(await renderer.readRenderTargetPixelsAsync(captureReadbackTarget, 0, 0, w, h), w, h);
    let sum = 0;
    if (frameDiffPrev) for (let i = 0; i < px.length; i += 4) sum += Math.abs(px[i] - frameDiffPrev[i]) + Math.abs(px[i + 1] - frameDiffPrev[i + 1]) + Math.abs(px[i + 2] - frameDiffPrev[i + 2]);
    const mad = frameDiffPrev ? sum / (w * h * 3) : null;
    frameDiffPrev = px;
    return { mad, frame: FRAME_NO, w, h };
  } finally { renderer.setRenderTarget(prev); captureRenderLocked = false; renderActivePipeline(); await waitForSubmittedGpuWork(); }
}
```
This target is `samples: 1` (no MSAA) and bypasses presentation, so Mode B numbers are comparable only with Mode B.

None of 1a–1g touches `trees[]`, `treeWhy[]`, the planter or a material: the fingerprint is unaffected by construction.

## 2. `tools/frame-time.mjs`

```
BANVY_GPU=1 node tools/frame-time.mjs [http://127.0.0.1:8620] [--course puttom] [--frames 300] [--warm 30]
        [--views h1_tee_golden,…] [--thresholds 110/40/14] [--no-vsync-run] [--out tools/goldens/<course>-perf/<runId>]
        [--baseline geo_data/course-v2/<course>/perf/frame-time-baseline.json] [--write-baseline]
```
Refuse to run unless `GPU` from `tools/browser-args.mjs` is true (`process.env.BANVY_GPU === '1'`): under SwiftShader a frame time is not a measurement.

**Run id (issue 1):** `const runId = new Date().toISOString().replace(/[:.]/g, '-')` — an ISO timestamp contains colons, which NTFS forbids; the exact ISO string goes in the JSON `date` field. No existing tool in `tools/` names a file by timestamp; `world-capture.mjs` uses fixed names.

**Provenance, printed FIRST (issues 2, 19):** before booting, print and record `git rev-parse HEAD`, `git status --porcelain` (as an array), `apps/golf/dist/index.html` mtime and the hashed asset names in `apps/golf/dist/assets/` (e.g. `main-CSAq84oR.js` today), `browser.version()`, the launch args. A run is attributed to THAT record, never to a line number in a spec.

### 2.1 Launch
```js
import { chromium } from 'playwright-core';           // 1.55.0, repo root
import { browserArgs, GPU } from './browser-args.mjs';
import { ROOT } from '../geobuild/lib.mjs';
const CHROME = process.env.CHROME || (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? that : undefined);
const UNCAP = ['--disable-frame-rate-limit', '--disable-gpu-vsync'];
const launch = extra => chromium.launch({ ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }), args: [...browserArgs(), ...extra] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
```
`browserArgs()` under `BANVY_GPU=1` is `--no-sandbox --use-angle=d3d11 --enable-gpu --force_high_performance_gpu --ignore-gpu-blocklist --force-device-scale-factor=1`; the last makes the drawing buffer exactly 1920×1080 (`setPixelRatio(min(devicePixelRatio,2))` :1153). The two `UNCAP` flags stay private to this tool (adding them to `browserArgs()` would change every harness's cadence). Two launches per run: uncapped (the measurement) and, unless `--no-vsync-run`, a plain one (the "as the owner sees it" cadence column, §2.5).

### 2.2 Adapter gate (before the app, on the hub page)
Navigate to `${BASE}/` (the chooser, `src/hub.js`, no three.js). NOT `about:blank`: `navigator.gpu` is `[SecureContext]` and about:blank is not one (measured: `hasGpu:false` there, `true` on `http://127.0.0.1` with `isSecureContext:true`).
```js
const adapter = await page.evaluate(async () => {
  const a = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  const info = a?.info ?? null;                       // Chrome 152: GPUAdapter.info; requestAdapterInfo() is gone
  const c = document.createElement('canvas'), gl = c.getContext('webgl2', { powerPreference: 'high-performance' });
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const ts = []; await new Promise(r => { const f = t => { ts.push(t); ts.length < 60 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); });
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((x, y) => x - y);
  return { isSecureContext, webgpu: info && { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description,
             isFallbackAdapter: info.isFallbackAdapter, timestampQuery: a.features.has('timestamp-query'), maxVertexBuffers: a.limits.maxVertexBuffers },
           webgl: gl && { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) },
           rafMs: { median: d[d.length >> 1], min: d[0], max: d[d.length - 1] } };
});
```
Gates: `webgpu.vendor === 'nvidia'` and `!isFallbackAdapter`; `/RTX 3070/.test(webgl.renderer)` (Chrome leaves `device`/`description` blank; the WebGL string is `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Laptop GPU (0x000024DD) Direct3D11 vs_5_0 ps_5_0, D3D11)`); `timestampQuery === true` (needed for the GPU column). Cadence: on the uncapped launch `rafMs.median < 3` means the cap is lifted; measured WITHOUT the flags the hub page ticks at a fixed 6.1 ms (median 6.1, min 6.0, max 6.2 over 40 frames — a ~165 Hz cadence that quantises every interval to multiples of ~6.06 ms). **If the cap is still on with the flags (untested here), do not abort (issue 4):** mark the rAF columns `quantised:true`, make `gpuMs` the primary number for that run, and print a WARN line. Record the cadence in the JSON either way.

### 2.3 Boot and the quality window
URL: `${BASE}/?bana=${course}&det=1&v2=require&gputime=1&ren=1&skylt=0&hal=1&vy=tee&ljus=kvall`. `ren=1` → `setClean(true)` (:7769, DOM only); `skylt=0` keeps marker sprites off in Ovan; `gputime=1` enables the timestamp pool (1f). Collect `pageerror` and console errors/warnings as `world-capture.mjs` does, but IGNORE the one expected warning `WebGPUTimestampQueryPool [render]: Maximum number of queries exceeded` (the pool fills during boot by design; §2.5 drains it). `await page.waitForSelector('#boot.done', { timeout: 300000 })`.

**Quality gate (issues 7, 18):** `await page.waitForFunction(() => window.V3D.quality().lowq || window.V3D.quality().autoQualityDone, null, { timeout: 40000, polling: 250 })` — exact, not a 15 s guess: the verdict lands ≥14 s after `done` only if every 1 s tick counted, and a harness task can delay ticks. Then assert `quality().lowfx === false` and `quality().bloom === bloomAfterBoot` (read once right after `done`; the golden preset's 0.14). Re-read `quality()` at the END of the run and FAIL if `lowfx` ever became true, because bloom was silently zeroed mid-run. Then the remaining gates: `stats.backend === 'webgpu'`, `v2Terrain().kind === 'graph' && status === 'ready'`, zero page errors, and the population gate of §5.1. Record `perf()`, `stats`, `treeTiers().bakeMs`, `quality()`.

If `--thresholds h/s/i` is given, call `V3D.setTreeThresholds({heroPx:h, switchPx:s, impostorPx:i})` once here, before any view; one boot per setting (a cell's hysteresis state after a walk depends on its history, so two settings in one boot are not the same experiment). Record `treeTiers()`'s thresholds in every view row.

### 2.4 Views
| id | how to set | note |
|---|---|---|
| `h1_tee_golden` | `setPreset('golden'); goHole(1,true,true); setCam('tee',true)` | plan's view 1 |
| `h12_tee_golden` | same, hole 12 | par 3 over the bay |
| `h14_tee_golden` | same, hole 14 | the far-hill impostor view |
| `h7_top_noon` | `setPreset('noon'); goHole(7,true,true); setCam('top',true)` | Ovan, 330 m up; hero tier must be 0 |
| `h7_flight_cruise_golden` | `const s = V3D.flightSim(7, 1/60)`; `k = argmax clear` over `track` with `t < s.orbitT`; `setView(k.x,k.y,k.z,k.lx,k.ly,k.lz); setFov(k.fov); setShadowRadius(580)` | cruise = top of the climb; the flight's own shadow fit (issue 16); afterwards `setFov(48); setShadowRadius(null)` |
| `h12_orbit_golden` | `setPreset('golden'); goHole(12,true,true); setCam('orbit',true)` | the chooser poster (`POSTERS.puttom[0]` in `tools/make-posters.mjs:129` is hole 12 orbit golden) |
| `h1_walk_golden` (moving, issue 10) | §2.6 | the only row that can see a crossfade's cost |

Settle before a static measurement (issue 8: the stream reports `loadingTiles === 0` the instant a decode resolves, BEFORE the next `terrainV2.update` draws the tile; and the tier decision lags the camera by one frame):
```js
const settle = async () => {
  const f0 = await page.evaluate(() => window.V3D.frame());
  await page.waitForFunction(f => { const V = window.V3D; return V.frame() >= f + 2 && V.settled() && (V.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0; }, f0, { timeout: 120000, polling: 50 });
  const f1 = await page.evaluate(() => window.V3D.frame());          // two MORE frames after the stream went quiet
  await page.waitForFunction(f => window.V3D.frame() >= f + 2 && window.V3D.settled(), f1, { timeout: 120000, polling: 20 });
};
```

### 2.5 Static measurement — CPU window, then GPU window, same view
**CPU window** (rAF intervals). `frameStart` is read SYNCHRONOUSLY inside the evaluate before the first `requestAnimationFrame` (issue 5), and the invariant is `warm + n + 1` (issue 15 — issue 5's `warm + n` is wrong: the callback runs on ticks k = 0…warm+n, i.e. warm+n+1 ticks, the app's `frame()` runs before the harness callback on every one of them, and the n+1 timestamps from k ≥ warm give n intervals):
```js
const m = await page.evaluate(({ n, warm }) => new Promise(resolve => {
  const V = window.V3D, frameStart = V.frame(), ts = [], tris = [], draws = [], calls = [];
  let k = 0;
  const cb = t => {
    if (k >= warm) { ts.push(t); const r = V.rendererInfo(); tris.push(r.triangles); draws.push(r.drawCalls); calls.push(r.frameCalls); }
    if (++k < warm + n + 1) requestAnimationFrame(cb);
    else resolve({ frameStart, frameEnd: V.frame(), ts, tris, draws, calls, fps: V.fps(), tiers: V.treeTiers(), cam: V.camInfo(), fov: V.cameraInfo().fov,
                   mem: V.rendererInfo().memory, stream: V.v2Terrain().adapter?.stream ?? null, quality: V.quality() });
  };
  requestAnimationFrame(cb);
}), { n: 300, warm: 30 });
// FAIL the view unless m.frameEnd - m.frameStart === warm + n + 1 (fewer: the loop skipped ticks and the intervals are not frame times)
```
`--frames` defaults to 300 (issue 9): with 120 frames the p95 is the 6th-worst interval and one GC pause or tile upload moves it by far more than 10%. Report per view: `cpuMs { median, p95 (nearest rank), mean, min, max }`, `triangles`/`drawCalls`/`frameCalls` as the MODE of the per-frame arrays plus the list of DISTINCT values with counts (a static view must be constant; a second value means a stream event, which is then visible as such rather than as a frame-time outlier).

**GPU window** (issue 14), immediately after, same view, continuous resolves with one in flight at a time:
```js
const g = await page.evaluate(({ n }) => new Promise(resolve => {
  const V = window.V3D, samples = []; let pending = false, k = 0;
  const cb = () => {
    if (!pending) { pending = true; const f = V.frame(); V.gpuFrameMs().then(ms => { samples.push({ f, ms }); pending = false; }); }
    if (++k < n) requestAnimationFrame(cb); else setTimeout(() => resolve(samples), 200);
  };
  requestAnimationFrame(cb);
}), { n: 300 });
```
Discard the first two samples (they drain the boot-filled pool and may be a partial frame), and any sample below 0.5 × the median (a frame split by a resolve — count them as `gpuPartial`). Report `gpuMs { median, p95, samples }` — expect ~150–300 samples (a `mapAsync` round trip is one or two frames). Consistency check, printed per view: `gpuMs.median ≤ cpuMs.median + 1 ms` — a GPU time above the interval means the loop is not back-pressured and the rAF number is not a frame time; on the uncapped launch this flags the case issue 4 describes (GPU-bound view under-reported by rAF). Pool capacity is `floor(1024 / frameCalls)` frames; with continuous resolves it never fills during a window.

**vsync-on column.** The second (plain) launch repeats boot + the six static views with the CPU window only and reports `vsyncMs { median, p95 }` — the cadence a user sees (quantised to the display's refresh; report it as such).

### 2.6 The walk row `h1_walk_golden` (issue 10)
A settled static view has, by definition, no tier change, so no static row can observe a crossfade that only runs while a cell switches. The walk advances one pose per rAF along hole 1 using the §3.1 pose generator with `step = 1.0` m and `maxSteps = 300` (300 m of the 320 m hole): the harness callback applies pose k at the end of tick k (`V.setView(...)`; the app renders it on tick k+1) and records the interval, `rendererInfo().triangles` and `treeTiers().switches` on every tick. Report `median, p95, max` of the intervals, `trianglesMax`, and `switchFrames` (ticks with Δswitches > 0, with their interval). `setShadowRadius(null)` (a walk is interactive). A GPU window is run over the same walk (a second pass over the same poses; the hysteresis state differs on the second pass, which is acceptable for a timing row and is stated in the JSON as `pass: 2`).

### 2.7 Output and gates
Full record → `tools/goldens/<course>-perf/<runId>/frame-time.json` (gitignored, `.gitignore:3` `tools/goldens/`):
```
{ tool, date, runId, git: { head, status[] }, dist: { indexMtime, assets[] }, chrome: { version, args[], uncap[] },
  adapter, viewport: [1920,1080], url, thresholds, boot: { seconds, perf, stats, bakeMs, quality },
  views: [{ id, hole, cam, preset, pose: { pos, look, fov, shadowRadius }, frames, frameStart, frameEnd,
            cpuMs: {…}, intervals[], gpuMs: {…}, gpuSamples[], gpuPartial, vsyncMs: {…},
            triangles, drawCalls, frameCalls, distinct: { triangles: [[v,count]…], drawCalls: […] }, memory,
            tiers: { tier0..tier3, cellsVisible, heroPx, switchPx, impostorPx }, stream: { renderedTiles, drawCalls } , walk?: { trianglesMax, switchFrames[] } }],
  gates: [{ ok, label }] }
```
Committed summary (issue 17): `--write-baseline` writes everything except `intervals[]`/`gpuSamples[]` (~10–15 KB) to `geo_data/course-v2/<course>/perf/frame-time-baseline.json` with `\n` line endings (`.gitattributes` already declares `geo_data/**/*.json text eol=lf`; the manifest gate `packages/course-geo/check-manifests.mjs` validates only the artifacts each `source-manifest.json` lists, so an unlisted file under `perf/` cannot trip it — verified :27–45). `--baseline` defaults to that path when it exists. The hand-pasted table in `docs/tree-lod-plan.md` is for reading; the committed JSON is what `--baseline` reads.

Console: a provenance header, then one row per view `id  cpu med/p95  gpu med/p95  vsync med  tris  draws  calls  t0/t1/t2/t3`.

**Regression gates with `--baseline`** (issue 9, 10), exit non-zero on any: static rows — `cpuMs.median` worse by >10%, `cpuMs.p95` worse by >25%, `gpuMs.median` worse by >10%, `triangles` (mode) by >5%; walk row — `median` >10%, `p95` >25%, `trianglesMax` >15%, `gpuMs.median` >10%. **Which gate covers which change:** the owner's threshold change (a static cost) is judged on the six static rows; phase 4's crossfade (two tiers drawn for 0.25 s only while a cell switches) is judged on the walk row's p95/max and `trianglesMax`, never on a static row. The percentages are first-run placeholders; the plan sets the budget from the record, as it says.

### 2.8 Run time (estimate, labelled as one)
Boot ~17 s + quality window ≤ 16 s + 6 static × (settle ≤ 1 s + 300 CPU frames ≈ 4.5 s + 300 GPU frames ≈ 4.5 s) + walk 2 × 300 frames ≈ 90 s; plus the vsync-on launch ≈ 60 s. About 3 min. The tool prints measured per-view durations so the next estimate is a measurement.

## 3. `tools/tree-pop-meter.mjs`

```
BANVY_GPU=1 node tools/tree-pop-meter.mjs [http://127.0.0.1:8620] [--course puttom] [--paths h1,h5,h12,f7] [--step 1.5] [--max-steps 200]
        [--ref 2] [--trees-only] [--per-frame] [--thresholds 110/40/14] [--force-pop k] [--keep-png]
        [--out tools/goldens/<course>-pop/<runId>] [--baseline geo_data/course-v2/<course>/perf/pop-baseline.json] [--write-baseline]
```
Requires `BANVY_GPU=1`, always boots with `det=1` (§4), launches WITHOUT the uncap flags (nothing is timed; leave the cadence as a user sees it). Boot URL as §2.3 without `gputime=1`; same provenance header, quality gate and population gate; `ren=1` so the DOM (card, rail, the minimap canvas that redraws every frame) is not in the picture. Run id and output rules as §2.

### 3.1 Poses (computed once in the page, reused by every pass)
```js
await page.evaluate(() => {
  const V = window.V3D;
  window.__pm = {
    walk(n, step, maxSteps, lookAhead = 120, eye = 2.4, aimUp = 3, stopShort = 20) {
      V.goHole(n, true, true); V.setCam('tee', true);
      const h = V.HOLES[n - 1], c = V.camInfo().pos;               // the tee camera: mark − 7 m at terrainH + 2.4
      const P = [[c[0], c[2]], ...h.line.slice(1).map(p => [p[0], p[1]])];
      const gc = h.green.c; if (Math.hypot(P[P.length - 1][0] - gc[0], P[P.length - 1][1] - gc[1]) > 4) P.push([gc[0], gc[1]]);
      const seg = []; let tot = 0; for (let i = 0; i + 1 < P.length; i++) { const d = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); seg.push(d); tot += d; }
      const at = s => { s = Math.max(0, Math.min(tot, s)); for (let i = 0; i < seg.length; i++) { if (s <= seg[i] || i === seg.length - 1) { const t = seg[i] ? s / seg[i] : 0; return [P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t]; } s -= seg[i]; } };
      const N = Math.min(maxSteps, Math.floor((tot - stopShort) / step)), poses = [];
      for (let i = 0; i < N; i++) { const p = at(i * step), l = at(i * step + lookAhead);
        poses.push({ pos: [p[0], V.probeH(p[0], p[1]) + eye, p[1]], look: [l[0], V.probeH(l[0], l[1]) + aimUp, l[1]], fov: 48, shadowRadius: null }); }
      return { hole: n, lengthM: tot, poses };
    },
    flight(n, seconds, every) {
      const s = V.flightSim(n, 1 / 60); if (!s) throw new Error('flightSim refused (flying?)');
      return { hole: n, duration: s.duration, orbitT: s.orbitT, poses: s.track.filter((k, i) => i % every === 0 && k.t <= seconds)
        .map(k => ({ t: k.t, pos: [k.x, k.y, k.z], look: [k.lx, k.ly, k.lz], fov: k.fov, clear: k.clear, shadowRadius: 580 })) };
    },
  };
});
```
Hole 1: 200 poses (300 m of 320); hole 5: ~103; hole 12: ~68 (`--step` 1.5 m so the per-step motion is the same on every hole). Flight 7: `flight(7, 20, 6)` → 200 poses at 0.1 s over the push-off and climb, each with the flight's fov (52→46 via `setFov`) and the flight's fixed 580 m shadow radius (issue 16). Eye 2.4 m is the app's own tee-camera height; the loop's `terrainH + 1.7` clamp never binds.

Apply a pose: `V.setView(...pos, ...look); V.setFov(fov); V.setShadowRadius(shadowRadius);`.

### 3.2 Passes
For each path, in ONE boot, in this order:
- **A — automatic tiers**: `V3D.setTreeLod(0)`; walk the poses.
- **R — reference**: `V3D.setTreeLod(--ref, default 2)`; walk the same poses. Force is applied to every in-frustum cell every frame, so the hysteresis state left by A is irrelevant to R; A runs first and only once per boot (from a forced state the hysteresis walk differs from a cold approach). `--repeat` = a second boot, never a second A pass.
- `--trees-only` (diagnostic, not the default gate): A′ and R′ with everything but the trees hidden — `setMeshesVisible({}, false); setMeshesVisible({world:true}, false); setWaterVisible(false); setMeshesVisible({tag:'trees'}, true)`; the tier update re-shows its own batches (:4145). The far ring (`tag:'vista'`, :4280), sky and ground are hidden. Restore afterwards. Use it to see how much of a pop's magnitude is trees against ground, not for the gate — the owner sees the whole scene, and the block metric of §3.5 localises a pop regardless of the ground.

### 3.3 Per pose
```js
await page.evaluate(p => { const V = window.V3D; V.setView(...p.pos, ...p.look); V.setFov(p.fov); V.setShadowRadius(p.shadowRadius); }, pose);
await settle();                                              // §2.4 incl. the +2 frames after loadingTiles === 0 (issue 8)
const tS = Date.now(); const png = await page.screenshot({ type: 'png', timeout: 120000, animations: 'disabled', caret: 'hide' }); const shotMs = Date.now() - tS;
const st = await page.evaluate(() => { const t = window.V3D.treeTiers({ cells: true }); return { t: [t.tier0, t.tier1, t.tier2, t.tier3], v: t.cellsVisible, upd: t.updates, mov: t.moves, sw: t.switches, states: t.cellStates, counts: t.cellCounts }; });
```
Decode with `decodePNG` from `geobuild/png.mjs` (`{width,height,channels,data}`; pure JS, timed as `decodeMs`). Keep only the previous pose's decoded RGB (and `E[i−1]`, §3.5) in memory; write PNGs only under `--keep-png`. Shoot pose 0 twice (`A0`, `A0′`) for the noise floor. Print per pose `settleMs shotMs decodeMs` (issue 20) and keep them in the JSON so the run-time estimate becomes a measurement.

### 3.4 Why `page.screenshot`, not the readback
`page.screenshot` is the presented swapchain image: 4× MSAA resolved (`antialias:true, samples:4` :1143), tone-mapped, bloomed — what the owner sees, and what `world-capture.mjs`/`vegetation-baseline.mjs` already captured on this GPU (`puttom-world` goldens, `backend:"webgpu"`). `captureReadback` re-renders into a `samples:1` target, PNG-encodes on the main thread and base64s through `evaluate` — slower and a different picture. Before and after must use the same path. The luminance guard (`check-app.mjs:314`: mean > 0.05·255, dark fraction < 0.85) on the FIRST screenshot is mandatory (the comment at :7803 records presentation screenshots being unreliable on headless SwiftShader; on the GPU path the goldens prove it works, and the guard proves it per run).

### 3.5 Metrics (per path; units /255 over RGB; issues 11, 12, 3)
Same-pose quantities (camera motion cancels exactly because A[i] and R[i] are the same pose):
- `e[i] = MAD(A[i], R[i])` — the tiered picture's distance from the reference; `j[i] = |e[i] − e[i−1]|` — the whole-frame LOD jump.
- `E[i] = A[i] − R[i]` per pixel and channel (Int16); `ΔE[i] = |E[i] − E[i−1]|`; mean over 60×60 blocks (32×18 = 576 blocks at 1920×1080); **`popPeak[i] = max block mean`** — what a viewer's eye catches: one cell switching at 130 m changes ~1% of the frame, which is ~0.1–0.5/255 whole-frame but tens/255 in its block.
Diagnostics (kept, not gated): `d[i] = MAD(A[i], A[i−1])`, `m[i] = MAD(R[i], R[i−1])`, `x[i] = max(0, d − m)`. The first draft gated on `x`; the review is right that `m` is not A's motion baseline (R draws every in-frustum cell out to MIDR as 204–436-triangle meshes, which alias under motion differently from impostor quads), so `x` is a small difference of two large numbers from two different scenes — SNR near 1 at a single-cell switch.
- `floor = MAD(A0, A0′)` and `floorPeak` (its block max).

**Attribution, exact (issue 12; issue 3's formula is dropped):** diff `states[i]` against `states[i−1]` per cell: `a→b` with `a≠0, b≠0, a≠b` is a tier switch (attributed; record the cell index, `a→b`, and `counts[c]` trees); `0↔n` is a frustum entry/exit (not a switch). Per step: `switchedCells`, `switchedTrees`, and the per-boundary breakdown `{ '1|2', '2|3', '3|4' }` in both directions — the hero|full, full|decimated, decimated|impostor split the owner's complaint needs. Self-consistency assertion: `Δsw` (from the 1a counter) `=== switchedTrees` on every step, else FAIL the run (the counter and the state diff are independent bookkeeping of the same moves). A step is `attributed` iff `switchedTrees > 0`.

**τ from the data, not a literal:** `τ_j = max(3·floor, p99 of j over unattributed steps)` and `τ_peak = max(3·floorPeak, p99 of popPeak over unattributed steps)`; on a 1.5 m walk most of a path's 200 steps switch nothing, so the unattributed set is large. Print both and the count of unattributed steps they came from.

Path summary (the before/after numbers): `popPeakMax = max popPeak over attributed steps`, `popPeakP95`, `popJumpMax = max j over attributed steps`, `popSum = Σ j over attributed steps`, `popCount = #{attributed ∧ popPeak > τ_peak}`, `unattributedPeakMax = max popPeak over unattributed steps` (a rise there means the change touched something other than the tiers: tiles, shadow fit, water), `lodErrMean = mean e`, `floor`, `floorPeak`, `τ_j`, `τ_peak`, `steps`, per-boundary switch counts, and the per-step arrays `d, m, x, e, j, popPeak, switchedCells, switchedTrees, boundary, dUpd, dMov, dSw, tiers, settleMs, shotMs, decodeMs`.

**Gate for phase 4 (crossfade)** against a baseline from the same tool/machine/Chrome/dist/viewport/capture path/reference tier: on every path `popPeakMax ≤ 0.5 × baseline.popPeakMax` and `popSum ≤ 0.5 × baseline.popSum`; `unattributedPeakMax ≤ baseline.unattributedPeakMax + 3·floorPeak`; and `frame-time.mjs`'s walk-row gate (§2.7). A temporal crossfade is judged in Mode B (§3.6), because a post-settle screenshot sees the fade as a small jump at pose i and the remainder at pose i+1.

**Gate for the owner's first ask (thresholds further out):** `--thresholds` sweeps, one boot per setting (e.g. `110/40/14`, `90/32/11`, `80/28/10`); compare `popPeakMax`/`popPeakP95` per boundary against the frame-time static rows for the same setting. The expected shape: each switch happens at a smaller projected size, so `popPeak` falls while the static triangle count rises; the setting the owner accepts by eye is then a recorded pair of numbers.

**Positive control (issue 13), its own boot, `--force-pop k`:** at step k call `setTreeThresholds({ switchPx: 48 })` (×1.2) and at step k+1 restore `40`. This moves the coarser 2|3 boundary from 404 m to 337 m (§6), so exactly the tier-2 cells between 337 and 404 m switch to tier 3 at step k+1 — a realistic pop of a few cells, not 13,000 trees at once. Expect at step k+1: `switchedCells ≥ 1` on boundary `2→3`, `popPeak[k+1] > τ_peak`, `j[k+1] > τ_j`; expect NO reverse switch at k+2 (with 40 restored, those cells step finer only past 331 m — hysteresis — so they come back when the walk brings them there). The JSON is marked `control:true` and is never accepted as a baseline. The old `setTreeLod(4)` control is dropped: it proved the meter was not dead, not that it resolves a single-cell switch.

### 3.6 Mode B — per frame (`--per-frame`, the `frameDiff` hook)
Call `frameDiffReset()` once at the start of each path, NOT per pose. At each pose after `setView` and the settle: take K = 24 `frameDiff()` samples, each after `V3D.frame()` has advanced by one, the first at frame f0+3 (the settle's +2 plus the engine's one-frame tier lag, issue 8; the JSON says `peak` includes that lag). Sample 1 at pose i is the cross-pose diff (the analogue of `d[i]`); `peak[i] = max_j mad_j`; `static[i] = Σ_{j≥2} mad_j` (exactly 0 after settle with a hard switch; > 0 while a fade runs). R-pass Mode B gives the motion analogue `m`. The crossfade gate then reads `max peak` over attributed steps. Mode B numbers (samples:1 target) are comparable only with Mode B. Ship it with the first version (~20 lines, `IS_GPU` only); it is what makes the crossfade judgeable at all.

### 3.7 Output
`tools/goldens/<course>-pop/<runId>/pop.json` (full arrays) + `paths.csv` (`path,step,d,m,x,e,j,popPeak,switchedCells,switchedTrees,boundary,dUpd,dMov,dSw,t0,t1,t2,t3,settleMs,shotMs,decodeMs`) + PNGs under `--keep-png`; `--write-baseline` → `geo_data/course-v2/<course>/perf/pop-baseline.json` (summaries only, LF, ~10 KB) which `--baseline` reads by default. Console: provenance header; per path one summary line and the five largest `popPeak` with step, boundary, `switchedTrees` and tier vectors.

### 3.8 Run time (estimate; the tool measures it)
571 poses per pass; per pose ≈ settle (4 frames + polling) + screenshot + decode. No screenshot or decode timing exists in the repo yet, so the first run's printed `settleMs/shotMs/decodeMs` medians ARE the budget; the working guess is 0.3–0.5 s per pose → A + R ≈ 6–10 min, `--trees-only` doubles it, Mode B adds ~1 s per pose. `page.setDefaultTimeout(900000)`; screenshots `timeout: 120000`.

## 4. det=1, moving cameras, like with like
- `?det=1` (`const DET` :85) replaces the TSL `time` uniform with `float(3.25)` (:88); `windSway` (:3927) is a function of it, so every crown is frozen — without det the meter measures wind. det pins the flag cloth, water and clouds and disables the device sniff, so `LOWQ` and the 110/40/14 thresholds are the desktop ones. det does not pin the camera; both tools place it through `flyTo(…, 0)`. The shaders still evaluate the sway with a constant, so frame times under det are representative.
- The pop meter's poses are static snapshots after settle; a live `V3D.fly()` is wall-clock-driven (:7677) and not pose-reproducible, so the flight is stepped from `flightSim`'s track with the flight's fov and shadow radius applied explicitly.
- A before/after pair must share machine, Chrome (`152.0.7977.66` today), flags (the frame-time tool's uncap flags included), viewport, `dist` build (the provenance header), capture path, reference tier and thresholds. Compare runs of the same tool only; `--baseline` refuses a baseline whose `viewport`, `capture`, `refTier` or `thresholds` differ, and warns when `chrome.version` or `dist.assets` differ.

## 5. Test plan
1. **Self-checks every run (FAIL the run):** adapter vendor/name/timestamp-query (§2.2); `backend === 'webgpu'`; `v2Terrain().kind === 'graph'`; `quality().lowfx === false` at the quality gate AND at the end; no page errors (the pool warnOnce excepted); first screenshot is a picture (luminance rule); frame-time: `frameEnd − frameStart === warm + n + 1` per static view, `gpuMs.median ≤ cpuMs.median + 1`; pop meter: `Δsw === switchedTrees` on every step, `A0/A0′` floor < τ/3, R-pass smoothness (`m` jumps above its own moving baseline are printed as `refSpikes` — tiles, water, the shadow fit — and reported, not gated).
   **Population gate (issue 20):** expected count = `runs.find(r => r.url.includes('v2=require')).trees.total` from `geo_data/course-v2/<course>/vegetation/phase4-vegetation.json` (79407 for puttom, verified at `.runs[1]`); assert `V3D.stats.trees === expected` and `V3D.legacyTrees().total === V3D.stats.trees`; if the file is absent for the course, record both numbers and print `skip` rather than fail.
2. **Positive control:** `--force-pop 40` on hole 1 in its own boot registers an attributed `2→3` switch at step 41 with `popPeak > τ_peak`.
3. **Repeatability:** `--repeat` (second boot) reproduces each path's `popSum` within 10% and `popPeakMax` within 15%; frame-time medians within 5%.
4. **Pose determinism:** per-pose `pos/look/fov/shadowRadius` from two boots are byte-identical.
5. **Hooks:** `pnpm test` unaffected; `tools/lint-app.mjs` passes on `main.js`; `tools/boot-profile.mjs --fingerprint` identical to the branch baseline; `check-app` on puttom passes; `tools/tree-tiers-at.mjs` output unchanged (its `treeTiers()` call gains keys, loses none). A boot WITHOUT `?gputime=1` must not construct a query pool (`gpuFrameMs === null`).
6. **First real run:** `--write-baseline` on both tools, commit the two summaries, and add a "Phase 0 measured" section to `docs/tree-lod-plan.md` with the seven-row frame-time table (cpu/gpu/vsync), the four path summaries with per-boundary switch counts, and the provenance header.

## 6. Derived numbers to print in the reports (issue 6)
Boundary distance for the nominal 12 m tree: `d = 12 · rows / (2 · px · tan 24°)` (:4113, fov 48). Derive the bands in code from `treeTiers().hysteresis`, never by hand: **finer** when `px > thr·(1+hy)` ⟺ `d < d_thr/(1+hy)`; **coarser** when `px < thr·(1−hy)` ⟺ `d > d_thr/(1−hy)` (:4125–4126). At 1080 rows: d_thr = 132.3 / 363.9 / 1039.6 m; finer at 120 / 331 / 945 m; coarser at **147 / 404 / 1155 m** (the first draft's 145/400/1144 used d×1.1 instead of d/0.9). At 900 rows: 110.3 / 303.2 / 866.3; finer 100 / 276 / 788; coarser 123 / 337 / 963. The walks cross the hero and full boundaries for every cell ahead of the camera and the impostor boundary for the far ones; the flight climbs through all three.

## 7. Review ledger — where each issue landed
1 run id → §2 (colon-free). 2, 19 anchors/provenance → §0, §1, §2 header. 3 switches counter → 1a (kept as the cross-check of 12). 4, 14 GPU time → 1f, §2.5 (pool drain, consistency check, vsync column, no abort on a capped cadence). 5 vs 15 → §2.5: 15 is right (`warm+n+1`), 5's `warm+n` is wrong and is stated so. 6 bands → §6. 7, 18 quality → 1e, §2.3. 8 settle → §2.4, §3.6. 9 frames/gate → §2.5, §2.7. 10 walk row → §2.6, §2.7. 11 metrics → §3.5 (j and popPeak gated, τ from data, x diagnostic). 12 exact attribution → 1b, §3.5. 13 thresholds hook, realistic control, sweep → 1c, §3.5. 16 shadow radius → 1d, §2.4, §3.1. 17 committed baseline → §2.7, §3.7. 20 timings and population gate → §3.3, §5.1.
