# Lighting batch, 25 September

**Owner request, 25 September:** "Continue with whats recommended next!" The
request followed [the bug fixes](visual-fixes-2026-09-24.md). Next in the
visual audit's order was its Ghibli lighting batch, whose five items were:
- cool, sky-lit shadows;
- a sun glow in the low-sun skies;
- haze that warms toward the sun;
- depth inside tree crowns;
- crowns back-lit against a low sun.

Every change keeps its before behind a URL switch. The switches keep the
prepared startup data eligible, so an A/B pair differs only in the change.
The complete before is:

`?shadowtint=0&sunglow=0&hazewarm=0&crowndepth=0&backlight=0`

Nothing here changes geometry, placement, water, or the content of any
prepared data. The skies and single trees below render correctly in software,
unlike full courses, so the pictures in
[`graphics/lighting-2026-09-25`](graphics/lighting-2026-09-25) show the real
shaders. The full scenes still need the owner's GPU.

## The changes

**1. Shadows are lit by the sky** (`shadow-tint.mjs`, `?shadowtint=0`). Where
something hid the sun, the renderer removed the sun's light and left only the
fill, the same in sun and shade. Now a share of the sun's strength reaches a
shadow in the preset's own sky colour, `hemiS`:

| Preset | Share |
|---|---|
| noon | 0.12 |
| dawn | 0.12 |
| midnight sun | 0.11 |
| autumn | 0.11 |
| golden hour | 0.10 |

The tint is the light's shadow node. It is three's own shadow, filtered and
edge-faded as before, mixed toward the tint where the shadow falls. So every
lit receiver takes it at once: ground, trunks, buildings, furniture, the
golfer and flags. The shadow map, its on-demand renders and the crowns are
untouched; the crowns are unlit materials.

It is a share of the direct light, so a shadow is never lighter than the
sunlit surface beside it in any channel. It is strongest where the sun was
strongest. Relative to the sky fill, light in a shadow on flat open ground
rises by:

| Preset | Rise |
|---|---|
| noon | 19% |
| golden hour | 4% |
| autumn | 3% |
| dawn | 1.4% |
| midnight sun | 0.8% |

On a surface facing the sun (a trunk, a wall or a slope), the rise is 10–27%.
So noon shadows lift and cool the most. The long low-sun shadows across
fairways change little, because a low sun is weak on flat ground. Their colour
was already the sky's.

Blue hour, storm and mist have no sun of their own, so their shadows are as
before. A glossy surface in shade (a flagstick or a car roof) keeps the same
share of the sun's highlight: a faint, sky-coloured sheen. At golden hour the
brightest in-shade glint on a flagstick is about 0.6 in linear blue, far below
the bloom threshold.

**2. A glow where the sun is** (`painted-world-palette.mjs`, `?sunglow=0`).
Only golden hour's sky had one. Now three more skies do:

| Sky | Glow | Strength |
|---|---|---|
| dawn | peach-gold | 0.72 |
| midnight sun | gold | 0.70 |
| autumn | pale warm white | 0.40 |

The autumn sky is blue; a warm glow mixed into it came out grey, so autumn
gets the paler, brighter sky seen near an afternoon sun.

A faint afterglow was tried for blue hour. At that sky's exposure (0.20) it
could only be a dark, muddy maroon, so blue hour stays blue. Away from the sun
every sky is unchanged, bit for bit
([pictures](graphics/lighting-2026-09-25/sun-glow-and-haze.jpg), top four rows).

**3. Haze warms toward the sun** (`aerial-perspective.mjs`, `painted-sky.mjs`,
`?hazewarm=0`). Air between a low sun and the eye scatters the sun's colour
forward. The haze now takes the sky's own sun glow: its colour, its lobe
around the sun and a share of its strength (`hazeGlow`):

| Preset | Share | Resulting glow |
|---|---|---|
| golden hour | 0.5 | 0.46 toward amber, looking straight at the sun |
| dawn | 0.5 | 0.36 |
| midnight sun | 0.5 | 0.35 |
| autumn | 0.4 | 0.16 |

