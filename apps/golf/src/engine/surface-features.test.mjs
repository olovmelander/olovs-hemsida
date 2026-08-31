import { describe, expect, it } from 'vitest';
import { SURFACE } from './surface.js';
import { buildGroundSurfaceFeatures } from './surface-features.mjs';

const ring = [[0, 0], [4, 0], [4, 4], [0, 4]];

describe('shared ground surface features', () => {
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
