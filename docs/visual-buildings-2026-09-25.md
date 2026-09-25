# Buildings batch, 25 September

**Owner request, 25 September:** "Do whats recommended". This followed the
owner's question: would the buildings item reach both the high-detail models
made in Blender and the lower-detail buildings? The recommendation was:
- the lower-detail buildings: darker wall bases where they meet the ground,
  and lighter roof ridges;
- the Blender models: a light touch only. A soft contact shadow where their
  walls meet the ground, applied to their own materials at load. Their colours
  match the real buildings, so they are not recoloured;
- measure the models' metal and glass against the glow batch's new
  thresholds;
- leave the distant town as it is.

This is item 13 of the visual audit, after [the glow batch](visual-glow-2026-09-25.md).

Every change keeps its before behind a URL switch. The switches keep the
prepared startup data eligible, so an A/B pair differs only in the change.
The complete before is:

`?wallbase=0&roofridge=0`

- `wallbase=0` keeps every wall its own colour down to the ground, on the
  batch and on the models.
- `roofridge=0` keeps each roof slope its one colour, in the triangles it had.

Nothing here moves a building or changes an outline. The ridge only cuts each
slope where its band begins. The re-bake refreshed source identities only.

## Where buildings come from

| Buildings | Courses | Wall foot | Ridge |
|---|---|---|---|
| Facilities made in Blender, from their GLB files | Ängsö, Johannesberg, Lidingö, Puttom, Ribbingsfors, Veckefjärden, Visby | lighter and lower | no |
| Facilities built from measured meshes | Norrfällsviken | lighter and lower | no |
| Authored models, one per building | Tortuna (eight) | lighter and lower | no |
| Landmarks | Veckefjärden's church and K90 ski jump | lighter and lower | no |
| The batch: every other building, in one vertex-coloured mesh | every course | yes | generic houses' gable and hip roofs |
| The distant town, boxes in the haze | where the record has one | no | no |

The batch also holds the scripted clubhouses of Upsala and Norrfällsviken,
Lidingö's architecture, measured roofs, canopies and small details. They take
the wall's foot with the rest of it; only the generic houses' gable and hip
slopes take the ridge.

## The changes

**The wall's foot** (`building-paint.mjs`, `wallFootColour`; `?wallbase=0`).
Where a wall meets the ground it darkens, the way the ground's own light fails
there, and comes back to its full colour higher up.

| | At the ground line | Full colour from |
|---|---|---|
| The batch | 72% of its colour | 0.9 m up |
| The models | 84% of its colour | 0.55 m up |

- **The models' foot is lighter and lower.** They model their own plinths and
  trim, and their colours were matched to the real buildings.
- **Walls only.** The foot fades out as a surface's normal turns upward (from
  |normal.y| 0.5 to 0.8). Roofs, paving, decks and steps keep their colour at
  the ground.
- **The ground.** At load, each vertex is stamped with the height of the
  visible ground under it (`aGround`). This is the same ground the player
  stands on (`terrainH`), read once per 25 cm cell. Each pixel reads its height
  over that ground.
- **The models' colours.** The shader scales each material's own colour, so a
  model keeps every colour it was made with; only its foot takes a share of it.
  - A material that paints itself (its own colour node) is left alone, with
    its meshes.
  - Two placements of one file share geometry and materials. A mesh whose
    geometry is already stamped gets its own copy, stamped where it stands.
  - A map's alpha passes through the foot. No model has a map today.

**The ridge** (`roofSlope`; `?roofridge=0`). Each slope of a generic house's
gable or hip roof:
- is 94% of its colour at the eaves, rising to its full colour 78% of the way
  up;
- lightens to 114% along the ridge, over the top 22% of the slope.

The ridge is baked into the batch's vertex colours. Each slope is cut where
the band begins, so it has two more triangles. A gable's end wall shares the
slopes' sloping edges, and it is cut at the same points. So no edge ends in
the middle of another, and nothing cracks.

**Left as they are:**
- **The models' colours.**
- **The generic clubhouse colour**, for a footprint named after its golf club.
  Each of the ten grounds draws its clubhouse with its own model or scripted
  build instead.
- **Flat and measured roofs.** They take no ridge.
- **The distant town.** A kilometre of haze takes it all.