The sky's band under the horizon takes the same lobe, so the two still meet,
as [the horizon fix](visual-fixes-2026-09-24.md) made them. The haze reaches
every fogged material: ground, trees, water and buildings. The lobe is
reckoned per vertex and interpolated, so tree crowns shade nothing more per
pixel. Skies without a glow keep one haze colour in every direction: the
picture is the same (within 0.0005 in linear light, from interpolation).
[Pictures](graphics/lighting-2026-09-25/sun-glow-and-haze.jpg), bottom five
rows: the effect is in the distance toward the sun, where the haze is thick.

**4. Depth inside the crowns** (`crown-depth.mjs`, `?crowndepth=0`). Every
approved crown carried one flat vertex colour, 0.94–0.99 on every card, with
no relation to height or depth. So a card at the heart of a spruce was as
bright as one on its sunlit shoulder. When the trees load, each crown now
bakes how much sky each vertex sees through the crown's own leaves:
- the cards' area, at half cover for the atlas's cut-outs, goes into a
  16 × 16 × 16 grid as leaf area per cubic metre;
- each of 14 directions sweeps the grid with Beer's law, at the random-leaf
  extinction of 0.5 per unit of leaf area;
- the sky overhead is weighted three times the horizon.

A crown's most open quarter keeps its colour exactly, and its least open
vertex takes 0.62. The rest follow a smooth step between. On all 20 approved
crowns (two catalogues, Hero and Full), the inner half is darker than the
outer half, and the mean factor is 0.77–0.82.

In view, the outer cards change little. A crown drawn from 34 m is 7–11%
darker overall, darkest between a spruce's tiers and around a birch's trunk.
The impostor bake draws the crown's vertex colours (`crownAlbedo`), so the
distant billboards carry the same depth: 3.5–14% darker. The bake costs about
3 ms of CPU per crown at load, for five crowns a visit, and nothing at draw
time.

**5. Crowns back-lit against a low sun** (`ghibli-foliage-material.mjs`,
`tree-impostor.mjs`, `?backlight=0`). Looking toward a low sun, a crown's
edge glows. The weight is (view · sun)⁴ × edge². The edge term is
1 − |normal · view| with the canopy normal, so the silhouette glows and the
thick core stays dark. The colour is the leaf's brightest pigment in the
sun's colour, at a preset share (`foliage.back`):

| Preset | Share |
|---|---|
| golden hour | 0.42 |
| midnight sun | 0.38 |
| dawn | 0.30 |
| autumn | 0.30 |

Noon, blue hour, storm and mist have none. The whole glow colour is reckoned
per vertex and interpolated, so per pixel a crown adds one addition.

A billboard has no edge of its own, so the impostors take one edge weight,
0.34. At that weight, the five species' impostors gain as much light against
the sun as their mesh crowns: a ratio of 1.007 over golden hour and the
midnight sun. Species differ, 0.4–1.9 each.

The painted crowns never had a back-light. The one the tree LOD notes describe
belonged to the realistic impostor path, and the painted path overwrote its
colour. [Pictures](graphics/lighting-2026-09-25/crowns.jpg).

## What it costs

No change adds a texture read, a draw or a pass.

| Change | Cost |
|---|---|
| Shadow tint | One mix per shaded pixel of the lit receivers. Nothing on crowns. |
| Sky glow | Uniforms only. |
| Haze band in the sky | One mix per visible sky pixel. |
| Haze | Per-vertex work. Per pixel, one interpolated vec3 on every fogged material. |
| Crown depth | About 3 ms of CPU per crown at load. Nothing at draw time. |
| Back-light | Per-vertex work. Per pixel, one interpolated vec3 and one addition on crowns and impostors. |

Nothing was timed on a GPU.

## Evidence

**Unit tests** (`apps/golf/src/engine`):
- `shadow-tint.test.mjs`: sun × tint is the sky colour at its share, never
  lighter than sunlit ground, cooler than the sun, and none without a sun;
- `painted-world-palette.test.mjs`: which skies glow;
- `aerial-perspective.test.mjs`: the haze's share of the glow, only where the
  sky has one, and the before;
- `crown-depth.test.mjs`: every approved crown (both catalogues, both drawn
  tiers), the open quarter, the floor, the inner half darker, deterministic;
