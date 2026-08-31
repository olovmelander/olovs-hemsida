import { describe, expect, it } from 'vitest';
import { contiguousRgba8Readback } from './rgba8-readback.mjs';

describe('WebGPU RGBA8 readback rows', () => {
  it('keeps an already contiguous readback without copying', () => {
    const source = new Uint8Array(3 * 2 * 4);
    expect(contiguousRgba8Readback(source, 3, 2)).toBe(source);
  });

  it('strips only the exact 256-byte WebGPU row padding', () => {
    const width = 3, height = 3, rowBytes = width * 4, paddedRowBytes = 256;
    const source = new Uint8Array((height - 1) * paddedRowBytes + rowBytes).fill(255);
    for (let row = 0; row < height; row++) {
      source.fill(row + 1, row * paddedRowBytes, row * paddedRowBytes + rowBytes);
    }
    expect([...contiguousRgba8Readback(source, width, height)]).toEqual([
      ...new Array(rowBytes).fill(1),
      ...new Array(rowBytes).fill(2),
      ...new Array(rowBytes).fill(3),
    ]);
  });

  it('accepts the observed 1440 by 900 Three r185 padded layout', () => {
    const source = new Uint8Array(5_299_072);
    expect(contiguousRgba8Readback(source, 1440, 900)).toHaveLength(5_184_000);
  });

  it('rejects unrecognized sizes and non-byte input', () => {
    expect(() => contiguousRgba8Readback(new Uint8Array(25), 3, 2)).toThrow(/unexpected.*size 25/);
    expect(() => contiguousRgba8Readback(new Uint16Array(12), 3, 2)).toThrow(/Uint8Array/);
  });
});

