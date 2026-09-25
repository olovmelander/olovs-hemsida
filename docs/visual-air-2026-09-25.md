# Air batch, 25 September

**Owner request, 25 September:** "Yes, start with 12, 10 and 11!" These are
the next three items of the visual audit, after
[the landscape batch](visual-landscape-2026-09-25.md):
- **12.** one wind;
- **10.** cloud shadows drifting over the course;
- **11.** valley mist at dawn and in the mist preset.

Every change keeps its before behind a URL switch. The switches keep the
prepared startup data eligible, so an A/B pair differs only in the change.
The complete before is:

`?onewind=0&cloudshadows=0&valleymist=0`

Nothing here changes geometry, placement, water or prepared data: the re-bake
refreshed source identities only. Single scenes render correctly in software,
unlike full courses, so the numbers and pictures in
[`graphics/air-2026-09-25`](graphics/air-2026-09-25) come from the real
shaders. The full scenes still need the owner's GPU.

## The changes

**12. One wind** (`one-wind.mjs`, `?onewind=0`).

Before this batch there were three winds:
- the flags answered the weather's wind (or `?vind=`, or 4 m/s from the west);
- the trees and reeds swayed on a clock of their own, along fixed axes;
- the sky's clouds drifted west at a speed each preset chose. In the default
  westerly they ran against the flags.

Now one air carries all of them. It eases toward the flags' own target wind in
about three seconds, as a vector, so a reversal passes through calm.
- **Plants.** The trees and reeds keep their drawn swing, turned onto the
  wind's axis:
  - its strength scales with the wind: a fifth of the drawn sway in calm air,
    all of it at 4 m/s, and up to 2.2 times in a gale;
  - gusts are patches about 40 m across that the air carries downwind through
    the stands, taking the plants from 0.6 to 1 of their swing and leaning
    them a little downwind;
  - the reeds' drawn swing had no gust, so it is drawn a quarter larger to keep
    its mean.
- **Sky.** The clouds drift downwind at their preset's speed, scaled by the
  wind (a quarter to three times). At 4 m/s they move and change shape at
  exactly the preset's old rate.
- **Cloud shadows** cross the ground at 1.5 times the surface wind.
- **Reduced motion** holds the air still. The trees and reeds stand, and the
  clouds and their shadows stop. The flags keep answering the wind: they are
  how a player reads it. Before this batch the trees swayed under reduced
  motion.
- **`det=1`** pins the air to the target wind and carries nothing.

The gust and cloud offsets wrap at the periods of their patterns, so a long
session loses no precision.

**10. Cloud shadows** (`cloud-shadow.mjs`, `?cloudshadows=0`).

Broad, soft shadows of fair-weather clouds cross the course in every preset
with a sun: noon, golden hour, dawn, the midnight sun and autumn. Overcast,
mist and blue hour have none.

| Preset | Ground in shade | Sun a shade takes |
|---|---|---|
| Noon | 30% | 62% |
| Golden hour | 22% | 55% |
| Dawn | 30% | 45% |
| Midnight sun | 18% | 45% |
| Autumn | 32% | 60% |

A cloud's shade is lighter than a tree's shadow. It is lightest where a low
sun is already thin.

The shade is the sun's, taken away where a cloud stands between it and the
ground, so it reaches everything the sun lights:
- **Lit surfaces.** Every lit surface takes it through the sun's own colour.
  This includes those without a shadow map (tufts, bushes, stones). Every
  shadow receiver takes it through its shadow node, which keeps the
  lighting batch's sky-lit tint: the light is
  sun × mix(tint, 1, shadow × cloud).
  - A cloud's shade is lit by the sky, as a tree's shadow is.
  - A tree's shadow fades into the cloud's shade rather than darkening again
    inside it.
