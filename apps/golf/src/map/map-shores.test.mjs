/* Each lake out to its ground's own shore on the map, as the simulator draws it
   (map-shores.mjs, tools/map-shores-bake.mjs). */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { legacyGridBridge } from '../engine/geodetic-frame.mjs';
import {
  bakeShores, nearPlay, packShores, reachableInSimulator, shoreMasks, shoreRuleHash, SHORE_BANK_METRES,
  SIMULATOR_LEVEL, simulatorLevel,
} from '../../../../tools/map-shores-bake.mjs';
import { buildMapCourse } from './map-course.mjs';
import { landRecord } from './map-land.mjs';
import { drawShores, shoreSprite, shoreSprites } from './map-shores.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const PUBLIC = path.resolve(HERE, '../../public');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(PUBLIC, relative), 'utf8'));
const packs = readJson('courses/index.json').courses;
const index = readJson('courses/v2-index.json').courses;
const MAIN = fs.readFileSync(path.join(HERE, '../main.js'), 'utf8');

function packFor(meta) {
  const bytes = fs.readFileSync(path.join(PUBLIC, meta.packUrl));
  const headerBytes = bytes.readUInt32LE(4);
  const header = JSON.parse(bytes.subarray(8, 8 + headerBytes).toString('utf8'));
  const start = 8 + headerBytes + header.HF0.bytes + header.HF1.bytes;
  return { header, vectors: JSON.parse(zlib.inflateRawSync(bytes.subarray(start, start + header.VEC.bytes)).toString('utf8')) };
}
function courseFor(slug) {
  const meta = packs.find(entry => entry.slug === slug);
  const entry = index.find(item => item.slug === slug);
  const course = readJson(entry.manifest.url);
  const ground = readJson(course.groundManifest.url);
  const { header, vectors } = packFor(meta);
  return { course: buildMapCourse({ meta, geo: header.GEO, vectors, ground, course }), vectors };
}
const lakesOf = record => readJson(record.shores.lakes.file);

/* A level basin 120 m across round a 100 m square lake, rising 1 m in every 10 m
   beyond it: the water runs 10 m past the ring on every side and stops at the rise. */
const basin = (x, z) => 10 + Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - 60) / 10;
const square = half => [[-half, -half], [half, -half], [half, half], [-half, half]];

