/* GOD RAYS THROUGH THE TREES (the forest-family lens of serenity-blocks,
   src/themes/golden-forest/golden-forest-post.js, on three's GodraysNode).

   A low sun behind a wood throws shafts of lit air between the trunks and
   across the fairway. The scene pass's depth gives each pixel's ray; three's
   GodraysNode marches it through the sun's own shadow map at half
   resolution and returns how much lit air it crossed (1 - exp(-integral),
   under a ceiling), so where the crowns shadow part of the way the shaft
   breaks: beams and gaps. A bilateral blur takes the march's noise out
   without bleeding across silhouettes.

   What the eye sees of lit air is forward scatter: it glows toward the sun
   and hardly at all with the sun behind. So the shafts are weighted by a lobe
   round the sun, from each pixel's own view ray (it works with the sun off
   the screen), in the sun's colour at each light's own strength
   (GOD_RAYS.presets): none in the storm, the mist or the blue hour, whose
   suns are hidden or down.

   The shadow map covers a box that follows the eye (main.js, shadow-fit.mjs).
   Serenity found the march lays a veil of lit air over the far ridges and the
   sky where the box runs out, so past most of the box's half-width the
   shafts keep only the glow round the sun; the haze and the sky carry the
   distance there.

   Off on low quality (no post pipeline) and with the runtime drop (main.js
   draws straight to the canvas then). With a light's strength at 0 the march
   and the blur are not run at all (the gated nodes below), so the storm pays
   nothing. GodraysNode reads the shadow map while its graph is built, so
   main.js attaches the shafts once the map exists. */
