import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOrthoReview,geometrySha256} from './apply-ortho-review.mjs';
import {withInferredTeePads} from '../../apps/golf/src/engine/tee-pads.mjs';
import {buildGroundSurfaceFeatures} from '../../apps/golf/src/engine/surface-features.mjs';
import {SURFACE} from '../../apps/golf/src/engine/surface.js';

const ring=(x,z)=>[[x,z],[x+7,z-1],[x+12,z+2],[x+10,z+8],[x+6,z+11],[x,z+8]];
function fixture(){
 return {origin:{lat:59.72733,lon:18.19202},mPerLat:111320,mPerLon:56118.16,infra:{},
 holes:Array.from({length:18},(_,i)=>({n:i+1,t:[150],line:[[0,i*200],[150,i*200]],green:{ring:ring(145,i*200-5),c:[150,i*200]},
 fairway:{rings:[ring(50,i*200)]},tees:{pads:[{ring:ring(-5,i*200-5)}],marks:[{c:[60,i*200],b:90,m:150}]},
 bunkers:[{ring:ring(130,i*200+30)}]}))};
}
function review(m,features){return {schemaVersion:1,groundId:'johannesberg',course:'johannesberg',frame:{origin:m.origin,mPerLat:m.mPerLat,mPerLon:m.mPerLon},features};}
function addedTee(){return {id:'observed-forward-tee',hole:1,kind:'tee',action:'add',index:1,status:'accepted',originalRingSha256:geometrySha256(null),ring:ring(25,0),
 evidence:{sourceFiles:[{path:'source.png',sha256:'a'.repeat(64)}],sourceCaptureDates:['2025-06-14'],uncertaintyM:1,note:'Visible physical tee; inherited obscured tee remains unverified.'}};}

test('an observed tee addition retains obscured pads without generating more runtime decks',()=>{
 const m=fixture(),f=addedTee(),out=applyOrthoReview(m,review(m,[f]));
 assert.deepEqual(out.holes[0].tees.pads[0],m.holes[0].tees.pads[0]);
 assert.deepEqual(out.holes[0].tees.pads[1].ring,f.ring);
 assert.equal(out.holes[0].tees.inferPads,false);
 assert.equal(withInferredTeePads(out.holes)[0].tees.pads.length,2);
 assert.deepEqual(out.holes[0].tees.marks.map(x=>x.c),m.holes[0].tees.marks.map(x=>x.c));
 assert.deepEqual(applyOrthoReview(out,review(m,[f])),out);
});

test('review boundary policy reaches compiler polygons and removes bunker padding',()=>{
 const m=fixture(),f=addedTee(),out=applyOrthoReview(m,review(m,[f]));
 const features=buildGroundSurfaceFeatures({holes:out.holes,model:out,smoothEdges:true,inferTeePads:true});
 const owned=surface=>features.find(x=>x.hole===1&&x.surface===surface);
 assert.deepEqual(owned(SURFACE.GREEN).rings,[m.holes[0].green.ring]);
 assert.deepEqual(owned(SURFACE.FAIRWAY).rings,m.holes[0].fairway.rings);
 assert.deepEqual(owned(SURFACE.SAND).rings,m.holes[0].bunkers.map(x=>x.ring));
 assert.equal(owned(SURFACE.SAND).pad,0);
 assert.deepEqual(owned(SURFACE.TEE).rings,[m.holes[0].tees.pads[0].ring,f.ring]);
});