describe('the simulator\'s rules, copied for the bake', () => {
  it('keeps main.js\'s level rule, its reachable lakes and its surface', () => {
    const numbers = MAIN.match(/const COVERAGE = ([\d.]+), PERCENTILE = ([\d.]+), MIN_POINTS = (\d+), CLEARANCE = ([\d.]+);/);
    expect(numbers, 'main.js re-measures its lakes as it did').toBeTruthy();
    expect(numbers.slice(1).map(Number)).toEqual([SIMULATOR_LEVEL.coverage, SIMULATOR_LEVEL.percentile, SIMULATOR_LEVEL.minimumPoints, SIMULATOR_LEVEL.clearanceMetres]);
    expect(MAIN).toContain('Math.round((heights[Math.floor(heights.length * PERCENTILE)] + CLEARANCE) * 100) / 100');
    expect(MAIN).toContain('heights.length >= w.ring.length * COVERAGE');
    expect(MAIN).toContain('const plate = PLATE_LEVELS ? laserPlateLevel(w.ring, groundProbe) : null;');
    expect(MAIN).toContain(`const reachableWater = w => WATER_REACH_ON && !w.stream && w.ring?.length >= 3 && !w.isSea && !w.shoreline
  && !(w.artificialCutEdgeCount > 0) && !w.surr && !w.exactShore && M.infra.terrainPlacement !== 'measured-only';`);
    expect(MAIN).toContain('const surface = w.levelEvidence?.shoreMetres ?? w.levelEvidence?.surfaceMetres ?? laserPlateLevel(w.ring, height)?.surfaceMetres ?? NaN;');
    /* the one level rule comes first, and the bake reads the same */
    expect(MAIN).toContain('const shore = SHORE_LEVELS ? shoreLevel({ ring: w.ring, heightAt: groundProbe, near: (x, z) => near([x, z]) }) : null;');
    expect(MAIN).toContain('near = p => p[0] > x0 - 180 && p[0] < x1 + 180 && p[1] > z0 - 180 && p[1] < z1 + 180;');
  });

  it('reaches what the simulator reaches', () => {
    const lake = { ring: square(10), level: 1 };
    expect(reachableInSimulator(lake, {})).toBe(true);
    for (const flag of ['stream', 'isSea', 'shoreline', 'surr', 'exactShore']) expect(reachableInSimulator({ ...lake, [flag]: true }, {})).toBe(false);
    expect(reachableInSimulator({ ...lake, artificialCutEdgeCount: 2 }, {})).toBe(false);
    expect(reachableInSimulator({ ...lake, ring: [[0, 0], [1, 1]] }, {})).toBe(false);
    expect(reachableInSimulator(lake, { terrainPlacement: 'measured-only' })).toBe(false);
  });

  it('levels a lake by its ring\'s ground, or by its laser plate', () => {
    const ring = square(50);
    /* every ring point on the ground: the percentile, plus the quarter metre */
    expect(simulatorLevel({ ring, level: 3, probe: () => 10 })).toEqual({ level: 10.25, evidence: null });
    /* too few on the ground: never lowered */
    expect(simulatorLevel({ ring, level: 12, probe: (x, z) => (x < 0 && z < 0 ? 10 : NaN) }).level).toBe(12);
    /* a plate course reads the flat inside */
    const plate = simulatorLevel({ ring, level: 3, probe: basin, plate: true });
    expect(plate.level).toBe(10.06);
    expect(plate.evidence.surfaceMetres).toBe(10);
  });
});

