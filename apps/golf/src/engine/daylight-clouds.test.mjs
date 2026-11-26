import { describe, expect, it } from 'vitest';
import { Texture } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { createDaylightClouds } from './daylight-clouds.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';

function inputs(root) {
  const found = new Set();
  function visit(node) {
    if (found.has(node)) return;
    found.add(node);
    for (const child of node.getChildren()) visit(child);
  }
  visit(root);
  return [...found];
}

describe('photographic cloud lighting', () => {
  it('uses the same map, sun and coverage for the sky, water and environment', () => {
    const map = new Texture();
    const clouds = createDaylightClouds(map, null);
    const colour = vec3(.1, .2, .4), ray = vec3(.5, .7, .5);
    const sky = inputs(clouds.colour(colour, ray, true));
    const reflection = inputs(clouds.colour(colour, ray));
    for (const graph of [sky, reflection]) {
      expect(new Set(graph.filter(n => n.isTextureNode).map(n => n.value))).toEqual(new Set([map]));
    }
    const values = sky.filter(n => n.isUniformNode && !n.isTextureNode);
    expect(values.every(n => reflection.includes(n))).toBe(true);
    clouds.setPreset(ATMOSPHERE_PRESETS.summer);
    const numbers = values.filter(n => typeof n.value === 'number');
    expect(numbers.map(n => n.value)).toEqual([0, 0]);
    clouds.setPreset(ATMOSPHERE_PRESETS.storm);
    expect(numbers.every(n => n.value > .8 && n.value <= 1)).toBe(true);
    clouds.setPreset(ATMOSPHERE_PRESETS.bluehour);
    const skySun = values.find(n => n.value?.isVector3).value;
    expect(skySun.length()).toBeCloseTo(1);
    expect(skySun.y).toBeLessThan(0);
    expect(values.filter(n => n.value?.isColor && n.value.getHex() === 0)).toHaveLength(2);
  });
});