- **Crowns.** The painted crowns and the impostors, far vista included, lose
  their direct light, highlight and back-light, as on their own shaded side.
  - They dim as open ground does, to the share of their light the preset
    gives them without the sun: about 0.4 at noon and 0.3 against a low golden
    sun.
  - Before this, a crown under a full cloud lost only 3–4% of its light while
    the ground round it lost 40%.
- **Water, reeds, tufts and flags.** The water's sun sparkle goes out in a
  cloud's shade. So does the light that shines through reeds, tufts and flags.

The pattern is one small tiling texture of soft cloud shapes: 256 × 256 bytes
for 4 km, repeating every 4 km. Clouds are about 700 m apart, with edges
about 50 m wide.
- It is read where the ray toward the sun meets the cloud layer. A crown
  therefore takes the pattern of the ground beside it, moved along the sun as
  far as the crown stands up, and a hillside's shade shifts as a real one does.
- It is read once per vertex, since the shapes are hundreds of metres across.
  The water reads it per pixel, where a pond's few large triangles would blur
  the edge.
- The shadow map and its on-demand renders are untouched: moving clouds
  render nothing again.

**11. Valley mist** (`aerial-perspective.mjs`, `?valleymist=0`).

At dawn and in the mist preset the air is thickest low down. Mist lies in the
hollows and over the water, and the higher ground stands out of it in soft
layers.
- **Density.** 0.0016 per metre at dawn, thinning e-fold every 6 m up. 0.0022
  in the mist preset, thinning every 9 m.
- **Base.** It starts at the course's low ground: the height below which a
  quarter of the ground along the holes' lines lies.
- **Along a ray.** What a ray from the eye loses to it has a closed form,
  reckoned per vertex.
- **Colour.** It joins the haze in the haze's own colour. So the sky's band
  under the horizon still meets it, the sunward warmth still applies, and the
  haze's ceiling (`hazeMax`) still keeps a far ridge shaded.

## What it costs

No change adds a draw or a pass, or re-renders the shadow map.

| Change | Cost |
|---|---|
| One wind | Per frame on the CPU: one easing and three running sums. Per vertex of the mesh-tier trees and the reeds: the gust patches and the phase field (eight sines together) replace the old gust and linear phase (one sine), plus the turn onto the axis. |
| Cloud shadows | One byte-texture read and a few operations per vertex on every lit or painted vertex, the far vista included. Per pixel: a mix and a divide in the sun's light, and a multiply on crowns. One texture read per pixel on the water. The texture is 64 KB. |
| Valley mist | Two exponentials, a divide and a length per vertex wherever the haze reaches. Per pixel: an add and a min. |

The cloud and mist terms run in every preset. Without clouds or mist they add
nothing to the picture, which is bit for bit the before (below). Nothing was
timed on a GPU.

## Evidence

**Unit tests** (`apps/golf/src/engine`):
- `one-wind.test.mjs`:
  - the axes of a westerly, northerly and easterly;
  - the sway against the wind;
  - easing as a vector, and a reversal through calm;
  - what is carried, and at what speed, with its offsets wrapped;
  - reduced motion and `det=1`;
  - the gust quilt's period;
  - the wiring in `main.js`;
- `cloud-shadow.test.mjs`:
  - the pattern tiles with no seam;
  - each preset's cover, hard-edged and soft;
  - shadows only with a sun, lighter than a tree's;
  - the sun under the clouds keeps the tint;
  - crowns dim as ground;
  - every consumer in `main.js`;
- `aerial-perspective.test.mjs`:
  - mist at dawn and in mist only;
  - the closed form against the plain exponential;
  - symmetry, and continuity at its branch;
  - hollow against hill;
  - the base;
  - nothing added without mist;
- `visual-fix-switches.test.mjs`: every before switch of this batch and of
  the landscape batch keeps prepared startup eligible, alone and all together.

**Isolated browser check**
([`check-isolated.mjs`](graphics/air-2026-09-25/check-isolated.mjs),
[result](graphics/air-2026-09-25/isolated-check.json),
[pictures](graphics/air-2026-09-25/clouds-and-mist.jpg)). It runs on the app's
own modules in SwiftShader, on WebGL2 and on WebGPU with reversed depth, and
the two agree to the digit.

