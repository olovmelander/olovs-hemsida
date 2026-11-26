import * as THREE from 'three/webgpu';
import { color, mix, pow, smoothstep, uniform } from 'three/tsl';
import { deriveEnvironmentPalette } from './lighting-environment.mjs';

/* The water has an analytic reflection instead of sampling the PMREM texture.
   Use the environment's same linear palette, updated only on preset changes.
   This replaces two per-fragment colour blends and their sun-height ramp with
   two shared RGB uniforms; the existing reflection angle and exponent remain. */
export function createWaterReflectionLighting({ enabled = false, cloudDome = null } = {}) {
  const horizon = uniform(new THREE.Color());
  const zenith = uniform(new THREE.Color());
  const groundFill = uniform(new THREE.Color()), direct = uniform(new THREE.Color());
  return {
    setPreset(preset) {
      // Linear irradiance of the active hemisphere and directional light.
      // Lambertian bank reflectance divides incident irradiance by pi once.
      groundFill.value.setHex(preset.hemiS).multiplyScalar((preset.hemiI ?? 1) * (preset.paintedFill ?? 1) / Math.PI);
      direct.value.setHex(preset.sun).multiplyScalar((preset.int ?? 1) / Math.PI);
      if (!enabled) return;
      const palette = deriveEnvironmentPalette(preset);
      horizon.value.copy(palette.horizon);
      zenith.value.copy(palette.zenith);
    },
    bankRadiance(albedo, facing, sunlight) {
      return albedo.mul(groundFill.add(direct.mul(facing).mul(sunlight)));
    },
    reflectedSkyColour(up, sunUp, reflectedRay) {
      if (enabled) {
        const clear = mix(horizon, zenith, pow(up, 0.45));
        return cloudDome && reflectedRay ? cloudDome.colour(clear, reflectedRay) : clear;
      }
      // Preserve the established shader exactly when the preview is disabled.
      return mix(mix(color(0xd9c6ad), color(0xcfe0e6), smoothstep(0.10, 0.52, sunUp)),
        mix(color(0x21538f), color(0x3479b4), sunUp), pow(up, 0.45));
    },
  };
}
