# Golfer development handoff

**2026-09-16: preserve the prototype and continue developing it separately. Full app integration is deferred at the user's request.**

## Resume the lab

From the repository root:

```powershell
npm --prefix apps/golf run dev:golfer
```

- [Character studio](http://localhost:5180/golfer-study.html): female/male selection, all motions and clubs, slow playback, scrubbing, front/side/back views, optional travel across the floor.
- [Experimental course integration](http://localhost:5180/?bana=puttom&golfer=1&ghibli=1&ljus=dag): test movement, terrain fitting, setup, swings and character switching against the real course.
- [Animation gallery and findings](../../docs/graphics/golfer-2026-09-16/animation-audit/README.md).

The ordinary app stays on port 5173. `npm --prefix apps/golf run build` compiles out the golfer integration and excludes its HTML, modules and models. The `golfer` Vite mode enables the lab explicitly. Its assets live here, outside the app's `public` directory. Its dependency cache and port are separate; it does not install a service worker.

An optional local lab build is available with `npm --prefix apps/golf run build:golfer`, followed by `npm --prefix apps/golf run preview:golfer`. It writes to ignored `output/golfer-lab-build/`. Normal app deployment commands do not select that mode or directory.

Both builds passed. [Isolation verification](../../docs/graphics/golfer-2026-09-16/isolation-verification.json) confirms zero golfer files/code in the normal build and no golfer requests or panel when opening the built app with `?golfer=1`. Studio playback and all ten character/club combinations still pass in the lab. `check_isolation.mjs` can repeat this check with normal dev on 5173, lab dev on 5180 and a normal production preview on 5181; it reads builds from `output/golfer-build` and `output/golfer-lab-build`.

## Preserved work

| Location | Contents |
| --- | --- |
| [Native Blender files and renders](../../docs/graphics/golfer-2026-09-16/) | Separate female and male `.blend` files, the paired review scene, rigs, editable source meshes, packed texture, 40 native actions, renders and audit reports |
| [Runtime models](assets/) | Two GLBs and their manifests; 20 clips per character, baked at 60 fps |
| [Blender pipeline](../../tools/blender-golfer/) | Geometry builders, shared animation authoring, export, rendering, browser checks and motion audit |
| [Character runtime](../../apps/golf/src/engine/golfer.mjs) | Loading, playback, club switching, state transfer, impact events and root turns |
| [Course integration prototype](../../apps/golf/src/engine/golfer-course.mjs) | Camera-relative movement, terrain fitting, aiming and illustrative ball flight |
| [Studio](../../apps/golf/golfer-study.html) | Review UI and its [controller](../../apps/golf/src/golfer-study.mjs) |

The app entry retains a compile-time lab gate so the integration can continue without rebuilding it from scratch. Both loading and per-frame updates are eliminated from normal builds. `?golfer=1` alone does not enable the normal app.

## Checkpoints and version control

Verified ZIP checkpoints are stored outside the repository in `C:\Users\olov_\Banvy-golfer-checkpoints`. They contain the native Blender files, exports, scripts, prototype code, reports and SHA-256 inventory. The first checkpoint is `20260916T093140Z-animation-v2-before-isolation.zip`; the `golfer-lab-isolated` checkpoint contains this isolated setup.

Create another checkpoint after a reviewed milestone:

```powershell
python tools/blender-golfer/checkpoint.py --label golfer-next-review
```

These are local backups, not a remote backup or Git commit. The working tree also contains unrelated course/tree development. No branch switch, commit, deployment or unrelated reset was performed. Before publishing a future feature branch, stage only the golfer files and the relevant shared-file changes. Shared app files in an archive are context snapshots and should be restored selectively. Generated build output and the downloadable CC0 source cache are not included; the modified source anatomy is retained in the native Blender files.

## Continue character work

1. Open `docs/graphics/golfer-2026-09-16/banvy-golfer-pair.blend` in Blender and enable the MCP bridge on port 9876. It contains the two ateliers and the paired review scene.
2. Improve design, skinning and motion in this prototype. Save manual edits to a new native revision before running a builder: `refine_golfer.py` recreates generated geometry, and `rebake_animations.py` replaces the generated actions.
3. For authored motion changes, edit `tools/blender-golfer/animation.py`, run the rebake through the bridge, then run the finish scripts. Exports now go to `experiments/golfer/assets/`.
4. Review the actual exported characters in the lab and run the relevant checks. Save a new checkpoint after the review.

```powershell
python puttombuild/facilities/blender_mcp_client.py --script tools/blender-golfer/rebake_animations.py --timeout 240
python puttombuild/facilities/blender_mcp_client.py --script tools/blender-golfer/finish.py --timeout 240
python puttombuild/facilities/blender_mcp_client.py --script tools/blender-golfer/finish_pair.py --timeout 240
node tools/blender-golfer/audit_motion.mjs
node tools/blender-golfer/check_directions.mjs
node tools/blender-golfer/check_pair.mjs
```

The broader [character README](../../docs/graphics/golfer-2026-09-16/README.md) documents full rebuilds and provenance. The latest motion audit checks all 40 clips at 120 Hz. The coordinate contract is Blender forward -Y / up +Z, glTF forward +Z / up +Y, with the right-handed shot along local +X. Five club-specific impact markers and matching metadata drive the preview.

## Later integration

Continue in this order: character and animation polish; runtime transitions, terrain and club interaction; mobile performance and mesh LODs; then an explicitly approved app integration. Preserve the existing animation names, coordinate convention and impact metadata during that work, or update the runtime and audits together.

The present prototype has no scoring, real ball physics, obstacle navigation, collision-aware swings, facial animation, secondary hair motion or cloth simulation. Those are future design decisions. Shipping the golfer is a separate step; keeping or developing this lab does not enable it for app users.
