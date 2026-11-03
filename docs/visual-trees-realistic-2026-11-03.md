# Realistic trees, treeset v2 (3 November 2026)

Owner request: trees as realistic as the new grass. The grass is now close to
realistic (tour turf, clumped blades, temporal AA), but the trees were stylised
painted crowns with chunky leaf cards and looked like a different game.

`?treeset=v2` draws a new catalogue of the same five species. The approved
painted catalogue stays the default. Visby keeps its own coastal pine.

## The catalogue

All of it rebuilds from `tools/blender-tree-study/realistic/`:

- **`make_leaf_atlas.mjs`** draws one 1024 px atlas per species, four sprigs
  each, from leaf outlines:
  - birch: ovate, double-serrated leaves on hanging twigs;
  - oak: lobed leaves crowded at the shoot's end;
  - alder: round leaves with a notched tip;
  - pine: brushes of long needles round each shoot's end;
  - spruce: flat sprays combed with short needles.

  The colours are near-neutral round a mean of 0.75: each leaf has its own
  lightness, a warm or cool turn, a fold along the midrib and paler veins. The
  species' painted palette still gives each tree its green and its autumn. The
  drawing is three times supersampled, and colour is bled into the clear texels
  so mipmaps don't darken the leaves' edges.
- **`realistic_trees.py`** runs in Blender through the MCP, in its own scene
  `BanvyTreesV2`, with the data API only. Each tree grows from:
  - a trunk leaning toward its crown; the oak's bole is short and splits into
    great limbs that carry the rest;
  - limbs set by the golden angle at the species' angles and lengths;
  - twigs off the limbs.
- **The leaf clusters** (the owner's review, 3 November: fuller, fluffier
  crowns, denser spruces, variation):
  - A crown is many puffs of 6-12 sprig cards seated round a centre at every
    twig and limb tip, after SpeedTree's and the Odyssey forest's clusters.
    Each puff faces out of itself and out of the crown, so it shades as its own
    soft ball, with sky between the puffs.
  - The pine's puffs are flattened into pads.
  - The spruce lays its sprays along each branch from the trunk to the tip,
    flat and in hanging curtains, so the stem is hidden as a spruce hides it.
    Its limbs are three-sided, and its triangles go to the foliage.
  - No card reaches the ground.
  - Normals are soft (crown, puff and face), and cards are rolled at random
    about their face.
- **The wood** is tapered tubes, about 1.6 times thicker than the first cut,
  with bark per vertex:
  - pine: grey-brown below and orange above, on a bowed trunk;
  - birch: white with dark lenticels and a dark foot.
- **Three variants a species**, each from its own seed: the crown's centre and
  base, the limbs' count and angles, and the trunk's bow are turned, so
  neighbours of a species differ. Each variant is grown iteratively until its
  own box, cards and all, matches the approved tree's. The engine already draws
  each species' variants hashed by position (`main.js` `TEMPLATES`), and the
  impostors bake from the first.
- **`pack_catalogue.mjs`** writes hash-named GLBs (`crown` and `trunk` nodes)
  and atlases under `models/trees/realistic-v2/`, plus `realistic-v2.json` in
  the approved schema. Every variant uses the approved template height and
  radius, so v2 trees stand as tall and wide as the ones they replace, and
  placements and shadows match.

| species | hero tris, v1 → v2 (3 variants) | full tris, v1 → v2 |
|---|---|---|
| Scots pine | 4448 → 4574-4862 | 1620 → 1542-1578 |
| Norway spruce | 4500 → 6284-6428 | 1700 → 2476-2512 |
| Silver birch | 4500 → 4844-5242 | 1700 → 1826-1880 |
| Grey alder | 4032 → 4480-4578 | 1700 → 2004-2040 |
| Pasture oak | 4500 → 5024-5124 | 1700 → 1874-1928 |

The first cut (2.6-3.7k hero triangles, one variant) read as young, sparse
trees with pole-thin trunks in close portraits. It was cheaper, but these
replace it at about the approved budget.

## The modelled sprigs (3 November, evening)

The first atlases were drawn flat (`make_leaf_atlas.mjs`, kept for its
encoder). The owner's review asked for better-designed leaves, so each
species' four sprigs are now modelled in 3D in Blender (`sprig_atlas.py`, its
own scene `BanvyTreesV2Sprigs`):
- **Broadleaves:** real leaf meshes from the same outlines, folded along the
  midrib, curled and tilted, on stalks off a tube twig.
- **Conifers:** the pine's needle brushes and the spruce's combed sprays as
  needle meshes.

The sprigs are rendered from above in two emission-only passes, with Cycles on
the CPU (six threads, 12 samples, about 7 s for all five species, the GPU
untouched):
- the colour: each leaf's own near-neutral colour, the midrib paler and the
  base darker;
