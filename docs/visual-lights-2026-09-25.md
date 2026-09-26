# The nine lights, audited, 25 September

**Owner request, 25 September.** After the summer day was added, the owner
asked:

> "If we audit all current ljus modes, how is the atmosphere, look, colors,
> climate, feeling etc? Anything we should change to get a better visual
> experience?"

The audit rendered all nine lights in one isolated scene and proposed six
changes. The owner answered:

> "Merge Sommar to main, then start with 1, 2, 3, 4 and 6."

This follows [the summer day](visual-summer-2026-09-25.md).

The whole batch keeps its before behind one URL switch, `?lights=before`: each
audited light exactly as main has it. The switch keeps the prepared startup data
eligible, so an A/B pair differs only in the lights. Nothing here changes
geometry, placement or prepared data: the re-bake refreshed source identities
only.

## What the audit found

One isolated scene -- the player's own sky, sun and sky-lit shadows, haze,
ground finish, the approved trees' impostors, a lake in the player's water
shading -- in each light, from the tee, over the woods toward the sun and away
from it, across the lake and straight down (Ovan). Every value is measured on
the picture as displayed (sRGB, 0-255).

| Light | What worked | What was off |
|---|---|---|
| Kväll (the default) | Honey sky, long shadows, the golden road of sunlight on the water | The land was too dark: from above the darkest of all nine (68), darker than Blå timmen (77); the shaded fairway a deep forest green |
| Dag | Crisp summer day, white clouds and their shadows | The sun at 61.7°, higher than it ever stands in Sweden |
| Gryning | Pastel pink sky, morning haze | Daytime-green land under a rose sky; lilac between the clouds |
| Midnattssol | Apricot sky, pink water, long shadows and sun rays | The land barely took the gold |
| Blå timmen | Deep blue sky, lavender horizon | Inverted: the sky darker than the land (49 against 77 from the tee), the grass a saturated green -- a lit lawn under a night sky |
| Oväder | Slate sky, dim light | A leopard-spot pattern for an overcast; the most saturated ground of all nine (0.69) |
| Sommar, Dis, Höst | -- | Left alone |

## The changes

**Blå timmen: the sky is the light.**
- The painted sky's exposure goes from 0.20 to 0.55, over a cobalt zenith
  (`#1d4aa6`) and a periwinkle horizon (`#9aa2cf`). Before, the sky read
  purple-grey.
- The land darkens and cools:
  - the sky's fill falls from 1.85 to 1.20, in a bluer colour (`#8fa8e0`);
  - the exposure goes from 1.14 to 1.00;
  - the crowns' strength drops from 0.64 to 0.45, and their shade takes the blue;
  - a slate glaze (`#8098b8`) at 0.45.
- From the tee the sky is now nearly twice as bright as its land (99 against
  53). Before it was two thirds as bright (49 against 77). The land's
  saturation drops from 0.59 to 0.47.

**Kväll: a sun that lights the ground it falls on.**
- The sun rises from 9.4° to 12.5°. Shadows stay long: a 20 m tree still
  throws 90 m.
- The sky's fill in shade goes from 1.40 to 1.80, bluer (`#8fb0e0`). The
  environment's strength goes from 0.48 to 0.55, and the shade's sky-lit share
  from 0.10 to 0.14.
- The shaded fairway from the tee goes from 61 to 78, and the course from
  above from 68 to 77.
- The sky, its glow and the road on the water are as they were.
- **Tried and dropped:**
  - More sky-lit share alone did nothing: a 9° sun lights flat ground at only
    16% of its strength.
  - More fill alone lightened the scene but flattened the warm light against
    the shade.

**Oväder: a heavy front, a wet course, a gale.**
- The deck:
  - its forms are 2.6 times larger (cloud scale 0.00026 to 0.0001);
  - its lit and shaded paint are closer (`#8597a4` and `#6c7f90`);
  - its exposure goes from 0.46 to 0.42.

  The spread of the sky's brightness halves toward the sun and falls to a
  third overhead from the tee: one low deck, no spots.
- The ground reads wet: a grey glaze (`#b8c0c4`) at 0.35 and more sheen (0.36
  to 0.60). Its saturation falls from 0.69 to 0.42.
- **The wind.** The storm blows its gale into the visible air: the trees, reeds,
  clouds and their shadows, the water and the flags (`one-wind.mjs`
  `lightWind`).
  - It blows at least 12 m/s, gusting to 18, from wherever the wind blew,
    whenever the live wind or the 4 m/s default is weaker.
  - A wind asked for with `?vind=` is kept.
  - The Kikaren reads the live weather itself, so its wind and its advice are
    untouched: the storm is a mood, not a change to play.

