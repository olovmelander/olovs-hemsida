# The trees culled on the GPU (3 November 2026)

`?treecull=gpu`, WebGPU at high quality. Opt-in until it is measured: the owner
asked to keep the GPU cool on the 3rd, so the performance A/B waits for a
full-speed session.

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

## To do in a full-speed session

- Interleaved A/B (`tools/goldens/gfx/ab-time.mjs`) at Puttom 5 green and
  Veckefjärden 13 tee, `treecull=gpu` against none, with v1 and v2 trees.
- Clean boots with `treecull=gpu`.
- `check-tree-shadows`, `check-tree-tier-capacity` and `check-hero-impostor`
  with the cull on.
- Next step if it pays: cull the impostor tier the same way, and pick the tier
  on the GPU too.
