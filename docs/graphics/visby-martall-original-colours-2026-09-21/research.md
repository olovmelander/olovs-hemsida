# Visby martallar: new shapes, original colours

This revision combines the four new martall silhouettes with the previous Visby
pine colours. The user subsequently chose to keep the old trees. The active
catalogue is restored to `visby-coastal-pine-2026-09-16`, with its original three
models, needle atlas and colours. This revision and the
[darker proposal](../visby-martall-2026-09-21/index.html) are archived for comparison.

- Foliage uses the existing runtime `tall` palette: `#193c2b`, `#3c7328`, `#7ba638`.
  Close meshes and distant impostors share that palette and lighting response.
- Crown vertex pigments use the previous canopy's neutral tints and strength.
- Bark uses the previous `#605a49` to `#aa8056` height gradient and grain strength.
  The new bark plate geometry uses those same endpoints.
- All four shapes, branch paths, topology, UVs, normals, root origins and triangle
  budgets are identical to the new shape study. The paired-needle atlas is retained.
- Existing course tree roots, yaw, dimensions and species remain the placement
  source. Foliage shading naturally follows each new shape's surface directions.

The Blender preview uses the earlier Blender study's `tall` presentation material.
The browser comparison uses the actual runtime palette and renderer; it is the
authoritative comparison for this archived proposal's course appearance.

The [original research](../visby-martall-2026-09-21/research.md#evidence) and source
photographs remain available. All four photographs are packed into this study's
Blender file in its hidden References collection.

## Rebuild and verification

```powershell
node tools/blender-flag/blender-bridge.mjs tools/blender-tree-study/start_visby_worker.py ORIGINAL_COLOURS=True
node tools/blender-tree-study/check_martall_colours.mjs
node tools/blender-tree-study/build_preview.mjs output/visby-martall-build/original-colours
node tools/blender-tree-study/check_visby_pine.mjs output/visby-martall-build/original-colours --captures-only --review-dir=docs/graphics/visby-martall-original-colours-2026-09-21
node tools/blender-flag/blender-bridge.mjs tools/blender-tree-study/load_visby_study.py ORIGINAL_COLOURS=True
```

The builder exports `candidate-catalogue.json`; it does not select an active
catalogue automatically. Keep the archived candidate separate from the active
`apps/golf/public/models/trees/ghibli-visby.json`. The validation artifacts below
describe this proposal when it was tested, not the restored course selection.

Validation artifacts: [geometry and colours](colour-validation.json),
[browser and offline assets](runtime-validation.json),
[matched cameras and image hashes](comparison-manifest.json),
[Blender scene](blender-validation.json).