**Gryning: pearl and rose.**
- **The lilac in the sky.** The audit took it for the clouds' shading. It is
  the clear sky between the clouds: the blue zenith mixed with the pink
  horizon. Changing the clouds' shade colour left it as it was. A pale
  pearl-blue zenith (`#8aa6c8`, from `#527dbd`) turns it pearl grey-lavender.
- **The land takes the rose.**
  - The crowns take the rose sun: only 0.20 of it whitened away, against the
    default 0.70.
  - Their direct light goes from 0.57 to 0.70.
  - A rose glaze (`#e8b8a8`) at 0.22: at 0.15 it barely showed, and at 0.25
    it greyed the land too much.
- The land from the tee goes from `[73,114,61]` to a pastel `[88,111,68]`, its
  saturation from 0.47 to 0.39.

**Midnattssol: the land in the gold.**
- The crowns take the low sun's gold (0.25 whitened away). Their direct light
  goes from 0.70 to 0.80.
- A gold glaze (`#f0c890`) at 0.15. At 0.25 the land turned olive.

**Dag: a Swedish sun.**
- The sun comes down from 61.7° to 55°, as a midsummer sun stands at noon over
  Visby or Skåne. Shadows grow slightly, and the course from above keeps its
  brightness to within 4% (106 to 102).
- **The clouds' bloom.** Dag's white clouds (0.92) are the one broad paint over
  the glow's threshold (0.86). Lifting the threshold to 0.95 changed the sky by
  0.2 of 255: at Dag's glow strength (0.04) the bloom is invisible, so the
  threshold stays.

**The glaze** (`aerial-perspective.mjs`). Green turf and crowns stay green
under any light: a blue fill or a storm's grey only dims them. A painter lays
the light's colour over the land.
- The aerial perspective's fog step receives every fogged material's colour:
  ground, crowns, trunks, buildings, bushes, water and flags. It now gives a
  share of that colour (`amount`) to the glaze's tint at the colour's own
  brightness, before the haze.
- The sky takes no haze and no glaze.
- The glaze gives way over bright colours (linear luminance 0.5 to 1.0), so
  the aviation lamps, pushed past white, keep their red.
- A light without a glaze draws exactly what it did: `mix(c, ..., 0)` is `c`.
- **Tried and dropped:**
  - First the glaze was laid in the ground's and the crowns' colours. That
    missed the trunks, which glowed orange at the blue hour.
  - A saturated blue tint turned the blue hour's grass into water.
  - A pale steel grey was too grey.

## What it costs

- **The glaze:** a luminance, a smoothstep and a mix for every fogged pixel.
  It reads the colour the material already made and adds no varying: the
  aerial perspective's vertex outputs are as they were.
- **The storm's wind:** a comparison a frame.
- Everything else is values.

No draw, pass or texture is added. Nothing was timed.

## Evidence

**Unit tests.**
- `aerial-perspective.test.mjs`: the glaze.
  - It lies in the blue hour, the storm, dawn and the midnight sun alone, and
    in none with `?lights=before`.
  - It keeps a colour's brightness exactly, in each light's own tint.
  - It gives way over a lamp pushed past white, and without one it leaves a
    colour as it is.
  - The aerial perspective takes it from the preset.
- `one-wind.test.mjs`: the storm's wind.
  - It blows at least 12 m/s gusting to 18, from where the wind blew, over the
    default breeze and a weaker live wind.
  - A stronger live wind and a `?vind=` wind are kept. No other light has one.
  - `main.js` steps the air and the flags on it, while the Kikaren reads the
    weather itself.
- `painted-world-palette.test.mjs`: the audited values.
  - The blue hour's sky exposure and fill, and its cobalt zenith.
  - Golden hour's sun height and shade; the storm's deck, sheen and wind.
  - The crowns taking dawn's and the midnight sun's light; noon's sun under
    58°.
  - `?lights=before` gives each audited light as it was and leaves the others
    alone.
- `water-above.test.mjs`: the water's share in a cloud's full shade follows
  the ground's. Noon's is now 0.683 and golden hour's 0.849, against 0.673 and
  0.852 before.
- `visual-fix-switches.test.mjs`: `?lights=before` keeps every prepared startup
  path eligible.

**Isolated browser check**
([`check-isolated.mjs`](graphics/lights-2026-09-25/check-isolated.mjs),
[result](graphics/lights-2026-09-25/isolated-check.json)).
- It runs in SwiftShader, on WebGL2 and on WebGPU with reversed depth.
- Main's light is drawn in the same page:
  - main's `atmosphere-presets.mjs`, `painted-world-palette.mjs` and
    `aerial-perspective.mjs`, generated from git at `381a3a5b`;
  - main's fog node takes the scene's, and three compiles programs of its own
    for it;
  - the trees, atlas and textures are the same;
  - every other module the page draws with is unchanged since then.
