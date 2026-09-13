import { Fn, PCFShadowFilter, float, length, min, mix, smoothstep, uniform } from 'three/tsl';

/**
 * A directional shadow map covers a finite, camera-following box. Three
 * returns fully lit outside it; without a transition, forest shadows end
 * along a moving rectangle. Fade within the map, including its depth ends
 * (visible on hills with a low sun), before the renderer clips the sample.
 * A circular footprint avoids retaining the box's corners in the fade.
 * PCF, bias, texel snapping and the cached shadow pass remain unchanged.
 */
export function createSunShadowFilter() {
  const enabled = uniform(1);
  const filterNode = Fn(({ depthTexture, shadowCoord: coord, shadow, depthLayer }) => {
    const radius = length(coord.xy.sub(0.5)).mul(2);
    const sideCoverage = float(1).sub(smoothstep(0.6, 0.96, radius));
    // Symmetric in depth: works with both conventional and reversed depth.
    const endCoverage = smoothstep(0.015, 0.16, min(coord.z, float(1).sub(coord.z)));
    const coverage = mix(float(1), sideCoverage.mul(endCoverage), enabled);
    return mix(float(1), PCFShadowFilter({ depthTexture, shadowCoord: coord, shadow, depthLayer }), coverage);
  });
  return Object.freeze({ filterNode, enabled });
}
