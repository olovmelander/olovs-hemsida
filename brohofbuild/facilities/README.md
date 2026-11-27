# Bro Hof's authored campus

One Blender model for both courses: the castle, its terrace and forecourt, the avenue's gate, the round
pavilion and the two halfway houses, and the grounds' furniture: the flagpoles, the terrace's parasols, the practice
greens' flags and the range's kit. The app takes it whole or not at all
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
in its own scene, and no textures: 22 facilities, 27,087 triangles, 1.5 MB, 27 plain materials (the brightest,
the white flags, at 0.72 linear luminance, under the glow's 0.86).

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

| Flagpoles (27 Nov) | Eight, one part each (`flagpole-a` to `-h`): position and height (8.7-9.4 m) from the laser, which the tree pipeline took for thin conifers (`tree-bro-hof-014041`, `014308`, `014011`, `014115`, `014034`, `014528`, `014012`, `014116`); each stands where the 2025 orthophoto has a pole's shadow with a flag, on open lawn. Each part clears no-tree ground 1.2 m round its pole, so the false tree is not drawn (display only). A Swedish flag by the path, white on the rest (the club's aerial photograph). | Flag sizes (a quarter of the pole); the flags' prints are not drawn. |
| Terrace parasols | Six, their centres, size and turn (2025 orthophoto). | Height, the tables under them. |
| Practice greens' flags | The greens as the course model traces them: five putting greens (three short flags each), the putting course (its 18 numbered flags, club page) and the short-game area's four greens (two full pins each). | Every cup: no photo resolves one, so they are spread along each green; the putting course's numbers are not drawn. |
| Range mat line | The artificial-turf strip's ends (2021 and 2025 orthophotos), a ball pile at every bay (counted on the 2021 photo: 30 at 3 m), the ball dispenser's place (2025). | The dispenser's form, the bags. |
| Range grass tee | The line the golfers stand along on the 2025 photo. | The rope and stakes. |
| Range targets | The five traced target surfaces (course model). The greens with bunkers on the field's east side are the short-game area's, flagged with the practice greens. | The flags' colours; the boards' figures are metres from the middle of the mat line, rounded to 5 m, not the club's. |

Every flag stands out to the east, before the prevailing westerly. The boards' figures are Blender's built-in font,
converted to triangles. The build reads the 1 m terrain from `BROHOF_TERRAIN` when that is set (a worktree has no
acquisition cache of its own).

Photographs used for reference only, never as textures or published assets: *Bro Hof Slott Entre.jpg* and
three others from Wikimedia Commons (CC BY-SA 4.0), kept in the private `brohofbuild/cache/club-sources`.

Not modelled here: the courtyard wings (`w370846847`, `w370846866`), the house north-east of the forecourt
(`w370846850`), the long red-tiled building (`w370846851`) and the range shelter (`w370846846`). The house
kit draws those from their footprints and measured roof colours.
