# A cloudless summer day, 25 September

**Owner request, 25 September.** The owner asked:

> "Would it be possible to have a sun summer ljus mode. So a ljus mode setting
> without clouds and a perfect blue sky summerday?"

Shown the proposal (a ninth light beside Dag), the owner answered:

> "Do a mode that would look best visually!"

This follows [the water from above](visual-water-above-2026-09-25.md).

**Sommar** is a ninth light: `?ljus=sommar`, next to Dag in the rail and the
drawer. The sky has no clouds at all, so no cloud shadows cross the course.
The zenith is a deep cerulean over a pale, luminous horizon. The sun stands
high in the early afternoon, the air is clear, the greens are fresh and the
water is a deep blue with a bright glitter.

Nothing else changes:
- every other light is main's, value for value;
- no shader, geometry, placement or prepared content changes. The re-bake
  refreshed source identities only;
- the menus make room for the new button (below).

There is no before switch: Sommar is a new light, and Dag is what to compare
it with.

## The light

Sommar against Dag, as the player lights them: the painted atmosphere over the
authored preset (`painted-world-palette.mjs` over `atmosphere-presets.mjs`).

| | Dag | Sommar |
|---|---|---|
| Clouds | White clouds over part of the sky, and their shadows over the course | None: cloud coverage and density nil. No cloud shadows, no cloud paint |
| Sky | Zenith `#146ab6`, horizon `#91cadc`, no glow toward the sun | Zenith `#0f5cc4`, a deeper and clearer blue; horizon `#8ecbea`; a faint warm-white brightening toward the sun near the horizon (`#fff6e0` at 0.15) |
| Sun | 61.7° up: higher than any Swedish sun stands | 50.4° up, as the midsummer sun stands over Stockholm or Visby in the early afternoon; a 20 m tree's shadow is 16.5 m, against 10.8 m |
| Sun and sky light | Sun `#fff0d7` at 2.35, sky `#adc9df` at 1.28 | Sun `#fff3dc`, a touch whiter, at 2.45; sky `#a8c9e6`, a touch bluer, at 1.25: the shadows a little crisper |
| Shadows | 12% of the sun, sky-coloured | 13%: a touch bluer under an open sky |
| Air | Haze density 0.00020, at most 78% on the farthest ground | 0.00014: the haze reaches half at 6.6 km, against 4.6 km. At most 72%, so far ridges keep more of their colour. Bluer (`#94c3d8`) |
| Greens | Foliage 1.04, ground 0.85 | 1.08 and 0.87: fresher |
| Water | `#228b9d` to `#164c88`, sparkle 0.18 | `#1c8ea6` to `#10498c`, a deeper blue; sparkle 0.35, a bright glitter under the high sun |
| Reflections | Environment horizon `#c5dde2`, zenith `#579bc4` | `#bcdcee` and `#4389cc`: the water mirrors the same clear blue |
| Glow | Threshold 0.86, strength 0.04. Its white clouds (0.92) cross it: 4-6% of the frame wherever sky shows | The same, and nothing crosses it: the sky's brightest paint is 0.52, the brightest ground, trees and glitter 0.75. A clear day stays crisp |

Every other value is Dag's: exposure, grade, the painted fill, the ground's
colours and the environment's strength. The physical sky's turbidity and
scattering are set for a clear sky too, but the painted sky draws over them.

**How it was chosen.** The light was tuned in an isolated scene lit as the
player lights it: the painted sky, the sun with its sky-lit shadows, the
approved trees' impostors in stands along a fairway, a green and a lake in the
player's water shading
([study](graphics/summer-2026-09-25/isolated.html)). Tried and dropped:
- **A paler first sky** (zenith `#1766c0`, horizon `#a6d6ea`). With no clouds
  to set it off, it read as a washed-out summer, not a perfect blue.
- **Cobalt** (`#0a4fbd` over `#88c8ea`), with twice the glow toward the sun
  (0.30). The most striking overhead, but toward the sun the glow mixed with
  the cobalt's violet and read lavender-grey. The cerulean, with half the
  glow, stays clean there.
- **The sparkle at 0.20** was too faint for a clear midsummer sun, and at 0.45
  the glitter whitened the lake round it. At 0.35 it is bright and the lake
  stays blue.

## Where it is

- **Links.** `?ljus=sommar` (also `?ljus=summer`) opens in it, and the link
  keeps it.
- **The rail.** The first light row holds Kväll, Dag, Sommar and Gryning. At
  the desktop rail's width Sommar overflowed its button by 2 px, so that row's
  buttons have 2 px side padding instead of 4, at every window height. The
  phone's sheet is wide enough and keeps its own.
- **The drawer.** The nine lights sit three by three. Before, eight lights
  filled four columns (two on a phone); a ninth would have stood alone.
- **The continuous ocean** (Norrfällsviken) keeps at least noon's haze at its
  horizon, 0.00022, to fade the sea's far edge. Noon's own 0.00020 was raised
  to it; the summer day's clearer air is raised too. Every other light's is
  above it.
- **The glow** (`glow.mjs`): the ceiling of a sky's broad paint counts its
  clouds' paint only if it has clouds. A sky without cloud density draws none.

## What it costs

Nothing: it is a preset, drawn by the same shaders as Dag. The sky still
reckons its cloud field and the ground still reads the clouds' shadow
pattern, both with no effect. Nothing was timed on a GPU.

## Evidence

**Unit tests.**
- `atmosphere-presets.test.mjs`: nine identities with distinct cloud
  profiles, every sky with clouds but the summer day's. The summer day is
  cloudless, its sun between 45 and 55 degrees and lower than noon's, its air
  clearer than noon's and its sun at least as strong.
