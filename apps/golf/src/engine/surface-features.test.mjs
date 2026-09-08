import { describe, expect, it } from 'vitest';
import { SURFACE } from './surface.js';
import { buildGroundSurfaceFeatures } from './surface-features.mjs';

const ring = [[0, 0], [4, 0], [4, 4], [0, 4]];

describe('shared ground surface features', () => {
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
