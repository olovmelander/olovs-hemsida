import * as THREE from 'three/webgpu';
import { mix, normalize, positionLocal, pow, saturate, smoothstep, uniform } from 'three/tsl';

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
  // Authored sky/ground palettes keep twilight reflection fill independent of
  // direct sunlight. Older callers without one retain the derived palette.
  if (preset.environment) return Object.fromEntries(Object.entries(preset.environment).map(([key, hex]) => [key, new THREE.Color(hex)]));
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
  const env = new THREE.Scene();
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  const geometry = new THREE.SphereGeometry(100, 24, 16);
  const paletteNodes = Object.fromEntries(Object.keys(BASE).map(key => [key, uniform(new THREE.Color())]));
  const up = normalize(positionLocal).y;
  material.colorNode = mix(paletteNodes.ground,
    mix(paletteNodes.horizon, paletteNodes.zenith, pow(saturate(up), 0.5)),
    smoothstep(-0.1, 0.05, up));
  env.add(new THREE.Mesh(geometry, material));
  return {
    bake(palette, renderTarget = null) {
      generator ??= new THREE.PMREMGenerator(renderer);
      for (const key of Object.keys(BASE)) paletteNodes[key].value.copy(palette[key]);
      // Same sphere, gradient, 256px faces and filtering; only uniforms change.
      // With a reusable target, r187 renders the new PMREM into that cube.
      return generator.fromScene(env, 0.04, 0.1, 100, { renderTarget });
    },
    dispose() {
      generator?.dispose();
      generator = null;
      geometry.dispose();
      material.dispose();
      env.clear();
    },
  };
}

/** Keep the displayed texture identity stable for the lifetime of the scene.
 * Replacing scene.environment in r185 invalidates every scene shader. A stable
 * PMREM node with changing texture values also leaves cached plain-material
 * bindings stale. So every preset after the first is baked into the displayed
 * map itself: the same texture object and GPU resource, with unchanged
 * formats, sampling and no additional scene render pass.
 *
 * r187 made PMREMs mip-mapped cube render targets (#34585). The earlier
 * staging map plus copyTextureToTexture no longer works there: WebGPU's default
 * copy is one face of one mip, and the WebGL2 copy binds the cube as a 2D
 * texture, so five faces and every rough mip kept the previous preset's sky.
 * Baking in place needs no copy on either backend. The bake renders the small
 * gradient scene, which never samples scene.environment, into the generator's
 * own source cube first; a bake that throws (an uninitialised backend, say)
 * throws before it writes the displayed map, which stays as it was.
 *
 * Only the current preset is cached. Returning to another preset rebakes the
 * small environment, but does not rebuild scene shaders or allocate GPU maps.
 * One displayed map is owned.
 */
export function createLightingEnvironment(renderer, scene, {
  enabled = true,
  baker = createEnvironmentBaker(renderer),
  onBake,
} = {}) {
  let current = null, currentKey = null, presetName = null;
  let disposed = false, bakes = 0, allocations = 0;
  return {
    setPreset(name, preset) {
      if (disposed) throw new Error('The lighting environment has been disposed.');
      const key = enabled ? name : 'baseline';
      if (key !== currentKey) {
        const started = performance.now();
        const target = baker.bake(deriveEnvironmentPalette(preset, enabled), current);
        bakes++;
        if (target !== current) {
          // Only the first bake allocates; a baker that ignores the reusable
          // map still never leaves the scene sampling a released texture.
          allocations++;
          const previous = current;
          current = target;
          if (previous) {
            if (scene.environment === previous.texture) scene.environment = current.texture;
            previous.dispose();
          }
        }
        currentKey = key;
        onBake?.({ preset: key, started, ms: performance.now() - started });
      }
      scene.environment = current.texture;
      scene.environmentIntensity = enabled ? (preset.environmentIntensity ?? LIGHTING_ENVIRONMENT_INTENSITY) : LIGHTING_ENVIRONMENT_INTENSITY;
      presetName = name;
      return current.texture;
    },
    snapshot() {
      return { enabled, preset: presetName, cachedPresets: currentKey === null ? [] : [currentKey],
        bakes, allocations, disposed };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (current && scene.environment === current.texture) scene.environment = null;
      current?.dispose();
      current = null; currentKey = null;
      baker.dispose();
    },
  };
}
