import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { sourceWaterPolygon, buildLidingoWaterBatches, loadLidingoEnvironmentWater, LIDINGO_ENVIRONMENT_WATER,
  collectSeamVertices, buildSourceWaterCoverage, sourceWaterLevel } from './lidingo-environment-water.mjs';

const ring = (x0, z0, x1, z1) => [[x0, z0, 2], [x1, z0, 3], [x1, z1, 4], [x0, z1, 3], [x0, z0, 2]];
const feature = { id: 'test', geometry: { type: 'Polygon', coordinates: [ring(0, 0, 10, 10), ring(3, 3, 7, 7)] } };
const source = fs.readFileSync(new URL(`../../public/${LIDINGO_ENVIRONMENT_WATER.url}`, import.meta.url));
const collection = JSON.parse(source);

it('ships the exact retained source bytes across checkout line endings', async () => {
  const acquired = fs.readFileSync(new URL('../../../../geo_data/course-v2/lidingo/acquisition/environment-water.geojson', import.meta.url));
  expect(source.equals(acquired)).toBe(true);
  expect(source.byteLength).toBe(LIDINGO_ENVIRONMENT_WATER.bytes);
  expect(createHash('sha256').update(source).digest('hex')).toBe(LIDINGO_ENVIRONMENT_WATER.sha256);
  const crlf = Buffer.from(source.toString('utf8').replace(/\n/g, '\r\n'));
  await expect(loadLidingoEnvironmentWater({ baseUrl: 'https://example.test/', fetchFn: async () =>
    ({ ok: true, arrayBuffer: async () => Uint8Array.from(crlf).buffer }) })).rejects.toThrow(/size differs/);
});

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

/* The Lantmäteriet items are 10 km squares and every polygon is clipped to its
   own, so the sea is four polygons abutting along E 680000 and the two
   northing lines; the course window is a fifth cut, along which the pack's
   own sea rings meet these polygons. Two triangulations that meet along a
   straight line with different vertices leave a hairline through which the
   ground (or the sky, once the plate under the sea is masked) shows. */
it('welds a seam edge with its neighbour\'s vertices and with the course window\'s', () => {
  const west = { id: 'w', properties: { sourceItemId: '658_67' }, geometry: { type: 'Polygon', coordinates: [[
    [679000, 6585000, 0.1], [680000, 6585000, 0.1], [680000, 6586000, 0.1], [679000, 6586000, 0.1], [679000, 6585000, 0.1]]] } };
  const east = { id: 'e', properties: { sourceItemId: '658_68' }, geometry: { type: 'Polygon', coordinates: [[
    [680000, 6585000, 0.1], [681000, 6585000, 0.1], [681000, 6585400, 0.1], [681000, 6586000, 0.1],
    [680000, 6586000, 0.1], [680000, 6585600, 0.1], [680000, 6585300, 0.1], [680000, 6585000, 0.1]]] } };
  const seams = collectSeamVertices({ features: [west, east] }, [{ axis: 'N', value: 6585000, points: [[679500, 0.1], [680500, 0.1]] }]);
  /* unique and sorted: the shared corners and a ring's closing copy are one point each */
  expect(seams.get('E:680000').map(p => p[0])).toEqual([6585000, 6585300, 6585600, 6586000]);
  expect(seams.get('N:6585000').map(p => p[0])).toEqual([679000, 679500, 680000, 680500, 681000]);
  const origin = { originEasting: 680000, originNorthing: 6586000 };
  const mesh = sourceWaterPolygon(west, origin, seams);
  const onSeam = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    if (mesh.positions[i] === 0) onSeam.push(-mesh.positions[i + 2] + 6586000);
    if (mesh.positions[i + 2] === 1000) onSeam.push(mesh.positions[i] + 680000);
  }
  /* the west polygon's seam edge took up 6585300 and 6585600 from the east one,
     and its window edge (N 6585000) took up 679500 -- but not 680500, which
     lies beyond its own edge */
  expect(onSeam).toEqual(expect.arrayContaining([6585300, 6585600, 679500]));
  expect(onSeam).not.toContain(680500);
  expect(mesh.positions.filter((_, i) => i % 3 === 1).every(h => h === 0.1)).toBe(true);
  /* the outline is unchanged: collinear points add no area */
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = mesh.indices.slice(i, i + 3).map(k => mesh.positions.slice(k * 3, k * 3 + 3));
    area += ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])) / 2;
  }
  expect(area).toBe(1e6);
});

