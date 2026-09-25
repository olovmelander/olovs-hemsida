# Landscape batch, 25 September

**Owner request, 25 September:** "Yes, start with 6 and 8, then 7!" These are
the next three items of the visual audit, after
[the lighting batch](visual-lighting-2026-09-25.md):
- **6.** colour across tree stands;
- **8.** surfaces that read differently;
- **7.** richer ground, baked in advance.

Every change keeps its before behind a URL switch. The switches keep the
prepared startup data eligible, so an A/B pair differs only in the change.
The complete before is:

`?standtint=0&surfacegloss=0&surfaceedges=0&groundrelief=0`

Nothing here changes geometry, placement or water. The one change to prepared
data is the ground tint's alpha channel, which was 255 everywhere and was
never read; its colours are byte for byte the same. Single scenes render
correctly in software, unlike full courses, so the pictures in
[`graphics/landscape-2026-09-25`](graphics/landscape-2026-09-25) show the real
shaders. The full scenes still need the owner's GPU.

## The changes

**6. Colour across a stand** (`stand-tint.mjs`, `?standtint=0`).

Each tree took its own tint from a hash of where it stands: a warm/cool shift
of up to 12%, and a green one of up to 8%. So no two neighbours matched. From
any distance the speckle averaged away into one flat green, and the far vista
had no tint at all.

The tint keeps its two axes and adds two slow washes across the ground:
- warm/cool over about 300 m, 10% at one standard deviation;
- lush/dark over about 130 m, 8% at one standard deviation.

This is variation that survives distance, as a tree's own does not. Each tree
keeps half of its own variation. The washes are one function of position, so
the far vista takes the same stands as the trees near the course.

The tint is computed once per tree when the course loads. The vista loop now
writes in place instead of allocating three small arrays per tree, so it runs
faster than before even with the washes: 55–74 ms against 76–91 ms for 600,000
trees. Nothing changes per pixel.

**8. Surfaces that read differently** (`material.js`,
`ground-material-core.mjs`, `?surfacegloss=0` and `?surfaceedges=0`).

- **Gloss.** `SHADE` gives every surface a gloss: a green 0.42, a fairway
  0.28, rough 0.06. The painted finish dropped it, so a green, cut to a few
  millimetres and rolled, caught the sun exactly as knee-high rough did.
  - The sheen now scales with the surface's own gloss against a fairway's. A
    fairway is exactly unchanged, a green takes half as much again, and rough
    a fifth.
  - The meadow's blotches calm to under half on the finest cuts.
  - From above at noon a green is 3.4% brighter and rough 3.2% duller.
- **Bunker lips.** Inside the sand's edge there is now a warm, darker band a
  hand or two wide: the face in the lip's own shade.
  - It is 10% darker, with blue falling 17% and red 6%.
  - The grass side already had the lip's contact shade.
  - Deep sand is untouched.
- **Paths.** Paths, gravel and dirt tracks are grown in at their edges and
  worn in their middle.
  - Grass creeps in from both sides in the colour of the ground beside it,
    raggedly: the rough's own clumps move the line.
  - The middle is up to 8% paler.
  - Both fade before a pixel outgrows them.

**7. The ground's own light, baked** (`ground-relief.mjs`, `?groundrelief=0`).

The v2 terrain lost what the ring meshes carried per vertex: how much of the
sky a point sees (`horizonAO`, six directions at 14 and 46 m). A hollow and
the foot of a slope stood as bright as an open shoulder, and open ground
beside a wall of forest as bright as a fairway's middle.

One signed number per tint cell now carries it, in the raster's alpha, as
128 + 127 s:
- **Shelter** (s < 0) is the ring meshes' own horizon occlusion, or, on open
  ground, the share of forest within 18 m, whichever is more.
- **Exposure** (s > 0) is how far the cell stands above the mean ground round
  it, fully so at 3 m.

