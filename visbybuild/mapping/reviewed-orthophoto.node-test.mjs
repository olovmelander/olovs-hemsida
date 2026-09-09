import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyReviewedOrthophoto, orthophotoRing } from './reviewed-orthophoto.mjs';
import { excludeReviewedStandCells } from './orthophoto-vegetation.mjs';
import { pointInPoly } from '../../geobuild/lib.mjs';
const read = name => JSON.parse(fs.readFileSync(new URL(name,import.meta.url)));
const review = read('./orthophoto-review-2026.json'), geometry = read('./geometry.json');

test('dated source traces survive reapplication and keep H9 target on the actual northern green', () => {
  const adopted = applyReviewedOrthophoto(geometry,review);
  assert.deepEqual(applyReviewedOrthophoto(adopted,review),adopted);
  const h9 = adopted.holes[8];
  assert.ok(Math.hypot(h9.green.reference[0]-687219.20,h9.green.reference[1]-6370835.84)<.001);
  assert.deepEqual(h9.line.at(-1),h9.green.reference);
  assert.ok(pointInPoly(...h9.green.reference,h9.green.ring));
  assert.equal(pointInPoly(687205.25,6370789.75,h9.green.ring),false);
  assert.equal(adopted.holes.reduce((s,h)=>s+h.tees.pads.length,0),48);
  assert.equal(adopted.holes.reduce((s,h)=>s+h.bunkers.length,0)+adopted.scenery.bunkers.length,84);
});

test('out-of-image coordinates and missing source hashes cannot become accepted traces', () => {
  const entry = structuredClone(review.holes.find(h=>h.n===3).green);
  entry.ringPixels[1][0] = review.sources[entry.sourceKey].width+1;
  assert.throws(()=>orthophotoRing(review,entry),/coordinates/);
  const bad = structuredClone(review);bad.sources[entry.sourceKey].sha256 = 'missing';
  assert.throws(()=>orthophotoRing(bad,entry),/checked source/);
});

test('stand exclusion protects cell jitter at a turf edge and preserves measured channels and campaign flags', () => {
  const h = {bounds:{minEasting:0,maxEasting:12,minNorthing:0,maxNorthing:4},
    standField:{width:3,height:1,cellMetres:4}};
  const p = Uint8Array.from([128,12,24,3, 80,20,32,1, 99,11,22,3]);
  const ring = [[0,0],[4,0],[4,4],[0,4],[0,0]];
  const areas = [{ring,bounds:[0,0,4,4]}];
  const r = excludeReviewedStandCells(h,p,areas);
  assert.equal(r.changed,2);
  assert.deepEqual([...r.payload],[128,12,24,7,80,20,32,5,99,11,22,3]);
  assert.equal(excludeReviewedStandCells(h,r.payload,areas).changed,0);
  assert.deepEqual([...p],[128,12,24,3,80,20,32,1,99,11,22,3]);
});
