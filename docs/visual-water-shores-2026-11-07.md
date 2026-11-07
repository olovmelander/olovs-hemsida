# The water's shores, 7 November

**Owner request, 7 November:** "in puttom and other golf courses the water lines
seem so sharp against the ground, i dont want these straight and sharp lines on
the water", then "We also need to fix visby ... sharp lines in the water in the
distance and along the waterline", then "Do all the recommended fixes! and fix
the water level in Puttom so it is aligned with the real measurements."

Every change keeps its before behind a URL switch:

- `?waterreach=0` restores the sheets, beds, far masks and coast as they were
  (and with it the damp bank);
- `?shorefade=0` restores the sheet's opacity at its edge;
- `?shoredamp=0` restores the bank's colour;
- `?waterlevel=before` restores Puttom's ring-percentile levels.

`shorefade` is display-only and keeps the prepared startup data eligible. The
other three move the beds or the bank's colour, so they turn the prepared data
off, as any switch not on `preparedTintAllowed`'s list does.

## What was wrong

Every water body was drawn to an outline, never to the ground:

- **A lake's sheet was its traced ring.** The rings are sketches: Puttom's run
  30-90 m between points (337 m at most), and the curve pass left every span
  over 80 m straight with sharp ends. They lie inside the real shore. The
  ground between the ring and the bank is the laser's own lake surface, flat at
  the water's level, so it was drawn as a dry strip of bed below the water.
  Sampled every 3 m along the ring within 220 m of the green, the bank rose out
  of the water this far outside the ring:
  | Where | Median | p90 | Max |
  |---|---|---|---|
  | Puttom 12th (Stor-Rossjon) | 6 m | 10 m | 11 m |
  | Veckefjarden 14th | 2 m | 3.5 m | 29 m |
  | Angso 3rd | 2.5 m | 10.5 m | 24.5 m |
- **The sheet ended at 62-97% opacity**, so wherever it ended was a line.
- **The far lakes the ground found** were cut by their 8 m mask, so their
  shores were the mask's cells, bevelled by its filtering.
- **Visby's sea beyond the mapped window** was drawn only in 32 m cells wet at
  all eight of their samples. Every cell the coast crosses was left out, so
  the sea ended in a 32 m staircase with the laser's sea surface beside it as
  pale flat ground.
- **Puttom's levels stood a quarter metre up their banks.** The boot rule is the
  30th percentile of the ground under the ring's own points plus a 0.25 m
  clearance. A loose ring puts many of its points on the bank: Stor-Rossjon
  came out at 62.98 m over a surface the laser reads at 62.73 m.

## The changes

**The water the ground holds** (`engine/water-reach.mjs`, `?waterreach=0`).
Each lake is read off its own uncarved ground at boot, before the beds are
carved, on a lattice round its ring (1.5 m beside the course, 5 m and coarser
for far lakes, at most 100,000 samples and 300,000 nodes a lake). The water is
every node connected to the ring's inside whose ground stands no higher than
its ceiling, out to 32 m past the ring. The ceiling is the lake's level, and
never more than 8 cm above the laser's own surface inside it
(`water-plate-level.mjs`), so a level lifted clear of that surface does not
flood a gentle bank or a fairway. From that:

- the sheet's outline is the water grown two nodes under the bank, so the
  terrain hides it wherever the ground is higher and the waterline drawn is the
  ground's own contour at the level, with no chord or corner of the ring in it;
- the sheet is split to 1.5 cell edges within four cells of the bank
  (`refineNearShore`, conforming, beside the course only), and its shore
  distance is metres to that bank;
- the bed is carved under the strip the ring left dry (`refineReachedWaterBeds`,
  wrapped round the broad field as the reviewed ponds' exact beds are). Within
  10 m of a bank the lattice owns the bed: its water deepens from the bank by the
  broad field's own profile, and no bank above the ceiling is lowered
  (`toleranceAt`; the broad field lowered anything within 0.5 m of its level
  inside half an 8 m cell). Open water further out is the broad field's.

The source ring is untouched: it stays the hazard, the level's evidence and every
other reader's water. A ring the extract cut runs on as the flat water the
ground found, which the flat sheet already draws: the reach does not flood it,
own its bed or tuck its outline into it, but counts it as water, so the sheet
does not fade toward it. The sea, a cut ring, a reviewed pond's exact polygon
and the measured-only grounds keep their own handling.

**The waterline, soft** (`water-shading.mjs` `WATER_SHORE_FADE`, `?shorefade=0`).
The sheet comes in from nothing over its first 2.5 m from the shore. For a
reached lake that is counted from the last wet node, so the sheet has faded out
before the bank cuts it. Every other sheet fades from its ring's own shore (a
window's cut is not a shore, as before).

**The far lakes** (`growFlatWaterMask`, `?waterreach=0`). Each far lake the model
does not know is grown one cell under its bank, and its quad one cell wider, so
the terrain draws its shore too. A lake that continues a mapped one, a cell a
ring covers and a lake's reach are left alone, so no two sheets overlap.

**Visby's coast** (`coastal-water.mjs` `growCoast`, `?waterreach=0`). The sheet
takes one cell more round the drawn sea outside the mapped window, and the
terrain mask covers the same cells. There the low surface gives way to the water
and anything above the sea's tolerance stays, pixel by pixel, so the coastline is
the ground's own. Tints and `isSeaAt` keep the conservative cells.

**No trees in the sea** (`coastal-water.mjs` `isWaterAt`, owner report). The far
forest was planted against `isSeaAt` alone, the conservative cells, and the
height test was skipped wherever a coastal sea exists. So trees stood on the
laser's sea surface along Visby's coast: on the pale strip before, and in the
sea once the coast was drawn by height. Planting now asks `isWaterAt`, which is
the same rule the terrain mask draws the coast by: a drawn cell whose ground is
within the sea's tolerance plus 0.3 m is water. With `?waterreach=0` the drawn
cells are the conservative ones, so the before plants as it did.

**The bank, damp; the shallows' bed, silt** (`SHORE_DAMP`, `?shoredamp=0`).
In the near tint, ground within 0.5 m above a reached lake's ceiling darkens
toward the waterline by up to 24%, and ground under the reached water takes half
the bed's silt, which the faded shallows show. The rule goes by height, not
distance, so a steep bank keeps a narrow band and a flat shore a wide one.

**Puttom at the laser's surface** (`water-plate-level.mjs`, `LASER_PLATE_COURSES`,
`?waterlevel=before`). Each lake is read inside its ring, clear of its banks by
6 m. The level is accepted only where at least 60% of the samples sit within
5 cm of their median, so a field or bank is never read as a plate. The level is
that median plus the measured-water display clearance (6 cm, as on Johannesberg,
Visby and Lidingo); the carved bed keeps the two surfaces apart. All 13 of
Puttom's lakes read as plates (64-99.7% of samples). The four in
`puttombuild/laser-features.json` agree with it to a centimetre:

