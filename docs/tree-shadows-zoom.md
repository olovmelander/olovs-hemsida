# Tree shadows when zooming out

**Owner request, 24 September:** "I do not want the shadows from the trees etc
to disappear when zooming the camera out on a golf course."

Three things took them away, each measured before it was changed. All three
changes have a before switch, and the switches keep the prepared startup data
eligible, so an A/B pair differs only in its shadows:
`?impostorshadow=0&foliageshadow=mip&shadowreach=0` is the complete before.

## What made them disappear

1. **Impostors cast nothing.** Since the 24 px Distant Hero default
   (23 September), a zone A/B course tree becomes its impostor once its whole
   height projects under 24 px: about 600 m away at 1080 rows. Outer-zone trees
   and the far vista are impostors at every distance. The impostor batches were
   built with `castShadow = false` (the tree LOD plan's "impostors do not
   cast"). As the camera pulled back, each course tree's shadow went out with
   its mesh, and the forest beyond the 300 m corridor never cast at all.
2. **Mesh crowns thinned in the shadow map.** The crown material carried the
   foliage atlas as `map`. Three's shadow pass tests `map` alpha against the
   material's alpha test (0.5) at the mip level the shadow map's texel selects.
   As the camera pulls back the box grows, its texels grow and a coarser mip is
   read. A card whose averaged alpha falls under one half drops out of the map.
   By the 850 m box, where trees hand over to impostors, a crown kept on
   average three quarters of its shadow on a desktop's 2,048-texel map, and
   under two thirds on a phone's 1,024-texel map (as little as 38 %; tables
   below).
3. **The shadow box stopped at 1150 m.** `placeSun` sizes the box from the
   camera's distance to its target, and the largest size was 1150 m. Past about
   920 m every view got the same box, and the boundary fade removes shadows
   from 0.6 of its radius. So shadows ended 700–1100 m from the target all the
   way out to the 4.2 km zoom limit.

## What changed

- **Impostors cast** (`engine/tree-impostor.mjs`). The billboard faces
  whichever camera draws it. A perspective camera sees each tree along its own
  ray. An orthographic camera, which is what the sun's shadow camera is, sees
  every tree along one axis. So in the shadow pass each impostor turns to the
  sun and draws the tree's silhouette as the sun sees it, which is its shadow.
  It does not depend on where the player's camera is, so the on-demand shadow
  map stays valid while the camera orbits. The camera type is read on the GPU
  from the projection's last row, because three shares one shader build between
  cameras whose materials match. Three's shadow pass keeps none of the colour
  pass's discards, so the impostor states its cut as `maskShadowNode`: atlas
  coverage over one half, plus the crossfade dither for the tier batches.
  `shadowSide` is double-sided because three draws a front-sided caster's back
  faces into the map. The colour pass is bit-identical. Tier impostors always
  cast. The far vista casts only while the box is past its tuned 1150 m,
  because only then is it in view beside the course. `?impostorshadow=0` is
  the before.
- **Crowns cut their shadow at the atlas's full resolution**
  (`engine/ghibli-foliage-material.mjs`). The crown sets `maskShadowNode` to the
  level-0 atlas alpha over one half, and no longer sets `map`. Its colour pass
  never read `map`, because `colorNode` and `opacityNode` replace it, so the
  colour pass is bit-identical. `attachTreeFade` joins the crossfade into that
  mask, which three reads instead of `maskNode` in the shadow pass.
  `?foliageshadow=mip` is the before.
- **The box grows past 1150 m** (`engine/shadow-fit.mjs`). The fits add 1600,
  2200 and 3000 m, chosen by the same rule and hysteresis. Each larger box is
  the 1150 m box scaled: its depth range, light distance and normal bias grow by
  R / 1150. So a texel, the depth bias (a fixed share of the depth range) and
  the edge fade keep their proportions. Every fit up to 1150 m is exactly what
  it was, and a unit test replays the old rule over camera paths within 900 m.
  `?shadowreach=0` is the before. `V3D.shadowFit()` also reports the depth
  range, light distance and which casters are on.

## Evidence

