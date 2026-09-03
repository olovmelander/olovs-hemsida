# Tree LOD phase 4 (revised after review): invisible tier switches on the RTX 3070 — dithered crossfade, per-tree tiering, sweepable thresholds, and instruments that can fail

## Summary
Keep the design's core — a screen-space 4×4 Bayer crossfade carried by `material.maskNode` (honoured identically by the colour pass and the shadow pass), a per-instance `aFade` vec2 that keeps every pipeline at ≤ 6 of the 8 WebGPU vertex buffers, and per-tree tiering inside the 128 m frustum cells with each tree's own height — and fold in all 18 review issues. The anchors are re-listed against the working tree (8280 lines over HEAD 0a37b07 at 8153; the uncommitted weather/rangefinder + bansafari diff shifts the tree code by +2 and the V3D block by +127) with grep strings, and the diff must be committed or stashed first. The f32 quantisation hazard is closed by a 1/64-level epsilon in both twins, a drain one level late, a reversal placed half a level inside its level, and a 512 s epoch rebase of the fade clock. The stride skip now evaluates a cell on the frame it becomes visible; the module imports `three/webgpu`; `flat, either` interpolation; per-species hero triangle counts from three's actual cone topology (1,068 / 764 / 1,660, and the method reproduces the plan's 204/212/436). The pop-meter is redesigned so it can fail for the right reason: a driven fade clock stepped level by level, an in-page `pixelDelta`, a `freezeTreeTiers` A/B that isolates tiering from camera motion, an annulus trigger through `setTreeLodPx`, and a baseline run on today's cell build that must show the spike before the new build is measured. Gate (c) becomes GPU milliseconds via `trackTimestamp` with an uncapped frame rate, not vsync-locked RAF intervals; `updateMs` gets a numeric gate (p95 ≤ 1 ms, including a view down MIDR's long axis); the per-tree commit is gated STRICT under `?lod=1..4` on the 12 golden views plus a `treeTierAudit`; and the fingerprint gate names its placement keys and reports `draws` beside them instead of treating a rendering count as a placement fact. Proposed 64/24/8 px defaults remain a hypothesis for the sweep.

## Files
- apps/golf/src/main.js
- apps/golf/src/engine/tree-fade.mjs
- apps/golf/src/engine/tree-fade.test.mjs
- apps/golf/src/engine/tree-impostor.mjs
- tools/golden-views.mjs
- tools/goldens.mjs
- tools/browser-args.mjs
- tools/tree-pop-meter.mjs
- tools/tree-tiers-at.mjs
- docs/tree-lod-plan.md
- docs/puttom-performance-status.md

## Risks
- The uncommitted weather/rangefinder + bansafari diff (265 lines in main.js, untracked engine/weather.js and rangefinder.js) must be committed or stashed before this work; otherwise every gate compares two different trees and every anchor in this spec is off by 2 or 127 lines.
- Per-tree tiering changes which tier every tree sits in at the old thresholds; the strict gate for that commit therefore runs under ?lod=1..4 (forced tiers), and the decision change itself is judged perceptually and by eye.
- The maskNode discard runs in every crown/trunk/impostor fragment and in the shadow pass; it removes early-z for those pipelines on some drivers. Its own cost is measured once (commit 1 vs HEAD at 110/40/14, GPU ms) before any threshold is moved.
- Screen-space dither without TAA can read as a 0.3 s shimmer on 60-110 px trees; fallback is bayer8 (one function, one test) or a shorter hero-boundary fade.
- A tree crossing two thresholds within 0.32 s (tour cuts / goHole jumps only, at these spacings) shows a partial pop of the residual; accepted and documented.
- The CPU twin decides a reversal from its own f; if raw*16 + 1/64 is within an f32 ULP of an integer at that instant (~1e-4 per event) the reversed tree steps by one level (1/16 of its pixels) for one frame.
- The per-tree update loop has never been timed; the spec gates updateMs p95 <= 1.0 ms on the 3070 including a ~30k-tree long-axis view, with stride 2 as the fallback. Phones are gated on a 4x CPU-throttle emulation, not a device.
- The GPU-ms gate depends on Chrome exposing timestamp-query to three's backend on the 3070; the tool fails loudly if trackTimestamp is false and the fallback launch flag (--enable-dawn-features=allow_unsafe_apis) is unverified from this repo.
- Proposed defaults 64/24/8 px roughly triple hero and full counts (~2.3 M scene triangles by the weighted per-species counts, ~4.6 M with the shadow pass); they are a sweep starting point and must not be committed before gate 6.4.
- The dolly meter cannot show the fade lowering steady-state per-frame change (it cannot, by arithmetic); it gates spike ratios, and its instrument check on today's build must pass first or the tool is measuring nothing.
- The fade queue extends V3D.settled() by up to 0.32 s only when the fade is enabled and the clock is not driven; under det (default instant) harness timing is unchanged.
- Under the driven clock the fade queue never drains unless the meter advances the clock; settled() therefore excludes the queue term when clockDriven, and a meter that forgets to advance the clock leaves OUT entries drawn (fully discarded) rather than removed.

