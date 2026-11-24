# Bro Hof Slott: walkthrough

Two 18-hole courses on one new ground, published 24-25 November 2026:
[The Stadium Course](../../brohofbuild) (`bro-hof-stadium`) and [The Castle Course](../../brohofcastlebuild)
(`bro-hof-castle`). Sources and rights: [bro-hof-source-research.md](bro-hof-source-research.md). How the pipeline
runs, step by step: [pipeline v2](../pipeline-v2.md).

## What is there

| | Stadium | Castle |
| --- | --- | --- |
| Holes | 18, five tee colours | 18, four tee colours |
| Greens, tee decks, fairways, bunkers | 18, 84, 18, 62 | 18, 71, 20, 48 |
| Waste areas | none | 10, with 40 grass islands |
| Tee marks against the 2024 card | median 0.0 m, worst 8.8 m (9 red) | median 0.1 m, worst 13.8 m (6 red) |

- **Ground:** 469 tiles of Lantmäteriet's 1 m terrain (laser 2020-11-06 and 2021-03/04), 44 water bodies, 8 bridges,
  stone walls on 17 and 18 and boulder edges on 9, 11, 15 and 16.
- **Outlines:** traced on the 0.16 m orthophoto of 2025-06-14, never on a hole guide. All 36 holes were looked through
  against the photo on 24 November.
- **Trees:** 15,206 placed one by one in the inner 2,048 m, typed conifer or broadleaf where the April photo tells.
- **Campus:** the castle (levels from the laser, façade from a photograph), terrace, forecourt, avenue gate, pavilion and
  both halfway houses, in one Blender model ([README](../../brohofbuild/facilities/README.md)). 466 other houses come
  from the house kit with measured roof colours.

## What is known not to be right

- **The trees miss their gate.** 90% was asked of both precision and recall on 166 unseen trees; they reach 0.784 and
  0.807 (F1 0.795). The automatic first generation reaches 0.662 and 0.530 (F1 0.589) on the same trees, so by the
  owner's rule of 24 November ("publish if better") they ship. In park and building surroundings their precision is
  lower than the automatic ones' (0.419 against 0.467). 2,079 doubtful trees are held back unreviewed, and 392 the 2025
  photo does not show were removed by a rule, not by eye. Trees planted after 2021 are missing.
- **The laser is older than the photo in places.** Castle 18's pond corner was filled after the flight: the terrain still
  shows water under today's yellow and blue tees, so both stand on the laser's own platforms beside them (12 and 8 m
  away). 3.4% of the inner ground differs from the 2020 surface by 0.4 m or more, mostly the building site in the west.
- **Stadium 14:** the club's 2026 drawing shows about 12 small bunkers the June 2025 photo does not have. Not modelled.
- **Stroke index:** the hole plates give 14 as 3 and 18 as 17; the 2024 card and the club's page give 17 and 13. The card
  is used.
- **Out of bounds on 18** is only schematic in the sources and is not staked.
- **No survey control, no phone timings.** Bro Hof came in on the owner's recorded acceptance
  ([owner-acceptance.json](../../course-workflows/bro-hof/owner-acceptance.json)), which names each open item.

## Checking it yourself

```powershell
corepack pnpm --filter @banvy/golf build
node tools/serve.mjs apps/golf/dist 8641        # then open http://127.0.0.1:8641/?bana=bro-hof-stadium&hal=17

$env:BANVY_GPU=1
node tools/gpu-pass.mjs --dry-run               # every bake and check, in order
node tools/gpu-pass.mjs --only bro-hof-stadium,bro-hof-castle --from boot-hi
node tools/gfx-gallery.mjs --base http://127.0.0.1:8641 --label mine --adhoc bro-hof-stadium:18:fritt:dag,bro-hof-castle:4:fritt:sommar
node tools/check-course-quality.mjs --ground bro-hof
```

Worth looking at: Stadium 17 (the island and its wall), 18 (the castle over the green), 16 (the boulder point in
Mälaren), 9 and 11 (the shared lake); Castle 4, 6, 8 and 10 (the waste areas), 5 and 9 (the creek), 18.

## Befores

- `?buildingGeometry=source` draws the mapped footprints instead of the campus.
- The first generation (automatic trees) stays published for rollback:
  `grounds/bro-hof/ground-v2-bf788372….json`.
