import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { SURFACE } from '../apps/golf/src/engine/surface.js';

const read = file => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url)));
const evidence = ['01-06', '07-12', '13-18'].map(part => read(`upsalabuild/mapping/stora-tees-${part}-2025.json`));
const accepted = evidence.flatMap(e => e.features);
const key = ring => JSON.stringify(ring);

describe('reviewed Stora tee platforms in shipped ground models', () => {
  it('preserves all archived route and marker references while retaining explicit survey gaps', () => {
    const model = read('upsalabuild/course-model.json');
    expect(model.holes.map(h => h.tees.pads.length)).toEqual([4, 2, 2, 4, 4, 3, 4, 3, 3, 4, 1, 2, 2, 2, 2, 4, 3, 4]);
    const pads = model.holes.flatMap(h => h.tees.pads);
    expect(pads).toHaveLength(53);
    expect(pads.filter(p => p.prov === 'dated-orthophoto-trace')).toHaveLength(47);
    expect(pads.filter(p => p.prov !== 'dated-orthophoto-trace')).toHaveLength(6);
    expect(pads.every(p => p.preserveTerrain && p.teeIdx == null)).toBe(true);
    for (const record of evidence.flatMap(e => e.holes)) {
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

  it('renders each of the 44 newly traced rings exactly once in both courses without smoothing', () => {
    expect(accepted).toHaveLength(44);
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
});