## Open questions
- Does the owner want the hero trunk's mean brightness normalised to the full tier's (bark.mul(0.6).add(0.70)), or is the darker hero trunk part of the intended near look?
- Should LOWQ thresholds (200/60/22) move at all before a phone is measured, and is a 4x CPU-throttled Chrome an acceptable stand-in for the per-tree updateMs gate there?
- Is a 4x4 Bayer at 0.3 s acceptable by eye on the 3070 for the 60-110 px hero boundary, or is 8x8 / 0.4 s preferred there?
- Does the RTX 3070's Chrome expose timestamp-query to three's WebGPU backend without --enable-dawn-features=allow_unsafe_apis (expected since Chrome 121, quantised to 100 us)? The sweep tool fails loudly either way; the plan should record which path it took.
- If the per-tree loop measures above 1 ms p95 on the long-axis view, is stride 2 on desktop (one extra frame of latency on half the cells) acceptable, or should the two-level 32 m variant be built instead?
- Should the dolly's absolute per-frame change on the new build be gated against today's (e.g. max <= 1/4 of today's max), given the two builds' switch sets differ by design, or reported only as this spec proposes?

## Evidence
- Working tree apps/golf/src/main.js = 8280 lines; git show HEAD:apps/golf/src/main.js = 8153 lines; HEAD = 0a37b07; git diff hunks at 65 (+2), 5709, 5781 (+1), 5938, 5949, 6258, 6268, 6591 (+13), 6628 (+106), 7012 (+3), 7765 (+2); git status: M CLAUDE.md, apps/golf/index.html, apps/golf/src/main.js, tools/check-flight.mjs; D tmp-dump.mjs; untracked engine/rangefinder.js(+test), engine/weather.js(+test), docs/banvy-blueprint.md.
- Working-tree anchors verified by grep: DET 85, time pin 88, bootStarted 95, LOWQ 1131, mkRenderer 1143, IS_GPU 1160, captureRenderLocked 1164, PerspectiveCamera(48,...) 1167, MIDR 1523, stats decl 1543, grownCrown 3333, SPECIES 3352, templateHeight 3398, WHY_V2_INDIVIDUAL 3558, legacyTreeExport 3721, TREE_LOD 3776, thresholds 3781, stats 3787, heroTrunk 3854, fineCrowns 3860, barkMaterial 3901 (bark line 3904), crownMaterial 3908, trunkMaterial 3919, windSway 3927, impostorBatch 3953, cell 3970, cell record 3977 (lists: [[], [], []]), varied 3996, c.lists[s].push 4002, c.y1 4004, tier 4010, treeTierWrite 4053, treeTierMove 4068, updateTreeTiers 4096, px formula 4117, force 4118, TIER_FRAME 4138, vista createImpostorGeometry 4267, renderer.__post 5651, renderActivePipeline 5658, flyTo 5730, FRAME_NO 7675, frame() 7676, updateTreeTiers() call 7683, render 7750, setAnimationLoop 7779, stats.draws overwrite 7791, waitForSubmittedGpuWork 7799, captureReadback 7819, window.V3D 7886, groundTint 7898, placeCamera 8027, legacyTrees 8089, treeTiers 8091, setTreeLod 8093, frame 8097, treeTemplates 8114, settled 8157, probeH 8175, fps 8189. HEAD numbers are -2 up to ~5709 and -125/-127 after 7012/7890 (frame 7551, V3D 7761, treeTiers 7964, settled 8030 — the original spec's numbers).
- main.js 8093: setTreeLod only sets TREE_LOD.force; consumed at 4118 inside updateTreeTiers; frame() 7676-7683 runs updateTreeTiers every frame and skips only the render (7750) while captureRenderLocked; captureReadback 7819-7883 awaits waitForSubmittedGpuWork + readRenderTargetPixelsAsync while frame() keeps running.
- main.js 7779-7788: BOOT_PERF.firstFrames[].ms = performance.now() around frame() (CPU wall), tris/draws from renderer.info.render; 7791: stats.draws = renderer.info?.render?.drawCalls || stats.draws.
- three 0.185.1 (apps/golf/node_modules/three/package.json). CylinderGeometry.js 169 `if (radiusTop > 0 || y !== 0)` and 176 `if (radiusBottom > 0 || y !== heightSegments - 1)`: ConeGeometry(r,hh,24,3)=144 tris, (24,2)=96, (12,1)=24; Icosahedron detail 2 = 320, detail 1 = 80; heroTrunk = 24+24+12 = 60; full trunk 9-seg closed = 36. Full tier 204/212/436 reproduces the plan's table (docs/tree-lod-plan.md 15-19); hero 1,068/764/1,660; decimated 56/44/80 (main.js 3791).
- three WGSLNodeBuilder.js 1992-1996: `@interpolate( ${type}${sampling !== null ? ', sampling )' : ' )'}`; VaryingNode.js 92 setInterpolation(type, sampling = null); constants.js 1682-1700 InterpolationSamplingType.FLAT='flat', InterpolationSamplingMode.EITHER='either'; examples/jsm/generators/city/SkyscraperGenerator.js 988, 1273 use FLAT, EITHER; GLSLNodeBuilder.js 1111 maps unknown sampling to ''.
- three NodeMaterial.js 824-828 emits bool(maskNode).not().discard() first in setupDiffuseColor; 844-848 instanceColor.mul(colorNode) unconditionally; 230/238 maskNode/maskShadowNode. Renderer.js 3562-3614 shadow override copies positionNode, numeric alphaTest/alphaMap and _getShadowNodes; 3336-3400: hasMaskNode = maskShadowNode || maskNode, colorNode wrapped in Fn(([color]) => { maskNode.not().discard(); return color; }). ScreenNode.js 181-199 screenCoordinate = getFragCoord(), y-flipped only when isFlipY().
- three Instance.js 27-70: uniform-buffer path only if count*64 <= getUniformBufferLimit() (WebGPUCapabilities: device.limits.maxUniformBufferBindingSize), else one InstancedInterleavedBuffer(array,16,1) as four vec4 attributes; tier meshes use n = 12,811..36,766 (main.js 4012). RenderObject.js 604-618: instanceCount from geometry.instanceCount (InstancedBufferGeometry) or object.count. WebGPUAttributeUtils.js 225-245 loops every updateRanges entry.
- three Three.TSL.js exports: attribute 75, bitAnd 83, bitXor 86, bool 98, floor 192, int 235, oneMinus 413, saturate 487, screenCoordinate 490, select 494, shiftLeft 504, shiftRight 505, uniform 590, varying 606; TSLCore.js 1245 addMethodChaining('toInt', int); AttributeNode.js 115-121 returns varying(this) outside the vertex stage.
- three timing: WebGPUBackend.js 76 (Backend) trackTimestamp = parameters.trackTimestamp === true; 294 `this.trackTimestamp = this.trackTimestamp && this.hasFeature('timestamp-query')`; 227-242 requests every adapter-supported GPUFeatureName (WebGPUConstants.js 337 TimestampQuery: 'timestamp-query'); 2255-2275 initTimestampQuery allocates a query pair per render pass into a 2048 pool; Backend.js 595-620 resolveTimestampsAsync writes renderer.info[type].timestamp; WebGPUTimestampQueryPool.js 92-110 resolveQueriesAsync 'total duration in milliseconds', 147-152 resets currentQueryIndex and queryOffsets on resolve, 70-76 warns when the pool overflows. Animation.js 75 info.reset() once per loop frame; Info.js 158-162 drawCalls++ and triangles += instanceCount*count/3 per draw.
- tools/goldens.mjs: export const GOLDEN_VIEWS at 15, COURSES at 29, top-level capture loop at 43 with execFileSync('node', [.. 'geobuild/shot.mjs' ..]) at 50, no main-module guard; grep finds no importer of goldens.mjs in tools/ or apps/golf/src.
- tools/browser-args.mjs 19-23: BANVY_GPU=1 args are --no-sandbox --use-angle=d3d11 --enable-gpu --force_high_performance_gpu --ignore-gpu-blocklist --force-device-scale-factor=1 (no frame-rate flags); GPU = process.env.BANVY_GPU === '1'. tools/tree-tiers-at.mjs launches chromium with browserArgs() at 1600x900 and its own settle() over V3D.frame()/settled(); tools/boot-profile.mjs 63-68 fingerprint counts include draws: V.stats.draws; tools/parity.mjs strict 0.10/255 (>2), perceptual 2.50/255 (>8).
- node_modules/playwright-core/package.json version 1.55.0; lib/protocol/serializers.js 129-131 serialise TypedArrays as { ta: { b: Buffer, k } } — a 1600x900x4 readback is 5.76 MB per call.
- tree-impostor.mjs: import * as THREE from 'three/webgpu' at 18; createImpostorMaterial 257-373 (param attribute 266, alphaTestNode/opacityNode 338-339, debug unlit 350-371); createImpostorGeometry 376-392 (aImpostorPos vec3, aImpostorParam vec4, DynamicDrawUsage, instanceCount 0). tree-impostor.test.mjs imports the module under vitest; package.json test = `vitest run && node --test ...`, no vitest config file at root.
- Puttom heightfields.json hf0: x0 -1336, z0 -1580, nx 669, nz 789, dx 4 => MIDR (main.js 1523, snapped to 36 m inside the hf0 box) ~ x -1336..1336, z -1580..1572; hf1 x0 -9024, z0 -9472, nx 565, nz 593, dx 32.
- docs/tree-lod-plan.md 395-399: 5th tee noon 189/1,970/8,334/2,882, 1st tee golden 191/494/8,023/4,575, 7th overhead 0/306/2,124/0; 415-419: tee views differ 1.9-3.3/255 by design; 197-204: the plan's own crossfade note. docs/puttom-performance-status.md 93-117: items 1 (hardware look), 3 (crossfade), 5 (phone budget). LiDAR plan checkpoint: 67,568 legacy trees on ?v2=require (17,991 spruce, 36,766 pine, 12,811 birch), 36 draw calls (mesh count reading).
- Projected height at 900 rows, fov 48 (main.js 1167): px = 12,130/d for a 12 m tree => current boundaries 110/303/866 m; proposed 64/24/8 px => 190/505/1,516 m. Weighted per-tree triangles by the Puttom species mix: hero ~1,015, full ~252, decimated ~54.
- bayer4 as specified reproduces [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]] (checked by hand row by row); with f = floor(saturate(raw)*16 + 1/64)/16 the drain at t0 + dur*17/16 gives f = 1 and the reversal t0' = clock - (1 - f + 0.5/16)*dur gives f' = 1 - f with >= 0.48 levels of margin; f32 ULP of a second below 1024 s is <= 1.2e-4 s against a 1/64-level epsilon of 2.9e-4 s at dur 0.3.

---

# Tree LOD phase 4 — crossfaded, per-tree tier switches on hardware (revised after review)

Scope: `apps/golf` only. Placement (`trees[]`, `treeWhy[]`) is never touched; `tools/boot-profile.mjs --fingerprint` must hash identically on its PLACEMENT keys (§6.1) before and after every commit of this work. Standalone pages are hotfix-only and are not changed.

The eighteen review issues are each folded in where they apply and listed with their disposition in §8. None of them was wrong; one (issue 14) needed a correction to the gate it proposed, stated in §5.3.

---

## 0. Preconditions and anchors

### 0.1 The tree, and which numbers the anchors refer to (issues 3, 11)
`apps/golf/src/main.js` is **8280 lines in the working tree** over **HEAD `0a37b07` at 8153 lines**. The uncommitted diff (265 lines, 12 hunks: `@@ -65` +2 import lines for the new `engine/weather.js` and `engine/rangefinder.js`, then hunks at 5709, 5781, 5938, 5949, 6258, 6268, 6591 (+13), 6628 (+106), 7012 (+3), 7765 (+2)) does not touch lines 3757–4300, but it shifts every tree anchor by **+2** and everything after ~6644 by **+125** (by **+127** after 7890). The original spec's numbers were HEAD's while claiming to be the working tree's.

**Before starting: commit or stash the uncommitted weather/rangefinder/bansafari diff (and the untracked `engine/weather.js`, `engine/rangefinder.js`, their tests, `docs/banvy-blueprint.md`), so every gate below compares one tree against one tree.** This study did not do it (read-only).

All anchors below are given as **WT / HEAD** line pairs plus the grep string to verify with `grep -nF` before editing; never patch by regex.

| symbol | grep string | WT | HEAD |
|---|---|---|---|
| `DET` | `const DET = new URLSearchParams` | 85 | 83 |
| `time` pin | `const time = DET ? float(3.25)` | 88 | 86 |
| `bootStarted` | `const bootStarted = performance.now()` | 95 | 93 |
| `LOWQ` | `const LOWQ = qualityParam === 'lo'` | 1131 | 1129 |
| `mkRenderer` | `const mkRenderer = forceWebGL =>` | 1143 | 1141 |
| `IS_GPU` | `const IS_GPU = renderer.backend?.isWebGPUBackend` | 1160 | 1158 |
| `captureRenderLocked` | `let captureRenderLocked = false` | 1164 | 1162 |
| camera (fov 48) | `new THREE.PerspectiveCamera(48,` | 1167 | 1165 |
| `MIDR` | `const MIDR = { dx: 12,` | 1523 | 1521 |
| `stats` | `const stats = { verts: 0, tris: 0, trees: 0, draws: 0` | 1543 | 1541 |
| `grownCrown` | `function grownCrown(geo, seed, amp, colVar)` | 3333 | 3331 |
| `SPECIES` | `const SPECIES = (() => {` | 3352 | 3350 |
| `templateHeight` | `spec.templateHeight = box.max.y` | 3398 | 3396 |
| `WHY_V2_INDIVIDUAL` | `WHY_V2_INDIVIDUAL = 5` | 3558 | 3556 |
| `legacyTreeExport` | `function legacyTreeExport(withInstances` | 3721 | 3719 |
| `TREE_LOD` | `const TREE_LOD = {` | 3776 | 3774 |
| thresholds | `nominalHeight: 12, heroPx: LOWQ ? 200 : 110` | 3781 | 3779 |
| `force` | `force: [1, 2, 3, 4].includes(` | 3785 | 3783 |
| `stats:` (tier stats) | `stats: { tier0: 0, tier1: 0` | 3787 | 3785 |
| `heroTrunk` | `const heroTrunk = (r0, r1, h) =>` | 3854 | 3852 |
| `fineCrowns` | `const fineCrowns = (() => {` | 3860 | 3858 |
| `barkMaterial` | `const barkMaterial = hex =>` | 3901 | 3899 |
| bark modulation | `mat.colorNode = color(hex).mul(bark.mul(0.6).add(0.62))` | 3904 | 3902 |
| `crownMaterial` | `const crownMaterial = (s, hex, sway) =>` | 3908 | 3906 |
| `trunkMaterial` | `const trunkMaterial = (hex, sway) =>` | 3919 | 3917 |
| `windSway` | `function windSway(isCrown)` | 3927 | 3925 |
| `impostorBatch` | `const impostorBatch = (s, capacity, label) =>` | 3953 | 3951 |
| `cell` | `const cell = (x, z) => {` | 3970 | 3968 |
| cell record | `lists: [[], [], []], state: 0, box: new THREE.Box3()` | 3977 | 3975 |
| fill loop `varied` | `const varied = W[k] >= WHY_V2_INDIVIDUAL` | 3996 | 3994 |
| `c.lists[s].push(k)` | same | 4002 | 4000 |
| `c.y1` | `if (pos.y + 14 * sy * varied > c.y1)` | 4004 | 4002 |
| `tier` | `const tier = (parts, label) => {` | 4010 | 4008 |
| species record | `TREE_LOD.tiers.push({` | 4029 | 4027 |
| cell boxes | `for (const c of TREE_LOD.cells) {` | 4040 | 4038 |
| `treeTierWrite` | `function treeTierWrite(s, tier, slot, k)` | 4053 | 4051 |
| `treeTierMove` | `function treeTierMove(s, k, from, to)` | 4068 | 4066 |
| `updateTreeTiers` | `function updateTreeTiers() {` | 4096 | 4094 |
| px formula | `const px = TREE_LOD.nominalHeight * viewportH` | 4117 | 4115 |
| `TIER_FRAME = FRAME_NO` | same | 4138 | 4136 |
| vista impostor batches | `const geo = createImpostorGeometry(list.length)` | 4267 | 4265 |
| post pipeline | `renderer.__post = post` | 5651 | 5649 |
| `renderActivePipeline` | `function renderActivePipeline()` | 5658 | 5656 |
| `flyTo` | `function flyTo(pos, look, dur = 1.5)` | 5730 | 5728 |
| `FRAME_NO` | `let FRAME_NO = 0, TIER_FRAME = 0;` | 7675 | 7550 |
| `frame()` | `function frame() {` | 7676 | 7551 |
| `updateTreeTiers()` call | same | 7683 | 7558 |
| render in frame | `if (!captureRenderLocked) renderActivePipeline();` | 7750 | 7625 |
| `setAnimationLoop` | `renderer.setAnimationLoop(() => {` | 7779 | 7654 |
| `stats.draws` overwrite | `stats.draws = renderer.info?.render?.drawCalls \|\| stats.draws;` | 7791 | 7666 |
| `waitForSubmittedGpuWork` | `async function waitForSubmittedGpuWork()` | 7799 | 7674 |
| `captureReadback` | `async function captureReadback()` | 7819 | 7694 |
| `window.V3D` | `window.V3D = {` | 7886 | 7761 |
| `groundTint` | `  groundTint: () =>` | 7898 | 7773 |
| `placeCamera` | `  placeCamera: (p, t) =>` | 8027 | 7900 |
| `legacyTrees` | `  legacyTrees: (` | 8089 | 7962 |
| `treeTiers` | `  treeTiers: () =>` | 8091 | 7964 |
| `setTreeLod` | `  setTreeLod: n =>` | 8093 | 7966 |
| `frame` | `  frame: () => FRAME_NO` | 8097 | 7970 |
| `treeTemplates` | `  treeTemplates: (dx = 0` | 8114 | 7987 |
| `settled` | `  settled: () => !camTween.on` | 8157 | 8030 |
| `probeH` | `  probeH: (x, z) =>` | 8175 | 8048 |
| `fps` | `  fps: () => fps` | 8189 | 8062 |

### 0.2 Shell (issue 10)
Every `BANVY_GPU=1 node …` line in this spec is Git Bash syntax. In PowerShell 5.1 (the primary shell here) write `$env:BANVY_GPU='1'; node …`. `tools/browser-args.mjs` reads `process.env.BANVY_GPU === '1'`.

---

## 1. Verified facts the design rests on (three.js 0.185.1 under `apps/golf/node_modules/three/src`)

### 1.1 Instance data binding on the WebGPU backend
- `nodes/accessors/Instance.js` 27–70: the instance matrix is a uniform buffer only if `count × 64 B ≤ getUniformBufferLimit()` (`WebGPUCapabilities.getUniformBufferLimit` = `device.limits.maxUniformBufferBindingSize`, default 65,536 → ≤ 1,024 instances); otherwise ONE `InstancedInterleavedBuffer(array, 16, 1)` read as four `vec4` attributes. Every tier mesh is `new THREE.InstancedMesh(geo, mat, n)` with n = 12,811…36,766 (WT 4012), so the interleaved path applies.
- `WebGPUAttributeUtils.createShaderVertexBuffers` keys layouts by the underlying buffer, so the four columns share one vertex-buffer slot; an `InstancedBufferAttribute` gets `stepMode: instance`. `updateAttribute` (WebGPUAttributeUtils 225–245) honours every entry of `updateRanges`, which the tier upload already relies on.
- `RenderObject.getDrawParameters` (604–618): instance count is `geometry.instanceCount` for an `InstancedBufferGeometry` (impostors), else `object.count` (mesh tiers). Only shader-referenced attributes are bound.
- `NodeMaterial.setupDiffuseColor` (815–848): `bool(this.maskNode).not().discard()` is emitted FIRST (824–828); `instanceColor` is multiplied into the colour unconditionally when `object.instanceColor` exists (844–848) — so `instanceColor` is rejected as the fade carrier.

### 1.2 Vertex-buffer count per pipeline (8 is the WebGPU limit; CLAUDE.md records the terrain hitting it)
| pipeline | bound today | slots | + `aFade` |
|---|---|---|---|
| crown, hero/full/decimated (`crownMaterial` WT 3908: reads `attribute('color')`, no map) | position, normal, color, instanceMatrix | 4 | 5 |
| hero trunk (`barkMaterial` WT 3901: `bumpMap: BARK`, `texture(BARK, uv()…)`) | position, normal, uv, instanceMatrix | 4 | 5 |
| full/decimated trunk (`trunkMaterial` WT 3919) | position, normal, instanceMatrix | 3 | 4 |
| impostor (`createImpostorGeometry`, tree-impostor.mjs 376–392) | position, normal, uv, aImpostorPos, aImpostorParam | 5 | 6 |
| shadow pass, crown | position, color, instanceMatrix | 3 | 4 |
All ≤ 6 of 8.

### 1.3 The shadow pass honours `maskNode`
`renderers/common/Renderer.js` 3562–3614: with `scene.overrideMaterial` set for the shadow pass the renderer copies `material.positionNode` (wind sway is already in the shadow), the numeric `alphaTest`/`alphaMap`, and — because the override `isShadowPassMaterial` — the nodes from `_getShadowNodes(material)` (3336–3400): `hasMaskNode = maskShadowNode || maskNode` (3346); when set, the shadow colour node is wrapped in `Fn(([color]) => { maskNode.not().discard(); return color; })`. A discarded fragment writes no depth, so it casts nothing. `screenCoordinate` (`nodes/display/ScreenNode.js` 181–199) is `builder.getFragCoord()` — the shadow-map texel in the shadow pass, the pixel in the colour pass, y-flipped on GLSL only (the flip is the same for both tiers inside one pipeline, so the partition is preserved). Impostors have `castShadow = false` (WT 3959).

### 1.4 Flat interpolation (issue 8)
`nodes/core/VaryingNode.js` 92: `setInterpolation(type, sampling = null)`. `WGSLNodeBuilder.js` 1992–1996 emits `@interpolate( flat )` when sampling is null and `@interpolate( flat, either )` when it is `'either'`; three's own in-tree use (`examples/jsm/generators/city/SkyscraperGenerator.js` 988, 1273) passes `InterpolationSamplingType.FLAT, InterpolationSamplingMode.EITHER` (`constants.js` 1682–1700: `'flat'`, `'either'`); `GLSLNodeBuilder.js` 1111 maps an unknown sampling to `''`. **Use `.setInterpolation('flat', 'either')`** — WebGPU compatibility mode requires `either` for flat, and a phone in compat mode would otherwise fail pipeline creation silently.

### 1.5 TSL exports used
`Three.TSL.js`: `attribute` 75, `bitAnd` 83, `bitXor` 86, `bool` 98, `floor` 192, `int` 235, `oneMinus` 413, `saturate` 487, `screenCoordinate` 490, `select` 494, `shiftLeft` 504, `shiftRight` 505, `uniform` 590, `varying` 606; `TSLCore.js` 1245 chains `toInt`. `nodes/core/AttributeNode.js` 115–121 returns `varying(this)` for a fragment-stage read.

### 1.6 Triangle counts (issues 7, 15) — from three's cone topology, not the naive formula
`geometries/CylinderGeometry.js` 169 `if (radiusTop > 0 || y !== 0)` and 176 `if (radiusBottom > 0 || y !== heightSegments - 1)`: a cone (radiusTop 0) skips one triangle per radial segment on its apex row. `ConeGeometry(r, hh, 24, 3)` = 24×(3×2−1) + 24 cap = **144**; `(r, hh, 24, 2)` = 24×3 + 24 = **96**; `(r, hh, 12, 1)` = 12 + 12 = **24**; `IcosahedronGeometry(_, 2)` = 320, `(_, 1)` = 80; `heroTrunk` (WT 3854–3859) = open 12-seg shaft 24 + flare 24 + `CircleGeometry(r0, 12)` 12 = **60**; the full-tier closed 9-seg `CylinderGeometry(r0, r1, h, 9)` = 18 + 2×9 = 36.
- Full tier: spruce 7×24 + 36 = **204**, pine 4×24 + 80 + 36 = **212**, birch 5×80 + 36 = **436** — reproducing the plan's table exactly, which validates the method.
- Hero tier (WT 3860–3900): spruce 7×144 + 60 = **1,068**, pine 4×96 + 320 + 60 = **764**, birch 5×320 + 60 = **1,660** (the heaviest, and the original spec applied the spruce number to all).
- Decimated (comment WT 3789–3791): 56 / 44 / 80. Impostor: 2.
Weighted by Puttom's species mix (17,991 spruce / 36,766 pine / 12,811 birch from the vegetation baseline): hero ≈ 1,015, full ≈ 252, decimated ≈ 54 triangles per tree. **The sweep budgets in MEASURED triangles** (`renderer.info.render.triangles`, which per `renderers/common/Animation.js` 75 is reset once per loop frame and so accumulates shadow + scene + bloom passes) and in GPU milliseconds (§5.4), never in these estimates. `V3D.treeTriangles()` (§4) reports the built geometries' `index.count / 3` per species and tier so the plan carries measured numbers.

### 1.7 Timing instruments (issue 12)
- `frame()` (WT 7676) measures `now − last` = the requestAnimationFrame interval; with the harness's Chromium args (`tools/browser-args.mjs` 19–23: no `--disable-frame-rate-limit`/`--disable-gpu-vsync`) RAF is vsync-locked, so every frame under 16.7 ms reads 16.7 and a 17 ms frame reads 33. `BOOT_PERF.firstFrames[].ms` (WT 7779–7788) is the CPU wall time of `frame()` around `renderActivePipeline()` (JS + command encoding), not GPU time. **The "14 ms steady" figure in the brief is a CPU figure and is retired as a GPU claim.**
- GPU time exists in three: `WebGPUBackend.js` 76/294 `trackTimestamp = parameters.trackTimestamp && hasFeature('timestamp-query')`; the backend requests every adapter-supported feature from `GPUFeatureName` (227–242), so the feature is requested whenever Chrome exposes it; `initTimestampQuery` (2255–2275) allocates a query pair per render pass into a 2048-query pool; `Backend.resolveTimestampsAsync` (595–620) → `WebGPUTimestampQueryPool.resolveQueriesAsync` (92–110, "the total duration in milliseconds") resolves ALL pairs allocated since the last resolve and resets the pool (147–152), writing `renderer.info.render.timestamp`. So a sample = the sum of every pass since the previous resolve; the tool normalises by the number of `frame()` ticks in between (§5.4) and must resolve at least every ~100 frames or the pool warns and returns null.

### 1.8 The tier machinery today (read before editing)
`TREE_LOD` WT 3776–3790; cell record WT 3977 (`lists: [[], [], []]` — plain arrays filled by `push` at WT 4002 and walked with `for…of` at WT 4130: issue 18); fill loop WT 3983–4006 (`varied` 3996, `c.y1 = pos.y + 14 × sy × varied` 4004); `tier()` 4010–4026; species record 4029–4037 (`where`, `tierOf`, `t[1..4]`); `treeTierWrite` 4053–4067; `treeTierMove` 4068–4089; `updateTreeTiers` 4096–4166 (per-cell frustum + box distance + hysteresis walk; `force` at 4118; upload ranges 4142–4162; `TIER_FRAME = FRAME_NO` 4138). `setTreeLod` (WT 8093) only writes `TREE_LOD.force`, consumed at WT 4118 inside `updateTreeTiers`, which `frame()` calls at WT 7683 — two calls before a frame do nothing (issue 2). `captureReadback` (WT 7819–7883) renders into an RGBA8 target while `captureRenderLocked` is set; `frame()` keeps running (only the render at WT 7750 is skipped), so tiers update and any frame-advanced clock advances during the readback (issue 13). `flyTo(…, 0)` (WT 5730–5734) places the camera at once and clears `camTween.on`. `stats.draws` is overwritten with `renderer.info.render.drawCalls` at WT 7791 (issue 16).

---

## 2. Design

### 2.1 Crossfade model
A tree changing tier gets an OUT entry (its slot in the old tier stays; only its fade value is rewritten) and an IN entry (appended to the new tier), both stamped with the same fade-clock time `t0`. For `FADE_S = 0.3` s both are drawn; the fragment mask decides per pixel which survives. At `f = 0` the IN entry is fully discarded and the OUT fully kept, so the first frame of a fade is pixel-identical to the frame before it; at `f = 1` the reverse, so removing the OUT entry is invisible. Progress is quantised to 16 levels so the two pipelines never disagree by an ULP — with the epsilon rule of §2.4.

### 2.2 Dither: 4×4 ordered Bayer in screen space
Screen space is the only space in which two different geometries (a 1,068-triangle crown and a 204-triangle one, or a mesh and a billboard) can be given exactly complementary masks. three's `alphaHash` (`NodeMaterial.js` 890–893, `getAlphaHashThreshold(positionLocal)`) is object-space and cannot. Ordered Bayer over white noise because at 8–110 px tree heights a 4×4 pattern reads as a soft blend and a hash as sparkle; judged by eye on the 3070 — if it shimmers, swap `bayer4` for `bayer8` in one function. Polarity alternates per tree (`k & 1`).

### 2.3 Encoding — `aFade = vec2(t0, code)` per instance
| code | entry | keep pixel iff | pair |
|---|---|---|---|
| 0 | steady | always | – |
| 1 | IN, polarity 0 | `b < f` | 4 |
| 2 | IN, polarity 1 | `b ≥ 1 − f` | 3 |
| 3 | OUT, polarity 0 | `b < 1 − f` | 2 |
| 4 | OUT, polarity 1 | `b ≥ f` | 1 |
`b = (bayer4(x & 3, y & 3) + 0.5) / 16`; `PAIR = [0, 4, 3, 2, 1]`. Pairs (1,4) and (2,3) partition every pixel at every `f`; at level `L` a polarity-0 pair flips the pixels with Bayer index `L − 1`, a polarity-1 pair those with index `16 − L`, so every pixel flips exactly once over the fade.

### 2.4 Quantisation with margins (issue 4)
The shader computes `raw = (clock − t0) / dur` in f32 from a float uniform and a float attribute; the original `floor(raw × 16)` put the drain and the reversal exactly on level boundaries, where an f32 rounding of `0.99999` gives `f = 15/16` on the drain frame (a 1/16 pop of every OUT entry) and a reversal can read one level low for a frame. Fixes, in BOTH twins:
- `f = floor(saturate(raw) × 16 + 1/64) / 16` (`FADE_EPS = 1/64` of a level ≈ 0.29 ms of a 0.3 s fade, against an f32 ULP of ≤ 0.12 ms for a clock below 1024 s).
- Drain one level late: `drainAt = t0 + dur × (1 + 1/16)`; the entry is fully discarded from `f = 1` on, so the extra 18 ms costs a draw and nothing visible.
- Reversal placed half a level inside its level: `t0′ = clock − (1 − f + 0.5/16) × dur`, so `f′ = 1 − f` exactly with ≥ 0.48 levels of margin either side.
- **Epoch rebase.** The uniform clock is `TREE_LOD.fadeClock`, epoch-relative and kept below `FADE_EPOCH_S = 512`: when it passes 512 s, `rebaseFadeClock()` subtracts 512 from `fadeClock`, from every LIVE queue entry (`sp.fadeT0[k] === entry.t0`) — rewriting `fadeT0` and the `aFade.x` of both its IN and OUT entries — and from every queued `t0`/`drainAt`. The bansafari runs 12 minutes of continuous motion, so the queue is never assumed empty. Under `?det=1` the clock advances 1/60 per frame (never near 512 in a harness run); when driven by `V3D.setTreeFadeClock` it is whatever the meter sets.
- Residual: the CPU twin decides a reversal from its own `f`; if `raw × 16 + 1/64` is within an f32 ULP of an integer at that instant (never a targeted value; probability ~1e-4 per event) the reversed tree shows a one-level (1/16 of its pixels) step for one frame. Accepted and stated.

### 2.5 Reversal, third-tier hop, frustum
- **Reversal** (the tree is asked to go from B back to A while A is still its OUT entry): swap roles in place with the §2.4 `t0′` and IN code `1 ↔ 2`; the kept pixel sets are continuous. No pop.
- **Third-tier hop** (two thresholds crossed within 0.32 s): the pending OUT is finished at once and the current IN becomes the new OUT at `f = 0` — a partial pop of the residual. Thresholds are ~2.5× apart in distance, so this needs > 1 km/s of camera motion (only `goHole`/tour cuts). Accepted; noted in the plan.
- **Frustum**: a cell leaving removes BOTH entries at once (invisible anyway); a cell entering appends steady (code 0) entries — and (issue 5) is evaluated on the frame it becomes visible whatever the stride.

### 2.6 Clock (issues 4, 13)
`TREE_LOD.fadeClock` (seconds, epoch-relative) is advanced in `frame()` before `updateTreeTiers()`: if `TREE_LOD.clockDriven` it is not advanced at all (the harness sets it through `V3D.setTreeFadeClock`); else `DET ? fadeClock + 1/60 : fadeClock + min(0.1, dt)`; then `treeFadeClock.value = fadeClock; treeFadeDuration.value = fadeS`. `fadeS` is `0` under `?det=1` by default (instant switches — every existing det gate renders today's frames) and `0.3` otherwise (`0.25` under LOWQ); `V3D.setTreeFade(seconds)` overrides at run time.

### 2.7 Spatial granularity — per-tree tiering inside the 128 m frustum cells
Cost model from the population (79,407 trees, 451 cells; MIDR at Puttom is 2.66 × 3.14 km from `hf0` x0 −1336, z0 −1580, nx 669, nz 789, dx 4): today 451 cells flip whole (100–400 trees per cell in one frame — the pop the owner sees). Per-tree inside VISIBLE cells (13,375 trees in the 5th-tee frame, 2,430 in the overhead, ~30k in a view down MIDR's long axis) is a loop over `Int32Array` cell lists and packed `Float32Array`s with one sqrt and a two-way hysteresis compare per tree. **The µs figures in the original spec were invented (issue 18); the cost is measured by gate 6.4 (`updateMs` p95 ≤ 1.0 ms on the 3070, stride 1), and `stride = 2` (evaluate half the cells per frame, entering cells always) is the amortisation if it fails, on desktop as well as LOWQ.** Per-tree makes the per-tree height exact, staggers the fades naturally (only the trees crossing a threshold this frame fade, so "both tiers drawn" is a few dozen trees, never a cell), and removes cell-edge lines. The 128 m cells stay for culling and for the visible/invisible transition.

### 2.8 Per-tree height
`treeH[k] = SPECIES[s].templateHeight × sy × varied` (the drawn height; `templateHeight` at WT 3398, `varied` at WT 3996) and `treeCY[k] = pos.y + treeH[k] / 2`. Projected height uses the tree's own `treeH` and the distance to its crown centre (an overhead camera 330 m up is 330 m away — commit c307b38's fix carries over per tree). `c.y1` keeps its `14 × sy × varied` formula so the cell boxes and the frustum verdicts are unchanged.

### 2.9 Thresholds hook and proposed defaults
`V3D.setTreeLodPx({hero, full, impostor, hysteresis, reset})`, `V3D.treeLodPx()`, and `?lodpx=hero,full,impostor` parsed beside `?lod=`. `reset: true` re-evaluates every visible tree with no hysteresis on the next update (instant if `fadeS` is 0, crossfaded otherwise). Starting defaults for the RTX 3070 — **a hypothesis for the sweep, not a decision**: hero 64 / full 24 / impostor 8 px, hysteresis 0.1 (LOWQ stays 200/60/22 until a phone is measured). For a 12 m tree at 900 rows and fov 48° (`px = 12,130 / d`): hero to 190 m (was 110), decimated from 505 m (was 303), impostor from 1,516 m (was 866); ×1.2 at 1080 rows. Scaling the plan's 5th-tee row (189/1,970/8,334/2,882) by area gives ~560 hero / ~5,400 full / ~7,400 decimated / ~0 impostor ≈ 2.3 M scene triangles by the §1.6 weights (≈ 4.6 M with the shadow pass) against ≈ 1.15 M (2.3 M) today. Measured, not believed: gate 6.5.

### 2.10 Hero → full handover
Hero (WT 3860–3900) vs full (`SPECIES` WT 3352–3392): cones `(r, hh, 24, 3)` vs `(r, hh, 12, 1)`, icosahedra detail 2 vs 1, the same `grownCrown(seed, amp, colVar)` per-vertex noise, so silhouettes differ by up to ~0.5 m (≈ 2.5 px at 64 px). The hero trunk (`barkMaterial` WT 3904: colour × `(bark × 0.6 + 0.62)`, bark mean ≈ 0.5 → mean 0.92) reads ~8% darker than the flat full-tier cylinder. A 0.3 s crossfade covers the silhouette and facet change; the optional one-line normalisation `bark.mul(0.6).add(0.70)` (mean 1.0) removes the luminance step — an open question for the owner (§9).

---

## 3. Edits

### 3.1 New `apps/golf/src/engine/tree-fade.mjs` (issues 4, 6, 8)
```js
/* Tree LOD phase 4: the dithered crossfade between tiers (docs/tree-lod-plan.md).
   Pure JS twins first (unit-tested, the CPU reference), then the TSL mask. */
import * as THREE from 'three/webgpu';
import { Fn, float, int, bool, attribute, varying, screenCoordinate, uniform,
         floor, saturate, select, oneMinus } from 'three/tsl';

export const FADE_LEVELS = 16;
export const FADE_EPS = 1 / 64;          /* of a level, either side of every boundary (see the plan) */
export const FADE_EPOCH_S = 512;         /* the fade clock is rebased below this: an f32 second keeps < 0.13 ms of ULP */
export const PAIR = Object.freeze([0, 4, 3, 2, 1]);
export const treeFadeClock = uniform(0);       /* seconds, epoch-relative (TREE_LOD.fadeClock) */
export const treeFadeDuration = uniform(0);    /* seconds; <= 0 means no fade in flight */

export function bayer4(x, y) {                 /* integers -> 0..15, the classic matrix */
  const m2 = (a, b) => ((a & 1) << 1) ^ ((b & 1) * 3);
  return 4 * m2(x & 1, y & 1) + m2((x >> 1) & 1, (y >> 1) & 1);
}
/* the shader's arithmetic, f32 at every step */
export function fadeProgress(clock, t0, dur) {
  if (!(dur > 0)) return 1;
  const raw = Math.fround(Math.fround(Math.fround(clock) - Math.fround(t0)) / Math.fround(dur));
  return Math.floor(Math.min(1, Math.max(0, raw)) * FADE_LEVELS + FADE_EPS) / FADE_LEVELS;
}
export function drainAt(t0, dur) { return t0 + dur * (1 + 1 / FADE_LEVELS); }
export function fadeKeep(code, f, b) {         /* b = (bayer + 0.5) / 16 */
  switch (code) { case 0: return true; case 1: return b < f; case 2: return b >= 1 - f; case 3: return b < 1 - f; case 4: return b >= f; }
  throw new RangeError(`fade code ${code}`);
}
export function reversedFade(clock, t0, dur, inCode) {
  const f = fadeProgress(clock, t0, dur);
  return { t0: Math.fround(clock - (1 - f + 0.5 / FADE_LEVELS) * dur), inCode: inCode === 1 ? 2 : 1 };
}
/* the per-fragment keep mask for a geometry carrying aFade = (t0, code) per instance */
export const treeFadeMask = Fn(() => {
  const fade = varying(attribute('aFade', 'vec2')).setInterpolation('flat', 'either');
  const code = fade.y;
  const raw = saturate(treeFadeClock.sub(fade.x).div(treeFadeDuration.max(1e-4)));
  const f = select(treeFadeDuration.lessThanEqual(0), float(1),
                   floor(raw.mul(FADE_LEVELS).add(FADE_EPS)).div(FADE_LEVELS));
  const ix = int(screenCoordinate.x).bitAnd(int(3)), iy = int(screenCoordinate.y).bitAnd(int(3));
  const m2 = (a, b) => a.bitAnd(int(1)).shiftLeft(int(1)).bitXor(b.bitAnd(int(1)).mul(int(3)));
  const bayer = m2(ix, iy).mul(int(4)).add(m2(ix.shiftRight(int(1)), iy.shiftRight(int(1))));
  const b = float(bayer).add(0.5).div(FADE_LEVELS);
  return select(code.lessThan(0.5), bool(true),
         select(code.lessThan(1.5), b.lessThan(f),
         select(code.lessThan(2.5), b.greaterThanEqual(oneMinus(f)),
         select(code.lessThan(3.5), b.lessThan(oneMinus(f)), b.greaterThanEqual(f)))));
});
export function attachTreeFade(material) { material.maskNode = treeFadeMask(); return material; }
export function createFadeAttribute(capacity) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  a.setUsage(THREE.DynamicDrawUsage);
  return a;
}
```
Trap already in the plan: never multiply a JS number by a node (`NaN` lands in the shader); `node.mul(number)` and `float(n)` are the safe forms, used throughout. `NodeMaterial` itself emits the `bool(maskNode).not().discard()`, so the mask returns the keep boolean and never discards on its own.

`apps/golf/src/engine/tree-fade.test.mjs` (vitest; `pnpm test` runs `vitest run` over `**/*.test.mjs`, and `tree-impostor.test.mjs` already imports a module that imports `three/webgpu` under vitest): (1) `bayer4` reproduces `[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]]`; (2) for every in-code, every `f = L/16` and every `b = (m + 0.5)/16`, exactly one of `fadeKeep(in, f, b)` / `fadeKeep(PAIR[in], f, b)` is true, and each pixel flips exactly once over `L = 0..16`; (3) **f32 continuity**: for clocks `t0 ∈ {0, 100.37, 511.9}`, `dur ∈ {0.3, 0.25}`, every `L`, `fadeProgress(t0 + L·dur/16 + δ, …)` equals `L/16` for `δ ∈ {−1e-4, 0, +1e-4}` (the epsilon absorbs a frame's ULP), `fadeProgress(drainAt(t0, dur), t0, dur) === 1`, and after `reversedFade` at each level the kept set (`fadeKeep` over all 16 `b`) of the new IN equals the kept set of the old OUT and vice versa, for both polarities; (4) `fadeProgress` is 0 at `clock = t0`, 1 for `dur <= 0`.

### 3.2 `apps/golf/src/engine/tree-impostor.mjs`
- `createImpostorGeometry` (376–392): after `aImpostorParam`, `geometry.setAttribute('aFade', createFadeAttribute(capacity))` (zero = steady; the far-ring vista batches at WT 4267–4275 get it for free and never write it).
- `createImpostorMaterial` (257): after `material.opacityNode = coverage;` (339) add `attachTreeFade(material)`; leave the debug `unlit` material (350–371) unmasked.
- The docblock at 251–256 gains the `aFade` line. Import `attachTreeFade, createFadeAttribute` from `./tree-fade.mjs`.

### 3.3 `apps/golf/src/main.js`
**Imports** (block WT 32–78): `import { treeFadeClock, treeFadeDuration, attachTreeFade, createFadeAttribute, PAIR, fadeProgress, drainAt, reversedFade, FADE_EPOCH_S } from './engine/tree-fade.mjs';`.

**`mkRenderer` (WT 1143)** (issue 12): `const GPUTIME = new URLSearchParams(location.search).get('gputime') === '1';` and `new THREE.WebGPURenderer({ …existing…, trackTimestamp: GPUTIME })`. Nothing else changes; without the flag the backend's `trackTimestamp` stays false.

**`TREE_LOD` (WT 3776)**: add
```js
fadeS: DET ? 0 : (LOWQ ? 0.25 : 0.3), fadeClock: 0, clockDriven: false, queue: [], qHead: 0,
frozen: false, stride: LOWQ ? 2 : 1, resetPending: false,
px: (() => { const q = new URLSearchParams(location.search).get('lodpx'); const v = q ? q.split(',').map(Number) : null;
             return v && v.length === 3 && v.every(x => x > 0) ? { hero: v[0], full: v[1], impostor: v[2] } : null; })(),
```
and initialise `heroPx: px?.hero ?? (LOWQ ? 200 : 110)` etc. (the `px` IIFE must be evaluated before the threshold lines — hoist it to a `const LODPX` above the object). `stats` gains `fading: 0, updateMs: 0`. Desktop defaults 64/24/8 are set ONLY after gate 6.5.

**Materials** (WT 3901, 3908, 3919): each returns `attachTreeFade(mat)`. Optional bark normalisation at WT 3904 (§2.10).

**Fill loop (WT 3983–4006)**: per species allocate `treeH = new Float32Array(n)`, `treeCY = new Float32Array(n)`; after `varied`: `treeH[k] = SPECIES[s].templateHeight * sy * varied; treeCY[k] = pos.y + treeH[k] * 0.5;`. Leave `c.y1`. In the cell-box loop (WT 4040–4046) add `c.lists = c.lists.map(l => Int32Array.from(l)); c.visible = false;` (issue 18; exact, no placement change).

**`tier(parts, label)` (WT 4010)**: for each part `geo.setAttribute('aFade', createFadeAttribute(n))` before the `InstancedMesh` is made (hero/full/decimated geometries are distinct objects per species, so the attribute is per mesh); return `{ parts, fade: parts.map(im => im.geometry.getAttribute('aFade')), slots, count: 0, lo: Infinity, hi: -Infinity, flo: Infinity, fhi: -Infinity, idx: 0 }`. `impostorBatch` (WT 3953) returns `fade: [geo.getAttribute('aFade')]` and the same `flo/fhi/idx`. After the species record (WT 4029–4037): `for (let i = 1; i <= 4; i++) rec.t[i].idx = i;` and add `outTier: new Uint8Array(n)`, `whereOut: new Int32Array(n)`, `fadeT0: new Float32Array(n)`, `fadeCode: new Uint8Array(n)`, `treeH`, `treeCY`.

**`treeTierWrite(s, tier, slot, k, t0, code)` (WT 4053)**: keep the matrix/impostor writes; add `for (const a of tier.fade) { a.array[slot * 2] = t0; a.array[slot * 2 + 1] = code; }` and `if (slot < tier.flo) tier.flo = slot; if (slot > tier.fhi) tier.fhi = slot;`. Add `treeFadeWrite(tier, slot, t0, code)` = the fade part alone (an OUT entry rewrites only its fade, so the matrix upload range stays tight).

**`treeTierMove` (WT 4068)** becomes
```js
function tierRemove(s, tier, slot) {              /* swap-remove; the moved tree may hold this tier as IN or OUT */
  const sp = TREE_LOD.tiers[s], last = --tier.count;
  if (slot !== last) {
    const m = tier.slots[last]; tier.slots[slot] = m;
    const isIn = sp.tierOf[m] === tier.idx;
    if (isIn) sp.where[m] = slot; else sp.whereOut[m] = slot;
    treeTierWrite(s, tier, slot, m, sp.fadeT0[m], isIn ? sp.fadeCode[m] : PAIR[sp.fadeCode[m]]);
  }
}
function tierAppend(s, tier, k, t0, code) { const slot = tier.count++; tier.slots[slot] = k; treeTierWrite(s, tier, slot, k, t0, code); return slot; }
function treeTierMove(s, k, from, to, fade = true) {
  const sp = TREE_LOD.tiers[s], dur = TREE_LOD.fadeS, clock = TREE_LOD.fadeClock;
  if (fade && dur > 0 && to && sp.outTier[k] === to && sp.tierOf[k] === from) {   /* reversal: continuous masks */
    const { t0, inCode } = reversedFade(clock, sp.fadeT0[k], dur, sp.fadeCode[k]);
    const wIn = sp.where[k], wOut = sp.whereOut[k];
    sp.where[k] = wOut; sp.whereOut[k] = wIn; sp.tierOf[k] = to; sp.outTier[k] = from;
    sp.fadeT0[k] = t0; sp.fadeCode[k] = inCode;
    treeFadeWrite(sp.t[to], wOut, t0, inCode); treeFadeWrite(sp.t[from], wIn, t0, PAIR[inCode]);
    TREE_LOD.queue.push({ s, k, t0, drainAt: drainAt(t0, dur) }); TREE_LOD.stats.moves++; return;
  }
  if (sp.outTier[k]) { tierRemove(s, sp.t[sp.outTier[k]], sp.whereOut[k]); sp.outTier[k] = 0; }   /* never three tiers */
  if (!to) {                                                            /* left the frustum: gone now */
    if (from) tierRemove(s, sp.t[from], sp.where[k]);
    sp.where[k] = -1; sp.tierOf[k] = 0; sp.fadeCode[k] = 0;
  } else if (!from || !fade || dur <= 0) {                              /* entered the frustum, or instant */
    if (from) tierRemove(s, sp.t[from], sp.where[k]);
    sp.fadeCode[k] = 0; sp.fadeT0[k] = 0;
    sp.where[k] = tierAppend(s, sp.t[to], k, 0, 0); sp.tierOf[k] = to;
  } else {                                                              /* crossfade */
    const inCode = (k & 1) ? 2 : 1, t0 = Math.fround(clock);
    sp.outTier[k] = from; sp.whereOut[k] = sp.where[k]; treeFadeWrite(sp.t[from], sp.whereOut[k], t0, PAIR[inCode]);
    sp.fadeT0[k] = t0; sp.fadeCode[k] = inCode;
    sp.where[k] = tierAppend(s, sp.t[to], k, t0, inCode); sp.tierOf[k] = to;
    TREE_LOD.queue.push({ s, k, t0, drainAt: drainAt(t0, dur) });
  }
  TREE_LOD.stats.moves++;
}
```
`sp.fadeT0` is a `Float32Array`, so the stored value equals `Math.fround(t0)` and the queue's `t0` (already `fround`ed) compares equal to it.

**Drain and rebase** (new, called at the top of `updateTreeTiers`): `drainTreeFades()` pops `queue[qHead]` while `drainAt <= fadeClock`; for each, if `sp.outTier[k] && sp.fadeT0[k] === entry.t0` (a stale entry after a reversal or a later fade fails this and is skipped): `tierRemove(s, sp.t[sp.outTier[k]], sp.whereOut[k]); sp.outTier[k] = 0; sp.fadeCode[k] = 0; treeFadeWrite(sp.t[sp.tierOf[k]], sp.where[k], 0, 0);` and mark `changed`. Compact the array when `qHead > 4096`. `rebaseFadeClock()`: when `fadeClock >= FADE_EPOCH_S`, subtract `FADE_EPOCH_S` from `fadeClock` and, for every entry from `qHead` on, from `entry.t0`/`entry.drainAt`, and — if the entry is live (`sp.fadeT0[k] === old t0`) — from `sp.fadeT0[k]` with `treeFadeWrite` on both its tiers (`sp.t[sp.tierOf[k]]` at `where`, `sp.t[sp.outTier[k]]` at `whereOut`). A re-timed (reversed) entry may sit behind older entries and drain up to 0.32 s late; invisible (fully discarded from `f = 1`), only a draw. `stats.fading = queue.length − qHead`.

**`updateTreeTiers` (WT 4096)** (issues 5, 14, 18): `if (!TREE_LOD.ready || TREE_LOD.frozen) return;` first; cells keep `box` and use `visible` (replacing the tier meaning of `state`); the loop becomes
```js
const tStart = performance.now(); rebaseFadeClock(); drainTreeFades();
const Kpx = viewportH / (2 * fovTan), thr = [heroPx, switchPx, impostorPx], hy = hysteresis, force = TREE_LOD.force, reset = TREE_LOD.resetPending, stride = TREE_LOD.stride;
for (let ci = 0; ci < cells.length; ci++) { const c = cells[ci];
  const vis = TREE_FRUSTUM.intersectsBox(c.box);
  if (!vis) { if (c.visible) { for (s) for (k of c.lists[s]) treeTierMove(s, k, sp.tierOf[k], 0); c.visible = false; changed = true; } continue; }
  const wasVisible = c.visible; c.visible = true; visible++;
  if (wasVisible && !reset && (ci % stride) !== (FRAME_NO % stride)) continue;   /* a cell is evaluated on the frame it becomes visible whatever the stride */
  for (let s = 0; s < 3; s++) { const sp = TREE_LOD.tiers[s]; if (!sp) continue; const imp = TREE_LOD.imp[s], L = c.lists[s];
    for (let i = 0; i < L.length; i++) { const k = L[i];
      const dx = imp[k*6] - cx, dy = sp.treeCY[k] - cy, dz = imp[k*6+2] - cz;
      const px = sp.treeH[k] * Kpx / Math.max(1, Math.sqrt(dx*dx + dy*dy + dz*dz));
      const cur = sp.tierOf[k]; let want;
      if (force) want = force;
      else if (!cur || reset) { want = 1; while (want < 4 && px < thr[want - 1]) want++; }
      else { want = cur; while (want > 1 && px > thr[want - 2] * (1 + hy)) want--; while (want < 4 && px < thr[want - 1] * (1 - hy)) want++; }
      if (want !== cur) { treeTierMove(s, k, cur, want, !reset || TREE_LOD.fadeS > 0); changed = true; }
    } } }
TREE_LOD.resetPending = false; TREE_LOD.stats.updateMs = performance.now() - tStart;
```
The upload block (WT 4142–4162) additionally flushes `tier.fade[*]` over `[flo, fhi]` (`clearUpdateRanges` / `addUpdateRange(flo*2, (fhi−flo+1)*2)` / `needsUpdate`) and resets `flo/fhi`; `changed` also covers drains. `TIER_FRAME = FRAME_NO` stays.

**`frame()` (WT 7676)**: before `updateTreeTiers()` (WT 7683): `if (!TREE_LOD.clockDriven) TREE_LOD.fadeClock += DET ? 1 / 60 : dt; treeFadeClock.value = TREE_LOD.fadeClock; treeFadeDuration.value = TREE_LOD.fadeS;` plus a 120-entry ring buffer `FRAME_MS` of `now − last` (meaningful only with an uncapped frame rate, §5.4).

**`captureRaw()`** (factored out of `captureReadback` WT 7819–7847: allocate/resize `captureReadbackTarget`, lock, `setRenderTarget`, `renderActivePipeline`, `waitForSubmittedGpuWork`, `readRenderTargetPixelsAsync`, `contiguousRgba8Readback`, restore, unlock, re-render) returns the `Uint8Array`; `captureReadback` becomes the PNG half over it. WebGPU only, as today.

### 3.4 `tools/golden-views.mjs` (new) and `tools/goldens.mjs` (issue 1)
`tools/goldens.mjs` is a top-level script: importing it for `GOLDEN_VIEWS` (line 15) runs the whole six-course capture loop (line 43 `for (const slug of …)`, line 50 `execFileSync('node', [… 'geobuild/shot.mjs' …])`) with no main-module guard; nothing imports it today. Create side-effect-free `tools/golden-views.mjs` exporting `GOLDEN_VIEWS` (the 12 entries verbatim) and `COURSES`; in `goldens.mjs` replace the two `export const` blocks with `import { GOLDEN_VIEWS, COURSES } from './golden-views.mjs'; export { GOLDEN_VIEWS, COURSES };` — the rest unchanged. `tree-tiers-at.mjs` and `tree-pop-meter.mjs` import from `golden-views.mjs` only.

### 3.5 `tools/browser-args.mjs` (issue 12)
`browserArgs({ uncappedFrameRate = false } = {})` appends `'--disable-frame-rate-limit', '--disable-gpu-vsync'` when asked. Default unchanged, so every existing harness is untouched (their captures must stay vsync-locked and like-for-like).

---

## 4. `V3D` additions (WT 7886 block)
- `treeTiers()` (WT 8091) also returns `heroPx, hysteresis, fadeS, fading, updateMs, frozen, clockDriven`.
- `setTreeLodPx(o)`: for `hero/full/impostor/hysteresis` if finite assign to `heroPx/switchPx/impostorPx/hysteresis`; `if (o.reset) TREE_LOD.resetPending = true`. `treeLodPx()` → `{hero, full, impostor, hysteresis}`.
- `setTreeFade(s)`: `TREE_LOD.fadeS = Math.max(0, +s || 0)`.
- `setTreeFadeClock(t)`: `TREE_LOD.fadeClock = +t` (epoch-relative seconds; the meter never approaches 512). `driveTreeFadeClock(on)`: `TREE_LOD.clockDriven = !!on` (issue 13).
- `freezeTreeTiers(on)`: `TREE_LOD.frozen = !!on` — skips `updateTreeTiers` entirely (frustum, decisions, drain, rebase) (issue 14).
- `pixelDelta(threshold = 24)` (issue 9): `const cur = await captureRaw()`; if a previous buffer of the same size is retained, count pixels whose max-channel |Δ| > threshold and the max |Δ|; retain `cur`; return `{ changed, total, max, frame: FRAME_NO, primed: hadPrevious }`. Nothing leaves the page but three numbers (a 1600×900 frame is 5.76 MB over CDP — Playwright 1.55 `lib/protocol/serializers.js` 129–131 serialises TypedArrays as buffers, so the original per-frame `readPixels` would have moved over a gigabyte per run). `readPixels()` stays as a debugging export.
- `treeTierAudit()` (issue 17): per species `{ sumCount: Σ t[i].count, inCount: #tierOf≠0, outCount: #outTier≠0, roundTrip: every slots[slot] for slot < count satisfies (tierOf[k]===i && where[k]===slot) || (outTier[k]===i && whereOut[k]===slot), noSelfPair: no k with tierOf===outTier }`; top-level `ok` iff every species has `sumCount === inCount + outCount && roundTrip && noSelfPair`.
- `treeTriangles()` (issue 15): per species and tier `{ crown: geo.index.count/3, trunk: … }` from the built geometries (impostor: 2).
- `frameTimes()`: `{ ms: [...FRAME_MS], tris: renderer.info.render.triangles, draws: renderer.info.render.drawCalls }`.
- `gpuTimingEnabled()`: `renderer.backend?.trackTimestamp === true`. `gpuTime()`: `await renderer.resolveTimestampsAsync('render'); return { ms: renderer.info.render.timestamp, frame: FRAME_NO }` — the sum of every render pass since the previous resolve (§1.7); the caller normalises by frames elapsed.
- `settled` (WT 8157): `!camTween.on && FRAME_NO >= TIER_FRAME + 2 && (TREE_LOD.clockDriven || TREE_LOD.queue.length === TREE_LOD.qHead)` — with a driven clock the queue drains only when the meter advances it, so the queue term is the meter's business there.

---

## 5. Tools

### 5.1 `tools/tree-pop-meter.mjs` (new; playwright-core, `browserArgs()`, `BANVY_GPU=1`)
Boots `?bana=puttom&det=1&v2=require` (det pins sky, flag cloth and the wind's `time`, so the only per-frame change is trees and camera), waits `#boot.done` and `settled()`, then `driveTreeFadeClock(true)`; from here every simulated frame is one `setTreeFadeClock` step followed by `waitForFunction(frame() > f0)`. Views: 5th tee noon, 1st tee golden, 14th green golden (the plan's three) plus 13th tee golden for the dolly. `--build today|new` labels the output; `--out` writes JSON for the plan.

**Mode A — annulus (the event a camera move produces)** (issues 2, 14), per view, `hero0 = treeLodPx().hero`:
1. `setTreeFade(0)`; `freezeTreeTiers(true)`; `pixelDelta()` (prime); `setTreeLodPx({hero: hero0 × 1.25, reset: true})`; `freezeTreeTiers(false)`; one frame; `S = pixelDelta().changed` — the pop, fade off: the trees between 110 and 137 px switch hero → full at once. Restore (`setTreeLodPx({hero: hero0, reset: true})`, one frame, `settled`).
2. `setTreeFade(0.3)`; freeze; prime; `setTreeLodPx({hero: hero0 × 1.25, reset: true})`; unfreeze; one frame; `d0 = pixelDelta()`; then for `L = 1..16`: `setTreeFadeClock(t0 + L × 0.3/16)`, one frame, `dL = pixelDelta()`; then `setTreeFadeClock(t0 + 0.3 × 17/16)`, one frame, `dDrain = pixelDelta()`. Record `treeTiers().fading` and `updateMs` at each read.
Gates: `d0.changed ≤ 0.01 %` of pixels (the first frame of a fade is the frame before it); `dDrain.changed ≤ 0.01 %` (the OUT removal is invisible); `max_L dL.changed ≤ S / 8`; `Σ_L dL.changed` within 10 % of `S` (complementarity — every differing pixel flips exactly once; the tolerance is for MSAA resolve noise at silhouettes, and if the sum comes out below 0.9 S the mask is not partitioning).

**Mode B — mass (machinery stress)**: `setTreeLod(3)`; advance the clock by `0.3 × 17/16` and one frame so every fade drains; prime; `setTreeLod(0)` (every visible tree crossfades back to its natural tier — 13k simultaneous fades); the same 16-level walk and gates as A, plus `treeTierAudit().ok` after the drain. The original "setTreeLod(3) then setTreeLod(0)" without a settled fade between them measured a one-level reversal, not a fade (issue 2).

**Mode C — dolly, A/B against a frozen tier state** (issue 14), per tee view: `dir` = the xz unit vector from `camInfo().pos` to `camInfo().look`; 400 simulated frames at 0.25 m each (100 m of travel), eye 1.7 m over `probeH(x, z)`. Per simulated frame `i`: `freezeTreeTiers(true)`; `placeCamera(p_i, p_i + dir)`; one frame; `pixelDelta()` (camera motion — discarded, but it primes the previous buffer); `freezeTreeTiers(false)`; `setTreeFadeClock(t += 1/60)`; one frame; `d_i = pixelDelta()` = pixels changed by tiering (new switches, fade progress, drains) alone. Run with fade 0 and fade 0.3, and the WHOLE protocol first on TODAY's cell build (HEAD, which lacks the freeze — add `freezeTreeTiers` and `pixelDelta` in the first commit of §6, before per-tree tiering, so the baseline is measurable with the same instrument). Report median, p95, max of `d_i / total` and the ratios `max/median`, `p95/median` per view and build.

### 5.2 What the dolly can and cannot prove (a correction to issue 14's proposed gate)
In steady state the fade does not reduce the per-frame change: a pop spread over 16 levels contributes 1/16 per frame for 16 frames, and with pops arriving every frame the per-frame sum equals the unfaded mean. What the fade removes is the SPIKE of any one switch, and what per-tree tiering removes is the spike of a whole cell. So the "≤ 1/8 of the pop" claim holds for an isolated event (Mode A, gated there) and is NOT a dolly gate. Dolly gates:
- **Instrument check, on today's build, fade 0**: `max/median ≥ 5` on at least one tee view (the cell pop shows as a spike). If it does not, the meter cannot see the thing the owner sees — stop and fix the meter before measuring anything else.
- **New build, fade 0.3**: `max/median ≤ 2` and `p95/median ≤ 1.5` at every view; `max` (absolute) ≤ 1/4 of today's `max` on the same view is REPORTED, not gated, because the two builds' switch sets differ by design (per-tree height).
- A cell entering the frustum during the frozen frame is added on the unfrozen one and counts in `d_i`; with the 8 m dilated boxes those trees are off-screen or at the edge. Stated, not corrected.

### 5.3 `tools/tree-tiers-at.mjs` (extend)
`--px hero,full,impostor` (appends `&lodpx=`), `--views plan|golden|all` (its three views, the 12 `GOLDEN_VIEWS` from `golden-views.mjs`, or both), `--long-axis` (adds the view down MIDR's long axis: camera at `(0, probeH(0, −1570) + 2, −1570)` looking at `(0, same, 1500)` — Puttom's MIDR is x −1336…1336, z −1580…1572, the ~30k-tree case), `--frames` (after settle, 120 samples of `updateMs`, `frameTimes()`, `treeTiers()` counts, `treeTriangles()` once), `--gputime` (boots with `&gputime=1`, launches with `browserArgs({ uncappedFrameRate: true })`, asserts `gpuTimingEnabled()` and **exits 2 with a message if it is false** — a 0 is not a measurement; then per sample `await gpuTime()`, wait `frame() > f`, and divide `ms` by the frames elapsed since the previous sample; median and p95 over 120). Chrome ≥ 121 is expected to expose `timestamp-query` (quantised to 100 µs, adequate for a millisecond gate); if the assertion fails, retry with `--enable-dawn-features=allow_unsafe_apis` added to the launch args and record which it took in the plan. Never mix `--gputime` runs with vsync-locked runs in one table.

### 5.4 `tools/boot-profile.mjs`
Unchanged. `--fingerprint` is gate 6.1; `--frames` records `firstFrames` (CPU wall, §1.7).

---

## 6. Order of work and gates

Run from Git Bash (or `$env:BANVY_GPU='1'` in PowerShell); the app is served by `node tools/serve.mjs apps/golf/dist 8620` after `cd apps/golf && npx vite build`.

### 6.1 Commit 1 — the machinery at the OLD thresholds, `fadeS` 0 under det, plus the instruments
Includes `tree-fade.mjs` + test, `aFade` on every tier, `maskNode` on every tree material, the drain/rebase, `captureRaw`, `pixelDelta`, `freezeTreeTiers`, `driveTreeFadeClock`, `setTreeFadeClock`, `treeTierAudit`, `treeTriangles`, `gputime`, `golden-views.mjs`, the `browserArgs` option — but STILL cell-granular decisions (so the baseline dolly of §5.1 C is measurable on this commit with the same instrument). Gates:
- `pnpm test` (new tree-fade tests), `node tools/lint-app.mjs`.
- `BANVY_GPU=1 node tools/boot-profile.mjs --fingerprint`: **placement keys identical** — `trees`, `treeInstances`, `tintNear`, `tintFar`, `counts.{trees, vista, reeds, tufts, bushes, stones, stumps}`. `counts.draws` is `stats.draws` overwritten by `renderer.info.render.drawCalls` at WT 7791 — a rendering count that depends on what rendered since the last `info.reset()` — so it is REPORTED beside the placement keys and any change explained (expected unchanged here: no mesh is added or removed), never gated as placement (issue 16).
- `node tools/check-app.mjs` on all nine courses; `node tools/vegetation-baseline.mjs --label v2`.
- 12-view goldens on Puttom under det, STRICT (`tools/parity.mjs`, 0.10/255) against the previous build: the mask never fires under det (`fadeS` 0, every entry code 0), so this proves the shader change is pixel-neutral — including the shadow pass, whose colour node is now wrapped with a discard that never fires.
- Pop-meter Mode C on this commit with fade 0 = the "today" baseline (§5.2 instrument check must pass — the spike must be visible).

### 6.2 Commit 2 — per-tree tiering (each tree's height, per-tree hysteresis, stride with the entering-cell rule)
- Fingerprint placement keys identical; `check-app`; vegetation baseline; `pnpm test`; lint.
- **STRICT (0.10/255) under `?lod=1`, `?lod=2`, `?lod=3`, `?lod=4` on the 12 `GOLDEN_VIEWS`** against commit 1 (one `shot.mjs --seq` boot per lod value): force puts every visible tree in one tier, so the swap-remove/append/`aFade` machinery must render pixel-identically whatever the decision rule does — this is what catches a tree drawn twice, a swapped slot pointing at another tree's matrix, or an OUT entry never drained, which a 2.5/255 perceptual gate at its own 1.9–3.3/255 noise floor cannot (issue 17). Plus `treeTierAudit().ok` on every view, with `sumCount === visible trees + fading trees`.
- Perceptual (2.50/255) on the far views and by eye on the tee views at the old thresholds for the DECISION change only (the nominal 12 m becomes each tree's height); record `tree-tiers-at.mjs` counts before/after.
- **`updateMs` gate (issue 18)**: `BANVY_GPU=1 node tools/tree-tiers-at.mjs --views all --long-axis --frames` → p95 `updateMs` ≤ 1.0 ms at every view with stride 1. If it fails, set desktop `stride = 2` and state its cost (one extra frame of latency on half the cells) in the plan. LOWQ: one `?q=lo` run under a 4× CPU throttle (`page.context().newCDPSession(page)` → `Emulation.setCPUThrottlingRate({ rate: 4 })`) before per-tree is enabled there; stride 2 is the LOWQ default until then.

### 6.3 Gate (b) — the pop-meter on the 3070 (fade 0 vs 0.3)
Modes A, B, C of §5.1 on commit 2 with `setTreeFade(0.3)`; every gate in §5.1–5.2. Look at it. If the 4×4 pattern shimmers on the 60–110 px trees, switch `bayer4` → `bayer8` (one function, one test) and re-run Mode A.

### 6.4 Gate (c) — the threshold sweep in GPU milliseconds (issue 12)
`BANVY_GPU=1 node tools/tree-tiers-at.mjs --gputime --frames --views all --px …` over `{hero: 110, 80, 64, 48} × {full: 40, 30, 24, 18} × {impostor: 14, 10, 8, 6}` (prune to the ~20 monotone combinations). First the baseline: 110/40/14 on commit 2 (the discard's own cost is inside both sides; measure it separately once as commit 1 vs HEAD at 110/40/14 and record it). Per view report GPU ms median/p95, `renderer.info.render.triangles`, `updateMs` p95, tier counts. **Pass: GPU p95 ≤ baseline p95 + 1.5 ms at every golden view.** Pick the largest hero/full and smallest impostor that pass; commit them as the desktop defaults with the table in the plan; LOWQ untouched.

### 6.5 Judge the hero handover by eye at the chosen hero threshold; apply the bark normalisation (§2.10) if the trunk step still shows and the owner wants it.

### 6.6 Byte budget
GPU: `aFade` 8 B × n × (3 mesh tiers × 2 parts + 1 impostor) = 56 B/tree ≈ 4.4 MB at Puttom (matrices already 384 B/tree ≈ 30 MB). CPU: `outTier`, `whereOut`, `fadeT0`, `fadeCode`, `treeH`, `treeCY` = 18 B/tree ≈ 1.4 MB. Per-frame upload: fade ranges only on frames with moves/drains/rebases; worst case one part's whole `aFade` buffer (pine 294 KB); matrices keep today's tight ranges. Queue: the trees that switched in the last 0.32 s.

---

## 7. Docs
`docs/tree-lod-plan.md` status section (phase 4: the fade model with the epsilon/epoch rules, the per-tree decision with its MEASURED `updateMs`, the per-species triangle counts from `treeTriangles()`, the pop-meter tables for today/new × fade 0/0.3, the GPU-ms sweep table and the chosen defaults, and which timestamp path Chrome took); `docs/puttom-performance-status.md` "What is left" items 1 and 3. CLAUDE.md gets a paragraph only if a new trap is found on the way (candidates: the vsync-locked RAF interval, and `goldens.mjs` being a script).

---

## 8. Review issues — disposition
| # | issue | folded where |
|---|---|---|
| 1 | `goldens.mjs` is a script with side effects | §3.4 `tools/golden-views.mjs` |
| 2 | static trigger measured a one-level reversal | §5.1 A/B (settled fade between calls; annulus via `setTreeLodPx`) |
| 3, 11 | anchors were HEAD's; line count and diff description wrong | §0.1 (WT/HEAD pairs, grep strings, commit/stash first) |
| 4 | f32 boundary at drain and reversal | §2.4, §3.1 (epsilon, late drain, half-level reversal, epoch rebase, fround test) |
| 5 | stride skipped entering cells | §3.3 `wasVisible` rule |
| 6 | `THREE` not imported | §3.1 |
| 7, 15 | cone triangle counts | §1.6 per species; budget in measured triangles; `treeTriangles()` |
| 8 | `flat` without `either` | §1.4, §3.1 |
| 9 | 5.76 MB per readback over CDP | §4 `pixelDelta` |
| 10 | bash syntax | §0.2 |
| 12 | vsync-locked RAF; CPU "14 ms" | §1.7, §3.5, §5.3, §6.4 (GPU ms gate, uncapped frame rate, fail-loud) |
| 13 | readback latency vs frame-advanced clock | §2.6, §4 (`driveTreeFadeClock`, `setTreeFadeClock`), §5.1 |
| 14 | dolly dominated by camera motion; no baseline | §4 `freezeTreeTiers`, §5.1 C, §5.2 (with the steady-state correction) |
| 16 | `draws` is a rendering count | §6.1 placement keys |
| 17 | perceptual gate cannot see a broken slot table | §6.2 strict under `?lod=`, `treeTierAudit` |
| 18 | invented µs; lists are arrays; no gate | §2.7, §3.3 `Int32Array`, §6.2 `updateMs` gate + long-axis view + LOWQ throttle |

## 9. Fingerprint invariance, stated
Nothing here reads or writes `trees[]`/`treeWhy[]` (`legacyTreeExport` WT 3721 reads only those and `V2_VEG_COVER`); the fill loop only ADDS `treeH/treeCY`; the cell lists change container, not content; no mesh is added or removed; the tint rasters are untouched. Under `?det=1` the default fade is instant, so det frames are today's frames.
