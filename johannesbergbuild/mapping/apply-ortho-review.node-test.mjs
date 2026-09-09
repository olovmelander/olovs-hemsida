import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOrthoReview, geometrySha256, validateRing} from './apply-ortho-review.mjs';
import {excludeOwnedScenery, holeScenery, sceneryRingHashes} from './scenery-ownership.mjs';

const rectangle = (x, z, w=12, h=10) => [[x,z],[x+w,z],[x+w,z+h],[x,z+h]];
function fixture() {
  return {
    origin:{lat:59.72733,lon:18.19202}, mPerLat:111320,mPerLon:56118.16,
    infra:{paths:[{line:[[1,2],[3,4]]}]},
    holes:Array.from({length:18},(_,i)=>({
      n:i+1,t:[100,80],line:[[0,i*100],[100,i*100]],lineLen:100,lenDev:0,
      green:{ring:rectangle(95,i*100-5),c:[100,i*100],area:120},pin:[100,i*100],
      fairway:{rings:[rectangle(20,i*100-5,65,10)]},
      tees:{pads:[{ring:rectangle(-3,i*100-3,6,6),cx:0,cz:i*100}],marks:[{c:[0,i*100],m:100}]},
      bunkers:[0,1,2].map(j=>({ring:rectangle(75+j*15,i*100+15,5,4),prov:'sat'})),
      elev:{tee:10,green:11,rise:1},
    })),
  };
}
const evidence = {sourceFiles:[{path:'johannesbergbuild/cache/lm-ortho/eighteen-01-surfaces.png',sha256:'a'.repeat(64)}],
  sourceCaptureDates:['2025-06-14'],uncertaintyM:0.5,note:'Visible maintained surface boundary traced in the dated source image.'};
function feature(kind, original, geometry, extra={}) {
  return {id:`h1-${kind}`,hole:1,kind,status:'accepted',originalRingSha256:geometrySha256(original),
    ...(['fairway','tees'].includes(kind)?{rings:geometry}:{ring:geometry}),evidence,...extra};
}
function review(model, features) {
  return {schemaVersion:1,groundId:'johannesberg',course:'johannesberg',
    frame:{origin:model.origin,mPerLat:model.mPerLat,mPerLon:model.mPerLon},features};
}

test('later baseline drift rejects the whole review without mutating the input',()=>{
  const model=fixture(),before=structuredClone(model),h=model.holes[0];
  const good=feature('green',h.green.ring,rectangle(94,-6));
  const stale=feature('fairway',[rectangle(999,999)], [rectangle(20,-8,66,16)]);
  assert.throws(()=>applyOrthoReview(model,review(model,[good,stale])),/baseline geometry changed/);
  assert.deepEqual(model,before);
});

test('moved green target changes only the route end and recomputes measured length and elevation',()=>{
  const model=fixture(),before=structuredClone(model),h=model.holes[0];
  const f=feature('green',h.green.ring,rectangle(120,-5),{target:[125,0]});
  assert.throws(()=>applyOrthoReview(model,review(model,[f])),/terrain sampler/);
  assert.deepEqual(model,before);
  const out=applyOrthoReview(model,review(model,[f]),{heightAt:(x,z)=>10+x*.02+z*.01});
  assert.deepEqual(out.holes[0].line,[[0,0],[125,0]]);
  assert.deepEqual(out.holes[0].tees,h.tees);
  assert.deepEqual(out.holes[0].t,[100,80]);
  assert.deepEqual(out.holes[0].pin,[125,0]);
  assert.equal(out.holes[0].lineLen,125);
  assert.equal(out.holes[0].lenDev,25);
  assert.deepEqual(out.holes[0].elev,{tee:10,green:12.5,rise:2.5});
  assert.deepEqual(model,before);
});

test('multiple bunker removals preserve untouched indexes and remain idempotent',()=>{
  const model=fixture(),h=model.holes[0];
  const features=[0,2].map(index=>feature('bunker',h.bunkers[index].ring,null,
    {id:`h1-remove-${index}`,index,action:'remove'}));
  const r=review(model,features),out=applyOrthoReview(model,r);
  assert.deepEqual(out.holes[0].bunkers,[h.bunkers[1]]);
  assert.equal(out.orthophotoReview.retired.length,2);
  assert.deepEqual(applyOrthoReview(out,r),out);
});

test('bunker replacements survive index shifts from removals when a review is reapplied',()=>{
  const model=fixture(),h=model.holes[0];
  const replacement=rectangle(98,18,8,5);
  const r=review(model,[
    feature('bunker',h.bunkers[0].ring,null,{id:'remove-first',index:0,action:'remove'}),
    feature('bunker',h.bunkers[2].ring,replacement,{id:'replace-third',index:2}),
  ]);
  const out=applyOrthoReview(model,r);
  assert.deepEqual(out.holes[0].bunkers.map(b=>b.ring),[h.bunkers[1].ring,replacement]);
  assert.deepEqual(applyOrthoReview(out,r),out);
});

test('a newly observed bunker appends once without replacing an existing bunker',()=>{
  const model=fixture(),h=model.holes[0],added=rectangle(115,20,8,5);
  const r=review(model,[feature('bunker',null,added,{id:'added-bunker',index:3,action:'add'})]);
  const out=applyOrthoReview(model,r);
  assert.deepEqual(out.holes[0].bunkers.slice(0,3),h.bunkers);
  assert.deepEqual(out.holes[0].bunkers[3].ring,added);
  assert.deepEqual(applyOrthoReview(out,r),out);
});

test('review rejects crossing boundaries and targets outside the putting surface',()=>{
  assert.throws(()=>validateRing([[0,0],[10,8],[0,10],[8,0]]),/self-intersection/);
  const model=fixture(),h=model.holes[0];
  const f=feature('green',h.green.ring,rectangle(120,-5),{target:[100,0]});
  assert.throws(()=>applyOrthoReview(model,review(model,[f]),{heightAt:()=>10}),/outside putting surface/);
});

test('explicit scenery ownership removes old surfaces after a large move and preserves practice geometry',()=>{
  const old=fixture().holes.slice(0,9),shared=holeScenery(old),practice=rectangle(96,-4,4,4);
  const scenery={...shared,greens:[practice,...shared.greens],practiceGreens:[practice],
    ownerRingHashes:{'johannesberg-9':sceneryRingHashes(old)}};
  const moved=structuredClone(old); moved[0].green.ring=rectangle(160,80);
  const out=excludeOwnedScenery(scenery,'johannesberg-9');
  assert.deepEqual(out.greens,[practice]);
  assert.deepEqual(out.practiceGreens,[practice]);
  assert.deepEqual(out.fairways,[]);
  assert.deepEqual(out.tees,[]);
  assert.deepEqual(out.bunkers,[]);
  assert.deepEqual(holeScenery(moved).greens[0],rectangle(160,80));
  const drift=structuredClone(scenery); drift.greens.pop();
  assert.throws(()=>excludeOwnedScenery(drift,'johannesberg-9'),/Stale/);
});
