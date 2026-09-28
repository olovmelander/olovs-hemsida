/* A CUTOUT CUT THROUGH THE SAMPLES (docs/tree-sparkle-2026-09-28.md). An
   alpha test keeps or drops a fragment whole, and MSAA smooths the edge of a
   triangle, never a cut inside one: so every edge and gap of a cutout -- a
   crown's leaf cards, an impostor's crown -- is all sky or all leaf in each
   pixel, and as the camera moves it flips, a crown's gaps twinkling against
   the sky. With alpha to coverage the cut chooses how many of a pixel's MSAA
   samples the fragment covers instead. Without MSAA (a single-sample target)
   three leaves the samples alone, and the fragment is drawn whole. */
import { CustomBlending, AddEquation, OneFactor, ZeroFactor, OneMinusSrcAlphaFactor } from 'three/webgpu';
import { float, fwidth } from 'three/tsl';

/** Cut `material` through the MSAA samples, over an opaque backdrop. Alpha
    selects the samples; RGB replaces each covered sample. Preserve an opaque
    backdrop's alpha too: overwriting it with coverage makes the resolved frame
    translucent, and the output colour transform then unpremultiplies that
    already-composited RGB, leaving dark hollow outlines without bloom. */
export function coverOpaqueBackdrop(material) {
  material.alphaToCoverage = true;
  material.blending = CustomBlending;
  material.blendEquation = material.blendEquationAlpha = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = ZeroFactor;
  material.blendSrcAlpha = OneFactor;
  material.blendDstAlpha = OneMinusSrcAlphaFactor;
  return material;
}

/** The alpha test for a hard cut at `cut`, taken through the samples. With
    alpha to coverage three turns a fragment's alpha into its coverage over one
    pixel's change of alpha ABOVE the material's test (NodeMaterial: smoothstep
    from the test to the test plus fwidth), which would draw the cutout half a
    pixel inside the hard cut: a crown thinner, and the thinner the farther,
    where its mip-filtered alpha changes fastest. Lowered by half that change,
    the ramp straddles the hard cut, so the cutout keeps the hard cut's area and
    only its edges and gaps are shared between samples. */
export function centredCoverageCut(alpha, cut = 0.5) {
  return float(cut).sub(fwidth(alpha).mul(0.5));
}

/** The share of a pixel's samples a fragment of `alpha` covers, as three turns
    alpha into coverage above the alpha `test` over the pixel's `change` of
    alpha (the tests' reading of NodeMaterial's ramp; nothing at or under the test). */
export function coveredShare(alpha, change, test) {
  if (!(alpha > test)) return 0;
  const t = Math.min(1, (alpha - test) / Math.max(change, 1e-9));
  return t * t * (3 - 2 * t);
}
