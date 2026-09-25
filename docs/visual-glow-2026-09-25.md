# Glow batch, 25 September

**Owner request, 25 September:** "Start with this now: Glow (14)". The plan was:
- measure what actually reaches the glow's threshold at golden hour: the sky
  around the sun, the clouds, backlit tree crowns and the warm road on the
  water;
- give each lighting preset its own threshold, lower for a low sun;
- brighten the cloud centres toward the sun.

This is item 14 of the visual audit, after [the water batch](visual-water-2026-09-25.md).

Every change keeps its before behind a URL switch. The switches keep the
prepared startup data eligible, so an A/B pair differs only in the change.
The complete before is:

`?glowthreshold=0&cloudglow=0`

- `glowthreshold=0` keeps one threshold, 0.86, for every light.
- `cloudglow=0` keeps the clouds' flat paint toward the sun.

Nothing here changes geometry, placement or prepared data: the re-bake
refreshed source identities only.

## What reached the glow

The glow is three's `BloomNode` in `main.js`:
- It keeps what passes a luminance threshold in the scene's linear colour,
  before exposure and tone mapping.
- A knee of 0.3 eases pixels in above the threshold.
- It blurs what it keeps and adds it back at the preset's strength (0.09 at
  golden hour).
- It runs at high quality only.
- One threshold, 0.86, served every light.

The isolated check measured it on the player's own materials, lit as `main.js`
lights them:
- the sky and its clouds, and the haze;
- the Nordic water and a wooded far shore;
- a Hero crown with its depth and back-light;
- the ground material with its gloss;
- the buildings' white trim, a white ball and the flag's yellow.

Golden hour, in linear luminance:

| What | Brightest 1% | Brightest pixel |
|---|---|---|
| Clear sky within 15° of the sun | 0.52 | 0.52 |
| Clouds beside the sun, or 90° away | 0.67 | 0.67 |
| The sun's road on the water | 0.45 | 0.47 |
| Crowns | 0.17 | 0.51 |
| A green's sheen, looking toward the sun | 0.91 | 1.02 |
| A white ball in the sun | 1.05 | 1.07 |

So golden hour's glow went only to the greens' sheen toward the sun and to
sunlit white. At dawn and in autumn only the sunlit white ball reached it, and
under the midnight sun nothing did.

Nothing where the light comes from glowed. Clouds beside the sun were exactly as
bright as clouds away from it, so a lower threshold alone would have made every
cloud glow.

Each light's broad paint is the brightest of three things: its clouds, its
clear sky, and the haze its horizon and far ground fade into. `glow.mjs`
reckons it from the preset's own colours:

| Light | Broad paint | Brightest part |
|---|---|---|
| Golden hour | 0.672 | clouds |
| Dawn | 0.564 | the haze, warmed toward the sun |
| Midnight sun | 0.458 | the haze, warmed toward the sun |
| Autumn | 0.837 | clouds |
| Noon | 0.919 | white clouds (over 0.86: a faint glow they always had) |
| Mist | 0.648 | clouds |
| Blue hour | 0.325 | haze |
| Storm | 0.321 | haze |

The measured pixels agree within 0.02 in every light.

## The changes

**Each low sun's own threshold** (`glow.mjs`, `bloomThreshold` in
`painted-world-palette.mjs`; `?glowthreshold=0`).

Each threshold sits just above the light's broad paint:

| Light | Threshold |
|---|---|
| Golden hour | 0.70 |
| Dawn | 0.60 |
| Midnight sun | 0.50 |
| Autumn | 0.86 (unchanged: its clouds are at 0.84) |

Noon, blue hour, storm and mist keep 0.86. None has a low sun, and the dusk
lamps were tuned to it.

**Clouds that shine toward the sun** (`painted-sky.mjs`, `skyCloudGlow`;
`?cloudglow=0`).

- **Where.** Toward the sun, the clouds' thick centres shine past their paint.
  The lobe is the square of the sky's own sun glow lobe: 44% of full at 30°
  from the sun and 15% at 45°. The clouds' soft edges keep their paint, as does
  every cloud away from the sun.
- **Colour.** The shine takes the sky's sun glow colour: amber at golden hour,
  peach at dawn and apricot under the midnight sun. A plain brightening went
  white under ACES.
- **How much.** At the sun, a shining centre reaches 60% of the way through
  the knee. The model includes each preset's cloud density: midnight's thin
  clouds are at most 54% opaque, so they shine the more.

| Light | Shine at the sun | Shining centre (luminance) |
|---|---|---|
| Golden hour | 0.5 | 0.88 |
| Dawn | 1.31 | 0.78 |
| Midnight sun | 2.16 | 0.68 |
| Autumn | 0.27 | 1.04 |

**Only where there is a glow.** The shine is there to be glowed.
- Low quality has no glow, and its clouds keep their paint. So do the clouds
  after the runtime drop, which turns the glow off on a slow GPU.
- Phones therefore see the sky they did.

## What it costs

- **The threshold** is a uniform, set per preset.
- **The shine** is a few operations per visible sky pixel. The sky is drawn
  last, so hidden sky is not shaded.
- **Nothing is added:** no draw, pass or texture. The glow's own passes ran
  before and run the same.

Nothing was timed on a GPU.

## Evidence

