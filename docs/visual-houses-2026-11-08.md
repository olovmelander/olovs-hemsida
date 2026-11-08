# Veckefjärden's houses, 8 November

**Owner request, 8 November:** "on veckefjärden, i want more things like houses
etc to be modelled in Blender to not just look like Boxes, do this for the inner
detailed ring!" And then: "are we able to find the real colors of the houses
based on the lantmäteriet maps or photos??"

Until now every ordinary building was a box in the building batch: walls in a
hashed palette colour, a white fascia line, and a gable roof with no thickness.
Only the clubhouse campus, the church and the K90 jump were Blender models.

The inner ring is the course's own extract: the surroundings record's `inner`
box, where the pack maps every footprint. The town beyond it keeps its boxes in
the haze.

## What changed

**The house kit, modelled in Blender** (`tools/blender-props/house_kit.py`).
These are the parts a Swedish house is made of, built headless:

```sh
blender --background --factory-startup --python tools/blender-props/house_kit.py
node tools/blender-props/publish-house-kit.mjs tools/blender-props/out/house-kit.glb
```

It has 24 parts: windows (two-light with glazing bar, small four-pane, tall,
wide, industrial strip, modern and shop front), a panelled front door with its
step, a steel side door, a board door with its Z-brace, a garage door, a barn's
X-door, a roller door, a block's entrance with canopy, a gabled porch
(farstukvist), a lean-to porch, a balcony, plastered and brick chimneys, corner
boards, a downpipe, and the flat windows and door the far houses take.
Together they have 1,749 triangles in one 158 KB GLB,
content-addressed in `models/props/` with its record.

Each mesh is `<part>__<channel>`:
- `wall`, `trim`, `roof` and `accent` are painted white and take the house's
  colours per instance;
- `fixed` keeps its own colours;
- `glass` is drawn glossier.

**The plan of each house** (`engine/house-kit.mjs`, `planHouse`). The footprint
is never moved or changed: the walls stand on it.
- **Type.** Each footprint gets one from its tags, its size and the land use
  round it: villa, shed, outbuilding (with a garage door when it faces a road),
  barn, hall, block, store or school.
- **Shell.** Into the building batch, so the wall's foot, the ridge and winter's
  snow reach it as before:
  - a concrete plinth, and the walls;
  - a roof with thickness, overhanging eaves and gables, fascia, barge boards
    and gutters;
  - roofs are gable, hip, gambrel (barns), a hall's low pitch, or flat behind a
    parapet;
  - an L or a T is split into rectangles and takes a cross gable, each wing
    reaching under the main roof no higher than its ridge.
- **Parts.** Laid along the walls:
  - the front door on the wall facing the nearest road or path, and a porch
    where the eaves leave room for one;
  - windows at the storeys' sills, clear of the corners and of each other, a
    wide window on the garden side, and the gable's own windows where the roof
    leaves room;
  - corner boards at every right-angled corner, two downpipes and a chimney on
    the ridge.
- **Storeys.** One, one and a half (a steeper roof, windows in the gables) or
  two, by size and chance.
- **Colours.** Each house's wall colour is the one the batch gave it.

**Drawn** as one instanced mesh per part and channel (42 draws at
Veckefjärden). Each instance carries its house's colour (`aTint`) and the
ground under it (`aGround`) as instanced attributes. So the wall's foot and the
snow work as on the batch, and the tint comes before the snow (an instance
colour would tint the snow too). Porches, chimneys, balconies, entrances and
roller doors cast shadows. A window frame is too thin to be worth the sun's
map.

**How much of each part goes by where the house stands** (`PARTS_REACH`,
`FAR_PART`, `partAt`). This follows the owner's question whether the detail
was worth it, and the reply "Set that up!". It is the trees' rule: detail goes by
where a thing stands, never by how far the camera is.
- **Within 800 m.** A house this close to a hole's line (the distance the
  trees' bands measure) takes every part as modelled.
- **Further out.** A house keeps every part too, but its windows and doors are
  flat plates from the same kit (`window_far`, `window_far_alu`, `door_far`). A
  plate is a frame, the glass and a glazing bar: six triangles where a window
  has about ninety, stretched to the near part's size.

Why 800 m:
- 21 of the 344 mapped buildings stand within 500 m of a hole line, and 194
  within 800 m. Past about 500 m a window is a pixel.
- A first trim dropped the far houses' windows altogether. From the free camera
  they read as boxes again beside the near ones, so it was replaced by the
  plates.

`?houseparts=all` lays the near parts everywhere.

