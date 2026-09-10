import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { LANDCOVER, packNibbles, unpackNibbles, decodeLandcover, landcoverSampler, treeFraction, isTreeClass } from './landcover.mjs';
import { inflate } from './codec.js';

const encode = cells => ({ enc: 'deflate-raw+b64', b64: deflateRawSync(Buffer.from(packNibbles(cells))).toString('base64') });

describe('the land-cover record', () => {
  it('packs two classes a byte, low nibble first, and unpacks them exactly', () => {
    const cells = Uint8Array.from([3, 2, 1, 6, 5, 4, 0]);
    const bytes = packNibbles(cells);
    expect([...bytes]).toEqual([0x23, 0x61, 0x45, 0x00]);
    expect([...unpackNibbles(bytes, 7)]).toEqual([...cells]);
    expect(() => unpackNibbles(bytes, 9)).toThrow(/holds 4 bytes/);
    expect(() => packNibbles([16])).toThrow(/nibble/);
  });
  it('decodes through the pack codec and samples cell-centred, unknown outside', async () => {
    const rec = { cell: 12, x0: -24, z0: -12, nx: 4, nz: 2, ...encode([3, 3, 2, 1, 5, 4, 6, 0]) };
    const d = await decodeLandcover(rec, inflate);
    const at = landcoverSampler(d);
    expect([at(-20, -8), at(-10, -8), at(0, -8), at(12, -8)]).toEqual([3, 3, 2, 1]);
    expect([at(-20, 4), at(-10, 4), at(0, 4), at(12, 4)]).toEqual([5, 4, 6, 0]);
    expect([at(-25, 0), at(24.01, 0), at(0, -13), at(0, 12), at(NaN, 0)]).toEqual([0, 0, 0, 0, 0]);
    expect(at.bounds).toEqual({ x0: -24, z0: -12, x1: 24, z1: 12 });
    expect(landcoverSampler(null)(0, 0)).toBe(LANDCOVER.UNKNOWN);
    await expect(decodeLandcover({ ...rec, enc: 'raw' }, inflate)).rejects.toThrow(/encoding/);
  });
  it('reads a tree fraction over a window and skips unknown cells', async () => {
    const rec = { cell: 12, x0: 0, z0: 0, nx: 3, nz: 3, ...encode([3, 3, 3, 2, 5, 0, 2, 2, 2]) };
    const at = landcoverSampler(await decodeLandcover(rec, inflate));
    expect(treeFraction(at, 18, 18, 12)).toBeCloseTo(4 / 8, 6);
    expect(treeFraction(at, 500, 500, 12)).toBe(-1);
    expect([3, 5].every(isTreeClass) && ![0, 1, 2, 4, 6].some(isTreeClass)).toBe(true);
  });
  it('every committed record decodes, covers the far tint and carries its calibration', async () => {
    const builds = ['geobuild', 'nvgkbuild', 'puttombuild', 'angsobuild', 'upsalabuild', 'johannesbergbuild',
      'ribbingsforsbuild', 'visbybuild', 'lidingobuild', 'tortunabuild'];
    for (const b of builds) {
      const file = new URL(`../../../../${b}/landcover.json`, import.meta.url);
      if (!existsSync(file)) continue;
      const rec = JSON.parse(readFileSync(file, 'utf8'));
      const d = await decodeLandcover(rec, inflate);
      const at = landcoverSampler(d);
      /* the far tint reaches 6,144 m; the record must reach past it */
      expect(at.bounds.x0, b).toBeLessThanOrEqual(-6144);
      expect(at.bounds.x1, b).toBeGreaterThanOrEqual(6144);
      expect(rec.calibration.balanced, b).toBeGreaterThanOrEqual(0.75);
      expect(rec.calibration.treeRecall, b).toBeGreaterThanOrEqual(0.8);
      let trees = 0, known = 0;
      for (let k = 0; k < d.cells.length; k += 97) { if (d.cells[k]) known++; if (isTreeClass(d.cells[k])) trees++; }
      /* a Swedish 12 km square that is not mostly sea carries real forest */
      expect(trees / known, b).toBeGreaterThan(0.15);
    }
  });
});
