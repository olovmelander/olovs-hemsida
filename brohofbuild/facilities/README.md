# Bro Hof's authored campus

One Blender model for both courses: the castle, its terrace and forecourt, the avenue's gate, the round
pavilion and the two halfway houses. The app takes it whole or not at all
([campus-facilities.mjs](../../apps/golf/src/engine/scenery/campus-facilities.mjs)); until it has been
checked, and with `?buildingGeometry=source`, the house kit draws the mapped footprints instead.

```sh
blender --background --factory-startup --python brohofbuild/facilities/build_campus.py -- --out brohofbuild/cache/facilities
node tools/facility-pipeline/publish-facility-glb.mjs --from brohofbuild/cache/facilities
node tools/facility-pipeline/validate-facility-glb.mjs --manifest apps/golf/public/models/bro-hof/facilities-v1.json
pnpm exec vitest run apps/golf/src/engine/scenery/campus-facilities.test.mjs
```

The build needs the acquired 1 m terrain (`packages/course-geo/toolchain/.cache/acquisition/bro-hof-ground-rings`),
because hedges, garden walls and the gate stand on the ground under them. It uses Blender's data API only,
in its own scene, and no textures: 9 facilities, 20,377 triangles, 1.1 MB, 15 plain materials (the brightest,
the white trim, at 0.68 linear luminance, under the glow's 0.86).

## What is measured and what is not

| Part | Measured | Estimated |
| --- | --- | --- |
| Castle (`w319035128`) | Plan: OSM footprint. Levels: Laserdata Skog 2020-11-06 (courtyard 13.7, cornice 24.3, mansard break 27.9, ridge 29.0, chimneys 30.3, wings 19.5, dome 38.9 m RH 2000; the bell's profile metre by metre). North façade's order: photograph. | The south façade repeats the north's rhythm; the spire above 38.9 m is scaled from the photograph; wing ends. |
| Terrace | Floor 15.1, lawn 11.3, side rooms 14.6 m, stair position (laser); plan (2025 orthophoto). | Balustrade, the side rooms' glazing. |
| Forecourt | Fountain, the clipped ring with its four bays, hedge lines (2025 orthophoto). | Hedge heights (0.85 and 1.05 m, against the entrance photograph). |
| Avenue gate | Pier and wall positions (2025 orthophoto); order of piers, walls and ironwork (photograph). | Heights, scaled on the opening. The leaves stand closed. The club's crest is left out. |
| Pavilion | Plate and dome radius (2025 orthophoto). Built after the laser; height from its shadow. | Columns. |
| Stadium halfway house (`w1235353673`) | Octagon (OSM), ground 6.3 and roof 11.7 m (laser), terrace and garden walls (2025 orthophoto). | Windows and doors. |
| Castle halfway house (`ortho-halfway-house-castle`) | Plan, ridge, terrace, hedges (2025 orthophoto). Not in OSM, not in the laser. | Heights, windows and doors. |

Photographs used for reference only, never as textures or published assets: *Bro Hof Slott Entre.jpg* and
three others from Wikimedia Commons (CC BY-SA 4.0), kept in the private `brohofbuild/cache/club-sources`.

Not modelled here: the courtyard wings (`w370846847`, `w370846866`), the house north-east of the forecourt
(`w370846850`), the long red-tiled building (`w370846851`) and the range shelter (`w370846846`). The house
kit draws those from their footprints and measured roof colours.
