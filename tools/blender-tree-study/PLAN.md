# Ghibli trees into the app — implementation plan (2026-09-11)

Status: study only. Nothing in `apps/golf` has changed. This file records what
the Blender study measured and how the trees would ship on WebGPU and WebGL2,
desktop and phone, without breaking the engine's rules (see CLAUDE.md, "The
trees by place" and "Shadows, depth, the camera's footing").

## What exists

`ghibli_catalog.py` builds 11 Swedish species (ek, lönn, lind, ask, björk, asp,
al, sälg, tall, gran, en), any number of seeded variants each, at four detail
tiers, and can export them. Every clump sits on a branch. Triangles per tree
(crown + trunk), one seed:

| species | hero | full | decimated | lite | impostor |
|---|---|---|---|---|---|
| gran | 7,094 | 3,838 | 694 | 362 | 2 |
| tall | 6,584 | 1,640 | 888 | 472 | 2 |
| björk | 5,296 | 1,352 | 596 | 392 | 2 |
| ek | 4,704 | 1,440 | 884 | 496 | 2 |

Today's engine tiers for comparison: hero 540–1,068, full 156–436,
decimated 56–80. The cheap tiers here MERGE foliage (fewer, larger clumps),
never delete it — a first version deleted small clumps and stripped the crowns.

Open item: the spruce "full" at 3.8k is too heavy for zone B; it needs its
own recipe with fewer boughs (~1.5k), not the generic thinning.

## Population it must carry (Puttom, `V3D.legacyTrees`)

| zone | radius from a hole line | trees |
|---|---|---|
| A | 90 m | 4,859 |
| B | 300 m | 17,948 |
| C | 700 m | 56,532 |
| beyond | | impostor |

Today: zone mode, tiers [hero, full, decimated, impostor], 13.6 M triangles at
the 12th tee, 6.4–7.1 ms on the RTX 3070; phone one tier coarser.

## Budget

Triangles per frame, using the tier table's averages:

| plan | A | B | C | total |
|---|---|---|---|---|
| all new hero/full/decimated as today's tiers | 29 M | 39 M | 40 M | 108 M — impossible |
| desktop: A full, B lite, C impostor | 10.7 M | 7.2 M | 0.1 M | 18 M |
| desktop + hero inside 35 m (~1,200 trees) | +7 M | | | 25 M |
| phone: A decimated, B lite/impostor, C impostor | 3.6 M | 2–7 M | 0.1 M | 6–11 M |

So: **zone A gets the "full" tier, not hero; hero is a 35 m band on desktop
only** (and only when the auto-quality verdict is high); zone B is lite; zone
C becomes impostors on every device. The impostor atlas is baked from the
hero crown, so the far ring gets the new silhouettes for free.

Overdraw matters more than triangles on a phone: the lite tier grows clumps
×1.8, so crowns overlap and fill more pixels. Measure with the pop meter and
the rest-cost tool before trusting the triangle count.

## Draw calls (the real constraint)

One `InstancedMesh` per (species, variant, part, tier) — the engine's rule,
because BatchedMesh is one draw per instance on the WebGPU backend and needs
WEBGL_multi_draw on WebGL2. Naive: 5 species × 8 variants × 2 parts × 3 mesh
tiers = 240 draws. Two cuts:

1. **One geometry per tree, not two.** Merge trunk and crown; a vertex
   attribute (0 bark, 1 leaf, plus sway weight) selects the palette inside
   ONE material. Halves the draws and the materials.
2. **Variants per tier**: hero 8, full 4, lite 2. Impostors per species with
   2 variants (each atlas is two 768² half-float targets ≈ 9 MB; 8 per species
   would be too much memory).

Result for a five-species course: ~5×(8+4+2) = 70 instanced draws + 10
impostor batches, against 27 today. Acceptable; instance counts are large.

## Data path

