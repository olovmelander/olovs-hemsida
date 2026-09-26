# The wild cover, 26 September

**Owner request, 26 September.** Once the grass round the ball had merged, the
owner asked what to do next. The recommendation was the ground audit's last
item, ground cover on the grounds whose vegetation is measured only, if the
owner accepted invented small cover there; otherwise the woods' floor and
summer flowers. The owner answered:

> "Continue with whats recommended"

The runbook says renderer detail "cannot silently introduce inferred furniture,
ground clutter or graded road embankments on a measured-only ground"
([the course runbook](v2-course-runbook.md)). The answer did not accept invented
cover there, so this batch is the other item: the woods' floor and summer
flowers, on the grounds that already grow ground cover. Visby, Tortuna and
Lidingö are unchanged. Their cover waits for the owner's word.

It follows [the grass round the ball](visual-near-grass-2026-09-26.md).
**`?forestfloor=0`** and **`?wildflowers=0`** are the befores. With either, that
part is not built, and every prepared startup path stays eligible (Evidence).

## What was wrong

What stood on the ground was tussocks, bushes, stones and stumps in the rough,
the fringe's clumps at the mown edge, reeds by the water, and the grass round
the ball. Two places had nothing:
- **The woods' floor.** The ground cover gives the forest floor to the trees
  (`forest` over 0.55, `main.js`). Under every stand, the floor was bare paint.
- **The rough in flower.** A Swedish rough in summer is full of flowers. This
  one had none.

## What it is

`wild-cover.mjs` plants both from plantings that already stand: the trees, the
tussocks and the fringe. Each plant is a hash of where its planting stands, so:
- the prepared scatter's records are untouched;
- the same plants grow on every run and every device of a quality.

### The woods' floor

- **Where.** Under each tree within 300 m of a hole's line, the tree LOD's
  zones A and B:
  - four candidates a tree within 90 m of a line, 1.6 within 300 m;
  - each from a fifth of the tree's crown radius out to nearly its edge.

  A candidate grows only on the forest floor, where the ground cover stops
  (`classify` gives forest over 0.55). Nothing grows on a path, on mown
  ground, on sand or wet ground, or in water (the tussocks' water rule).
- **What.** Blueberry scrub, a low dome of eighteen leaves, 0.7-1.3 m across
  and 0.25-0.6 m tall. Ferns, six fronds arching out and drooping, 1.2-2 m
  across and 0.35-0.8 m tall. The tree's species decides the mix:

  | under | scrub | ferns | bare |
  | --- | --- | --- | --- |
  | pine | 72% | 8% | 20% |
  | spruce | 50% | 12% | 38% |
  | birch | 38% | 42% | 20% |
  | alder | 28% | 52% | 20% |
  | oak | 42% | 30% | 28% |

- **Colour.** A shrub is darker at the dome's heart and lighter at its outer
  leaves, and each has its own shade through the ground's detail texture (at
  `COVER_TUNED_SHARE`). A fern is lighter toward its tips, and a low sun comes
  through them as it does through the tussocks. In Höst the scrub turns red and
  the ferns rust.
- **Light.** Lit on the side that is seen (`seenBladeNormal`), in the trees'
  shadows and the clouds'. They cast no shadow of their own.
- **Wind.** The ferns lift and fall on the one wind, the tips most. The scrub
  stands.

### The summer flowers

- **Where.** Beside the rough's tussocks and the fringe's clumps. Round a
  planting stands a patch of up to four clumps, 0.35-2.6 m from it:
  - the first at the drift's odds: 0.7 beside a tussock, 0.16 along the fringe;
  - each further one at 0.72 of the last one's odds.

  A clump stands only where a tussock could: off the mown ground, the paths and
  the woods, and out of the water, by the ground cover's own rules.
- **Drifts.** How thickly they stand follows a noise 38 m across. Each drift is
  one kind, from a noise 55 m across:

  | kind | | head | share |
  | --- | --- | --- | --- |
  | ox-eye daisy | prästkrage | white, yellow eye | 30% |
  | buttercup | smörblomma | yellow | 24% |
  | harebell | blåklocka | blue-violet | 16% |
  | red clover | rödklöver | pink-red | 16% |
  | lady's bedstraw | gulmåra | pale yellow | 14% |

- **Shape.** A clump is seven stems, 0.33-0.5 m across and 0.27-0.57 m tall.
  Each head is a diamond that turns to face the eye, so it reads from every side
  and from above, with its eye in the middle. A stem is lit as a blade and takes the
  rough's grass colour (`grassCover`). A head faces the sky.
- **Wind.** They sway on the one wind.
- **Höst.** They are gone: every flower tile is left out, and the shader
  shrinks them to their roots besides.

### Drawn in tiles