- `painted-world-palette.test.mjs`: the summer day paints no cloud and no
  cloud shadow, sets the sky that way, and has a saturated blue zenith (bluer
  than noon's) over a lighter blue horizon, with more sparkle than noon. Every
  palette switches and back through the same sky and water uniforms.
- `cloud-shadow.test.mjs`: shadows fall in every light with a sun and clouds,
  and in none without. `shadow-tint.test.mjs`: the summer day's shadows keep
  its sky-coloured share of the sun. `glow.test.mjs`: the summer sky's paint
  sits under its threshold by the margin, as every light's but noon's does
  (noon's white clouds cross it, as they always have).

**Isolated browser check**
([`check-isolated.mjs`](graphics/summer-2026-09-25/check-isolated.mjs),
[result](graphics/summer-2026-09-25/isolated-check.json)). It runs in
SwiftShader, on WebGL2 and on WebGPU with reversed depth, and the two agree
within 0.001 over 70 measures. Every read-back is drawn until two renders in a
row agree.
- **Every other light is main's.** The check generates main's
  `atmosphere-presets.mjs`, `painted-world-palette.mjs` and `glow.mjs` from
  git at `db2cc9bb`. For each of the eight lights, the painted atmosphere,
  the glow threshold and the ceiling of the sky's paint are main's, value for
  value, and so is the continuous ocean's haze. The summer day is the only
  light added.
- **No clouds.** With the summer sky's cloud field scaled 1.7 times and raised,
  not one pixel changes, in four views: the sky alone toward the sun and
  straight up, from the tee, and a flyover. Noon's clouds move in the same
  views: 66%, 73%, 31% and 25% of the pixels change.
- **No cloud shadows.** With the clouds' shadow pattern moved elsewhere, not
  one pixel changes straight down, in the flyover or over the lake. Noon's
  shadows move: 69%, 28% and 14% of the pixels change.
- **The glow.** The summer sky's brightest paint, low toward the sun, is 0.52,
  under the threshold of 0.86 by far more than its margin (0.02). In six views
  of the whole scene nothing in the summer day crosses it. The brightest is
  0.75, and the glitter on the lake 0.44. Noon's white clouds at 0.92 cross it
  in the four views that show sky, over 4-6% of the frame, as on main.
- **Straight up**, the sky is the summer's zenith colour to 0.04%.

**Pictures** ([summer.jpg](graphics/summer-2026-09-25/summer.jpg)): Dag beside
Sommar from the tee, a flyover, across the lake, the sun on the lake and over
the green, through the app's tone mapping with high quality's glow.

**App boot**
([`check-boot.mjs`](graphics/summer-2026-09-25/check-boot.mjs),
[result](graphics/summer-2026-09-25/boot-check.json)). The re-baked app boots
five ways on WebGL2 in SwiftShader (`det=1`).
- Each boot compiles every material in the scene, in view or not. No page or
  console error occurs in any boot.
- The tree tier audit passes in each.

| Boot | What the harness reads back (V3D.atmosphere, V3D.quality) |
|---|---|
| Visby, `ljus=sommar`, high quality | The summer preset. The sky's cloud coverage and density 0, no cloud shadows (cover and opacity 0), the glow at 0.86 and 0.04, and the haze at 0.000126 as `setPreset` leaves it. The link keeps `ljus=sommar`; Sommar is lit in the rail and the drawer. |
| Visby, `ljus=sommar`, low quality | The same, without the glow: low quality has none. |
| Visby, `ljus=dag` | Noon as on main: clouds 0.28 and 0.85, their shadows (cover 0.30, opacity 0.62), haze 0.00018. |
| Visby, Dag, then the buttons | The rail's Sommar button switches to the summer day, its link and both menus' highlight. The drawer's Dag brings noon back exactly as it booted, its clouds and their shadows included. |
| Ängsö, a lake course, `ljus=sommar` | The summer day, the lake's water compiled with the rest. |

**The menus** ([menus.jpg](graphics/summer-2026-09-25/menus.jpg)), measured in
the booted app with the scene stopped:
- the rail at 1440x900, 1280x800 and 1024x768, a tall window and both
  short-window tiers: no light button's name overflows, and Sommar sits in the
  first row;
- the drawer at 390 and 360 px: open, the nine lights three by three, none
  overflowing.

**Prepared startup data.** The source revision moved, so the following were
re-baked through the existing publishers for revision `e2289081`: tints (26),
far vista (26), scatter (26) and water (10 courses).

[`check-publication.mjs`](graphics/summer-2026-09-25/check-publication.mjs)
compares against main's last bake at `db2cc9bb`
([result](graphics/summer-2026-09-25/publication-identity.json)). Every
tint, vista, scatter and water record keeps its content; only its source
identity changed. `check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/summer-2026-09-25/prepared-check.json)),
and the app boot above ran on it.

**Suite.** The full `pnpm test` passes: 1,445 Vitest tests and 482 Node tests,
with 3 environment skips. The app-build isolation check,
`check:course-workflow` and the no-undef lint also pass.

## Not established

- **Pictures on the owner's GPU and phone.** Judge Sommar against Dag:
  - Visby's hole 4 from the tee, and the flyover;
  - a lake hole, looking toward the sun and away from it;
  - the Ovan view.
- **Frame time.** Nothing was timed. Sommar draws what Dag draws.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/summer-2026-09-25/check-isolated.mjs
node docs/graphics/summer-2026-09-25/check-boot.mjs
node docs/graphics/summer-2026-09-25/check-publication.mjs   # after the re-bake
```
