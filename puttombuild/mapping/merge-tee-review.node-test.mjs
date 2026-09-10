import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeReviewedHole } from './merge-tee-review.mjs';

const prior = () => ({ n: 7, tees: [{ id: 'rear', replaceIndex: 0, sourceKey: '2024',
  ringPixels: [[0,0],[100,0],[100,100],[0,0]], numberedSourceAssetId: 'club-plan',
  cameraReferencesPixels: { 'tee-61': [30,30] } }], cameraReferences: [
  { id: 'forward-anchor', teeKey: 'tee-48', sourceKey: '2024', pointPixels: [200,200] }
] });

test('adding a numbered station keeps the original platform trace and prior stations intact', () => {
  const before = prior();
  const result = mergeReviewedHole(before, { n:7, teeReferenceAdditions: [{ platformReviewId:'rear',
    cameraReferencesPixels:{'tee-57':[40,40]},numberedSourceAssetId:'club-plan',reviewNotes:'Same visible platform, confirmed by numbered plan.' }] });
  assert.deepEqual(result.tees[0].ringPixels, before.tees[0].ringPixels);
  assert.deepEqual(result.tees[0].cameraReferencesPixels, {'tee-61':[30,30],'tee-57':[40,40]});
  assert.deepEqual(before, prior());
});

test('promotion of an earlier point to a traced platform retains superseded source evidence', () => {
  const tee = {id:'forward-pad',replaceIndex:1,sourceKey:'2022',ringPixels:[[150,150],[250,150],[250,250],[150,150]],
    cameraReferencesPixels:{'tee-48':[201,200]},numberedSourceAssetId:'club-plan'};
  assert.throws(()=>mergeReviewedHole(prior(),{n:7,tees:[tee]}),/supersession/);
  const result=mergeReviewedHole(prior(),{n:7,tees:[{...tee,supersedes:true,reviewNotes:'Earlier midday image reveals same persistent platform.'}]});
  assert.equal(result.cameraReferences.length,0);
  assert.equal(result.tees.length,2);
  assert.equal(result.supersededTeeReferences[0].sourceKey,'2024');
  assert.deepEqual(result.supersededTeeReferences[0].pointPixels,[200,200]);
});

test('stale platform identifiers and accidental boundary replacement are rejected', () => {
  assert.throws(()=>mergeReviewedHole(prior(),{n:7,tees:[{id:'wrong',replaceIndex:0}]}),/already traced/);
  assert.throws(()=>mergeReviewedHole(prior(),{n:7,teeReferenceAdditions:[{platformReviewId:'missing'}]}),/existing platform/);
  assert.throws(()=>mergeReviewedHole(prior(),{n:8}),/mismatch/);
});

test('an unchanged reference can be reconfirmed but a changed coordinate requires supersession', () => {
  const amendment={platformReviewId:'rear',cameraReferencesPixels:{'tee-61':[30,30]},numberedSourceAssetId:'club-plan',reviewNotes:'Same station confirmed in another image.'};
  const result=mergeReviewedHole(prior(),{n:7,teeReferenceAdditions:[amendment]});
  assert.deepEqual(result.tees[0].cameraReferencesPixels['tee-61'],[30,30]);
  assert.equal(result.supersededTeeReferences,undefined);
  amendment.cameraReferencesPixels['tee-61']=[31,30];
  assert.throws(()=>mergeReviewedHole(prior(),{n:7,teeReferenceAdditions:[amendment]}),/supersession/);
});
