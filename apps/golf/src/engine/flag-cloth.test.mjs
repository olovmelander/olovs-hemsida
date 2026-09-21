import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  packFlagCloth, assembleFlagCloth, decodeFlagCloth, flagClothIndex, flagClothBand,
  accumulateFlagClothPose, flagClothHang, FLAG_CLOTH_QUANT,
} from './flag-cloth.mjs';
import { FLAG_CLOTH_ASSET } from './flag-cloth-asset.mjs';

const inflate = async u8 => new Uint8Array(zlib.inflateRawSync(u8));
const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));

function syntheticBake() {
  const grid = { nx: 3, nz: 2, width: 0.78, height: 0.5, hoistX: 0.045, top: 2.53 };
  const frames = 4, nv = 6;
  const band = (name, ms, lift) => ({ name, ms, hangDeg: 10 + lift,
    frames: Array.from({ length: frames }, (_, f) => Array.from({ length: nv * 3 }, (_, c) => 2.5 * Math.sin(c + f * 0.7) + lift * 0.01 + 0.00003 * c)) });
  return { format: 'banvy-flag-bake-v1', blender: 'test', grid, fps: 15, frames, ruleDegPerMs: 8.95, cloth: {},
    bands: [band('calm', 0, 0), band('breeze', 4, 30)] };
}

describe('the flag cloth codec', () => {
  it('reads back every coordinate within half a quantum', async () => {
    const bake = syntheticBake();
    const { header, payload } = packFlagCloth(bake);
    const file = assembleFlagCloth(header, zlib.deflateRawSync(payload));
    const cloth = await decodeFlagCloth(file, inflate);
    expect(cloth.nv).toBe(6);
    expect(cloth.bands.map(b => b.name)).toEqual(['calm', 'breeze']);
    bake.bands.forEach((band, b) => band.frames.forEach((frame, f) => frame.forEach((v, c) => {
      expect(Math.abs(cloth.bands[b].positions[f * 18 + c] - v)).toBeLessThanOrEqual(FLAG_CLOTH_QUANT / 2 + 1e-6);
    })));
  });

  it('refuses a file that is not one', async () => {
    await expect(decodeFlagCloth(new Uint8Array(16), inflate)).rejects.toThrow(/FLG1/);
  });

  it('plays the nearest band, and blends two by weight', async () => {
    const bake = syntheticBake();
    const { header, payload } = packFlagCloth(bake);
    const cloth = await decodeFlagCloth(assembleFlagCloth(header, zlib.deflateRawSync(payload)), inflate);
    expect(flagClothBand(cloth, 0.4)).toBe(0);
    expect(flagClothBand(cloth, 3.1)).toBe(1);
    expect(flagClothBand(cloth, 99)).toBe(1);
    const a = accumulateFlagClothPose(cloth, 0, 0, 1, new Float32Array(18));
    const b = accumulateFlagClothPose(cloth, 1, 0, 1, new Float32Array(18));
    const mix = accumulateFlagClothPose(cloth, 1, 0, 0.25, accumulateFlagClothPose(cloth, 0, 0, 0.75, new Float32Array(18)));
    for (let c = 0; c < 18; c++) expect(mix[c]).toBeCloseTo(a[c] * 0.75 + b[c] * 0.25, 5);
    /* the loop wraps: a whole loop later is the same pose */
    const later = accumulateFlagClothPose(cloth, 0, cloth.frames / cloth.fps, 1, new Float32Array(18));
    for (let c = 0; c < 18; c++) expect(later[c]).toBeCloseTo(a[c], 5);
  });

  it('draws two triangles a cell', () => {
    const idx = flagClothIndex(3, 2);
    expect(idx.length).toBe(12);
    expect(Math.max(...idx)).toBe(5);
  });
});