**The roofs' real colours** (`geobuild/facilities/roof-colours.py`). An
orthophoto looks down on every roof, so it can colour them. It cannot see a
wall, so walls keep the palette. Street-level photographs would be the way to
the walls' colours: Mapillary is openly licensed but needs an API token, and
Google Street View's terms do not allow it.

How a roof is read:
- **Source.** Lantmäteriet's 2024 orthophoto (16 cm, CC BY 4.0). The four
  pinned 2.5 km COGs are read over authenticated HTTPS, a small window per
  footprint; no pixel is stored anywhere.
- **Footprint.** Each ring goes to SWEREF 99 TM and is shrunk by a metre: a roof
  leans up to a metre off its footprint in a frame-camera orthophoto, and the
  eaves overhang.
- **Pixels left out.** Overhanging crowns (NDVI from the near-infrared band) and
  the darkest and brightest 5%. Both slopes count.
- **Colour.** The median sRGB.

The result is 332 colours for the 344 footprints. They are checked against the
photograph in a sheet of crops with each outline and the colour picked. Most
roofs here are dark grey (the palette guessed clay red for two in five), some
light metal, about forty red tile. Each record is tied to its footprint by
`ringCheck` (FNV-1a of the ring's JSON), so a re-traced footprint gives up its
colour. Both Veckefjärden routings' packs match all 344.

The photograph is a roof under a June sun, through haze, and a light metal roof
glints. The game lights it again (`roofAlbedo`, `ROOF_EASE`):
- luminance above 0.22 is eased toward 0.34;
- the chroma the haze took is given back (×1.3, luminance kept).

The measured median is 0.11, where the palette's slate already sat.

**Opt-in.** A course opts in with `export const houseKit = true` on its scenery
module and its roofs with `roofColours`. Only Veckefjärden does.

## Puttom, Ängsö and Upsala GK (the same evening)

**Owner request:** "We need to do this for the other courses aswell, but wait
with veckefjärden and Johannesbwrg, we can start with Puttom and Ängsö and
Uppsala GK!!!" Johannesberg is untouched. Veckefjärden keeps what it has.

- **The inner ring.** None of the three has a surroundings record, so its inner
  ring is the whole pack extract.
- **Opt-in.** Each scenery module opts in with `houseKit` and its own
  `<course>-roof-colours.json`. Upsala's module serves both its routings.
- **More tags.** The classifier takes the other grounds' tags (`garage`, `hut`,
  `farm`, `farm_auxiliary`, `sport`, `outbuilding`, `shed`). Where a measured
  ground carries it, Lantmäteriet's own purpose (`municipalSubtype`: Bostad,
  Komplementbyggnad, Samhällsfunktion) comes first.
- **Churches.** A building named as a church (Läby kyrka) keeps the batch's
  drawing.
- **Carports.** A carport is a roof on posts, as a mapped shelter is.
- **Upsala is mapped-only** (`objectPlacement`). Its buildings take the parts on
  their own walls (windows, doors, corner boards, downpipes). They take nothing
  that would stand out from a mapped wall at a guessed place: no porch,
  balcony, chimney or canopy (`MAPPED_ONLY_LEAVES`, `mappedOnlyPart`). This is
  as the batch already leaves the clubhouse's chimneys and terrace off there.
- **The roof sampler** (`roof-colours.py --course`) now finds the tiles under a
  course's buildings itself.
  - It reads the newest flight that has each tile: 2024 at Puttom, 2025 at
    Ängsö and Upsala.
  - `--collection 2024_U2` pins Veckefjärden's. Its re-run is identical, but
    for one building west of the old four tiles, now coloured.
  - A clearly green median, or a footprint more than 60% canopy, is recorded
    without a colour (`sampled`, for review). Those are a building that has
    gone, or a hut under its trees.
- **Checks.** Sheets of crops, outlines and colours were checked against each
  photograph.

| | Kit houses | Within 800 m of a hole line | Measured roofs | Part triangles / draws |
|---|---|---|---|---|
| Puttom | 23 (the rest are its facility models) | 4 | 22 of 40 read, 37 coloured | 12,991 / 37 |
| Ängsö | 154, 18 of them residential fillers | 81 | 129 of 142 read, 135 coloured | 119,187 / 40 |
| Upsala (both routings) | 429 | 100 | 389 of 444 read, 404 coloured | 155,418 / 27 |

