import { describe, expect, it } from 'vitest';
import { TURF_DETAIL, createTurfDetailTexture, fillTurfDetailPixels, seededRandom } from './turf-detail.mjs';

const fill = (size = 128) => fillTurfDetailPixels(new Uint8Array(size * size * 4), size);

describe('the turf detail texture', () => {
  it('is the same bytes every time (seeded, no Math.random)', () => {
    expect(Buffer.from(fill()).equals(Buffer.from(fill()))).toBe(true);
    const a = seededRandom(7), b = seededRandom(7);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it('centres every channel on 128 with real contrast, so the ground keeps its tone on average', () => {
    const px = fill(256);
    for (let c = 0; c < 4; c++) {
      let sum = 0, sq = 0;
      for (let i = 0; i < 256 * 256; i++) { sum += px[i * 4 + c]; sq += px[i * 4 + c] ** 2; }
      const mean = sum / 65536, deviation = Math.sqrt(sq / 65536 - mean * mean);
      expect(Math.abs(mean - 128)).toBeLessThan(3);
      expect(deviation).toBeGreaterThan(15);
    }
  });
  it('lays the mown blades along one way: the grain changes more across them than along them', () => {
    const size = 256, px = fill(size);
    let along = 0, across = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const v = px[(y * size + x) * 4];
      along += Math.abs(v - px[(y * size + ((x + 1) % size)) * 4]);
      across += Math.abs(v - px[(((y + 1) % size) * size + x) * 4]);
    }
    expect(across).toBeGreaterThan(along * 1.2);
  });
  it('is a repeat-wrapped, mip-mapped, anisotropic texture', () => {
    const t = createTurfDetailTexture({ size: 64 });
    expect(t.generateMipmaps).toBe(true);
    expect(t.anisotropy).toBe(16);
    expect(t.image.width).toBe(64);
    expect(TURF_DETAIL.size).toBe(512);
  });
});
