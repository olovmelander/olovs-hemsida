# The water from above, 25 September

**Owner request, 25 September.** The owner asked how the water looks straight
from above. Shown pictures from the heights the Ovan view uses, and three
proposals, the owner answered:

> "Start with 1 and 2"

1. **Cloud shade on the water:** the water darkens by the same share of sun
   the ground loses, so the clouds' shadows carry on across the shoreline.
2. **Wind lanes:** the calm and gusty patches that already drift across the
   water, shown from above.

The third proposal, tree shadows on the water, waits. It needs a shadow-map
read for every water pixel, and a timing on the owner's GPU and phone.

This follows [the water road pass](visual-water-road-2026-09-25.md).

Each change keeps its before behind a URL switch. The switches keep the
prepared startup data eligible, so an A/B pair differs only in the change.
The complete before is:

`?watercloud=0&waterlanes=0`

- `watercloud=0` leaves the clouds' shade at the water's edge.
- `waterlanes=0` shows the calm and gusty patches in the ripples alone.

Nothing here changes geometry, placement or prepared data: the re-bake
refreshed source identities only.

## What the water looked like from above

Ovan looks straight down from 170 to 900 m (`top-view.mjs`): about 270 m over
a par 3 and 490 m over a typical hole on a phone. An isolated page draws the
player's own water there beside ground lit as the player lights it
([study](graphics/water-above-2026-09-25/isolated.html)).

- **The water is its body.** Looking straight down, water mirrors a few
  percent of the sky overhead. So everything the water batch and the road
  pass built from reflections is gone: the sky's colours, the sun's road and
  the far shore. The sun's glitter shows only under a high sun, on the side
  toward it.
- **One even blue.** At golden hour the body was a flat fill. The road pass's
  relief gave it a fine grain, about 2-3% from pixel to pixel at 270-900 m.
  Across the frame nothing changed by more than half a percent.
- **The clouds' shade stopped at the shore.** A cloud's shadow darkened the
  ground and ended at the water's edge. On the water it put out only the sun's
  sparkle, and at golden hour not even that.
- **The wind did not show.** The calm and gusty patches change only how
  strongly the water ripples. From a few hundred metres up the ripples are
  filtered nearly flat.

## The changes

**The clouds' shade on the water** (`water-above.mjs`, `?watercloud=0`).
- The body is the light coming up out of the water, lit by the sun and the sky
  as the ground is. In a cloud's shade it now keeps the share of its light
  that level open ground keeps there: the sky's light and the sky-lit share of
  the sun (`shadowSky`), over the sky's and the sun's. The share is reckoned
  from the lights `main.js` sets: the sun, the sky's hemisphere light and the
  preset's environment. So the shade crosses the shoreline as deep and as cool
  as it lies on the bank.

  | Light | Sun a cloud takes at its densest | Light the body keeps there |
  |---|---|---|
  | Noon | 62% | 67% |
  | Golden hour | 55% | 85% |
  | Autumn | 60% | 90% |
  | Dawn | 45% | 97% |
  | Midnight sun | 45% | 98% |

  The kept light is luminance; the shade keeps the sky's blue, so it is
  cooler as well as darker. Under the lowest suns level ground darkens little:
  a sun that low lights it little. Slopes facing the sun and the trees darken
  more.
- The waves' relief is the sun's modelling of each facet, so it gives way
  with the sun. The foam at the shore takes the shade too.
- What the water reflects is the sky, which the cloud does not shade. The
  sparkle keeps the road pass's rule: a cloud puts it out only under a high
  sun.
- **Under a low sun, only as the eye looks down**: from 25 degrees down, in
  full from 45.
  - That is all of any Ovan frame, a desktop's corners included.
  - It is none of the water a player looks out over. From the owner's camera
    over Visby's sea the nearest water lies 22 degrees down, so from there at
    golden hour nothing changes.
  - The flyover looks down about 13 degrees along the hole (37 at the foot of
    its frame), and 26 to 33 to the pin on its sweep round the green. It takes
    a little of it at the foot of the frame and round the green.

  The clouds' shadows are laid round, where a low sun would draw them out
  along its light. Seen along the water a round shadow is a thin bar: the bars
  the road pass took off the sun's road. Under a high sun the shadows are
  round, and the water takes them at every angle, as the road does.