**Checked on the GPU.** At the owner's request the GPU was kept cool: one short
boot per course, at 1280 × 720, with two stills and no timing loops.
- Each boot logged no error.
- Upsala logs one WebGPU warning ("Draw with a vertex count of 0"), and it does
  so under `?houses=before` too, so it was there before.
- The materials are those already clean-booted on both backends at
  Veckefjärden.

## Every other course but Johannesberg (the same evening)

**Owner request:** "Now do this for all the courses except Johannesberg that is
am working on in parallel with the trees." This brought in Lidingö,
Norrfällsviken, Ribbingsfors, Tortuna and Visby. Johannesberg's two routings
are left alone: no file of theirs changed, and a test holds that every other
course opts in.

**What the five needed:**
- **A generic `house` tag.** Lidingö's, Tortuna's and Visby's packs call every
  building `house`, with a generic 5 m height that was never measured. There
  the tag is no evidence of a dwelling (`genericHouseTag`, over 90% of 20 or
  more), and the type comes from size, shape and land use.
- **Barn or farmhouse.** Both stand in the same farmyard. A barn is deep (the
  short side of the oriented box over 10.5 m) and a farmhouse is not. This
  replaced an even chance on every course.
- **Names.**
  - A water tower keeps the batch's drawing, as a church does.
  - A heating plant is a hall.
  - A preschool is a villa, and a school a school.
  - A refuse room is a shed, and a pump house an outbuilding.
- **Mapped-only.** Lidingö, Tortuna and Visby are mapped-only, so they take no
  guessed porch, balcony, chimney or canopy.