## What it costs

- **Per pixel.** A few operations on building pixels (two smoothsteps, two
  mixes and a multiply), in the batch's shader and in each model material's.
  Nothing is added on crowns, ground, water or sky.
- **Per vertex.** One float, the ground under it: 4 bytes a vertex. At
  Veckefjärden, whose batch holds a town, that is 786,000 vertices and 3.1 MB.
- **At load.** Stamping runs once, before the first frame. Measured in the app
  boots on this container's CPU, over two runs (and a probe at Veckefjärden):

  | Course | Batch vertices | Model vertices | Stamping |
  |---|---|---|---|
  | Ängsö | 14,184 | 124,248 | 18-20 ms |
  | Tortuna | 34,287 | 74,847 | 24-38 ms |
  | Norrfällsviken | 114,615 | 12,546 | 16-29 ms |
  | Veckefjärden | 535,674 | 250,647 | 104-134 ms |

  Most of it is reading the ground. Veckefjärden's batch reads 93,519
  distinct 25 cm cells, at about 0.5 µs each. A coarser cell barely helps
  (72,550 cells at 1 m), because the houses are spread out.
- **Triangles.** The ridge adds two triangles a roof slope: 1,224 at Ängsö
  (612 slopes) and 47,200 at Veckefjärden (23,600 slopes).
- **Copies.** No painted model shares geometry with another today, so none
  was copied.
- **Nothing else is added:** no draw call, pass or texture.

Nothing was timed on a GPU.

## Metal, glass and white walls against the glow

The glow batch lowered the glow's threshold for a low sun: golden hour 0.70,
dawn 0.60 and the midnight sun 0.50, from 0.86 for every light. The isolated
check measured every material of the ten model files under each low sun, from
three sides. It records what of each material reaches its light's threshold,
in linear luminance before exposure. 26 of the 120 materials reach it
somewhere.

**Metal and glass glints are not new.** Their brightest pixels were already
past 0.86:
- Veckefjärden's metal and grey roofs toward a golden sun: up to 3.0;
- the ski jump's rails: 2.2, and the church's windows: 1.55;
- Tortuna's roof flashing under the midnight sun: 3.6;
- Visby's roof: 5.6, and Puttom's metal roof at dawn: 1.28.

They are glints: under 13% of each material's pixels pass.

**Sunlit white and cream walls are new.** Under the midnight sun, broad white
walls pass where at 0.86 they did not:

| Material | Brightest | Pixels passing |
|---|---|---|
| Veckefjärden's white | 0.84 | 99% |
| The church's trim | 0.81 | 97% |
| The church's plaster | 0.76 | 94% |
| Puttom's white | 0.73 | 85% |
| Puttom's cream | 0.61 | 79% |
| Johannesberg's white | 0.76 | 74% |
| Lidingö's white | 0.72 | 55% |

At golden hour, Tortuna's and Visby's white trim pass more than before: their
brightest pixels, at 0.92, passed 0.86 already.

So under the midnight sun a sunlit white wall has a soft halo. In
[the pictures](graphics/buildings-2026-09-25/white-facades.jpg) it is faint:
the church and Tortuna under the midnight sun, glowing at 0.86 and at 0.50.
Judge it on the owner's GPU. If it reads as too much, these are the options.
None was taken here.
- Keep it: sunlit white under a low sun is where a painter puts light.
- Raise the midnight sun's and dawn's thresholds part of the way back, and
  re-solve the clouds' shine for them. `glow.test.mjs` holds the rule.
- Lower the midnight sun's glow strength.
- Mask what may glow. That needs an extra render target, which costs.

## Evidence

**Unit tests** (`apps/golf/src/engine/building-paint.test.mjs`):
- the foot's curve: its share at the ground line, full colour at its height,
  walls only;
- a roof slope: the same outline, facing the same way, each corner coloured by
  its height;
- a gable roof and its end walls: no edge ends in the middle of another;
- the ground stamped under each vertex, in the world, once per cell;
- a model: its own colours kept, a self-painting material left alone, a clone
  stamped where it stands;
- two placements of one model, painted one call apiece: the second is painted
  too and stamped where it stands;
