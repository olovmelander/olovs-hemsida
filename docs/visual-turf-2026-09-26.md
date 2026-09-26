# The turf, 26 September

**Owner request, 26 September.** Once the ground bug batch had merged, the owner
asked:

> "Continue with whats recommended next!"

The ground audit's next three items were the mown turf's grain, wear and wet
ground, and bare rock and soil. This follows [the ground](visual-ground-2026-09-26.md).

Three fixes, each behind a before switch:
- **`?turfgrain=0`**: the mown classes take a near grain, and mown turf a
  broader blotch. The detail texture is read four times a pixel where it was
  read seven.
- **`?groundwear=0`**: tees are divoted; the ground round greens and tees is
  walked; sheltered hollows lie damp in the storm and the mist.
- **`?bareground=0`**: rock, soil and mud mottle, and their edges fray into
  the grass.

All three are drawn, not prepared. They keep the prepared startup data
eligible, so an A/B pair differs only in the fix, and the re-bake refreshed
source identities only (Evidence).

## The turf's grain

**What was wrong.** A fairway was its flat colour and its stripes. The finish's
three blotches (`paintedGround`, `material.js`) moved it by 1.2, 0.5 and 0.4%
of display luminance, under what the eye sees. The finest thing on it was the
rough's metre-wide clumps beside it (4% either side), so the rough read as
grass and the fairway as a painted sheet. A green was flatter still.

**Now.** Every class but the rough's own paint takes the rough's clumps, scaled
by its own `SHADE` bump. Its bump is that column of the table in `main.js`,
until now unread by the painted finish:
- a fairway's 0.44 is about 2.5% of display luminance either side, at 0.4-1 m;
- a green's 0.13 is under 1%;
- sand, paths and hard ground take their own.

The rough's 4% stays the strongest. The clumps are the difference of two taps
of the detail texture, so they average to zero: no turf changes its tone. The
mip chain takes them to flat grey with distance, so they cannot shimmer.

Mown turf also takes 2.5 times the finish's broad blotch, 13 m across: about
3% either side on a fairway where it was 1.2%. The shading's gloss calms it to
about half on greens and tees. It is centred on the detail texture's own mean
in that channel (0.4705, `DETAIL_BROAD_MEAN`), so the turf keeps its tone on
average. Measured across a wide fairway, its mean moved 0.07%.

## Four detail taps where there were seven

**What was wrong.** The ground read the 512-texel detail texture seven times a
pixel, each at its own scale, keeping one of each read's four channels:
- the range's wobble;
- a pass's wander along its length;
- the rough's two clump taps;
- the finish's three blotches.

**Now.** Four taps give all seven:
- The broad blotch's tap carries the range's wobble in the same channel: a
  wobble of 13 m where it was 27.
- The far clump tap is the finish's middle blotch: 1.1 m features where they
  were 0.9.
- The near clump tap's blade channel is its fine blotch: 2.2 cm speckle where
  it was 1.8.
- The wander keeps its own tap.

The near tap is turned 37 degrees off the world's axes, so its 11 m repeat no
longer lines up with the others'. The grain, the wear and the bare ground add
no read of their own.

## A tee is divoted

**What was wrong.** Every tee on every course was unmarked turf.

**Now.** Where the near clumps crest highest in a tee's middle (from 0.5 m in),
the turf is scarred: bare soil under a sand-and-seed mix (`DIVOT_SAND`), part
grass still (`DIVOT_SHARE`). The scars are a hand or two across, the highest
crests of a smooth field: their share of the texture is about 1% of the
middle. As drawn, 1.2% of a tee's middle is scarred at half strength or more,
and 2.2% touched at all.

The mip chain lowers the crests below the threshold with distance:
- 0.9% of a tee's middle at full detail;
- 0.7% at 9 cm texels;
- 0.2% at 17 cm;
- none from 35 cm.

So the scars go before they could shimmer.

## The walk on and off a green

