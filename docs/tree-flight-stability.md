# Stable trees during fast camera movement

The September 9, 2026 tree fix targets apparent LOD flipping and sparkling tree
edges on both WebGPU and WebGL2. It requires no new Blender assets or URL flag.

## Keep detail tied to the course

The existing default is already geographic (`lodmode=zone`). The distance is
from any hole's playing line, rasterised once on a 12 m grid; it is **not** the
distance from the camera. The fix preserves that policy and adds a regression
that runs the application's actual tier update through 180 rapid camera
placements, including repeated frustum exits and reentries.

| Distance from a playing line | High quality | Low quality / phone |
| --- | --- | --- |
| Within about 90 m | Hero mesh | Full mesh |
| About 90–300 m | Full mesh | Reduced mesh |
| About 300–700 m | Reduced mesh | Billboard |
| Farther out | Billboard | Billboard |

Changing the camera position, altitude, zoom or active view does not change a
tree's geographic tier. `lodmode=screen` and `lod=1..4` remain explicit review
overrides. Normal visits should use the default zone mode.

## What caused the apparent switching

1. **A shader branch could read an uninitialised atlas cell.** In Three r185,
   `select(lower, i0, i0.add(1))` could generate `floor(grid)` only inside the
   lower branch, then reuse that variable in the upper branch and the other
   two frames. The lit-material fixture reproduced triangular flashes and
   wrong atlas samples. Adding the selected scalar offset to `i0` outside the
   branch gives every path an initialised cell origin.
2. **The billboard basis abruptly changed near overhead.** The old `view.y >
   0.999` switch changed its reference axis. The new basis is continuous over
   the baked upper hemisphere, including the zenith.
3. **The three baked views were blended at the same UV.** Their image axes
   differed, and instance yaw/nonuniform scale made that mismatch more visible.
   Each billboard point is now projected into each selected bake camera before
   sampling. The billboard also uses the support of the scaled template sphere
   so tall trees are not stretched/squashed by the old horizontal/vertical
   rectangle when viewed overhead.
4. **A hard 50% alpha test made patches blink.** With two equally weighted
   views, a patch present in only one view has exactly 50% coverage. Tiny camera
   movements could discard or reveal the entire patch. The mipmapped coverage
   now feeds the existing four-sample MSAA directly. Empty texels are discarded
   after atlas colour sampling; the existing complementary fade mask is applied
   at the same point. There is no random transparency noise.
5. **Cell bounds used a nominal 14 m tree and an 8 m margin.** Larger crowns,
   nonuniformly scaled trees and tilted billboard corners could still be on
   screen when their cell disappeared. Bounds now include all actual mesh
   templates, scaled wind displacement and every orientation of the billboard.
   Atlas framing also checks all template vertices against its enclosing sphere.

Tree coordinates, species, measured dimensions, populations and course data
remain unchanged. This addresses reproduced tree-edge pixels and atlas flashes;
it does not change the water material or introduce a particle effect.

## Verification

- The full repository suite passes: **571 Vitest tests and 405 Node tests**;
  three pre-existing Node tests are skipped.
- The actual geographic tier-update regression passes for high/low quality,
  WebGL2 depth and WebGPU reversed depth, with **zero detail changes** during
  each 180-placement flight. Culling/reentry still occurs.
- Real Three shaders run in Chromium on both backends. The fixture uses an
  asymmetric, rotated, nonuniformly scaled tree, rather than a round tree that
  could conceal an orientation problem. It checks the old polar boundary,
  the zenith, atlas frame boundaries, lit materials and fade attributes.
- A subpixel pan of a small distant tree compares hard cutout and filtered
  coverage within the corrected material. Its visible-area range fell from
  approximately **9.39% to 6.15%** of mean area on both backends. This measures
  temporal silhouette stability, not FPS or a promise to eliminate all aliasing.
- The production app builds successfully. Full-course Visby integration is
  checked separately with the application's graphics capture and flight tool.

Evidence: [`graphics/tree-flight-2026-09-09/`](graphics/tree-flight-2026-09-09/).
The renderer captures use **SwiftShader software rasterisation**. A physical
phone/desktop performance measurement is still separate from these correctness
checks. The larger conservative cell bounds can retain extra trees near screen
edges; the shader retains six atlas texture reads and moves frame projection
work to the vertices. Tree counts and detail bands are not increased.

Reproduce the small shader proof from the repository root:

```sh
node tools/tree-flight-review.mjs --out /tmp/tree-after --chrome /path/to/chromium
node tools/tree-flight-review.mjs --out /tmp/tree-before --chrome /path/to/chromium --ref 81fbd2c
```

The proof builder selects the historical material only; both runs use the same
fixture. An additional `--backend webgl2` or `--backend webgpu` limits a diagnostic
run. The main application capture tool accepts `--tree-flight` to record live
tier counters across 12 rapid placements without freezing the tree system.

See also the established [geographic LOD policy](tree-lod-plan.md) and Three's
[MSAA alpha-to-coverage documentation](https://threejs.org/docs/pages/Material.html#alphaToCoverage).
