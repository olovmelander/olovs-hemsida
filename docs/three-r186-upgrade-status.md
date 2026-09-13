# three.js r186 upgrade — in flight, DO NOT MERGE YET

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
