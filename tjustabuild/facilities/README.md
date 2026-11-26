# Tjusta Gård's authored buildings

One Blender model for the course: the clubhouse barn with its cross wing, annex and canopy, the terrace on posts
beside it, the farm's two machine halls and the range's tee shelter. The app takes it whole or not at all
([campus-facilities.mjs](../../apps/golf/src/engine/scenery/campus-facilities.mjs)); until it has been
checked, and with `?buildingGeometry=source`, the house kit draws the mapped footprints instead.

```sh
blender --background --factory-startup --python tjustabuild/facilities/build_campus.py -- --out tjustabuild/cache/facilities
blender --background --factory-startup --python tools/facility-pipeline/preview-facility-glb.py -- \
  --manifest tjustabuild/cache/facilities/facilities-v1.json --out tjustabuild/cache/facilities/preview
node tools/facility-pipeline/publish-facility-glb.mjs --from tjustabuild/cache/facilities
node tools/facility-pipeline/validate-facility-glb.mjs --manifest apps/golf/public/models/tjusta/facilities-v1.json
pnpm exec vitest run apps/golf/src/engine/scenery/tjusta.test.mjs
```

The build needs the acquired 1 m terrain (`packages/course-geo/toolchain/.cache/acquisition/tjusta-ground-rings`),
because walls, posts and the stair stand on the ground under them. It uses Blender's data API only, in its own
scene, and no textures: 5 facilities, 1,276 triangles, 89 kB, 15 plain materials (the brightest, the window
frames, at 0.73 linear luminance, under the glow's 0.86). Two builds give the same bytes. The mesh helper is the
facility pipeline's own ([campus_mesh.py](../../tools/facility-pipeline/campus_mesh.py)), first used here.

## How the levels were read

The dense laser returns round each building are fetched into the private cache and summarised in
`geo_data/course-v2/tjusta/acquisition/microterrain-summary.json` (targets in
`tjustabuild/reference/microterrain-targets.json`):

```sh
node --env-file=.env packages/course-geo/intake/acquire-microterrain-laser.mjs --ground tjusta \
  --discovery geo_data/course-v2/tjusta/acquisition/d2-discovery.json --targets tjustabuild/reference/microterrain-targets.json \
  --summary-out geo_data/course-v2/tjusta/acquisition/microterrain-summary.json --cache-dir tjustabuild/cache/microterrain
node tools/facility-pipeline/measure-building.mjs --points tjustabuild/cache/microterrain/clubhouse-barn.points.json \
  --context tjustabuild/mapping/context.geojson --building w48232863
```

`measure-building.mjs` lays the returns on the mapped footprint's axes. The footprints here are drawn about a
degree off their roofs, so each building's frame was then turned onto a line fitted through its own ridge
returns (the barn's: 22 returns over 56 m, 0.11 m off the line), and every level read again in that frame.
The roofs are dark and return little: the levels come from the ridges, the eaves and the gambrel's break, never
from a roof's face. The summary is not yet in the ground's source manifest: adding it there changes the manifest
the published generation was accepted on, so it joins at the next generation.

## What is measured and what is not

| Part | Measured (Laserdata Skog 2021-04-17, RH 2000) | From the photographs | Estimated |
| --- | --- | --- | --- |
| The barn (`w48232863`) | Ridge 33.69 over 56 m; eaves 26.55, 16.1 m apart; the gambrel's break 30.9, 2.55 m in from the eave. Ground 19.2 north, 20.6 east, 21.2 south. | The north front: the low door, the two round vents, the concrete dock, corner boards and bargeboards. | The east wall's two doors; the south gable. |
| Its cross wing | Ridge 30.08, 5.7 m in from its north wall; eaves 25.55 both sides; the west gable 15.2 m and the east gable 18 m from the barn's ridge. | The west wing's three windows above and two below, its door under a small roof with the round sign; the east wing's wide grey double door and the dark band under its eave. | The east gable's doorway; every wall toward the yard. |
| The annex on the south gable | Ridge 25.35, eaves 23.5; 5.1 m long, 8.6 m wide. | | Its door. |
| The canopy on the west wall | A flat roof at 24.15, 9.6 m long. | | Its depth (3.6 m) and its four posts. |
| The terrace | The deck's floor 22.26 and its rail 23.32, 15 m long and 3.5 m deep before the building; the building behind it: ridge 26.58, eaves 23.86. | A timber deck on posts with carts under it, a slatted rail, the low black-roofed building behind, a stair at the west end. | The posts' spacing, the stair's steps, the two noticeboards under the deck. |
| The machine hall (`w48232860`) | Ridge 31.54 and both eaves 26.09, each a line through the returns; 62.6 m long, 22.4 m wide. | Dark walls, where the west gable leans into view on the orthophotos. | The three doors. |
| The grey hall (`w189730445`) | Ridge 30.2 (three returns); the east eave 22.9. | A gabled hall and a cross hall at its east end whose roofs meet in two valleys (orthophotos of 2025 and 2019). | The main eaves (26.0, from four returns between 25.8 and 26.4); every wall; the doors. |
| The range shelter (`w293867832`) | The roof's high edge 21.7; ground 17.3. | Two open bays lined in white under a single-pitch black roof, red ends, a band of frosted panes at the back. | The roof's low edge (20.45) and the bays' depth. |

Photographs used for reference only, never as textures or published assets: the club's own pictures of the
clubhouse, the 18th across the pond, the entrance side and the range shelter, kept in the private
`tjustabuild/cache/club-sources`.

Not modelled here: the long red-tiled stable (`w48232864`), the row house (`w48232870`), the farmhouse and the
smaller houses west of the yard. The house kit draws those from their footprints and measured roof colours.

## What the first build got wrong

- The cross wing's roofs were first run 2.2 m into the barn, and their eaves stuck out across the barn's north
  front. They now start at the barn's wall and climb its lower slope in two valleys.
- The range shelter's dividing wall was a box and stood through the roof's low side. It follows the slope now.
- The machine hall's walls were as dark as its roof, and from the 9th green it read as a void. The walls are the
  blue-black the orthophoto shows, the roof stays black.
