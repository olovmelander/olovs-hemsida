import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { applyReviewedTeeSurfaces } from '../tools/apply-reviewed-tee-surfaces.mjs';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url)));
const evidence = ['01-06', '07-12', '13-18'].map(part => read(`upsalabuild/mapping/stora-tees-${part}-2025.json`));
const followup = read('upsalabuild/mapping/stora-tees-followup-2026-09-06.json');
const accepted = [...evidence.flatMap(e => e.features), ...followup.features];
const key = ring => JSON.stringify(ring);

describe('reviewed Stora tee platforms in shipped ground models', () => {
  it('preserves all archived route and marker references while retaining explicit survey gaps', () => {
    const model = read('upsalabuild/course-model.json');
    expect(model.holes.map(h => h.tees.pads.length)).toEqual([4, 2, 2, 4, 4, 3, 4, 3, 3, 4, 1, 3, 2, 2, 2, 4, 3, 3]);
    const pads = model.holes.flatMap(h => h.tees.pads);
    expect(pads).toHaveLength(53);
    expect(pads.filter(p => p.prov === 'dated-orthophoto-trace')).toHaveLength(51);
    expect(pads.filter(p => p.prov !== 'dated-orthophoto-trace')).toHaveLength(2);
    expect(pads.every(p => p.preserveTerrain && p.teeIdx == null)).toBe(true);
    const latest = new Map([...evidence.flatMap(e => e.holes), ...followup.holes].map(h => [h.hole, h]));
    for (const record of latest.values()) {
      const h = model.holes.find(h => h.n === record.hole);
      expect(h.line).toEqual(record.originalLine);
      expect(h.t).toEqual(record.originalDistances);
      expect(h.tees.marks).toEqual(record.originalMarks);
      expect(h.tees.mappingCoverage).toBe(record.coverage);
      for (const i of record.retainOriginalPadIndices || []) {
        expect(h.tees.pads.some(p => key(p.ring) === key(record.originalPads[i].ring))).toBe(true);
      }
      for (const i of record.retireOriginalPadIndices || []) {
        expect(h.tees.pads.some(p => key(p.ring) === key(record.originalPads[i].ring))).toBe(false);
      }
    }
  });

  it('renders each of the 48 newly traced rings exactly once in both courses without smoothing', () => {
    expect(accepted).toHaveLength(48);
    for (const build of ['upsalabuild', 'upsalamellanbuild']) {
      const model = read(`${build}/course-model.json`);
      for (const smoothEdges of [false, true]) {
        const rings = buildGroundSurfaceFeatures({ holes: model.holes, model, smoothEdges })
          .filter(f => f.surface === SURFACE.TEE).flatMap(f => f.rings || []);
        for (const feature of accepted) {
          expect(rings.filter(ring => key(ring) === key(feature.ring)), `${build}: ${feature.id}`).toHaveLength(1);
        }
      }
    }
  });

  it('applies the archive follow-up transactionally without changing route or marker references', () => {
    const model = read('upsalabuild/course-model.json');
    for (const record of followup.holes) model.holes.find(h => h.n === record.hole).tees.pads = structuredClone(record.originalPads);
    const before = structuredClone(model);
    const result = applyReviewedTeeSurfaces(model, [followup]);
    expect(model).toEqual(before);
    for (const h of result.holes) {
      const old = before.holes.find(o => o.n === h.n);
      expect([h.line, h.t, h.tees.marks]).toEqual([old.line, old.t, old.tees.marks]);
    }
    const stale = structuredClone(followup); stale.holes.at(-1).originalPads[0].ring[0][0]++;
    expect(() => applyReviewedTeeSurfaces(model, [stale])).toThrow(/tee source changed/);
    expect(model).toEqual(before);
  });

  it('reproduces historical image traces independently and keeps service years distinct from capture dates', () => {
    for (const f of followup.features) {
      const [e0, n0, e1, n1] = f.tracePanel.extentEPSG3006;
      expect(f.captureDate).toBeNull();
      expect(f.yearBasis).toMatch(/service name/);
      f.originalPixelRing.forEach(([x, y], i) => {
        const [lat, lon] = sweref99TmToLatLon(e0 + x / 720 * (e1 - e0), n1 - (y - 44) / 720 * (n1 - n0));
        const expected = [(lon - followup.frame.origin.lon) * followup.frame.mPerLon, (followup.frame.origin.lat - lat) * followup.frame.mPerLat];
        expect(Math.hypot(...expected.map((v, j) => v - f.ring[i][j]))).toBeLessThan(.005);
      });
    }
  });
});