- the card-frame normal in R and G, with in B the light that passes through:
  leaves and needles, never the twig.

`pack_sprigs.mjs` bleeds the colour into the clear texels and records each
atlas's mean over its leaves, which the material now divides by. Coverage is
within about 10% of the drawn atlases.

In the crown material (`leafNormal` in `ghibli-foliage-material.mjs`), each
card's soft crown normal is tilted by the leaf's own normal. The frame is the
card's uv directions on the surface, from screen derivatives, so mirrored cards
and instancing need no tangent attribute. The back light is scaled by the
light-through. The impostor bake writes the same perturbed normals.
`?leafnormals=0` is the before (the modelled colour without its normals).

Portraits at Ängsö 1: the alder and the oak show their leaves one by one,
each with its own light and shade and a real outline, where the drawn sprigs
read as soft blobs. **Not yet re-gated:** the tree shadow proof and the
performance A/B wait for the owner's GPU session (3 November: keep the GPU
cool).

## In the engine

- **`ghibli-trees.mjs`:** `playerTreeSet()` reads `?treeset=v2`, and the loader
  takes the realistic manifest. Puffs are off, since the soft normals are baked.
  The crown-depth AO is kept.
- **`ghibli-foliage-material.mjs`:** with `realistic`, the crowns have no painted
  canopy bands; the light is the smooth volume term with the back light. The
  texel is read as it is (straight alpha) and 85% of its own variation is
  multiplied in (`REALISTIC_LEAVES`). It is read 0.6 of a mip sharper, since the
  leaves blurred into streaks at the distance a crown is seen from.
- **The birch** takes its bark from vertex colour like every other v2 trunk.
- **`tree-impostor.mjs`:** the bake takes the same pigment, and cuts the
  realistic crowns' mask from the atlas's full resolution, as the mesh's own
  shadow does. At a 96 px frame the mipmapped alpha of fine leaves and needles
  averaged under half, and the impostors kept only 0.6–0.7 of the meshes'
  shadow. Their frames are 128 px, against 96 for the painted crowns
  (`REALISTIC_IMPOSTOR_FRAME`): at 96 the pine's lacy pads lost their outline,
  and its impostor shadow strayed from the mesh's under a low sun. The
  impostors' canopy flag follows the meshes'.

## Gates

All on the RTX 5080; reports in `tools/goldens/gfx/gates/` (local).

- **`tools/check-tree-shadows.mjs`**, WebGL2 (`--treeset v2`, new): the final
  catalogue passes for hero and full (80 match, 100 thin, 8 fade each). On the
  way there:
  - the bake's mip-0 mask lifted the thin rows from 0.6 to above 0.75;
  - the 128 px frames lifted the alder's full tier;
  - the pine's full tier keeps its pads solid (fewer, whole-area cards), which
    lifted its low-sun IoU from 0.77 to above 0.8.
  - The `--backend webgpu` run of this harness returned empty readbacks for
    some rows (areas of 0); WebGL2, the harness's default, is the evidence.
- **`tools/check-tree-tier-capacity.mjs`** (`--treeset v2`): passes.
- **`tools/check-hero-impostor.mjs`** (`--treeset v2`): the hero-only (and
  full-only) model requests, drawable inventory and tee render pass. Its last
  step, the forced-Lite link (`setTreeLod(3)` must leave no impostors), fails
  on v1 too: 9,598 impostors on Puttom, 17 on its default Visby run. That
  failure predates this branch.
- **Crown coverage rules:** unchanged (`crown-coverage.test.mjs`).
- **GPU time:** interleaved A/B, two rounds, vsync lifted (`ab-time.mjs`), for
  the final catalogue:
  - Puttom 5 green: 13.00 ms (v1) → 13.75 ms (v2), +5.8%;
  - Veckefjärden 13 tee: 9.75 → 10.75 ms, +10.3%.

  The first, sparser cut was 10-14% cheaper than v1.
- **Download:** a v2 visit fetches three variants' meshes of its tier and five
  1024 px atlases: about 7.7 MB at high quality, against about 3.8 MB for v1.

**Photographs:** `tools/goldens/gfx/tree-photos.mjs` takes the nearest clear
tree of each species from 1.7 m, and `tree-sheet.mjs` sets old against new at
noon and golden hour (Ängsö 1).

## Status

v2 stays opt-in. Every gate passes except the hero/impostor check's forced-Lite
step, which also fails on v1, and the GPU time sits at the edge of the ~10%
budget. The look is a large change from the painted
style, so it should be the owner's decision by screenshot. Flipping the default
is `playerTreeSet()`'s fallback.
