# The grass round the ball, 26 September

**Owner request, 26 September.** Once the turf batch had merged, the owner asked
"Whats next?". The ground audit's biggest remaining near-field gain was a patch
of grass round the camera, and the owner answered:

> "Go with grass round the ball"

The app has no ball in play. A hole starts at the tee, where the camera is
lowest, so this is grass round the eye, in every low view:
- the tee view: 1.7 m over the ground, six metres behind the tee;
- anywhere the camera is taken down to the ground.

It follows [the turf](visual-turf-2026-09-26.md). **`?neargrass=0`** is the
before: without it the ground is main's, pixel for pixel (Evidence).

## What was wrong

A low view looked at the turf as a painted sheet. The ground's tufts
([the ground](visual-ground-2026-09-26.md)) keep 24 m off every hole's line.
Inside that, nothing stood on the turf but the fringe of uncut grass at the
rough's cut edge. From the tee, the rough in front of the camera was a smooth
wash of colour. The turf batch gave it grain, but grain is flat: nothing had
height.

## What it is

`near-grass.mjs` draws a patch of grass blades that follows the camera, in one
instanced draw:
- **Rings round the eye.** Nested squares, each ring's cells twice the size of
  the one inside it. A blade belongs to the ring it falls in. Each ring but the
  last thins to a quarter of its blades toward its edge. A cell twice the size
  holds the same blades over four times the ground, so where one ring ends the
  next ring's density takes over, and no ring ends in a seam.
- **Anchored to the world.** Each blade is a hash of its ring and its world
  cell, so the patch scrolls with the camera and no blade swims.
- **What grows where.** The ground's own exact class fields
  (`ground-material-core.mjs`) say what grows and how tall. Each blade stands a
  little over its class's cut (`CUT_HEIGHT_MM`):

  | class | blade |
  | --- | --- |
  | tee, collar | 24 mm |
  | fairway | 28 mm |
  | semi | 50 mm |
  | heath | 60 mm |
  | rough | 85 mm |
  | wetland | 90 mm |

  Nothing grows on a green, sand, a path, hard ground, the forest floor, the
  shore or in water. Blades stand taller where the ground's own clumps are
  dense, and shorter where they thin.
- **Its colour is the ground's.** Each blade takes the colour the ground has
  at its root, from the same functions and terms the ground uses:
  - the class's cut-toned palette (`groundClassColour`, which the ground's own
    material now calls too), or the ground tint where the tint paints the
    ground;
  - the ground's own light there: the rough's clumps, the mown turf's grain,
    a sheltered hollow's damp in the storm and the mist, and the baked relief
    (`applyGroundRelief`);
  - the painted finish's blotches, sun band, grass strength, autumn and gloss.

  Along the blade it is darker at the root (0.8) and lighter and warmer at the
  tip (1.28, yellower, never bluer). Each blade has its own tone, within 10%
  either way.
- **Its light.** A blade is lit as the ground under it is, its normal leaning
  a little (0.12) toward the side that is seen. Against a low sun you see
  blades' shaded sides, and the sun comes through their tips.
- **No shimmer.** A blade fades out while still a few pixels tall: gone at 330
  times its length from the eye, whole at 60% of that. It is never narrower
  than about a pixel.
- **The wind.** It sways on the one wind (`one-wind.mjs`), and stands still
  under reduced motion.
- **Hidden from above.** Over 40 m above the ground every blade has faded, and
  the grass is not drawn.

| quality | rings | cells a side | innermost cell | blades a cell | blades | reach |
| --- | --- | --- | --- | --- | --- | --- |
| high | 4 | 64 | 0.16 m | 4 | 65,536 | 38.9 m |
| low (every phone) | 3 | 40 | 0.24 m | 3 | 14,400 | 18.2 m |

## Where it is drawn

It is gated as the ground cover is:
- **Measured vegetation only.** A ground whose vegetation is measured-only
  draws what it measured and nothing invented. Visby, Tortuna and Lidingö have
  no grass round the ball, as they have no ground cover; the ground audit's
  last item would give them both.
- **Exact class fields.** Without them the grass has nothing to read what
  grows from.

## The ground under it

