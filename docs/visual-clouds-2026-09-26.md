# The clouds, 26 September

**Owner request, 26 September.** Asked "Anything more that you think we should
improve when it comes to visuals?", the recommendation led with the clouds: lit
by the sun, and their shadows drawn out along a low sun's light. The owner
answered:

> "Yes, start with the clouds batch"

This follows [the nine lights](visual-lights-2026-09-25.md).

Two changes, each behind its own before switch:
- **`?cloudlight=0`**: the clouds lit by the sun.
- **`?cloudstretch=0`**: the clouds' shadows drawn out along a low sun's light,
  and the water's body taking them at every angle.

Both switches keep the prepared startup data eligible, so an A/B pair differs
only in the clouds. Nothing here changes geometry, placement or prepared data:
the re-bake refreshed source identities only.

## The clouds lit by the sun

**What was wrong.** The painted sky shaded each cloud from its own noise
(`light`, from two of its octaves), the same whichever way the sun stood. The
shade fell in random blotches inside cream clouds, so the clouds read flat:
no sunlit side, no shaded underside, nothing to say where the light came from.
Toward the sun, the glow lifted them all to their lit paint.

**Now** (`painted-sky.mjs` `sunLit`, at each light's `skyCloudSun` share):
- **Lit where the cloud thins toward the light.** The sky looks up the cloud's
  thickness a little way along the light and compares it with its own. Where
  the cloud thins that way it takes the lit paint; where it gathers, the
  light's base colour (`skyCloudBase`).
- **The light climbs over each cloud** from the sun's side and over its top. On
  the cloud plane the top is the edge nearer the eye, which stands higher in the
  sky than the far one. So tops and sunward flanks are lit, and bases and far
  flanks shaded.
  - A high sun lights from above: the sun's side counts by the cosine of its
    height.
  - Overhead, the view shows a cloud's belly, up to 30% darker.
- **Toward and away from the sun.** Seen toward a low sun, a cloud shows its own
  shade: 60% of the lit paint, straight toward it. Seen away, it shows its lit
  face.
- **Near the sun** light scatters through the clouds. They keep their lit paint
  within the glow's lobe, so the glow's shine still crosses its threshold there.
- **The lining.** Round that lobe, toward the sun, the thin band just inside
  each cloud's edge takes the lit paint: a silver (or gold) lining round a
  darker body.
- **Never brighter.** Every cloud colour lies between the base colour and the lit
  paint, so the glow's thresholds (`skyPaintCeiling`) stand as they were.

**Each light's base colour.** The lights' own cloud shade colour was nearly the
sky's blue-grey. A shaded base painted in it read as a thin cloud, not a shaded
one. Each sunlit light now has a base colour the sky's blue does not swallow:

| Light | Lit paint | Base | Clear sky's zenith |
|---|---|---|---|
| Kväll | `#ffd49b` cream | `#9890ae` lavender | `#397cba` |
| Dag | `#fff5df` white | `#a3aec4` grey-blue | `#146ab6` |
| Gryning | `#edd0d7` pink | `#9a93ae` grey-lavender | `#8aa6c8` |
| Midnattssol | `#ecc6a4` apricot | `#958aa3` mauve-grey | `#596baa` |
| Höst | `#ffedcf` cream | `#9da3bd` grey-blue | `#226db1` |

Blå timmen, Oväder and Dis have no sun to light their clouds from (their share
is 0), and Sommar has no clouds: all four are main's as they are.

**Tried and dropped.**
- **The sun's side alone.** Lighting each cloud only from the sun's azimuth was
  right across the light but wrong away from it. There it lit the edge nearer
  the eye and shaded the tops.
- **The far edge as the top.** The first climb over the top took the far edge,
  which stands lower in the sky: clouds away from the sun were lit from below.
- **The lights' own shade colour** for the bases: as above, it read as thinness.
- **Backlit all the way to the sun.** Darkening clouds straight toward the sun
  cut golden hour's glow to a quarter of the sky it crossed on main, and
  autumn's to almost none. Keeping the lit paint inside the glow's lobe brought
  it back.

## The shadows drawn out along a low sun's light

**What was wrong.** The clouds' shadows were laid round at every sun height. A
cloud stands about half as tall as it is wide, and under a low sun its shadow
falls that height's run beyond it. At golden hour, shadows are long bands of
light and shade across the land.

**Now** (`cloud-shadow.mjs` `stretch`):
- A shadow is 1 + 0.55 x cot(the sun's height) times as long as it is wide,
  along the sun's azimuth, to at most 6:

  | Light | Sun | Stretch |
  |---|---|---|
  | Kväll | 12.5° | 3.49 |
  | Höst | 13.0° | 3.38 |
  | Gryning | 7.3° | 5.29 |
  | Midnattssol | 4.6° (taken at the pattern's floor, 6.9°) | 5.55 |
  | Dag | 55.1° | 1.38 |
- The pattern is read that many times more slowly along the light, so its shapes
  are that much longer, their soft edges too.
- **Each light's cover is unchanged.** The share of the ground in shade is the
  pattern's own, whatever way it is read.
- **The drift.** The air carries the shadows downwind, and it used to wrap their
  offset to the pattern's 4 km tile. A stretched pattern does not meet itself
  across that wrap: the shadows would have jumped every few minutes. The pattern
  now takes the air's drift in its own frame and wraps it there, and the air
  does not wrap a stretched drift (`period` is Infinity). The air's wrap had
  to learn to leave an unbounded period alone (`one-wind.mjs`): 0 x Infinity is
  NaN, and the first moving step turned the shadows' offset to NaN. That was
  found in review, before the merge; the checks with a pinned air could not
  show it.
- **The water.** With round shadows, a low sun's shade fell on the water's body
  only as the eye looked down: seen along the water, a round shadow is a thin
  bar. With long shadows, the body takes the shade at every angle, and a
  shadow crossing the shore goes on over the water a player looks out over.
- **The sun's road keeps its rule:** only a sun above 15 degrees lets the clouds
  cut it. Tried and dropped: cut by long shadows, golden hour's road lay in long
  pieces.

## What it costs

- **The sky:** two more noise octaves per sky pixel the world leaves (the sky
  draws last), and a few operations.
- **The shadows:** a dot product and a multiply-add per vertex where the pattern
  is read, and per water pixel.
- No draw, pass or texture is added. Nothing was timed on a GPU.

## Evidence

**Unit tests.**
- `painted-sky.test.mjs`: the clouds lit by the sun.
  - Every light with a sun and clouds lights them at share 1, in its own base
    colour; no other light does.
  - Each base is darker than its lit paint (under three quarters of its
    luminance), far less blue for its red than its sky's zenith, and under its
    glow threshold and its sky's paint ceiling.
  - The shader mixes every cloud colour between the base and the lit paint,
    keeps the lit paint near the sun, and without the switch draws main's
    noise-lit clouds.
  - The sky reports its share and base, and a sky built without them draws none.
  - `main.js` builds the sky behind `?cloudlight=0`.
- `cloud-shadow.test.mjs`: the shadows drawn out.
  - The stretch is 1 overhead, 3.48 at golden hour and 1.38 at noon, at most 6,
    and falls as the sun climbs.
  - Read as the shader reads it (a CPU copy of its coordinates and filtering),
    the pattern stays alike along the sun 0.8 to 1.25 times the stretch as far as
    across it, at golden hour, dawn and noon.
  - The same share of the ground is in shade (22%, within 3 points over 20 km).
  - The shadows drift with the air without a jump, across every multiple of the
    tile a wrapped drift would have jumped at. The drift the shader subtracts
    stays within the tile, and a crown still takes the ground's sample beside it.
  - The round before is main's: the air's own drift, the tile's period.
- `one-wind.test.mjs`: a real air carries a stretched pattern's drift
  unwrapped and finite, through a reversal past zero, into the pattern's frame
  within its tile; the round pattern's drift still wraps to the tile. Without the
  fix above, this test fails.
- `water-above.test.mjs`: the body takes long shadows at every angle, round ones
  as before; `main.js` hands the water the switch.
- `visual-fix-switches.test.mjs`: both switches keep every prepared startup path
  eligible.

**Isolated browser measures**
([`check-isolated.mjs`](graphics/clouds-2026-09-26/check-isolated.mjs), on
[the study page](graphics/clouds-2026-09-26/isolated.html); results in
[`isolated-check.json`](graphics/clouds-2026-09-26/isolated-check.json)). Main's
own sky, cloud shadows and water, generated from git at `0de84582`, are drawn in
the same page. The whole check passed after the merge on WebGL2 and on WebGPU with
reversed depth, both in SwiftShader; linear luminance throughout.
- **The before is main's.** With `?cloudlight=0&cloudstretch=0` every light is
  main's, pixel for pixel, on both backends: 42 comparisons each, covering the
  sky toward, across and away from the sun, the tee, the lake and the sea, in
  every light. The summer day, blue hour, storm and mist are main's as they are.
- **The backends agree** on all 180 measures below, to within 0.01 or 3%. Every
  read-back settled: 196 on each backend, in two renders (three on WebGPU).
- **On the CPU**, every light's painted atmosphere is main's, value for value,
  but for `skyCloudSun` and `skyCloudBase` in the five sunlit lights.
- **The clouds' order.** Seen away from the sun, how much brighter a cloud is 6
  pixels up than 6 pixels down, over its brightness above the clear sky:

  | Light | Tops over bases: main, now | Sunward flank over far one: main, now |
  |---|---|---|
  | Kväll | 0.014, 0.124 | 0.000, 0.038 |
  | Dag | -0.009, 0.074 | 0.004, 0.012 |
  | Gryning | 0.045, 0.114 | 0.003, -0.001 |
  | Midnattssol | 0.023, 0.022 | 0.014, 0.022 |
  | Höst | -0.007, 0.099 | 0.004, 0.027 |

  Main's clouds have almost no order; now their tops and sunward flanks are lit.
  The midnight sun's clouds are thin (density 0.36) and show little of any
  order. Dawn's deck is lit mostly over its tops.
- **The lining.** Toward the sun, the clouds' edges add more light against their
  bodies than main's do, in all five lights (Kväll 0.253 to 0.269).
- **No brighter paint.** Away from the sun and across its light, the brightest
  cloud is main's or darker in every light (Kväll 0.678 to 0.671).
- **The glow.** Share of the frame over the light's glow threshold toward the
  sun (the wide view, then the close one):

  | Light | Main | Now |
  |---|---|---|
  | Kväll | 1.6%, 3.8% | 1.1%, 3.0% |
  | Gryning | 3.8%, 14.7% | 3.7%, 14.8% |
  | Midnattssol | 0.20%, 0.72% | 0.18%, 0.60% |
  | Höst | 4.1%, 9.0% | 1.8%, 7.1% |
  | Dag | 8.3%, 11.6% | 1.4%, 1.2% |

  Where the glow is the light's (Kväll, Gryning, Midnattssol) it keeps 70% or
  more of main's share. Dag's white clouds crossed its 0.86 threshold on main;
  most of them no longer do. At Dag's strength (0.04) that bloom was invisible
  anyway.
- **The shadows drawn out.** A plain field 40 km across, seen from 8 km up:
  - **Pixel by pixel**, the shade is the pattern as `cloud-shadow.mjs` reads it
    (a CPU copy). Now's correlates with the stretched pattern at 0.996 to 0.997,
    and main's with the round one at 0.994. Each correlates with the other
    model at 0.1 to 0.3.
  - **Longer along the sun than across:** Kväll 3.4 (stretch 3.5), Dag 1.2
    (1.4), Gryning 6.1 (5.3), Midnattssol 7.3 (5.6), Höst 3.1 (3.4). Main's are
    round: 0.83 in this window.
- **The water, seen from 30 m under a low sun,** with the shadows' shade and
  without it:
  - Looking across the light, 98% of the sea darkens in the shade now (by 7% on
    average), and none on main.
  - Looking toward the sun, 23% darkens; the sun's road keeps its brightness to
    the read-back's precision, as main's does.

**The pictures** ([`clouds.jpg`](graphics/clouds-2026-09-26/clouds.jpg)) are
main beside the batch through the app's tone mapping and high quality's glow:
golden hour from the tee, across the light, away from and toward the sun and in
a flyover; noon, dawn, the midnight sun and autumn; golden hour from 1.6 km and
the sea from 180 m; and the long shadows cutting golden hour's road, which were
tried and dropped.

**The app boot**
([`check-boot.mjs`](graphics/clouds-2026-09-26/check-boot.mjs), results in
[`boot-check.json`](graphics/clouds-2026-09-26/boot-check.json)). The built app
booted 12 times on WebGL2 in SwiftShader, and every boot passed. Each compiled
every material in the scene with no page or console error, and the tree tiers
audited clean. Each light's sky, cloud shadows and water are the preset's:
- **Visby, golden hour, high and low quality:** the sky lit by the sun at share
  1, its base `0x9890ae`, the shadows stretched 3.487 along the sun, and the
  water's body taking long shadows.
- **The befores:** with `?cloudlight=0` the sky is main's (share 0); with
  `?cloudstretch=0` the shadows are round and the water keeps its rule; and
  both together.
- **Visby at noon and in autumn, Ängsö at dawn and under the midnight sun:**
  each light's share, base and stretch (dawn's 5.286).
- **Visby in the blue hour and the storm:** a sky lit by the sun at no share.
- **Visby in golden hour with the air moving** (no `det=1`): the shadows' drift
  was carried, finite and inside the pattern's tile 30 frames on (from 3.8, 1.8
  to 16.2, 7.7 m).

## Not established

- **Pictures on the owner's GPU and phone.** Judge each against its before:
  - golden hour from the tee and in a flyover, against `?cloudlight=0`: the
    clouds' tops, bases and linings;
  - golden hour from above and across the course, against `?cloudstretch=0`:
    the long bands, and a shadow crossing a lake's shore;
  - noon's clouds, and dawn's and the midnight sun's.
- **Frame time.** Nothing was timed. The sky's two extra octaves are the one
  real cost.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering; the isolated check covers
  WebGPU.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/clouds-2026-09-26/check-isolated.mjs
node docs/graphics/clouds-2026-09-26/check-boot.mjs
node docs/graphics/clouds-2026-09-26/check-publication.mjs   # after the re-bake
```
