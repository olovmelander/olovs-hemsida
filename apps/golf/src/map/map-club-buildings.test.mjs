/* The clubs' own buildings on the map (map-club-buildings.mjs, baked by
   tools/bake-map-buildings.mjs). */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cutCorner, raiseClubBuilding, replacedBy } from './map-club-buildings.mjs';
import { HOUSE_FLOATS } from './map-houses.mjs';

const PUBLIC = path.resolve(__dirname, '../../public');
const read = file => fs.readFileSync(path.join(PUBLIC, file));
const base64 = (Type, values) => Buffer.from(new Type(values).buffer).toString('base64');

/* A 4 x 2 m block of 1 m cells, 5 m high, with a 9 m tower in its first cell. */
function block({ heights = [900, 500, 500, 500, 500, 500, 500, 500], angle = 0 } = {}) {
  return {
    id: 'test', origin: [10, 20], angle, cell: 1, cols: 4, rows: 2,
    wall: [200, 50, 40], palette: [[60, 60, 70]],
    heights: base64(Uint16Array, heights), colours: base64(Uint8Array, heights.map(() => 0)),
    feet: [[10, 20], [14, 20], [14, 22], [10, 22], [12, 21]],
  };
}
const vertices = mesh => Array.from({ length: mesh.length / HOUSE_FLOATS }, (_, i) => mesh.subarray(i * HOUSE_FLOATS, (i + 1) * HOUSE_FLOATS));

describe('raiseClubBuilding', () => {
  it('stands the block on its lowest corner, with its roof and tower at their heights', () => {
    const mesh = raiseClubBuilding(block(), (x, z) => (x > 12 ? 3 : 2));
    const points = vertices(mesh);
    expect(points.length % 3).toBe(0);
    expect(points.every(p => p.every(Number.isFinite))).toBe(true);
    expect(new Set(points.map(p => p[3]))).toEqual(new Set([2]));
    expect(Math.max(...points.map(p => p[1]))).toBeCloseTo(9, 5);
    /* the roof away from the tower stays at 5 m: the tower is a step, not a slope */
    const roof = points.filter(p => p[5] > 0.99 && p[0] > 12.5);
    expect(roof.length).toBeGreaterThan(0);
    expect(roof.every(p => Math.abs(p[1] - 5) < 1e-5)).toBe(true);
    /* walls stand straight and wear the wall colour */
    const walls = points.filter(p => Math.abs(p[5]) < 1e-6);
    expect(walls.length).toBeGreaterThan(0);
    expect(walls.every(p => Math.abs(p[7] - 200 / 255) < 1e-6)).toBe(true);
  });

  it('turns with its own axes', () => {
    const points = vertices(raiseClubBuilding(block({ angle: Math.PI / 2 }), () => 0));
    const xs = points.map(p => p[0]), zs = points.map(p => p[2]);
    expect(Math.min(...xs)).toBeCloseTo(8, 5);
    expect(Math.max(...zs)).toBeCloseTo(24, 5);
  });

  it('stands nowhere without ground', () => {
    expect(raiseClubBuilding(block(), () => NaN)).toHaveLength(0);
  });
});

describe('cutCorner', () => {
  const grid = rows => (col, row) => rows[row]?.[col] === '#';
  it('cuts the stair of a diagonal outline, never a square corner', () => {
    const stair = grid(['..#', '.##', '###']);
    expect(cutCorner(stair, 1, 1)).toBe(0);
    expect(cutCorner(stair, 0, 2)).toBe(-1);
    const square = grid(['##', '##']);
    for (const [col, row] of [[0, 0], [1, 0], [1, 1], [0, 1]]) expect(cutCorner(square, col, row)).toBe(-1);
  });
});

describe('replacedBy', () => {
  it('finds the footprints a club building stands for, by id or by place', () => {
    const replaced = replacedBy({ ids: ['w1'], rings: [[5, 5]] });
    expect(replaced({ id: 'w1', ring: [[100, 100], [101, 100], [101, 101]] })).toBe(true);
    expect(replaced({ id: 'w2', ring: [[4, 4], [6, 4], [6, 6], [4, 6]] })).toBe(true);
    expect(replaced({ id: 'w2', ring: [[40, 40], [42, 40], [42, 42]] })).toBe(false);
    expect(replacedBy(null)({ id: 'w1', ring: [[0, 0], [1, 0], [1, 1]] })).toBe(false);
  });
});

describe('the baked records', () => {
  const index = JSON.parse(read('models/map-buildings.json'));
  const v2 = JSON.parse(read('courses/v2-index.json')).courses;

  it('are read from the buildings the detailed course draws, as they are now', () => {
    for (const [ground, entry] of Object.entries(index.grounds)) {
      const bytes = read(entry.file);
      expect(createHash('sha256').update(bytes).digest('hex'), `${ground}: rerun tools/bake-map-buildings.mjs`).toBe(entry.sha256);
      for (const source of entry.sources) {
        const now = createHash('sha256').update(fs.readFileSync(path.resolve(PUBLIC, '../../..', source.path))).digest('hex');
        expect(now, `${ground}: ${source.path} changed; rerun tools/bake-map-buildings.mjs`).toBe(source.sha256);
      }
      const record = JSON.parse(bytes);
      const layout = v2.find(course => course.groundId === ground);
      const groundFile = JSON.parse(read(JSON.parse(read(layout.manifest.url)).groundManifest.url));
      expect(record.frame, `${ground}: baked against another frame`).toBe(groundFile.frame.fingerprint);
      expect(record.buildings.length).toBe(entry.buildings);
    }
  });

  it('cover every ground whose club buildings are modelled', () => {
    const modelled = fs.readdirSync(path.join(PUBLIC, 'models'))
      .filter(name => fs.existsSync(path.join(PUBLIC, 'models', name, 'facilities-v1.json')));
    for (const ground of [...modelled, 'tortuna', 'upsala', 'norrfallsviken']) expect(index.grounds[ground], ground).toBeTruthy();
  });

  it('raise every building into finite walls and roofs', () => {
    for (const entry of Object.values(index.grounds)) {
      for (const building of JSON.parse(read(entry.file)).buildings) {
        const mesh = raiseClubBuilding(building, () => 0);
        expect(mesh.length, building.id).toBeGreaterThan(0);
        expect(mesh.every(Number.isFinite), building.id).toBe(true);
      }
    }
  });
});
