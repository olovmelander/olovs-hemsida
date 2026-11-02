import { Fn, PCFShadowFilter, float, length, min, mix, reference, renderGroup, smoothstep, texture, uniform, vec2 } from 'three/tsl';

/* A SOFT SHADOW WITH NO GRAIN (ported from serenity-blocks'
   src/themes/shared/grid-shadow-filter.js, where the forest themes use it).

   three's PCF filter takes five depth compares on a Vogel disc and turns the
   disc from pixel to pixel by interleaved gradient noise, which a temporal
   filter (TAA) is meant to average away. This app has none, so the noise
   stays: under a low sun nearly every surface sits at the edge of its own
   shadow (terrain, trunks, roofs), and the penumbra shows as a fine diagonal
   crosshatch that MSAA cannot help, shading being per pixel. A fixed grid of
   compares, each already a smooth 2 x 2 PCF because a PCF shadow map samples
   with LinearFilter, gives the same blur with no grain.

   The grid's spacing matches the disc's blur, not just its edge: the Vogel
   disc puts sample i at radius sqrt((i + 0.5) / 5), a mean squared radius of
   0.5 (in units of shadow.radius texels), so a 3 x 3 grid at +-sqrt(3/8)
   and a 2 x 2 at +-0.5 have the same second moment, and so the same
   penumbra width. Nine taps at high quality; four (one fewer than three's
   five) at low, where phones draw. */
export const GRID_SHADOW_TAPS = Object.freeze({ high: 9, low: 4 });

/** The grid's sample offsets in units of shadow.radius texels. */
export function gridShadowOffsets(taps = GRID_SHADOW_TAPS.high) {
  if (taps >= 9) {
    const s = Math.sqrt(3 / 8);
    return [-s, 0, s].flatMap(y => [-s, 0, s].map(x => [x, y]));
  }
  return [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]];
}

/* The mean squared radius of three's five-sample Vogel disc, for the tests. */
export const VOGEL_MEAN_SQUARED_RADIUS = [0, 1, 2, 3, 4].reduce((sum, i) => sum + (i + 0.5) / 5, 0) / 5;

/* one pair of uniforms per shadow, shared by every material, as three's own filters do */
const shadowUniforms = new WeakMap();
function uniformsOf(shadow) {
  let u = shadowUniforms.get(shadow);
  if (!u) {
    u = { mapSize: reference('mapSize', 'vec2', shadow).setGroup(renderGroup),
      radius: reference('radius', 'float', shadow).setGroup(renderGroup) };
    shadowUniforms.set(shadow, u);
  }
  return u;
}

/** A shadow filter node: a fixed grid of hardware-filtered depth compares. */
export function gridShadowFilter(taps = GRID_SHADOW_TAPS.high) {
  const offsets = gridShadowOffsets(taps);
  return Fn(({ depthTexture, shadowCoord, shadow, depthLayer }) => {
    const { mapSize, radius } = uniformsOf(shadow);
    const step = vec2(radius, radius).div(mapSize);
    let sum = float(0);
    for (const [x, y] of offsets) {
      let depth = texture(depthTexture, shadowCoord.xy.add(step.mul(vec2(x, y))));
      if (depthTexture.isArrayTexture) depth = depth.depth(depthLayer);
      sum = sum.add(depth.compare(shadowCoord.z));
    }
    return sum.mul(1 / offsets.length);
  });
}

/**
 * A directional shadow map covers a finite, camera-following box. Three
 * returns fully lit outside it; without a transition, forest shadows end
 * along a moving rectangle. Fade within the map, including its depth ends
 * (visible on hills with a low sun), before the renderer clips the sample.
 * A circular footprint avoids retaining the box's corners in the fade.
 * Bias, texel snapping and the cached shadow pass remain unchanged.
 *
 * `grid: false` (?shadowgrid=0) keeps three's noise-rotated PCF: the before.
 */
export function createSunShadowFilter({ grid = true, taps = GRID_SHADOW_TAPS.high } = {}) {
  const enabled = uniform(1);
  const sample = grid ? gridShadowFilter(taps) : PCFShadowFilter;
  const filterNode = Fn(({ depthTexture, shadowCoord: coord, shadow, depthLayer }) => {
    const radius = length(coord.xy.sub(0.5)).mul(2);
    const sideCoverage = float(1).sub(smoothstep(0.6, 0.96, radius));
    // Symmetric in depth: works with both conventional and reversed depth.
    const endCoverage = smoothstep(0.015, 0.16, min(coord.z, float(1).sub(coord.z)));
    const coverage = mix(float(1), sideCoverage.mul(endCoverage), enabled);
    return mix(float(1), sample({ depthTexture, shadowCoord: coord, shadow, depthLayer }), coverage);
  });
  return Object.freeze({ filterNode, enabled, grid, taps: grid ? gridShadowOffsets(taps).length : 5 });
}
