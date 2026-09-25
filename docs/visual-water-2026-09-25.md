# Water batch, 25 September

**Owner request, 25 September:** "Yes, start with the Nordic lake water!" This
is item 9 of the visual audit, after [the air batch](visual-air-2026-09-25.md).
It also finishes item 12: the water's ripples were the last thing off the one
wind.

Every change keeps its before behind a URL switch. The switches keep the
prepared startup data eligible, so an A/B pair differs only in the change.
The complete before is:

`?nordicwater=0&waterwind=0`

- `nordicwater=0` restores the lakes' light: the road, the sky's glow and the
  far shore.
- `waterwind=0` restores the ripples' own clock.

Nothing here changes geometry, placement or prepared data: the re-bake
refreshed source identities only.

The water's colour and opacity moved from `main.js` into
`engine/water-shading.mjs`, so an isolated page can draw the player's own water.
With both before switches it is main's water pixel for pixel (below). The
sheet's render passes, depth and masks stay in `main.js`.

## The changes

**The sun's road** (`nordic-water.mjs`, `?nordicwater=0`).

The water's sparkle was one dab of warm white wherever a ripple faced the sun,
sharp at every distance.

Now, past a few hundred metres, the dabs give way to their own expectation:
the share of a pixel's ripples tilted to throw the sun to the eye.
- It is reckoned from the ripple map's own spread of slopes (0.085 and 0.10
  per axis, measured). The form is a plateau that thins as the water roughens,
  between edges that widen with it.
- It was fitted to a Monte Carlo of the dabs over the ripple map itself: 15
  roughness levels, from glassy to a gale, at tilts to 22°. It agrees within
  0.05.
- So the road keeps its width and brightness all the way to the horizon, and
  widens with the chop.
- The dabs and the road take the sun's own colour. At golden hour that is a
  warm road; at noon, nearly white.

Measured on a lake at golden hour, main's dabs, in their own colour, run from
1.0 to 1.26 times what the ripples' spread allows as distance grows. That
drift is the mipmaps flattening the ripples into a narrower, brighter,
flickering streak.

**The sky's glow in the water** (`?nordicwater=0`). The reflection takes the
sky's own sun glow, the painted sky's lobe (`painted-sky.mjs`), in its colour and
strength. The water toward a low sun now agrees with the sky above it, as the
haze already does.

**The far shore in the water** (`?nordicwater=0`).

Just above the reflected horizon, the far shore's wood stands dark in the
reflection:
- up to 2° high (a 20 m wood 570 m off);
- its top broken along the horizon by whole numbers of waves, so it closes
  behind the eye;
- in the spruce's darkest pigment, in the crowns' shaded light, through the
  haze of 600 m of the preset's air.

A lake takes it in full and a pond half. The open sea has none.

It is read off a calmer surface than the sky's reflection: a quarter of the
chop near, none by 1.2 km. With the full chop, each pixel's reflection was
thrown in and out of so thin a band, and the shore broke into dark specks.

**The water on the one wind** (`?waterwind=0`).

- **Drift.** The four ripple layers and the foam drift downwind with the air
  (`one-wind.mjs`), each at its own share of the wind's speed and with a little
  cross drift, so they still never line up. Their offsets are carried in each
  texture's own units and wrapped there.
- **Chop.** The chop follows the wind: 0.45 of the drawn chop in calm air, all
  of it at 4 m/s, and up to 1.6 times in a gale.
- **Patches.** Calm and gusty patches, the cloud pattern at 1.2 km a tile,
  cross a lake with the air.
  - A calm patch keeps half the chop and mirrors the shore and sky. A gusty one
    takes a third more and breaks into sparkle.
  - They are drawn over their own mean, so a lake's mean chop is the wind's.
  - They fade to that mean 0.6–1.5 km off, where they would shimmer.
- **Still.** Reduced motion and `det=1` hold the water still. Main's water
  scrolled under both.

## What it costs

Everything is per water pixel, and nothing is added elsewhere:
- one byte-texture read (the patches);
- an arctangent, three sines and a reflection (the shore);
- a handful of operations for the road and the glow.

No draw, pass or texture upload is added; the patch pattern is the cloud
shadows' own texture. Nothing was timed on a GPU.

## Evidence

**Unit tests** (`apps/golf/src/engine/nordic-water.test.mjs`):
- the ripple map's spread of slopes, measured;
- the road against a Monte Carlo of the dabs over the map itself, from a
  pond's glass to a gale, within 0.06;
- the road widens and dims as the water roughens;
- the shore colour is dark, green and hazier in thicker air;
- the sun's colour is taken at full brightness, and the sky's own glow
  (`?sunglow=0` reaches the water);
- the chop follows the wind;
- the drift is downwind at each layer's rate, the patches move at the air's
  speed, and the water holds still for reduced motion and `det=1`;
