# Tree shadows when zooming out

**Owner request, 24 September:** "I do not want the shadows from the trees etc
to disappear when zooming the camera out on a golf course."

Three things took them away, each measured before it was changed. All three
changes have a before switch, and the switches keep the prepared startup data
eligible, so an A/B pair differs only in its shadows:
`?impostorshadow=0&foliageshadow=mip&shadowreach=0` is the complete before.
A second report the same day, shadows vanishing as the camera turns, is
covered in [Turning the camera](#turning-the-camera).

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

## Turning the camera

**Owner report, 24 September**, from a phone on Ängsö's driving range: "When
i just change the camera slightly to the side the shadows just pops away".

**Cause.** The tree tiers draw a 128 m cell only while its box meets the
camera's frustum (`updateTreeTiers`), and the shadow pass draws the same
batches. So a tree out of view cast nothing. With a low sun, a tree just past
the edge of the frame, or behind the camera, throws its shadow a hundred metres
or more across the view. A turn of a few degrees took its whole cell out of the
frustum, and every shadow that cell cast vanished in the same frame.

**Change** (`main.js`). A cell out of view now keeps its trees when their
shadows can reach the view (`castsIntoView`). Two conditions decide:

- The cell's box stands inside the shadow map's square in the light's plane. A
  caster outside the square draws nothing into the map.
- The box, swept away from the sun as far as a shadow of it can fall, meets
  the camera's frustum. The sweep runs to 30 m below the cell's lowest point,
  and no further than three times the box's half-size. The swept volume is
  bounded by one axis-aligned box. So the test can keep a cell whose shadow
  misses the view, but it keeps every cell whose shadow reaches the view over
  ground no more than 30 m below the cell.

Such a cell's trees are drawn as impostors. An impostor casts the tree's
silhouette as the sun sees it, which agrees with the mesh's shadow (the IoU
table above). The change is instant, with no crossfade, because nothing of the
tree is on screen but its shadow. When the cell comes back into view, its trees
are judged as any tree entering the view and take their own tier at once. Those
still wanted as impostors stay where they are, so a cell of impostors costs
nothing to bring back. `placeSun` records the box and the sun for the next
frame's tier update, so a moving sun is followed one frame late.
`V3D.treeTiers().shadowCells` counts the kept cells.
`?offscreenshadow=0` is the before. `?impostorshadow=0` also turns this off,
since the kept trees would cast nothing, so the complete before URL above still
holds.

**Evidence.** `tree-shadow-casters.test.mjs` replays the app's own tier update
on a row of cells in both coordinate systems, with the camera looking along the
row's normal and a low sun from one side. The cells in view keep their tier.
The cell just past the frame's edge on the sun's side is kept as impostors, and
only that one: the next cell out throws a shadow that ends short of the view,
and the cells on the other side throw theirs away from it. Turning into view and
back, including halfway through a crossfade, moves every tree at once, with a
clean tier audit and no stale fade left behind. A cell of impostors comes back
into view without moving a tree: the same turn takes exactly its 20 moves fewer
than one where the cell enters from nothing. Without the sun's record the old
behaviour is unchanged, and a cell outside the map's square is not kept.

In the built app,
[`check-turning.mjs`](graphics/tree-shadows-offscreen-2026-09-24/check-turning.mjs)
turns the camera in place at the first tee, under the golden-hour sun
(`ljus=kvall`), and records the tier counts with and without the change
([`turning-counts.json`](graphics/tree-shadows-offscreen-2026-09-24/turning-counts.json)).
It ran in SwiftShader on WebGL2, where the shadow box was 400 m in every view.
The difference between the two impostor columns is what the change adds, all
of it out of view:

Ängsö, phone-shaped view (412 × 915 portrait, low quality), the owner's case:

| turn | cells in view | cells kept out of view | impostors before | impostors now |
|---:|---:|---:|---:|---:|
| 0° | 35 | 34 | 1,067 | 3,250 |
| +6° | 38 | 28 | 1,340 | 3,344 |
| +12° | 43 | 27 | 2,026 | 3,946 |
| +24° | 54 | 28 | 3,205 | 4,714 |
| −6° | 32 | 27 | 881 | 2,427 |
| −12° | 30 | 22 | 770 | 1,820 |
| −24° | 29 | 28 | 1,366 | 2,659 |

Ängsö, desktop-shaped view (960 × 600, high quality):

| turn | cells in view | cells kept out of view | impostors before | impostors now |
|---:|---:|---:|---:|---:|
| 0° | 98 | 12 | 9,186 | 10,181 |
| +6° | 97 | 15 | 8,753 | 10,160 |
| +12° | 105 | 9 | 9,449 | 10,567 |
| +24° | 116 | 6 | 10,969 | 11,566 |
| −6° | 97 | 19 | 9,305 | 11,199 |
| −12° | 98 | 21 | 9,380 | 12,032 |
| −24° | 100 | 32 | 8,574 | 11,920 |

Puttom, desktop-shaped view (960 × 600, high quality):

