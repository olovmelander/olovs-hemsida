# three.js r186 upgrade — validation record

**Follow-up:** the owner requested the same atmospheric sky in Målad and
realistic, with reduced brightness. See [shared atmospheric sky](shared-atmospheric-sky.md)
and the subsequent [eight-mode atmosphere review](eight-atmospheres.md).
The comparison below
records the upgrade before that intentional sky change.

## Validation, 2026-09-13

**The missing forest is not reproduced on hardware WebGL2 or WebGPU.**
The original `5ecc199c` application, without any new culling or tree changes,
renders the forest on this machine's NVIDIA Ampere adapter (RTX 3070 Laptop,
driver 32.0.15.7247) in Chrome 152.0.7977.83. Nothing has been merged to main.
The forest is also visible with this browser's SwiftShader WebGL2 renderer.

Validation uses an isolated checkout of `5ecc199c`: other work was editing
the shared application and rebuilding its `dist` directory during this session.
The r185 comparison uses the same application with `three@0.185.1` resolved
through isolated Vite aliases. Both sides use the same browser, adapter,
viewport, explicit quality and URL state. The shadow setting is `PCFShadowMap`
on both sides. This report does not validate concurrent shot-planner or road
rendering changes in the shared checkout.

### Results

| Check | Result |
|---|---|
| Frozen lockfile install / production build | Pass, `three@0.186.0` |
| Vitest in the isolated checkout | **963/963**, 127 files |
| Node test suite | **454 passed, 3 skipped**, 0 failed (457 tests) |
| `tools/lint-app.mjs` | Pass |
| Puttom hardware WebGL2, default painted look | Forest visible; r185/r186 perceptual parity passes |
| All 13 courses, hardware WebGPU, painted look | **117/117 rendering checks pass**, including forest and terrain visibility, camera changes, and browser errors |
| Puttom hardware WebGPU, painted look | Automatic LOD and all four forced tiers pass; r185/r186 perceptual parity passes |
| Puttom hardware WebGPU, realistic look | All four tree tiers visible; camera change preserves forest |
| WebGPU realistic sky, reversed depth on and off | Sky shades correctly; terrain remains visible beneath it |
| All eight lighting presets, realistic WebGPU | World and sky render after every switch; no browser/renderer errors |
| Mobile viewport, WebGL2, low quality | Forest/terrain/camera checks and r185/r186 perceptual parity pass |
| Windows SwiftShader WebGL2, high quality | Forest visible in both versions; r185/r186 perceptual parity passes |
| `check-app --only=puttom` | Same known **17/72 tee-marker** failure from the handoff |

The course sweep covers Ängsö, Norrfällsviken, Puttom, Upsala, Upsala
Mellanbanan, Johannesberg, Johannesberg 9, Veckefjärden, Veckefjärden
Korthålsbanan, Ribbingsfors, Visby, Tortuna and Lidingö. Each course is checked
from the first tee and overhead after a camera change.

Retained evidence: [machine-readable results](graphics/three-r186-2026-09-13/summary.json),
[painted tee](graphics/three-r186-2026-09-13/painted-webgpu-tee.png),
[overhead forest](graphics/three-r186-2026-09-13/painted-webgpu-overhead.png),
[realistic tee](graphics/three-r186-2026-09-13/realistic-webgpu-tee.png),
[r186 atmospheric sky](graphics/three-r186-2026-09-13/realistic-webgpu-sky.png),
[r185 fogged sky](graphics/three-r186-2026-09-13/r185-fogged-sky.png),
[storm lighting](graphics/three-r186-2026-09-13/realistic-storm-tee.png),
[blue-hour lighting](graphics/three-r186-2026-09-13/realistic-bluehour-tee.png),
[SwiftShader r186 forest](graphics/three-r186-2026-09-13/painted-software-tee.png),
[SwiftShader r185 reference](graphics/three-r186-2026-09-13/r185-software-tee.png).

