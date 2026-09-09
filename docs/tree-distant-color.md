# Distant tree colour — September 9, 2026

Puttom's zoomed-out evening view exposed pale canopies with dark, hollow
outlines, especially after the runtime disabled post-processing. The fix keeps
the geographic detail tiers, projected atlas frames, filtered coverage and
complementary fade masks from the flight-stability work.

Three changes restore the colour:

- **Keep the composited frame opaque.** The billboard's alpha selects MSAA
  samples; writing that fractional alpha over an opaque background also made
  the resolved frame translucent. Three's final colour transform then
  unpremultiplied already-composited RGB, producing dark outlines. Custom
  blending replaces covered RGB samples while compositing alpha over the
  existing background. The material remains in the opaque render queue and
  writes depth. This also works when bloom is disabled.
- **Tint crown and trunk before combining them.** Atlas filtering mixes
  untinted crown RGB with already-coloured trunk RGB. Multiplying that mixture
  by a separately filtered crown mask created pale cross terms. The material
  now recovers the two contributions using the baked trunk colour and applies
  the seasonal leaf tint only to the crown. No extra texture reads are needed.
- **Reduce the evening haze.** Golden-hour fog density is 0.00020 instead of
  0.00040. This is an intentional visual adjustment affecting the whole evening
  scene, so the forest and its surroundings retain consistent contrast. Other
  lighting presets are unchanged.

## Evidence

The [before](graphics/tree-color-2026-09-09/puttom-before.png) and
[after](graphics/tree-color-2026-09-09/puttom-after.png) show the same Puttom
camera at 1600 × 730, high quality, WebGPU, evening, without post-processing.
The [ablation report](graphics/tree-color-2026-09-09/puttom-ablation.json)
records intermediate fog/post-processing combinations. Fresh application
loads passed with post-processing both enabled and disabled; a 12-placement
live flight recorded zero LOD switches and no rendering errors in the
[application report](graphics/tree-color-2026-09-09/puttom-after.json).

The real-shader fixture passes on software WebGL2 and hardware-requested
WebGPU on the Windows development machine. A separate adapter query returned
NVIDIA Ampere, non-fallback. These are correctness checks, not FPS evidence.

- Matching foreground/background colours produce **zero outline pixels** after
  the final ACES transform; the old WebGPU material produced 28 with errors up
  to 26/255. See the [old](graphics/tree-color-2026-09-09/aces-before.png) and
  [fixed](graphics/tree-color-2026-09-09/aces-after.png) display tests.
- Every lit, fogged and silhouette readback keeps alpha at 255 over the opaque
  background. Sample coverage and raw RGB remain identical across the alpha
  blending correction. Motion, thin-edge stability and fade checks pass.
- Mixed crown/trunk texels, including summer/autumn tint changes and pure
  endpoints, have maximum linear RGB error below 0.00194 against a 0.005 gate;
  the old mixed texels reached 0.14336.
- The 38 focused tree/crown tests and production build pass.

Reports: [WebGPU before](graphics/tree-color-2026-09-09/webgpu-before.json),
[WebGPU after](graphics/tree-color-2026-09-09/webgpu-after.json),
[WebGL2 before](graphics/tree-color-2026-09-09/webgl2-before.json),
[WebGL2 after](graphics/tree-color-2026-09-09/webgl2-after.json).

Run `tools/tree-flight-review.mjs --out DIR --chrome CHROME_PATH` for the
software fixture. On Windows, add `--backend webgpu --adapter hardware` for
the hardware request; `--ref 7aac4d4` selects the old material with the same
fixture. Historical runs report regressions without enforcing the new gates.