All shader evidence comes from `tools/check-tree-shadows.mjs` against
`04cb52ae`, the build before this change. It ran in SwiftShader, with WebGL2
and WebGPU in reversed depth. The records are in
[the evidence directory](graphics/tree-shadows-zoom-2026-09-24/). The tool puts
each species' mesh and impostor at the origin on a white ground, under the
player's shadow type, filter, bias and `placeSun` box. It captures the ground
from above with no caster, with the mesh and with the impostor.

**Shadow kept as the box grows.** Each value is the caster's total shadow
darkness as a share of the same mesh's shadow at a fine texel (0.06–0.25 m).
It is shown as the mean and (minimum) over five species at two sun heights,
27° and 9°. "Before" is the old crown material.

Desktop: Hero model, 2,048-texel map (`webgl2-hero.json`; WebGPU is the same
to two decimals, `webgpu-hero.json`):

| box | texel | mesh before | mesh now | impostor |
|---|---:|---:|---:|---:|
| 260 m | 0.25 m | 0.96 (0.93) | 1.00 (0.99) | 1.03 (0.99) |
| 400 m | 0.39 m | 0.91 (0.84) | 1.00 (0.99) | 1.04 (1.00) |
| 600 m | 0.59 m | 0.82 (0.68) | 0.99 (0.98) | 1.03 (0.99) |
| 850 m | 0.83 m | 0.75 (0.63) | 1.00 (0.98) | 1.03 (0.99) |
| 1150 m | 1.12 m | 0.73 (0.60) | 0.99 (0.92) | 1.02 (0.98) |
| 2200 m | 2.15 m | 0.63 (0.49) | 1.00 (0.84) | 0.97 (0.85) |

Phone: Full model, 1,024-texel map (`webgl2-full.json`):

| box | texel | mesh before | mesh now | impostor |
|---|---:|---:|---:|---:|
| 260 m | 0.51 m | 0.90 (0.84) | 1.00 (0.97) | 1.05 (1.01) |
| 600 m | 1.17 m | 0.68 (0.48) | 1.00 (0.93) | 1.02 (0.92) |
| 850 m | 1.66 m | 0.64 (0.38) | 0.99 (0.91) | 0.99 (0.85) |
| 1150 m | 2.25 m | 0.62 (0.37) | 1.02 (0.83) | 1.01 (0.93) |

Before, a zoom-out thinned every crown's shadow, typically to three quarters by
the hand-over box and to two thirds on a phone. Then it removed the shadow
entirely as each tree became an impostor. Now both representations keep
their shadow at every box. During diagnosis, the old crown material with its
atlas mipmaps disabled matched the impostor too (IoU 0.81–0.91, darkness
0.95–1.00 for a spruce). That showed the mip was the whole difference; the
probe was a scratch run and is not retained.

**Mesh against impostor.** The overlap (IoU) of the two half-darkness masks
and the ratio of total darkness were measured over five species at four sun
heights (62°, 27°, 9° and 5°), with identical figures on both backends:

| box / map | IoU | darkness, impostor / mesh |
|---|---:|---:|
| fine texel | 0.85–0.96 | 0.99–1.07 |
| 850 m / 2048 | 0.85–1.00 | 0.98–1.15 |
| 850 m / 1024 | 0.71–1.00 | 0.89–1.17 |
| 2200 m / 2048 | 0.63–0.94 | 0.71–1.25 |

The spread widens at coarse texels, where a crown is a few texels across.
[Spruce](graphics/tree-shadows-zoom-2026-09-24/shadow-spruce-850m.png) and
[birch](graphics/tree-shadows-zoom-2026-09-24/shadow-birch-850m.png) at the
850 m box show the mesh's shadow in red, the impostor's in green and their
overlap in yellow.

**Colour passes and crossfade.** Each run compares 25 views with `04cb52ae`:
impostors in two views and crowns in three, with the crown's own shadow left
out, for five species. Every view has zero differing pixels on WebGL2 (Hero
and Full) and on WebGPU (Hero). A crossfade half-way in or out leaves the
impostor 0.487 of its steady shadow, and the crown 0.502 (WebGL2) or 0.506
(WebGPU). Finished fades leave 1 and 0.