The ground material reads it:
- sheltered ground takes less of the sky on every surface, up to 35% of its
  albedo, and natural ground there stays lusher;
- natural ground on an exposed crest dries toward straw;
- mown turf is watered and keeps its colour on a crest.

Everything is reckoned on the raster's own grid of heights, which the colour
pass already read, with box sums and bilinear taps. A whole raster costs tens
of milliseconds on the live path, and nothing on the prepared one. Its RGB is
untouched, so the tint's colours are exactly what they were.

## What it costs

No change adds a texture read, a draw or a pass.

| Change | Cost |
|---|---|
| Stands | Once per tree at load, in a loop that is now faster than before. |
| Gloss | One multiply of the sheen and one of the blotch per ground pixel. |
| Lips and paths | A few operations per ground pixel. The ragged edge reuses the rough's clump sample. |
| Relief | Its value comes from the tint texel already read. A few operations per ground pixel. |

Nothing is added on trees. Nothing was timed on a GPU.

## Evidence

**Unit tests** (`apps/golf/src/engine`):
- `stand-tint.test.mjs`: the before is the old tint; the washes keep the
  mean; neighbours are alike and stands differ; the vista takes the washes;
- `ground-relief.test.mjs`: flat ground and water are neutral; a hollow and a
  slope's foot are sheltered and a crest exposed; the valley matches the ring
  meshes' own horizon occlusion; a wood shelters open ground beside it; the
  cost;
- `visual-fix-switches.test.mjs` and `prepared-ground-tint.mjs`'s list: every
  before switch keeps prepared startup eligible.

**Isolated browser check**
([`check-isolated.mjs`](graphics/landscape-2026-09-25/check-isolated.mjs),
[result](graphics/landscape-2026-09-25/isolated-check.json),
[pictures](graphics/landscape-2026-09-25/stands-and-surfaces.jpg)). It runs in
SwiftShader on WebGL2 and on WebGPU with reversed depth, and the two agree.

- **Stands.** A closed forest of 21,316 impostors, baked from the approved
  crowns, is tinted by the player's own tint.
  - The warmth spread across 24 px blocks rises 46% at noon and 30% at golden
    hour.
  - The spread within blocks, set by the trees' own light and species, is
    unchanged.
- **Surfaces.** Fairway, green, bunker, a 3 m path and rough are laid on the
  app's own exact-edge atlas and ground material, with its painted palette and
  `SHADE` table.
  - The fairway is bit for bit unchanged.
  - The lip, the path's grown edges and worn middle measure as above.
  - Deep sand and the ground beside the path are untouched.
- **Relief.** Open relief is bit for bit the before.
  - Sheltered relief (s = −0.6) darkens every surface to about 0.80–0.85 of its
    light. Specular sheen is not darkened, so the drop is less than the
    albedo's 0.79.
  - An exposed crest (s = +0.8) leaves fairway, green and sand exactly
    unchanged, and dries rough by +5% red and −3% blue.

**App boot**
([`check-boot.mjs`](graphics/landscape-2026-09-25/check-boot.mjs),
[result](graphics/landscape-2026-09-25/boot-check.json)). See below.

**Prepared startup data.** See below.

## Not established

- **Pictures of full courses.** Judge these on the owner's GPU and phone,
  against the before switches:
  - forests from a tee and from the overview;
  - greens against rough in low sun;
  - bunker lips and cart paths close up;
  - hollows, crests and wood edges across the rough.
- **Frame time.** See "What it costs". Nothing was timed.
- **WebGPU full boot.** As before, the full app does not finish loading on
  WebGPU in this container's software rendering.

## Reproduce

```sh
pnpm exec vitest run apps/golf
pnpm --filter @banvy/golf build
node docs/graphics/landscape-2026-09-25/check-isolated.mjs
node docs/graphics/landscape-2026-09-25/check-boot.mjs
node docs/graphics/landscape-2026-09-25/check-publication.mjs   # after the re-bake
```
