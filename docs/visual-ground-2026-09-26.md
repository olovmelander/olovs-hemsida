# The ground, 26 September

**Owner request, 26 September.** "I want to dig in to and audit the ground
material, grass, mud, stones, tuft, high grass and other things connected to
the ground and the terrain." The audit ranked eight bugs first, hurting the
look today, and the owner answered:

> "Go with the ground bug batch"

This follows [the clouds](visual-clouds-2026-09-26.md).

Eight fixes, each behind a before switch:
- **`?groundedges=0`**: the ground's class edges, measured across each edge.
- **`?stripereach=0`**: the mowing stripes fade out before their coordinate
  runs out.
- **`?hardground=0`**: paths, roads, gravel, soil, rock and mud lie at ground
  level, and mud is hard ground rather than turf.
- **`?coverlight=0`**: tussocks, the mown edge's clumps and reeds lit on the
  side that is seen.
- **`?covershadow=0`**: every piece of ground cover in the trees' shadows.
- **`?covercolour=0`**: the cover's colours where they were tuned, in the
  light's grass strength and autumn's ochre, and a reviewed ground's stone.
- **`?coverseat=0`**: stones and bushes seated on the lowest ground under them.
- **`?reedlakes=0`**: reeds at every lake and pond, each at its own level.

And `?surfaceRelief=1`, a pilot the painted finish never read, no longer
switches off prepared startup data.

Every switch but `?reedlakes=0` keeps the prepared startup data eligible, so an
A/B pair differs only in the fix. `?reedlakes=0` moves plantings: it plants the
reeds live, with every other prepared path off. The re-bake changed the prepared
scatter's reeds and nothing else (Evidence).

## The ground's class edges

**What was wrong.** Each class of ground (fairway, green, sand, path, rough...)
fades into its neighbours over a ramp, so an edge is smooth rather than jagged.
The ramp's half-width was the pixel's whole footprint on the ground
(`fwidth(wp).length()`, `ground-material-core.mjs`), and seen low that is tens
of metres deep down the view, however few centimetres it spans across it. Two
things followed:
- **The far ground took every colour.** Each class's distance field reaches
  ±4 m. Past about 120 m from the tee the ramp grew wider than that, so every
  class's ramp still stood above zero at its saturated -4 m. Every class then
  lent all the ground beyond a share of its colour: 26-29% each at 200 m, sand,
  asphalt and green alike. The far part of the course turned a pale wash.
- **Edges running away from the eye were smeared.** A fairway's side seen from
  its tee blended over 2.6 pixels either side of the line at 60 m, 6 at 150 m
  and 16 at 400 m.

**Now.** Each edge is measured by the pixel ACROSS it: the field's own change
over the pixel (`fwidth` of each class's distance), which is the whole
footprint only where the edge runs across the view. It is never wider than the
before's width, nor than 3 m, inside the fields' reach, so a class takes no
share of ground where its field has saturated. The contact line, the damp bank,
a bunker's rake and lip, and a path's grown edges fade by the same pixel across
their own edge.

The fields are exact distances, sloped 1 across their edges in every texel, so
the step a bilinear slope takes at a texel border is a sliver of the width, and
near the camera the 3 cm floor holds the width anyway. That step is why the
before used the world position's footprint.

**A limit that stays.** The distance fields are mipmapped the same way in every
direction, so seen low and far, a feature narrower than the mip's texel (a
3 m path, a small bunker, from about 200 m) averages away into the rough beside
it. The before smeared such features into a faint wash along with every other
class; now they fade out. Sampling the fields anisotropically would keep them.
That costs extra texture taps at a grazing angle, which should be timed on a GPU
first.

## The stripes' reach

**What was wrong.** A fairway's passes are laid off a signed distance across
the hole, stored in one byte at 0.25 m a step: ±31.75 m (`atlas.js`
`mowLateralBytes`). Past that the byte saturates, and the pass held one flat
tone: a whole stripe's light or dark laid over the rest of a wider fairway.
The same held over any fairway no hole's line reached.

**Now.** The fairway's and semi's passes fade to the turf's own tone over the
last four metres before the byte runs out. Within 27.75 m of the line they are
the before's.

## The hard ground

**What was wrong.**
- **A contact line on the paths.** The contact line draws a thin shade where a
  taller cut stands over a shorter one. Every class missing from its height
  table stood 30 mm, every hard surface among them, so a path beside a fairway,
  green or tee took the shade of a cut standing over the grass.
- **Mud as turf.** Mud took the turf's finish: its yellow-green lift in the sun,
  its meadow blotches at full strength, and the grass's sheen.

**Now.** Paths, roads, gravel, soil, rock and mud stand at 0 mm under the
contact line. Mud is hard ground, finished as the soil beside it is. A bunker
still sits 25 mm under everything round it, so its lip keeps its shade on a
path too.

