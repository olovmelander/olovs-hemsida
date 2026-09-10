import { describe, expect, it } from 'vitest';
import { runtimeScenery } from './runtime-scenery.mjs';

describe('reviewed scenery in course packs', () => {
  it('retains approach identity and review metadata without duplicating source geometry', () => {
    const feature = { id: 'approach-3', kind: 'mown_approach', hole: 3,
      rings: [[[0, 0], [4, 0], [4, 4], [0, 4]]], material: 'turf',
      sourceEpoch: '2025-05-31', sourceReview: 'reviewed-putting-cuts',
      sourceId: 'lm-ortho', sourceSha256: 'a'.repeat(64), reviewNotes: 'authoring only' };
    const model = { infra: { objectPlacement: 'mapped-only' }, scenery: {
      mappedFeatures: [feature], sourceFeatures: [feature], retiredSourceFeatures: [feature],
    } };
    const before = JSON.stringify(model);
    const packed = JSON.parse(JSON.stringify(runtimeScenery(model)));
    const { reviewNotes, ...expected } = feature;
    expect(packed.mappedFeatures).toEqual([expected]);
    expect(packed).not.toHaveProperty('sourceFeatures');
    expect(packed).not.toHaveProperty('retiredSourceFeatures');
    expect(JSON.stringify(model)).toBe(before);
  });

  it('leaves existing non-mapped scenery untouched', () => {
    const scenery = { sourceFeatures: [{ id: 'legacy' }], greens: [] };
    expect(runtimeScenery({ scenery })).toBe(scenery);
  });
});
