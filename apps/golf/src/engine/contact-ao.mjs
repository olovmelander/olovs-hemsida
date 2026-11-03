/* CONTACT SHADOWS (3 November): three r187's GTAO on the scene pass's depth.
   Where a wall, a tee marker, a bush, a cart or a swan meets the ground, and in
   the folds between a crown's masses, less of the sky's light arrives; the
   sun's map is far too coarse to say so at a metre. GTAO reads it from the
   depth alone (normals rebuilt from depth, so the scene pass needs no second
   target; r187 reads the reversed depth buffer), at half resolution within a
   0.9 m world radius. Without temporal filtering its samples are grainy, so a
   3 x 3 box takes the grain out, and only real contact darkens the colour
   (`contact`): the slight occlusion every flat wall and lawn reads is cut away,
   which also keeps the painted planes clean. At most `strength` of the colour.
   High quality only, as the rest of the pipeline; the runtime drop draws
   without it. +0.1-0.5 ms at 1080p on the RTX 5080. ?ao=0 is the before. */
import { float, int, smoothstep, uniform, vec4 } from 'three/tsl';

export const CONTACT_AO = Object.freeze({
  /* GTAO's own terms: its world radius, metres, the samples, the thickness and its falloff */
  radius: 0.9, samples: 16, thickness: 1, distanceExponent: 1.4, distanceFallOff: 1, scale: 1,
  /* the AO's resolution against the scene's */
  resolutionScale: 0.5,
  /* only real contact darkens: the occlusion from `contact[0]` (none) to `contact[1]` (full), and the most it takes */
  contact: Object.freeze([0.12, 0.6]), strength: 0.55,
  /* each light's share */
  presets: Object.freeze({}),
});

export const contactAoFor = presetName => CONTACT_AO.presets[presetName] ?? 1;

/** `{ node, apply(colour), setPreset(name), dispose() }`: GTAO on `depthNode`, applied to a colour node. */
export async function createContactAO({ depthNode, camera }) {
  const A = CONTACT_AO;
  const { ao } = await import('three/addons/tsl/display/GTAONode.js');
  const node = ao(depthNode, null, camera);
  node.resolutionScale = A.resolutionScale;
  node.radius.value = A.radius;
  node.samples.value = A.samples;
  node.thickness.value = A.thickness;
  node.distanceExponent.value = A.distanceExponent;
  node.distanceFallOff.value = A.distanceFallOff;
  node.scale.value = A.scale;
  const uStrength = uniform(A.strength);
  const { boxBlur } = await import('three/addons/tsl/display/boxBlur.js');
  /* GTAO without temporal filtering is grainy: a 3 x 3 box takes the grain out */
  const occlusion = boxBlur(node.getTextureNode(), { size: int(1), separation: int(1) }).r;
  const factor = float(1).sub(smoothstep(A.contact[0], A.contact[1], float(1).sub(occlusion)).mul(uStrength));
  return {
    node, factor,
    apply: colour => vec4(colour.rgb.mul(factor), colour.a),
    setPreset(presetName) { uStrength.value = A.strength * contactAoFor(presetName); },
    dispose() { node.dispose(); },
  };
}
