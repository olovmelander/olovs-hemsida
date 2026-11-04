# Realistic trees, treeset v2 (3 November 2026)

Owner request: trees as realistic as the new grass. The grass is now close to
realistic (tour turf, clumped blades, temporal AA), but the trees were stylised
painted crowns with chunky leaf cards and looked like a different game.

A new catalogue of the same five species, the default since 4 November (owner
request). `?treeset=v1` is the before, the painted catalogue. Visby has its own,
with a realistic coastal pine: see [its section](#visbys-coastal-pine-4-november).

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

## The modelled bark (3 November, evening)

Each species' bark is a tileable patch of real relief modelled in Blender
(`bark_atlas.py`, its own scene `BanvyTreesV2Bark`). Each patch is a displaced
grid whose heights are periodic both ways, so it wraps round a trunk and
repeats up it without a seam:
- birch: smooth, with lenticels pressed in and peeling strips raised;
- pine: plates parted by deep cracks;
- spruce: thin flaky scales;
- oak: deep furrows between broken ridges;
- alder: smooth, with running fissures.

It is rendered from above with Cycles on the CPU into a near-neutral colour and
a normal map (`pack_bark.mjs`). The v2 trunks carry UVs: a seam column, whole
repeats of the 0.6 m tile round the trunk, and their length up it. The seam
reuses its ring's first colour, so every seeded choice, and so every tree,
grows exactly as before. The trunk material multiplies the bark's colour into
the per-height tone (the pine's grey foot and orange crown) and tilts its
normal by the bark's relief (`barkSurface`). `?bark=0` is the before.

At 3 m the birch shows its lenticels. The pine's and oak's relief is subtle,
and needs a close-up review and perhaps a stronger `REALISTIC_BARK.relief` in
the GPU session (the owner asked to keep the GPU and fans cool on the 3rd).

## In the engine

- **`ghibli-trees.mjs`:** `playerTreeSet()` reads `?treeset`, and the loader
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
  the catalogue before the modelled sprigs and bark (re-measured below):
  - Puttom 5 green: 13.00 ms (v1) → 13.75 ms (v2), +5.8%;
  - Veckefjärden 13 tee: 9.75 → 10.75 ms, +10.3%.

  The first, sparser cut was 10-14% cheaper than v1.
- **Download:** see [the default](#the-default-4-november).

### Re-gated with the modelled sprigs and bark (night of 3 November)

Reports in `tools/goldens/gfx/session/` (local).

- **Clean boots** (`aa=traa&treeset=v2`, 13 courses on both backends at high
  quality): all 26 clean, at most 14 vertex outputs.
- **`check-tree-shadows`, hero tier:** passes.
- **`check-tree-shadows`, full tier:**
  - With the modelled sprigs, the lighter full-tier birch kept 0.658 of its
    fine-texel shadow at the 1150 m box on the 1024 map (27.4°).
  - Its fewer cards now keep the hero crown's whole leaf area, as the pine's
    do (`realistic_trees.py`; only the birch's three full-tier GLBs changed).
    Every birch mesh row passes.
  - The worst row is now its impostor at 850/1024 (9.4°): 0.748 against the
    gate's 0.75.
  - At 1.7–2.25 m texels a sparse crown covers a handful of shadow texels, so
    single rows move by about 0.1 with any change to the crown. The last 0.002
    is left for the owner's review rather than tuned against.
- **Capacity:** passes.
- **Hero/impostor:** as above. Every step passes up to the forced-Lite one,
  which fails as on main. The cause:
  - That step expects no impostors at all (21 September).
  - Since 83263bcc (24 September), out-of-view cells whose shadows reach the
    view keep their trees as impostors.
  - On Puttom under the forced link, every tree in the 28 visible cells is
    Hero (4,342), and the 9,598 impostors are the 45 shadow-only cells' trees.

  The check needs a count of shadow-only trees (an engine hook) and is a
  separate fix.
- **GPU time** (4 November, 01:35-01:45, the GPU otherwise idle): interleaved
  A/B, two rounds, vsync lifted (`ab-time.mjs`), on the build that ships.
  Compare within one session only: v1's own times are lower than in the
  earlier session.

  | view | v1 | v2 | `leafnormals=0` | `bark=0` |
  |---|---|---|---|---|
  | Puttom 5 green | 10.30 ms | 11.50 ms (+11.7%) | 11.10 ms | 11.40 ms |
  | Veckefjärden 13 tee | 7.80 ms | 9.00 ms (+15.4%) | | |

  The leaf normals cost 0.4 ms and the bark 0.1 ms. With the cull
  (`treecull=gpu`), v2 is 11.10 and 8.70 ms (docs/tree-gpu-cull-2026-11-03.md).

**Photographs:** `tools/goldens/gfx/tree-photos.mjs` takes the nearest clear
tree of each species from 1.7 m, and `tree-sheet.mjs` sets old against new at
noon and golden hour (Ängsö 1).

## The default (4 November)

The owner chose the realistic trees, so they are now every course's default.
`?treeset=v1` is the before; reports are in `tools/goldens/gfx/flip/`
(local).

- **Plantings:** a course's tree test asks the drawn crown's underside about the
  authored buildings (`main.js`), so a new catalogue could have changed what is
  planted. It did not: over all 13 courses at both qualities, 2,479,147 trees
  stand in the same places, with the same exclusions round the buildings. The
  vista and scatter bakes came out byte for byte as before, so `treeset` and
  `treerelief` are display-only for the prepared data. The spruce's crown top
  is 1.2% lower than the painted one's (0.6% in the full tier), which measured
  trees take up in their scale.
- **Phones:** low quality (`full` tier) keeps the models and the leaves' colours
  and leaves out the relief (`relief` in `loadGhibliTrees`). That is the leaf
  normals and the bark maps: 7.3 MB and fifteen textures. `?treerelief=1` is the
  before.

  | tree data | painted | v2 |
  |---|---|---|
  | high quality | 2.1 MB | 16.6 MB |
  | low quality | 1.3 MB | 5.2 MB (12.5 MB with the relief) |

  Later the same day the files came down to 7.4 and 3.7 MB, with the same
  pictures (docs/load-times-2026-11-04.md).

  **No phone has run this.** The frame time below is the RTX 5080's at low
  quality, not a phone's.
- **Frame time:** interleaved, two rounds, Puttom 5 green at golden hour.

  | quality | painted | v2 | v2 with the relief |
  |---|---|---|---|
  | high | 9.90 ms | 11.40 ms (+15.2%) | |
  | low | 4.30 ms | 4.85 ms (+12.8%) | 5.40 ms (+25.6%) |

  The same view measured +11.7% in the night, when the GPU was confirmed idle.
  It was not checked this time, so read the cost as about 12-15%, over the ~10%
  budget. The owner chose the trees knowing that.
- **Boot:** over the 13 courses, 9.8 s against 10.0 s at high quality and 8.7 s
  against 9.2 s at low. The files came from this machine, so a real download
  will take longer than the table's sizes suggest.
- **Offline:** the service worker keeps the catalogue as it keeps the painted
  one. Ängsö at low quality booted offline with all 57,752 trees.
- **Clean boots** on the build that ships, 13 courses on both backends with
  `aa=traa`: 26 at high quality, 26 at low, 26 at high with `treeset=v1`, and 4
  at low with `treerelief=1`, all clean.

## Visby's coastal pine (4 November)

Visby's pine is its own tree, so its catalogue stayed painted when the others
changed. The owner asked for it to be remade too. The target is the three
growth forms the owner kept in September (`ghibli-visby.json`:
wind leaning, forked, sheltered), not the darker, windswept "märtall" proposals
declined then. Photograph 465 of [that study](graphics/visby-coastal-pine-2026-09-16/research.md)
gives the form: a thick leaning trunk that forks low, long limbs bare on their
inner half, and a broad crown of dense needle pads held out over open sky.

- **Its wood** (`coastal_wood`, the species `kust`): a curved trunk, great limbs
  that fork from each other, and outer limbs that alone carry the foliage. The
  skeleton has its own random numbers, so the two tiers share every branch. The
  other five species are byte for byte as they were.
- **Its sprig** (`coastal_sprig`): tapered shoots standing up from one low base,
  the needles swept forward and gathered to a point. The inland pine's round
  fans turn to blobs with brown spots at a distance, and laid flat they read as
  leaf plates. The new shoots keep their spikes in the mipmaps. The inland pine
  still has the old sprig and shows the same fault.
- **Its crown:** upright cards in thick pads on 28 limbs. Smaller cards read as
  little green hands, so larger overlapping ones carry it.
- **The catalogue** (`pack_coastal.mjs`, `realistic-visby.json`): the pine's boxes,
  seeds and `tall` palette are the kept ones, its bark is the inland pine's, and
  the other four species are the same records as `realistic-v2.json`.
  `?treeset=v1` is the painted catalogue. Hero 5,476-5,514 triangles (painted
  4,500), full 2,516-2,556 (1,700). High quality 16.6 MB, low 5.4 MB.
- **Plantings:** the crown's underside (3.47 m, kept 3.53 m) answers the facility
  test. 51,119 trees at high quality and 34,944 at low stand as before, with the
  same 25 and 17 exclusions.
- **Shadows** (`check-tree-shadows --course visby --species 1`). This proof had
  never run on Visby's pine; the painted one does not pass it either.

  | | coverage rows failing | low-sun agreement (gate 0.80) |
  |---|---|---|
  | kept painted pine | 3 | 0.83, 0.85 |
  | coastal pine | 0 | 0.795, 0.785 |

  The low-sun row is the 9.4° sun, between two of the impostor's view angles,
  where a small mismatch slides a pad's long thin shadow aside. Frames of 192 px
  did not move it; thicker pads did (0.75 to 0.79). It stands as a known gap.
- **Frame time**, Visby 1 tee at golden hour: 4.25 → 4.30 ms at high quality,
  3.60 → 2.55 ms at low.
- **Offline:** Visby at low quality boots offline with all its trees.

The oak's and alder's bark takes more relief (`reliefBy`: 2.4 and 2.2, others
1): their dark even colour showed almost none. It now reads as fine grain.
More would need lighter trunks in the models.

## Status

The default. The hero/impostor check passes since 4 November: it now compares
the impostors left under the forced link with the shadow-only trees the engine
counts (`stats.shadowTrees`). Every other gate passes except these known gaps:
- Visby's pine at a low sun, above;
- one full-tier birch shadow row, its impostor at 0.748 against 0.75. Cards 4%
  larger made it worse (0.606, 0.665 and 0.728 in three rows), which shows
  these rows measure how a sparse crown lands on a coarse grid. So they were put
  back rather than tuned further. The row is a low sun on the 1024 map at an
  850 m box, on the tier phones draw.

Still open: a real phone, the GPU tree cull (opt-in, docs/tree-gpu-cull-2026-11-03.md),
and the inland pine's old sprig.