- **What keeps its own drawing.** Measured roofs (Lidingö's and Tortuna's TINs),
  authored models (Tortuna's eight), facility models and Visby's reviewed roof
  colours (`building-roof-review-2026.json`) are kept.
- **The sampler, three fixes:**
  - **Frames.** Lidingö's, Ribbingsfors', Tortuna's and Visby's packs are SWEREF
    99 TM shifted to an origin (their frame says so). The older grounds are
    metres about a WGS84 origin.
  - **Flights.** A region's flight has its own letter (U2, O2, K2, N2, F2...).
    The candidates come from each ground's own discovery records, newest first.
  - **Registration.** Traced footprints can sit a metre or three off their
    roofs. Each course is shifted, within 4 m, to where the most of its
    footprints lie on open roof (NDVI < 0.18) rather than lawn or canopy, and
    only when that gains at least 3 points per footprint.
    - Tortuna moves (-1.6, +1.3) m, Puttom (+0.6, -2.6) m and Ribbingsfors
      (-2.6, -2.9) m (east, north).
    - The others gain too little and stay where they are.
    - Check sheets before and after the shift show it sits the outlines on
      their roofs.
  - Every course was re-sampled by the final method; Veckefjärden's is pinned
    to its 2024 flight.

| | Kit houses | Within 800 m | Measured roofs (coloured of footprints) | Part triangles / draws |
|---|---|---|---|---|
| Lidingö | 554 | 554 | 545 (553 of 562) | 1,330,566 / 31 |
| Norrfällsviken | 273 | 180 | 263 (266 of 276) | 293,098 / 39 |
| Ribbingsfors | 357, 323 of them residential fillers | 62 | 34 (44 of 44) | 156,267 / 46 |
| Tortuna | 300 | 225 | 296 (305 of 309) | 285,398 / 31 |
| Visby | 25 | 24 | 24 (31 of 32) | 29,668 / 24 |

**Lidingö.** Every one of its houses stands within 800 m of a hole: it is a
villa suburb wrapped round the course. So it draws every part on every house,
as many triangles as Veckefjärden with every part everywhere: 0.1-0.3 ms on the
RTX 5080. 432 stand within 500 m and 254 within 300 m. A shorter
`PARTS_REACH` would trim it, if a weaker GPU needs it.

**The GPU was kept cool.** There was one short boot per course at 1280 × 720,
with two stills and no timing.
- No boot logged an error.
- Lidingö, Upsala and Visby log a WebGPU warning ("Draw with a vertex count of
  0"). On Visby it comes without the kit once the camera moves, and not with
  the kit while it stays still: it belongs to the camera's moves, not the
  houses.

## Before the merge (the same evening)

The owner asked whether anything needed optimising or improving before the
merge, and chose three of the answers ("Do 3-5!").

- **Low quality takes the flat windows and doors on every house**
  (`houseKitReach`, -1 at low quality). This is as the trees take their
  lighter model there. At Lidingö, low quality draws 122,834 part triangles in
  14 draws, against 1,330,566 in 31 at high quality. The picture keeps its
  windows. High quality is unchanged.
- **The roof files are split.**
  - The player imports a compact runtime file,
    `scenery/<course>-roof-colours.json`. It has schema 2, each coloured roof as
    `[index, ringCheck, colour]`, with the source and its licence.
  - The whole review record (every building, what was read, and why it was or
    was not coloured) stays beside the sampler, in
    `geobuild/facilities/roof-colours/<course>.json`.
  - The nine runtime files came to 65 KB, from 290 KB. They load with each
    course's scenery code.
- **Porches are kept clear of the trees** (`clearOfTrees`, `PROTRUDING`).
  - The lattice keeps its trees 6 m off every wall, but a measured tree can
    stand beside a house.
  - Where a trunk stands in the strip a porch reaches over (1.45 m either side
    of the door, 2.75 m out, with a 0.4 m clearance), the porch is left off. An
    entrance under such a trunk keeps only its doors, and the door keeps its
    step.
  - The trunks are indexed once, in 8 m cells, only when a porch is first
    weighed. At Veckefjärden that takes 11.9 ms, and 20 porches or canopies give
    way to trees. A mapped-only ground lays no porch, so it never builds the
    index.

Planning the houses costs 0.4-24 ms of main-thread time per course
(Veckefjärden is the most), measured in Node over each pack's own footprints.
The kit's 158 KB GLB downloads beside the facilities and is cached offline with
the other props (`banvy-props`).

## One building a course knows: Norrfällsviken's hotel (the same evening)

**Owner report:** "this is the hotel at norrfällsviken, not the big white
building we currently show", with the press and booking photographs.

**What had gone wrong.** OSM's footprint (`w1206117854`) is tagged only as a
restaurant. Its size and the residential land use made it a block of flats,
and its diagonal middle wing defeated the roof planner, so it was drawn flat
behind a parapet.

**What it is.** One storey of falu-red wood with white trim (the owner, from
the photographs), under orange-red tiled gable roofs. It is three wings in a U
round a pool, joined at the north-east by a short link, with glazed lean-to
verandas and a white gabled porch at the reception.

**A course may now state a building** (`houseKitBuildings` on its scenery
module, by the building's id):
- its type, storeys, pitch and colours;
- the wings its roofs follow, traced off the orthophoto in the course's metres
  (each ridge's ends, the width wall to wall, which ends are gables);
- an entrance with its porch, and glazed verandas, each given by a point beside
  its wall.

Such a building is drawn from its wings, as a facility's model is drawn from
its file: walls, plinths and roofs per wing, nothing hung on a wall that runs
inside another wing, the stated parts laid last. The source footprint stays the
data that obstacles, trees and the map read.

**The hotel's evidence.** The wings are traced off Lantmäteriet's 2024
orthophoto (`o69875_6775_25_mr24`).
- The roof pixels were picked by colour and profiled across each wing: the
  side wings north-south, 9.3 m across their roofs, and the middle wing at 28°.
- The OSM footprint sits 2-5 m south-west of the roofs, so the hotel now stands
  where the photograph shows it.
- The kit gained a glazed veranda bay (`veranda`) and its end (`veranda_side`),
  instanced along a wall.

**Two fixes for every course came out of it:**
- A building tagged as a restaurant, café, pub or hotel is never a barn or a
  block. Norrfällsviken's Fiskarfänget had been a barn.
- A flat roof read off the orthophoto keeps its measured colour; it had fallen
  back to the dark membrane.

## A block of flats stands among blocks of flats (the same evening)

**Owner report**, from a phone at Veckefjärden's tenth: "this house does not
fit into Veckefjärden, no multiple floors apartment buildings close to the
Veckefjärden course". It was a four-storey yellow block with balconies.

**What had gone wrong.** The footprint is tagged `building=residential`, at
244 m². The kit took any residential tag over 200 m² as a block of flats, and so
any residential land use over 320 m², or Lantmäteriet's `Bostad`. The orthophoto
shows a long house with its garage. A residential tag says only that people live
there.

**The rule.** Unless a footprint is tagged as flats (`apartments`, `block`), it
is a block only where another footprint that would be one on its own tags stands
within `BLOCK_COMPANY` (90 m) of its centre (`blockCompany`). Every footprint it
changed was checked against the orthophoto, and all are houses:

| Course | Footprint | Seen from above |
| --- | --- | --- |
| Veckefjärden | by the tenth, 244 m² | a house with its garage |
| Veckefjärden | 1.3 km off, 483 m² | a low L among villas |
| Ängsö | 223 m² | a villa |
| Ribbingsfors | 389 m² | a long gabled outbuilding |
| Tortuna | 422 m² | a two-storey house in the village |
| Uppsala (both routings) | 394 and 567 m² | attached houses, a large house |
| Lidingö | four of 324-352 m² | large villas by the water and in their gardens |

The blocks kept are the real ones:
- Veckefjärden's eight are Örnsköldsvik's three-storey slab blocks, over 1.1 km
  from any hole.
- Lidingö keeps 49 in its estates, among them two modern blocks that stand
  as a pair and so keep each other company.

`stats.houseKit.loneBlocks` counts the footprints turned to villas.

**Shallow jogs.** The house by the tenth then drew flat behind a parapet. Its
outline steps four times by 1.5-2.7 m, which no three rectangles at least 2.4 m
wide can follow. A footprint that will not part at its mapped steps is now tried
again with every step shallower than `HOUSE_KIT.jog` (2.4 m) straightened, as
long as the outline keeps its area within 12%. That gives about 70 villas and
barns pitched roofs where they had flat ones:
- Norrfällsviken's row of holiday houses (19 villas were flat, 1 is now);
- 20 at Lidingö and 13 at Uppsala;
- 10 at Tortuna and 4 at Veckefjärden.

The roofs were checked on the GPU at Veckefjärden, Norrfällsviken and Lidingö.

## The befores

- `?houses=before` draws every house as the batch did.
- `?roofs=palette` keeps the kit with the palette's roofs.
- `?houseparts=all` lays every part as modelled on every house, however far
  from the holes.

Both are display-only for the prepared startup data
(`preparedTintAllowed`).

## Numbers (Veckefjärden, high quality, 1600 × 900)

| | |
|---|---|
| Houses drawn with the kit | 788: 333 mapped, 455 inferred residential fillers in the extract |
| Types | 727 villas, 22 halls, 16 outbuildings, 10 barns, 9 blocks, 3 sheds, 1 school |
| Measured roofs used | 324 (the rest are the facilities' own models, or had no open roof) |
| Shell triangles (in the batch) | 51,048 |
| Houses within 800 m of a hole line (every part as modelled) | 297 of 788 |
| Part instances / triangles / draws | 17,161 / 567,636 / 46 (all parts everywhere: 1,199,880 / 42) |
| Triangles drawn in the scene's meshes | 0.96 M before; 1.55 M now; 2.18 M with every part everywhere |
| GPU time, RTX 5080, WebGPU, four house views | 3.3-4.4 ms before; 3.5-4.4 ms now; 3.5-4.3 ms with every part everywhere |

GPU time was taken with timestamp queries over 40 frames per view. The order
was now, every part, before, now again, all on one build. On the RTX 5080 the
three are within a few tenths of a millisecond of each other: it is not
short of triangles here. The trim is for weaker GPUs, which are, and it is
untimed on them.

## Evidence

- `apps/golf/src/engine/house-kit.test.mjs` (20 tests) covers:
  - the published GLB: its bytes, sha256, record, and every part and channel
    the planner lays;
  - footprints read as a rectangle, an L or neither, and the types;
  - the nearest road, and one plan every time;
  - roofs facing up, and walls standing on the footprint's corners;
  - the door toward the road, windows clear of corners and of each other, and
    four corner boards;
  - each type's own parts, the cross gable and the flat fallback;
  - the parts' matrices;
  - the measured roofs tied to both packs, the easing, and the source and
    licence;
  - the flat plates beyond 800 m of the hole lines, measured as the trees'
    bands measure;
  - the main.js wiring and the befores.
- **Clean boots.** `tools/check-gpu-clean-boot.mjs --course veckefjarden` is
  clean on WebGPU and WebGL2, at high and low quality. The most vertex outputs
  is 14.
- **Suite.** `vitest run apps/golf` (1,830 tests), the Node suite, the no-undef
  lint, the app-build isolation and `check:course-workflow` pass.
- **Pictures on the owner's GPU.** House clusters, the school, the sports hall
  and the industrial estate, under Dag, Vinter and Kväll: the snow lies on the
  shells' roofs and the porches'.

## Not established

- **Prepared startup data.** The engine's source revision moved, so tints,
  vista, scatter and water need their usual re-bake before this ships.
- **Phones.** Phones open the map mode, which draws its own houses. Nothing
  here was timed on a phone or a weaker GPU.
- **Building types.** These are inferred, not surveyed: a "yes" footprint
  outside any land use may be drawn as a barn that is a garage.
