import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyReviewedTeeSurfaces } from '../tools/apply-reviewed-tee-surfaces.mjs';
import { applyReviewedNineTees } from '../tools/apply-reviewed-nine-tees.mjs';
import { mergeMellanTeeReview20260907 } from '../tools/apply-mellan-tee-review-2026-09-07.mjs';
import { sweref99TmToLatLon } from '../packages/course-geo/chmv2/projection.mjs';

const read = name => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url)));
const stora = read('upsalabuild/mapping/stora-tees-review-2026-09-07.json');
const mellan = read('upsalabuild/mapping/mellan-tees-review-2026-09-07.json');
const base = read('upsalabuild/mapping/mellan-tees-2025.json');
const options = evidence => ({ evidence,
  sourceRoutes: read('upsalabuild/mellanbanan-routes.geojson'), card: read('upsalabuild/card-mellanbanan.json') });

describe('Upsala archive-assisted tee additions, 2026-09-07', () => {
  it('adds H11 rear while preserving all original decks, routes, markers and other model fields', () => {
    const model = read('upsalabuild/course-model.json');
    for (const record of stora.holes) model.holes.find(h => h.n === record.hole).tees.pads = structuredClone(record.originalPads);
    const before = structuredClone(model), applied = applyReviewedTeeSurfaces(model, [stora]);
    expect(model).toEqual(before);
    expect(applied.holes.find(h => h.n === 11).tees.pads).toHaveLength(2);
    for (const [i, h] of applied.holes.entries()) {
      const old = before.holes[i];
      expect([h.line, h.t, h.tees.marks, h.green, h.fairway, h.bunkers]).toEqual([old.line, old.t, old.tees.marks, old.green, old.fairway, old.bunkers]);
      expect(h.tees.pads.slice(0, old.tees.pads.length)).toEqual(old.tees.pads);
    }
    const stale = structuredClone(stora); stale.holes[0].originalPads[0].ring[0][0]++;
    expect(() => applyReviewedTeeSurfaces(model, [stale])).toThrow(/source changed/);
  });

  it('adds the missing Mellan H8 northern deck without replacing any accepted original', () => {
    const before = structuredClone(base), combined = mergeMellanTeeReview20260907(base, mellan);
    expect(base).toEqual(before);
    expect(combined.features.slice(0, base.features.length)).toEqual(base.features);
    expect(combined.features).toHaveLength(24);
    expect(combined.unresolvedCandidates.map(c => c.id)).toEqual(['mellan-8-east-road', 'mellan-8-north-corridor']);
    const model = read('upsalamellanbuild/course-model.json');
    const applied = applyReviewedNineTees(model, options(combined));
    expect(applied.holes.find(h => h.n === 8).tees.pads).toHaveLength(2);
    for (const [i, h] of applied.holes.entries()) {
      expect(h.line).toBe(model.holes[i].line);
      expect(h.tees.marks).toBe(model.holes[i].tees.marks);
      expect(h.t).toBe(model.holes[i].t);
    }
    const pad = applied.holes.find(h => h.n === 8).tees.pads.at(-1);
    expect(pad.ring).toEqual(mellan.features[0].ring);
    expect(pad.preserveTerrain).toBe(true);
    expect(pad.teeIdx).toBeUndefined();
    expect(pad.tracePanel).toBeUndefined();
    expect(pad.originalPixelRing).toBeUndefined();
  });

  it('rejects changed accepted source evidence, frame, candidate and unaccepted additions', () => {
    for (const mutate of [b => { b.features.find(f => f.hole === 8).ring[0][0]++; },
      b => { b.frame.origin.lat += .001; }, b => { b.unresolvedCandidates[0].c[0]++; }]) {
      const changed = structuredClone(base); mutate(changed);
      expect(() => mergeMellanTeeReview20260907(changed, mellan)).toThrow();
    }
    const candidate = structuredClone(mellan); candidate.features[0].status = 'candidate';
    expect(() => mergeMellanTeeReview20260907(base, candidate)).toThrow(/surface/);
  });

  it('independently reproduces every source-panel vertex and distinguishes service year from flight date', () => {
    for (const evidence of [stora, mellan]) for (const f of evidence.features) {
      const [e0, n0, e1, n1] = f.tracePanel.extentEPSG3006;
      expect(f.captureDate).toBeNull();
      expect(f.yearBasis).toMatch(/service name/);
      expect(f.sourceAbsoluteHorizontalAccuracyMetres).toBeNull();
      f.originalPixelRing.forEach(([x, y], i) => {
        const [lat, lon] = sweref99TmToLatLon(e0 + x / 720 * (e1 - e0), n1 - (y - 44) / 720 * (n1 - n0));
        const expected = [(lon - evidence.frame.origin.lon) * evidence.frame.mPerLon, (evidence.frame.origin.lat - lat) * evidence.frame.mPerLat];
        expect(Math.hypot(...expected.map((v, k) => v - f.ring[i][k]))).toBeLessThan(.005);
      });
    }
  });
});