**What was wrong.** Players cross the collar and the ground round a green at
the same few places a round. Nothing showed it.

**Now.** The turf 1.2-2.6 m out from a green's edge, and a tee's, is worn thin,
paler and yellower, in patches. The band ramps in from 0.4 m and out by 4.6 m,
from the exact distance to those edges (the mow-ring field). Within it the
wear takes the ground where the clumps are thinnest (`WEAR_THIN`): about a
seventh of the band fully, its patches' hearts about 7% brighter at display,
red up 11% and blue down 5%. So it reads as worn patches across the collar
rather than a painted ring. On average the band is 1.7% brighter. Sand and hard
ground are left alone.

## Damp hollows in the storm and the mist

**What was wrong.** The storm's wet course ([the lights](visual-lights-2026-09-25.md))
lays a grey glaze and more sheen over all the ground alike. A hollow, where the
water stands, read no wetter than a crest, and in the mist nothing was wet.

**Now.** In the storm and the mist, ground the baked relief finds sheltered is
damp (`ground-relief.mjs`): a hollow, a slope's foot, open ground beside a
wood. It is darker and a little cooler, patchily with the clumps. Damp starts
at shelter 0.45 and is full by 0.9.

Each light's wetness is `GROUND_WETNESS` (`painted-world-lighting.mjs`): the
storm 1, the mist 0.6, every other light 0. In a fully sheltered hollow the
storm takes 9.6% of display luminance off the ground, the mist 5.6%. Paving
stays dry.

## Bare rock, soil and mud

**What was wrong.** Rock, soil and mud were each one flat colour (under 0.5% of
display luminance either side). As hard ground they took a third of the
finish's blotch. Their edges broke off along the mapped line like a cut. They
read as stickers laid on the grass.

**Now.** They mottle in soft blotches a metre across, as a painter lays broken
ground. The blotches come from the far tap alone, centred on its channel's own
mean (`DETAIL_CLUMP_MEAN`): about 8, 7 and 5% of display luminance either
side, on top of the grain their bump gives them. As lit, the patches measured
6.6, 4.7 and 3.6%.

Their edges move with the clumps (`BARE_RAGGED_METRES`): 12 cm either side
over the whole texture. Along the two 8 m edges measured, a straight mapped edge
wanders 7 and 13 cm either side, and 40 cm at most.

**A limit.** The fraying is drawn only. Every other reading of the fields keeps
the mapped line:
- the ball's lie;
- the ground cover's planting;
- the prepared data.

Where rock meets grass, the ball's surface is up to 40 cm from the drawn edge.

## The first cut

The first version was judged from the isolated pictures before anything was
kept. It was too loud in two places and invisible in a third:
- **The divots** took every crest over the top 5% of the texture, at 85%
  soil and sand. They covered a tee in tan spots: 6% of its middle touched.
- **The walk** was a diffuse +1.5% over the whole band, which no picture
  showed.
- **The bare ground** took the clumps themselves, at 10, 9 and 6%. Their 0.4 m
  half made a speckle: rock went from near white to dark grey across a patch,
  and read as noise from the hole view.

The version above is the second, checked the same way.

## What it costs

The ground's fragment shader reads the detail texture four times where it read
seven, and adds some arithmetic for the grain, the wear and the damp. Nothing
was timed; on a GPU the saved texture reads should cover the arithmetic, but
that should be measured on the owner's GPU and phone.

## Evidence

