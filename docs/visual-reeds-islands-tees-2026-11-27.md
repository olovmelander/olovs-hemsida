# Reeds on the bank, islands as land, every tee's line of play (27 November 2026)

Three faults the blind visual review of Bro Hof found in Detaljerad 3D (`course-workflows/bro-hof/visual-review.json`,
Stadium 7, 11, 15 and 18), fixed where they were made. Each rule is general; all three move plantings or beds, so
every course's prepared data was baked again, and each before plants or carves live.

## Reeds stood in open water

The reed scan (`main.js`) plants a reed where the ground lies at a lake's or pond's level within its shore field, which
reaches a 6 m cell on both sides of an outline. A pond flown full is ground at its own level all the way across, so
reeds stood up to 17 m out in open water, thinned near play to single dark stems. Measured on the boot, by a probe that
reads every reed against the outlines:

| Ground | Reeds | Inside an outline | 4 m or more inside |
| --- | --- | --- | --- |
| Bro Hof Stadium | 13,023 | 2,938 | 1,120 |
| Bro Hof Castle | 14,382 | 3,643 | 1,572 |
| Puttom | 4,135 | 1,433 | 368 |
| Veckefjärden | 2,179 | 708 | 111 |
| Tjusta | 3,091 | 343 | 75 |

A reed now stands in still water only where a mapped bed puts it, a silt flat's shallows or a mapped wetland, and
elsewhere on the bank: never inside a lake's, pond's or the sea's outline, and an island the outline holds is bank
(`inStillWater` in `engine/ground-cover.mjs`). It also keeps off every tee's line of play (below), where the hole
line's rule only thinned it: a single stem on the bank stood on Stadium 7's aim line 20 m in front of the tee.
Veckefjärden's reserve fringe and its silt-flat beds stay; Puttom's 14th loses a row of single stems in its lake.
`?reedbank=0` is the before.

## Islands were drawn under their water

The pack compiler kept every water's outer ring and dropped its islands (`packages/course-pack/runtime-water.mjs`),
so the bed carve lowered Bro Hof's 1.2 ha island in Mälaren, with its 39 laser trees, 3.5 m under the lake. The pack
now carries `innerRings` (water without islands keeps its bytes; Bro Hof's two packs were republished through the six
stages), and an island is land: the bed field claims no cell on one and clears a flat cell there
(`v2-water-bed.mjs`), the reach never floods one and counts its shore as a bank (`water-reach.mjs`), the sheet has a
hole there and its shore distance counts the island's shore (`water-shore.mjs`, `main.js`), so the sheet has faded
out before the hole's edge and the ground draws the waterline. Only Bro Hof's packs carry islands today (25 in six
outlines); Tjusta's model has four waters with islands and gets them at its next republish. Lätt 3D does not read them yet
(`map/map-course.mjs`). `?waterislands=0` is the before.

## The cover stood in the forward tees' line of play

The cover lattice keeps its tussocks, bushes and stones 24 m off the hole's line, which starts at the back tee.
Stadium 18's yellow and blue deck lies 41 m west of it, and a bush stood on its aim line; Johannesberg's 3rd had one
too. Every tee mark's line of play is now the segment from the mark to its landing area, the aim the tee view frames
(`engine/tee-corridors.mjs`, from `tee-view.mjs`), and the lattice and the reeds keep 24 m off each. On Stadium 166 of
3,565 bushes stood in one. `?teecorridor=0` is the before.

## Checks

`ground-cover.test.mjs`, `tee-corridors.test.mjs` (on Stadium 18's own pack), `v2-water-bed.test.mjs`,
`water-reach.test.mjs`, `water-shore.node-test.mjs` and `visual-fix-switches.test.mjs` (the three befores plant live).
The three befores together reproduce the earlier counts exactly. The pictures were taken on the GPU before the bake:
Bro Hof Stadium 7, 11, 15 and 18 from the tee, the island from above and from the shore, Castle 4 and 17, and on
Puttom, Veckefjärden, Tjusta, Johannesberg and Ängsö.