Each kind is drawn in square tiles, one instanced draw a tile. A tile is culled
by the eye's frustum, and left out while its nearest plant is past the kind's
fade. Each plant shrinks to its root between two distances from the eye, before
it is a pixel or two. Each takes its own point in that band, so they thin out
rather than vanish together.

| kind | shrinks away | tile | triangles |
| --- | --- | --- | --- |
| scrub | 220-320 m | 256 m | 18 |
| ferns | 140-220 m | 256 m | 18 |
| flowers | 38-66 m | 128 m | 21 a clump |

At low quality (every phone) half the floor grows under each tree. The flowers
follow the tussocks, which the ground cover already halves there.

**Compiled with the opening view.** The opening preparation compiles the scene
against the opening camera, and three culls by its frustum. A kind with no tile
in the opening view would have compiled its material the first time one came
into view: a one-off stutter, walking into a wood or over the rough. One tile of
each kind is left unculled while the opening view compiles, as the grass round
the ball is shown for it.

## Where it grows

It is gated as the ground cover is. A measured-only vegetation ground draws what
it measured and nothing invented, so Visby, Tortuna and Lidingö have no wild
cover.

What grew at boot in the built app (Evidence):

| ground | trees under | scrub | ferns | flower clumps |
| --- | --- | --- | --- | --- |
| Ängsö, high quality | 13,438 | 9,658 | 3,444 | 12,446 |
| Ängsö, low quality | 8,337 | 3,059 | 1,043 | 6,209 |
| Johannesberg | 11,099 | 7,827 | 1,319 | 14,968 |
| Upsala | 10,365 | 11,776 | 3,352 | 8,052 |
| Visby | none: measured vegetation only | | | |

Scrub or a fern grows from 34-38% of the candidates on Ängsö and Johannesberg,
and 62% on Upsala. The rest are the species' bare share, or fall off the forest
floor: many near trees stand in the rough or at a wood's edge, where the ground
cover grows instead. At low quality Ängsö has fewer trees, and 0.494 of the
high's candidates under each.

## What it costs

- **Boot.** Planting and building it took, in this container:
  - 194 ms on Ängsö at high quality and 103 ms at low;
  - 237 ms on Johannesberg and 245 ms on Upsala;
  - on Ängsö the floor alone 106 ms, and the flowers alone 112 ms.

  That is more than the ground cover's own boot lap, now that its lattice
  replays from prepared data (79-228 ms in the same boots). If the boot matters
  more than it did, these plantings could join the prepared scatter.
- **Draws.** One a tile in view. With both befores, Ängsö's tee view drew 96
  draws a frame; with the wild cover it drew 101, its five tiles in view. With
  one before at a time (in Dag) it drew 100 with the flowers' four tiles in
  view, and 97 with the floor's one. Upsala's tee, beside a wood, has 9 tiles in
  view. In Höst the flowers draw nothing.
- **Vertices.** 54 a shrub or a fern, 63 a flower clump. Ängsö's tee view
  draws 43,740 of them (722 plants) and Upsala's 112,554 (2,057 plants). The
  grass round the ball draws 196,608.
- **Memory.** An instance's matrix and root take 80 bytes, and a flower's two
  colours 24 more: 2.3 MB on Ängsö at high quality, and about 0.5 MB of tile
  geometry. Nothing is uploaded after boot.
- **Nothing was timed.** Time it on the owner's GPU and phone: `?forestfloor=0`
  and `?wildflowers=0` are the A/B pairs (same backend, quality, viewport, light
  and `det=1`).

## Evidence

**Unit tests.**
- `wild-cover.test.mjs` (16 tests):
  - **The woods' floor.** Only on the forest floor: none on a path, on mown
    ground or in water. Under each tree's crown, 2.5 times as thick within 90 m
    of a line as within 300 m, and none past 300 m. Scrub under the pines and
    spruce, ferns more under the birch and alder. Half at low quality, and the
    same plants on every run.
  - **The flowers.** In drifts within a patch's reach of a tussock, of one kind
    a drift, every kind in its share. Sparser along the fringe. Only where a
    tussock could stand: with the rule, none of the clumps that would fall on
    the fairway, the path, into the wood or the water.
  - **The shapes.** 18, 18 and 21 triangles, and every head's corners set to
    face the eye.
  - **The draws.** Each tile frustum-culled, receiving shadows and casting
    none, left out past its fade, and every flower tile left out in Höst. The
    petals' and eyes' colours per instance; nothing built where nothing grows.
  - **The shader's terms** and the `main.js` wiring: from the cover's own
    plantings and water rule, the tree LOD's zones, its own boot lap, and a
    tile of each kind compiled with the opening view.
