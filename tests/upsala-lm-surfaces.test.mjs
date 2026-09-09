import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyUpsalaLmSurfaces } from '../tools/apply-upsala-lm-surfaces.mjs';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';
import { applyUpsalaLmMellan } from '../tools/apply-upsala-lm-mellan.mjs';
import { createGroundAtlas } from '../apps/golf/src/engine/atlas.js';
import { pointInPoly } from '../upsalabuild/lib.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url)));
const reviews = ['front9', 'back9'].map(part => read(`upsalabuild/mapping/lm-review-${part}-2026-09-09.json`));
const features = reviews.flatMap(r => r.features);
const mellanReview = read('upsalabuild/mapping/lm-review-mellan-2026-09-09.json');
const allFeatures = [...features, ...mellanReview.features];
const model = read('upsalabuild/course-model.json');

describe('Upsala authenticated orthophoto adoption', () => {
  it('reproduces source pixels in the runtime frame through an independent projection', () => {
    for (const f of allFeatures) {
      const [west, dx, rx, north, ry, dz] = f.tracePanel.geoTransform;
      f.originalPixelRing.forEach(([x, y], i) => {
        const e = west + x * dx + y * rx, n = north + x * ry + y * dz;
        const [latitude, longitude] = sweref99TmToLatLon(e, n);
        const expected = [(longitude - model.origin.lon) * model.mPerLon, (model.origin.lat - latitude) * model.mPerLat];
        expect(Math.hypot(...expected.map((v, j) => v - f.ring[i][j])), f.id).toBeLessThan(0.005);
      });
    }
  });
  it('rejects a changed source or wrong frame before changing any surface', () => {
    const base = structuredClone(model);
    for (const f of features) {
      const h = base.holes.find(h => h.n === f.hole);
      if (f.kind === 'green') h.green = structuredClone(f.originalShape);
      else h.bunkers[h.bunkers.findIndex(b => b.sourceId === f.sourceId)] = structuredClone(f.originalShape);
      for (const merged of f.originalMergedShapes || []) h.bunkers.push(structuredClone(merged));
    }
    const retiredMergedIds = features.flatMap(f => f.mergedSourceIds || []);
    base.scenery.retiredSourceFeatures = base.scenery.retiredSourceFeatures.filter(f => !retiredMergedIds.includes(f.id));
    const original = structuredClone(base);
    const stale = structuredClone(reviews);
    stale.at(-1).features.at(-1).originalShape.ring[0][0] += 1;
    expect(() => applyUpsalaLmSurfaces(base, stale)).toThrow(/original surface changed/);
    expect(base).toEqual(original);
    const wrongFrame = structuredClone(reviews);
    wrongFrame[0].frame.mPerLon += 1;
    expect(() => applyUpsalaLmSurfaces(base, wrongFrame)).toThrow(/frame changed/);
    expect(base).toEqual(original);
    applyUpsalaLmSurfaces(base, reviews);
    for (const f of features) {
      const h = base.holes.find(h => h.n === f.hole);
      const current = f.kind === 'green' ? h.green : h.bunkers.find(b => b.sourceId === f.sourceId);
      expect(current.ring).toEqual(f.ring);
      expect(current.sourceId).toBe(f.sourceId);
      expect(current.evidence.sourceGeometryEPSG3006).toBeUndefined();
      expect(current.evidence.originalPixelRing).toBeUndefined();
      if (f.kind === 'green') expect(current.c).toEqual(f.originalShape.c);
    }
  });

  it('adopts Mellan H6 into its shared source and rejects stale scenery without partial updates', () => {
    const f = mellanReview.features[0];
    const base = { ...mellanReview.frame, scenery: { sourceFeatures: [structuredClone(f.originalScenerySourceFeature)], greens: [structuredClone(f.originalShape.ring)] } };
    const stale = structuredClone(base);
    stale.scenery.greens.push(structuredClone(f.originalShape.ring));
    const before = structuredClone(stale);
    expect(() => applyUpsalaLmMellan(stale, mellanReview)).toThrow(/ownership changed/);
    expect(stale).toEqual(before);
    applyUpsalaLmMellan(base, mellanReview);
    expect(base.scenery.greens).toEqual([f.ring]);
    expect(base.scenery.sourceFeatures[0].ring).toEqual(f.ring);
    const played = read('upsalamellanbuild/course-model.json').holes.find(h => h.n === 6).green;
    expect(played.ring).toEqual(f.ring);
    expect(played.c).toEqual(f.originalShape.c);
    expect(played.evidence.reviewId).toBe(f.id);
  });

  it('fills the observed H3 sand connection without an invented internal grass lip', () => {
    const merged = features.find(f => f.action === 'merge');
    const [x, z] = merged.neckObservation.localPoint;
    expect([merged.originalShape, ...merged.originalMergedShapes].some(s => pointInPoly(x, z, s.ring))).toBe(false);
    for (const build of ['upsalabuild', 'upsalamellanbuild']) {
      const current = read(`${build}/course-model.json`);
      const shapes = buildGroundSurfaceFeatures({ holes: current.holes, model: current, smoothEdges: true });
      const atlas = createGroundAtlas({ CORE: { x0: x-5, z0: z-5, x1: x+5, z1: z+5 }, features: shapes, res: 0.25 });
      expect(atlas.sampleAt(x, z).surface).toBe(SURFACE.SAND);
      expect(current.scenery.retiredSourceFeatures.find(f => f.id === merged.mergedSourceIds[0]).replacedBySourceId).toBe(merged.sourceId);
    }
  });

  for (const build of ['upsalabuild', 'upsalamellanbuild']) {
    it(`${build} renders each accepted boundary exactly once`, () => {
      const current = read(`${build}/course-model.json`);
      const surfaces = buildGroundSurfaceFeatures({ holes: current.holes, model: current, smoothEdges: true });
      for (const f of allFeatures) {
        const surfaceClass = f.kind === 'green' ? SURFACE.GREEN : SURFACE.SAND;
        const rings = surfaces.filter(s => s.surface === surfaceClass)
          .flatMap(s => [...(s.rings || []), ...(s.polygons || []).flatMap(p => p.rings)]);
        expect(rings.filter(r => JSON.stringify(r) === JSON.stringify(f.ring)), f.id).toHaveLength(1);
        expect(rings.filter(r => JSON.stringify(r) === JSON.stringify(f.originalShape.ring)), `${f.id} retired ring`).toHaveLength(0);
      }
    });
  }
});