- `main.js` wiring: both befores, the batch's foot and slopes, and every
  model's foot as it is installed.

`authored-buildings.test.mjs` runs `main.js`'s own building loop: it paints
the authored model it adds, once. `visual-fix-switches.test.mjs` keeps both
before switches display-only.

**Isolated browser check**
([`check-isolated.mjs`](graphics/buildings-2026-09-25/check-isolated.mjs),
[result](graphics/buildings-2026-09-25/isolated-check.json)). It runs in
SwiftShader, on WebGL2 and on WebGPU with reversed depth. It draws the batch's
houses as `main.js` builds them, and the courses' own model files, each with
and without the change.

How each pixel is judged:
- **Its own expected change.** A paint scales a surface's colour, but only
  part of a pixel's light follows its colour: the specular sheen and the haze
  do not. Each pixel's share is measured in the same view with every colour
  scaled by 0.8. A paint of k should then change the pixel by
  1 + share × (k − 1).
- **Settled renders.** Every read-back is drawn until two renders in a row
  agree. On WebGPU the first renders of a new scene or material differ; one
  needed a third render.
- **Labels.** Each pixel's height over its stamped ground, its normal and its
  material are read in passes without antialiasing, as the colour is.

Results, the same on both backends:
- **The batch's wall foot** (two houses on ground sloping 12%, at golden hour
  and at noon). 4,970 pixels change, every one on a wall's foot. Every other
  pixel keeps its value. Each pixel's change is its expected one: the median
  and 90th-percentile errors are under 0.0005 in every band. Walls' share of
  their light is 0.93 at golden hour and 0.90 at noon.

  | Height over the ground | Paint | Measured at golden hour |
  |---|---|---|
  | 0-0.15 m | 0.726 | 0.741 |
  | 0.15-0.3 m | 0.764 | 0.777 |
  | 0.3-0.45 m | 0.825 | 0.835 |
  | 0.45-0.6 m | 0.895 | 0.900 |
  | 0.6-0.75 m | 0.956 | 0.959 |
  | 0.75-0.9 m | 0.993 | 0.994 |

- **The ridge.** 5,608 roof pixels change. Their paint runs from 0.941 at the
  eaves to 1.126 nearest the ridge: the pixel nearest a line lies up to a
  pixel's footprint inside it. Each pixel's change is its expected one within
  0.0005. Roofs' share of their light is 0.92 at golden hour and 0.85 at noon.
  Off the roofs, only pixels touching a roof change, and rounding: 0.4% or
  less, the half-float target's last bits, where a gable end's cut moves a
  flat-shaded pixel's last bit.
- **The models**, at golden hour, from eye height outside each model's
  largest building: toward the sun, away from it and from the side.
  - Every changed pixel is a wall's foot, touches one, shows one through
    glass, or changed by no more than rounding.
  - Each foot pixel's change is its expected one: the 90th-percentile error
    is at most 0.003.
  - The foot is in view on nine of the ten. The ski jump shows four pixels of
    it, at its feet.

  | Model | Meshes | Foot pixels in view | Wall in the foot's band |
  |---|---|---|---|
  | Ängsö | 141 | 1,050 | 457 of 5,879 m² |
  | Johannesberg | 183 | 5,059 | 1,112 of 26,706 m² |
  | Lidingö | 191 | 198 | 304 of 9,160 m² |
  | Puttom | 150 | 633 | 405 of 8,948 m² |
  | Ribbingsfors | 1,064 | 11,645 | 762 of 8,905 m² |
  | Veckefjärden | 89 | 697 | 544 of 7,320 m² |
  | Veckefjärden's church | 12 | 7,655 | 62 of 4,277 m² |
  | Veckefjärden's ski jump | 15 | 4 | 3 of 5,304 m² |
  | Visby | 283 | 148 | 683 of 6,864 m² |
  | Tortuna's clubhouse | 12 | 7,795 | 61 of 1,486 m² |

  The ground here is a stand-in: each building stands on its own lowest
  point. On a slope, a building's uphill walls stand above that. The app boot
  below measures the same on each course's own ground.
