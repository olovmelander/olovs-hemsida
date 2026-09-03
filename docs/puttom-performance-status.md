# Puttom v2 performance — where things stand (2026-09-03)

The owner asked for better frame rate and faster boot on Puttom's 1 m terrain
(`?v2=`), with no GPU machine at hand: everything here was measured on the
SwiftShader harness with exact-output gates, and the numbers that need a real
GPU are marked as owed. Two bodies of work came out of it.

## 1. Boot — merged to `main` (PR #7, bdf4763)

Boot went **42.6 s → 24.0 s** on the page clock with the same world: the
fingerprint (`tools/boot-profile.mjs --fingerprint`, a hash of every tree
instance, both tint rasters and every count) is identical before and after.

What changed, all exact-output:

- `engine/ring-index.mjs`: a grid index over ring edges with a bounded
  growing-square search, so `ringSD`/`distToLine`/`inRing` stop walking
  whole rings per sample. Exact below a cutoff, correct sign and magnitude
  above it. classifyAnalytic 14.5 → 3.55 µs, groundAt 21.6 → 10.2 µs.
- Classifier cutoffs and a HOLES bounding-box prune (`CUTOFF` in
  `engine/surface.js`).
- Water beds carved with a boxed walk plus a dilated near-water mask.
- The vegetation coverage test is a lattice map, not a ring walk.
- The v2 settle overlaps the rest of boot (`prepare({settle:'coverage'})`,
  then `terrainV2.settle()` before "klar").
- Pilot terrain texels derived lazily (`lazyRenderData`).
- `tools/boot-profile.mjs`: stages, spans, runtime log, `--fingerprint`,
  `--frames`, `--verbose`. The 35–45 s first frame under SwiftShader is
  shader compilation and is not a boot cost.

Also on `main` from the same day: the GitHub Actions course-geo pipeline
repaired (CRLF-proof manifest hashes, `.gitattributes`, regenerated
migration artefacts, `COURSE_MODEL_SHA256` re-pinned).

## 2. Trees — on `claude/tree-lod-phase-1` (19 commits ahead of `main`, no PR yet)

The plan is `docs/tree-lod-plan.md`; its status section carries every
measurement. The population never changes: fingerprint identical on every
commit, and the vegetation baseline, check-app on all nine courses and
vitest (224 tests) pass on the branch head.

| | baseline | now |
|---|---|---|
| triangles per frame (1st tee) | 48.8 M | ~10 M, of which the trees are about one million |
| trees drawn in that frame | 79,407 | ~13,600 |
| far ring | 57,652 cones × 10 tris | 57,652 impostors × 2 tris |
| draws | 266 | 289 |
| boot (harness) | 24.0 s | 28.1 s (the atlas bake is 1.65 s of it) |

**Phase 1 — tiers.** Per 128 m cell, from the projected height of a nominal
12 m tree, with 10% hysteresis: full template, decimated template, and
nothing at all outside the frustum (that alone removed 83% of the trees
from a tee view). One `InstancedMesh` per (species, part, tier); a tree
moves between tiers by a swap-remove and an append, matrices copied from a
table. Not `BatchedMesh`: on the WebGPU backend it is one draw command per
instance.

**Phase 2 — octahedral impostors** (`engine/tree-impostor.mjs`). Baked at
boot from the very templates the meshes draw, 8×8 hemi-octahedral views of
albedo+coverage and tree-frame normal+crown mask, drawn as a lit billboard
blending three frames. Four faults found and fixed by measurement, each
recorded in the plan: frames upside down (three's WebGL backend places
viewports from the bottom and flips v on render-target textures; frames are
now placed by the projection and read back flipped, unit-tested), holes
(mipmapped now), green trunks (an opaque NodeMaterial forces alpha to 1, so
the bake uses NoBlending), and 37% too bright at golden hour (lighting the
crown's mean normal is not the mean of lighting its facets; the lighting
normal is bent halfway to the viewer, `IMPOSTOR_BEND` = 0.5, swept and
calibrated to within 2–3% of the mesh tier at golden hour and at noon).

**Phase 3 — the hero tier.** The plan's alpha-tested needle/leaf cards were
built, shown to the owner, and taken out the same day: on flat-shaded
low-poly crowns they read as debris. The hero tier is instead the same crown
grown at a finer subdivision (24-segment cones, level-2 icosahedra), a
12-segment trunk with a bark bump and a root flare. About 190 hero trees in
a tee view. It also exposed that the tier distance was measured in the
ground plane only, so an overhead camera "stood in" the trees under it;
the distance is to the cell's box now, height included.

**Harness lessons worth keeping** (all in the plan): a SwiftShader frame can
outlast any fixed wait, so `V3D.settled()` and `V3D.frame()` are what a
shot waits on; a debug view is tone-mapped whatever the material says, so
scalars are shown in colour bands; measure like with like — the first shot
after boot differs from later ones over the whole ground.

Tools added: `tools/tree-lod-ab.mjs`, `tools/tree-tiers-at.mjs`,
`tools/impostor-atlas-read.mjs`, `tools/impostor-ablation.mjs`,
`tools/impostor-bend-sweep.mjs`; page hooks `?lod=1|2|3|4`, `?impdbg=`,
`V3D.setTreeLod`, `V3D.setImpostorBend`, `V3D.treeAtlas`,
`V3D.treeTemplates`.

## What is left

1. **Look at it on the RTX 3070** (`BANVY_GPU=1`, `?v2=require`). Phase 0
   of the plan — frame time and triangle counts on real hardware — was
   never run, and the hero tier and the impostor switch distances exist to
   be judged by eye. Things to look for: the 14 px impostor switch and the
   40 px decimated switch (pop or not), the hero crown up close, the bark
   bump, impostor brightness at golden hour against the mesh trees beside
   them, and the far ring's impostors from the overhead view.
2. **Open a PR for `claude/tree-lod-phase-1`** and merge it to `main` once
   the hardware look is acceptable; `main` only carries the boot work.
3. **Crossfade at the tier switches** (phase 4) if the switch shows: a
   dithered per-instance fade, at the cost of drawing both tiers for
   0.25 s.
4. **Terrain shadow radius**: the terrain casts shadows from the whole
   instanced frontier every frame and is now the larger half of the shadow
   pass; cast only from tiles inside the shadow radius.
5. **Phone budget** (LOWQ): the boundaries already move in (200/60/22 px),
   but nothing has been measured on a phone.
6. **Boot, if it matters again**: the remaining big spans are v2 prepare
   (6.8 s, worker + first frontier + preflight) and the stream to full
   residency (3.5 s); the tree work adds about 1.8 s (bake + tiers).
7. **Open in the plan, unrelated to trees**: the model's lake names sit on
   the wrong rings (CLAUDE.md, Puttom section) and the card's two disputed
   index cells — both left for the owner.
