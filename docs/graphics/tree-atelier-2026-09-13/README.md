# Swedish golf tree design study

**Approved for Ghibli mode.** After reviewing the Blender models and temporary
course photographs, the user requested these trees as the standard on every
ring, with high and low detail. The default catalogue is now
`models/trees/ghibli-fluffy.json`; study pages retain explicit comparison assets.
Tree placement and species rules remain owned by the course planter.

## Production integration

The three mesh tiers use the approved silhouettes, foliage UVs, custom normals
and shared species textures. Each tier is fitted to the close model's height
and radius, with its origin on the ground, to avoid size jumps between levels.
The existing instanced batches, quality rules, wind and crossfade system remain.
Two-triangle impostors are baked from the matching textured full models and
used both inside measured coverage and throughout the outer forest rings.
Cutout masks and authored normals are included in the bake. Per-tree tint and
autumn progression carry through mesh/impostor transitions.

The user subsequently found the in-app greens too vibrant. The production
palette now uses muted forest greens, lifted shadows, softer highlights and
less yellow in the birch. The study's brightness boost is removed. Meshes and
all impostor rings share this palette, autumn response and day/night intensity.
The historical study page and Blender presentation retain their earlier palette.

`publish_foliage.mjs` strips embedded textures/materials from the study GLBs
while preserving geometry attributes. It publishes 15 immutable hashed GLBs
and five shared 512px PNG atlases: **2,754,093 bytes total**, before transport
compression. `hero=0` skips 1,428,148 bytes of close meshes. The loader verifies
byte lengths and SHA-256 hashes; CDN and service-worker rules cache immutable
assets while revalidating the catalogue. Nothing was deployed by this task.

Reproduction and checks:

```powershell
node tools/blender-tree-study/publish_foliage.mjs
npx vitest run apps/golf/src/engine/ghibli-trees.test.mjs apps/golf/src/engine/tree-impostor.test.mjs apps/golf/src/engine/tree-fade.test.mjs apps/golf/src/engine/tree-bounds.test.mjs
node tools/blender-tree-study/check_foliage_runtime.mjs
node tools/blender-tree-study/check_foliage_runtime.mjs puttom
node tools/blender-tree-study/check_foliage_runtime.mjs angso
node tools/blender-tree-study/check_foliage_runtime.mjs low
node tools/blender-tree-study/check_foliage_runtime.mjs natural
node tools/blender-tree-study/build_preview.mjs
```

`production-*-validation.json` records actual app rendering, loaded catalogue,
materials on every ring, all five baked atlases, triangle counts, and slot audits.
The Upsala check exercises all four detail levels, a held/completed crossfade,
and daylight, autumn and blue-hour lighting. `production-*.png` are real app
captures with the production loader and materials, without tree substitution.
The low-quality check uses a narrow desktop browser viewport; it is not a
physical-phone GPU benchmark. Frame-rate gains have not been established.

## Current five-species foliage study