**Unit tests** (`apps/golf/src/engine/glow.test.mjs`):
- every preset's broad paint sits under its threshold, noon's white clouds
  excepted;
- the low-sun thresholds sit within 0.05 of it; the other lights keep 0.86;
- at the sun the shining cloud centres reach between half and all of the knee,
  in the sun glow's hue;
- the painted sky takes the shine per preset, and none with the before;
- `main.js` wiring:
  - the threshold per preset and the one pipeline;
  - both befores;
  - no shine without the glow, at low quality or after the runtime drop.

`visual-fix-switches.test.mjs` keeps both before switches display-only.

**Isolated browser check**
([`check-isolated.mjs`](graphics/glow-2026-09-25/check-isolated.mjs),
[result](graphics/glow-2026-09-25/isolated-check.json)). It runs in
SwiftShader, on WebGL2 and on WebGPU with reversed depth. The backends agree
within 0.015 in every class's median, 90th and 99th percentile.

- **The before.** The check generates main's own sky from git at `71d373e8`
  and draws it beside the player's sky with both befores. They are identical,
  value for value, in every light, toward the sun and away from it.
- **Broad paint.** With the batch, no light's broad paint passes the threshold:
  clear sky, haze, far clouds, water, wood, crowns, rough, fairway, sand or
  path. Noon's white clouds pass as they always did.
- **Clouds toward a low sun.** The shining centres cross:

  | Light (threshold) | Brightest sunward cloud | Sunward cloud passing, most in any view |
  |---|---|---|
  | Golden hour (0.70) | 0.87 | 20% |
  | Dawn (0.60) | 0.78 | 55% |
  | Midnight sun (0.50) | 0.67 | 7% |
  | Autumn (0.86) | 1.04 | 26.5% |

- **The other lights.** Noon, blue hour, storm and mist are untouched: every
  class has the same values with the batch as without.
- **Small bright paint.** With the lower thresholds these pass more:
  - sunlit white trim, a white ball and the flag's yellow: 0.79, 1.07 and 0.72
    at golden hour, and 0.76, 0.85 and 0.58 under the midnight sun;
  - a green's sheen toward the sun at golden hour: 10% of it, from 2.5%.

  They are small, and the glow is drawn at half resolution. Their halos are not
  visible in the isolated pictures.

**Pictures** go through the app's own pipeline: the bloom at the preset's
strength and threshold, then ACES with the dither at the preset's exposure.
- [The lake toward the sun](graphics/glow-2026-09-25/lakes.jpg), before and
  with the glow, in each low-sun light.
- [The glow alone](graphics/glow-2026-09-25/glow-alone.jpg), four times over,
  at golden hour and dawn. Before the batch there is none in the view.

**App boot**
([`check-boot.mjs`](graphics/glow-2026-09-25/check-boot.mjs),
[result](graphics/glow-2026-09-25/boot-check.json)). The re-baked app boots
five ways on WebGL2 in SwiftShader.
- Each boot compiles every material in the scene, the sky's included.
- No page or console error occurs in any boot, so no shader failed to compile.
- The tree tier audit passes in each.
- Where a boot steps through the lights, it uses the page's own buttons.

| Boot | What the harness reads back |
|---|---|
| Ängsö, high quality, every light (`det=1`) | Each light's own threshold and strength: golden hour 0.70 and 0.09, dawn 0.60, midnight sun 0.50, the rest 0.86. The clouds' shine in each low sun's glow colour: golden hour (0.50, 0.23, 0.06), none in the other lights. |
| Ängsö, low quality | No glow, and no shine in any light. |
| Ängsö, high quality, both befores, every light | 0.86 and no shine in every light. |
| Norrfällsviken at dawn, from the URL | 0.60, with dawn's shine. |
| Ängsö, high quality, no quality lock | Before the runtime drop's verdict: 0.70, 0.09 and golden hour's shine. After it, software rendering being slow enough: a strength of 0 and no shine. |

**Prepared startup data.** The source revision moved, so the following were
re-baked through the existing publishers for revision `6a8952e1`: tints (26),
far vista (26), scatter (26) and water (10 courses).

[`check-publication.mjs`](graphics/glow-2026-09-25/check-publication.mjs)
compares against main at `71d373e8`
([result](graphics/glow-2026-09-25/publication-identity.json)). Every tint,
vista, scatter and water record keeps its content; only its source identity
changed. `check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/glow-2026-09-25/prepared-check.json)), and the
app boot above ran on it.

**Suite.** The full `pnpm test` passes: 1,425 Vitest tests and 482 Node tests,
with 3 environment skips. The app-build isolation check,
`check:course-workflow` and the no-undef lint also pass.

## Not established

- **Pictures of full courses.** Judge these on the owner's GPU, against the
  before switches:
  - golden hour and the midnight sun with clouds near the sun;
  - dawn, where the most cloud glows: turn `skyCloudGlow` down if it reads as
    too much;
  - a green's sheen toward a low sun;
  - sunlit white buildings under the midnight sun.
- **The sky round the sun and the sun's road** stay under every threshold. To
  glow they would have to be brighter, and the measurements put that outside
  this plan.
- **Frame time.** Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/glow-2026-09-25/check-isolated.mjs
node docs/graphics/glow-2026-09-25/check-boot.mjs
node docs/graphics/glow-2026-09-25/check-publication.mjs   # after the re-bake
```