describe('a lake read to its shore', () => {
  const ring = square(50);
  const layout = { slug: 'test', geo: null, vectors: { holes: [{ line: [[0, 0], [10, 0]] }], water: [{ ring, level: 10.4 }] } };

  it('runs over the flat to the rise, with the bank beside it', () => {
    const [lake] = bakeShores({ layouts: [layout], probe: basin });
    /* the one level rule: a large flat lake stands at its laser surface plus the display clearance */
    expect(lake).toMatchObject({ layouts: ['test'], points: 4, first: [-50, -50], level: 10.06, surface: 10, cell: 1.5 });
    const at = (x, z, mask) => mask[Math.round((z - lake.z0) / lake.cell) * lake.cols + Math.round((x - lake.x0) / lake.cell)];
    expect(at(0, 0, lake.wet)).toBe(1);
    expect(at(58, 0, lake.wet), '8 m past the ring is still the basin').toBe(1);
    expect(at(64, 0, lake.wet), '4 m up the rise is not').toBe(0);
    expect(at(64, 0, lake.bank)).toBe(1);
    expect(at(0, 0, lake.bank)).toBe(0);
    /* the bank goes no further than its reach, and the picture is cut close round it */
    let farthest = 0;
    for (let r = 0; r < lake.rows; r++) for (let c = 0; c < lake.cols; c++) {
      if (lake.bank[r * lake.cols + c]) farthest = Math.max(farthest, Math.abs(lake.x0 + c * lake.cell), Math.abs(lake.z0 + r * lake.cell));
    }
    expect(farthest).toBeGreaterThan(60 + SHORE_BANK_METRES - 2);
    expect(farthest).toBeLessThanOrEqual(60 + SHORE_BANK_METRES + lake.cell);
    expect(lake.x0).toBeGreaterThan(-(60 + SHORE_BANK_METRES + 3 * lake.cell));
    expect(lake.outsideWetSquareMetres).toBeGreaterThan(120 * 120 - 100 * 100 - 600);
  });

  it('leaves a measured-only ground and a reviewed pond alone, and keeps one copy for two layouts', () => {
    expect(bakeShores({ layouts: [{ ...layout, vectors: { ...layout.vectors, infra: { terrainPlacement: 'measured-only' } } }], probe: basin })).toEqual([]);
    const review = { reviewedWaterLevel: () => ({ level: 10 }) };
    expect(bakeShores({ layouts: [{ ...layout, review }], probe: basin })).toEqual([]);
    const twice = bakeShores({ layouts: [layout, { ...layout, slug: 'other' }], probe: basin });
    expect(twice.length).toBe(1);
    expect(twice[0].layouts).toEqual(['test', 'other']);
  });

  it('a near lake is read finer than a far one', () => {
    const far = { ...layout, vectors: { ...layout.vectors, holes: [{ line: [[2000, 2000], [2100, 2000]] }] } };
    expect(nearPlay(far.vectors.holes)(0, 0)).toBe(false);
    expect(bakeShores({ layouts: [far], probe: basin })[0].cell).toBe(5);
  });

  it('cuts nothing from a reach with no water', () => {
    const reach = { cols: 3, rows: 3, cell: 1, x0: 0, z0: 0, wet: new Uint8Array(9), kind: new Uint8Array(9) };
    expect(shoreMasks(reach)).toBeNull();
  });

  it('lays every picture on one sheet, apart', () => {
    const lakes = bakeShores({ layouts: [layout], probe: basin });
    const sheet = packShores([...lakes, { ...lakes[0], first: [0, 0] }]);
    const boxes = sheet.lakes.flatMap((lake, k) => ['wet', 'bank'].map(which => ({ k, which, u: lake[which][0], v: lake[which][1], w: lake.cols, h: lake.rows })));
    for (const a of boxes) {
      expect(a.u + a.w).toBeLessThanOrEqual(sheet.width);
      expect(a.v + a.h).toBeLessThanOrEqual(sheet.height);
      for (const b of boxes) {
        if (a === b) continue;
        const apart = a.u + a.w + 2 <= b.u || b.u + b.w + 2 <= a.u || a.v + a.h + 2 <= b.v || b.v + b.h + 2 <= a.v;
        expect(apart).toBe(true);
      }
    }
    const { wet: [u, v], cols } = sheet.lakes[0];
    expect(sheet.values[(v + Math.round(lakes[0].rows / 2)) * sheet.width + u + Math.round(cols / 2)]).toBe(1);
    /* the record keeps the places, not the pixels */
    expect(sheet.lakes[0].wet).toHaveLength(2);
    expect(sheet.lakes[0].wet).not.toEqual(sheet.lakes[0].bank);
  });
});

describe('painting a lake to its shore', () => {
  it('places a lake\'s lattice through its frame, node on node', () => {
    const bridge = legacyGridBridge({ latitude: 63.3, longitude: 18.9, metresPerLatitude: 111320, metresPerLongitude: 50019.58 });
    const frame = { toWorld: (x, z) => { const [gx, gz] = bridge.toGrid(x, z); return [gx - 70, gz + 170]; } };
    const lake = { x0: -178, z0: -107.3, cell: 1.5, cols: 271, rows: 490, wet: [2, 676], bank: [277, 676] };
    const sprite = shoreSprite(lake, frame);
    const [a, b, c, d, e, f] = sprite.matrix;
    for (const [col, row] of [[0, 0], [270, 0], [0, 489], [135, 240]]) {
      const [x, z] = frame.toWorld(lake.x0 + col * lake.cell, lake.z0 + row * lake.cell);
      expect(a * col + c * row + e).toBeCloseTo(x, 6);
      expect(b * col + d * row + f).toBeCloseTo(z, 6);
      expect(x).toBeGreaterThan(sprite.x0);
      expect(x).toBeLessThan(sprite.x1);
      expect(z).toBeGreaterThan(sprite.z0);
      expect(z).toBeLessThan(sprite.z1);
    }
    expect(sprite).toMatchObject({ wet: [2, 676], bank: [277, 676], cols: 271, rows: 490 });
  });

  it('takes every bank off before any lake\'s water goes on', () => {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, ...args])),
      set: (target, key, value) => { if (key === 'globalCompositeOperation') calls.push(['mode', value]); return true; },
    });
    const sprites = [{ wet: [1, 2], bank: [3, 4], cols: 5, rows: 6, matrix: [1, 0, 0, 1, 0, 0] }, { wet: [7, 8], bank: [9, 10], cols: 2, rows: 3, matrix: [1, 0, 0, 1, 0, 0] }];
    drawShores(ctx, 'sheet', sprites);
    const order = calls.filter(([key]) => key === 'mode' || key === 'drawImage').map(([key, ...args]) => (key === 'mode' ? args[0] : `${args[1]},${args[2]}`));
    expect(order).toEqual(['destination-out', '3,4', '9,10', 'source-over', '1,2', '7,8']);
    expect(calls.find(([key]) => key === 'drawImage')).toEqual(['drawImage', 'sheet', 3, 4, 5, 6, -0.5, -0.5, 5, 6]);
  });
});