## The ground cover's light

**What was wrong.** A tussock, a clump at the mown edge and a reed are
triangles drawn from both sides. Three turns a back face's normal round, and
its tilt toward the sky goes with it, so every blade seen from behind its front
face was lit as ground facing down. The tussocks' and reeds' normals also lay
behind their front faces. So on both faces the normal pointed away from the
eye, and the cover went dark with the sun at the viewer's back.

**Now** (`ground-cover.mjs` `seenBladeNormal`): a blade is lit by the tilt it
was given, always toward the sky, with its sideways facing turned to the side
that is seen. The tussocks' and reeds' normals now lie on their front faces;
the clumps' already did.

## The ground cover in the trees' shadows

**What was wrong.** No ground cover received shadows: tussocks, the mown edge's
clumps, bushes, stones, stumps and reeds stayed sunlit inside a tree's shadow.
It showed most at golden hour, when shadows are long.

**Now** they receive them, taking the same sky-coloured shade the ground does.
Bushes and stones already cast shadows and now receive their own. The sun's
normal bias (0.22 m) keeps their faces clean.

## The ground cover's colours

**What was wrong.**
- **Mustard tussocks.** The tussocks', bushes' and clumps' colours mix along a
  smooth channel of the ground's detail texture. They were chosen by eye while
  that texture went through a 2D canvas (until 24 September). The canvas's
  premultiplied alpha cleared a third of its texels and crushed the rest: its
  blue channel averaged 0.303 where the texture holds 0.471, its green 0.334
  against 0.513. Since the upload was fixed, every tussock went mustard.
- **Out of step with the rough.** Dag and Sommar hold the ground's grass at
  0.85-0.87 of its strength, and Höst turns the rough ochre. The cover took
  neither, so the fringe along the mown edge stayed green in autumn.
- **One stone colour everywhere.** Stones were one blue-grey on every course.
  Johannesberg's reviewed rock colour, from its photographs, was ignored.

**Now:**
- **The tuned share.** The mixes take 0.65 of the channel
  (`COVER_TUNED_SHARE`), which puts their mean back where it was tuned, now
  without the speckle.
- **The rough's grass terms.** Tussocks and clumps take the rough's grass terms
  (`grassCover`): the light's grass strength, and autumn's ochre, the same
  constant the ground uses (`SEASON_OCHRE`).
- **The reviewed stone.** A ground with a reviewed rock colour gives it to its
  stones. Johannesberg's is `#77776b`; elsewhere the painted stone stays.

## Stones and bushes seated

**What was wrong.** A stone or bush was set at the height of its centre. The
big stones stand on the steepest ground (their odds climb with the slope), so
the downhill side of a boulder two metres across hung in the air.

**Now** (`seatHeight`): each is set on the lowest of its centre and six points
round its rim, keeping the sink it was given at its centre. This is done where
the instances are placed, from the planted positions, so the prepared scatter's
records are unchanged.

## Reeds at every lake and pond

**What was wrong.** The reed scan took the first lake the pack lists and held
every candidate to its level. Reeds fringed that lake, and any other water whose
shore happened to lie at its height (a river at its mouth, a ditch beside it),
and nothing else. Puttom's lakes stand at 51, 61, 63 and 67 m, so only the
first, at 67 m, had reeds; every pond at another height had none.

**Now** (`reedWaterAt`): the first lake's rule stands, so every reed that stood
still stands. Beside it, a reed also stands where the ground lies at the level
of a lake or pond within 15 m of it, the reach of the scan's own shore field:
from 0.22 m below its level to 0.2 m above on a shore, and down to 0.42 m below
in a silt flat's bed. Lakes, ponds and the surroundings' water count. Streams,
whose level runs with them, do not, nor does the sea, whose open shores have
none. A course still plants reeds only if it has a lake, as before.

**Dropped on the way:** holding each candidate to the level of the water beside
it alone. That lost the reeds the first lake's level had planted by other water
at its height, or by a stream: 28% of Ribbingsfors's and 2% of Ängsö's.

## What it costs

- **The ground:** one `fwidth` per class channel per ground pixel and a few
  operations. No texture read, pass or draw is added.
- **The cover's light:** the blade normal is a handful of operations per blade
  pixel.
- **The cover's shadows:** one shadow-map lookup per cover pixel, as every
  other receiver takes.
- **Seating:** six height samples per stone and bush, once at load.
- **Reeds:** the new level test runs only where the first lake's fails.
  Planted live, Ängsö's reed scan took 406 ms against the old rule's 421 ms, in
  software rendering. From prepared data, which every published course uses, the
  planting is replayed.