- `camera-frame-order.test.mjs`: the tiles are updated with the camera the
  frame draws, after the grass round the ball and before the render.
- `cloud-shadow.test.mjs`: the light through the ferns and the flowers takes
  the clouds' per-vertex share, as the crowns, the impostors and the grass round
  the ball do.
- `near-grass.test.mjs`: the grass is still shown for the opening compile, with
  the wild cover's tiles readied in the same block.
- `visual-fix-switches.test.mjs`: `?forestfloor=0` and `?wildflowers=0` keep
  every prepared startup path eligible, alone and together with every earlier
  batch's befores.
- The complete suite (`pnpm test`) passed: 1,535 Vitest tests, and the Node
  suite's 482 with none failing (3 skipped). `check-app-build` and
  `check:course-workflow` passed on the re-baked build.

**Isolated browser measures**
([`check-isolated.mjs`](graphics/wild-cover-2026-09-26/check-isolated.mjs), on
[the study page](graphics/wild-cover-2026-09-26/isolated.html); results in
[`isolated-check.json`](graphics/wild-cover-2026-09-26/isolated-check.json)).
The page draws the turf batch's hole on the app's own ground atlas, material
and palette, with two woods as forest ground: one left of the fairway's wide
middle, one right of its first half, past the path. Plain stand-in trees
(pine, spruce and birch, 821 of them) cast the woods' shade. The tussocks and
the fringe are planted by `main.js`'s rules, and the wild cover is planted and
drawn as `main.js` does it: 1,211 shrubs, 436 ferns and 1,588 flower clumps.
Every other module the page draws with is main's at `f05006e8` (checked in
git), so the scene without the wild cover is main's.

The whole check passed on WebGL2 and on WebGPU with reversed depth, both in
SwiftShader, and the two backends agree over 138 measures. Colour is read back
linear. Each read-back is drawn until two renders in a row agree.
- **One draw a tile.** In five views the wild cover adds exactly one draw for
  each tile left in and in the eye's frustum:

  | view | draws added | scrub | ferns | flowers |
  | --- | --- | --- | --- | --- |
  | the tee | 7 | 3 | 2 | 2 |
  | the wood's edge from the fairway | 6 | 2 | 2 | 2 |
  | in the wood | 4 | 1 | 1 | 2 |
  | among the flowers | 4 | 1 | 1 | 2 |
  | the hole view, 41 m up | 6 | 2 | 1 | 3 |

- **Where it grows.** Straight down, the trees hidden so the ground shows:

  | from above | pixels where it may not grow | touched | where it may | covered |
  | --- | --- | --- | --- | --- |
  | the floor, over the wood's edge from 12 m | 81,872 more than 1.5 m off the forest floor | 0 | 28,832 | 3.5% |
  | the flowers, over the wood's edge | 33,456 in the wood, 0.8 m in | 0 | 86,496 | 0.2% |
  | the flowers, over the fairway's edge, the rough and the path from 10 m | 22,576 on the fairway and the path, 0.8 m in | 0 | 82,688 | 0.6% |

  The margins are a plant's reach from its root (a fern's fronds about a
  metre, a clump's heads half a metre) and its height seen from above. From
  above, a clump's heads are a few pixels.
- **How far.** A plant stands in front of the ground its pixel looks at, and its
  root within its reach of what the pixel shows: a clump's heads 0.3 m, a
  shrub's leaves 0.65 m, a fern's fronds a metre. So the furthest ground behind
  any of a kind's pixels, and that reach, bound how far off its plants stand.
  Seen from above them, every plant is seen against the ground, never the sky.

  | kind | view | its fade's end | furthest ground behind it | 99% of its pixels within | its ground in view past the fade |
  | --- | --- | --- | --- | --- | --- |
  | flowers | 10 m up over the rough | 66 m | 60.7 m | 55.8-57.8 m | 16,299 pixels |
  | ferns | the hole view, 41 m up | 220 m | 204.5-205.0 m | 204.5-205.0 m | 2,322 pixels |
  | scrub | the hole view, 41 m up | 320 m | 290.6 m | 279.2-280.2 m | 354 pixels |

- **Höst.** Over the pixels the plants cover in the wood, red over green, and
  blue over green (linear):

  | | summer | Höst |
  | --- | --- | --- |
  | scrub | 0.36, 0.18 | 3.04-3.07, 0.24-0.25 |
  | ferns | 0.42-0.43, 0.16 | 2.30-2.31, 0.19 |

  Among the flowers in Höst the scene is the scene without them, pixel for
  pixel, with no draw added and none of their tiles left in (four in summer).
- **The shade.** In the wood, the floor's plants in the trees' shadows are
  0.606 of their display luminance with the trees' shadows off.
