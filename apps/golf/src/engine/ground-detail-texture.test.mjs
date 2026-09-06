import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { fillGroundDetailPixels } from './ground-detail-texture.mjs';

const SIZE = 512;
let original, seamless;

function channelStats(pixels, channel) {
  let sum = 0, squares = 0, extremes = 0;
  let edgeX = 0, edgeY = 0, interiorX = 0, interiorY = 0;
  const at = (x, y) => pixels[(y * SIZE + x) * 4 + channel];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const value = at(x, y);
    sum += value;
    squares += value * value;
    if (value === 0 || value === 255) extremes++;
    if (x < SIZE - 1) interiorX += Math.abs(value - at(x + 1, y));
    if (y < SIZE - 1) interiorY += Math.abs(value - at(x, y + 1));
  }
  for (let position = 0; position < SIZE; position++) {
    edgeX += Math.abs(at(0, position) - at(SIZE - 1, position));
    edgeY += Math.abs(at(position, 0) - at(position, SIZE - 1));
  }
  const count = SIZE * SIZE;
  const mean = sum / count;
  return {
    mean, deviation: Math.sqrt(squares / count - mean * mean), extremes,
    edges: [edgeX / SIZE, edgeY / SIZE],
    interior: [interiorX / SIZE / (SIZE - 1), interiorY / SIZE / (SIZE - 1)],
  };
}

describe('packed ground detail texture', () => {
  beforeAll(() => {
    original = new Uint8ClampedArray(SIZE * SIZE * 4);
    seamless = new Uint8ClampedArray(SIZE * SIZE * 4);
    fillGroundDetailPixels(original, SIZE);
    fillGroundDetailPixels(seamless, SIZE, { seamless: true });
  });

  it('keeps the disabled path identical to the original complete ImageData', () => {
    /* Independently measured from main.js at ce359788. This locks the full
       texture, including clamp-to-nearest byte behaviour and its glint alpha. */
    expect(createHash('sha256').update(original).digest('hex'))
      .toBe('fbb5a2197df82602f69707d3ab82eaf667e14aa1d4f618e329790b2288810bb4');
  });

  it('retains every fine-blade and glint byte in the existing buffer', () => {
    let changedBlade = 0, changedGlint = 0, changedClump = 0, changedMacro = 0;
    for (let index = 0; index < original.length; index += 4) {
      changedBlade += Number(original[index] !== seamless[index]);
      changedGlint += Number(original[index + 3] !== seamless[index + 3]);
      changedClump += Number(original[index + 1] !== seamless[index + 1]);
      changedMacro += Number(original[index + 2] !== seamless[index + 2]);
    }
    expect(changedBlade).toBe(0);
    expect(changedGlint).toBe(0);
    expect(changedClump).toBeGreaterThan(SIZE * SIZE / 2);
    expect(changedMacro).toBeGreaterThan(SIZE * SIZE / 2);
    expect(seamless.byteLength).toBe(original.byteLength);
    const target = new Uint8ClampedArray(original.length);
    expect(fillGroundDetailPixels(target, SIZE, { seamless: true })).toBe(target);
    expect(Buffer.from(target).equals(Buffer.from(seamless))).toBe(true);
  });

  it.each([1, 2])('keeps channel %i mean and contrast within sub-byte quantization', channel => {
    const before = channelStats(original, channel), after = channelStats(seamless, channel);
    expect(Math.abs(after.mean - before.mean)).toBeLessThan(0.35);
    expect(Math.abs(after.deviation - before.deviation)).toBeLessThan(0.10);
    expect(after.extremes).toBeLessThanOrEqual(before.extremes);
  });

  it.each([1, 2])('removes channel %i repeat jumps without broadly blurring its detail', channel => {
    const before = channelStats(original, channel), after = channelStats(seamless, channel);
    for (let axis = 0; axis < 2; axis++) {
      expect(before.edges[axis]).toBeGreaterThan(before.interior[axis] * 10);
      expect(after.edges[axis]).toBeLessThan(before.edges[axis] * 0.10);
      expect(after.edges[axis]).toBeLessThan(after.interior[axis]);
      /* Periodic integer cells slightly change the sampled spectrum. Keep the
         within-tile variation rather than hiding seams with a blurred image. */
      expect(after.interior[axis] / before.interior[axis]).toBeGreaterThan(0.8);
      expect(after.interior[axis] / before.interior[axis]).toBeLessThan(1.2);
    }
  });

  it('rejects unsupported layouts and ambiguous preview settings', () => {
    for (const [pixels, size] of [
      [new Uint8Array(SIZE * SIZE * 4), SIZE],
      [new Uint8ClampedArray(256 * 256 * 4), 256],
      [new Uint8ClampedArray(4), SIZE],
    ]) expect(() => fillGroundDetailPixels(pixels, size)).toThrow(TypeError);
    expect(() => fillGroundDetailPixels(new Uint8ClampedArray(SIZE * SIZE * 4), SIZE, { seamless: 1 }))
      .toThrow(TypeError);
  });
});