The Node suite needs the separate `packages/course-geo/copc-reader` dependencies.
Two pre-existing Windows checkout issues also needed attention in the isolated
checkout: `lidingobuild/mapping/approaches-2025.geojson` and
`bunker-additions-2025.geojson` had newline-converted bytes. Restoring the exact
Git blob bytes made their pinned source hashes pass. No source coordinates or
hash expectations were changed. An initial Vitest run under heavy concurrent
browser load hit timeouts; the complete isolated run above passed unchanged.

### The forest diagnosis

Puttom hole 1, tee view, high quality, 1600 × 900:

| Renderer | Trees in tiers 0 / 1 / 2 / 3 | Rendered triangles | Draw calls |
|---|---|---:|---:|
| r185 hardware WebGL2 | 772 / 3689 / 0 / 31568 | 14,780,132 | 165 |
| r186 hardware WebGL2 | 772 / 3689 / 0 / 31568 | 14,780,132 | 165 |
| r186 hardware WebGPU, reversed depth | 772 / 3689 / 0 / 31568 | 15,711,972 | 165 |

WebGL2 comparison: **mean 1.1768/255; 0.011% of pixels over 8; worst 20**.
The large foreground birch and forest wall are present. The mobile low-quality
comparison is **mean 1.3319/255; 0.000% over 8**.
The 960 × 540 painted WebGPU comparison also passes: **mean 1.8664/255;
0.060% over 8**.

The proposed frustum workaround was already in place: every tree tier mesh
and impostor batch has `frustumCulled = false`. Recomputing those meshes'
spheres would not change their submission. Also, `lodpin=0,0` does **not**
force the near tier: the URL parser rejects zero and keeps the default floors. Use
`V3D.setTreeLod(1)` through `(4)` to force actual tiers.

No speculative changes have been made to planting, bounds, instance uploads,
LOD, or three's internals. The original Linux/SwiftShader environment and images
were not retained in this checkout, so its exact failure remains unexplained.
On Windows/Chrome 152, software WebGL2 renders the foreground birch and forest
wall. A normal Playwright screenshot timed out; rendering and reading the
canvas in the same browser task succeeded. This is a capture-tool distinction,
not evidence that the earlier missing forest had that same cause.
The matched software comparison (960 × 540, high quality, default golden
lighting) passes: **mean 1.4206/255; 0.000% over 8; worst 8**. Both versions
have the same tier populations, 13,848,292 rendered triangles and 165 draw
calls, with no browser or renderer errors.

### The sky has an intentional visual change

The default painted look never constructs `SkyMesh`, including on WebGPU.
Testing the actual sky patch requires **`look=real`** as well as WebGPU.

r186's `SkyMesh` now sets `material.fog = false` and has substantially revised
cloud shading. In r185, this app's 12 km sky was fogged to the background colour.
The new sky-only check correctly fails r185: luminance range **0.0/255**. It
passes r186 with both depth conventions (ranges **22.0** and **13.0/255**).
The brighter atmospheric sky also contributes to bloom, so a full-frame r185
versus r186 comparison of realistic daytime mode fails perceptual parity
(**43.9670/255; 95.563% over 8**). This is a documented appearance change;
restoring the old flat fog colour would hide the sky again. The owner explicitly
asked to retain r186's visual improvements. We therefore keep the improved sky
and use rendering/visibility checks for acceptance, rather than matching that
old fogged image.

The existing reversed-depth vertex patch remains valid: the far clip depth
is zero on that path. r186 additionally fixes `renderOrder` under reversed
depth, so the old comment about three reversing the entire render list is
historical. The tests check the rendered sky and the world together.
Switching through golden, noon, mist, dawn, autumn, midnight, blue hour and
storm also passes, preserving their different lighting and the new cloud shading.

