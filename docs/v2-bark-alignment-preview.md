# V2 bark alignment preview

Prepared 2026-09-06 against main
[`5d9c4f27514d97fa608f8fef6713717de2c46ea7`](https://github.com/olovmelander/olovs-hemsida/commit/5d9c4f27514d97fa608f8fef6713717de2c46ea7).
Validated implementation checkpoint:
[`464f403f19fe518be4ee7264199059520726ed09`](https://github.com/olovmelander/olovs-hemsida/commit/464f403f19fe518be4ee7264199059520726ed09),
tree `5051911cc60d090830c0e17f615bb566c3b59992`.

## Change and scope

With active v2 and `graphics=1`, nearby high-quality trunks now use the same bark
texture and UV coordinates for colour and bump relief. Previously their visible grain
repeated at `(3, 1.5)` while relief used the texture's default UVs, so the grooves
and visible fissures did not line up.

The generator's already-quantized pixels are measured once to centre the colour
multiplier around one. This brings textured trunks' average albedo into agreement
with the plain trunk tiers, keeping the existing contrast multiply/add operations.
The pixel array and texture are not changed, and no canvas readback is needed.
The extra mean calculation happens during texture construction, not per frame.

The change reuses the existing 256 × 256 texture, UVs, material and trunk geometry.
Wind/fade handling, mapped tree placement/species/heights/population and fixed
geographic detail zones remain unchanged. `graphics=0` keeps the original bark
material. The normal phone/low-quality zone policy uses the simpler full-tree
trunks, so this appearance change applies to high-quality hero trunks; it does
not raise the phone's tree-detail setting.

## Validation

352 Vitest tests and 295 Node tests passed, alongside app lint, the production
Pages build, v2 renderer/build checks and course source-manifest validation.
Focused tests check distinct sample nodes with shared texture ownership and UV
coordinates, disabled-path material parity and mean calculation from quantized bytes.

The [eight-case material rendering check](graphics/bark-material-check.json)
uses the actual BARK generator and hero trunk geometry under fixed noon/golden
lighting. It covers pine close, above and grazing views, a birch close view and
one reversed-depth WebGL2 case. All eight pass; `graphics=0` reproduces legacy
pixels exactly. These are software-rendered material checks, not course FPS.

| Material fixture measurement | Before | After |
| --- | ---: | ---: |
| Bark texture reads in emitted fragment shader | 4 | 4 |
| Draw calls, including output quad | 2 | 2 |
| Triangles, including output quad | 61 | 61 |
| Bark RGBA texture bytes, including mipmaps | 349,524 | 349,524 |
| Mean bark albedo multiplier | 0.92564047 | 1 |

Geometry buffers and texture resources remain identical. The four shared Three.js
BRDF LUT reads also remain unchanged. These shader counts do not establish GPU
timing. Mean albedo calibration is not a claim about final pixel brightness.

The check caught an r185 caching trap before publication: reusing the colour's
TextureNode for bump relief collapsed the derivative differences to zero. The
corrected material uses a separate relief TextureNode referencing the same texture
and UVs. Generated GLSL now contains distinct centre and derivative samples; a
flat control with identical albedo confirms nonzero visible relief in every view.
The reviewed material images support retaining the existing 0.05 bump strength.

The [Uppsala integration attempt](graphics/v2-bark-visual-check.json) selected an
existing LiDAR individual pine safely inside geographic zone A, 36.05 m from the
nearest hole line. It confirmed locked high quality, a 320 × 240 drawing buffer,
DPR 1, normal zone tiers with no LOD override, visible hero trees and settled
terrain with no failed/loading tiles. However, the baseline software screenshot
exceeded the 180-second limit. The raw failure is retained: no full-app image or
accepted before/after app comparison was completed, and it was not retried at a
different quality or resolution.

## Review and hardware checks

[Open the high-quality Uppsala preview](https://olovmelander.github.io/olovs-hemsida/?bana=upsala&v2=require&graphics=1&q=hi&hal=1&vy=tee&ljus=dag)
and zoom toward a nearby trunk. This link deliberately selects high quality to
show the affected tier; the ordinary phone setting does not render hero bark.

Real desktop WebGPU and phone WebGL2 performance remain unmeasured. Before making
the appearance the default, compare exact revisions with the same quality,
actual drawing-buffer dimensions, course data, lighting and camera trajectories.
Check median/p95/p99 frame times, moving-camera hitches, startup and memory;
verify automatic fallback has not silently reduced resolution. Keep the preview
opt-in until those checks are accepted. No unchanged-FPS or total-memory claim
is made from software rendering.