**The wind from above** (`?waterlanes=0`).
- As the eye looks down (the same 25 to 45 degrees), the waves' relief
  follows the patches, as the square of a patch's chop over the mean:
  1.8 times as strong in a gusty patch and half as strong in a calm one, within
  the relief's 12% cap. A gusty patch reads as ruffled water, a calm one as
  glassy. (The square alone would leave a calm patch a quarter, and seen from
  60 m it went dead flat.)
- Ruffled water scatters more of the sky to the eye, so it is a little
  lighter: by 8% of the chop's difference from the mean. At the reference wind
  that is at most 3% lighter or 4% darker.
- **Tried and dropped:**
  - Darkening the calm patches, as first proposed. At a strength that shows,
    they read as more cloud shadows: round dark blobs, since the patches are
    the cloud pattern at a smaller scale.
  - Drawing the patches out along the wind. At these scales they read as
    banding.

  The difference in texture reads as wind.
- From a low eye the patches already show in the ripples, so the body is left
  alone there. Seen along the water a gust is darker, not lighter.

## What it costs

Per water pixel, a few mixes and multiplies:
- The water read the cloud pattern once for its sparkle; the body now shares
  that read.
- The patches' chop was already computed for the ripples.

No draw call, pass or texture is added. Nothing was timed on a GPU.

## Evidence

**Unit tests** (`apps/golf/src/engine/water-above.test.mjs`):
- the share of its light the body keeps in a cloud's shade, per light: bluer
  than the sun it loses, deepest at noon, and the densest shade's light in the
  table above;
- the share reckoned from the lights as three lights level ground: all of it
  with the sun below the horizon, none with no sky light, and the environment's
  weights its sky's cosine-weighted mean;
- the patches from above: the relief's factors and the brightness's bounds;
- the range from above: all of a desktop's Ovan frame, none of the owner's
  view over Visby's sea;
- the shading draws each part, and `main.js` wires each behind its before.

`water-road.test.mjs`, `nordic-water.test.mjs` and `cloud-shadow.test.mjs`
follow the shading's shared reads; `visual-fix-switches.test.mjs` keeps both
befores display-only.

**Isolated browser check**
([`check-isolated.mjs`](graphics/water-above-2026-09-25/check-isolated.mjs),
[result](graphics/water-above-2026-09-25/isolated-check.json)). It runs in
SwiftShader, on WebGL2 and on WebGPU with reversed depth, and the two agree
within 0.0001 over 164 measures. Every read-back is drawn until two renders in
a row agree. The body's share of a pixel is read by painting the body black:
what is left is what the water reflects and the haze over it.

- **The before.** The check generates main's own water shading and road from
  git at `f182b1e8`; the modules they share are unchanged since. With both
  befores the player's water is main's, value for value, in five views:
  straight down from 490 m at golden hour and at noon, from 60 m, the owner's
  view, and noon from 40 m.
- **The shade on the water.** Straight down at golden hour (490 m), noon
  (490 m) and in autumn (270 m), with a cloud's shadow over half the water or
  more: every water pixel's body keeps exactly mix(share, 1, the sun the cloud
  leaves), and its relief gives way with the sun. What the water reflects is
  untouched. The largest error is under 0.2%, the half-float read-back's own.
- **The ground beside it.** Ground lit as the player lights it keeps, pixel by
  pixel, its own share in the same shade; without the haze it can be read
  exactly. In all five lights with clouds:

  | Light | Share the water keeps (R, G, B) | Share the ground keeps | Difference in the deepest shade |
  |---|---|---|---|
  | Noon | 0.333, 0.496, 0.644 | 0.318, 0.490, 0.598 | 0.7% in brightness, 2.8% in blue |
  | Golden hour | 0.581, 0.756, 0.927 | 0.563, 0.749, 0.904 | 0.6% |
  | Autumn | 0.759, 0.852, 0.936 | 0.743, 0.847, 0.918 | 0.5% |
  | Dawn | 0.890, 0.936, 0.964 | 0.880, 0.934, 0.952 | 0.2% |
  | Midnight sun | 0.923, 0.967, 0.996 | 0.916, 0.966, 0.994 | 0.1% |

  The ground keeps a little less, most in blue under a high sun. Its own sheen
  of the sun, white on a green with little blue, goes with the sun; the
  water's body has none, its sun being the sparkle. In the deepest shade the
  two differ by under 1% in brightness, so the shade crosses the shoreline
  without a step.
