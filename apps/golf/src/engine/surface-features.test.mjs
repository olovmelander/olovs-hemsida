import { describe, expect, it } from 'vitest';
import { SURFACE } from './surface.js';
import { rasterizeGroundAtlas } from './atlas.js';
import { buildGroundSurfaceFeatures, isTurfRangeTarget, mappedLineHalfWidth } from './surface-features.mjs';

const ring = [[0, 0], [4, 0], [4, 4], [0, 4]];

describe('shared ground surface features', () => {
  it('keeps reviewed approaches below maintained surfaces and preserves their unmown islands', () => {
    const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const approach = { id: 'reviewed-approach', kind: 'mown_approach', hole: 3,
      rings: [rect(0, 0, 12, 12), rect(4, 4, 8, 8)] };
    const model = { scenery: { mappedFeatures: [approach,
      { id: 'putting-cut', kind: 'practice_green', rings: [rect(0, 0, 3, 3)] },
      { id: 'cart-path', kind: 'paved_path', rings: [rect(9, 0, 12, 3)] }] } };
    const features = buildGroundSurfaceFeatures({ model });
    const canopyFloor = { x0: 0, z0: 0, nx: 4, nz: 4, cell: 3,
      b64: btoa(String.fromCharCode(255, 255, 255, 255)) };
    const raster = rasterizeGroundAtlas({ CORE: { x0: 0, z0: 0, x1: 12, z1: 12 },
      features, canopyFloor, classesOnly: true });
    const at = (x, z) => raster.classes[z * 12 + x];
    expect(at(1, 1)).toBe(SURFACE.GREEN);
    expect(at(10, 1)).toBe(SURFACE.GRAVEL);
    expect(at(2, 7)).toBe(SURFACE.SEMI);
    expect(at(5, 5)).toBe(SURFACE.FOREST);
    expect(features.find(feature => feature.sourceId === approach.id).polygons[0].rings).toEqual(approach.rings);
  });

  it('uses full source widths consistently and keeps explicit unpaved road materials', () => {
    const line = [[0, 0], [20, 0]];
    const features = buildGroundSurfaceFeatures({ model: { infra: {
      paths: [{ line, kind: 'cycleway', surface: 'gravel', widthMetres: 2.4 }],
      tracks: [{ line, kind: 'service', surface: 'unpaved', widthMetres: 3.5 }],
      roads: [{ line, kind: 'tertiary', surface: 'unpaved', widthMetres: 6 },
        { line, kind: 'tertiary', surface: 'asphalt', widthMetres: 7.5 }],
    } } });
    expect(features.map(f => [f.surface, f.width])).toEqual([
      [SURFACE.GRAVEL, 1.2], [SURFACE.GRAVEL, 1.75], [SURFACE.GRAVEL, 3], [SURFACE.ASPHALT, 3.75],
    ]);
    expect(mappedLineHalfWidth({ w: 8 }, 0.65)).toBe(0.65);
    for (const widthMetres of [0, -1, NaN, Infinity]) expect(mappedLineHalfWidth({ widthMetres }, 1.7)).toBe(1.7);
  });
  it('keeps turf target polygons in the atlas without converting hard targets or losing exclusions', () => {
    const island = [[1, 1], [2, 1], [2, 2], [1, 2]];
    const turf = { id: 'turf-target', kind: 'range_target_surface', material: 'turf', rings: [ring, island] };
    const hard = { id: 'hard-target', kind: 'range_target_surface', material: 'concrete', rings: [ring] };
    expect(isTurfRangeTarget(turf)).toBe(true);
    expect(isTurfRangeTarget(hard)).toBe(false);
    expect(isTurfRangeTarget({ kind: 'practice_green', material: 'turf' })).toBe(false);
    const features = buildGroundSurfaceFeatures({ model: { scenery: { mappedFeatures: [turf, hard] } } });
    expect(features).toEqual([{ surface: SURFACE.GREEN, sourceId: turf.id, polygons: [{ rings: [ring, island] }] }]);
    expect(turf.kind).toBe('range_target_surface');
  });

  it('carries the ground boundary policy through compiler smoothing and sand padding', () => {
    const mapped = Array.from({ length: 12 }, (_, i) => [Math.cos(i * Math.PI / 6) * 14, Math.sin(i * Math.PI / 6) * 10]);
    const hole = { n: 1, green: { ring: mapped }, fairway: { rings: [mapped] },
      tees: { pads: [{ ring: mapped }] }, bunkers: [{ ring: mapped }] };
    const model = { infra: { preserveMappedBoundaries: true }, scenery: {
      greens: [mapped], tees: [mapped], fairways: [mapped], bunkers: [mapped],
      mappedFeatures: [{ id: 'practice-with-island', kind: 'practice_green', rings: [mapped, ring] }],
    } };
    const before = JSON.stringify({ hole, model });
    const exact = buildGroundSurfaceFeatures({ holes: [hole], model, smoothEdges: true });
    for (const surface of [SURFACE.GREEN, SURFACE.FAIRWAY, SURFACE.TEE, SURFACE.SAND]) {
      for (const feature of exact.filter(f => f.surface === surface && f.rings)) expect(feature.rings).toEqual([mapped]);
    }
    expect(exact.filter(f => f.surface === SURFACE.SAND).map(f => f.pad)).toEqual([0, 0]);
    expect(exact.find(f => f.sourceId === 'practice-with-island').polygons[0].rings).toEqual([mapped, ring]);
    expect(JSON.stringify({ hole, model })).toBe(before);
    const legacy = buildGroundSurfaceFeatures({ holes: [hole], model: { ...model, infra: {} }, smoothEdges: true });
    expect(legacy.find(f => f.surface === SURFACE.GREEN && f.hole === 1).rings[0]).not.toEqual(mapped);
    expect(legacy.filter(f => f.surface === SURFACE.SAND).map(f => f.pad)).toEqual([0.5, 0.5]);
  });

  it('preserves the legacy atlas precedence inputs for holes, scenery and infrastructure', () => {
    const features = buildGroundSurfaceFeatures({
      holes: [{
        n: 7,
        fairway: { rings: [ring] }, green: { ring },
        tees: { pads: [{ ring }] }, bunkers: [{ ring }],
      }],
      model: {
        scenery: { fairways: [ring], range: [ring], greens: [ring], tees: [ring], grass: [ring], bunkers: [ring] },
        veg: { sand: [ring], forest: [ring], wetland: [ring], rock: [ring] },
        infra: {
          parking: [{ ring }],
          paths: [{ line: [[0, 0], [1, 1]], kind: 'cycleway' }],
          tracks: [{ line: [[0, 0], [1, 1]], kind: 'service' }],
          roads: [{ line: [[0, 0], [1, 1]], kind: 'secondary' }],
          railway: [{ line: [[0, 0], [1, 1]] }],
        },
      },
    });
    expect(features.map(feature => feature.surface)).toEqual([
      SURFACE.SEMI, SURFACE.FAIRWAY, SURFACE.FRINGE, SURFACE.GREEN,
      SURFACE.FRINGE, SURFACE.TEE, SURFACE.SAND,
      SURFACE.FAIRWAY, SURFACE.GREEN, SURFACE.TEE, SURFACE.SEMI, SURFACE.SAND,
      SURFACE.FOREST, SURFACE.WETLAND, SURFACE.ROCK, SURFACE.GRAVEL,
      SURFACE.ASPHALT, SURFACE.GRAVEL, SURFACE.ASPHALT, SURFACE.GRAVEL,
    ]);
    expect(features[0]).toMatchObject({ hole: 7, pad: 4.5 });
    expect(features[2]).toMatchObject({ hole: 7, pad: 3.2 });
    expect(features[4]).toMatchObject({ hole: 7, pad: 2.2 });
    expect(features[6]).toMatchObject({ hole: 7, pad: 0.5 });
    expect(features[16]).toMatchObject({ width: 1.3 });
    expect(features[18]).toMatchObject({ width: 3.2 });
  });
});
