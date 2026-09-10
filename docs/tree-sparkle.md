# Bright flashes through trees — September 9, 2026

Camera movement toward the evening sun reproduced a small bright orb that
appeared and disappeared through gaps in the foliage. The source was the
sky's very bright solar disc; bloom spread the exposed samples into a halo.
No ambient particle system was found in either checkout.

The shared renderer now disables `SkyMesh.showSunDisc` on WebGPU and removes
the narrow solar-disc term from the WebGL sky. Atmospheric scattering, the
broad WebGL aureole, clouds, directional lighting, shadows, bloom, and tree
LOD retain their existing behavior. The sharp visible sun disc is intentionally
absent. This addresses the reproduced sky glare; it does not establish that
every possible moving edge or water highlight has the same source.

## Reproduction and isolation

Veckefjärden, hole 5, evening, high quality, with ordinary live shader time.
The camera faces the sun from near the tee, with twenty lateral offsets:

```js
const x = -287.8 + (step - 9.5) * 0.45;
const z = 139.4;
const h = V3D.terrainH(-287.8, z) + 1.7;
V3D.setView(x, h, z, x - 560, h + 180, z + 710);
```

In the 960 × 540 canvas, the foliage region x=200..699, y=180..389 contained
0–92 bright pixels per frame with the solar disc present (`min(R,G,B)>235`).
Disabling only the solar disc produced **zero in all twenty frames**.
Disabling water retained the flashes (up to 90 bright pixels). Live wind and
camera breathing mean separate sequences are not pixel-identical.

See the [before image](graphics/tree-sparkle-2026-09-09/before.png),
[disc-disabled image](graphics/tree-sparkle-2026-09-09/disc-disabled.png), and
[ablation measurements](graphics/tree-sparkle-2026-09-09/ablation.json).

## Checkouts and validation

Port 5173 serves `olovs-hemsida`; port 5174 serves the separate
`olovs-hemsida-tortuna` worktree. The latter lacked the prior
[distant-tree color fix](tree-distant-color.md), including the corrected alpha
compositing and reduced evening fog. That established correction was also
applied there without merging unrelated course changes. Its previous dense
fog hid the solar disc in the initial reproduction attempts.

The solar-disc change was applied to both checkouts. Both production builds
passed. The Tortuna checkout's tree-impostor, tree-flight, tree-fade, and
tree-bounds suites passed (32 tests).

Fresh page-load rendering checks are recorded in
[the browser report](graphics/tree-sparkle-2026-09-09/verified.json).
Veckefjärden passed the same twenty-camera sequence on WebGPU at both ports
and on WebGL2 at port 5173: zero bright/yellow pixels in the tested region,
zero LOD switches, and no page errors. The WebGPU device reported NVIDIA
Ampere. Puttom WebGPU initialization also reported the disc disabled and no
page errors. Its first screenshot still included the fading loading cover,
so that check establishes initialization only, not final visual acceptance.

Final saved-code images:
[WebGPU](graphics/tree-sparkle-2026-09-09/verified-webgpu.png),
[WebGL2](graphics/tree-sparkle-2026-09-09/verified-webgl2.png).
