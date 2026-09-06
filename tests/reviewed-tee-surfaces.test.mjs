import { describe, it, expect } from 'vitest';
import { applyReviewedTeeSurfaces } from '../tools/apply-reviewed-tee-surfaces.mjs';
import { collectCoordinatePairs } from '../packages/course-geo/migration.mjs';

const square = (x, z) => [[x, z], [x + 8, z], [x + 8, z + 6], [x, z + 6]];
function fixture() {
  const model = { origin: { lat: 59.839, lon: 17.4952 }, mPerLat: 111320, mPerLon: 55930.68,
    water: [{ ring: square(40, 40) }], holes: [1, 2].map(n => ({ n, t: [300, 270], line: [[n * 100, 0], [n * 100, -300]],
      tees: { pads: [0, 1].map(i => ({ ring: square(n * 100, i * 12), cx: n * 100 + 4, cz: i * 12 + 3 })),
        marks: [{ c: [n * 100, 0], b: 0 }, { c: [n * 100, -30], b: 0 }] } })) };
  const evidence = { schemaVersion: 1, frame: { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon },
    sources: [{ id: 'image-2025', year: 2025, sha256: 'a'.repeat(64) }],
    holes: model.holes.map(h => ({ hole: h.n, originalPads: structuredClone(h.tees.pads),
      originalLine: structuredClone(h.line), originalMarks: structuredClone(h.tees.marks), originalDistances: h.t.slice(),
      coverage: 'complete-visible' })),
    features: model.holes.map(h => ({ id: `tee-${h.n}`, hole: h.n, status: 'accepted', ring: square(h.n * 100 + 12, 0),
      sourceId: 'image-2025', observedYear: 2025, crosscheckYear: 2024, sourceSha256: 'a'.repeat(64),
      boundaryInterpretationUncertaintyMetres: 1, sourceAbsoluteHorizontalAccuracyMetres: null,
      sourcePixelRing: square(1000, 2000), sourceRingEPSG3006: square(639000, 6636000) })) };
  return { model, evidence };
}

describe('reviewed physical tee surfaces', () => {
  it('adopts exact footprints while preserving terrain, card references and other ground', () => {
    const { model, evidence } = fixture(), before = structuredClone(model);
    const result = applyReviewedTeeSurfaces(model, [evidence]);
    expect(model).toEqual(before);
    expect(result.water).toBe(model.water);
    for (const [i, h] of result.holes.entries()) {
      expect(h.line).toBe(model.holes[i].line);
      expect(h.t).toBe(model.holes[i].t);
      expect(h.tees.marks).toBe(model.holes[i].tees.marks);
      expect(h.tees.inferPads).toBe(false);
      expect(h.tees.pads).toHaveLength(1);
      const p = h.tees.pads[0];
      expect(p.ring).toEqual(evidence.features[i].ring);
      expect(p.preserveTerrain).toBe(true);
      expect(p.area).toBe(48);
      expect(p.sourcePixelRing).toBeUndefined();
      expect(p.sourceRingEPSG3006).toBeUndefined();
      expect(p.teeIdx).toBeUndefined();
      expect(collectCoordinatePairs(p).coordinates.map(c => c.pair)).toEqual(p.ring);
    }
  });

  it('retains unresolved originals only through an explicit partial review', () => {
    const { model, evidence } = fixture();
    Object.assign(evidence.holes[0], { coverage: 'partial', retainOriginalPadIndices: [1], retireOriginalPadIndices: [0] });
    const result = applyReviewedTeeSurfaces(model, [evidence]);
    expect(result.holes[0].tees.pads[0].ring).toEqual(model.holes[0].tees.pads[1].ring);
    expect(result.holes[0].tees.pads[0].sourceId).toBeUndefined();
    expect(result.holes[0].tees.pads[0].preserveTerrain).toBe(true);
    expect(result.holes[0].tees.pads[1].sourceId).toBe('tee-1');
    evidence.holes[0].retireOriginalPadIndices = [];
    expect(() => applyReviewedTeeSurfaces(model, [evidence])).toThrow(/missing or duplicate original pad indices/);
  });

  it.each(['pads', 'line', 'marks', 'distances'])('rejects a changed %s baseline without partially changing earlier holes', field => {
    const { model, evidence } = fixture();
    if (field === 'pads') model.holes[1].tees.pads[0].ring[0][0]++;
    if (field === 'line') model.holes[1].line[0][0]++;
    if (field === 'marks') model.holes[1].tees.marks[0].c[0]++;
    if (field === 'distances') model.holes[1].t[0]++;
    const before = structuredClone(model);
    expect(() => applyReviewedTeeSurfaces(model, [evidence])).toThrow(/changed since review/);
    expect(model).toEqual(before);
  });

  it('refuses invalid contours, duplicate adoption and unsupported marker claims', () => {
    const { model, evidence } = fixture();
    const crossed = structuredClone(evidence);
    const r = crossed.features[0].ring; [r[1], r[2]] = [r[2], r[1]];
    expect(() => applyReviewedTeeSurfaces(model, [crossed])).toThrow(/self-intersecting/);
    expect(() => applyReviewedTeeSurfaces(model, [evidence, evidence])).toThrow(/duplicate reviewed hole/);
    const coloured = structuredClone(evidence); coloured.features[0].teeIdx = 1;
    expect(() => applyReviewedTeeSurfaces(model, [coloured])).toThrow(/cannot assign/);
  });

  it('refuses mismatched imagery provenance and a different local frame', () => {
    const { model, evidence } = fixture();
    const stale = structuredClone(evidence); stale.features[0].sourceSha256 = 'b'.repeat(64);
    expect(() => applyReviewedTeeSurfaces(model, [stale])).toThrow(/inconsistent dated imagery/);
    const wrongYear = structuredClone(evidence); wrongYear.features[0].observedYear = 2024;
    expect(() => applyReviewedTeeSurfaces(model, [wrongYear])).toThrow(/imagery year mismatch/);
    expect(() => applyReviewedTeeSurfaces({ ...model, mPerLat: 111000 }, [evidence])).toThrow(/frame changed/);
  });
});
