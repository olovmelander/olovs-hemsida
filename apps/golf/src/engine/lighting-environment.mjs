import * as THREE from 'three/webgpu';
import { color, mix, normalize, positionLocal, pow, saturate, smoothstep } from 'three/tsl';

export const LIGHTING_ENVIRONMENT_INTENSITY = 0.58;

/* These are the original environment's sRGB-authored colours. Color(hex) already
   converts them to the renderer's linear working space; do not convert twice. */
const BASE = { ground: 0x8fa88f, horizon: 0xcfe2e8, zenith: 0x3d7fb8 };
const clamp01 = value => Math.max(0, Math.min(1, value));

/** A restrained reflection palette from the same data that lights the sky.
 * Keep the overhead sky blue at low sun; most warmth belongs near the horizon.
 * Only colour changes: the PMREM geometry, gradient and sample budget stay fixed.
 */
export function deriveEnvironmentPalette(preset, enabled = true) {
  const palette = Object.fromEntries(Object.entries(BASE).map(([key, hex]) => [key, new THREE.Color(hex)]));
  if (!enabled) return palette;
  const sun = new THREE.Color(preset.sun);
  const sky = new THREE.Color(preset.hemiS);
  const fog = new THREE.Color(preset.fog);
  const sunHeight = preset.dir[1] / Math.hypot(...preset.dir);
  const t = clamp01((sunHeight - 0.10) / (0.52 - 0.10));
  const warmth = 1 - t * t * (3 - 2 * t);
  const cloud = clamp01(preset.cloud);
  palette.ground.lerp(new THREE.Color(preset.hemiG), 0.20).lerp(sun, warmth * 0.04);
  palette.horizon.lerp(fog, 0.60).lerp(sun, warmth * 0.15);
  palette.zenith.lerp(new THREE.Color(0x314f78), warmth * 0.40)
    .lerp(sky, 0.10).lerp(fog, cloud * 0.12);
  return palette;
}

function createEnvironmentBaker(renderer) {
  let generator = null;
  return {
    bake(palette) {
      generator ??= new THREE.PMREMGenerator(renderer);
      const env = new THREE.Scene();
      const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
      const geometry = new THREE.SphereGeometry(100, 24, 16);
      const up = normalize(positionLocal).y;
      material.colorNode = mix(color(palette.ground),
        mix(color(palette.horizon), color(palette.zenith), pow(saturate(up), 0.5)),
        smoothstep(-0.1, 0.05, up));
      env.add(new THREE.Mesh(geometry, material));
      try {
        return generator.fromScene(env, 0.04);
      } finally {
        geometry.dispose();
        material.dispose();
        env.clear();
      }
    },
    dispose() {
      generator?.dispose();
      generator = null;
    },
  };
}

/** Own the current reflection texture and at most one previous preset.
 * Call setPreset only from the preset handler; there is no animation-frame work.
 * The optional baker boundary lets lifecycle tests track real resource ownership
 * without requiring a GPU. A baker returns { texture, dispose() } per bake.
 */
export function createLightingEnvironment(renderer, scene, {
  enabled = true,
  maxEntries = 2,
  baker = createEnvironmentBaker(renderer),
  onBake,
} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 2) {
    throw new RangeError('The environment cache must hold one or two maps.');
  }
  const cache = new Map();
  let current = null;
  let presetName = null;
  let disposed = false;
  let bakes = 0;
  return {
    setPreset(name, preset) {
      if (disposed) throw new Error('The lighting environment has been disposed.');
      const key = enabled ? name : 'baseline';
      let target = cache.get(key);
      if (!target) {
        const started = performance.now();
        target = baker.bake(deriveEnvironmentPalette(preset, enabled));
        bakes++;
        cache.set(key, target);
        onBake?.({ preset: key, started, ms: performance.now() - started });
      } else {
        cache.delete(key);
        cache.set(key, target);
      }
      // Publish the replacement before releasing a target the scene was using.
      scene.environment = target.texture;
      scene.environmentIntensity = LIGHTING_ENVIRONMENT_INTENSITY;
      current = target;
      presetName = name;
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value;
        const evicted = cache.get(oldest);
        cache.delete(oldest);
        evicted.dispose();
      }
      return target.texture;
    },
    snapshot() {
      return { enabled, preset: presetName, cachedPresets: [...cache.keys()], bakes, disposed };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (current && scene.environment === current.texture) scene.environment = null;
      for (const target of cache.values()) target.dispose();
      cache.clear();
      current = null;
      baker.dispose();
    },
  };
}