it('welds the real item seams so the batches meet vertex for vertex', async () => {
  const batches = await buildLidingoWaterBatches(collection);
  const origin = LIDINGO_ENVIRONMENT_WATER;
  for (const seam of [['E', 680000], ['E', 670000], ['N', 6590000], ['N', 6580000]]) {
    const sides = new Map();
    for (const b of batches) {
      const set = new Set();
      for (let i = 0; i < b.positions.length; i += 3) {
        const e = b.positions[i] + origin.originEasting, n = origin.originNorthing - b.positions[i + 2];
        const on = seam[0] === 'E' ? Math.abs(e - seam[1]) < 1e-6 : Math.abs(n - seam[1]) < 1e-6;
        if (on) set.add((seam[0] === 'E' ? n : e).toFixed(3));
      }
      if (set.size) sides.set(b.sourceItemId, set);
    }
    expect(sides.size).toBeGreaterThanOrEqual(2);
    /* every seam vertex one item places inside a neighbour's extent along the
       line stands in that neighbour's geometry too -- no T-junction survives */
    let checked = 0;
    for (const [item, set] of sides) for (const [other, otherSet] of sides) {
      if (item === other) continue;
      const values = [...otherSet].map(Number), lo = Math.min(...values), hi = Math.max(...values);
      for (const v of set) {
        const along = Number(v);
        if (along <= lo || along >= hi) continue;
        checked++;
        expect(otherSet.has(v)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
  }
});

it('rasters the sea polygons as terrain coverage with a full cell of shore margin and no island', () => {
  const square = (e0, n0, e1, n1, h) => [[e0, n0, h], [e1, n0, h], [e1, n1, h], [e0, n1, h], [e0, n0, h]];
  const sea = { id: 's', properties: { sourceItemId: '658_67', heightRH2000: 0.1 }, geometry: { type: 'Polygon',
    coordinates: [square(0, 0, 160, 160, 0.1), square(64, 64, 96, 96, 0.1)] } };
  const lake = { id: 'l', properties: { sourceItemId: '658_67', heightRH2000: 14.05 }, geometry: { type: 'Polygon',
    coordinates: [square(200, 200, 260, 260, 14.05)] } };
  const collection = { features: [sea, lake] };
  const field = buildSourceWaterCoverage(collection, { origin: { originEasting: 0, originNorthing: 0 },
    bounds: { x0: -32, x1: 288, z0: -288, z1: 32 }, spacing: 16, bodies: [{ ring: [[-16, -16], [16, -16], [16, 16], [-16, 16]], level: 0.1 }] });
  expect(field.width).toBe(20); expect(field.height).toBe(20);
  expect(field.polygons).toBe(2);                    /* the sea and the pack's ring; the 14 m lake is not the sea */
  expect(sourceWaterLevel(lake)).toBe(14.05);
  expect(field.maximumCoveredTerrainHeight).toBeCloseTo(0.25, 6);
  /* open sea, a cell in from every shore: covered */
  expect(field.isSeaAt(40, -40)).toBe(true); expect(field.isCoveredAt(40, -40)).toBe(true);
  /* the shore cell itself is sea but not covered; the island and the lake are neither */
  expect(field.isSeaAt(8, -8)).toBe(true); expect(field.isCoveredAt(8, -8)).toBe(false);
  expect(field.isSeaAt(80, -80)).toBe(false); expect(field.isCoveredAt(72, -72)).toBe(false);
  expect(field.isSeaAt(230, -230)).toBe(false);
  expect(field.cells).toBeGreaterThan(0);
  expect([...field.terrainCoverage].reduce((n, v) => n + v, 0)).toBe(field.cells);
  expect(() => buildSourceWaterCoverage(collection, { bounds: { x0: 0, x1: 0, z0: 0, z1: 1 } })).toThrow(/bounds/);
});
