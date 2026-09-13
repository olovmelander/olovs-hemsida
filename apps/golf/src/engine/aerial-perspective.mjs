import { densityFogFactor, fog as applyFog, reference, renderGroup } from 'three/tsl';

/* Keep atmospheric perspective on the whole landscape, including tree tiers
 * and water. Fully opaque pale FogExp2 turned wooded ridges into white cutouts.
 * A preset's transmittance floor retains some surface shading at long range.
 * Use Three's depth accessor so thick lines and instanced materials keep their
 * own view-depth calculation instead of fogging their template geometry.
 */
export function createAerialPerspective(fog) {
  const settings = { maximum: 0.85 };
  // Match native fog's render-group references: the current scene's haze must
  // reach every material, including programs shared with the reflection bake.
  const colour = reference('color', 'color', fog).setGroup(renderGroup);
  const density = reference('density', 'float', fog).setGroup(renderGroup);
  const maximum = reference('maximum', 'float', settings).setGroup(renderGroup);
  const amount = densityFogFactor(density).mul(maximum);
  const node = applyFog(colour, amount);
  return {
    node,
    setPreset(preset) {
      // The same colour instance carries the style's restrained fog tint.
      settings.maximum = preset.hazeMax ?? 0.85;
    },
    snapshot: () => ({ density: fog.density, maximum: settings.maximum, colour: fog.color.getHex() }),
  };
}