import { Color, Vector3 } from 'three/webgpu';
import { float, getViewPosition, mix, normalize, pow, saturate, screenUV, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import GodraysNode from 'three/addons/tsl/display/GodraysNode.js';
import BilateralBlurNode from 'three/addons/tsl/display/BilateralBlurNode.js';

export const GOD_RAYS = Object.freeze({
  /* raymarch steps per pixel (three jitters a few more in by noise) and the march's resolution */
  steps: 24, resolutionScale: 0.5,
  /* the march's density per hundred metres of lit air, and its ceiling: serenity's forest order
     of magnitude, so the 30-100 m of air in front of a wood's edge shows its beams. A longer lit
     path reaches the ceiling, and past most of the box only the glow round the sun is kept */
  density: 0.3, maxDensity: 0.5,
  /* the blur: spatial sigma in texels of the half-resolution march, and how much of a step in
     the march's value it smooths across */
  blur: Object.freeze({ sigma: 3, sigmaColor: 0.12 }),
  /* the forward-scatter lobe toward the sun, and the faint share seen at any angle */
  lobe: Object.freeze({ power: 6, floor: 0.08 }),
  /* past this share of the shadow box's half-width the shafts give way to the glow round the sun */
  fade: Object.freeze([0.45, 0.85]), glowKeep: Object.freeze({ power: 2, gain: 0.6, floor: 0.08 }),
  /* each light's shafts, 0 to 1 */
  presets: Object.freeze({
    golden: 0.5, dawn: 0.45, midnight: 0.45, host: 0.35, summer: 0.25, noon: 0.2,
    bluehour: 0, storm: 0, mist: 0,
  }),
});

/** A light's shafts: 0 to 1, none for a light not in the table. */
export const godRaysFor = presetName => GOD_RAYS.presets[presetName] ?? 0;

/** The lobe toward the sun for a view ray `cosine` from it (the shader's formula, for the tests). */
export function godRayLobe(cosine) {
  const { power, floor } = GOD_RAYS.lobe;
  const c = Math.min(1, Math.max(0, cosine * 0.5 + 0.5));
  return floor + (1 - floor) * c ** power;
}

/* Three's nodes render once a frame whatever their output is multiplied by. A light without
   shafts sets `active` false and they render nothing; their last picture is multiplied by 0. */
class GatedGodrays extends GodraysNode {
  constructor(...args) { super(...args); this.active = true; }
  updateBefore(frame) { if (this.active) super.updateBefore(frame); }
}
class GatedBlur extends BilateralBlurNode {
  constructor(...args) { super(...args); this.active = true; }
  updateBefore(frame) { if (this.active) super.updateBefore(frame); }
}

/**
 * The shafts for a scene pass: `node` is the light to add to the scene's colour (vec3).
 * @param {object} options
 * @param {Node} options.depthNode the scene pass's depth (pass.getTextureNode('depth'))
 * @param {Camera} options.camera the scene camera
 * @param {DirectionalLight} options.light the sun; its shadow map must exist
 */
export function createGodRays({ depthNode, camera, light }) {
  if (!light?.shadow?.map) throw new Error('God rays need the sun\'s shadow map: attach them after the first shadow render.');
  const march = new GatedGodrays(depthNode, camera, light);
  march.raymarchSteps.value = GOD_RAYS.steps;
  march.density.value = GOD_RAYS.density;
  march.maxDensity.value = GOD_RAYS.maxDensity;
  march.distanceAttenuation.value = 0;
  march.resolutionScale = GOD_RAYS.resolutionScale;
  const blur = new GatedBlur(march.getTextureNode(), null, GOD_RAYS.blur.sigma, GOD_RAYS.blur.sigmaColor);

  const strength = uniform(0);
  const colour = uniform(new Vector3(1, 0.92, 0.78));
  const sun = uniform(new Vector3(0, 1, 0));
  const boxRadius = uniform(600);
  const cameraWorld = uniform(camera.matrixWorld);
  const projectionInverse = uniform(camera.projectionMatrixInverse);

  /* each pixel's view ray, from the depth the march read, for the lobe and the distance */
  const viewPosition = getViewPosition(screenUV, depthNode.sample(screenUV).r, projectionInverse);
  const distance = viewPosition.length();
  const direction = normalize(cameraWorld.mul(vec4(viewPosition, 0)).xyz);
  const toward = saturate(direction.dot(sun).mul(0.5).add(0.5));
  const lobe = mix(float(GOD_RAYS.lobe.floor), float(1), pow(toward, GOD_RAYS.lobe.power));
  const { power, gain, floor } = GOD_RAYS.glowKeep;
  const beyond = smoothstep(boxRadius.mul(GOD_RAYS.fade[0]), boxRadius.mul(GOD_RAYS.fade[1]), distance);
  const keep = mix(float(1), pow(toward, power).mul(gain).add(floor), beyond);
  const node = vec3(colour).mul(blur.r).mul(lobe).mul(keep).mul(strength);

  let presetStrength = 0;
  const api = {
    node, march, blur,
    uniforms: { strength, colour, sun, boxRadius },
    /** A light's shafts: its strength, its sun's direction (toward the sun) and colour. */
    setPreset(presetName, { sunDirection, sunColour } = {}) {
      presetStrength = godRaysFor(presetName);
      strength.value = presetStrength;
      march.active = blur.active = presetStrength > 0;
      if (sunDirection) sun.value.set(...sunDirection).normalize();
      if (sunColour !== undefined) {
        /* the preset's sRGB hex, in the working (linear) space, at its peak channel */
        const c = new Color(sunColour), peak = Math.max(c.r, c.g, c.b, 1e-3);
        colour.value.set(c.r / peak, c.g / peak, c.b / peak);
      }
    },
    /** Once a frame: the shadow box's half-width, metres. */
    setShadowRadius(radius) { if (Number.isFinite(radius) && radius > 0) boxRadius.value = radius; },
    snapshot: () => ({ strength: presetStrength, active: march.active, steps: GOD_RAYS.steps,
      resolutionScale: GOD_RAYS.resolutionScale, boxRadius: boxRadius.value }),
    dispose() { march.dispose(); blur.dispose(); },
  };
  return api;
}