| Lake | Pack | Laser record | Read now | Level now |
|---|---|---|---|---|
| Stor-Rossjon | 62.81 | 62.73 | 62.726 | 62.79 |
| Lill-Rossjon | 60.74 | 60.89 | 60.886 | 60.95 |
| Ovansjosjon | 51.51 | 50.96 | 50.956 | 51.02 |
| Trattjarnen | 49.66 | 49.81 | 49.806 | 49.87 |

(Stor-Rossjon's boot level before was 62.98 m, measured live.)

The map (`apps/golf/src/map`) reads the same rule; see its section below.

## What it costs

Measured on the owner's RTX 5080, WebGPU, Angso (the most water), same build,
interleaved, with the map work running on the same machine:

| | Boot | Bed carve | Reach | Near tint |
|---|---|---|---|---|
| `?waterreach=0` | 9.04 s, 9.39 s | 416, 448 ms | - | 1313, 1406 ms |
| Reach on | 9.75 s, 9.58 s | 626, 627 ms | 79, 82 ms | 1457, 1430 ms |

About 0.45 s of boot, most of it the bed carve's fine lookup across every level
of ring tiles. Baking each lake's reach into the prepared water would remove the
lattice work and most of the carve's share; that changes a published asset's
format and is left for its own batch. Draws are unchanged; the near-shore
splitting adds triangles beside the course only. Frame time was not measured.

## Evidence

- **Unit tests:** `water-reach.test.mjs` (a sketched ring inside a bowl lake,
  a basin past a ridge, the reach's limit, the plate cap, an island, a cut lake
  running on as another sheet, the traced outline, the conforming refinement,
  the bed and its carve, the damp bank, the far lakes' growth),
  `water-plate-level.test.mjs` and `coastal-water-grow.test.mjs`.
  `water-above.test.mjs` takes the shading's new option.
- **Pictures** (`docs/graphics/water-shores-2026-11-07/`), WebGPU, `det=1`,
  evening light, each before (all four switches) and after:
  - Puttom's 12th green from above the lake (`puttom-h12-near-*`) and from a
    low eye across its shore (`puttom-h12-low-*`): the ring's chords, corner and
    dry strip are gone, and the shore is the ground's;
  - Visby's coast north of the mapped window (`visby-coast-north-*`): the 32 m
    staircase is gone, and the extension's vertices now carry their distance to
    the coast (`shoreDistances`), so a band of shallows runs along its shore.
    The straight colour seam where the window's wide shallows meet the
    extension, across the coast at the window's edge, is narrower but still
    there: the window's sheets draw a wider shallow band than a 32 m cell can.
  - The same coast cropped (`visby-trees-*`): before the planting fix, about
    two dozen far-forest trees stood in the sea along it; after, none.
  - Visby's 4th from behind the green, looking north along the coast with the
    course in view (`visby-h4-course-after`). That coast lies inside the
    mapped window, where the sheet is the surveyed polygon, so it looks as it
    did; the steps were outside the window.

## Not established

- **Phones and WebGL2 pictures.** Judge the fade and the coast on a phone.
- **The far lakes' grown cell** at a low camera on WebGL2: the uncarved plate
  beside a far lake sits 15 cm under its sheet, as it did inside the old mask.
- **Visby's near shore**: its mapped sheets fade at their own polygons; where a
  polygon lies inside the laser's coast there is still a narrow plate beside it.
- **The other grounds' levels** keep the boot rule's quarter metre; the reach's
  ceiling holds their water to the laser's surface, but the sheet stands where
  the level says. Puttom's rule can be extended to them course by course.
- **Frame time.**

## Reproduce

```sh
pnpm exec vitest run apps/golf/src/engine/water-reach.test.mjs apps/golf/src/engine/water-plate-level.test.mjs apps/golf/src/engine/coastal-water-grow.test.mjs
pnpm --filter @banvy/golf build && node tools/serve.mjs apps/golf/dist 8621
# then compare ?bana=puttom&hal=12 with and without ?waterreach=0&shorefade=0&waterlevel=before
```