Nothing was timed on a GPU.

## Evidence

**Unit tests.**
- `ground-edges.test.mjs`: the edges seen from the tee, at real pixels of the
  app's tee camera (as `mow-fade.test.mjs` measures the stripes), on a phone in
  portrait and at 1080p:
  - the before lent every class more than 10% of the ground at 150 m, 25% at
    200 m and 35% at 300 m, and nothing short of 90 m; now nothing, in every
    direction;
  - on an edge running down the view the before's ramp reached more than 2.5
    pixels either side at 60 m, 6 at 150 m and 10 at 250 m; now at most 0.7;
  - now is never wider than the before, nor past 3 m, nor under 3 cm;
  - the stripes held a whole stripe's tone at ±31.75 m, and now none, with the
    passes untouched within 27 m;
  - the hard ground stands at 0 mm where it stood 30, mud counts as hard, and
    the material builds either way and reports what it drew;
  - the shader and `main.js` wiring, and the before's graph.
- `ground-cover.test.mjs`:
  - **The blades.** Before, on both faces a tussock's or reed's normal pointed
    away from the eye, and every blade seen from behind had its tilt down. The
    fix puts the normals on the front face, and the rule lights the seen side
    from both faces, tilted up.
  - **The colours.** The canvas upload is simulated over the whole texture: it
    cleared 35% of the texels, and left 0.65 of the green channel's mean and
    0.64 of the blue's (`COVER_TUNED_SHARE`). The grass terms and the ground's
    autumn are one constant (`SEASON_OCHRE`), and the reviewed stone is wired.
  - **Seating** on level ground, a slope and a hollow.
  - **Reeds.** Each water at its own level; the reach; a pond; none by a
    stream, on the sea's shore or on excluded water; and the first lake's rule
    kept in `main.js`.
  - The shadow, colour and seat wiring.
- `visual-fix-switches.test.mjs`: the seven drawn befores keep every prepared
  startup path eligible, alone and together; `?reedlakes=0` plants live;
  `?surfaceRelief=1` keeps prepared startup.

**Isolated browser measures**
([`check-isolated.mjs`](graphics/ground-2026-09-26/check-isolated.mjs), on
[the study page](graphics/ground-2026-09-26/isolated.html); results in
[`isolated-check.json`](graphics/ground-2026-09-26/isolated-check.json)). The
page draws a par 4 on the app's own exact-edge atlas and ground material, and
ground cover built from the app's own blades with `main.js`'s materials. Main's
ground material, generated from git at `4170051d`, is drawn in the same page.
The whole check passed on WebGL2 and on WebGPU with reversed depth, both in
SwiftShader; linear colour throughout.
- **The before is main's.** With `?groundedges=0`, `?stripereach=0` and
  `?hardground=0` the ground is main's, pixel for pixel, in six views: from the
  tee at noon and golden hour, from the tee in the classes' colours, the wide
  fairway from above, beside the path and over the mud.
- **The far rough.** In the app's hole view (41 m up, 74 m behind the tee), take
  the pixels past 150 m whose whole footprint lies beyond every class's 4 m
  reach. Main's read as rough in 41% (off by 0.028 on average); now's in 100%
  (0.0002).
- **Edges down the view.** Pixels of blend between 10% and 90% across a
  fairway's side, at 150, 175 and 320 m: main 13, 8 and 9; now 2, 2 and 2 (3,
  2 and 2 on WebGPU).
- **The stripes' reach.** Seen from above, past 32.5 m from the line main's
  passes hold one tone, a mean amplitude of 0.061; now's are 0.004, a residue
  the page leaves between two renders after its other views (0 when the stripes
  are drawn first). Within 26 m of the line they are main's, to the half float's
  last bit.
- **The hard ground.** Beside the path, the path's edge band against its middle
  goes from 0.791 to 0.815: the contact line is gone. The rest of the dip is the
  grass grown in at its edges. Nothing else in view moves beyond the half
  float's last bit. The mud turns a little bluer for its red (blue over red 0.423
  to 0.430) as the turf's warm lift leaves it.
- **The cover's light.** With a low sun behind the eye, the mean luminance of:

  | | Main | The light alone | All the batch |
  |---|---|---|---|
  | Tussocks | 0.059 | 0.183 | 0.157 |
  | The mown edge's clumps | 0.094 | 0.119 | 0.113 |
  | Reeds | 0.028 | 0.118 | 0.118 |

  With all the batch the colours are the tuned ones, a little darker.
- **The cover's shadows.** A block's shadow darkens 41% of the tussocks where it
  falls; main's none.
- **The cover's colours.** The tussocks' red over green is 0.889 as they were
  tuned (the detail texture through the canvas), 1.004 on main (mustard), and
  0.893 now. In autumn the clumps' red over green goes from 0.525 to 0.621.
