# V2 foliage depth preview

Prepared 2026-09-06 against published main
`a40681dac130275f136f9dae9eb26dbeb279f66b`, including the WebGL2 surrounding-terrain
fix. This is the next pass after [the initial graphics preview](v2-graphics-pages-preview.md).
The added foliage appearance remains opt-in with `graphics=1` and active v2.

## Changes and rendering cost

- Crown undersides and lower foliage have restrained darker colour variation;
  exposed upper tips are slightly warmer. This is baked once into the existing
  colour attribute for all three species and all three mesh detail tiers. Each
  species uses the full template's height envelope across its tiers. Far-tree
  atlases inherit the same colours during their existing bake.
- No new tree vertices, indices, attributes, material samples, shader operations
  or draw calls are introduced. There is a small additional CPU loop at tree
  template construction; its real-device startup cost remains unmeasured.
- When automatic quality fallback has already disabled bloom, rendering now
  bypasses its otherwise still-running blur/composite pipeline. Ordinary visits
  also receive this correction. Existing quality thresholds and drawing-buffer
  policy are unchanged. Post-process resources remain allocated, so this is not
  a claim of lower memory usage.

Course packs, terrain, mapped objects, tree placement/species/heights, tree
population and fixed geographic detail zones are unchanged by this pass.

## Validation

345 Vitest tests and 295 Node tests passed, alongside the production Pages build,
app lint, v2 renderer/build checks and course source-manifest validation. Crown
tests verify that the existing attribute allocations, non-colour bytes, indices,
bounds and groups are preserved.

A check using the actual nine app crown constructors and integration block kept
6,517 vertices, 3,208 triangles and 273,108 attribute/index bytes unchanged. It
verified identical position, normal and index hashes, reused attribute objects
and arrays, and unchanged bounds/groups. With `graphics=0`, every byte stayed
unchanged. The colour multipliers remained between 0.885 and 1.058720.

An isolated Three r185 WebGL2 scene compared zero-strength bloom with the direct
fallback path at the same 256 × 192 drawing buffer, DPR 1, four samples, HalfFloat
output and ACES settings. It included opaque geometry, transparent water and an
HDR emissive object. Draw calls fell from 18 to 6; all 49,152 pixels were identical.
Switching back reproduced the same image. These are SwiftShader correctness and
render-work observations, not real-device FPS measurements.
The [recorded result](graphics/v2-foliage-depth-bloom-check.json) identifies the
baseline and helper source hash. Reproduce it with
`node tools/check-bloom-bypass.mjs --out /tmp/bloom-bypass`.

Matched Puttom tee and canopy views were captured on the baseline and this pass,
both with `graphics=1`, locked low quality and a 480 × 360 drawing buffer. The
automatic WebGL2 fallback path retained reversed depth. Course/tree fingerprints,
camera, quality and geographic tree tiers matched; visible terrain sets matched
at 66 tiles for the tee and 81 for the canopy view. Both captures reached settled
terrain with zero failed/loading tiles. Visual review found continuous terrain,
unchanged silhouettes and restrained crown colour changes.

The raw full-browser reports both remain **failed** because the same
`grounds/puttom/preview.json` request was cancelled with `net::ERR_ABORTED`.
The cause was not established; it did not prevent either view from completing.
There were no page/shader errors. Per-frame scene counters vary with shadow
refresh timing and are not used as a before/after performance comparison. See
the [capture summary](graphics/v2-foliage-depth-forest-check.json) for exact source
revisions, bundle hashes, preserved contracts and the unresolved request error.

## Review and hardware checks

- [Uppsala preview](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&v2=require&graphics=1&hal=1&vy=tee&ljus=kvall)
- [Puttom forest preview](https://olovmelander.github.io/olovs-hemsida/?bana=puttom&v2=require&graphics=1&hal=1&vy=tee&ljus=dag)

The same-or-better performance requirement still needs real desktop WebGPU and
phone WebGL2 measurements. Compare this pass against `a40681d` with `graphics=1`
on both revisions, identical course data, camera motion, light, quality and actual
drawing-buffer dimensions. Use `qualitylock=1` for the controlled comparison and
check the normal automatic fallback separately. Record median/p95/p99 frame
times, moving-camera hitches, startup and memory. Review Uppsala visually, Puttom
for forest load and Veckefjarden for water. Keep the appearance opt-in until those
checks are accepted; no unchanged-FPS claim is made here.