The blades need the visible ground's height, and where water lies, round the
eye. The grass keeps both in a grid, one point a metre, 94 points a side (54 at
low quality). The grid is addressed toroidally: world point (i, j) lives at
texel (i mod 94, j mod 94). As the eye moves, only the rows and columns it moves
into are read. Every four metres the grid re-centres: about 380 reads for a
straight move, 740 for a diagonal one, paced at 600 a frame.

- **The heights** are `main.js`'s visible ground (`terrainH`), the same the
  camera clamp and the ground cover stand on.
- **Water.** Nothing grows inside a lake's or pond's ring or within 0.3 m of
  it, on low ground at its edge, in a stream, or where the terrain found flat
  water. A blade needs three quarters of the grid's weight at its root to say
  grass. Across an edge of the grid the blades stop within a quarter metre of
  the last point that grows, inside that 0.3 m margin, so none takes root in
  the water.
- **Always held.** The grid knows which points it surely holds. It is drawn
  only while every point a blade can stand on is held: through a re-centre,
  and not after a jump until the new ground is read.
- **At boot** the whole grid is filled before the opening view is compiled.
  The grass's material compiles with the opening view even when that view is
  too high to draw it. In this container the fill took 17-30 ms for the
  8,836 points at high quality (Evidence).

## Two bugs the backends found

The isolated check measures everything on WebGL2 and on WebGPU and asks the two
to agree. Twice they did not.

**A seam where the grid wraps.** The first version found a texel's index as
`a − floor(a / 94) · 94`. A GPU that divides by a reciprocal can land a hair
under a whole number, and the floor then comes out one short. Where the grid
wrapped, the index named a texel outside it. On WebGL2 a two-metre strip grew
no grass there, every 94 m in both directions. Now the remainder, exact in
whole numbers, is brought back into range, and the strip is grown. The ring and
cell indices are unsigned integer division. The check now looks at the rough
across the wrap.

**A triangle of blades hidden on WebGL2.** In the tee view WebGL2 drew no
blades over a triangle of near ground that WebGPU drew. The two shaders were
the same line for line. Taking each factor of a blade's length out in turn
(the grid's water mask, the rings' thinning, the clumps, the fade and the
wind) left the gap where it was. The page's flat ground is a 5 m grid, and one
corner sat right under the tee camera, in its plane.
SwiftShader's WebGL2 path mis-drew the depth of that large, near-clipped
triangle. It stood in front of the blades. Moving the page's grid off every
low view's camera plane made the backends agree within half a per cent.
That was the study page's ground, not the grass. The app's terrain is its own
mesh, and full courses are judged on the owner's GPU.

## What it costs

One draw call, over 196,608 vertices at high quality and 43,200 at low. The
vertex shader is long: the hash, the blend of the class fields, and the
ground's colour terms. Each vertex reads:
- the class fields' textures;
- the detail texture three times;
- the ground tint;
- the grid four times.

The fragment shader is the painted finish's. While the camera stands still,
nothing is uploaded. As it moves, the grid's 141 KB texture (47 KB at low
quality) is re-sent on the frames that read new ground.

**Nothing was timed.** Every low view now draws tens of thousands of small
triangles it did not draw before, so time it on the owner's GPU and phone:
`?neargrass=0` is the A/B pair (same backend, quality, viewport, light and
`det=1`).

## Evidence

**Unit tests.**
- `near-grass.test.mjs` (16 tests):
  - **The rings.** Each quality's rings, instances, blades, reach and grid
    size. The grid holds the reach from anywhere the eye can be before it
    scrolls.
  - **The hand-over.** A ring's density at its edge equals the next ring's,
    for both qualities. The inner ring is thinned by where it ends, and the
    next ring is whole where it begins.
  - **The fade.** It ends before the reach, about three and a half pixels
    tall in the tee view.
  - **What grows where.** Every blade stands over its class's cut, in the
    order of the cuts, and nothing grows on the classes that grow nothing.
  - **The colours.** `groundClassColour` gives the ground's own colours; the
    tint classes take the tint.
  - **The grid.**
    - Every point is in the slot the shader reads, one read a point.
    - A scroll reads only the new columns, and stays drawn throughout.
    - A jump, or a turn back before a pass is done, is not drawn over points
      no longer held.
    - Unknown ground grows nothing, and stands at the last height read.
    - The water margin: blades stop within a quarter point, inside `main.js`'s
      0.3 m.
  - **The mesh.** One instanced draw: never culled whole, shadowed like the
    ground, casting nothing. It is built for either quality and needs the
    exact fields and the ground. It follows the eye near the ground, hides
    over it, and settles when its ground is read.
  - **The shader's terms**, each behind the ground's switch, and the
    `main.js` wiring.