| turn | cells in view | cells kept out of view | impostors before | impostors now |
|---:|---:|---:|---:|---:|
| 0° | 174 | 38 | 34,023 | 42,164 |
| +6° | 168 | 42 | 32,240 | 40,682 |
| +12° | 155 | 45 | 29,618 | 37,927 |
| +24° | 145 | 53 | 26,279 | 35,434 |
| −6° | 178 | 36 | 34,399 | 42,115 |
| −12° | 185 | 30 | 36,052 | 42,793 |
| −24° | 188 | 31 | 36,227 | 43,454 |

At every turn both variants draw the same cells and the same Hero trees in
view, and every tier audit passes. The change only adds impostors, all of them
out of view. The narrow portrait view shows the problem most: it sees 29–54
cells, and 22–34 more cells out of view cast shadows into it. A turn of a few
degrees moves cells across its edges on both sides. There the change keeps
1,050–2,183 impostors, beside 770–3,205 drawn before. On the desktop-shaped
view it adds 5–39 % to the impostors at Ängsö and 19–35 % at Puttom.

**Cost.** The kept trees are off screen, so the colour pass runs only their
vertex shader, four vertices each, before clipping them. The shadow pass draws
them whenever the map renders, which is on demand: while the camera or sun
moves, a tier changes or a fade runs. The test itself is two dot products per
out-of-view cell, plus a frustum test for the cells inside the map's square.

On the CPU,
[`check-cpu.mjs`](graphics/tree-shadows-offscreen-2026-09-24/check-cpu.mjs)
replays the tier update on the real placements of Puttom and Ängsö. It runs
the update with the sun's record, as `placeSun` sets it at golden hour, and
without it, in six interleaved rounds of 360 frames per camera path on this
container's CPU
([`cpu-replay.json`](graphics/tree-shadows-offscreen-2026-09-24/cpu-replay.json)).
Without the record, the update matches main's before the change exactly, frame
by frame, on every path:

| course, quality | path | median ms, before → now | mean ms, before → now | tree moves |
|---|---|---:|---:|---:|
| Puttom, high | at rest | 0.38 → 0.40 | 0.58 → 0.57 | +28 % |
| Puttom, high | orbit | 1.37 → 1.43 | 1.92 → 2.06 | +2 % |
| Puttom, high | fly-through | 0.75 → 1.18 | 2.49 → 3.20 | +14 % |
| Puttom, low | at rest | 0.30 → 0.30 | 0.44 → 0.48 | +27 % |
| Puttom, low | orbit | 1.23 → 1.13 | 1.64 → 1.72 | +3 % |
| Puttom, low | fly-through | 0.68 → 1.07 | 2.02 → 2.60 | +14 % |
| Ängsö, low | at rest | 0.10 → 0.12 | 0.18 → 0.26 | +32 % |
| Ängsö, low | orbit | 0.50 → 0.57 | 0.85 → 0.95 | +4 % |
| Ängsö, low | fly-through | 0.32 → 0.80 | 1.22 → 1.58 | +23 % |

At rest, the extra moves are the kept cells filling on the first frame, and
the median frame is unchanged within the timer's 0.1 ms resolution. The orbit
circles the course 800 m out, 1° and 14 m a frame, and adds 2–4 % to the
moves. Bringing a cell of impostors back into view moves nothing. Before that
refinement, the same orbit added 57 % at Puttom (a scratch run of this replay,
not retained). The fly-through walks every
hole's centre line in 360 frames, tens of metres a frame with a cut between
holes, so cells cross the view's edges all the time. There the median update
rises by 0.4–0.5 ms. A cell leaving the view beside the camera turns its Hero
trees into impostors, where before it dropped them. Keeping them as Hero meshes
off screen would cost far more on the GPU. These are CPU figures for one
function, not a frame rate. The frame cost on a GPU, and on the owner's phone
in particular, was not measured here. Compare it with interleaved A/B runs
against `?offscreenshadow=0`.

**Prepared startup data.** The source revision moved, so tints (26), far vista
(26), scatter (26) and water (10 courses) were re-baked through the existing
publishers for revision `ce6bfa20`. Against main at `aa8fea3d`,
[`check-publication.mjs`](graphics/tree-shadows-offscreen-2026-09-24/check-publication.mjs)
proves that every record kept its content and only its source identity changed
([`publication-identity.json`](graphics/tree-shadows-offscreen-2026-09-24/publication-identity.json)).
`check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/tree-shadows-offscreen-2026-09-24/prepared-check.json)).
The published water payloads stay beside the new ones.

**Not established.** No picture: full courses render black in this container.
Judge Ängsö's driving range on the phone, turning the camera a little each way
at golden hour, against `?offscreenshadow=0`. A shadow reaching the view from a
cell beyond the shadow map's square still ends at the map's edge, as it did
before. That edge is where the boundary fade already removes shadows.

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
# turning the camera at a tee, with and without the out-of-view casters (after a build)
node docs/graphics/tree-shadows-offscreen-2026-09-24/check-turning.mjs
# the tier update's CPU cost on real placements, and its parity with main without the sun's record
node docs/graphics/tree-shadows-offscreen-2026-09-24/check-cpu.mjs
# the turning change's re-bake, against main before it
node docs/graphics/tree-shadows-offscreen-2026-09-24/check-publication.mjs
```

In a container without Chrome, point `BANVY_CHROME_PATH` at a Chromium. The
tool strips the identity texture-view swizzle that three r186 sends, which an
older Chromium's WebGPU rejects; a current Chrome needs nothing.
