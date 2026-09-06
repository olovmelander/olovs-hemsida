# V2 water lighting preview

Prepared 2026-09-06 against main
`241a3eeb4999442604d6e5ec41bfa020db822b30`. The implementation source checkpoint is
`99274ee10b54d6a58dccee9f4598e478b38f3a11`. This follows the
[foliage depth pass](v2-foliage-depth-preview.md).

## Changes

With active v2 and `graphics=1`, the water's analytic sky reflection now uses the
same horizon and zenith palette as the scene's indirect lighting. Dawn, golden,
mist and autumn therefore influence water colour through their lighting presets,
rather than through sun height alone. The existing reflection angle, Fresnel,
ripples, glints, foam, depth colour and opacity calculations remain unchanged.
The original reflection shader remains in use when the preview is disabled.

Palette derivation runs on preset changes and updates two shared RGB uniforms.
The reflection node removes two colour blends and a smoothstep from its TSL graph
while keeping its one existing reflection power. No texture sample, render target,
geometry or additional render pass is introduced for this appearance change.

Two rendering/startup cleanups also apply to ordinary visits:

- Individual flat pond/lake meshes and the flat sea now use one double-sided
  rendering pass. Previously Three submitted separate front/back draws for these
  flat sheets. Masked water batches spanning multiple elevations retain their
  original two-pass ordering.
- The unused 512 × 512 `GRASSN` generator is removed. It had no runtime consumer.
  This avoids generating its pixels and allocating its 1 MiB temporary pixel
  array. The active sand and water maps remain intact. Total startup improvement
  and total memory usage have not been measured on a real device.

Course data, mapped water outlines/levels, objects, terrain geometry, tree
placement/species/heights/population and fixed geographic tree zones are unchanged.

## Validation

347 Vitest tests and 295 Node tests passed, alongside app lint, the production
Pages build, v2 renderer/build checks and course source-manifest validation.
The new tests check linear colour/palette agreement, reused uniform identities
across preset switches and the reflection graph's texture/math budget.

The [isolated water check](graphics/water-single-pass-check.json) uses the actual
app water shader, fixed synthetic textures and time, an opaque occluder and an
overlapping transparent object. All 24 WebGL2 comparisons passed: pond, lake,
sea and masked batch, viewed above/below/at grazing angles with both normal and
reversed depth. Each before/after pair uses the same lighting and appearance.

| Isolated-scene observation | Two passes → selected policy |
| --- | --- |
| Ordinary water scene draws | 6 → 5 |
| Masked batch scene draws | 6 → 6 |
| Different RGBA pixels in each case | 0 / 49,152 |
| Actual drawing buffer | 256 × 192 → 256 × 192 |

Hiding the water changes 421–30,208 pixels per case, confirming that the equality
check includes visible water. Toggling the pass policy reuses the compiled water
fragment shader. Its texture-call/sampler-uniform counts stay at 5/2 for ordinary
water and 6/3 for masked water. Reproduce with
`node tools/check-water-single-pass.mjs --out /tmp/water-single-pass`.

These are SwiftShader correctness and submitted-work observations, not measured
hardware FPS. The palette change is intentional and is reviewed separately from
the pixel-identical pass optimization.

The [matched Veckefjarden capture](graphics/v2-water-lighting-visual-check.json)
reviews hole 14's peninsula under golden lighting, with `graphics=1` on both
revisions. Both raw browser runs passed with zero errors at the same 384 × 288
drawing buffer, DPR 1, locked low quality and automatic WebGL2 fallback. All
12 data/request fingerprints and the camera, terrain inventory/visibility and
geographic tree-zone contracts matched. The lake reflection is subtly brighter
and more neutral; shoreline, rocks and peninsula remain aligned. Bright sun
glare dominates this view, so it is a restrained tonal improvement rather than
evidence for every preset or course.

## Review and remaining checks

- [Veckefjarden lake preview](https://olovmelander.github.io/olovs-hemsida/?bana=veckefjarden&v2=require&graphics=1&hal=14&vy=green&ljus=kvall)
- [Uppsala preview](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&v2=require&graphics=1)

Before making the appearance the default, compare real desktop WebGPU and phone
WebGL2 separately against `241a3ee`, with `graphics=1` on both revisions and equal
course data, quality, actual drawing-buffer resolution, lighting and camera
trajectories. Check median/p95/p99 frame times, moving-camera hitches, startup and
memory. Use `qualitylock=1` for controlled comparisons and verify ordinary fallback
separately. Uppsala remains the visual review course, Puttom the forest load check,
and Veckefjarden the water check. Physical GPU measurements remain open.

The next small material candidate is bark: its current colour and bump use
different UV scales. Aligning the two should improve close-up coherence without
adding samples, but the actual compiled shader and image need checking first.
