import { describe, expect, it } from 'vitest';
import { createGroundTintOverview } from './ground-tint-overview.mjs';

function layer({ n = 100, dx = 10, x0 = -500, z0 = -500, pixel = () => [255, 0, 0] } = {}) {
  const data = new Uint8Array(n * n * 4);
  for (let row = 0; row < n; row++) for (let column = 0; column < n; column++) {
    data.set([...pixel(column, row), 255], (row * n + column) * 4);
  }
  return { n, dx, bounds: { x0, z0, x1: x0 + n * dx, z1: z0 + n * dx },
    texture: { image: { data } } };
}

function expectColour(actual, expected) {
  expect(actual).toHaveLength(3);
  expected.forEach((value, channel) => expect(actual[channel]).toBeCloseTo(value, 10));
}

describe('continuous near-to-vista ground tint', () => {
  const approaches = [
    ['west edge', -1, 0], ['east edge', 1, 0],
    ['north edge', 0, -1], ['south edge', 0, 1],
    ['northwest corner', -1, -1], ['northeast corner', 1, -1],
    ['southwest corner', -1, 1], ['southeast corner', 1, 1],
  ];

  it.each(approaches)('has no source switch at the full-footprint limit of the %s', (_name, sx, sz) => {
    const overview = createGroundTintOverview(layer(), { spacing: 24, blendMetres: 100 }, () => [0, 0, 1]);
    // A centre at +/-488 puts the outer edge of a 24 m footprint at +/-500.
    const atInset = inset => overview(sx * (488 - inset), sz * (488 - inset));
    expectColour(atInset(-0.01), [0, 0, 1]);
    expectColour(atInset(0), [0, 0, 1]);
    const justInside = atInset(0.01);
    expect(justInside[0]).toBeGreaterThanOrEqual(0);
    expect(justInside[0]).toBeLessThan(0.000001);
    expect(Math.abs(justInside[2] - 1)).toBeLessThan(0.000001);

    // Corners follow the nearest edge too: their weight must not be squared.
    expectColour(atInset(25), [0.15625, 0, 0.84375]);
    expectColour(atInset(50), [0.5, 0, 0.5]);
    expectColour(atInset(75), [0.84375, 0, 0.15625]);
    expectColour(atInset(100), [1, 0, 0]);
  });

  it('defaults to a 300 m blend and leaves the full near interior unchanged', () => {
    const overview = createGroundTintOverview(layer(), { spacing: 24 }, () => [0, 0, 1]);
    expectColour(overview(338, 0), [0.5, 0, 0.5]);
    expectColour(overview(188, 0), [1, 0, 0]);
    expectColour(overview(0, 0), [1, 0, 0]);
  });

  it('returns the untouched spatial vista colour wherever the footprint is not fully covered', () => {
    const vistaAt = (x, z) => [0.2 + x / 10000, 0.3 + z / 10000, 0.7];
    const overview = createGroundTintOverview(layer(), { spacing: 24 }, vistaAt);
    for (const [x, z] of [[489, 0], [-489, 0], [0, 489], [0, -489], [800, -900], [-700, 850]]) {
      expectColour(overview(x, z), vistaAt(x, z));
    }
  });

  it('averages black and white in linear light', () => {
    const source = layer({ n: 8, dx: 10, x0: 0, z0: 0,
      pixel: column => column < 4 ? [0, 0, 0] : [255, 255, 255] });
    const overview = createGroundTintOverview(source, { spacing: 20, blendMetres: 1 }, () => [1, 0, 0]);
    // Half the footprint is black and half white: its linear average is 0.5,
    // not the approximately 0.214 obtained by decoding their averaged bytes.
    expectColour(overview(40, 40), [0.5, 0.5, 0.5]);
  });

  it('decodes constant sRGB source bytes without altering their linear colour', () => {
    const source = layer({ pixel: () => [128, 64, 255] });
    const overview = createGroundTintOverview(source, { spacing: 24 }, () => [0, 0, 0]);
    expectColour(overview(0, 0), [0.21586050011389926, 0.05126945837404324, 1]);
  });

  it('weights partial texel areas and keeps the footprint centred on both axes', () => {
    // One white column and row cross at the central texel, whose centre is (0, 0).
    const source = layer({ n: 9, dx: 1, x0: -4.5, z0: -4.5,
      pixel: (column, row) => [column === 4 ? 255 : 0, row === 4 ? 255 : 0,
        column === 4 && row === 4 ? 255 : 0] });
    const overview = createGroundTintOverview(source, { spacing: 2, blendMetres: 1 }, () => [0, 0, 0]);
    expectColour(overview(0, 0), [0.5, 0.5, 0.25]);
    for (const x of [-0.75, 0.75]) for (const z of [-0.75, 0.75]) {
      // Each axis covers 0.75 m of the white strip in its 2 m footprint.
      expectColour(overview(x, z), [0.375, 0.375, 0.140625]);
    }
    const wider = createGroundTintOverview(source, { spacing: 2.5, blendMetres: 1 }, () => [0, 0, 0]);
    expectColour(wider(0, 0), [0.4, 0.4, 0.16]);
  });
});