describe('the shores as published', () => {
  const grounds = [...new Set(index.map(entry => entry.groundId))];

  it('were read from the ground, packs and rules as they stand', () => {
    const rules = shoreRuleHash(ROOT);
    for (const groundId of grounds) {
      const record = landRecord(groundId);
      const slugs = index.filter(entry => entry.groundId === groundId).map(entry => entry.slug);
      const measuredOnly = slugs.every(slug => packFor(packs.find(meta => meta.slug === slug)).vectors.infra?.terrainPlacement === 'measured-only');
      if (measuredOnly) { expect(record.shores, `${groundId} reaches no lake`).toBeUndefined(); continue; }
      expect(record.shores, `${groundId}: rerun tools/bake-map-land.mjs`).toBeTruthy();
      expect(record.shores.rules, `${groundId}: the reach's rules changed, rerun tools/bake-map-land.mjs`).toBe(rules);
      for (const slug of slugs) {
        expect(record.shores.packs[slug], `${slug}: its pack was republished, rerun tools/bake-map-land.mjs`).toBe(packs.find(meta => meta.slug === slug).sha256);
      }
      for (const file of [record.shores.picture, record.shores.lakes]) {
        const bytes = fs.readFileSync(path.join(PUBLIC, file.file));
        expect(bytes.length).toBe(file.bytes);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
        expect(bytes.length, 'small enough for a phone').toBeLessThan(64 * 1024);
      }
    }
  });

  it('match a body of each layout they were read for, and only those', () => {
    for (const { slug, groundId } of index) {
      const record = landRecord(groundId);
      if (!record.shores) continue;
      const lakes = lakesOf(record);
      const { course } = courseFor(slug);
      const matched = shoreSprites(course, lakes);
      expect(matched.length, slug).toBe(lakes.filter(lake => lake.layouts.includes(slug)).length);
      expect(matched.every(({ item }) => item.shoreKey && !item.sea)).toBe(true);
    }
  });

  it('draws Puttom\'s Stor-Rössjön within a decimetre of its laser surface, past its traced outline', () => {
    const lakes = lakesOf(landRecord('puttom'));
    /* the one level rule (water-level.mjs): a large flat lake's shore within 0.1 m of the laser's 62.73 m */
    const stor = lakes.find(lake => lake.surface >= 62.73 - 1e-9 && lake.surface <= 62.83 + 1e-9 && lake.cell === 1.5);
    expect(stor, 'puttombuild/laser-features.json: Stor-Rössjön 62.73 m').toBeTruthy();
    expect(stor.level).toBeCloseTo(stor.surface + 0.06, 1);
    expect(stor.cell, 'beside the course, on the fine lattice').toBe(1.5);
    expect(stor.outsideWetSquareMetres).toBeGreaterThan(3000);
  });
});