- Export: GLB per (species, variant, tier) from a background Blender, one
  primitive, POSITION + NORMAL (the bent custom normals) + COLOR_0 (the baked
  "Depth" tint) + the part/sway attribute as a second colour channel or
  `_PART` custom attribute. No textures, no URIs — passes `inspectBuildingGlb`
  unchanged (verified on this study's export).
- Loader: like `authored-buildings.mjs`, content-addressed, sha256 in the
  manifest, fail-closed to the procedural templates.
- `SPECIES[s]` becomes a list of variants; `templateHeight`/`templateRadius`
  per variant from its bounds; measured LiDAR trees still scale by
  height/radius as now (`treeInstances` fingerprint moves, by design).
- Per-instance variant = which InstancedMesh the slot goes into; choose by
  the planter's hash so it is deterministic under `?det=1`.

## Shading

First prototype: keep the engine's crown material (lit, flat→smooth), feed it
the bent normals and COLOR_0; the palette per species from the study but tuned
under the app's sun. The toon ramp is a whole-scene art direction and stays a
`?look=` experiment.

## Engine rules that still apply

- never `DynamicDrawUsage`; dirty ranges only; 8 vertex buffers on WebGPU;
- shadows: `castShadowPositionNode = positionLocal`; sway on hNorm works as is;
- tier changes only by zone (owner's rule); the impostor quad = bake radius;
- gates to re-baseline: tree-trunk-geometry test (fingerprints), pine-look,
  lod-strict-gate, tree-pop-meter, vegetation-baseline, scene-census.

## Order of work

1. Spruce "full" recipe at ~1.5k; export tiers for gran, tall, björk, al, ek.
2. Loader + merged-part material + variant slots (behind a flag).
3. Puttom: goldens before/after, `V3D.treeTriangles`, rest cost, pop meter.
4. Phone profile (`phoneDevice`): decimated/lite/impostor tables.
5. Species prior (docs/specs/puttom-species-prior.md) so the new species
   land where the evidence says.

## Status 2026-09-11, evening — the step 1-3 prototype is in the app

- `tools/blender-tree-study/export_trees.py` (background Blender) wrote
  `apps/golf/public/models/trees/`: 50 GLBs (3.0 MB) + `ghibli-v1.json` —
  tall, gran, björk, al, ek × 4 variants × {full, lite} + hero for 2 variants.
- `apps/golf/src/engine/ghibli-trees.mjs` loads them behind `?trees=ghibli`
  (`&hero=1` for the hero tier): manifest → sha256 → `inspectBuildingGlb` →
  GLTFLoader → crown/trunk geometries with bent normals and COLOR_0. One
  variant per species (variant 0) for now; gran/tall/björk map onto the
  engine's three species.
- main.js: the three tier templates come from the loader, crown and trunk
  materials go smooth-shaded and read the vertex colour, the crown-depth bake
  is skipped (already baked), zoneTiers become [full, lite, impostor,
  impostor] (hero in zone A only with &hero=1), and the measured-tree width
  scale is clamped to 0.75-1.3 of the height scale — without it the wide
  authored pine crown was squeezed to a bottle brush by radius/templateRadius.
- Measured on Puttom's 5th (tools/goldens/ghibli-look.mjs, RTX 3070):
  triangles per species [full, far]: spruce [2370+1372, 350+44], pine
  [1340+448, 460+112], birch [1800+368, 600+32]; draws 55 either way.
  Frame time not yet measured (tools/frame-at-rest.mjs next).
- Still to do: variants per instance (own InstancedMeshes), alder/oak as new
  species indices + species rule, a cheaper spruce full tier (its trunk alone
  is 1,372 tris: the whorl tubes), palette tuning under the app sun, the
  phone profile, then goldens/pop-meter/rest-cost before any default switch.

## Status 2026-09-12 — `?ghibli=1`, the whole painted look

One flag turns on the authored trees (with hero) and the painted scene:
`paintedGround()` in material.js (flat base × blotches at 80/26/9 m ×
warm-yellow lit band / cool blue-green shade, roughness 0.96, no relief),
the hand-built sky dome with a deeper zenith on every backend, a cumulus
dome (`cloud-dome`, tileable fbm texture, plane projection, cover = preset
+0.12, warm top / cool belly, fades out above the horizon band), fog lerped
to 0x9cc2e6 ×0.7 density and hemisphere ×1.25, painted water (saturated
body, weak fresnel, white dabs), post chroma 1.16 + mild S. Shots in
tools/goldens/flicker/look/ via `ghibli-look.mjs --modes=look`. Gates: lint,
vitest 691, check-app-build all green with the flag off.
Open: bigger/fewer clouds by preset, the far-hill tint under low sun, and a
phone pass; the realistic default is untouched.