- [Interactive foliage study](http://localhost:5173/foliage-study.html)
- `fluffy-swedish-trees.blend`: editable close models for pine, spruce, birch,
  alder and oak, in a separate Blender scene.
- `fluffy-five-species.png` and `fluffy-<species>-<detail>.png`: browser captures
  of the actual exported models, plus reverse-angle and mobile views.
- `species-build-report.json`: measured mesh counts and asset hashes.
- `species-validation.json`: all 15 GLBs, WebGPU rendering, alpha textures,
  finite geometry, triangle budgets and mobile layout checks.

The current palette combines yellow-green highlights, richer mid greens and
deep forest shade. The pine reuses the textured geometry the user preferred.
The spruce is built around individual spreading, drooping boughs, with small
overlapping interiors instead of a continuous conical shell. Staggered whorls
give it a fluffy, irregular silhouette. The birch has a new broader, arching
branch structure with full curtains of foliage, visible ivory stems and subtle
charcoal bark markings. The close and middle models use textured sprays; the
distant models preserve the branch groups as small solid volumes.
Alder and oak retain connected crown envelopes. Each species uses its own
original 512px vector foliage atlas. Broad custom normals and the study-only
paint material group the light into larger shapes. Crown self-shadows are
disabled to avoid harsh speckles; trees still cast ground shadows.

| Species | Close | Middle | Distant |
|---|---:|---:|---:|
| Scots pine | 4,448 | 1,620 | 280 |
| Norway spruce | 4,500 | 1,700 | 308 |
| Silver birch | 4,500 | 1,700 | 308 |
| Grey alder | 4,032 | 1,700 | 108 |
| Pasture oak | 4,500 | 1,700 | 200 |
| Whole-tree budget | 4,500 | 1,700 | 420 |

The original pine variant uses 6,808 / 1,788 / 572 triangles. This comparison
does not establish a frame-time improvement: alpha cutouts introduce pixel
overdraw. The revised study renders successfully on WebGPU, including cutout
edges and ground shadows. Both panels submit six draws including the floor
and shadow rendering; each tree has one foliage mesh and one trunk mesh.
Phone GPU performance remains unmeasured. Production level transitions are
checked separately by the runtime harness above.

The preview uses `study-canopy-material.mjs` for painted colour, alpha cutouts
and procedural birch bark markings.
The Blender presentation material uses the same palette and a similar normal
gradient. Its output is an authoring preview; browser and Blender lighting are
not identical. The Blender material is applied after exporting the GLBs.

## Historical temporary photographs in the app

Before integration, `capture_course_study.mjs` captured Upsala hole 2 with the study models in the
actual app renderer. It exposes scene handles through a private browser response
interception, freezes tree tier updates for the still, and substitutes the
five species' mesh tiers in memory. Existing tree positions and heights are
preserved; the background impostor atlases remain the original ones. This does
not change the course catalogue or add an application feature. The private
browser closed after capture. This script is a historical study tool;
use `check_foliage_runtime.mjs` for the current production trees.

Outputs are `upsala-fluffy-trees-evening.png`, `upsala-fluffy-trees-day.png` and
`course-photo-study.json`. These are visual studies, not whole-course runtime
performance or LOD-transition validation.

## Reference findings

The user's [Three.js fluffy-tree example](https://discourse.threejs.org/t/fluffy-tree-anime-style/86626)
uses alpha-tested foliage, a lighting gradient per canopy object, and shader wind.
I inspected its [source](https://github.com/leoawen/fluffytree-threejs/blob/main/index.html)
and counted its downloadable GLB: 18,318 foliage triangles and 12,432 trunk
triangles, or **30,750 per tree**, excluding terrain and grass. See
`reference-mesh-audit.json`. That model is not imported into this study.

The [Blender Artists discussion](https://blenderartists.org/t/ghibli-style-tree-shader-for-eevee/1454355)
links to [aVersion of Reality's tutorial](https://www.aversionofreality.com/blog/2022/8/7/stylized-tree-shader),
which explains radial normals, leaf alpha textures and colour mixing. These
are useful techniques for achieving a soft canopy without modelling every leaf.
The [Reddit artist](https://www.reddit.com/r/blender/comments/iiq74c/blender3d_eevee_studio_ghibli_style_landscape_art/)
also emphasizes colour choices and credits Lightning Boy Studio and Kristof
Dedene. The supplied Instagram and YouTube links could not be fetched reliably;
their unseen contents have not been assessed.

The newer Sketchfab and Pinterest links returned access errors. The supplied
Keen Art image and preferred pine screenshot guide the current colour and
foliage direction; the inaccessible 3D model has not been assessed or copied.

For a Swedish golf course, retain distinct Scots pine, Norway spruce, silver
birch, oak and alder silhouettes. Use the references for foliage softness,
colour grouping and restrained detail. Do not turn all species into the same
rounded tree.

## Blender session and reproduction

The user restarted Blender after an earlier experiment stalled. The verified
backup `blender-recovery-1219.blend` restored the landmark scene with 156 objects.
The recovery and latest scene import are recorded in `mcp-recovery-confirmed.json`
and `mcp-species-loaded.json`. Background workers now build fixed-size meshes;
the live MCP only starts the worker and appends the completed study scene.
There is no pending recovery action.

From the repository root, with Blender MCP on port 9876:

```powershell
node tools/blender-tree-study/make_foliage_atlas.mjs
node tools/blender-tree-study/make_species_atlases.mjs
python upsalabuild/facilities/blender_mcp_client.py --script tools/blender-tree-study/start_species_worker.py --port 9876 --timeout 20
# Wait for SPECIES_BUILD_COMPLETE in species-worker.log before loading:
python upsalabuild/facilities/blender_mcp_client.py --script tools/blender-tree-study/load_species_study.py --port 9876 --timeout 20
node tools/blender-tree-study/check_species.mjs
node tools/blender-tree-study/build_preview.mjs
```

`foliage_species.py` imports the approved pine crowns from the existing root
`hero.glb`, `full.glb` and `lite.glb` inside the foliage-study asset directory.
Those source files can be rebuilt with `start_foliage_worker.py` if missing.
New five-species outputs use species-prefixed filenames. `branch_canopies.py`
builds the spruce and birch layouts and foliage; `foliage_envelopes.py` builds
the alder and oak crowns. Both use bounded topology. The superseded round brush
atlas is retained as study history and is not used by the current materials.

The compile check includes the app and both study entries, without copying the
large course archive. Public-file glob warnings are expected for that check.

## Earlier studies

`textured-pine.blend`, `textured-pine-*.png` and `foliage-build-report.json`
document the preferred first textured pine. Later pale, overly smooth crowns
were rejected; the current study restores foliage texture and richer greens.

[The solid-mesh comparison](http://localhost:5173/tree-study.html) retains four
pine variants and three detail levels. Its background worker is
`start_pine_worker.py`; append with `load_pine_study.py`. The largest new mesh
is 4,150 triangles. Validate it with `check_atelier.mjs --refined`.

`refined-validation.json` includes a historical course comparison made before
the user confirmed study-only scope and the URL hook was withdrawn. It measured
10,856,510 vs 10,489,900 submitted triangles at Upsala hole 2, with 127 draws in
each view. Those captures test the solid-mesh refinement, not textured foliage.
The `--course` harness option now refuses to run so it cannot label an original
course view as a revised one.

`ghibli-tree-atelier.blend` and the older `comparison-*` images document the
rejected first redesign. `legacy_refine_pine.py` is a superseded experiment;
do not execute it. Current generators do not use subdivision, remeshing or
unbounded decimation.