- **Glass.** Glass and nets take the foot too. Where one stands in front of
  another surface, a pixel's labels name only one of them. A further pass
  keeps the least share the foot leaves any see-through layer in front of the
  first opaque surface. It explains the rest: at Veckefjärden, a see-through
  wall's foot seen through a translucent roof.
- **A map's alpha.** A half-see-through grey panel with a map stands on the
  ground in front of white. The foot darkens only its grey: 0.709 at the
  ground line, against 0.710 expected. Had the alpha taken the foot, it would
  read 0.756.

**Pictures** ([buildings.jpg](graphics/buildings-2026-09-25/buildings.jpg)),
each before and after, at golden hour, through the app's own glow, exposure
and tone mapping:
- the houses' wall foot and ridge;
- the ridge, closer;
- the church, Ribbingsfors and Tortuna's clubhouse at their foot.

**App boot**
([`check-boot.mjs`](graphics/buildings-2026-09-25/check-boot.mjs),
[result](graphics/buildings-2026-09-25/boot-check.json)). The re-baked app
boots six ways on WebGL2 in SwiftShader.
- Each boot compiles every material in the scene.
- No page or console error occurs in any boot, so no shader failed to compile.
- The tree tier audit passes in each.
- Every stamped mesh drawn is the batch or a painted model, and every vertex
  found its ground.

| Boot | What the harness reads back |
|---|---|
| Ängsö, high quality (`det=1`) | Its facilities: 135 meshes, 29 materials. The batch: 4,728 triangles, 612 roof slopes. |
| Ängsö, both befores | Nothing stamped or painted. The batch has 3,504 triangles: two a slope fewer. |
| Ängsö, low quality | The same facilities, painted the same. Its batch is its own, as before: low quality draws fewer of the inferred houses that fill a residential area. |
| Veckefjärden | Its facilities, church and ski jump: 110 meshes. |
| Tortuna | Its eight authored models: 65 meshes. |
| Norrfällsviken | Its facilities from measured meshes: 14 meshes. |

**The foot on each course's own ground.** The boots measure how much of each
painted model's walls stands in the foot's band over the visible ground. Every
model has some, and so does every one of its buildings:

| Model | Wall in the foot's band | Walls |
|---|---|---|
| Ängsö's facilities | 677 m² | 5,872 m² |
| Veckefjärden's facilities | 708 m² | 7,320 m² |
| Veckefjärden's church | 121 m² | 4,277 m² |
| Veckefjärden's ski jump | 645 m² | 5,304 m² |
| Tortuna's eight models | 25 to 113 m² each | 178 to 1,486 m² each |
| Norrfällsviken's facilities | 136 m² | 912 m² |

The ski jump's frame meets its hillside along its length: 645 m² here,
against 3 m² on the isolated check's flat stand-in.

**Prepared startup data.** The source revision moved, so the following were
re-baked through the existing publishers for revision `c6ca6654`: tints (26),
far vista (26), scatter (26) and water (10 courses).

[`check-publication.mjs`](graphics/buildings-2026-09-25/check-publication.mjs)
compares against main at `b7619256`
([result](graphics/buildings-2026-09-25/publication-identity.json)). Every
tint, vista, scatter and water record keeps its content; only its source
identity changed. `check-prepared-startup` passes on the rebuilt app
([`prepared-check.json`](graphics/buildings-2026-09-25/prepared-check.json)),
and the app boot above ran on it.

**Suite.** The full `pnpm test` passes: 1,432 Vitest tests and 482 Node tests,
with 3 environment skips. The app-build isolation check,
`check:course-workflow` and the no-undef lint also pass.

## Not established

- **Pictures of full courses.** Judge these on the owner's GPU, against
  `?wallbase=0&roofridge=0`:
  - the batch's foot, 72% at the ground line, near and at a distance;
  - the models' lighter foot, where their walls meet their course's ground;
  - the ridge on slate and on clay roofs;
  - sunlit white walls under the midnight sun (above).
- **The models' foot on their own ground** is measured as wall area in its
  band, not seen: full courses render black in this container.
- **Frame time.** Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/buildings-2026-09-25/check-isolated.mjs
node docs/graphics/buildings-2026-09-25/check-boot.mjs
node docs/graphics/buildings-2026-09-25/check-publication.mjs   # after the re-bake
```
