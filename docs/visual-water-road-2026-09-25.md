# Water road pass, 25 September

**Owner request, 25 September**, with a phone screenshot of Visby's hole 4 over
the sea at golden hour:

> "I dont think the sun reflection on the water looks as good as it did, it
> feels uneven. And at some angles the water and look can be improved. So lets
> make the water more visually stunning and perfect."

This follows [the water batch](visual-water-2026-09-25.md) and
[the buildings batch](visual-buildings-2026-09-25.md), and changes the water
batch's road.

Every change keeps its before behind a URL switch. The switches keep the
prepared startup data eligible, so an A/B pair differs only in the change.
The complete before is:

`?waterroad=0&watermirror=0&waterrelief=0&opensea=0`

- `waterroad=0` restores the water batch's road: its dabs giving way to their
  expectation, cut by the clouds.
- `watermirror=0` keeps the water's reflection at 0.42 of the sky in every
  direction.
- `waterrelief=0` keeps the body one flat colour under the ripples.
- `opensea=0` gives the open sea the lakes' far shore again.

Nothing here changes geometry, placement or prepared data: the re-bake
refreshed source identities only.

## What made the road uneven

An isolated page draws the player's own water, sky, haze, cloud shadows, wind
patches and tone mapping over an open sea as Visby's is drawn. The camera is the
player's: 48 degrees, portrait, 180 m up, with the coast 450 m ahead and the
sun ahead ([study](graphics/water-road-2026-09-25/isolated.html)). Taking one
part out at a time:

- **The road had lost its sparkle.** Past 120-450 m the water batch gave the
  dabs way to their expectation, a smooth glow the width of the ripples' spread
  of slopes. From the owner's camera that is the whole road, and it read as a
  wide, dull smear.
- **The clouds' shadows cut it into bars.** The pattern is laid straight down,
  round. A shadow cast by a 9-degree sun would be drawn out six times along its
  light. Seen along the road at a few degrees, each shadow crossed it as a thin
  bar. Measured row by row from the coast to the horizon, main's road dips to
  52% of the rows around it in 15 rows.
- **The wind's calm and gusty patches** narrow and widen the road near the eye.
  From the owner's camera they matter little, and they read as natural.
- **The open sea mirrored a far shore.** Visby's sea is drawn with the lakes'
  shading, so it took the lakes' dark wood along its whole horizon. It showed as
  a dark band under the horizon from every low camera.
- **The water toward a low sun was mauve.** The sky's amber glow was mixed at
  0.42 into blue water, and the two cancelled to grey.

The water batch replaced the far dabs to keep them from thinning to a flicker.
They do not flicker: past 800 m they are as steady as the glow was, whether the
ripples drift on the wind or the camera flies (below).

## The changes

**The sun's road, sparkling to the horizon** (`water-road.mjs`,
`?waterroad=0`).
- **The dabs at every distance.** Wherever a ripple faces the sun it shines, as
  the water always drew it near. It keeps the water batch's colour, the sun's
  own: warm at golden hour and nearly white at noon. Far off, the ripples'
  finest chop is filtered away, and the road draws together into a bright
  column.
- **Brighter toward grazing.** Water reflects more of the sun the lower the eye
  looks across it (Schlick's reflectance):
  - the road keeps its dabs' brightness where the sun meets the water at 70
    degrees or more steeply;
  - it rises to 2.5 times by 79 degrees, so a low sun's road blazes toward the
    horizon;
  - it never dims, so the glitter under a high sun keeps its brightness.
- **Clouds only under a high sun.** A cloud's shade puts out the road where the
  sun stands over 35 degrees, as it always did. Below 15 degrees it does not.
  Golden hour, dawn, the midnight sun and autumn are all below 15 degrees.

**The warm mirror** (`?watermirror=0`). Toward a low sun, the water mirrors
more of its glowing sky. Inside the sun glow's own lobe, the reflection's share
rises from 0.42 to 0.7. So the road lies in warm water, not in mauve.

**The waves from above** (`?waterrelief=0`). Looked down on, as the overviews
look at 25-45 degrees, the water was one flat blue. Its ripples live in the
reflection, and a steep look reflects 3.5% of the sky. Now the body takes the
ripples' relief, as a painter shows waves from above:
- a facet tilted toward the sun is lighter, one tilted away darker;
- by up to 12% either way, as the sun is direct, and none under an overcast or
  a set sun;
- it fades far off with the ripples themselves.

**The open sea** (`?opensea=0`). The sea's sheets are drawn as open sea, with
no far shore: its rings, the coastal extension to the horizon and the legacy
horizon sheet. The lakes keep their wood. The ocean sheets of Lidingö and
Norrfällsviken never had it.

## What it costs

Per water pixel:
- the road: a power and a clamp, in place of the water batch's expectation (a
  normalize, a square root and a smoothstep), which it drops;
- the mirror: a mix;
- the relief: a normalize and a few operations.

