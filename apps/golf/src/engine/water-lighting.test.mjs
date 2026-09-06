import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { float } from 'three/tsl';
import { createWaterReflectionLighting } from './water-lighting.mjs';
import { deriveEnvironmentPalette } from './lighting-environment.mjs';

const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const PRESETS = Function(`return (${main.match(/const PRESETS = (\{[\s\S]*?\n\});/)[1]});`)();
function nodes(root) {
  const found = new Set();
  const visit = node => {
    if (!node || found.has(node)) return;
    found.add(node);
    for (const child of node.getChildren()) visit(child);
  };
  visit(root);
  return [...found];
}

describe('analytic water reflection lighting', () => {
  it('updates the existing colour uniforms to the environment palette in linear space', () => {
    const lighting = createWaterReflectionLighting({ enabled: true });
    const graph = lighting.reflectedSkyColour(float(0.4), float(0.3));
    const colours = nodes(graph).filter(node => node.isUniformNode && node.value?.isColor);
    expect(colours).toHaveLength(2);
    const values = colours.map(node => node.value);
    for (const preset of Object.values(PRESETS)) {
      lighting.setPreset(preset);
      const palette = deriveEnvironmentPalette(preset);
      expect(colours.map(node => node.value.toArray())).toEqual([
        palette.horizon.toArray(), palette.zenith.toArray(),
      ]);
      expect(colours.map(node => node.value)).toEqual(values);
      colours.forEach((node, index) => expect(node.value).toBe(values[index]));
    }
  });

  it('removes colour-ramp work without adding texture samples or reflection powers', () => {
    const graph = enabled => nodes(createWaterReflectionLighting({ enabled })
      .reflectedSkyColour(float(0.4), float(0.3)));
    const before = graph(false), after = graph(true);
    const count = (list, method) => list.filter(node => node.isMathNode && node.method === method).length;
    expect(count(before, 'mix')).toBe(3);
    expect(count(after, 'mix')).toBe(1);
    expect(count(before, 'smoothstep')).toBe(1);
    expect(count(after, 'smoothstep')).toBe(0);
    expect(count(before, 'pow')).toBe(1);
    expect(count(after, 'pow')).toBe(1);
    expect(before.some(node => node.isTextureNode)).toBe(false);
    expect(after.some(node => node.isTextureNode)).toBe(false);
    expect(before.some(node => node.isUniformNode)).toBe(false);
  });
});
