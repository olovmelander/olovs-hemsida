/* The output's dither (engine/output-dither.mjs): half an 8-bit step at every
   brightness, never a whole one, installed as the renderer's tone mapping. */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { DITHER_STEP, ditheredAcesToneMapping, installOutputDither } from './output-dither.mjs';

/* the shader's arithmetic on a tone-mapped value t, and the sRGB encode after it */
const dithered = (t, noise) => { const s = Math.max(Math.sqrt(t) + noise * DITHER_STEP, 0); return s * s; };
const srgb = t => (t <= 0.0031308 ? 12.92 * t : 1.055 * t ** (1 / 2.4) - 0.055);

describe('the output dither', () => {
  it('moves every brightness by about half an 8-bit step, never a whole one', () => {
    let largest = 0, smallest = Infinity;
    for (let i = 0; i <= 4000; i++) {
      const t = i / 4000;
      for (const noise of [-0.5, 0.5]) {
        const step = Math.abs(srgb(dithered(t, noise)) - srgb(t)) * 255;
        largest = Math.max(largest, step);
        if (t >= 0.01 && t < 1) smallest = Math.min(smallest, step);
      }
    }
    expect(largest).toBeLessThan(0.75);
    /* enough to break a band wherever there is light to band */
    expect(smallest).toBeGreaterThan(0.4);
  });

  it('adds nothing on average: the noise is centred', () => {
    for (const t of [0.02, 0.2, 0.5, 0.9]) {
      let sum = 0;
      for (let k = 0; k < 64; k++) sum += srgb(dithered(t, (k + 0.5) / 64 - 0.5)) - srgb(t);
      expect(Math.abs(sum / 64) * 255).toBeLessThan(0.02);
    }
  });

  it('is the renderer\'s tone mapping, in the slot three leaves free', () => {
    const added = [];
    const renderer = { library: { addToneMapping: (fn, type) => added.push([fn, type]) }, toneMapping: THREE.ACESFilmicToneMapping };
    expect(installOutputDither(renderer)).toBe(THREE.CustomToneMapping);
    expect(renderer.toneMapping).toBe(THREE.CustomToneMapping);
    expect(added).toEqual([[ditheredAcesToneMapping, THREE.CustomToneMapping]]);
    expect(typeof ditheredAcesToneMapping).toBe('function');
  });
});