- the patches keep the mean chop, with calm and gusty ones to see;
- the wiring in `main.js` and `water-shading.mjs`.

`visual-fix-switches.test.mjs` keeps both before switches display-only.

**Isolated browser check**
([`check-isolated.mjs`](graphics/water-2026-09-25/check-isolated.mjs),
[result](graphics/water-2026-09-25/isolated-check.json),
[pictures](graphics/water-2026-09-25/lakes.jpg)). It runs in SwiftShader, on
WebGL2 and on WebGPU with reversed depth, and the two agree.

- **The before.** The check generates main's own water shading from git at
  `6158f6b1` and draws it beside the player's shading with both before
  switches, at a pinned clock. They are identical in every value for a lake, a
  pond and the sea, at golden hour and at noon.
- **The road.**
  - The shader's expected glitter is the module's form to 0.0001.
  - On a lake at golden hour, seen from 3 m, the road beyond 450 m is that
    expectation to 0.01%.
  - Through the change from dabs, the road stays within a quarter of it: 1.02
    at 37 m, at most 1.24 at 95 m, 1.04 at 405 m. It has no hole.
- **The shore.**
  - The reflected wood stands where the shader says round the whole horizon
    (0.0002).
  - It darkens a lake's water nothing at 1.1–1.5 km and to 0.70 beyond 2 km.
  - It leaves the open sea bit for bit as it was.
- **The wind.**
  - The patches' chop is the pattern's over its mean, exactly. It is carried by
    its offset and is flat at 2 km.
  - Offsets for a 4 m east, 3 m north shift on every layer move the water's
    whole picture by exactly that.

**Tree shadow proof:** not rerun. The batch touches no tree code and no shadow
map. Its one shared change is the cloud shadows' pattern: one copy now serves
the clouds and the water's patches, with the same bytes and the same upload.
`cloud-shadow.test.mjs` checks this.

**App boot**
([`check-boot.mjs`](graphics/water-2026-09-25/check-boot.mjs),
[result](graphics/water-2026-09-25/boot-check.json)). The re-baked app boots
seven ways on WebGL2 in SwiftShader, at the first tee of Ängsö and of
Norrfällsviken.
- Each boot compiles every material in the scene, including every water sheet,
  in view or not.
- No page or console error occurs in any boot, so no water shader failed to
  compile.
- The tree tier audit passes in each.

No live weather reached the container, so the wind is the flags' default:
4 m/s from the west.

| Boot | What the harness reads back |
|---|---|
| Ängsö at golden hour, high and low quality (`det=1`) | 15 water sheets. The sun on the water is warm (1, 0.60, 0.26), the sky's glow (1, 0.47, 0.11), and the far shore dark (0.090, 0.091, 0.065). The chop is the wind's, 1 at 4 m/s, and nothing has drifted. |
| Ängsö at golden hour, both befores | The batch's state reads as off, and the sheets compile without it. |
| Noon, `?vind=270,12` (`det=1`) | The chop is at its cap, 1.6. The sun is nearly white (1, 0.87, 0.68). The noon sky has no sun glow, so neither has the water. |
| Noon, running | Over twelve frames the patches moved 4.80 m east with the gusts. The first ripple layer moved 0.039 of its texture downwind, which is 4.8 m × its 0.07 share × its 0.115 scale. It also moved 0.017 across. |
| Noon, running, reduced motion | Nothing moved. |
| Norrfällsviken at golden hour (`det=1`) | Its 11 sheets on the coast, in the same golden colours. |

**Prepared startup data.** The source revision moved, so the following were
re-baked through the existing publishers for revision `93430940`: tints (26),
far vista (26), scatter (26) and water (10 courses).

[`check-publication.mjs`](graphics/water-2026-09-25/check-publication.mjs)
compares against main at `6158f6b1`
([result](graphics/water-2026-09-25/publication-identity.json)). Every tint,
vista, scatter and water record keeps its content; only its source identity
changed. `check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/water-2026-09-25/prepared-check.json)), and the
app boot above ran on it.

**Suite.** The full `pnpm test` passes: 1,420 Vitest tests and 482 Node tests,
with 3 environment skips. The app-build isolation check,
`check:course-workflow` and the no-undef lint also pass.

## Not established

- **Pictures of full courses.** Judge these on the owner's GPU and phone,
  against the before switches:
  - the road across Lidingö's and Veckefjärden's water at golden hour and
    under the midnight sun;
  - the far shore in a pond on the course;
  - patches on Norrfällsviken's bay in a strong wind (`?vind=270,10`).
- **The far shore is the same on every lake.** It is one painted band, not
  what actually stands across each lake: fields, houses or a low shore take the
  same wood. Judge it where the far side is open.
- **Frame time.** Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/water-2026-09-25/check-isolated.mjs
node docs/graphics/water-2026-09-25/check-boot.mjs
node docs/graphics/water-2026-09-25/check-publication.mjs   # after the re-bake
```
