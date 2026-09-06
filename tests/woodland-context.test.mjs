import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  compactWoodlandContext,
  createWoodlandContextSampler,
  woodlandSpeciesPrior,
} from '../apps/golf/src/engine/woodland-context.mjs';

const grid = overrides => ({
  schemaVersion: 1,
  kind: 'woodland-leaf-type-context',
  crs: 'EPSG:3006',
  extent: [640000, 6636000, 640060, 6636040],
  width: 6,
  height: 4,
  cellSizeMetres: 10,
  // Deliberately unsorted, with adjacent opposing classes and an omitted row.
  runs: [[2, 3, 2, 2], [0, 4, 2, 2], [0, 0, 2, 1], [2, 0, 3, 1]],
  ...overrides,
});
const toEpsg = (x, z) => [640000 + x, 6636040 - z];

describe('geographic woodland context', () => {
  it('uses absolute projected coordinates and north-to-south row order', () => {
    const sample = createWoodlandContextSampler(grid(), { toEpsg });
    expect(sample(5, 5)).toBe(1);
    expect(sample(45, 5)).toBe(2);
    expect(sample(5, 15)).toBeNull();
    expect(sample(35, 25)).toBe(2);
    expect(sample(5, 35)).toBeNull();
    expect(sample(5, 5)).toBe(1); // Return to an earlier cached row.
  });

  it('keeps exact pixel boundaries, gaps and opposing classes disjoint', () => {
    const sample = createWoodlandContextSampler(grid(), { toEpsg });
    expect(sample(0, 0)).toBe(1);
    expect(sample(-0.001, 5)).toBeNull();
    expect(sample(5, -0.001)).toBeNull();
    expect(sample(19.999, 5)).toBe(1);
    expect(sample(20, 5)).toBeNull();
    expect(sample(39.999, 5)).toBeNull();
    expect(sample(40, 5)).toBe(2);
    expect(sample(59.999, 5)).toBe(2);
    expect(sample(60, 5)).toBeNull();
    expect(sample(5, 10)).toBeNull();
    expect(sample(29.999, 25)).toBe(1);
    expect(sample(30, 25)).toBe(2);
    expect(sample(5, 40)).toBeNull();
  });

  it('preserves missing coverage and invalid sample coordinates as unknown', () => {
    expect(createWoodlandContextSampler(null)(1, 2)).toBeNull();
    const sample = createWoodlandContextSampler(grid(), { toEpsg });
    expect(sample(Number.NaN, 5)).toBeNull();
    expect(sample(5, Infinity)).toBeNull();
    expect(createWoodlandContextSampler(grid(), { toEpsg: () => [NaN, 6636040] })(5, 5)).toBeNull();
    expect(createWoodlandContextSampler(grid({ runs: [] }), { toEpsg })(5, 5)).toBeNull();
  });

  it.each([
    [{ crs: 'EPSG:4326' }, /EPSG:3006/],
    [{ schemaVersion: 2 }, /schema/],
    [{ extent: [640000, 6636000, 640061, 6636040] }, /extent/],
    [{ height: 0 }, /height/],
    [{ cellSizeMetres: -10 }, /cellSizeMetres/],
    [{ runs: [[4, 0, 1, 1]] }, /outside/],
    [{ runs: [[0, -1, 1, 1]] }, /outside/],
    [{ runs: [[0, 5, 2, 1]] }, /outside/],
    [{ runs: [[0, 0, 0, 1]] }, /outside/],
    [{ runs: [[0, 0, 2, 1], [0, 1, 2, 2]] }, /overlap/],
    [{ runs: [[0, 0, 1, 3]] }, /class/],
    [{ runs: [[0.5, 0, 1, 1]] }, /integers/],
  ])('rejects malformed geographic data: %j', (overrides, message) => {
    expect(() => createWoodlandContextSampler(grid(overrides), { toEpsg })).toThrow(message);
    expect(() => compactWoodlandContext(grid(overrides))).toThrow(message);
  });

  it('snapshots row intervals rather than retaining mutable run arrays', () => {
    const source = grid();
    const sample = createWoodlandContextSampler(source, { toEpsg });
    source.runs[2][3] = 2;
    source.runs.push([1, 0, 6, 1]);
    expect(sample(5, 5)).toBe(1);
    expect(sample(5, 15)).toBeNull();
  });

  it('accepts the pinned Upsala evidence without upgrading its version or species claims', () => {
    const data = JSON.parse(fs.readFileSync(new URL('../upsalabuild/mapping/woodland-leaf-type-context.json', import.meta.url)));
    const sample = createWoodlandContextSampler(data, { toEpsg: (e, n) => [e, n] });
    expect(data.sourceVersion).toContain('2.0');
    expect(data.sourceVersion).toContain('v2.1');
    expect(data.derivedPolicy.individualSpeciesSupported).toBe(false);
    expect(data.derivedPolicy.positionsSupported).toBe(false);
    for (const type of [1, 2]) {
      const [row, column] = data.runs.find(run => run[3] === type);
      expect(sample(data.extent[0] + (column + 0.5) * 10, data.extent[3] - (row + 0.5) * 10)).toBe(type);
    }
  });
});