- `foliage-back-light.test.mjs`: the presets' back-light and the before;
- `visual-fix-switches.test.mjs`: every before switch keeps all four prepared
  startup paths.

**Isolated browser check**
([`check-isolated.mjs`](graphics/lighting-2026-09-25/check-isolated.mjs),
[result](graphics/lighting-2026-09-25/isolated-check.json)). The page uses the
app's own modules, in SwiftShader, on WebGL2 and on WebGPU with reversed
depth. Both backends agree to four decimals.

- **Shadow.** A white floor and a post, under each preset's sun and fill, with
  the app's shadow filter. Sunlit floor is unchanged bit for bit. The umbra
  gains the predicted light within 3% (noon +0.026/+0.036/+0.046 in linear
  RGB against +0.027/+0.037/+0.047 predicted) and stays darker than sunlit
  floor in every channel. Under storm the umbra is unchanged.
- **Sky.**
  - Each low-sun sky is warmer toward the sun with its glow.
  - Away from the sun, the sky is unchanged.
  - Noon, blue hour, storm and mist are the same picture.
- **Haze.** A plain 20 km out in every direction, under each preset's fog, sun
  and sky:
  - toward the sun it is warmer in all four low-sun presets;
  - away from the sun it is unchanged (a change of exactly 0);
  - without a glow it is the same picture;
  - a fogged line and sprite, like the app's aim lines and labels, compile
    with the per-vertex haze colour.
- **Crowns.** Spruce, birch and oak Hero crowns, drawn with the player's
  foliage material, and the impostors baked from them:

  | | Crown depth | Back-light, against the sun | Back-light, 60° off the sun |
  |---|---|---|---|
  | spruce mesh / impostor | −11% / −14% | +76% / +84% | +3.5% / +3.6% |
  | birch mesh / impostor | −7.1% / −7.5% | +42% / +40% | +2.4% / +2.1% |
  | oak mesh / impostor | −7.0% / −3.5% | +59% / +26% | +4.2% / +1.5% |

**App boot**
([`check-boot.mjs`](graphics/lighting-2026-09-25/check-boot.mjs),
[result](graphics/lighting-2026-09-25/boot-check.json)). The built app boots at
Ängsö's first tee at golden hour on WebGL2 in SwiftShader, at high and low
quality and with every before switch. No page or console error occurs, so no
shader failed to compile. What the harness reads back:

| | high quality | low quality | every before switch |
|---|---|---|---|
| the sun's shadow node | sky-lit, tint (0.030, 0.070, 0.241) | the same | three's own |
| sky glow | 0.92 | 0.92 | 0.92 (golden hour's own) |
| haze glow, fog and sky band | 0.46 and 0.46 | 0.46 and 0.46 | 0 and 0 |
| crown back-light | 0.42 × the sun | the same | none |
| crowns' darkest vertex (green) | 0.58–0.60 | 0.58–0.60 (Full) | 0.94–0.97 |
| tree tier audit | passes | passes | passes |

**Tree shadow proof.** `tools/check-tree-shadows.mjs --ref 9bb1f2bf --modes
match,colour` passes in SwiftShader on WebGL2. There are 80 mesh-against-impostor
shadow comparisons, and all 25 crown and impostor colour passes are identical
to main's pixel for pixel: with no back-lit sun set, the new crown colour is
the old one.

**Prepared startup data.** See below.

## Not established

- **Pictures of full courses.** Judge these on the owner's GPU and phone,
  against the before switches:
  - noon shadows;
  - the dawn, midnight-sun and autumn skies;
  - the haze toward the sun from a tee;
  - forests, which read darker by the crown depth;
  - forest edges against the golden-hour sun.
- **Frame time.** See "What it costs". Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering, with or without these
  changes. On WebGPU the changes stand on the isolated page, and on the
  owner's GPU (`BANVY_GPU=1` runs the boot check there too).

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/lighting-2026-09-25/check-isolated.mjs
node docs/graphics/lighting-2026-09-25/check-boot.mjs
node docs/graphics/lighting-2026-09-25/check-publication.mjs   # after the re-bake
```
