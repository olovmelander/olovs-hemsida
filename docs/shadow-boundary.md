# Moving shadow boundary

The moving dark rectangle was the finite directional shadow map following
the camera target. Inside the map, trees and buildings cast shadows; outside
it, Three treats receivers as fully lit. Its hard bounds were visible across
woodland, particularly where the depth limit intersected a hill in evening
light. Disabling shadow intensity at an unchanged camera pose removed the
rectangle, confirming the cause independently of terrain LOD and ground tint.

`engine/sun-shadow.mjs` wraps the installed Three PCF filter with a smooth
coverage weight. Coverage is full around the centre, fades over the outer
part of a circular footprint, and reaches zero before the map clips. Both
depth ends also fade, symmetrically for conventional and reversed depth.
Nearby shadows retain their original filtering and strength. The map size,
sun direction, bias, texel snapping and shadow refresh policy are preserved.
The shared sun setup applies this to every course and both look modes.

Validation:

- 36 existing checks covering shadow snapping, cached terrain shadows and
  camera frame order pass; the production build passes.
- `tools/check-shadow-boundary.mjs` captures an unchanged camera with the
  corrected transition, the original hard boundary, and shadows disabled.
  It checks that a real shadow map rendered, that distant shadow pixels
  soften, and that nearby shadows remain visible. It also repeats the
  comparison after panning the camera and from a low course overview.
- At the Veckefjärden tee in the WebGPU comparison, all 3,576 measured shadow
  pixels retained their original appearance. The elevated views softened
  thousands of boundary pixels while retaining shadows nearer the target.
- Browser checks pass without errors for Veckefjärden in evening light on
  WebGPU (reversed depth) and WebGL2 (conventional depth), and for Ängsö in
  daylight on WebGPU. Results are saved in `output/shadow-boundary-webgpu`,
  `output/shadow-boundary-webgl` and `output/shadow-boundary-angso`.

Run with a development server or `BANVY_BASE_URL` pointing at a production
preview (PowerShell):

```powershell
$env:BANVY_GPU='1'
node tools/check-shadow-boundary.mjs output/shadow-boundary veckefjarden webgpu
node tools/check-shadow-boundary.mjs output/shadow-boundary-webgl veckefjarden webgl2
node tools/check-shadow-boundary.mjs output/shadow-boundary-day angso webgpu noon
```

The output includes screenshots and `audit.json` with the camera poses,
shadow transforms, rendering backend, pixel comparisons and browser errors.
`V3D.setShadowBoundaryFade(false)` restores the old boundary for comparison;
pass `true` to restore the fix. This only changes a uniform, so the comparison
uses the same compiled materials, shadow map and terrain.
