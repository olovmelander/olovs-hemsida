import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyReviewedOrthophoto } from './reviewed-orthophoto.mjs';
import { auditAlignment, simpleRingErrors } from './audit-alignment.mjs';

const read = relative => JSON.parse(fs.readFileSync(new URL(relative, import.meta.url)));
function fixture() {
  const baseline = read('../course-model.json'), review = read('./review-tees.json'), card = read('../card.json');
  return { baseline, review, card, model: applyReviewedOrthophoto(baseline, review) };
}

test('alignment audit checks adoption with no raw imagery cache and reports unreviewed marks without promotion', () => {
  const input = fixture();
  // This reference has no reviewed numbered-platform claim in the tee fragment.
  input.model.holes.find(h => h.n === 1).tees.marks[0].c = [2000, 2000];
  const report = auditAlignment({ ...input, baseline: null });
  assert.equal(report.passed, true, JSON.stringify(report.issues));
  assert.equal(report.baselineAvailable, false);
  assert.equal(report.marks.length, 72);
  assert.equal(report.adopted.teePlatforms, 21);
  assert.equal(report.adopted.cameraReferences, 28);
  assert.equal(report.adopted.cameraReferencesWithReviewedPlatform, 22);
  assert.equal(report.adopted.standaloneCameraReferences, 6);
  assert.equal(report.coverage.referencesWithoutReviewedNumberedIdentity, 44);
  assert.equal(report.marks.find(m => m.hole === 1 && m.tee === 'tee-61').status, 'outside-all-mapped-platforms');
  assert.equal(report.correctedCameraMovement.count, 0, 'missing baseline does not fabricate movement measurements');
  assert.ok(report.sourcePixelAgreement.maximumMetres < .01);
  assert.ok(report.runtimeBridgeAgreement.maximumMetres < .16);
});

test('a displaced adopted vertex and a corrected camera outside its platform fail independent gates', () => {
  const input = fixture(), hole = input.model.holes.find(h => h.n === 5);
  const pad = hole.tees.pads.find(p => p.reviewId === 'h05-tee-pad-00-lm2024');
  pad.ring[1][0] += .02;
  hole.tees.marks[2].c = [2000, 2000];
  const report = auditAlignment(input);
  assert.equal(report.passed, false);
  assert.ok(report.issues.some(i => i.gate === 'source-pixel-adoption'));
  assert.ok(report.issues.some(i => i.gate === 'corrected-marker'));
});

test('scorecard metadata and simple topology are checked separately from spatial movement', () => {
  const input = fixture();
  input.model.holes[0].t[0]++;
  const report = auditAlignment(input);
  assert.equal(report.scorecard.exactConservation, false);
  assert.ok(report.issues.some(i => i.gate === 'scorecard'));
  assert.ok(simpleRingErrors([[10, 10], [30, 30], [10, 30], [25, 10], [10, 10]]).some(e => e.includes('intersect')));
  assert.ok(simpleRingErrors([[0, 0], [10, 0], [10, 10], [10, 0], [0, 0]]).some(e => e.includes('repeated')));
});

test('bunker identity survives shifted slots and rejects an incorrect owning hole', () => {
  const input = fixture(), entry = input.review.holes.find(h => h.n === 2);
  const trace = { id: 'synthetic-test-only-bunker', sourceKey: 'hole-02-tees',
    ringPixels: [[500, 400], [530, 400], [530, 430], [500, 430], [500, 400]], replaceIndex: 0 };
  entry.bunkers = [trace];
  input.model = applyReviewedOrthophoto(input.baseline, input.review);
  const owner = input.model.holes.find(h => h.n === 2);
  owner.bunkers.unshift({ ring: [[0, 0], [1, 0], [1, 1], [0, 0]] });
  let report = auditAlignment(input);
  assert.equal(report.passed, true, JSON.stringify(report.issues));
  const index = owner.bunkers.findIndex(b => b.reviewId === trace.id);
  input.model.holes.find(h => h.n === 3).bunkers.push(owner.bunkers.splice(index, 1)[0]);
  report = auditAlignment(input);
  assert.ok(report.issues.some(i => i.gate === 'bunker-ownership'));
});

test('standalone visible-interior anchors retain provisional boundaries without a false containment certificate', () => {
  const input = fixture();
  const before = input.baseline.holes.find(h => h.n === 8).tees.pads[1].ring;
  const hole = input.model.holes.find(h => h.n === 8);
  assert.deepEqual(hole.tees.pads[1].ring, before);
  let report = auditAlignment(input);
  assert.equal(report.passed, true, JSON.stringify(report.issues));
  const anchors = report.marks.filter(m => m.hole === 8 && m.geometryBasis === 'visible-interior-anchor');
  assert.equal(anchors.length, 2);
  assert.ok(anchors.every(m => m.status === 'reviewed-visible-interior-anchor-boundary-unreviewed'));
  hole.tees.marks[0].platformBoundaryReviewed = true;
  report = auditAlignment(input);
  assert.ok(report.issues.some(i => i.gate === 'standalone-marker'));
  hole.tees.marks[0].platformBoundaryReviewed = false;
  hole.tees.pads[1].ring[0][0] += 1;
  report = auditAlignment(input);
  assert.ok(report.issues.some(i => i.gate === 'standalone-marker' && i.message.includes('changed')));
});
