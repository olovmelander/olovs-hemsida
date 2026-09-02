import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWindow, signedDistanceField, squaredDistanceTransform } from './distance-transform.mjs';

function bruteSquared(width, height, isTarget) {
  const out = new Float32Array(width * height);
  const targets = [];
  for (let index = 0; index < width * height; index++) if (isTarget(index)) targets.push([index % width, Math.floor(index / width)]);
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    let best = 1e20;
    for (const [tx, ty] of targets) best = Math.min(best, (tx - column) ** 2 + (ty - row) ** 2);
    out[row * width + column] = best;
  }
  return out;
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

test('squared transform matches brute force on random masks', () => {
  const random = seeded(7);
  for (let trial = 0; trial < 6; trial++) {
    const width = 5 + Math.floor(random() * 30), height = 5 + Math.floor(random() * 30);
    const mask = new Uint8Array(width * height);
    for (let index = 0; index < mask.length; index++) mask[index] = random() < 0.08 ? 1 : 0;
    const fast = squaredDistanceTransform(width, height, index => mask[index] === 1);
    const slow = bruteSquared(width, height, index => mask[index] === 1);
    assert.deepEqual(Array.from(fast), Array.from(slow), `trial ${trial} ${width}x${height}`);
  }
});

test('signed field crosses zero on the pixel edge and is exact beyond it', () => {
  const width = 12, height = 3;
  const mask = new Uint8Array(width * height);
  for (let row = 0; row < height; row++) for (let column = 6; column < width; column++) mask[row * width + column] = 1;
  const field = signedDistanceField(mask, width, height, { pixelMetres: 0.25 });
  const middle = column => field[width + column];
  assert.equal(middle(5), -0.25);
  assert.equal(middle(6), 0.25);
  assert.equal(middle(0), -6 * 0.25);
  assert.equal(middle(11), 6 * 0.25);
  /* linear interpolation between the two edge pixels crosses zero midway */
  assert.equal(middle(5) + middle(6), 0);
});

test('clamp saturates and an empty or full mask saturates to the clamp', () => {
  const width = 40, height = 4;
  const mask = new Uint8Array(width * height);
  mask[2 * width + 20] = 1;
  const field = signedDistanceField(mask, width, height, { pixelMetres: 0.25, clampMetres: 1 });
  assert.equal(field[2 * width + 20], 0.25);
  assert.equal(field[2 * width + 0], -1);
  const empty = signedDistanceField(new Uint8Array(width * height), width, height, { pixelMetres: 1, clampMetres: 4 });
  assert.ok(Array.from(empty).every(value => value === -4));
  const full = signedDistanceField(new Uint8Array(width * height).fill(1), width, height, { pixelMetres: 1, clampMetres: 4 });
  assert.ok(Array.from(full).every(value => value === 4));
});

test('a windowed transform with a halo as wide as the clamp equals the global one', () => {
  const random = seeded(11);
  const width = 64, height = 48, pixelMetres = 0.25, clampMetres = 1;
  const halo = Math.ceil(clampMetres / pixelMetres);
  const mask = new Uint8Array(width * height);
  for (let blob = 0; blob < 12; blob++) {
    const cx = Math.floor(random() * width), cy = Math.floor(random() * height), r = 2 + random() * 5;
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
      if ((column - cx) ** 2 + (row - cy) ** 2 <= r * r) mask[row * width + column] = 1;
    }
  }
  const global = signedDistanceField(mask, width, height, { pixelMetres, clampMetres });
  for (const [column0, row0] of [[0, 0], [20, 10], [40, 30]]) {
    const tileWidth = 24, tileHeight = 18;
    const window = extractWindow(mask, width, height, {
      column0: column0 - halo, row0: row0 - halo,
      column1: column0 + tileWidth - 1 + halo, row1: row0 + tileHeight - 1 + halo,
    });
    const local = signedDistanceField(window.data, window.width, window.height, { pixelMetres, clampMetres });
    for (let row = 0; row < tileHeight; row++) for (let column = 0; column < tileWidth; column++) {
      const gx = column0 + column, gy = row0 + row;
      if (gx >= width || gy >= height) continue;
      const expected = global[gy * width + gx];
      const actual = local[(gy - window.row0) * window.width + (gx - window.column0)];
      assert.equal(actual, expected, `tile ${column0},${row0} pixel ${gx},${gy}`);
    }
  }
});
