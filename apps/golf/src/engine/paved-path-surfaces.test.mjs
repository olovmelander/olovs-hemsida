import fs from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { rasterizeGroundAtlas } from './atlas.js';
import { ringSD, hyp, inRing } from './geom.js';
import { buildGroundSurfaceFeatures, mappedPathSurface } from './surface-features.mjs';
import { SURFACE } from './surface.js';

const outer = [[0, 0], [12, 0], [12, 3], [8, 3], [8, 8], [0, 8]];
const island = [[2, 2], [4, 2], [4, 4], [2, 4]];
const forest = [[-2, -2], [14, -2], [14, 10], [-2, 10]];
const feature = material => ({ id: 'survey-path', kind: 'paved_path', material, rings: [outer, island] });
const model = material => ({ infra: { preserveMappedBoundaries: true }, veg: { forest: [forest] },
  scenery: { mappedFeatures: [feature(material)] } });

describe('surveyed path polygons', () => {
  it('preserves corners and holes and overrides broad forest in the shared atlas/v2 source', () => {
    const source = model('unverified-hard-surface'), before = JSON.stringify(source);
    const features = buildGroundSurfaceFeatures({ model: source, smoothEdges: true });
    const path = features.find(f => f.sourceId === 'survey-path');
    expect(path.surface).toBe(SURFACE.GRAVEL);
    expect(path.polygons).toEqual([{ rings: [outer, island] }]);
    expect(features.indexOf(path)).toBeGreaterThan(features.findIndex(f => f.surface === SURFACE.FOREST));
    const raster = rasterizeGroundAtlas({ CORE: { x0: -2, z0: -2, x1: 14, z1: 10 }, features, res: .5, classesOnly: true });
    const sample = (x, z) => raster.classes[Math.floor((z + 2) / .5) * raster.bounds.w + Math.floor((x + 2) / .5)];
    expect(sample(1, 1)).toBe(SURFACE.GRAVEL);
    expect(sample(10, 1)).toBe(SURFACE.GRAVEL);
    expect(sample(3, 3)).toBe(SURFACE.FOREST); // explicitly excluded island
    expect(sample(10, 5)).toBe(SURFACE.FOREST); // concave exterior notch
    expect(sample(-1, 1)).toBe(SURFACE.FOREST);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('requires explicit asphalt evidence and leaves the unknown material unclassified in its source', () => {
    expect(mappedPathSurface(feature('asphalt'))).toBe(SURFACE.ASPHALT);
    expect(mappedPathSurface(feature('unverified-hard-surface'))).toBe(SURFACE.GRAVEL);
    expect(mappedPathSurface(feature(undefined))).toBe(SURFACE.GRAVEL);
    expect(mappedPathSurface({ kind: 'practice_green', material: 'asphalt' })).toBeNull();
    const source = model('asphalt');
    expect(buildGroundSurfaceFeatures({ model: source }).find(f => f.sourceId === 'survey-path').surface).toBe(SURFACE.ASPHALT);
    expect(model('unverified-hard-surface').scenery.mappedFeatures[0].material).toBe('unverified-hard-surface');
  });

  it('triangulates the actual legacy overlay without moving vertices or filling the island', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const subdivisionCode = main.slice(main.indexOf('function subdivide('), main.indexOf('/* minimum-area oriented box'));
    const meshCode = main.slice(main.indexOf('function surfaceMesh('), main.indexOf("await tick('lägger fairways och greener'"));
    const subdivide = new Function('hyp', `${subdivisionCode}; return subdivide;`)(hyp);
    const failSmoothing = () => { throw new Error('Exact path must not use a smoothed exterior'); };
    const surfaceMesh = new Function('THREE', 'M', 'subdivide', 'meshH', 'ringSD', 'horizonAO', 'stats', 'chaikin', 'triangulate',
      `${meshCode}; return surfaceMesh;`)(THREE, { infra: {} }, subdivide, (x, z) => 100 + x * .1 + z * .02,
      ringSD, () => 1, { verts: 0, tris: 0 }, failSmoothing, failSmoothing);
    const shade = () => ({ col: [.5, .5, .5], det: 1, bmp: .1, gls: .1, str: 0 });
    const geometry = surfaceMesh([{ rings: feature('unverified-hard-surface').rings }], .085, 2, shade, false);
    const position = geometry.getAttribute('position'), index = geometry.index.array;
    const point = i => [position.getX(i), position.getZ(i)];
    for (const expected of [...outer, ...island]) {
      expect(Array.from({ length: position.count }, (_, i) => point(i)).some(p => hyp(p, expected) < 1e-6)).toBe(true);
    }
    let area = 0;
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [point(index[i]), point(index[i + 1]), point(index[i + 2])];
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
      const centre = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      expect(inRing(...centre, island)).toBe(false);
    }
    expect(area).toBeCloseTo(72, 6);
    geometry.dispose();
  });
});