Sources: [r186 migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide#185--186),
[Sky/SkyMesh cloud changes](https://github.com/mrdoob/three.js/pull/33942),
[r186 SkyMesh source](https://github.com/mrdoob/three.js/blob/r186/examples/jsm/objects/SkyMesh.js),
[reversed-depth render ordering](https://github.com/mrdoob/three.js/pull/33945).

### Repeatable browser acceptance

`tools/check-three-rendering.mjs` measures pixels, not just planted counts:

- Requires the requested renderer and depth convention to actually be active.
- Checks the live tree-slot audit, then freezes LOD and hides trees. More than
  0.1% of pixels must change by over 8/255; a submitted-but-invisible forest fails.
- Hides graph terrain separately; over 1% of pixels must change, catching a sky
  that covers the world.
- Moves to the overhead camera and checks visible forest again, exercising
  cell culling and updated instance slots.
- In realistic WebGPU mode, aims above the world and requires a shaded sky.
- Records browser/renderer errors, captures PNGs, and writes a JSON report.
- `--presets` switches among all eight lighting presets and checks the world
  and atmospheric sky after each change.
- `--capture canvas` uses a WebGL2 drawing-buffer readback, useful when
  SwiftShader's compositor screenshot takes too long. Keep the capture method
  identical on both sides of a comparison.
- `--reference` retains the existing perceptual limits (mean ≤ 2.5/255,
  at most 5% over 8). Use it for the painted look; realistic skies intentionally differ.

PowerShell, against a stable production build:

```powershell
node tools/serve.mjs apps/golf/dist 8620
# In another terminal:
$env:BANVY_GPU = '1'
node tools/check-three-rendering.mjs --backend webgpu --all
node tools/check-three-rendering.mjs --backend webgpu --tiers
node tools/check-three-rendering.mjs --backend webgpu --look real --tiers
node tools/check-three-rendering.mjs --backend webgpu --look real --rdepth 0
node tools/check-three-rendering.mjs --backend webgpu --look real --presets
node tools/check-three-rendering.mjs --backend webgl2 --mobile --quality lo
# An independently built r185 copy served at 8621:
node tools/check-three-rendering.mjs --backend webgl2 --reference http://127.0.0.1:8621
# Software WebGL2 (never label this as hardware evidence):
Remove-Item Env:BANVY_GPU
node tools/check-three-rendering.mjs --backend webgl2 --capture canvas
```

`--base` selects the current build's URL; `--out` selects the evidence directory.
`BANVY_CHROME` can select a specific Chromium executable. Mobile checks emulate
viewport, DPR and touch in Chromium; they are not physical Android/iOS tests.

## Original handoff (retained as historical evidence)

Started 2026-09-13 on `claude/golf-strategies-modes-audit-ciaejw`, rebased onto
`main` at `c0746b34`. **`three` is bumped to 0.186.0 in this branch and there is
an unresolved visual regression.** The branch builds and tests green; it is not
ready to ship.

## What is done

| Check | Result |
|---|---|
| `vite build` | clean, no source change needed beyond the one below |
| `vitest run` | **963/963 pass**, 127 files |
| `tools/lint-app.mjs` | clean |
| Boot, Puttom `?v2=require` | boots; world **bit-identical** to r185 |

**One source change was required.** r186 removed `PCFSoftShadowMap` from the
WebGPU renderer and made `PCFShadowMap` the soft one on both backends, so
`main.js` sets `PCFShadowMap` now. Nothing else in the r185→r186 migration notes
touches this repo: no `Object3D` subclasses (the new `super.dispose()` rule is
moot), no `toTrianglesDrawMode`, `THREE.Source`, `SimplifyModifier`,
`LightProbeGrid`, `GTAONode`, `pixelationPass`, `setViewport`/`setScissor`.

**The world is unchanged**, by `boot-profile --fingerprint` on Puttom:

```
trees          ccf7ff8792573d8510d26a318f799d6df963ca4a645fa5a156dbe6e37a90e7d5
treeInstances  2d69a84e020e20c8cdf1957c41dcbf47973fba0443f7775a4a0ecc27f1ba0ec4
tintNear       5089fb3c9f44f0258fc4a948aeab99e9df41e4c770423f3e1fe1b9de341b8919
tintFar        570618a4a3c7a7d811d5ad320b3d257a4fe55433adf261777aaa6b71bddbf151
counts  trees 209962  vista 596680  reeds 479  tufts 4971  bushes 857
        stones 199  stumps 0  draws 118
```

Every hash and every count is identical on r185 and r186. So r186 changes
nothing about what the boot BUILDS.

## The regression

A tee-view capture of Puttom's 1st differs between the two versions by
**mean 16.4239/255, 13.489 % of pixels over 8, worst channel delta 201**
(`tools/parity.mjs --perceptual`). Looking at the two frames: **trees are
missing in r186** — the large foreground tree is gone and the dense forest wall
on the left has collapsed to a thin distant treeline. The scattered pines and
every building, pole, path and HUD element are unchanged.

**The fingerprint passes while the picture changes**, which is the whole
diagnosis in one line: the trees are PLANTED identically and NOT DRAWN. This is
a culling or instance-visibility difference, not a data one.

### It is the library, not the one-line edit

Two captures of the same view settle it:

| comparison | result |
|---|---|
| r186 + `PCFSoftShadowMap` vs r186 + `PCFShadowMap` | **0.0000/255, bit-identical** |
| r185 + `PCFSoftShadowMap` vs r186 + `PCFSoftShadowMap` | **16.4239/255** |

So the shadow-type change is visually inert — r186's `PCFShadowMap` really is
the same picture under the surviving name — and **100 % of the difference comes
from r186 itself**.

### Leading hypothesis

r186 added `Object3D.intersectsFrustum()` (#34065) and reworked frustum culling.
This repo culls trees per 128 m cell with its own test, built against a
reversed-depth-aware frustum:

```js
TREE_FRUSTUM.setFromProjectionMatrix(TREE_PROJ, renderer.coordinateSystem,
                                     camera.reversedDepth ?? false);
```

and moves instances between `InstancedMesh` tiers by swap-remove and append with
matrices copied from a table (`docs/tree-lod-plan.md`). Either three's own
culling of those instanced meshes changed, or a computed bounding volume did.

**Not yet tested**, and these are the next steps:

1. Compare `renderer.info.render.triangles` and `V3D.stats` tier counts between
   the two builds on the same view — that separates "not submitted" from
   "submitted and clipped".
2. Pin the LOD (`?lodpin=0,0`) and re-capture. If the trees come back, it is the
   tier machinery; if not, it is three's own culling.
3. Check whether the tier `InstancedMesh`es need `frustumCulled = false` or a
   recomputed bounding sphere under r186.

## Caveats on the evidence

- Every measurement above is **WebGL2 under SwiftShader** in a container. This
  repo's riskiest r186 surface is **WebGPU-only** — `reversedDepthBuffer` is
  `RDEPTH && !forceWebGL`, so the 13 reversed-depth references, `SkyMesh` and
  its reversed-depth `vertexNode` patch, and the WebGPU shadow path were **not
  exercised at all**. The sky patch's failure mode is documented (the sky-only
  frames of 2026-09-04) and only a rendered WebGPU frame catches it.
- r186 also replaced the PMREMGenerator spiral blur on both renderers, which
  will move environment lighting independently of the tree problem. Not isolated
  yet; it may be part of the 16.4.

## Unrelated: main is already red on one gate

`node tools/check-app.mjs --only=puttom` fails with *"all 72 tee markers stand on
tee grass — 17 do not"*. **This fails identically on r185**, so it arrived with
the mowing/tee-view commits that landed in the last 30, and is not an upgrade
regression. It should be fixed on its own.

## The cost, measured

r186 is bigger, not smaller — the release's tree-shaking note does not help here:

| | r185 | r186 |
|---|---|---|
| `three.webgpu` | 666.19 KB (187.60 gzip) | 706.60 KB (197.80 gzip) |
| `three.core` | 373.20 KB (99.59 gzip) | 377.00 KB (100.46 gzip) |
| precache total | 3912.02 KiB | 3957.91 KiB |

**+45.9 KiB.**

## Recommendation if this stalls

Nothing on this branch is load-bearing: reverting is `three` back to `0.185.1`
and the one shadow line. r186's only feature this project actually wants is
SunLight with cascaded shadow maps, which would replace the hand-rolled snapped
sun box — worth the upgrade eventually, but not worth shipping a forest that
does not draw.
