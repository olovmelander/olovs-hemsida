import * as THREE from 'three/webgpu';
import { color, mix, pow, smoothstep, uniform } from 'three/tsl';
import { deriveEnvironmentPalette } from './lighting-environment.mjs';

/* The water has an analytic reflection instead of sampling the PMREM texture.
   Use the environment's same linear palette, updated only on preset changes.
   This replaces two per-fragment colour blends and their sun-height ramp with
   two shared RGB uniforms; the existing reflection angle and exponent remain. */
export function createWaterReflectionLighting({ enabled = false } = {}) {
  const horizon = uniform(new THREE.Color());
  const zenith = uniform(new THREE.Color());
  return {
    setPreset(preset) {
      if (!enabled) return;
      const palette = deriveEnvironmentPalette(preset);
      horizon.value.copy(palette.horizon);
      zenith.value.copy(palette.zenith);
    },
    reflectedSkyColour(up, sunUp) {
      if (enabled) return mix(horizon, zenith, pow(up, 0.45));
      // Preserve the established shader exactly when the preview is disabled.
      return mix(mix(color(0xd9c6ad), color(0xcfe0e6), smoothstep(0.10, 0.52, sunUp)),
        mix(color(0x21538f), color(0x3479b4), sunUp), pow(up, 0.45));
    },
  };
}
