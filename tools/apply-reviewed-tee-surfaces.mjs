/* Adopt reviewed physical tee decks without moving a course's card references.
 * applyReviewedTeeSurfaces(model, evidenceFiles) returns a new model. Every source
 * hole must match the archived pads, route, marks and distances used for review.
 * Partial reviews must explicitly retain or retire each original pad index.
 * Pixel/projected coordinates and review-only geometry never enter the model.
 */
import assert from 'node:assert/strict';

const frameOf = m => ({ origin: m.origin, mPerLat: m.mPerLat, mPerLon: m.mPerLon });
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (a, b, p) => Math.abs(cross(a, b, p)) < 1e-9
  && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0])
  && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
const intersect = (a, b, c, d) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
  || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);

function surfaceGeometry(feature) {
  const r = feature.ring;
  assert(Array.isArray(r) && r.length >= 3 && r.every(point), `${feature.id}: invalid local ring`);
  let area2 = 0, cx = 0, cz = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    assert(a[0] !== b[0] || a[1] !== b[1], `${feature.id}: repeated vertex`);
    const v = a[0] * b[1] - b[0] * a[1];
    area2 += v; cx += (a[0] + b[0]) * v; cz += (a[1] + b[1]) * v;
    for (let j = i + 2; j < r.length; j++) {
      if (i === 0 && j === r.length - 1) continue;
      assert(!intersect(a, b, r[j], r[(j + 1) % r.length]), `${feature.id}: self-intersecting ring`);
    }
  }
  assert(Math.abs(area2) >= 2, `${feature.id}: degenerate tee surface`);
  return { ring: structuredClone(r), cx: cx / (3 * area2), cz: cz / (3 * area2), area: Math.abs(area2) / 2, ang: 0 };
}

export function applyReviewedTeeSurfaces(model, evidenceFiles) {
  const replacements = new Map(), seenIds = new Set();
  for (const evidence of evidenceFiles) {
    assert.equal(evidence.schemaVersion, 1, 'unsupported tee review schema');
    assert.deepEqual(frameOf(model), evidence.frame, 'tee review frame changed');
    assert(Array.isArray(evidence.holes) && Array.isArray(evidence.features), 'tee review requires holes and features');
    const sources = new Map((evidence.sources || []).map(s => [s.id, s]));
    assert.equal(sources.size, (evidence.sources || []).length, 'duplicate tee imagery source');
    const reviewed = new Set();
    for (const record of evidence.holes) {
      const h = model.holes.find(h => h.n === record.hole);
      assert(h && !reviewed.has(h.n) && !replacements.has(h.n), `unknown or duplicate reviewed hole ${record.hole}`);
      reviewed.add(h.n);
      assert.deepEqual(h.tees.pads, record.originalPads, `hole ${h.n}: tee source changed since review`);
      assert.deepEqual(h.line, record.originalLine, `hole ${h.n}: route changed since review`);
      assert.deepEqual(h.tees.marks, record.originalMarks, `hole ${h.n}: marker references changed since review`);
      assert.deepEqual(h.t, record.originalDistances, `hole ${h.n}: card distances changed since review`);
      assert(['complete-visible', 'partial'].includes(record.coverage), `hole ${h.n}: missing review coverage`);
      let retained = [];
      if (record.coverage === 'partial') {
        assert(Array.isArray(record.retainOriginalPadIndices) && Array.isArray(record.retireOriginalPadIndices),
          `hole ${h.n}: partial review must account for every original pad`);
        const indices = [...record.retainOriginalPadIndices, ...record.retireOriginalPadIndices].sort((a, b) => a - b);
        assert.deepEqual(indices, h.tees.pads.map((_, i) => i), `hole ${h.n}: partial review has missing or duplicate original pad indices`);
        retained = record.retainOriginalPadIndices.map(i => ({ ...structuredClone(h.tees.pads[i]), preserveTerrain: true }));
      }
      const accepted = evidence.features.filter(f => f.hole === h.n).map(f => {
        assert(f.status === 'accepted' && typeof f.id === 'string' && !seenIds.has(f.id), `invalid or duplicate tee surface ${f.id}`);
        assert(f.teeColour == null && f.teeIdx == null && f.dailyMarkerPosition == null, `${f.id}: a deck cannot assign physical markers or colours`);
        const source = sources.get(f.sourceId);
        assert(source && /^[a-f0-9]{64}$/.test(f.sourceSha256) && source.sha256 === f.sourceSha256,
          `${f.id}: missing or inconsistent dated imagery source`);
        assert.equal(source.year, f.observedYear, `${f.id}: imagery year mismatch`);
        assert(Number.isFinite(f.boundaryInterpretationUncertaintyMetres) && f.boundaryInterpretationUncertaintyMetres > 0,
          `${f.id}: boundary interpretation uncertainty required`);
        assert.equal(f.sourceAbsoluteHorizontalAccuracyMetres, null, `${f.id}: absolute source accuracy is unknown`);
        seenIds.add(f.id);
        return { ...surfaceGeometry(f), prov: 'dated-orthophoto-trace', sourceId: f.id,
          imagerySourceId: f.sourceId, observedYear: f.observedYear, crosscheckYear: f.crosscheckYear,
          sourceSha256: f.sourceSha256, boundaryInterpretationUncertaintyMetres: f.boundaryInterpretationUncertaintyMetres,
          sourceAbsoluteHorizontalAccuracyMetres: null, centreProvenance: 'polygon area centroid; not a tee marker', preserveTerrain: true };
      });
      assert(accepted.length || retained.length, `hole ${h.n}: review leaves no physical tee evidence`);
      replacements.set(h.n, { ...h.tees, pads: [...retained, ...accepted], inferPads: false,
        mappingCoverage: record.coverage, markProvenance: 'scorecard-distance inference; daily marker positions and deck colours unverified' });
    }
    assert(evidence.features.every(f => reviewed.has(f.hole)), 'tee surface has no reviewed source hole');
  }
  return { ...model, holes: model.holes.map(h => replacements.has(h.n) ? { ...h, tees: replacements.get(h.n) } : h) };
}