- `camera-frame-order.test.mjs`: the grass is moved with the camera the frame
  draws, after the sun, shadows and sky and before the render. `settled()`
  waits for its ground.
- `cloud-shadow.test.mjs`: the light through the blades takes the clouds'
  per-vertex share, as the crowns and impostors do.
- `visual-fix-switches.test.mjs`: `?neargrass=0` keeps every prepared startup
  path eligible, alone and together with every earlier batch's befores.
- The complete suite (`pnpm test`) passed: 1,519 Vitest tests, and the Node
  suite's 482 with none failing (3 skipped).

**Isolated browser measures**
([`check-isolated.mjs`](graphics/near-grass-2026-09-26/check-isolated.mjs), on
[the study page](graphics/near-grass-2026-09-26/isolated.html); results in
[`isolated-check.json`](graphics/near-grass-2026-09-26/isolated-check.json)).
The page draws the ground batch's par 4 on the app's own exact-edge atlas,
ground material and palette, with `main.js`'s `SHADE` table, and a pond in the
rough. Main's ground material, generated from git at `d5488b6d`, is drawn in
the same page. The grass is built as `main.js` builds it.

The whole check passed on WebGL2 and on WebGPU with reversed depth, both in
SwiftShader, and the two backends agree over 184 measures. Colour is read back
linear, and display luminance is its 2.2 root. Each read-back is drawn until two
renders in a row agree.
- **The before is main's.** Without the grass, this ground and main's are the
  same, pixel for pixel, in ten views and lights:
  - the tee view at noon, at golden hour and in its classes' colours;
  - a player on the tee;
  - short of the green at golden hour;
  - the fairway, the rough and the pond, low;
  - the collar and a bunker from above.

  With the grass on, the hole view 41 m up is main's too: the grass is hidden
  there.
- **One draw.** The tee view draws one call without the grass and two with it.
- **Where it grows.** Straight down over an edge, the pixels whose ground lies
  more than a quarter metre on each side:

  | edge | past the edge | touched | the grass side | covered |
  | --- | --- | --- | --- | --- |
  | the collar into the green, from 3 m | 50,398 | 0 | 56,744 | 1.5% |
  | the fairway into a bunker, from 3 m | 39,992 | 0 | 65,418 | 2.3% |
  | the fairway into the path, from 3 m | 58,752 | 0 | 58,752 | 2.2% |
  | the rough into the pond, from 6 m | 18,364 | 0 | 70,458 | 10.6% |

  Mown blades are a few centimetres: from 3 m up they touch one to three
  pixels in a hundred.
- **How far.** A blade hides the ground behind it. The furthest ground any
  blade stands before is 26.5-27.4 m in the tee view, 23.0-24.2 m in the rough
  and 9.0 m on the fairway, against a reach of 38.9 m. 99% of the blades'
  pixels lie within 20.3, 17.6 and 7.8 m. In the tee view the blades cover:

  | ground | 0-5 m | 5-10 m | 10-20 m | 20-40 m | past 40 m |
  | --- | --- | --- | --- | --- | --- |
  | covered | 19% | 18% | 13% | 1.6% | none |

- **No seam where the grid wraps.** In the rough across the grid's wrap at
  94 m, the metre strips either side are grown 1.04 and 0.84-0.86 times as much
  as the strips beside them. The first version grew almost nothing there on
  WebGL2.
