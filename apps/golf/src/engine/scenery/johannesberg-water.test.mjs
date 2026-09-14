import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPack, inflateStream } from '../../../../../packages/course-pack/lib.mjs';
import { loadSceneryModule } from './index.js';
import { applyWaterSourceReview, reviewedWaterLevel, JOHANNESBERG_WATER_REVIEW as review } from './johannesberg-water.mjs';
import { MEASURED_WATER_CLEARANCE_METRES } from '../water-render-policy.mjs';

const datum = 5.6676;
function pack(slug) {
  const p = readPack(fs.readFileSync(new URL(`../../../public/courses/${slug}/pack.bin`, import.meta.url)));
  return { model: JSON.parse(inflateStream(p.sv)), geo: p.header.GEO };
}

describe('Johannesberg source-reviewed water levels', () => {
  it.each(review.courseSlugs)('identifies all nine ponds in %s and preserves every footprint', async slug => {
    const { model, geo } = pack(slug), before = structuredClone(model);
    const scenery = await loadSceneryModule(slug);
    expect(scenery.deferWaterBedToWorld).toBe(true);
    expect(scenery.applyWaterSourceReview(model, geo).ponds).toBe(9);
    expect(applyWaterSourceReview(model, geo).ponds).toBe(9);
    expect(model.holes).toEqual(before.holes);
    expect(model.infra).toEqual(before.infra);
    model.water.forEach((w,i) => {
      expect(w.ring).toEqual(before.water[i].ring);
      expect(w.level).toBe(before.water[i].level);
      if (i<3) expect(w).toEqual(before.water[i]);
    });
    for (const source of review.bodies) {
      const w = model.water[source.packIndex];
      expect(w.vegetatedBank).toBe(true);
      const resolved = scenery.reviewedWaterLevel(w, () => ({ height: source.levelRH2000Metres + datum }), datum);
      expect(resolved.level).toBeCloseTo(source.levelRH2000Metres + datum + MEASURED_WATER_CLEARANCE_METRES, 8);
      expect(resolved.method).toBe('reviewed-interior-terrain-controls');
    }
  });

  it('refuses changed geometry atomically instead of relabelling another pond', () => {
    const { model, geo } = pack('johannesberg');
    model.water.at(-1).ring[0][0] += 1;
    const before = JSON.stringify(model);
    expect(() => applyWaterSourceReview(model, geo)).toThrow('baseline');
    expect(JSON.stringify(model)).toBe(before);
    expect(() => applyWaterSourceReview(model, { ...geo, origin:{lat:60,lon:18} })).toThrow('frame');
  });

  it('requires all controls, a flat plate, and agreement with the pinned source', () => {
    const { model, geo } = pack('johannesberg');
    applyWaterSourceReview(model, geo);
    const s=review.bodies[0], w=model.water[s.packIndex], h=s.levelRH2000Metres+datum;
    expect(reviewedWaterLevel(w, () => NaN, datum)).toBeNull();
    expect(reviewedWaterLevel(w, () => h+1, datum)).toBeNull();
    let calls=0;
    expect(reviewedWaterLevel(w, () => ++calls===1 ? NaN : h, datum)).toBeNull();
    calls=0;
    expect(reviewedWaterLevel(w, () => h + (++calls===1 ? .07 : -.07), datum)).toBeNull();
    expect(reviewedWaterLevel(model.water[0], () => h, datum)).toBeNull();
  });

  it('does not defer frontier carving for another ground', async () => {
    expect((await loadSceneryModule('puttom')).deferWaterBedToWorld).toBeUndefined();
  });
});