describe('the shipped flag cloth', () => {
  const file = fs.readFileSync(PUBLIC + FLAG_CLOTH_ASSET.path);

  it('is the file the asset module names, byte for byte', () => {
    expect(file.length).toBe(FLAG_CLOTH_ASSET.bytes);
    expect(crypto.createHash('sha256').update(file).digest('hex')).toBe(FLAG_CLOTH_ASSET.sha256);
    expect(FLAG_CLOTH_ASSET.path).toBe(`models/flag/cloth-${FLAG_CLOTH_ASSET.sha256}.bin`);
  });

  it('hangs each band the way a golfer reads a flag, calm to gale', async () => {
    const cloth = await decodeFlagCloth(file, inflate);
    const comps = cloth.nv * 3;
    let lastHang = -1, lastMs = -1;
    for (const band of cloth.bands) {
      let sum = 0;
      for (let f = 0; f < cloth.frames; f++) sum += flagClothHang(cloth, band.positions.subarray(f * comps, (f + 1) * comps));
      const hang = sum / cloth.frames;
      /* what the header claims is what the frames measure */
      expect(Math.abs(hang - band.hangDeg)).toBeLessThan(0.5);
      /* and the speed a band stands for is the golfer's rule applied to it */
      if (band.ms > 0 && band.ms < 10) expect(Math.abs(band.ms - band.hangDeg / cloth.ruleDegPerMs)).toBeLessThan(0.02);
      // Once extended, stronger air changes flutter frequency, not hang angle.
      // A settled broad fold can hang within a fraction of a degree of the
      // lightest breeze; the measurable lift still increases across the range.
      if (band.ms < 10) expect(band.hangDeg).toBeGreaterThan(lastHang-0.5);
      else expect(band.hangDeg).toBeGreaterThan(85);
      expect(band.ms).toBeGreaterThan(lastMs);
      lastHang = band.hangDeg; lastMs = band.ms;
    }
    expect(cloth.bands[0].hangDeg).toBeLessThan(12);                     // calm hangs limp
    expect(cloth.bands.at(-1).hangDeg).toBeGreaterThan(85);              // a gale flies straight out
    expect(cloth.bands.at(-1).ms).toBeGreaterThanOrEqual(24);
    expect(cloth.bands.at(-1).tailHz).toBeGreaterThan(cloth.bands.find(b => b.name === 'gale').tailHz);
  });

  it('interpolates every sampled fold without overshoot, including the loop seam', async () => {
    const cloth = await decodeFlagCloth(file, inflate), comps = cloth.nv * 3;
    const out = new Float32Array(comps);
    let overshoot = 0;
    for (let b = 0; b < cloth.bands.length; b++) {
      const p = cloth.bands[b].positions;
      for (let f = 0; f < cloth.frames; f += 7) for (const sub of [0.2, 0.5, 0.8]) {
        out.fill(0); accumulateFlagClothPose(cloth, b, (f + sub) / cloth.fps, 1, out);
        for (let c = 0; c < comps; c++) {
          const a = p[f * comps + c], z = p[((f + 1) % cloth.frames) * comps + c];
          overshoot = Math.max(overshoot, out[c] - Math.max(a,z), Math.min(a,z) - out[c]);
        }
      }
    }
    expect(overshoot).toBeLessThan(1e-6);
  });

  it('uses one settled calm drape at every phase without turbulent creasing', async () => {
    const cloth = await decodeFlagCloth(file, inflate), calm = cloth.bands[0];
    expect(calm.turbulence).toBe(0);
    expect(calm.staticRest).toBe(true);
    const first = calm.positions.subarray(0, cloth.nv*3);
    for(let f=1;f<cloth.frames;f++) {
      expect(calm.positions.subarray(f*cloth.nv*3,(f+1)*cloth.nv*3)).toEqual(first);
    }
  });

  it('keeps velocity continuous across baked frames and the wrap', async () => {
    const cloth = await decodeFlagCloth(file, inflate), comps = cloth.nv * 3, dt = 1e-4;
    let worstRms = 0;
    for (let b = 0; b < cloth.bands.length; b++) for (const f of [0, 1, 31, cloth.frames - 1]) {
      const poses = [-dt, 0, dt].map(offset => accumulateFlagClothPose(cloth,b,f/cloth.fps+offset,1,new Float32Array(comps)));
      let error = 0;
      for (let c = 0; c < comps; c++) error += ((poses[2][c] - 2*poses[1][c] + poses[0][c])/dt) ** 2;
      worstRms = Math.max(worstRms, Math.sqrt(error/comps));
    }
    expect(worstRms).toBeLessThan(0.035);
  });

  it('keeps its hoist on the pole, its cloth off the ground, and its loop seamless', async () => {
    const cloth = await decodeFlagCloth(file, inflate);
    const { nx, nz } = cloth.grid;
    const comps = cloth.nv * 3;
    for (const band of cloth.bands) {
      const p = band.positions;
      let biggestStep = 0, hoistRadius = 0, minHoist = Infinity, maxHoist = -Infinity, lowest = Infinity;
      for (let f = 0; f < cloth.frames; f++) {
        const o = f * comps;
        for (let j = 0; j < nz; j++) {
          const h = o + 3 * j * nx;
          /* the hoist is pinned to the pole's surface, inside the 5.2 cm sleeve */
          hoistRadius = Math.max(hoistRadius, Math.hypot(p[h], p[h + 2]));
          minHoist = Math.min(minHoist, p[h + 1]); maxHoist = Math.max(maxHoist, p[h + 1]);
        }
        for (let c = 1; c < comps; c += 3) lowest = Math.min(lowest, p[o + c]);
        if (f) {
          let step = 0;
          for (let c = 0; c < comps; c++) step = Math.max(step, Math.abs(p[o + c] - p[o - comps + c]));
          biggestStep = Math.max(biggestStep, step);
        }
      }
      expect(hoistRadius).toBeLessThan(0.026);
      expect(minHoist).toBeGreaterThan(2.0); expect(maxHoist).toBeLessThan(2.56);
      expect(lowest).toBeGreaterThan(1.5);
      /* the wrap from the last frame to the first is no bigger a step than the loop takes anyway */
      let wrap = 0;
      for (let c = 0; c < comps; c++) wrap = Math.max(wrap, Math.abs(p[c] - p[(cloth.frames - 1) * comps + c]));
      expect(wrap).toBeLessThanOrEqual(biggestStep * 1.25 + 0.002);
    }
  });
});
