import test from 'node:test';
import assert from 'node:assert/strict';
import {applyEstateReview} from './apply-estate-review.mjs';
import {geometrySha256} from './apply-ortho-review.mjs';

const ring=[[0,0],[10,0],[10,12],[0,12]],next=[[1,1],[9,1],[9,11],[1,11]];
const model=()=>({origin:{lat:59.72733,lon:18.19202},mPerLat:111320,mPerLon:56118.16,
  scenery:{practiceGreens:[structuredClone(ring)],greens:[structuredClone(ring)]},
  infra:{paths:[{id:'walk',line:[[0,0],[20,0]],w:2}]},water:[{ring,level:12.3}]});
const review=m=>({schemaVersion:1,groundId:'johannesberg',frame:{origin:m.origin,mPerLat:m.mPerLat,mPerLon:m.mPerLon},
  features:[{id:'practice',kind:'practice-green',status:'accepted',action:'replace',closed:true,
    modelPath:'/scenery/practiceGreens/0',targetPaths:['/scenery/practiceGreens/0','/scenery/greens/0'],
    originalRingSha256:geometrySha256(ring),ring:next,
    evidence:{sourceFiles:[{path:'private.png',sha256:'a'.repeat(64)}],sourceCaptureDates:['2025-06-14'],uncertaintyM:1,note:'Visible putting boundary, with collar excluded.'}}]});

test('estate review updates duplicate practice geometry atomically and preserves water/paths',()=>{
  const m=model(),r=review(m),before=structuredClone(m),out=applyEstateReview(m,r);
  assert.deepEqual(out.scenery.practiceGreens,[next]);assert.deepEqual(out.scenery.greens,[next]);
  assert.deepEqual(out.water,m.water);assert.deepEqual(out.infra.paths,m.infra.paths);
  assert.deepEqual(m,before);assert.deepEqual(applyEstateReview(out,r),out);
  m.scenery.greens[0][0][0]=99;const drift=structuredClone(m);
  assert.throws(()=>applyEstateReview(m,r),/baseline changed/);assert.deepEqual(m,drift);
});

test('estate pointers cannot change terrain, routing or object prototypes',()=>{
  for(const pointer of ['/water/0/level','/holes/0/line','/__proto__/polluted']) {
    const m=model(),r=review(m);r.features[0].modelPath=pointer;r.features[0].targetPaths=[pointer];
    assert.throws(()=>applyEstateReview(m,r),/unsupported geometry pointer/);
  }
});
