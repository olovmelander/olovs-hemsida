import { it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { detectFlatWater } from './v2-flat-water.mjs';
import { excludeOceanFromFlatWater } from './coastal-runtime.mjs';
import { buildWaterBedField, carveTerrainTile } from './v2-water-bed.mjs';
import { sha256Hex, inflateBounded } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { MemoryByteCache } from '../../../../packages/course-v2/runtime/cache.mjs';
import { encodePreparedWater, decodePreparedWater, preparedWaterIdentity, preparedWaterInputs,
  preparedWaterAllowed, loadPreparedWater } from './prepared-water.mjs';

const identity = 'a'.repeat(64);
function example(ocean = false) {
  const width = 48, height = 48, spacing = 4, heights = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++)
    heights[r * width + c] = c > 8 && c < 38 && r > 8 && r < 38 ? 50.13 : 52 + c * .07 + r * .03;
  heights[0] = NaN;
  let flatWater = detectFlatWater({ raster: { width, height, spacing, x0: 0, z0: 0, heights }, minimumCells: 50 });
  if (ocean) flatWater = excludeOceanFromFlatWater(flatWater, { seaLevel: 50, isSeaAt: x => x < 80 }, (x, z) => [x, z]);
  const knownBodies = [{ ring: [[70, 70], [140, 70], [140, 140], [70, 140]], level: 50.38 }];
  const waterBed = buildWaterBedField({ flatWater, knownBodies });
  return { identity, inputs: JSON.stringify(knownBodies), flatWater, waterBed };
}

it.each([false, true])('preserves every field byte, shoreline query and carved terrain sample (ocean=%s)', ocean => {
  const live = example(ocean), decoded = decodePreparedWater(encodePreparedWater(live), identity);
  expect(decoded.inputs).toBe(live.inputs);
  expect(decoded.flatWater.components).toEqual(live.flatWater.components);
  expect(decoded.flatWater.excludedOceanCells).toEqual(live.flatWater.excludedOceanCells);
  for (const [key, names] of [['flatWater', ['mask', 'label']], ['waterBed', ['mask', 'level', 'depth', 'near']]]) {
    for (const name of names) {
      const a = live[key][name], b = decoded[key][name];
      expect(Buffer.from(b.buffer, b.byteOffset, b.byteLength).equals(Buffer.from(a.buffer, a.byteOffset, a.byteLength))).toBe(true);
    }
  }
  for (let z = -4; z < 200; z += 1.75) for (let x = -4; x < 200; x += 2.125) {
    for (const method of ['isWaterAt', 'isFlatAt']) expect(decoded.flatWater[method](x, z)).toBe(live.flatWater[method](x, z));
    for (const method of ['inWater', 'nearWater', 'depthAt', 'levelAt']) expect(decoded.waterBed[method](x, z)).toBe(live.waterBed[method](x, z));
  }
  const tile = { bounds: { minEasting: 0, maxEasting: 192, minNorthing: -192, maxNorthing: 0 },
    grid: { width: 97, height: 97, sampleSpacingMetres: 2, heightOffsetMetres: 0, heightScaleMetres: .01 },
    payload: new Uint8Array(new Uint16Array(97 * 97).fill(5013).buffer) };
  tile.payload[0] = 255; tile.payload[1] = 255;
  const other = { ...tile, payload: tile.payload.slice() };
  const options = { legacyOrigin: { easting: 0, northing: 0 }, verticalDatumOffsetMetres: 0 };
  const carved = carveTerrainTile(tile, live.waterBed, options);
  expect(carved).toBeGreaterThan(0);
  expect(carveTerrainTile(other, decoded.waterBed, options)).toBe(carved);
  expect(other.payload).toEqual(tile.payload);
});

