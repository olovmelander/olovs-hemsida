import test from 'node:test';
import assert from 'node:assert/strict';
import { auditedBuilds, needsAVerdict, sandAuditErrors, sandAuditOf, sandAuditSummary } from './sand-audit.mjs';

const sha = letter => letter.repeat(64);
const record = () => ({ schemaVersion: 1, groundId: 'demo', imagery: { sourceId: 'orto-2025', captured: '2025-06-14' }, reachMetres: 80, surfaces: { 'demo-a': sha('a'), 'demo-b': sha('b') },
  modelled: { bunker: 40, waste_sand: 2 },
  rings: [{ id: 'a-bunker-03-1', kind: 'bunker', slug: 'demo-a', hole: 3, areaM2: 14, sandShare: 0, sandOutsideM2: 0 }],
  areas: [
    { id: 'sand-001', kind: 'bunker', at: [100, 200], areaM2: 62, slug: 'demo-a', hole: 7, metresFromHole: 12, on: null },
    { id: 'sand-002', kind: 'waste_sand', at: [300, 400], areaM2: 900, slug: 'demo-b', hole: 2, metresFromHole: 60, on: null },
    { id: 'sand-003', kind: 'bunker', at: [500, 600], areaM2: 80, slug: 'demo-b', hole: 5, metresFromHole: 30, on: 'a road or a path' },
  ] });
const now = { 'demo-a': sha('a'), 'demo-b': sha('b') };

test('everything the sand audit names needs a person\'s word, and what the map explains does not', () => {
  const r = record();
  assert.deepEqual(needsAVerdict(r).map(item => item.id), ['a-bunker-03-1', 'sand-001', 'sand-002']);
  const open = sandAuditErrors(r, now, 'demo');
  assert.equal(open.length, 3);
  assert.match(open[0], /a-bunker-03-1 holds 0% sand, with 0 m2 outside its line, and nobody has said why/);
  assert.match(open[1], /62 m2 of bright sand at 100, 200 \(sand-001, 12 m from demo-a 7\) is not in the model/);
  assert.match(open[2], /900 m2 of tan sand/);
  r.rings[0].verdict = 'Sand on both photos, duller than the threshold; drawn by hand.';
  r.areas[0].fault = 'A greenside bunker that was missed: to add to the sand decisions and trace again.';
  r.areas[1].verdict = 'A gravel yard behind the workshop, the same on both photos.';
  assert.deepEqual(sandAuditErrors(r, now, 'demo'), []);
  assert.deepEqual(sandAuditSummary(r), { captured: '2025-06-14', modelled: 42, ringsNamed: 1, areas: 3, onNothingMapped: 2,
    faults: [{ id: 'sand-001', slug: 'demo-a', hole: 7, fault: r.areas[0].fault }], open: [] });
  assert.equal(sandAuditSummary(null), null);
});

test('a sand audit holds only for the outlines it measured, and a word is not a verdict', () => {
  const r = record();
  for (const item of needsAVerdict(r)) item.verdict = 'Looked at on both photos: it is what the note says it is.';
  assert.deepEqual(sandAuditErrors(r, now, 'demo'), []);
  assert.match(sandAuditErrors(r, { ...now, 'demo-b': sha('c') }, 'demo').join('\n'), /the outlines of demo-b changed since the sand was measured/);
  r.areas[0].verdict = 'rock';
  assert.match(sandAuditErrors(r, now, 'demo').join('\n'), /sand-001.*nobody has said what it is/);
  r.areas[0].verdict = 'Bedrock at the shore, the same on both photos.';
  r.areas[0].fault = 'And also a bunker that was missed, says someone else.';
  assert.match(sandAuditErrors(r, now, 'demo').join('\n'), /sand-001 both stands and is a fault/);
  r.areas.push({ ...r.areas[2] });
  assert.match(sandAuditErrors(r, now, 'demo').join('\n'), /sand-003 is listed twice/);
  assert.deepEqual(sandAuditErrors({ schemaVersion: 2 }, now, 'demo'), ['demo: not a sand audit record']);
});

test('every ground traced with the shared tracer has its sand measured against the outlines it has now', () => {
  const builds = auditedBuilds();
  assert.ok(builds.length >= 1);
  for (const build of builds) {
    const { record: found, errors } = sandAuditOf(build);
    assert.deepEqual(errors, [], `${build}: run audit-sand.py, look at its sheets, and give each a verdict (sand-audit.mjs)`);
    assert.ok(found.modelled.bunker > 0);
  }
});
