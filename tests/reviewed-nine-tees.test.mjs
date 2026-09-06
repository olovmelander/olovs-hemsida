import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyReviewedNineTees } from '../tools/apply-reviewed-nine-tees.mjs';

const read = relative => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url), 'utf8'));
const sourceRoutes = read('../upsalabuild/mellanbanan-routes.geojson');
const card = read('../upsalabuild/card-mellanbanan.json');
const evidence = read('../upsalabuild/mapping/mellan-tees-2025.json');
const model = read('../upsalamellanbuild/course-model.json');
const options = () => ({ evidence: structuredClone(evidence), sourceRoutes: structuredClone(sourceRoutes), card: structuredClone(card) });

describe('reviewed Mellanbanan tee application', () => {
  it('uses the archived review context while preserving regenerated routes and provisional markers', () => {
    const current = structuredClone(model);
    // A newly reviewed green changes generated endpoints and marker positions.
    // Those derived values must never be used to stretch or relocate the deck.
    for (const h of current.holes) {
      h.line[0][0] += 9;
      for (const marker of h.tees.marks) marker.c[0] += 9;
    }
    const before = structuredClone(current);
    const applied = applyReviewedNineTees(current, options());
    expect(current).toEqual(before);
    expect(applied.holes.map(h => h.tees.pads.length)).toEqual([2, 2, 2, 2, 3, 4, 4, 1, 3]);
    for (const [i, h] of applied.holes.entries()) {
      expect(h.line).toBe(current.holes[i].line);
      expect(h.tees.marks).toBe(current.holes[i].tees.marks);
      expect(h.tees.inferPads).toBe(false);
      for (const pad of h.tees.pads) {
        expect(pad.preserveTerrain).toBe(true);
        expect(pad.teeIdx).toBeUndefined();
        expect(pad.originalPads).toBeUndefined();
        expect(pad.sourceCrop).toBeUndefined();
      }
    }
    expect(applied.water).toBe(current.water);
    expect(applied.vegetation).toBe(current.vegetation);
    expect(applyReviewedNineTees(applied, options())).toEqual(applied);
  });

  it('rejects changed source routing, scorecard or local frame', () => {
    const movedRoute = options();
    movedRoute.sourceRoutes.features.find(f => f.properties.role === 'published_hole_route').geometry.coordinates[0][0] += 0.0001;
    expect(() => applyReviewedNineTees(model, movedRoute)).toThrow(/source routes changed/);
    const changedCard = options();
    changedCard.card.holes[0].t[0] += 1;
    expect(() => applyReviewedNineTees(model, changedCard)).toThrow(/source card changed/);
    expect(() => applyReviewedNineTees({ ...model, origin: { ...model.origin, lat: model.origin.lat + 0.001 } }, options())).toThrow(/local frame changed/);
  });

  it('refuses stale archived assertions and incomplete physical-surface coverage', () => {
    const changedArchive = options();
    changedArchive.evidence.reference.archive.holes[0].pads[0].ring[0][0] += 1;
    expect(() => applyReviewedNineTees(model, changedArchive)).toThrow(/changed archived review baseline/);
    const changedAssertion = options();
    changedAssertion.evidence.features[0].originalPads[0].ring[0][0] += 1;
    expect(() => applyReviewedNineTees(model, changedAssertion)).toThrow(/archived geometry assertion changed/);
    const missingHole = options();
    missingHole.evidence.features = missingHole.evidence.features.filter(f => f.hole !== 8);
    expect(() => applyReviewedNineTees(model, missingHole)).toThrow(/hole 8 has no accepted physical platform/);
  });

  it('rejects invalid polygons and accidental colour assignment', () => {
    const crossed = options();
    const ring = crossed.evidence.features[0].ring;
    [ring[1], ring[8]] = [ring[8], ring[1]];
    expect(() => applyReviewedNineTees(model, crossed)).toThrow(/self-intersecting ring/);
    const assigned = options();
    assigned.evidence.features[0].teeIdx = 0;
    expect(() => applyReviewedNineTees(model, assigned)).toThrow(/must not assign a marker or colour/);
  });
});