**Unit tests.**
- `ground-detail.test.mjs`:
  - **The taps.** The drawn graph's distinct reads of the detail texture: 7
    before, 4 with the grain. The wear and the bare ground add none.
  - **What it reports.** The material reports what it was built with.
  - **The amplitudes**, from the detail texture itself as the shader samples
    it:
    - the clumps' mean is under 0.003 and their spread 0.19-0.21;
    - a fairway's grain is 2.2-2.8% and a green's under 1%;
    - the broad blotch is 1.2% before and 2.8-3.4% after;
    - rock, soil and mud mottle at 8, 7 and 5% from the far tap, which
      averages `DETAIL_CLUMP_MEAN` (the texture's channel within 0.001 in both
      variants);
    - the ragged edge wanders 12 cm;
    - the broad channel's mean is `DETAIL_BROAD_MEAN` in both texture variants.
  - **The divots** scar 0.5-2% of a tee's middle, under 1% at 17 cm texels and
    none from 35 cm.
  - **The walk's** band; its patches take a tenth to a fifth of it fully, their
    hearts 6-8% brighter, paler and yellower.
  - **The damp** in the storm and the mist only, every light checked, and only
    on sheltered ground.
  - **The shader's rules**, and the `main.js` wiring.
- `visual-fix-switches.test.mjs`: the three befores keep every prepared startup
  path eligible, alone and together with every earlier batch's.
- The complete suite (`pnpm test`) passed: 1,502 Vitest tests, and the Node
  suite's 482 with none failing (3 skipped).

**Isolated browser measures**
([`check-isolated.mjs`](graphics/turf-2026-09-26/check-isolated.mjs), on
[the study page](graphics/turf-2026-09-26/isolated.html); results in
[`isolated-check.json`](graphics/turf-2026-09-26/isolated-check.json)).
The page draws the ground batch's par 4 on the app's own exact-edge atlas and
ground material, with `main.js`'s `SHADE` table. It adds rock and bare soil
beside the tee, and a hollow in the ground tint's relief. Main's ground
material, generated from git at `f08e68ac`, is drawn in the same page.

The whole check passed on WebGL2 and on WebGPU with reversed depth, both in
SwiftShader. Colour is read back linear, and display luminance is its 2.2 root.
- **The befores are main's.** With `?turfgrain=0`, `?groundwear=0` and
  `?bareground=0` the ground is main's, pixel for pixel, in 17 views and lights.
  They are the ground batch's six, plus:
  - a player on the tee;
  - from above: the tee, the green's surround, the fairway and the green
    close, and the rock and the soil, lit and in their classes' colours;
  - the hollow in the storm and the mist;
  - the hole view at golden hour.
- **The taps.** Main's drawn ground reads the detail texture 7 times, the
  befores 7, the batch 4.
- **The grain.** Close from above, without stripes, the fairway's display
  luminance varies 1.9% either side (main 0.5%). The sheen over the turf takes a
  little of the 2.5% in its colour. The green's varies 0.6% (main 0.2%).
- **The broad blotch.** Across the wide fairway, the spread of 8 m blocks'
  means is 2.6% (main 1.1%). The fairway's mean moves 0.07% and the rough's
  0.13-0.16%.
- **No shimmer.** From the tee at golden hour, mown as the app mows, past 80 m
  the fairway takes no finer texture than main's:
  - its step from one pixel to the next across the view is main's exactly
    (0.21-0.24%);
  - its change when the whole view moves half a pixel sideways is main's to
    within 0.01% (0.10-0.12%).

  Along the view a pixel spans metres, and there the stronger broad blotch
  changes the far fairway more: 0.69-0.71% and 0.84% for a half pixel at 80-160 m
  and 160-340 m, where main's were 0.39% and 0.52-0.54%. It changes in
  proportion to the shift: a half pixel moves it 2.2 and 1.6-1.8 times what a
  quarter does, as main's own do (2.2 and 1.4-1.8). That is a smooth pattern
  sliding with the view, not aliasing, which would change about as much either
  way.
- **The divots.** 1.2% of the tee's middle is scarred (its red over green
  risen by half the deepest scar's or more) and 2.2% touched at all. None of its
  outer half metre is touched. In the scars red over green goes from 0.49 to
  1.07.
- **The walk.** Against the batch without its wear:
  - the ground 1.2-2.6 m from the green's edge is 1.7% brighter at display,
    red over green 0.434 to 0.442, blue over green 0.179 to 0.170;
  - 2.6-4.6 m out, 0.8% brighter;
  - round the tee, 1.5% brighter.

  The green and the ground past 5 m are untouched but for a half float's last
  bits (at most 0.001 and 0.0001 in linear colour: the longer shader compiles
  a little differently).
