# Winter and Nu in the detailed course, 6 November

**Owner request, 6 November.**

> "In the detailed 3d version for the golf application, I also want a Ljus &
> Atmosphere called "Nu" as the current weather. We also need a "winter" ljus
> as we have in the light 3d map."

Two lights join the nine in the rail's and the drawer's Ljus & Atmosfär:

- **Vinter** (`?ljus=vinter`): a clear January day over snow, as the map's Vinter is.
- **Nu** (`?ljus=nu`): the real sun over the course, the season, and the weather now.

Every other light is main's, value for value. `?snow=0` is the before for
everything winter draws.

## Vinter

The light (`atmosphere-presets.mjs` and `painted-world-palette.mjs` `winter`):
a low sun 15° up in the south-south-west, as a January noon sun stands, pale and a
little warm (`#ffe9cf` at 2.6). A cold blue zenith (`#2c6cb8`) over a pale icy
horizon, a few thin clouds, and blue shade (16% of the sun, sky-coloured, the
most of any light: snow's shadows are the sky's light). The sky's paint is kept
under the glow's threshold with its margin, as every light's is (`glow.test.mjs`).
The haze warms toward the low sun, and the pines take its rim (`foliage.back`).

What winter draws (`engine/snow.mjs`), all from one uniform, `paintedSnow`, which
the light sets (`snow: 1`) and Nu sets when snow lies:

| | |
|---|---|
| The ground | Snow over the painted ground's finish (`material.js` `paintedGround`): nearly all of the wild ground, 86% of the mown turf (a course still reads under it, as on the map), 92% of sand and hard ground. A face steeper than about 45° sheds it. The finish's broad blotch breaks its edge on a slope. |
| Conifers | Snow on the tops of their crowns: faces turned up past 0.5, at 60%. The same term in the mesh crowns and the impostors (`paintedFoliageColour`), so near and far agree. From 0.2 up the whole upper half went white and a stand of pines read as snowballs. |
| Broadleaves | Bare: birch, alder and oak crowns are not drawn, and their modelled wood stands (`realistic_trees.py` grows trunks, limbs and the stoutest twigs as wood). Their impostors are baked again from the wood alone, into the same atlases (`bakeImpostorAtlas` `into`, `bare`), at the next frame once the boot is done, never inside a compile. Mesh and impostor shadows follow, since both come from what is drawn. |
| Lakes | Frozen and snowed over: the water's colour gives way to ice, wind-scoured grey-blue in patches, lit as level ground is (`uIceLight`: the sun on it and the sky over it), and opaque. The sea stays open: the sea's sheets never freeze. Swans, herons and lilies are not drawn on a frozen lake. |
| Roofs | Snow on whatever is built and faces the sky (`building-paint.mjs` `wallFootColour`, the batch and the Blender models alike), up to a 60° pitch. |
| Under the snow | The grass round the ball, the tussocks and the bushes are not drawn. |
| The air | No butterflies, flowers or motes; a few flocks (0.35); god rays through the pines at 0.35; no lake mist. |

The map keeps its own Vinter (`map-light.mjs`), as the owner reviewed it.
`map-light.test.mjs` now counts the simulator's lights other than winter.

## Nu

Nu chooses one of the ten lights by the moment (`engine/light-now.mjs`, pure, and
tested in `light-now.test.mjs`), and stands the sun where it really stands:
NOAA's equations (`engine/solar.mjs`, moved from the map, which re-exports them),
at no lower than the light lets it (the blue hour keeps its own height under the
horizon, toward where the sun really is).

| The moment | The light |
|---|---|
| The sun more than 4° under the horizon | Blå timmen |
| Rain or thunder | Oväder |
| Snow falling, fog, or under 1.5 km to see | Dis |
| Over 85% of the sky covered, dry | Dis, in clearer air (fog density 0.00055 against its 0.00125) |
| Snow on the ground | Vinter |
| A sun under 12°: autumn or pale grass | Höst |
| A summer sun under 12° in the north (after about nine on a June evening) | Midnattssol |
| Any other sun under 12° | Gryning before noon, Kväll after |
| Higher: a clear summer sky | Sommar |
| Higher, otherwise | Dag |

And under whichever light it chose:

- **Snow lies** by the reading's snow depth (2 cm or more), or while snow is falling.
  Without a reading, by the season (`seasonAt`: December to March, longer in the north).
  Snow also bares the broadleaves.
- **The broadleaves are bare** from late October to May (`seasonAt`).
- **The leaves turn** in autumn under any light (`uAutumn`).
- **The grass lies pale** (`straw`: the autumn light's ochre on the ground) from the
  first frosts until it greens in spring.

The weather is Open-Meteo's, which the Kikaren already reads (`engine/weather.js`).
It now also asks for cloud cover, precipitation, snow depth and visibility. It is
read once the course is up and every half hour. It is never read under `det=1`
or in an automated browser (`navigator.webdriver`): a golden must not depend on
the weather. Nu boots under the last reading kept for the course, so its first
lighting bake is the light it draws. Until a reading comes it chooses by the sun
and the season alone.

It looks again every minute and when a reading comes, and draws again only when the
light, the season, the air or the sun has moved (2% of the sun's direction, a few
minutes). Choosing it shows what it drew:

> Nu · Kväll · Halvklart, 4 °C · solen 8° över horisonten i SV

The rail's Nu button carries the same words as its title.

- `?ljus=nu&klocka=2026-01-15T11:00Z` stands Nu at a moment.
- `V3D.setNuClock(date)` and `V3D.setNuWeather(reading)` stand it at any moment, under any sky.
- `V3D.nu()` reports what it drew and why.
- `V3D.winter()` reports the snow, the bare trees and their last bake.

## Not covered

- The GPU tree cull (`?treecull=gpu`, opt-in) draws its own copies of the hero
  tiers: there the broadleaves keep their leaves in winter.
- The far ring's stand-in forest stays green, as conifers would.
- No snow falls: the motes are off at the owner's request (3 November), and rain is the storm's alone.
- Re-baking a broadleaf's impostors costs a few hundred renders of three species
  on choosing Vinter, or when Nu's season turns bare: a short hitch, once.

## Prepared data

`snow` and `klocka` are display-only for the prepared startup data
(`preparedTintAllowed`). The engine and `main.js` changed, so the prepared data
was re-baked at the new source revision (see the commit).

## Verification

`pnpm exec vitest run apps/golf` passes, with the new light-now, weather and
counting tests.

Winter was photographed in this container's software renderer (SwiftShader, low
quality, 960 × 540, `det=1`):

- from the tee and from above on Veckefjärden's 13th, on Johannesberg's 1st and on
  Ribbingsfors' 3rd;
- Nu on a June evening (Kväll, the sun low in the west-north-west) and on a January
  noon (Vinter, under the real sun 9° up in the south).

The photographs found three things, fixed before the commit:

- the conifers' snow climbed the whole upper half of a crown, and the pines read as snowballs;
- green bushes dotted the snow;
- the roofs stayed slate. three multiplies vertex colours after a material's colour,
  so the snow took the roof's own colour.

The photographs show the snow, the bare broadleaves, the frozen water and the roofs
are drawn, and that the boot is clean. In software, re-baking the broadleaves'
impostors took 27-130 s. It does not establish how they look on the owner's GPU, at high
quality or on WebGPU. Review them there with `tools/gfx-gallery.mjs --light vinter`.
