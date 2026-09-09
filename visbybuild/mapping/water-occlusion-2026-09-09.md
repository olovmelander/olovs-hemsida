# Visby water occlusion follow-up — 2026-09-09

The owner reported reflective water over mainland terrain at some camera angles
and when zooming out. The screenshot uses the WebGPU world terrain view.

## Investigation

- The previous Ängsö fixes are present: reject non-level terrain flats, keep
  inland lakes from requesting an ocean, and average shoreline tint coverage.
- Visby's published pack has `terrainPlacement: measured-only` and preserved
  mapped boundaries. Its runtime skips flat-water detection and bed carving.
- The current Pages engine includes the connected coastal extension. Its quads
  stay outside the 4096 m mapped window. The published-terrain check protects
  1,392 played points, 64 low dry samples and 11,631 samples in ten islands.
- All 3,373 original water triangles have their non-degenerate centroids inside
  their source rings. No polygon edits are justified by this report.
- The remaining water material bias was constant-only, but still moved water
  toward the camera. This can defeat foreground-land occlusion at distance.
  Float bias also depends on the triangle's maximum depth, which matters for
  long ocean triangles crossing the near plane. See the
  [Direct3D depth-bias definition](https://learn.microsoft.com/en-us/windows/win32/direct3d11/d3d10-graphics-programming-guide-output-merger-stage-depth-bias).

## Change

Measured water now has no polygon offset, and uses a strict depth comparison:
foreground terrain wins if land and water quantize to the same depth value.
Three handles reversing that comparison for reversed depth. Mapped sheets keep
their existing 0.06 m physical display lift; the connected ocean extension keeps
its existing tolerance + 0.01 m lift. Both use the same material policy.
`V3D.coastalWater()` now reports the active depth settings as well as geometry.

Source levels, terrain, shoreline geometry, sea connectivity and legacy inland
water behavior are unchanged. No Lantmäteriet download or rebuild is needed.

## Verification and limits

`water-render-policy.test.mjs` uses Three's perspective projection at 250,
1,000 and 4,200 m, with 2°, 8° and 30° viewing pitches. It verifies foreground
land occlusion for 24-bit conventional and reversed float depth. The previous
two-unit bias is a negative control that demonstrably leaks. A separate check
keeps Visby's displayed sea visible over its 0.24 m laser plate with reversed
float depth. These are numerical depth checks, not rendered screenshots or a
complete reproduction of the owner's camera pose.

The water/flat-water/terrain test set passes (23 tests); the published Visby
checks and production build also pass. The preview server was repaired to run
from the workspace root, but this browser exposes neither a working WebGPU nor
WebGL2 backend. GPU confirmation remains outstanding. On a conventional shallow
depth buffer, unresolved equal-depth water/bed samples now favor the terrain;
that is intentional to prevent foreground flooding and needs visual review.

For the GPU check, open Visby hole 1 in evening light, pull back to the whole
course and orbit through low angles. Repeat in daylight and at the 4.2 km zoom
limit, then compare normal WebGPU, `rdepth=0`, and `gl=1`. Check that actual sea
and ponds remain visible and foreground land stays dry. Report the camera pose
and `V3D.coastalWater()` if any patch persists.