- **Cloud shadows.** The scene has a field, a platform 40 m up, a 20 m pole
  casting a shadow, a bush with no shadow map, a row of the approved spruce's
  impostors and one Hero spruce.
  - **Clear sky.** With no cloud, every pixel is bit for bit the lighting
    batch's before.
  - **Field.** Under a cloud pattern (a sixth of the field in shade), every
    field pixel is what sun × mix(tint, 1, cloud) says: median error 0, 99th
    percentile 0.1%.
  - **Platform.** The platform matches the pattern moved along the sun for its
    40 m (0.02% error). Unmoved, the error would be 13.5%; moved the wrong way,
    19.8%.
  - **Tree shadow.** Under one cloud the pole's full shadow keeps 99.99% of its
    light. Every shadow pixel, penumbra included, is within 0.02% of
    sun × mix(tint, 1, shadow × cloud). The shadow's contrast with the ground
    round it softens from 0.36 to 0.59, and that ground dims to 0.587.
  - **Bush.** The bush dims as the ground does (99th percentile error 0.01%).
  - **Crowns.** The impostors dim to 0.606 and the Hero crown to 0.596.
- **One wind.** The page places 66 markers, moves them by the sway with a held
  swing, and reads them back from above at 0.2 m a pixel. In every case each
  marker lies within 0.14 m of where the wind's axis, side, strength and
  carried gust put it:
  - a westerly;
  - a northerly with the gusts carried 39 m;
  - a north-westerly gale;
  - the across-wind swing;
  - no wind strength: every marker stays at rest.
- **Sky.** A drift of 0.02 moves the clouds round the zenith 5.88 px, where the
  cloud plane predicts 5.93: east for a westerly and south for a northerly.
- **Valley mist.**
  - **No mist.** A preset without mist leaves the haze bit for bit as it was.
  - **Dawn.** Over a valley 30 m deep, every ground pixel takes the closed
    form's mist: median error 0, and 0.0001 at the 99th percentile together
    with the haze.
  - **Floor and slopes.** At 400 m the floor takes 7.0% and the slopes 0.2%.

**App boot**
([`check-boot.mjs`](graphics/air-2026-09-25/check-boot.mjs),
[result](graphics/air-2026-09-25/boot-check.json)): pending.

**Tree shadow proof** (`tools/check-tree-shadows.mjs --ref 4ae4c594`,
[summary](graphics/air-2026-09-25/tree-shadows.json)): passes on WebGL2 in
SwiftShader, with main as the reference.
- The crown shadows are those of main in all 100 cases.
- The mesh and impostor shadows agree as before (80 cases).
- The crossfades are as before.
- The crowns' and impostors' colour passes, which take no cloud there, are
  main's pixel for pixel: 6.6 million covered pixels, none differing.

**Prepared startup data.** The source revision moved, so the following were
re-baked through the existing publishers: tints (26), far vista (26), scatter
(26) and water (10 courses). The re-bake is pending.

**Suite.** Pending.

## Not established

- **Pictures of full courses.** Judge these on the owner's GPU and phone,
  against the before switches:
  - cloud shadows crossing fairways, woods and water at noon and in autumn;
  - trees in a real gale (`?vind=270,12`);
  - dawn over a course with hollows and water (Lidingö, Johannesberg).
- **Frame time.** See "What it costs". Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering.
- **Water waves.** The water's ripples still scroll on their own. They are
  left for the Nordic water item (9), which rewrites them.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/air-2026-09-25/check-isolated.mjs
node docs/graphics/air-2026-09-25/check-boot.mjs
node tools/check-tree-shadows.mjs --ref 4ae4c594
node docs/graphics/air-2026-09-25/check-publication.mjs   # after the re-bake
```