- **The backends agree** on all 75 measures, and every read-back settled.

**The pictures** ([`ground.jpg`](graphics/ground-2026-09-26/ground.jpg)) are
main beside the batch through the app's tone mapping: the hole view at golden
hour and noon and in the classes' colours; golden hour from the tee; the wide
fairway from above; and the cover at golden hour with the sun behind, under a
shadow, and in autumn.

**The app boot**
([`check-boot.mjs`](graphics/ground-2026-09-26/check-boot.mjs), results in
[`boot-check.json`](graphics/ground-2026-09-26/boot-check.json)). The re-baked app
booted 10 times on WebGL2 in SwiftShader, and every boot passed. Each compiled
every material in the scene with no page or console error, and the tree tiers
audited clean.
- **Ängsö, golden hour, high and low quality.** The ground material was built
  with all three of its fixes. Every cover population receives shadows, and the
  tussocks, clumps and reeds take the seen side's normal. The prepared scatter
  replayed all three sections, and its reeds are the re-bake's exactly: 14,136
  and 7,169.
- **Stones and bushes seated.** 2,531 of Ängsö's 2,931 bushes and 512 of its 652
  stones were lowered, by up to 0.73 m and 0.28 m. On the steepest ground the
  drop is largest: Johannesberg's deepest stone 2.4 m, Veckefjärden's 1.95 m and
  a bush 1.66 m. There a boulder sinks into the slope as an outcrop, where it
  hung in the air.
- **Every drawn before at once:** main's ground and cover, still replayed from
  prepared startup data.
- **`?reedlakes=0`:** planted live, and exactly main's reeds (14,069, the count
  in main's own prepared scatter). With `?prepscatter=0` the batch's reeds,
  planted live, are exactly the re-bake's 14,136. The reed scan took 406 ms
  where the old rule's took 421 ms; replayed from prepared data, 26-33 ms.
- **`?surfaceRelief=1`:** prepared startup data kept.
- **Johannesberg:** its stones in its reviewed rock colour, `#77776b`; every
  other course's in the painted stone.
- **Puttom and Veckefjärden:** their reeds replayed from the re-bake: 4,305 and
  3,132.
- **Visby:** no ground cover (measured vegetation only), and the ground's edges
  drawn across.

**The publication proof**
([`check-publication.mjs`](graphics/ground-2026-09-26/check-publication.mjs),
results in [`publication-identity.json`](graphics/ground-2026-09-26/publication-identity.json)).
The re-bake is checked against main's catalogue at `4170051d`, for all 13
courses and both qualities:
- Every source identity is refreshed, and every other catalogue field is
  unchanged.
- Every tint, vista and water payload keeps its content.
- Every scatter keeps its cover and mown-edge sections bit for bit.
- The reeds section keeps every reed that stood and only gains new ones:

  | Course | Reeds before | Now |
  |---|---|---|
  | Ängsö | 14,069 | 14,136 |
  | Puttom | 496 | 4,305 |
  | Johannesberg | 348 | 1,848 |
  | Johannesberg 9 | 348 | 1,685 |
  | Veckefjärden | 2,962 | 3,132 |
  | Veckefjärden Korthålsbanan | 3,007 | 3,301 |
  | Ribbingsfors | 3,965 | 4,065 |

  At high quality. Norrfallsviken's only lake-flagged water is its sea, and
  Upsala's courses have ponds and no lake, so they plant no reeds, as before.
  Visby, Tortuna and Lidingö plant nothing (measured vegetation only).
  Puttom's and Johannesberg's ponds take most of the new reeds.

The gate (`check-prepared-startup`) passed on the re-baked build
([`prepared-check.json`](graphics/ground-2026-09-26/prepared-check.json)).

## Not established

- **Pictures on the owner's GPU and phone.** Judge each against its before:
  - from the tee and the hole view, against `?groundedges=0`: the far course
    (no pale wash), the fairway's sides, and far paths and bunkers;
  - a wide fairway from above, against `?stripereach=0`;
  - the ground cover at golden hour with the sun behind you and among trees'
    shadows, against `?coverlight=0` and `?covershadow=0`;
  - the tussocks at noon and the mown edge's fringe in Höst, against
    `?covercolour=0`;
  - stones on a slope, against `?coverseat=0`;
  - Puttom's lakes and every course's ponds, against `?reedlakes=0`.
- **Frame time.** Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering; the isolated check covers
  WebGPU.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/ground-2026-09-26/check-isolated.mjs
node docs/graphics/ground-2026-09-26/check-boot.mjs        # after the re-bake
node docs/graphics/ground-2026-09-26/check-publication.mjs # after the re-bake
```