- The two backends agree within 0.0005 over 505 measures.
- Every read-back is drawn until two renders in a row agree. Brightness here is
  linear luminance.

**Findings.**
- **The before is main's.**
  - On the CPU: with `?lights=before`, every light's painted atmosphere is
    main's, value for value.
  - On the GPU: every pixel is main's, in all nine lights, from the tee and
    over the woods toward the sun.
  - The glaze code therefore draws nothing when no glaze is laid, on either
    backend.
  - The summer day, mist and autumn are main's as they are.
- **What changed, light by light:**
  - **Blå timmen:** the sky from the tee goes from 0.040 to 0.115 and the land
    from 0.079 to 0.055. The land's saturation falls from 0.70 to 0.53, and its
    blue against its green rises from 0.30 to 0.85.
  - **Kväll:** the ground from the tee goes from 0.059 to 0.078, and the course
    from above from 0.074 to 0.087.
  - **Oväder:** the spread of the sky's brightness toward the sun falls from
    0.19 to 0.09, and overhead from the tee from 0.20 to 0.07. The ground's
    saturation falls from 0.79 to 0.53.
  - **Gryning:** the land's saturation falls from 0.64 to 0.55, and its red
    against its green rises from 0.49 to 0.68.
  - **Midnattssol:** the land's red against its green rises from 0.55 to 0.67.
  - **Dag:** the sun stands at 55°, and the course from above keeps 96% of its
    brightness.
- **The lamp.** In the blue hour the lamp's 1,369 pixels keep their colour
  exactly, while 135,346 pixels of the land take the glaze.

**Pictures** ([lights.jpg](graphics/lights-2026-09-25/lights.jpg)): main
beside now for each audited light, from the tee and from a second view -- the
blue hour and the storm toward the sun, golden hour and noon from above, dawn
away from the sun, the midnight sun toward it -- through the app's tone mapping
with high quality's glow.

**App boot**
([`check-boot.mjs`](graphics/lights-2026-09-25/check-boot.mjs),
[result](graphics/lights-2026-09-25/boot-check.json)). The re-baked app boots
ten ways on WebGL2 in SwiftShader (`det=1`).
- Each boot compiles every material in the scene, in view or not. No page or
  console error occurs in any boot.
- The tree tier audit passes in each.
- `det=1` pins the air to its target wind, so each boot reads the wind the
  trees and flags answer.

| Boot | What the harness reads back (V3D.atmosphere, the renderer's exposure) |
|---|---|
| Visby, Blå timmen, high and low quality | The glaze at 0.45 in its slate tint; exposure 1.00; the air at the default 4 m/s |
| Visby, Blå timmen, `?lights=before` | No glaze; exposure 1.14, as on main |
| Visby, Oväder | The deck's scale 0.0001; the glaze at 0.35; the air at 12 m/s, the storm's floor over the default breeze |
| Visby, Oväder, `?vind=270,3` | The air at 3 m/s: a wind asked for is kept |
| Visby, Oväder, `?lights=before` | The deck at 0.00026, no glaze, the air at 4 m/s, as on main |
| Visby, Kväll | The sun 12.5° up, no glaze |
| Visby, Dag | The sun 55.1° up |
| Ängsö, Gryning | The rose glaze at 0.22, and dawn's valley mist |
| Ängsö, Midnattssol | The gold glaze at 0.15 |

**Prepared startup data.** The source revision moved, so the following were
re-baked through the existing publishers for revision `9f09bf83`: tints (26),
far vista (26), scatter (26) and water (10 courses).

[`check-publication.mjs`](graphics/lights-2026-09-25/check-publication.mjs)
compares against main's last bake at `381a3a5b`
([result](graphics/lights-2026-09-25/publication-identity.json)). Every
tint, vista, scatter and water record keeps its content; only its source
identity changed. `check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/lights-2026-09-25/prepared-check.json)),
and the app boot above ran on it.

**Suite.** The full `pnpm test` passes: 1,454 Vitest tests and 482 Node tests,
with 3 environment skips. The app-build isolation check,
`check:course-workflow` and the no-undef lint also pass.

## Not established

- **Pictures on the owner's GPU and phone.** Judge each light against
  `?lights=before`:
  - the blue hour at Visby and at a lake course, with the aviation lamps in
    view;
  - golden hour from the tee and the Ovan view;
  - the storm's deck, its trees in the gale, and its wet fairways;
  - dawn and the midnight sun from a tee toward the sun and away from it;
  - noon from above.
- **Rain** in the storm. It waits on a timing on the phone.
- **Frame time.** Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/lights-2026-09-25/check-isolated.mjs
node docs/graphics/lights-2026-09-25/check-boot.mjs
node docs/graphics/lights-2026-09-25/check-publication.mjs   # after the re-bake
```