it('binds source, data and runtime water inputs, while sharing display modes', async () => {
  const base = { meta: { slug: 'test', sha256: 'pack', surroundings: { sha256: 'wide' } }, groundSha256: 'ground', revision: 'revision' };
  const hash = await preparedWaterIdentity(base);
  for (const changes of [{ revision: 'other' }, { groundSha256: 'other' }, { meta: { ...base.meta, sha256: 'other' } },
    { meta: { ...base.meta, surroundings: null } }]) expect(await preparedWaterIdentity({ ...base, ...changes })).not.toBe(hash);
  const inputs = { knownBodies: [{ ring: [[0, 0], [1, 1]], level: 1 }], origin: { easting: 1, northing: 2 }, ocean: null,
    bridge: { rotationRadians: 0, scaleX: 1, scaleZ: 1, verticalDatumOffsetMetres: 0 } };
  expect(preparedWaterInputs({ ...inputs, ocean: 'fallback' })).not.toBe(preparedWaterInputs(inputs));
  expect(preparedWaterAllowed('?ghibli=1&ljus=dis&q=lo&bakeTint=1')).toBe(true);
  for (const search of ['?startup=0', '?startup=live-water', '?bakeWater=1', '?buildingGeometry=source']) expect(preparedWaterAllowed(search)).toBe(false);
});

it('rejects mismatched, damaged, oversized and invalid-layout assets before use', async () => {
  const bytes = encodePreparedWater(example()), compressed = new Uint8Array(deflateRawSync(bytes));
  const reference = { identity, url: 'courses/test/prepared/water.bin', bytes: compressed.length,
    decodedBytes: bytes.length, sha256: await sha256Hex(compressed), decodedSha256: await sha256Hex(bytes) };
  let requests = 0;
  const load = overrides => loadPreparedWater({ identity, baseUrl: 'https://example.test/sub/', cacheStorage: null,
    fetchImpl: async url => { requests++; expect(url).toBe('https://example.test/sub/courses/test/prepared/water.bin'); return new Response(compressed); },
    reference: { ...reference, ...overrides } });
  expect(await load({ identity: 'b'.repeat(64) })).toBeNull();
  expect(await load({ decodedBytes: 128 * 1024 * 1024 + 1 })).toBeNull();
  expect(requests).toBe(0);
  expect((await load({})).inputs).toBe(example().inputs);
  expect(await load({ sha256: '0'.repeat(64) })).toBeNull();
  expect(await load({ decodedSha256: '0'.repeat(64) })).toBeNull();
  expect(await load({ decodedBytes: 20 })).toBeNull();
  expect(await load({ decodedBytes: bytes.length + 20 })).toBeNull();
  expect(() => decodePreparedWater(bytes.subarray(0, bytes.length - 1), identity)).toThrow();
  expect(() => decodePreparedWater(bytes, 'b'.repeat(64))).toThrow();
  const invalid = bytes.slice();
  new DataView(invalid.buffer).setUint32(4, 0xffffffff, true);
  expect(() => decodePreparedWater(invalid, identity)).toThrow();
});

it('streams a large field into one bounded destination and rejects short/long streams', async () => {
  const input = new Uint8Array(4 * 1024 * 1024);
  for (let i = 0; i < input.length; i++) input[i] = i * 19 & 255;
  const encoded = new Uint8Array(deflateRawSync(input));
  expect(Buffer.from(await inflateBounded(encoded, input.length, { preallocate: true })).equals(Buffer.from(input))).toBe(true);
  await expect(inflateBounded(encoded, input.length - 1, { preallocate: true })).rejects.toThrow();
  await expect(inflateBounded(encoded, input.length + 1, { preallocate: true })).rejects.toThrow();
});

it('reopens from verified cache offline and replaces a corrupt cached field', async () => {
  const bytes = encodePreparedWater(example()), compressed = new Uint8Array(deflateRawSync(bytes));
  const reference = { identity, url: 'courses/test/prepared/water.bin', bytes: compressed.length,
    decodedBytes: bytes.length, sha256: await sha256Hex(compressed), decodedSha256: await sha256Hex(bytes) };
  const cache = new MemoryByteCache(), baseUrl = 'https://example.test/';
  let requests = 0, offline = false;
  const load = () => loadPreparedWater({ identity, reference, baseUrl, cache,
    fetchImpl: async () => { requests++; if (offline) throw new Error('offline'); return new Response(compressed); } });
  expect(await load()).not.toBeNull();
  offline = true;
  expect(await load()).not.toBeNull();
  expect(requests).toBe(1);
  await cache.put(new URL(reference.url, baseUrl).href, new Uint8Array([1, 2, 3]));
  expect(await load()).toBeNull();
  offline = false;
  expect(await load()).not.toBeNull();
  expect(requests).toBe(3);
});