**Prepared startup data.** The source revision moved, so tints (26), far
vista (26), scatter (26) and water (10 courses) were re-baked through the
existing publishers. That happened first for this change alone, and again
after merging main's phone terrain change (#95), for the merged revision
`bc8d7db4`. Visby, Tortuna and Lidingö keep their measured water path with a
refreshed identity.
[`check-publication.mjs`](graphics/tree-shadows-zoom-2026-09-24/check-publication.mjs)
proves that, against main at `f3dc1d97`, every record kept its content and
only its source identity changed
([`publication-identity.json`](graphics/tree-shadows-zoom-2026-09-24/publication-identity.json)).
`check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/tree-shadows-zoom-2026-09-24/prepared-check.json)).
The first bake's water payloads were never published, so they are removed
rather than kept for older clients.

**Tests.** `shadow-fit.test.mjs` replays the old fit rule over camera paths
within 900 m and holds the larger boxes to the scaled 1150 m box. It also
keeps the before switches display-only for prepared startup.
`tree-impostor.test.mjs` checks four things:
- the projection's last row separates the renderer's cameras in both
  coordinate systems and depth conventions;
- the colour pass keeps the ray to the player's camera;
- every impostor in a 260–3000 m box faces the sun in the shadow pass;
- the billboard lies flat in the shadow map, where the old ray to the light's
  position tilted two off-centre trees by 18° and 74°.

On the tree merged with main, the full `pnpm test` passes: 1,333 Vitest tests
and 478 Node tests, with 3 environment skips. The Node suite needs the offline
COPC reader dependency for the Visby stand compiler:
`npm ci --prefix packages/course-geo/copc-reader --ignore-scripts`. The
production build, app-build isolation check, no-undef lint and
`check:course-workflow` pass.

## What this does not establish

- **Pictures of a whole course.** Full courses render black in this container,
  so no course view was captured. Judge Puttom and Veckefjärden zoomed out on
  the owner's GPU: WebGPU and WebGL2, high and low quality, against the before
  URL. Wait for terrain `loadingTiles === 0` and two frames before capturing.
- **Frame cost.** The shadow pass now draws the tier impostors in view (and
  the far vista beyond 1150 m), and the crowns read the atlas at level 0 there.
  The map still renders only when something that casts moves, so the cost falls
  on frames that pan the box, change a tier, fade or fly. Measure it with
  interleaved A/B runs against the before URL, desktop and phone separately.
- **A small look change up close.** Crown shadows no longer lose their cards at
  tee-view boxes either. At the 260 m box a crown casts on average 4 % more
  shadow on a desktop (at most 7 %) and 10.5 % more on a phone (at most 19 %);
  at the 400 m box on a desktop, 10 % more. That is the same fix reaching the
  nearest boxes, and it brings phone shadows level with desktop ones.

## Reproduce

```sh
# the proof against the build before this change; software rendering by default
node tools/check-tree-shadows.mjs --out output/tree-shadows-gl-hero --ref 04cb52ae
node tools/check-tree-shadows.mjs --out output/tree-shadows-gl-full --ref 04cb52ae --modes thin,colour --tier full
node tools/check-tree-shadows.mjs --out output/tree-shadows-gpu-hero --ref 04cb52ae --backend webgpu
# the same on the owner's adapter
BANVY_GPU=1 node tools/check-tree-shadows.mjs --out output/tree-shadows-hw --ref 04cb52ae --backend webgpu
# the prepared startup re-bake, as in docs/performance-reconstruction-2026-09-22.md
pnpm --filter @banvy/golf build && node tools/serve.mjs apps/golf/dist 8662   # keep serving
node tools/bake-water.mjs http://127.0.0.1:8662          # then rebuild
node tools/bake-ground-tints.mjs http://127.0.0.1:8662   # then rebuild
node tools/bake-vista.mjs http://127.0.0.1:8662          # then rebuild
node tools/check-prepared-startup.mjs --public apps/golf/dist
node docs/graphics/tree-shadows-zoom-2026-09-24/check-publication.mjs
```

In a container without Chrome, point `BANVY_CHROME_PATH` at a Chromium. The
tool strips the identity texture-view swizzle that three r186 sends, which an
older Chromium's WebGPU rejects; a current Chrome needs nothing.
