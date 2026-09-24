# Visual fixes, 24 September

**Owner request, 24 September:** after the visual audit, "start with the bug
fixes and merge to main".

The audit read the renderer's code against its own comments and design notes.
This batch fixes the places where the code did not do what it says it does.
Every fix keeps its before behind a URL switch. The switches keep the prepared
startup data eligible, so an A/B pair differs only in the fix:

`?detailupload=canvas&mowfade=iso&localheight=0&coverglow=always&pondfetch=lake&waternormal=legacy&dither=0&bloomknee=hard&skyhaze=raw&skyorder=first&furnitureshadow=0`

That is the complete before. Nothing here changes geometry, placement, water
levels, shorelines or the content of any prepared data.

## The fixes

**1. The ground's detail texture arrives intact** (`main.js`,
`?detailupload=canvas`). The packed 512² detail map carries a glint mask in its
alpha channel. It went up through a 2D canvas, whose premultiplied alpha wipes
the colour of every texel whose alpha is 0: 35.2% of them. Each colour
channel's mean fell from about 0.5 to 0.32, so every read of it was
salt-and-pepper noise:
- the painted blotches, rough clumps and the mowing's wander;
- the road grain, the tufts' and bushes' tint, and the facilities' detail;
- the water's foam.

Turf came out about 5% darker on average than written; the fix brightens it by
5.4%.
[The relief pilot](v2-ground-material-relief.md) found this and fixed it behind
its own switch; the fix is now the default. Expect cleaner, slightly brighter
turf, smooth broad variation instead of speckle, and stronger mowing.

**2. Mowing stripes stay down the fairway** (`ground-material-core.mjs`,
`?mowfade=iso`). A stripe fades when the pixel outgrows it. That pixel was
measured by its whole footprint, which from a tee is its depth down the
fairway: tens of metres. So the stripes faded out 30–80 m from the tee, while a
pixel still spanned centimetres across them. A pass's coordinate is a distance
along a known bearing, so the pixel is now measured across the passes: the two
screen steps of the world position, projected on that bearing.

In `mow-fade.test.mjs`, with the app's tee camera, fairway stripes 60, 120 and
250 m out are fully shown on a phone-shaped view and at 1080p; before, they
were gone at all three distances. Stripes that change down the view (seen
across the hole) still fade as before, so the fix adds no moiré. The collar's
laps have no single bearing and keep the old measure. The practice range's
wobble now reads the texture's low channel, as its comment says; it read the
blade speckle and jittered.

**3. Heights up a tree, reed, clump or stump** (`main.js`, `?localheight=0`).
three applies the instance matrix before a material's `positionNode`, and a
fragment reads that final `positionLocal`, as
[the performance plan](performance-plan-2026-09-23.md) confirmed in the
generated GLSL. In these instanced materials `positionLocal.y` was therefore
the height above the course's datum, and the effects were:
- on ground 13 m up, every vertex of a tree swayed at full weight, roots
  included, and crowns slid against their trunks instead of bending;
- a stump above 0.37 m was drawn all cut face;
- a clump was all tip, and a reed all head.

The template's own height (`positionGeometry`) is what the sway and the
gradients were written for.