- **Its colour is the ground's.** Over the pixels the blades cover, their mean
  against the ground's own:

  | | display luminance | red over green | blue over green |
  | --- | --- | --- | --- |
  | noon, the tee view | 0.992 | 0.998 | 0.976 |
  | noon, the rough | 1.003 | 1.005 | 0.962 |
  | noon, the fairway | 1.002 | 1.001 | 0.974 |
  | golden hour, the tee view | 0.962 | 0.929 | 0.955 |
  | golden hour, round the green | 0.978 | 0.943 | 0.952 |
  | golden hour, the rough | 1.009 | 1.002 | 0.940 |

  Blue over green is a little lower throughout: the tips are warmer, never
  bluer. Looking toward a low sun you see the blades' shaded sides, 2-4%
  darker and 6-7% less red than the ground.
- **The hollow and the damp.** Under a sheltered hollow's relief the ground
  darkens to 0.848 of the open rough, and the blades to 0.848. In the storm the
  damp hollow is 0.749 of the open rough, the blades 0.750.
- **The wind.** With the one wind blowing, no two renders in a row agree: the
  blades move. Under reduced motion (`windSway` 0) they stand still, and every
  read-back settles.
- **Low quality.** 4,800 instances and one draw. No blade stands before ground
  past 17.6-18.0 m, against its reach of 18.2 m.
- No page errors.

**Boot** ([`check-boot.mjs`](graphics/near-grass-2026-09-26/check-boot.mjs);
[`boot-check.json`](graphics/near-grass-2026-09-26/boot-check.json)). The built
app on WebGL2, every material compiled, the state read back (full courses
render black in software rendering, so no pictures):

Every boot passed: no page or console error, every tree tier audited,
`settled()`, and every prepared startup path replayed (tint, vista, water, and
each scatter section the course carries), `?neargrass=0` included.

| boot | the grass | eye over the ground | the grid at boot |
| --- | --- | --- | --- |
| Ängsö, Kväll, the tee view, high quality | drawn, 16,384 instances | 1.76 m | 8,836 points, 22 ms |
| Ängsö, Kväll, the tee view, low quality | drawn, 4,800 instances | 1.76 m | 2,916 points, 18 ms |
| Ängsö, Dag, from above | built, hidden | 525 m | 8,836 points, 17 ms |
| Ängsö, Kväll, `?neargrass=0` | none | | |
| Johannesberg, Dag, the tee view | drawn, 16,384 instances | 1.70 m | 8,836 points, 26 ms |
| Upsala, Kväll, the tee view | drawn, 16,384 instances | 1.70 m | 8,836 points, 30 ms |
| Visby, Kväll, the tee view | none: measured vegetation only | | |

**Publication**
([`check-publication.mjs`](graphics/near-grass-2026-09-26/check-publication.mjs);
[`publication-identity.json`](graphics/near-grass-2026-09-26/publication-identity.json)).
The grass is drawn, not prepared. The re-bake for this source revision
refreshed identities and moved nothing:
- every tint and vista record is main's but for its identity;
- every scatter record is main's but for its identity, and its payload is the
  same file, byte for byte;
- every water payload keeps its metadata and its fields. Its bytes are new
  only because a water payload carries its identity.

The gate (`check-prepared-startup`) passed on the re-baked build
([`prepared-check.json`](graphics/near-grass-2026-09-26/prepared-check.json)).

**Pictures** ([`near-grass.jpg`](graphics/near-grass-2026-09-26/near-grass.jpg),
the study page through the app's tone mapping, main beside the grass):
- from the tee;
- a player on the tee;
- in the rough;
- on the fairway;
- short of the green at golden hour;
- the collar and the green from above.

## Not established

- **Pictures on the owner's GPU and phone.** Judge each against `?neargrass=0`:
  - the tee view on a few holes, in Dag and Kväll;
  - the camera taken down into the rough, on the fairway and at a green's
    edge;
  - a pond's or lake's edge;
  - a walk or a flight low over the ground, for the rings' hand-over and the
    fade.

  The first cut is quiet: mown blades are a few centimetres, and from a
  standing eye the fairway's read as a fine grain. Their lengths, the rings'
  density and the fade are all in `NEAR_GRASS`.
- **Frame time.** Nothing was timed (What it costs).
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering. The isolated check covers
  WebGPU.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/near-grass-2026-09-26/check-isolated.mjs
node docs/graphics/near-grass-2026-09-26/check-boot.mjs        # after the re-bake
node docs/graphics/near-grass-2026-09-26/check-publication.mjs # after the re-bake
```
