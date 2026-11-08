# One way to stand the water, 8 November

**Owner request, 8 November:** "We really need to fix the water in all ponds,
ditches, trenches, waterholes, lakes so that the water level looks correct and
that it works for all golf courses, we need one solid way to place the water
correctly on the golf courses!" and "The first ponds in uppsala GK near hole 1
feel to low water".

Befores: `?waterlevel=before` (the levels as they were) and `?ditches=0` (no water
in the ditches). Both change the prepared water's inputs, so they turn the prepared
data off, as any switch not on `preparedTintAllowed`'s list does.

## The audit

`node tools/audit-water-levels.mjs [--course slug] [--json out.json]` reads every
layout's water polygons and streams against the 1 m laser ground the map and the
simulator read, in each pack's own frame and datum, on the CPU (no browser). For
each polygon it gives the level the boot gave it, the laser's surface inside it and
how flat that is, the outline's own ground, the bank 2-8 m outside, and the level
the rule below gives; for each layout's streams, how much of them is a cut channel
and how much takes water.

What it found:

- **Four level rules by course**: the 30th percentile of the ground under the
  outline plus 0.25 m (most courses), the laser's flat surface (Puttom), reviewed
  interior controls (Johannesberg's ponds) and the measured polygons (Visby,
  Tortuna, Lidingo).
- **The percentile rule stood the water about 18 cm above the level its own
  outline bears out** (median over 10 grounds), and the reach of 7 November capped
  the water's spread at the laser's surface plus 8 cm. Where the laser caught a
  pond's water low, the water drew back inside its own outline: Upsala's pond by the
  1st (laser 20.78 m, outline ground 20.91 m, bank 21.89 m) was a small patch of
  water in a dry brown basin.
- **No ditch or stream had water in the detailed course**: 12 of 13 layouts carry
  them (up to 35 km at Veckefjarden), and the laser shows most as dry trenches. The
  map strokes them.

## The rule

`engine/water-level.mjs` `shoreLevel`, used by the boot (`main.js`) and the map's
bake (`tools/map-shores-bake.mjs`):

- The traced outline is where the water stands on the aerials it was traced from;
  the laser's ground is the basin's shape, and inside it the water's surface on the
  day it was flown.
- The shore is the level at which the water, rising over the laser's ground from
  the outline's inside, covers the outline best (`water-reach.mjs` `fitShoreLevel`:
  the most overlap, from one priority flood that gives every lattice node the lowest
  level reaching it; the middle of the best run of levels, or the laser's own surface
  where the best run reaches down to it).
- Never below the laser's surface; a large flat lake the laser measured whole
  (1 ha or more, 90% of it level) stays within 10 cm of it (Puttom's lakes, owner
  request of 7 November).
- An outline that misses the basin (overlap under 0.6) stands at its own ground.
- The sheet stands the measured-water display clearance (6 cm) above the shore, and
  the reach floods to it.

Johannesberg's reviewed ponds, the sea and the measured-only grounds keep their
measured levels.

| | Laser | Outline ground | Before | Now |
|---|---|---|---|---|
| Upsala, pond by the 1st | 20.78 | 20.91 | 21.16 (spread capped at 20.86) | 21.10, shore 21.04, 93% of the outline |
| Puttom, Stor-Rossjon | 62.73 | 62.73 | 62.79 | 62.86, shore 62.80 |

## The ditches

`engine/stream-water.mjs`: every 2 m along a ditch or stream, the channel's floor
and banks across it. Water stands a share of the cut above the floor (6-18 cm),
spreads across to where the bank rises over it and tucks under the banks. A run's
two ends taper. No water where the laser shows no cut channel, over a culvert (the
floor jumps up out of its neighbours), on short runs, or inside a lake's own water
and carved bed (a ditch runs into a pond and is the pond). One geometry a course,
drawn by the lakes' water, reading as water (not the shallows' silt). Tortuna's
streams keep their centreline only, as their review says. Water drawn: Angso
4.6 km, Upsala 12.0 km, Johannesberg 3.2 km, Veckefjarden 2.4 km (the rest of its
35 km runs over distant ground too coarse to hold a channel), Puttom 2.1 km,
Lidingo 1.2 km, Ribbingsfors 1.1 km, Norrfallsviken 0.4 km.

## Evidence

- `water-level.test.mjs`, `stream-water.test.mjs`, `water-reach.test.mjs`,
  `map-shores.test.mjs`.
- On the owner's GPU (WebGPU, `det=1`, one 1280 x 720 page at a time): Upsala's pond
  by the 1st, before (`?waterlevel=before&ditches=0`) a dry basin with a patch of
  water, after full to its outline; a ditch on Angso as water in its channel.

## Not established

- Phones and WebGL2 pictures; frame time.
- A ditch whose channel the drawn terrain does not resolve stays hidden under it
  (the CPU reads the 1 m ground, the drawn terrain can be coarser).
