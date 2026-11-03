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
  - a trunk leaning toward its crown;
  - limbs set by the golden angle at the species' angles and lengths;
  - twigs off the limbs, with the card budget spread over them.

  Each card faces out of the crown in 3D, so from outside a crown is a shell of
  leaves seen face on. Pointing sprigs along their twigs put the card's plane
  through the crown's radius, and the crown read as streaks. Cards are rolled
  at random about their face, and their normals are soft (crown, limb cluster
  and face). The wood is tapered tubes with bark per vertex:
  - pine: grey-brown below, orange above;
  - birch: white with dark lenticels and a dark foot.

  Each tree is grown iteratively until its own box, cards and all, matches the
  approved tree's, so the loader's fit stays near 1 on both axes.
- **`pack_catalogue.mjs`** writes hash-named GLBs (`crown` and `trunk` nodes)
  and atlases under `models/trees/realistic-v2/`, plus `realistic-v2.json` in
  the approved schema. The manifest uses the approved template heights and
  radii, so every v2 tree stands as tall and wide as the tree it replaces, and
  placements and shadows match.

| species | hero tris, v1 → v2 | full tris, v1 → v2 |
|---|---|---|
| pine | 4448 → 3276 | 1620 → 1256 |
| spruce | 4500 → 3708 | 1700 → 1556 |
| birch | 4500 → 3472 | 1700 → 1340 |
| alder | 4032 → 3000 | 1700 → 1280 |
| oak | 4500 → 3176 | 1700 → 1538 |

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
  shadow. The impostors' canopy flag follows the meshes'.

## Gates

All on the RTX 5080; reports in `tools/goldens/gfx/gates/` (local).

- **`tools/check-tree-shadows.mjs`**, WebGL2 (`--treeset v2`, new): passes for
  hero and full (80 match, 100 thin, 8 fade). On the way there:
  - the bake's mip-0 mask lifted the thin rows from 0.6 to above 0.75;
  - the pine's tufts and pads were made fuller to reach the fine-texel band's
    IoU of 0.8 (0.773 → 0.807);
  - the oak's full tier took 540 cards (IoU 0.797 → pass).
  - The `--backend webgpu` run of this harness returned empty readbacks for
    some rows (areas of 0); WebGL2, the harness's default, is the evidence.
- **`tools/check-tree-tier-capacity.mjs`** (`--treeset v2`): passes.
- **`tools/check-hero-impostor.mjs`** (`--treeset v2`): the hero-only (and
  full-only) model requests, drawable inventory and tee render pass. Its last
  step, the forced-Lite link (`setTreeLod(3)` must leave no impostors), fails
  on v1 too: 9,598 impostors on Puttom, 17 on its default Visby run. That
  failure predates this branch.
- **Crown coverage rules:** unchanged (`crown-coverage.test.mjs`).
- **GPU time:** interleaved A/B, two rounds, vsync lifted (`ab-time.mjs`):
  - Puttom 5 green: 12.85 ms (v1) → 11.05 ms (v2), −14%; v1's full tier
    measured 8.20 ms in the same run;
  - Veckefjärden 13 tee: 9.95 → 8.95 ms, −10%.

## Status

v2 stays opt-in. Every gate passes except the hero/impostor check's forced-Lite
step, which also fails on v1. The look is a large change from the painted
style, so it should be the owner's decision by screenshot. Flipping the default
is `playerTreeSet()`'s fallback.
