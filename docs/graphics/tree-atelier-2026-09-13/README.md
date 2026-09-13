# Swedish golf tree design study

The first redesign was rejected for its rounded, separate foliage clumps.
The recommended direction is to refine the original silhouettes: strong,
connected foliage masses, natural Swedish branching, restrained surface detail,
and painterly warm light / cool shade. Increased polygon count alone is not a
useful quality target.

## Current comparison

- [Interactive original/refined pine](http://localhost:5173/tree-study.html)
- [Upsala hole 2, pine refinement](http://localhost:5173/?bana=upsala&ghibli=1&hero=1&hal=2&vy=tee&ljus=kvall&treeart=refined)
- [Original course trees](http://localhost:5173/?bana=upsala&ghibli=1&hero=1&hal=2&vy=tee&ljus=kvall)
- `refined-pine.blend`: four pine variants, editable in Blender.
- `refined-tall.png`: the same species, variant, lighting and camera side by side.

The default catalogue remains `ghibli-v1.json`. Only `treeart=refined` selects
the new manifest. That manifest changes pine alone and references the original
GLBs for spruce, birch, alder and oak. The original pine seeds and branching
recipe are retained. Course placement, tree species assignments and the camera
are not edited by this study.

## Design recommendation

- Scots pine: broad, irregular connected crowns; distinctive bent trunks;
  readable supporting limbs; subtle grey-to-copper bark.
- Norway spruce: keep the clear tapered outline, but refine its skirt edges
  and vary individual boughs without losing the overall silhouette.
- Silver birch: a light crown with some sky visible between branches; restrained
  hanging foliage; narrow white trunks with sparse markings.
- Oak and alder: emphasize their different proportions and branch structure,
  using similar foliage detail and palette restraint across the collection.

Avoid disconnected balls, regular branch spirals, excessive micro-detail and
uniformly bright foliage. Judge examples at golfer eye height in the actual
course lighting, as well as in a neutral modelling view.

Art references: Studio Ghibli's official [My Neighbor Totoro gallery](https://www.ghibli.jp/works/totoro/)
and [Princess Mononoke gallery](https://www.ghibli.jp/works/mononoke/).
These are visual direction references, not textures or models used in the app.

## Reproduction and validation

**Session recovery:** a later, discarded refinement stalled the live Blender
process (PID 17936). It was paused without terminating it to stop memory growth.
`blender-recovery-1219.blend` is a copied 12:19:25 autosave, independently opened
and verified in background Blender. It contains the original landmark scene
with all 156 objects and the previously completed study scenes; see
`recovery-audit.json`. Restarting from that backup requires the user's approval
because edits after the autosave could otherwise be lost. The failed refinement
did not replace the saved GLBs or manifest; its source changes were rolled back.
Do not send more MCP work to the paused process before recovery.

After recovery, run from the repository root with Blender MCP listening on port 9876:

```powershell
python upsalabuild/facilities/blender_mcp_client.py --script tools/blender-tree-study/refine_pine.py --port 9876 --timeout 300
& 'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe' --background docs/graphics/tree-atelier-2026-09-13/refined-pine.blend --python tools/blender-tree-study/package_refined.py
node tools/blender-tree-study/check_atelier.mjs --refined --course
node tools/blender-tree-study/build_preview.mjs
npx vitest run apps/golf/src/engine/tree- apps/golf/src/engine/look-mode.test.mjs
```

Modelling/export runs through the live MCP. Packaging and rendering use a
background Blender process. The modelling script uses a separate scene and
restores the user's active scene; it does not save over their unsaved work.

The browser harness verifies GLB byte counts and SHA-256 hashes, the runtime
asset inspector, finite positions/normals/colours, preview layout at phone width,
four pine variants, and the original/refined course views on WebGPU.
`refined-validation.json` contains the measured results. The focused tree and
look-mode suite passed 47 tests. The application and preview entries compile
with Vite; this compile check excludes the course archive from its output.

This is an opt-in visual study. It is not approved as the default look, and
phone GPU performance and moving LOD transitions need assessment before rollout.

## Superseded exploration

`comparison-*.png`, `blender-five-species.png0001.png` and
`ghibli-tree-atelier.blend` document the rejected first approach and its intermediate
refinement. Its generated runtime catalogue was moved to
`output/tree-atelier-rejected-2026-09-13/`, outside public assets. The initial
generator remains in `tools/blender-tree-study/atelier_trees.py` for reproducibility
and provides material helpers used by the pine refinement.
