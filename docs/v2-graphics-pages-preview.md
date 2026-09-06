# V2 graphics preview on GitHub Pages

Prepared 2026-09-06 against published main
`a9c2d441c86542f1179edd6d08c0a3a0d25b5011`. The integration branch is
`codex/v2-graphics-pages-preview`. Only the graphics commits were carried over
from the separate mapping-based graphics branch. Course packs, mapped objects,
terrain, vegetation population and geographic tree detail zones remain identical
to that main revision, including its lake corrections.

## Review links after deployment

The preview requires `graphics=1` and active v2 terrain. Flagless visits and
`graphics=0` retain the established appearance. The unified app root is the review
target; the separate `upsala3d.html` file does not contain these changes.

- [Uppsala preview](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&v2=require&graphics=1&hal=1&vy=tee&ljus=kvall&q=lo&qualitylock=1)
- [Uppsala current appearance](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&v2=require&graphics=0&hal=1&vy=tee&ljus=kvall&q=lo&qualitylock=1)

These links deliberately match quality and prevent automatic drawing-buffer
reduction. Review Puttom's forest and Veckefjarden's water by changing `bana` to
`puttom` or `veckefjarden`. Use `gl=1` for WebGL2; otherwise the existing renderer
selection prefers WebGPU where available. Verify the actual backend and buffer
when recording measurements. Reload an existing app tab to obtain the new bundle.

## Changes

- Environment reflections follow the selected sky/lighting preset. Baking runs
  on preset changes, with a maximum of two cached environment maps.
- V2 ground roughness reuses the existing detail texture samples, with restrained
  variation across turf, sand and hard surfaces.
- Hero trunks retain their cylindrical/cap UVs. Their positions, normals, indices
  and bounds match the previous geometry; each species template adds 528 UV bytes.
- `qualitylock=1` makes controlled comparisons explicit; ordinary visits retain
  the existing automatic quality policy.

## Validation

The main-based integration passed 331 Vitest tests and 295 Node tests, the
production build with `BANVY_BASE=/olovs-hemsida/`, app lint, the v2 renderer/build
checks and source manifest validation. Course-data and tree-detail files are
unchanged relative to the main revision above.

A 128 x 128 WebGL2 SwiftShader smoke check rendered the real class/pair materials
with graphics disabled and enabled, textured/bump-mapped trunk geometry, and
golden/noon/mist environment changes including eviction. It completed with no
console or page errors. The disabled environment reused one bake across presets.

The local WebGPU runner fails at PMREM texture creation with a Chromium
`GPUTextureComponentSwizzle` error. The original main environment block fails
identically in that runner. WebGPU remains an open validation check.

The main-based build also completed an Uppsala tee/golden screenshot with no
graphics query. It confirmed `graphicsPolish=false`, an 800 x 500 drawing buffer,
DPR 1, locked low quality and geographic tree zones. Terrain was ready with no
loading/failed tiles. No page/shader errors were reported. The overall capture
report failed on seven obsolete terrain-request cancellations, which its running
harness still classified as errors. The final harness treats those cancellations
as warnings but still requires fully settled terrain. No accepted full-course A/B
comparison has been completed.

These software checks establish shader/lifecycle behavior only. There is no real
GPU access here, and no claim of unchanged FPS, total startup or memory usage.

For a repeatable software comparison of the Pages build:

```sh
node tools/v2-graphics-review.mjs --root apps/golf/dist --base-path /olovs-hemsida/ \
  --out /tmp/banvy-before --course upsala --backend webgl2 --q lo --graphics default \
  --views 1:tee:golden --width 800 --height 500
node tools/v2-graphics-review.mjs --root apps/golf/dist --base-path /olovs-hemsida/ \
  --out /tmp/banvy-after --course upsala --backend webgl2 --q lo --graphics 1 \
  --views 1:tee:golden --width 800 --height 500 --compare /tmp/banvy-before/report.json
```

## Required before making the preview the default

Compare desktop WebGPU and phone WebGL2 separately on real devices. Keep the
course data, actual drawing-buffer dimensions, quality, backend, lighting and
camera trajectory identical; verify that quality fallback did not reduce
resolution. Record median/p95/p99 frame times, moving-camera hitches, startup and
memory. Also measure the first lighting-preset switch and two-map cache residency.

Review Uppsala visually, Puttom for forest load and Veckefjarden for water.
Keep the preview opt-in until both appearance and the same-or-better performance
requirement are accepted.
