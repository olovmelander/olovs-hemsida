import fs from 'node:fs';
import { expect, it } from 'vitest';
import { sourceWaterPolygon, buildLidingoWaterBatches, loadLidingoEnvironmentWater, LIDINGO_ENVIRONMENT_WATER } from './lidingo-environment-water.mjs';

const ring = (x0, z0, x1, z1) => [[x0, z0, 2], [x1, z0, 3], [x1, z1, 4], [x0, z1, 3], [x0, z0, 2]];
const feature = { id: 'test', geometry: { type: 'Polygon', coordinates: [ring(0, 0, 10, 10), ring(3, 3, 7, 7)] } };
const source = fs.readFileSync(new URL(`../../public/${LIDINGO_ENVIRONMENT_WATER.url}`, import.meta.url));
const collection = JSON.parse(source);

it('keeps the island empty, preserves varying RH2000 heights and faces upward', () => {
  const before = structuredClone(feature);
  const mesh = sourceWaterPolygon(feature, { originEasting: 0, originNorthing: 0 });
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map(k => mesh.positions.slice(k*3, k*3+3));
    const up = (b[2]-a[2])*(c[0]-a[0]) - (b[0]-a[0])*(c[2]-a[2]);
    expect(up).toBeGreaterThan(0); area += up/2;
    const x = (a[0]+b[0]+c[0])/3, n = -(a[2]+b[2]+c[2])/3;
    expect(x > 3 && x < 7 && n > 3 && n < 7).toBe(false);
  }
  expect(area).toBe(84);
  expect(mesh.interiorRings).toBe(1);
  expect(mesh.positions.filter((_, i) => i%3 === 1)).toEqual([2,3,4,3,2,3,4,3]);
  expect(feature).toEqual(before);
});

it('rejects non-finite heights and unclosed source rings instead of guessing', () => {
  const bad = structuredClone(feature); bad.geometry.coordinates[0][1][2] = NaN;
  expect(() => sourceWaterPolygon(bad)).toThrow(/finite/);
  bad.geometry.coordinates = [ring(0,0,10,10).slice(0,-1)];
  expect(() => sourceWaterPolygon(bad)).toThrow(/closed/);
});

it('retains all acquired water and island rings in nine source batches', async () => {
  const batches = await buildLidingoWaterBatches(collection);
  expect(batches).toHaveLength(9);
  expect(batches.reduce((n,b) => n+b.features.length,0)).toBe(144);
  expect(batches.reduce((n,b) => n+b.interiorRings,0)).toBe(180);
  expect(batches.reduce((n,b) => n+b.positions.length/3,0)).toBe(47043);
  expect(batches.reduce((n,b) => n+b.indices.length/3,0)).toBe(47115);
});

it('loads only the checksummed public source asset and rejects corruption', async () => {
  const fetchFn = async url => {
    expect(url.href).toBe(`https://example.test/banvy/${LIDINGO_ENVIRONMENT_WATER.url}`);
    return { ok: true, arrayBuffer: async () => Uint8Array.from(source).buffer };
  };
  const data = await loadLidingoEnvironmentWater({ baseUrl: 'https://example.test/banvy/', fetchFn });
  expect(data.features).toHaveLength(144);
  const bad = Uint8Array.from(source); bad[20] ^= 1;
  await expect(loadLidingoEnvironmentWater({ baseUrl: 'https://example.test/', fetchFn: async () => ({ok:true, arrayBuffer:async()=>bad.buffer}) })).rejects.toThrow(/checksum/);
  await expect(loadLidingoEnvironmentWater({ baseUrl: 'https://example.test/', fetchFn: async () => ({ok:false,status:404}) })).rejects.toThrow(/404/);
});
