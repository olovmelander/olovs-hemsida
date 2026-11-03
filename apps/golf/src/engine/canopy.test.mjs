/* The painted canopy (after serenity-blocks' Odyssey crowns): three tones cut by
   band edges that ride the sun, a mesh reckons its bands per vertex, and
   ?canopy=0 builds the crowns exactly as before. */
import { describe, expect, it } from 'vitest';
import { Texture } from 'three/webgpu';
import { float, uniform, vec3 } from 'three/tsl';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';
import { CANOPY, canopyBandShift, canopyBandShiftFor, makeGhibliFoliageMaterial, setFoliageLighting } from './ghibli-foliage-material.mjs';

const crown = canopy => makeGhibliFoliageMaterial({ key: 'bjork', map: new Texture(), sunDirection: uniform(vec3(0, 0.3, 1)),
  tint: vec3(1), seed: float(0.4), autumn: float(0), canopy });

describe('the painted canopy', () => {
  it('rides the sun: a high sun moves the edges up, a low one down, half of Odyssey\'s ride', () => {
    expect(canopyBandShiftFor([0, 1, 0])).toBeGreaterThan(0);
    expect(canopyBandShiftFor([1, 0.1, 0])).toBeLessThan(0);
    const odyssey = (0.6 + CANOPY.wrap) / (1 + CANOPY.wrap) - CANOPY.topWrap;
    expect(canopyBandShiftFor([0.8, 0.6, 0])).toBeCloseTo(odyssey * CANOPY.sunRide, 6);
    /* the edges stay inside the wrap's range at every light */
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      setFoliageLighting(paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]));
      expect(Math.abs(canopyBandShift.value), name).toBeLessThan(0.2);
      expect(CANOPY.bands[0] + canopyBandShift.value, name).toBeGreaterThan(0);
      expect(CANOPY.bands[3] + canopyBandShift.value, name).toBeLessThan(1);
    }
  });
  it('keeps its tones ordered: shade below the mid tone below the lit tone', () => {
    const [a, b, c, d] = CANOPY.bands;
    expect(a).toBeLessThan(b); expect(b).toBeLessThanOrEqual(c); expect(c).toBeLessThan(d);
    expect(CANOPY.mid).toBeGreaterThan(0.5); expect(CANOPY.mid).toBeLessThan(1);
  });
  it('builds a different colour graph only when asked, so ?canopy=0 is the before', () => {
    const before = crown(false), after = crown(true), again = crown(false);
    expect(after.colorNode).not.toBe(before.colorNode);
    expect(before.colorNode.constructor).toBe(again.colorNode.constructor);
    expect(after.vertexColors).toBe(true);
    expect(after.alphaTestNode).toBeTruthy();
  });
  it('is wired in main.js for the crowns and both impostor batches', async () => {
    const fs = await import('node:fs');
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const CANOPY_ON = new URLSearchParams\(location\.search\)\.get\('canopy'\) !== '0'/);
    expect(main.match(/canopy: CANOPY_ON/g)?.length).toBe(3);
  });
});

describe('the canopy\'s bands per pixel', () => {
  it('reckons the bands per pixel by default, per vertex only for ?canopybands=vertex', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('./ghibli-foliage-material.mjs', import.meta.url), 'utf8');
    expect(src).toContain('perVertex:canopy&&!noisePerPixel&&bandsPerVertex');
    expect(src).toMatch(/bandsPerVertex=false\}\)\{/);
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("bandsPerVertex: new URLSearchParams(location.search).get('canopybands') === 'vertex'");
  });
  it('draws no air motes unless asked (?airmotes=1)', async () => {
    const fs = await import('node:fs');
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toContain("const AIR_MOTES_ON = new URLSearchParams(location.search).get('airmotes') === '1';");
  });
});
