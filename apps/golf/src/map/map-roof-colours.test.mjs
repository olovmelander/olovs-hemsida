/* The map's houses look as the detailed course's do: the same measured roofs, tied to
   their footprints the same way, and the same foot on their walls. The map restates the
   house kit's and the building paint's rules because those modules bring three.js; this
   holds the two equal. */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { measuredRoofs, ringCheck as kitRingCheck, ROOF_EASE as KIT_EASE, roofAlbedo as kitAlbedo } from '../engine/house-kit.mjs';
import { BUILDING_PAINT, wallFootAt } from '../engine/building-paint.mjs';
import { loadRoofColours, ringCheck, roofAlbedo, roofFor, ROOF_EASE, roofTable } from './map-roof-colours.mjs';
import { HOUSE_FLOATS, MAP_WALL_FOOT, raiseHouses } from './map-houses.mjs';

const SCENERY = path.resolve(__dirname, '../engine/scenery');
const toLinear = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

describe('the measured roofs', () => {
  it('are tied to their footprints and eased exactly as the house kit does', () => {
    const rings = [[[0, 0], [10.5, 0], [10.5, 8.25], [0, 8.25]], [[-592.6, 443.5], [-594.6, 480], [-586.4, 480.4]]];
    for (const ring of rings) expect(ringCheck(ring)).toBe(kitRingCheck(ring));
    expect(ROOF_EASE).toEqual(KIT_EASE);
    for (const rgb of [[0.02, 0.03, 0.04], [0.2, 0.1, 0.08], [0.5, 0.48, 0.45], [0.9, 0.85, 0.8]]) {
      roofAlbedo(rgb).forEach((v, i) => expect(v).toBeCloseTo(kitAlbedo(rgb)[i], 12));
    }
  });

  it('read every ground\'s record to the colour the detailed course draws, in display terms', async () => {
    const files = fs.readdirSync(SCENERY).filter(name => name.endsWith('-roof-colours.json'));
    expect(files.length).toBeGreaterThanOrEqual(12);
    for (const name of files) {
      const record = JSON.parse(fs.readFileSync(path.join(SCENERY, name), 'utf8'));
      const kit = measuredRoofs(record), map = roofTable(record);
      expect(map.size, name).toBe(kit.size);
      for (const [index, { check, roof }] of kit) {
        expect(map.get(index).check).toBe(check);
        map.get(index).roof.forEach((v, i) => expect(toLinear(v)).toBeCloseTo(Math.min(1, roof[i]), 6));
      }
      const loaded = await loadRoofColours(name.replace('-roof-colours.json', ''));
      expect(loaded.size, `${name} through the map's loader`).toBe(kit.size);
    }
  });

  it('colour a house only while its footprint is the one the colour was read from', () => {
    const ring = [[0, 0], [10, 0], [10, 8], [0, 8]];
    const table = new Map([[3, { check: ringCheck(ring), roof: [0.5, 0.2, 0.1] }]]);
    expect(roofFor(table, { index: 3, check: ringCheck(ring) })).toEqual([0.5, 0.2, 0.1]);
    expect(roofFor(table, { index: 3, check: ringCheck([[0, 0], [10, 0], [10, 9], [0, 9]]) })).toBeNull();
    expect(roofFor(table, { index: null, check: null })).toBeNull();
    const [house] = [raiseHouses([{ ring, height: 5, roof: [0.5, 0.2, 0.1] }], () => 0)];
    const roofs = [];
    for (let i = 0; i < house.length; i += HOUSE_FLOATS) if (house[i + 5] > 0.3) roofs.push([...house.subarray(i + 7, i + 10)]);
    expect(roofs.length).toBeGreaterThan(0);
    for (const colour of roofs) colour.forEach((v, i) => expect(v).toBeCloseTo([0.5, 0.2, 0.1][i], 6));
  });
});

describe('the walls\' foot', () => {
  it('is the building paint\'s rule, for houses and for modelled buildings', () => {
    expect(MAP_WALL_FOOT.house).toEqual(BUILDING_PAINT.foot.batch);
    expect(MAP_WALL_FOOT.model).toEqual(BUILDING_PAINT.foot.model);
    expect([...MAP_WALL_FOOT.steep]).toEqual(BUILDING_PAINT.steep);
    /* the shader's reading of it, on the CPU */
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const shaderFoot = (above, normalY, { floor, metres }) =>
      1 + (floor + (1 - floor) * smooth(0, metres, above) - 1) * (1 - smooth(MAP_WALL_FOOT.steep[0], MAP_WALL_FOOT.steep[1], Math.abs(normalY)));
    for (const rule of [MAP_WALL_FOOT.house, MAP_WALL_FOOT.model]) {
      for (const [above, normalY] of [[0, 0], [0.3, 0], [2, 0], [0, 0.6], [0, 0.95]]) {
        expect(shaderFoot(above, normalY, rule)).toBeCloseTo(wallFootAt(above, normalY, rule), 12);
      }
    }
  });

  it('is read by the renderer at the house vertex\'s own stride, every attribute of it', () => {
    const gl = fs.readFileSync(path.resolve(__dirname, 'map-gl.mjs'), 'utf8');
    const layout = gl.slice(gl.indexOf('function houseVao'), gl.indexOf('return vao', gl.indexOf('function houseVao')));
    const pointers = [...layout.matchAll(/vertexAttribPointer\((\d), \d, gl\.FLOAT, false, (\w+), (\d+)\)/g)];
    expect(pointers.map(([, location]) => Number(location)).sort()).toEqual([0, 1, 2, 3, 4]);
    for (const [, location, stride] of pointers) expect(stride, `attribute ${location}`).toBe('stride');
    expect(layout).toMatch(/const stride = HOUSE_FLOATS \* 4;/);
  });

  it('is known by every vertex: 0 for a house, 1 for a club\'s own building', () => {
    const house = raiseHouses([{ ring: [[0, 0], [6, 0], [6, 6], [0, 6]], height: 4 }], () => 0);
    expect(house.length % HOUSE_FLOATS).toBe(0);
    for (let i = HOUSE_FLOATS - 1; i < house.length; i += HOUSE_FLOATS) expect(house[i]).toBe(0);
  });
});