- **The wind.** With the one wind blowing, no two renders in a row agree where
  ferns or flowers stand, and the scrub alone settles. Under reduced motion
  (`windSway` 0) every read-back settles.
- **Low quality.** Under the same 821 trees, 0.500 of the high's candidates a
  tree, and the flowers of its own tussocks (0.97 of the high's a planting).
  Still one draw a tile in view.
- No page errors.

**Boot** ([`check-boot.mjs`](graphics/wild-cover-2026-09-26/check-boot.mjs);
[`boot-check.json`](graphics/wild-cover-2026-09-26/boot-check.json)). The built,
re-baked app on WebGL2, every material in view compiled, the state read back
(full courses render black in software rendering, so no pictures).

Every boot passed: no page or console error, every tree tier audited,
`settled()`, and every prepared startup path replayed (tint, vista, water, and
each scatter section the course carries), the befores included. Each kind grown
had all its tiles in the scene, one mesh a tile, and a tile of it compiled with
the opening view. The tiles left in were exactly those whose nearest plant lies
within the kind's fade.

| boot | tiles (scrub, ferns, flowers) | left in at the eye | the view draws | planted in |
| --- | --- | --- | --- | --- |
| Ängsö, Kväll, the tee view, high quality | 43, 41, 132 | 4, 0, 6 | 5 tiles, 722 plants, 43,740 vertices | 194 ms |
| Ängsö, Kväll, the tee view, low quality | 43, 40, 129 | 3, 0, 4 | 3 tiles, 255 plants, 16,065 vertices | 103 ms |
| Ängsö, Kväll, `?forestfloor=0&wildflowers=0` | none | | | |
| Ängsö, Dag, `?forestfloor=0` | flowers only: 132 | 6 | 4 tiles, 528 plants, 33,264 vertices | 112 ms |
| Ängsö, Dag, `?wildflowers=0` | the floor only: 43, 41 | 4, 0 | 1 tile, 194 plants, 10,476 vertices | 106 ms |
| Johannesberg, Dag, the tee view | 28, 25, 122 | 0, 0, 6 | 3 tiles, 569 plants, 35,847 vertices | 237 ms |
| Upsala, Kväll, the tee view | 35, 33, 104 | 8, 7, 4 | 9 tiles, 2,057 plants, 112,554 vertices | 245 ms |
| Visby, Kväll, the tee view | none: measured vegetation only | | | |

No forest-floor tile comes within 243 m of Ängsö's first tee, and none within
386 m of Johannesberg's. Upsala's tee has a scrub tile 14 m off.

**Publication**
([`check-publication.mjs`](graphics/wild-cover-2026-09-26/check-publication.mjs);
[`publication-identity.json`](graphics/wild-cover-2026-09-26/publication-identity.json)).
The wild cover is drawn from plantings already made, not prepared. The re-bake
for this source revision refreshed identities and moved nothing:
- every tint and vista record is main's but for its identity;
- every scatter record is main's but for its identity, and its payload is the
  same file, byte for byte;
- every water payload keeps its metadata and its fields. Its bytes are new
  only because a water payload carries its identity.

The gate (`check-prepared-startup`) passed on the re-baked build
([`prepared-check.json`](graphics/wild-cover-2026-09-26/prepared-check.json)).

**Pictures** ([`wild-cover.jpg`](graphics/wild-cover-2026-09-26/wild-cover.jpg),
the study page through the app's tone mapping, main beside the wild cover):
- in the wood, in Dag;
- the wood's edge from the fairway, in Kväll;
- among the flowers;
- along the fringe;
- from the tee;
- in the wood, in Höst.

## Not established

- **Pictures on the owner's GPU and phone.** Judge each against
  `?forestfloor=0` and `?wildflowers=0`:
  - a walk or a flight into a wood, and along its edge, in Dag and Kväll;
  - the rough beside a few holes' tees and fairways;
  - Höst, for the red scrub and rust ferns;
  - the fades: flying out from a wood, and away over the rough.

  The first cut is quiet. The flowers stand in drifts, and between them the
  rough is as it was. Every number is in `WILD_COVER`: the floor's candidates
  a tree and species' mix, the flowers' odds, patch and drifts, the kinds'
  colours, the tiles and the fades.
- **The measured-only grounds.** Visby, Tortuna and Lidingö grow no ground
  cover, no grass round the ball and no wild cover. Giving them any needs the
  owner's explicit word, as the runbook's rule stands.
- **Frame time.** Nothing was timed (What it costs).
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering. The isolated check covers
  WebGPU.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/wild-cover-2026-09-26/check-isolated.mjs
node docs/graphics/wild-cover-2026-09-26/check-boot.mjs        # after the re-bake
node docs/graphics/wild-cover-2026-09-26/check-publication.mjs # after the re-bake
```