No draw call, pass or texture is added. One more water material is compiled on
a course with a sea (the open sea's), and it shares its sheets' draw calls.
Nothing was timed on a GPU.

## Evidence

**Unit tests** (`apps/golf/src/engine/water-road.test.mjs`):
- the road's grazing factor: 1 at 70 degrees and steeper, rising, 2.5 from 79;
- the clouds' share of the road: none under golden hour's, dawn's, the midnight
  sun's and autumn's suns, all of it at noon;
- the mirror's shares, and the relief's strength per light: in full under a
  sun, a quarter in the storm, a fifth in the mist, next to none at blue hour;
- the shading draws each part, and `main.js` wires each behind its before and
  every sea sheet as open sea.

`nordic-water.test.mjs` follows the shading's new flags;
`visual-fix-switches.test.mjs` keeps all four befores display-only.

**Isolated browser check**
([`check-isolated.mjs`](graphics/water-road-2026-09-25/check-isolated.mjs),
[result](graphics/water-road-2026-09-25/isolated-check.json)). It runs in
SwiftShader, on WebGL2 and on WebGPU with reversed depth, and the two agree
within 0.005 in every measure. Every read-back is drawn until two renders in a
row agree.

- **The before.** The check generates main's own water shading from git at
  `b7619256`; the modules it shares are unchanged since. With all four befores
  the player's water is main's, value for value, in four views: the owner's,
  from 3 m, noon from above, and 45 degrees down.
- **The owner's road.** Golden hour, 180 m up, the coast 450 m ahead, the
  clouds as they fall:
  - Row by row from the coast to the horizon, the road never dips below 83% of
    the rows around it. Main's dips to 52%, in 15 rows.
  - With the clouds or without them, the road is identical: a low sun's clouds
    leave it alone.
- **Brighter toward grazing, glint for glint.** Against the dabs as they were
  before the water batch, the same ripples in their near-white, each of 27,000
  glints is brighter by the road's grazing factor at the angle its pixel is seen
  at (1.0 to 2.5, median 2.1), times the sun's colour. The median error is under
  0.0005: the haze and the ripples cancel in the ratio.
- **Under a high sun a cloud's shade puts the glitter out.** At noon from
  above, with a shadow's edge laid across the glitter (half of its 113,000
  pixels shaded), each glinting pixel keeps exactly the share of the sun the
  cloud pattern leaves it.
- **The open sea.** From 3 m, only the sea's reflected horizon changes, from
  33 m out, and only lighter: by up to 0.28, where the lakes' wood had stood.
- **The mirror.** Toward the golden-hour sun from 40 m, the sea's red over blue
  rises from 1.12 to 1.44. Away from the sun nothing changes.
- **The relief.**
  - Looked down on at 45 degrees, each pixel against its neighbours differs 13
    times as much as the flat blue did (0.019 against 0.0014).
  - In an overview 250 m up, it shows within 600 m. Past 1.5 km it adds
    nothing: the ripples are filtered flat there.
  - At blue hour it adds under a tenth of that.
- **Steady far off.** Frames 1/30 s apart, the ripples on a 4 m/s westerly and
  the camera flying at 21 m/s. Past 800 m the road's frame-to-frame change is
  0.2% of its brightness, as main's glow's is, and nothing past 2 km. Nearer,
  its glints move with the camera, as glitter does (4.7%, against the glow's
  2.1%).

**Pictures** ([water.jpg](graphics/water-road-2026-09-25/water.jpg)), each main
and new, through the app's tone mapping at the preset's exposure:
- the owner's view at golden hour and in autumn;
- golden hour from 3 m;
- the midnight sun from 40 m;
- autumn 45 degrees down;
- the owner's view with the desktop's glow.

**App boot**
([`check-boot.mjs`](graphics/water-road-2026-09-25/check-boot.mjs),
[result](graphics/water-road-2026-09-25/boot-check.json)). The re-baked app
boots five ways on WebGL2 in SwiftShader.
- Each boot compiles every material in the scene, every water sheet included,
  in view or not.
- No page or console error occurs in any boot, so no water shader failed to
  compile.
- The tree tier audit passes in each.

| Boot | What the harness reads back (V3D.water) |
|---|---|
| Visby, high quality, golden hour (`det=1`) | The road, the mirror and the relief (in full) on. 8 sheets drawn as open sea (the sea's rings and the extension to the horizon), 33 as lakes and ponds. |
| Visby, low quality | The same: phones draw it all. |
| Visby, all four befores | None of it: all 41 sheets drawn as lakes, as on main. |
| Visby in a storm | The relief at 0.25, under the storm's weak sun. |
| Ängsö, a lake course | No open sea to draw: its 14 sheets are lakes. |

**Prepared startup data.** The source revision moved, so the following were
re-baked through the existing publishers for revision `3d551f81`: tints (26),
far vista (26), scatter (26) and water (10 courses).

[`check-publication.mjs`](graphics/water-road-2026-09-25/check-publication.mjs)
compares against this branch's last bake at `ca55f629`
([result](graphics/water-road-2026-09-25/publication-identity.json)). Every
tint, vista, scatter and water record keeps its content; only its source
identity changed. `check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/water-road-2026-09-25/prepared-check.json)),
and the app boot above ran on it.

**Suite.** The full `pnpm test` passes: 1,438 Vitest tests and 482 Node tests,
with 3 environment skips. The app-build isolation check,
`check:course-workflow` and the no-undef lint also pass.

## Not established

- **Pictures on the owner's GPU and phone.** Judge these against
  `?waterroad=0&watermirror=0&waterrelief=0&opensea=0`:
  - Visby's hole 4 at golden hour, as in the screenshot;
  - the road from the tee at a lake, and from the flyover;
  - the desktop glow on the road at golden hour: turn the grazing cap down if
    it flares;
  - the relief in the overviews.
- **The clouds' shadows on land** stay round at a low sun. Drawing them out
  along the light would be the physical fix. It would change the land too, so
  it was left.
- **Frame time.** Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/water-road-2026-09-25/check-isolated.mjs
node docs/graphics/water-road-2026-09-25/check-boot.mjs
node docs/graphics/water-road-2026-09-25/check-publication.mjs   # after the re-bake
```
