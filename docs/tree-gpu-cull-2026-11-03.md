# The trees culled on the GPU (3 November 2026)

`?treecull=gpu`, WebGPU at high quality. Opt-in: the A/B with the v2 trees was
measured on the night of 3-4 November, and the owner decides the default.

## Why

The tiers (`main.js` `TREE_LOD`) decide on the CPU, per 128 m cell, which trees
each tier draws. A cell that is half in view draws every tree in it, including
those behind the eye and off to the sides, in the hero tier's 3-6k triangles
each.

## What it does (`engine/tree-gpu-cull.mjs`)

- **Storage buffers:** the hero tier's instance buffers (`instanceMatrix`,
  `aFade`, `aTint`) are storage-capable (`StorageInstancedBufferAttribute`):
  vertex buffers for the draws, storage buffers for the pass. They are uploaded
  by their dirty ranges as before.
- **The pass:** before each frame, a compute pass per hero tier tests each
  drawn tree's bounding sphere (the template's cylinder from its impostor atlas
  bounds, scaled by the instance, with a margin for the sway) against the
  camera's frustum. The survivors' matrices, crossfades and tints are appended
  by an atomic counter into a copy of the tier.
- **The draws:** the copy is drawn by two indirect draws, crown and trunk
  sharing one count.
- **Shadows:** the tier's own meshes move to a layer only the sun's shadow
  camera sees (`TREE_SHADOW_LAYER`), so every tree, in view or not, still casts
  as before (docs/tree-shadows-zoom.md). The copies cast nothing.
- **Growth:** a tier that grows (`reserveTreeTier`) keeps its storage buffers
  (cloned with their class), and its copy is rebuilt on the next frame.
- **Untouched:** the CPU's tier logic (crossfades, dwell, the distant hero's
  24 px) and the impostors.

## Evidence so far

- Puttom 1 tee, `treeset=v2`, 960 x 540: 9 hero tiers. The pass keeps 228 of
  284 drawn hero trees in this view.
- The picture against the CPU path: mean difference 0.6/255, 0.24% of pixels
  over 8, from the wind and temporal AA between captures. The trees' shadows
  are all there.
- No console or validation errors.
- `tree-gpu-cull.test.mjs`: storage buffers survive growth, the shadow layer,
  the wiring.
- Clean boots (night of 3 November): all 13 courses on WebGPU at high quality
  with `aa=traa&treeset=v2&treecull=gpu`, at most 14 vertex outputs.
- GPU time (4 November, the GPU otherwise idle): interleaved A/B
  (`tools/goldens/gfx/ab-time.mjs`), two rounds, vsync lifted, 1920 x 1080,
  `treeset=v2`:
  - Puttom 5 green: 11.50 ms without the cull, 11.10 ms with it (-0.40 ms,
    -3.5%);
  - Veckefjärden 13 tee: 9.00 → 8.70 ms (-0.30 ms, -3.3%).

  Every round agreed to 0.1 ms.
- The same A/B on the morning of the 4th, the GPU not confirmed idle:

  | view | v2 | v2 + cull | painted | painted + cull |
  |---|---|---|---|---|
  | Puttom 5 green | 12.70 ms | 12.15 ms | 11.35 ms | 12.45 ms |
  | Veckefjärden 13 tee | 9.05 ms | 9.25 ms | 7.95 ms | 8.70 ms |

  That does not repeat the night's saving at Veckefjärden, and the painted trees
  lose by it. The gallery's GPU timer, not interleaved, shows 11 of 12 views
  faster, by up to 2.5 ms. These disagree, so the cull's cost is not settled.
- `check-hero-impostor` passes with the cull on.
- The picture: the gallery's deterministic views differ from the CPU path in up
  to 5% of pixels, all thin edges of crowns that are there. No tree is missing.
  The cull renumbers the instances, which is the likely cause.
- `check-tree-tier-capacity` with the cull on fails its image step, but so does
  the same harness at high quality without the cull. It is built for low quality.
- `check-tree-shadows` proves one tree in an isolated scene, so it cannot run the
  cull. The picture above is the evidence for the shadows.

## Still to do

- Settle the cost on a clean A/B: frame intervals and GPU time together.
- Next step if it pays: cull the impostor tier the same way, and pick the tier
  on the GPU too.
