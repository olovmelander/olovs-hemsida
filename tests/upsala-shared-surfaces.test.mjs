import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applySharedMellanSurfaces, retireReviewedBunker } from '../upsalabuild/ground-mapping.mjs';
import { applyReviewedNineFairways } from '../tools/apply-reviewed-nine-fairways.mjs';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { collectCoordinatePairs } from '../packages/course-geo/migration.mjs';

const read = relative => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url)));
const evidence = {
  greens: read('../upsalabuild/mapping/mellan-greens-2025.json'),
  tees: read('../upsalabuild/mapping/mellan-tees-2025.json'),
  fairways: read('../upsalabuild/mapping/mellan-fairways-2025.json'),
};
const osm = read('../upsalabuild/osm-features.json');
const key = ring => JSON.stringify(ring);
function parentFixture() {
  const retired = osm.bunkers.find(b => b.id === 'w438984738');
  return structuredClone({ ...evidence.greens.frame, scenery: {
    greens: [], fairways: [], tees: osm.tees.map(t => t.ring), bunkers: [retired.ring],
    sourceFeatures: [...osm.tees.map(t => ({ ...t, kind: 'tee' })), { ...retired, kind: 'bunker' }],
  } });
}

describe('shared Upsala physical surface application', () => {
  it('replaces the four coarse OSM tees and preserves all reviewed source footprints', () => {
    const parent = parentFixture();
    applySharedMellanSurfaces(parent, evidence);
    expect(parent.scenery.greens).toHaveLength(8);
    expect(parent.scenery.tees).toHaveLength(23);
    expect(parent.scenery.fairways).toHaveLength(7);
    const records = parent.scenery.sourceFeatures.filter(f => f.courseSlug === 'upsala-mellanbanan');
    expect(records).toHaveLength(38);
    expect(records.filter(f => f.replacesSourceId).map(f => f.replacesSourceId).sort()).toEqual(osm.tees.map(f => f.id).sort());
    for (const feature of records) {
      const collection = feature.kind === 'fairway' ? 'fairways' : feature.kind === 'green' ? 'greens' : 'tees';
      expect(parent.scenery[collection].filter(r => key(r) === key(feature.ring))).toHaveLength(1);
      expect(feature.originalPads).toBeUndefined();
      expect(feature.sourceCrop).toBeUndefined();
    }
  });

  it('rejects a stale OSM replacement before adopting any new shared turf', () => {
    const parent = parentFixture();
    parent.scenery.sourceFeatures.find(f => f.kind === 'tee').ring[0][0] += 1;
    const before = structuredClone(parent);
    expect(() => applySharedMellanSurfaces(parent, evidence)).toThrow(/changed since review/);
    expect(parent).toEqual(before);
  });

  it('requires exact generated fairway assertions while preserving reviewed disjoint polygons', () => {
    const model = { ...evidence.fairways.frame, holes: evidence.fairways.features.map(f => ({ n: f.hole, fairway: structuredClone(f.originalFairway) })) };
    const mapped = applyReviewedNineFairways(model, evidence.fairways);
    expect(mapped.holes.flatMap(h => h.fairway.rings)).toHaveLength(7);
    expect(mapped.holes.find(h => h.n === 8).fairway.rings).toHaveLength(2);
    const stale = structuredClone(model); stale.holes[0].fairway.rings[0][0][0] += 0.1;
    expect(() => applyReviewedNineFairways(stale, evidence.fairways)).toThrow(/changed since review/);
    expect(model.holes[0].fairway.prov).toBe('synth');
  });

  it('retires exposed-sand material with a geometry-free provenance record', () => {
    const model = parentFixture();
    retireReviewedBunker(model);
    expect(model.scenery.bunkers).toEqual([]);
    expect(model.scenery.sourceFeatures.some(f => f.id === 'w438984738')).toBe(false);
    expect(model.scenery.retiredSourceFeatures[0].preserveTerrain).toBe(true);
    expect(collectCoordinatePairs({ retired: model.scenery.retiredSourceFeatures }).coordinates).toEqual([]);
  });
});

describe('regenerated shared Upsala models', () => {
  it('renders every reviewed Mellan footprint exactly once in either course, including after compiler smoothing', () => {
    const expected = [
      ...evidence.greens.features.map(f => [SURFACE.GREEN, f.ring]),
      ...evidence.tees.features.map(f => [SURFACE.TEE, f.ring]),
      ...evidence.fairways.features.flatMap(f => f.rings.map(r => [SURFACE.FAIRWAY, r])),
    ];
    for (const build of ['upsalabuild', 'upsalamellanbuild']) {
      const model = read(`../${build}/course-model.json`);
      expect(model.infra.preserveMappedBoundaries).toBe(true);
      for (const smoothEdges of [false, true]) {
        const features = buildGroundSurfaceFeatures({ holes: model.holes, model, smoothEdges });
        for (const [surface, ring] of expected) {
          const occurrences = features.filter(f => f.surface === surface).flatMap(f => f.rings || []).filter(r => key(r) === key(ring));
          expect(occurrences, `${build}: ${surface} footprint must occur once`).toHaveLength(1);
        }
      }
      expect(model.scenery.sourceFeatures.some(f => f.id === 'w438984738')).toBe(false);
      expect(model.scenery.retiredSourceFeatures.find(f => f.id === 'w438984738').status).toBe('no-visible-sand-in-2024-or-2025');
    }
  });
});
