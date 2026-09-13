import fs from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { roadSurface, parkingSurface, splitRoadCoverage } from './road-surface.mjs';
import { buildGroundSurfaceFeatures, mappedLineHalfWidth } from './surface-features.mjs';
import { SURFACE } from './surface.js';

const source = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const start = source.indexOf('  function addRoad(');
const addRoadSource = source.slice(start, source.indexOf('\n  for (const road of M.infra.roads)', start));
const createRoads = (painted = () => true) => {
  const asphaltRuns = [], gravelRuns = [], dirtRuns = [], paintRuns = [], proofs = [];
  const add = new Function('roadSurface', 'splitRoadCoverage', 'SURFACE', 'mappedLineHalfWidth', 'C', 'painted',
    'asphaltRuns', 'gravelRuns', 'dirtRuns', 'paintRuns', 'ROAD_RENDER_PROOFS', `${addRoadSource}; return addRoad;`)(
    roadSurface, splitRoadCoverage, SURFACE, mappedLineHalfWidth,
    { aspT: [.1, .1, .1], aspL: [.12, .12, .12], gravel: [.3, .3, .3], soil: [.2, .15, .1] },
    painted, asphaltRuns, gravelRuns, dirtRuns, paintRuns, proofs);
  return { add, asphaltRuns, gravelRuns, dirtRuns, paintRuns, proofs };
};

describe('road surface ownership', () => {
  it('keeps untagged local roads generic grey, with asphalt reserved for tagged or major roads', () => {
    for (const kind of ['residential', 'unclassified', 'service', 'track', 'path', 'footway']) {
      expect(roadSurface({ kind })).toBe(SURFACE.GRAVEL);
    }
    expect(roadSurface({ kind: 'trunk' })).toBe(SURFACE.ASPHALT);
    expect(roadSurface({ kind: 'path', surface: 'asphalt' })).toBe(SURFACE.ASPHALT);
    expect(roadSurface({ kind: 'tertiary', surface: 'compacted' })).toBe(SURFACE.GRAVEL);
    expect(roadSurface({ kind: 'trunk', surface: 'unpaved' })).toBe(SURFACE.GRAVEL);
    expect(roadSurface({ kind: 'cycleway', surface: 'ground' })).toBe(SURFACE.DIRT);
  });

  it('renders no opaque ribbon over a road already painted into the ground', () => {
    const roads = createRoads(), line = [[0, 0], [100, 0]];
    roads.add({ line, kind: 'residential' });
    roads.add({ line, kind: 'path', surface: 'asphalt' }, 'paths');
    roads.add({ line, kind: 'track', surface: 'ground' }, 'tracks');
    roads.add({ line, kind: 'trunk', surface: 'asphalt', lanes: 2 });
    expect(roads.asphaltRuns).toEqual([]);
    expect(roads.gravelRuns).toEqual([]);
    expect(roads.dirtRuns).toEqual([]);
    expect(roads.paintRuns).toHaveLength(1);
    expect(roads.paintRuns[0].paint).toBe(2);
  });

  it('drapes fallback road surfaces and honors explicit materials on every class', () => {
    const roads = createRoads(() => false), line = [[0, 0], [100, 0]];
    roads.add({ line, kind: 'residential' });
    roads.add({ line, kind: 'trunk', surface: 'unpaved' });
    roads.add({ line, kind: 'path', surface: 'dirt' }, 'paths');
    roads.add({ line, kind: 'secondary' });
    expect(roads.gravelRuns).toHaveLength(2);
    expect(roads.dirtRuns).toHaveLength(1);
    expect(roads.asphaltRuns).toHaveLength(1);
    expect(roads.paintRuns).toEqual([]);
    for (const run of [...roads.gravelRuns, ...roads.dirtRuns, ...roads.asphaltRuns]) expect(run.drape).toBe(true);
  });

  it('clips a sparse road that crosses the whole atlas without a vertex inside it', () => {
    const result = splitRoadCoverage([[-100, 0], [100, 0]], x => x >= -20 && x <= 20);
    expect(result.covered).toHaveLength(1);
    expect(result.uncovered).toHaveLength(2);
    expect(result.covered[0][0][0]).toBeCloseTo(-20, 2);
    expect(result.covered[0].at(-1)[0]).toBeCloseTo(20, 2);
    expect(result.uncovered[0].at(-1)).toEqual(result.covered[0][0]);
    expect(result.uncovered[1][0]).toEqual(result.covered[0].at(-1));
  });

  it('preserves coarse source lines outside coverage for the distant road renderer', () => {
    const line = [[0, 0], [1000, 0], [1000, 1000]];
    expect(splitRoadCoverage(line, () => false).uncovered).toEqual([line]);
    expect(splitRoadCoverage(line, () => true).covered).toEqual([line]);
  });
});

const publicRoot = new URL('../../public/', import.meta.url);
const courses = JSON.parse(fs.readFileSync(new URL('courses/index.json', publicRoot), 'utf8')).courses;
describe('road policy across all shipped courses', () => {
  it.each(courses.map(c => [c.slug, c.packUrl]))('%s uses the same materials in terrain and fallback ribbons', (slug, url) => {
    const pack = fs.readFileSync(new URL(url, publicRoot));
    const bytes = pack.readUInt32LE(4), header = JSON.parse(pack.subarray(8, 8 + bytes));
    const offset = 8 + bytes + header.HF0.bytes + header.HF1.bytes;
    const model = JSON.parse(inflateRawSync(pack.subarray(offset, offset + header.VEC.bytes)));
    expect(header.slug).toBe(slug);
    const roads = createRoads(() => false);
    let count = 0;
    for (const group of ['roads', 'paths', 'tracks']) for (const item of model.infra[group] || []) {
      const features = buildGroundSurfaceFeatures({ model: { infra: { [group]: [item] } } });
      if (item.tunnel || item.line.length < 2) continue;
      roads.add(item, group);
      expect(roads.proofs.at(-1).surface).toBe(features[0].surface);
      count++;
    }
    expect(count).toBeGreaterThan(0);
    for (const lot of model.infra.parking || []) {
      if (lot.ring?.length < 3) continue;
      const features = buildGroundSurfaceFeatures({ model: { infra: { parking: [lot] } } });
      expect(parkingSurface(lot), `${slug} parking ${lot.id}`).toBe(features[0].surface);
    }
  });
});
