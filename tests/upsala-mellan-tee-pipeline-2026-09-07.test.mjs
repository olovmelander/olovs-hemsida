import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';

const read = file => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url)));
const evidence = read('upsalabuild/mapping/mellan-tees-review-2026-09-07.json');
const northern = evidence.features[0];
const key = value => JSON.stringify(value);

describe('Mellan H8 archive addition through both generated course pipelines', () => {
  for (const build of ['upsalabuild', 'upsalamellanbuild']) {
    it(`${build} renders the northern ring exactly once and preserves its archive qualifier`, () => {
      const model = read(`${build}/course-model.json`);
      for (const smoothEdges of [false, true]) {
        const surfaces = buildGroundSurfaceFeatures({ holes: model.holes, model, smoothEdges });
        const rings = surfaces.filter(f => f.surface === SURFACE.TEE)
          .flatMap(f => [...(f.rings || []), ...(f.polygons || []).flatMap(p => p.rings)]);
        expect(rings.filter(ring => key(ring) === key(northern.ring)), `${build}, smoothing=${smoothEdges}`).toHaveLength(1);
      }
      const own = model.holes.flatMap(h => h.tees.pads).filter(p => p.sourceId === northern.id);
      const shared = (model.scenery.sourceFeatures || []).filter(p => p.id === northern.id);
      const records = build === 'upsalabuild' ? shared : own;
      expect(records).toHaveLength(1);
      for (const record of records) {
        expect(record.ring).toEqual(northern.ring);
        expect(record.observedYear).toBe(2015);
        expect(record.crosscheckYear).toBe(2025);
        expect(record.yearBasis).toBe(northern.yearBasis);
        expect(record.yearBasis).toMatch(/service name/);
        expect(record.captureDate).toBeNull();
        expect(record.sourceSha256).toBe(northern.sourceSha256);
        expect(record.sourceAbsoluteHorizontalAccuracyMetres).toBeNull();
        expect(record.boundaryInterpretationUncertaintyMetres).toBe(2.5);
        expect(record.tracePanel).toBeUndefined();
        expect(record.originalPixelRing).toBeUndefined();
      }
      if (build === 'upsalamellanbuild') {
        expect(model.holes.find(h => h.n === 8).tees.pads).toHaveLength(2);
        expect(model.holes.find(h => h.n === 8).tees.mappingCoverage).toMatch(/^partial/);
      }
    });
  }
});
