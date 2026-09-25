import { Color, Vector3 } from 'three/webgpu';
import { cameraPosition, densityFogFactor, dot, fog as applyFog, mix, normalize, positionWorld, pow, reference, renderGroup, saturate, uniform } from 'three/tsl';

/* Keep atmospheric perspective on the whole landscape, including tree tiers
 * and water. Fully opaque pale FogExp2 turned wooded ridges into white cutouts.
 * A preset's transmittance floor retains some surface shading at long range.
 * Use Three's depth accessor so thick lines and instanced materials keep their
 * own view-depth calculation instead of fogging their template geometry.
 */

/* HAZE WARMS TOWARD THE SUN. Air between a low sun and the eye scatters the
   sun's colour forward, so distant hills toward the sun dissolve into its glow
   while those behind the viewer keep the plain haze. The haze takes the sky's
   own sun glow -- its colour, its lobe around the sun (painted-sky.mjs) and a
   preset share of its strength -- so ground, water and the sky's band under the
   horizon agree in every direction. The lobe is reckoned per vertex and
   interpolated: tree crowns, most of the frame's cost, shade no more per pixel. */
export const sunwardLobe = (direction, sun) => pow(saturate(dot(direction, sun).mul(0.5).add(0.5)), 6);

export function createAerialPerspective(fog, { sunward = true } = {}) {
  const settings = { maximum: 0.85 };
  // Match native fog's render-group references: the current scene's haze must
  // reach every material, including programs shared with the reflection bake.
  const colour = reference('color', 'color', fog).setGroup(renderGroup);
  const density = reference('density', 'float', fog).setGroup(renderGroup);
  const maximum = reference('maximum', 'float', settings).setGroup(renderGroup);
  const glow = uniform(new Color(0, 0, 0)).setGroup(renderGroup);
  const glowStrength = uniform(0).setGroup(renderGroup);
  const sun = uniform(new Vector3(0, 1, 0)).setGroup(renderGroup);
  const amount = densityFogFactor(density).mul(maximum);
  /* ?hazewarm=0 is the before: one haze colour in every direction */
  const haze = sunward
    ? mix(colour, glow, sunwardLobe(normalize(positionWorld.sub(cameraPosition)), sun).mul(glowStrength)).toVertexStage()
    : colour;
  const node = applyFog(haze, amount);
  return {
    node,
    setPreset(preset) {
      // The same colour instance carries the style's restrained fog tint.
      settings.maximum = preset.hazeMax ?? 0.85;
      glow.value.setHex(preset.skySunGlow ?? 0);
      glowStrength.value = sunward ? hazeGlowStrength(preset) : 0;
      sun.value.set(...preset.dir).normalize();
    },
    snapshot: () => ({ density: fog.density, maximum: settings.maximum, colour: fog.color.getHex(),
      glow: glow.value.getHex(), glowStrength: glowStrength.value }),
  };
}

/** The share of the sky's sun glow the haze takes toward the sun. */
export const hazeGlowStrength = preset => (preset.skySunGlowStrength ?? 0) * (preset.hazeGlow ?? 0);