- **The damp.** In a fully sheltered hollow the storm takes 9.6% off display
  luminance, and cools it a little (blue over green up 0.005). The mist takes
  5.6%, 0.59 of the storm's. The open ground round the hollow is untouched in
  both, and golden hour and noon change nothing anywhere, beyond a half float's
  last bits.
- **The bare ground.** As lit, the display luminance varies either side:

  | | Main | Now |
  |---|---|---|
  | Rock | 0.2% | 6.6% |
  | Soil | 0.2% | 4.7% |
  | Mud | 0.5% | 3.6% |

  In the classes' colours, the rock's two straight 8 m edges run straight on
  main, and now wander 13 and 7 cm either side, 39 cm at most.
- **The backends agree** on all 153 measures, and every read-back settled.

**The pictures** ([`turf.jpg`](graphics/turf-2026-09-26/turf.jpg)) are main
beside the batch through the app's tone mapping:
- at noon: a player's view over the tee, the tee from above, round the green,
  the rock and the soil, and the fairway close;
- the hollow in the storm;
- the hole view and the view from the tee at golden hour.

**The app boot**
([`check-boot.mjs`](graphics/turf-2026-09-26/check-boot.mjs), results in
[`boot-check.json`](graphics/turf-2026-09-26/boot-check.json)). The re-baked app
booted 8 times on WebGL2 in SwiftShader, and every boot passed. Each compiled
every material in the scene with no page or console error, and the tree tiers
audited clean. In each, the page walked the drawn ground material's graph and
counted its distinct reads of the detail texture.
- **Ängsö at golden hour, high and low quality, and in Oväder and Dis:** the
  ground built with all three parts, and 4 reads. Its exact fields carry rock,
  so the bare ground is drawn. The ground batch's fixes are all still on.
- **Every before at once:** main's ground, 7 reads.
- **Johannesberg and Upsala:** their rock drawn as bare ground, 4 reads.
- **Visby:** its soil drawn as bare ground, 4 reads.

In every boot, befores included, the prepared ground tint, vista and water
replayed, and every section of the course's prepared scatter:
- Upsala's courses have ponds and no lake, so they carry no reeds section;
- Visby plants nothing (measured vegetation only), and its water keeps its
  runtime path.

**The publication proof**
([`check-publication.mjs`](graphics/turf-2026-09-26/check-publication.mjs),
results in [`publication-identity.json`](graphics/turf-2026-09-26/publication-identity.json)).
The re-bake is checked against main's catalogue at `f08e68ac`, for all 13
courses and both qualities:
- every source identity is refreshed, and every other catalogue field is
  unchanged;
- every tint and vista record is main's but for its identity;
- every scatter record is main's but for its identity, and its payload is the
  same file, byte for byte;
- every water payload keeps its metadata and its fields. Its bytes are new
  only because a water payload carries its identity.

The gate (`check-prepared-startup`) passed on the re-baked build
([`prepared-check.json`](graphics/turf-2026-09-26/prepared-check.json)).

## Not established

- **Pictures on the owner's GPU and phone.** Judge each against its before:
  - the fairway and the green close, from the tee and from above, against
    `?turfgrain=0`: the grain, and the broad blotch far down the fairway;
  - a tee, and the ground round a green, against `?groundwear=0`; and a
    course's hollows and wood edges in Oväder and Dis;
  - rock and soil against `?bareground=0`: the rock that Ängsö's,
    Johannesberg's and Upsala's fields carry, and Visby's soil.
- **Frame time.** Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering. The isolated check covers
  WebGPU.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/turf-2026-09-26/check-isolated.mjs
node docs/graphics/turf-2026-09-26/check-boot.mjs        # after the re-bake
node docs/graphics/turf-2026-09-26/check-publication.mjs # after the re-bake
```