**4. Ground cover glows only with a sun** (`main.js`, `?coverglow=always`).
Tufts, clumps and reeds brighten when seen against the sun, and they did so at
full strength with no sun at all: blue hour, mist and storm. The glow now
follows the sun's strength through a smoothstep. It is unchanged in the five
presets with a sun (dawn's is 0.66 of the strongest) and zero in the other
three.

**5. Field ponds drawn as ponds** (`water-fetch.mjs`, `?pondfetch=lake`). A
lake's chop, its 30 m run from shallows to deep and its wash need fetch. The
shader's own notes say a pond has none, and that drawing chop and foam on
ponds made them look like "holes cut in an ice sheet". But the packs flag some
ponds as lakes:

| course | lake-flagged | now ponds | largest now a pond |
|---|---:|---:|---:|
| Tortuna | 56 | 56 | 7,141 m² |
| Visby | 40 | 27 | 12,583 m² |
| Lidingö | 4 | 3 | 2,237 m² |
| every other course | 13 | 0 | — |

A flagged lake keeps its treatment only when it is wide enough: 2A/P of at
least 30 m, which is a round pond's radius or about half a stream's width. A
narrower one is drawn as a pond and meshed at the pond's 9 m, so its shore
distance leaves zero. Unflagged water and the surroundings are unchanged, and
so is every other use of the flag.

**6. The ripple map closes across its repeat** (`water-normal-texture.mjs`,
`?waternormal=legacy`). The water samples one 512² normal map at four periods.
Its noise lattice closed nowhere, so every repeat drew a straight seam. Each
octave now has a whole number of cells across the texture in both axes, and
the differences wrap:

| mean step between neighbouring pixels | before | now |
|---|---:|---:|
| inside the map | 12.35 | 12.33 |
| across the repeat, horizontally | 49.3 | 13.6 |
| across the repeat, vertically (row steps inside: 17.3 before, 17.6 now) | 48.9 | 17.8 |

The ripples keep their grain and tilt: the channels' deviations are 21.6 and
25.9 against 21.7 and 25.8. The map also builds in 82 ms instead of 186 ms. The
before switch reproduces the old map byte for byte.

**7. Dither before the 8-bit output** (`output-dither.mjs`, `?dither=0`). The
painted sky, the haze and the water banded on every 8-bit canvas, worst in blue
hour, where the sky sits in ACES's dark toe. The output is now ACES plus a
fixed interleaved-gradient dither, added where the sRGB encode quantizes. That
moves every brightness by 0.44–0.71 of a step, never a whole one. It is the
renderer's tone mapping, so the high-quality pipeline's final quad and the
low-quality renderer's own output both use it: phones and desktops dither
alike. The pattern is fixed to the pixel grid, so `det=1` captures stay
identical frame to frame.

**8. Glow with a knee** (`main.js`, `?bloomknee=hard`). The bloom's threshold
had a 0.01 knee, so a sunlit flag or trim crossing it turned its whole halo on
in one frame. It now grows from 0.86 to 1.16. The aviation lamps were meant to
bloom at dusk, but at luminance 0.82 they were under the threshold before any
haze; they are now twice as bright. Only high quality has bloom.

**9. The horizon meets the ground in one haze** (`atmospheric-sky.mjs`,
`?skyhaze=raw`). The sky's band under the horizon took the preset's fog colour
before `setPreset` tinted the fog toward the painted fog. So the band and the
hazed ground were a few levels apart at every horizon in golden, dawn,
midnight, mist and autumn. The band now takes the fog's final colour.
`V3D.atmosphere()` reports both.

**10. The sky is drawn last of the opaque world** (`atmospheric-sky.mjs`,
`?skyorder=first`). The painted sky shades four noise octaves per pixel, and it
was drawn first. That meant every pixel of the screen was shaded and the world
then painted over most of them. It now draws at order 0.5: after the world (0),
before the overlays (1 and up). It writes no depth and sits at the far plane,
so the depth test rejects it wherever anything stands. This is the batch's one
GPU saving. It was not measured on a GPU.

`sky-draw-order.test.mjs` holds every render order in `main.js` to 0 or ≥ 1.

**11. Small furniture takes the trees' shade** (`main.js`,
`?furnitureshadow=0`). Flagsticks, markers, plates and posts stood fully
sunlit inside a tree's shadow while the flag cloth on them darkened. They now
receive shadows. The normal bias (0.22 m and up) is wider than any of them, so
none shades itself.

## Found in the audit, not changed here

- **Radial fog.** Fog grows with view depth, so screen edges are less hazy
  than the centre. The fog deliberately keeps three's depth accessor for thick
  lines and instanced materials, so a change needs its own check.
- **The far square edges**: the land cover ending about 6.4 km out, and the
  terrain ring's edge. They show only from far out, need tuning, and change the
  tint bake.
- **Water reflecting the painted sky and the sun.** This is an appearance
  change, and belongs with the lighting batch.
- **Water-to-water joins** (Veckefjärden). The shoreline builder has to learn
  shared edges.
- **The terrain's seven detail reads down to three.** This changes the
  patterns and needs tuning by eye.
- **Cut edges anti-aliased by direction.** An edge's direction is not known
  without differentiating a texture field that jumps at texel borders.
- **The fallback surface path's missing cut tone.** This has no effect: only
  exact-edge atlases use it.

## Evidence