- **From a low eye.** From the owner's camera at golden hour nothing changes,
  value for value, the patches included. From 40 m at noon the body takes the
  shade too, exactly as from above.
- **The patches from above.** Straight down from 490 m, 900 m and 60 m, the
  clouds away:
  - the body's brightness follows each pixel's patch exactly as reckoned,
    from 4% darker to 2.7% lighter;
  - the relief's deviation is the old one times the square of the chop (never
    under half), within the cap, to the read-back's precision. At 490 m it
    averages 1.6% in calm patches against 7.5% in gusty ones, and at 900 m
    1.3% against 6.0%;
  - over the water as a whole the brightness moves by half a percent. From
    60 m the frame lies in one patch: here a calm one, 4% darker and glassy,
    its relief still 2.2%.

**Pictures** ([water.jpg](graphics/water-above-2026-09-25/water.jpg)), each
main and new, through the app's tone mapping at the preset's exposure:
- straight down from 490 m at golden hour and at noon, from 270 m in autumn
  and from 900 m at golden hour, the coast across the frame and a cloud's
  shadow over it;
- straight down from 60 m;
- the owner's view at golden hour, unchanged.

**App boot**
([`check-boot.mjs`](graphics/water-above-2026-09-25/check-boot.mjs),
[result](graphics/water-above-2026-09-25/boot-check.json)). The re-baked app
boots five ways on WebGL2 in SwiftShader.
- Each boot compiles every material in the scene, every water sheet included,
  in view or not.
- No page or console error occurs in any boot, so no water shader failed to
  compile.
- The tree tier audit passes in each, and the water road pass stays on.

| Boot | What the harness reads back (V3D.water) |
|---|---|
| Visby, high quality, golden hour (`det=1`) | The body's share in a full shade 0.581, 0.756, 0.927: golden hour's, reckoned with the preset's own environment, as the app lit the scene. The patches on. |
| Visby, low quality | The same: phones draw it all. |
| Visby, both befores | Neither. |
| Visby at noon | Noon's share, 0.333, 0.496, 0.644. |
| Ängsö, a lake course | Golden hour's share on its 14 lake sheets, the patches on. |

**Prepared startup data.** The source revision moved, so the following were
re-baked through the existing publishers for revision `87754b53`: tints (26),
far vista (26), scatter (26) and water (10 courses).

[`check-publication.mjs`](graphics/water-above-2026-09-25/check-publication.mjs)
compares against main's last bake at `f182b1e8`
([result](graphics/water-above-2026-09-25/publication-identity.json)). Every
tint, vista, scatter and water record keeps its content; only its source
identity changed. `check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/water-above-2026-09-25/prepared-check.json)),
and the app boot above ran on it.

**Suite.** The full `pnpm test` passes: 1,443 Vitest tests and 482 Node tests,
with 3 environment skips. The app-build isolation check,
`check:course-workflow` and the no-undef lint also pass.

## Not established

- **Pictures on the owner's GPU and phone.** Judge these against
  `?watercloud=0&waterlanes=0`:
  - the Ovan view of Visby's hole 4 and of a lake hole, with clouds, at golden
    hour and at noon;
  - a shoreline where a cloud's shadow crosses it;
  - the patches from above in the default breeze and in a strong wind.
- **Tree shadows on the water** (the third proposal). They still end at the
  water's edge. Near a lake's shore a trace of the shadowed bed shows through.
- **The clouds' shadows** stay round at a low sun, on land and water.
- **Frame time.** Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/water-above-2026-09-25/check-isolated.mjs
node docs/graphics/water-above-2026-09-25/check-boot.mjs
node docs/graphics/water-above-2026-09-25/check-publication.mjs   # after the re-bake
```