describe('lossless packed woodland transport', () => {
  it('stores four cells per byte across row boundaries, starting with the low bits', () => {
    const source = grid({ sourceVersion: '2.0; v2.1 equivalence unverified', license: 'CC0-1.0' });
    const before = JSON.stringify(source);
    const packed = compactWoodlandContext(source);
    expect([...Buffer.from(packed.data, 'base64')]).toEqual([5, 10, 0, 149, 2, 0]);
    expect(packed.encoding).toBe('row-major-2bit-lsb-base64-v1');
    expect(packed.runs).toBeUndefined();
    expect(packed.sourceVersion).toBe(source.sourceVersion);
    expect(packed.license).toBe(source.license);
    expect(JSON.stringify(source)).toBe(before);
    expect(compactWoodlandContext(packed)).toEqual(packed);
  });

  it('preserves north/west inclusion, south/east exclusion, internal boundaries and unknown cells', () => {
    const sample = createWoodlandContextSampler(compactWoodlandContext(grid()), { toEpsg });
    const cases = [
      [0, 0, 1], [-0.001, 5, null], [5, -0.001, null],
      [19.999, 5, 1], [20, 5, null], [39.999, 5, null], [40, 5, 2],
      [59.999, 5, 2], [60, 5, null], [5, 10, null],
      [29.999, 25, 1], [30, 25, 2], [5, 35, null], [5, 40, null],
      [NaN, 5, null], [5, Infinity, null],
    ];
    for (const [x, z, expected] of cases) expect(sample(x, z)).toBe(expected);
  });

  it.each([
    [{ data: 'AAAAAAA' }, /length/],
    [{ data: 'AAAAAAAAAA==' }, /length/],
    [{ data: 'AAAAAAA=' }, /byte length/],
    [{ data: '!!!!!!!!' }, /base64/],
    [{ data: 'AwAAAAAA' }, /class/],
    [{ encoding: 'unrecognized' }, /encoding/],
    [{ runs: [] }, /also contain runs/],
  ])('rejects corrupt or ambiguous packed data: %j', (overrides, message) => {
    const packed = { ...compactWoodlandContext(grid()), ...overrides };
    expect(() => createWoodlandContextSampler(packed, { toEpsg })).toThrow(message);
    expect(() => compactWoodlandContext(packed)).toThrow(message);
  });

  it('requires unused cells and base64 padding bits to be zero', () => {
    const packed = compactWoodlandContext(grid({
      width: 1, height: 1, extent: [640000, 6636030, 640010, 6636040], runs: [[0, 0, 1, 1]],
    }));
    expect(packed.data).toBe('AQ==');
    expect(createWoodlandContextSampler(packed, { toEpsg })(5, 5)).toBe(1);
    expect(() => createWoodlandContextSampler({ ...packed, data: 'BA==' }, { toEpsg })).toThrow(/padding cells/);
    expect(() => createWoodlandContextSampler({ ...packed, data: 'Af==' }, { toEpsg })).toThrow(/canonical base64/);
  });

  it('preserves every pixel and all source metadata of the pinned 600×600 Upsala evidence', () => {
    const source = JSON.parse(fs.readFileSync(new URL('../upsalabuild/mapping/woodland-leaf-type-context.json', import.meta.url)));
    const packed = compactWoodlandContext(source);
    const { runs: _runs, encoding: _sourceEncoding, ...sourceMetadata } = source;
    const { data: _data, encoding: _packedEncoding, ...packedMetadata } = packed;
    expect(packedMetadata).toEqual(sourceMetadata);
    expect(Buffer.from(packed.data, 'base64').length).toBe(90000);

    // Independently expand source runs, then sample both transports at every
    // geographic pixel centre. The byte comparison includes all unknown gaps.
    const expected = new Uint8Array(source.width * source.height);
    for (const [row, start, length, type] of source.runs) {
      expected.fill(type, row * source.width + start, row * source.width + start + length);
    }
    for (const representation of [source, packed]) {
      const sample = createWoodlandContextSampler(representation, { toEpsg: (e, n) => [e, n] });
      const actual = new Uint8Array(expected.length);
      for (let row = 0; row < source.height; row++) {
        for (let column = 0; column < source.width; column++) {
          actual[row * source.width + column] = sample(
            source.extent[0] + (column + 0.5) * source.cellSizeMetres,
            source.extent[3] - (row + 0.5) * source.cellSizeMetres,
          ) ?? 0;
        }
      }
      expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true);
    }
  });
});

describe('woodland rendering prior', () => {
  it('leaves unknown context to the existing course rule', () => {
    for (const context of [null, undefined, 0, 3]) {
      expect(woodlandSpeciesPrior({ r: 0.8, context })).toBeUndefined();
    }
  });

  it('models broadleaf dominance as a mixture instead of identifying every tree as birch', () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 8300; i++) counts[woodlandSpeciesPrior({ r: (i + 0.5) / 8300, context: 2 })]++;
    expect(counts).toEqual([810, 1680, 5810]);
    expect(counts[1] / counts[0]).toBeCloseTo(56 / 27);
  });

  it('preserves the existing conifer-dominant mixture when it already qualifies', () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 10000; i++) counts[woodlandSpeciesPrior({ r: (i + 0.5) / 10000, context: 1 })]++;
    expect(counts).toEqual([2700, 5600, 1700]);
  });

  it('retains stronger broadleaf priors and constrains an incompatible conifer prior', () => {
    expect(woodlandSpeciesPrior({ r: 0.25, context: 2, baseBroadleafProbability: 0.9 })).toBe(2);
    expect(woodlandSpeciesPrior({ r: 0.69, context: 1, baseBroadleafProbability: 0.9 })).toBe(0);
    expect(woodlandSpeciesPrior({ r: 0.71, context: 1, baseBroadleafProbability: 0.9 })).toBe(2);
  });

  it('rejects invalid random samples and probabilities for a resolved context', () => {
    for (const r of [-0.1, 1, NaN]) expect(() => woodlandSpeciesPrior({ r, context: 2 })).toThrow(/r must/);
    for (const baseBroadleafProbability of [-0.1, 1.1, NaN]) {
      expect(() => woodlandSpeciesPrior({ r: 0.5, context: 2, baseBroadleafProbability })).toThrow(/baseBroadleafProbability/);
    }
  });
});