**Unit tests** (`apps/golf/src/engine`):
- `mow-fade.test.mjs`: the tee-camera stripes, and the knob;
- `water-fetch.test.mjs`: fetch, the pond sizes and the before's mesh steps;
- `water-normal-texture.test.mjs`: the before byte for byte, the seam and the
  statistics;
- `output-dither.test.mjs`: half a step, centred, installed as the tone mapping;
- `sky-draw-order.test.mjs`: the sky's slot, the render orders in `main.js`
  and the horizon haze;
- `visual-fix-switches.test.mjs`: every before switch keeps all four prepared
  startup paths.

**Isolated browser check**
([`check-isolated.mjs`](graphics/visual-fixes-2026-09-24/check-isolated.mjs),
[result](graphics/visual-fixes-2026-09-24/isolated-check.json)). The page uses
the app's own sky and output modules to draw the golden painted sky and a hill
over the lower frame, in SwiftShader:
- **WebGL2.** Drawn last, the sky gives the same picture pixel for pixel, in a
  4× multisampled target and on the canvas, with and without the dither. The
  dither moves 61% of the pixels by one level and none by more.
- **WebGPU, with reversed depth.** The same identity holds in the target. Its
  canvas presents nothing in this container, so there the dithered output is
  judged on compiling without an error, which it does.
- **Both backends.** The page also compiles and draws the changed shaders:
  - The striped ground material draws with either stripe fade.
  - An instanced stump is coloured by its own height. With the template's
    height, a stump 50 m up looks exactly like one at 0 m, with 8% of it the
    pale cut face. With the instanced `positionLocal` the materials read
    before, the stump 50 m up is 98.5% cut face.

The full app could not be booted on WebGPU here. In software rendering it
never finished loading within six minutes, with these fixes or without them
(main's own build at `22ac51f1`), while WebGL2 boots in two to three. So on
WebGPU the fixes stand on the isolated page, and on the owner's GPU.

**App boot**
([`check-boot.mjs`](graphics/visual-fixes-2026-09-24/check-boot.mjs),
[result](graphics/visual-fixes-2026-09-24/boot-check.json)). The built app
boots at Ängsö's first tee at golden hour on WebGL2 in SwiftShader, at high and
low quality, with no page or console error: no shader failed to compile. What
the harness reads back:

| | high quality | low quality | every before switch |
|---|---|---|---|
| tone mapping | ACES + dither | ACES + dither | ACES |
| sky's render order | 0.5 | 0.5 | −2 |
| bloom knee | 0.3 | no bloom | 0.01 |
| furniture receiving shadows | 6 of 6 batches | 6 of 6 | 0 of 6 |
| horizon band = fog colour | yes | yes | no |
| tree tier audit | passes | passes | passes |

**Prepared startup data.** The source revision moved, so tints (26), far vista
(26), scatter (26) and water (10 courses) were re-baked through the existing
publishers for revision `bcae6cd3`. Against main at `22ac51f1`,
[`check-publication.mjs`](graphics/visual-fixes-2026-09-24/check-publication.mjs)
proves that every record kept its content and only its source identity changed
([`publication-identity.json`](graphics/visual-fixes-2026-09-24/publication-identity.json)).
`check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/visual-fixes-2026-09-24/prepared-check.json)).

**Suite.** The full `pnpm test` passes: 1,363 Vitest tests and 482 Node tests,
with 3 environment skips. The app-build isolation check, `check:course-workflow`
and the no-undef lint also pass.

## Not established

- **Pictures.** Judge these on the owner's GPU and phone, against the before
  switches:
  - the ground's brighter, cleaner turf and its stripes from the tee;
  - Tortuna's, Visby's and Lidingö's ponds;
  - trees bending in the wind;
  - the horizon;
  - blue hour's sky, for banding.
- **Frame time.** None of the fixes adds a texture read or a pass. Drawing the
  sky last saves shading. Furniture shadows add a shadow lookup on a few
  pixels, and the 86 re-meshed ponds add vertices on small bodies. Nothing was
  timed on a GPU.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/visual-fixes-2026-09-24/check-isolated.mjs
node docs/graphics/visual-fixes-2026-09-24/check-boot.mjs
node docs/graphics/visual-fixes-2026-09-24/check-publication.mjs   # after the re-bake
```
