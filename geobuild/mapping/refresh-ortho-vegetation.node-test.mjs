import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { activeGroundResources,excludeReviewedStandCells,individualTurfIntersections,nearRing,reviewedPlayingAreas,writeOrthoVegetation } from './refresh-ortho-vegetation.mjs';
import { applyOrthoReview,ringGeometrySha256 } from './apply-ortho-review.mjs';

const area={id:'h1-green',ring:[[0,0],[4,0],[4,4],[0,4]],bounds:[0,0,4,4]};
test('replacement graphs omit superseded stand bytes while retaining shared old chunks and protected layers',()=>{
  const ref=url=>({url}),resources=new Map(['shell','terrain-a','terrain-b','surface','objects','old-stands'].map(url=>[url,Buffer.from(url)]));
  const ground={shell:ref('shell'),tiles:[
    {id:'a',layers:{terrain:ref('terrain-a'),surface:ref('surface'),objects:ref('objects'),stands:ref('old-stands')}},
    {id:'b',parentId:'a',layers:{terrain:ref('terrain-b'),stands:ref('old-stands')}}]};
  const partiallyReplaced=activeGroundResources(resources,ground,{a:ref('new-stands-a'),b:ref('old-stands')});
  assert.deepEqual([...partiallyReplaced.keys()],[...resources.keys()],'unchanged tile still references the shared old stand chunk');
  const fullyReplaced=activeGroundResources(resources,ground,{a:ref('new-stands-a'),b:ref('new-stands-b')});
  assert.equal(fullyReplaced.has('old-stands'),false);
  assert.deepEqual([...fullyReplaced.keys()],['shell','terrain-a','terrain-b','surface','objects']);
  assert.equal(resources.has('old-stands'),true,'input resources and immutable rollback assets remain untouched');
  assert.equal(ground.tiles[1].parentId,'a');
});

test('accepted local rings enter the grid with meridian convergence, only after model adoption',()=>{
  const frame={origin:{lat:63.2845,lon:18.6735},mPerLat:111320,mPerLon:50045.09};
  const ring=[[0,0],[100,0],[100,-10],[0,-10]];
  const model={...frame,holes:[{n:1,line:[[50,50],[50,-5]],green:{ring,c:[50,-5]},pin:[50,-5]}]};
  const review={schemaVersion:1,groundId:'veckefjarden',frame,features:[{id:'h1-green',status:'accepted',hole:1,kind:'green',ring,
    originalRingSha256:ringGeometrySha256(ring),evidence:{sourceFiles:[{path:'cache/ortho.tif',sha256:'a'.repeat(64)}],sourceCaptureDates:['2024-06-27'],uncertaintyM:1}}]};
  assert.throws(()=>reviewedPlayingAreas(model,review),/Apply accepted orthophoto geometry/);
  const areas=reviewedPlayingAreas(applyOrthoReview(model,review),review),[a,b]=areas[0].ring;
  assert.ok(Math.abs(a[0]-684183.801986)<.002);assert.ok(Math.abs(a[1]-7022564.696685)<.002);
  assert.ok(b[1]-a[1]>5.7&&b[1]-a[1]<5.8,'100m east must carry grid convergence, not a translation-only bridge');
});

test('a complete tee inventory excludes every accepted platform without retaining discarded source pads',()=>{
  const frame={origin:{lat:63.2845,lon:18.6735},mPerLat:111320,mPerLon:50045.09};
  const model={...frame,holes:[{n:1,line:[[0,0],[0,100]],tees:{pads:[{ring:[[0,0],[1,0],[1,1],[0,1]],c:[.5,.5]}],marks:[{c:[0,0],m:100}]}}]};
  const pads=[{id:'north',ring:[[10,0],[14,0],[14,4],[10,4]]},{id:'south',ring:[[10,10],[14,10],[14,14],[10,14]]}];
  const review={schemaVersion:1,groundId:'veckefjarden',frame,features:[{id:'h1-platforms',status:'accepted',hole:1,kind:'tee-set',pads,
    originalRingSha256:ringGeometrySha256(model.holes[0].tees.pads.map(pad=>pad.ring)),
    evidence:{sourceFiles:[{path:'cache/ortho.tif',sha256:'a'.repeat(64)}],sourceCaptureDates:['2024-06-27'],uncertaintyM:1}}]};
  const areas=reviewedPlayingAreas(applyOrthoReview(model,review),review);
  assert.equal(areas.length,2);assert.ok(areas.every(a=>a.id==='h1-platforms'&&a.kind==='tee-set'));
  assert.ok(areas.every(a=>a.ring[0][0]>684190),'only replacement platforms reach the grid');
});

test('stand exclusions include jitter margin and preserve all measured bytes and prior flags',()=>{
  const header={bounds:{minEasting:0,maxEasting:16,minNorthing:0,maxNorthing:4},standField:{width:4,height:1,cellMetres:4}};
  const source=Uint8Array.from([128,12,24,3,80,20,32,1,99,11,22,3,90,9,18,5]);
  const result=excludeReviewedStandCells(header,source,[area]);
  assert.equal(result.changed,2);assert.equal(result.eligibleCanopyRemoved,2);
  assert.deepEqual([...result.payload],[128,12,24,7,80,20,32,5,99,11,22,3,90,9,18,5]);
  assert.deepEqual([...source],[128,12,24,3,80,20,32,1,99,11,22,3,90,9,18,5]);
  assert.equal(excludeReviewedStandCells(header,result.payload,[area]).changed,0);
  assert.deepEqual(excludeReviewedStandCells(header,result.payload,[]).payload,result.payload);
});

test('distance checks include the closing edge of an open source ring',()=>{
  assert.equal(nearRing(-1,2,area.ring,1.01),true);
  assert.equal(nearRing(-1,2,area.ring,.99),false);
  assert.equal(nearRing(0,2,area.ring),true);
});

test('individual crown centres on reviewed turf block publication and report exact IDs without removal',()=>{
  const records=[{id:'inside',class:'tree',easting:2,northing:2},{id:'edge',class:'tree',easting:0,northing:2},{id:'outside',class:'tree',easting:8,northing:2},{id:'non-tree',class:'building',easting:2,northing:2}];
  const original=structuredClone(records),hits=individualTurfIntersections(records,[area]);
  assert.deepEqual(hits.map(h=>h.id),['inside','edge']);
  assert.deepEqual(hits[0].reviewIds,['h1-green']);assert.deepEqual(records,original);
  assert.throws(()=>writeOrthoVegetation({blocked:true}),/Individual crowns intersect/);
});

test('malformed stand lattices fail rather than changing an incorrectly indexed payload',()=>{
  const header={bounds:{minEasting:0,maxEasting:4,minNorthing:0,maxNorthing:4},standField:{width:1,height:1,cellMetres:4}};
  assert.throws(()=>excludeReviewedStandCells(header,new Uint8Array(3),[area]),/lattice/);
  assert.throws(()=>excludeReviewedStandCells({...header,standField:{width:0,height:1,cellMetres:4}},new Uint8Array(0),[area]),/lattice/);
});

test('publication checks source snapshots and immutable chunks before replacing the shared root',t=>{
  const repoRoot=fs.mkdtempSync(path.join(os.tmpdir(),'veckefjarden-ortho-vegetation-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(repoRoot)),path.resolve(os.tmpdir()));fs.rmSync(repoRoot,{recursive:true,force:true});});
  const publicDir=path.join(repoRoot,'public'),rootPath=path.join(publicDir,'courses/v2-index.json');
  fs.mkdirSync(path.dirname(rootPath),{recursive:true});fs.writeFileSync(rootPath,'old-root');
  const sourcePath=path.join(repoRoot,'review.json');fs.writeFileSync(sourcePath,'reviewed-source');
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const plan={repoRoot,publicDir,blocked:false,report:{review:'accepted'},
    snapshots:new Map([[sourcePath,hash(fs.readFileSync(sourcePath))],[rootPath,hash(fs.readFileSync(rootPath))]]),
    writes:new Map([['grounds/veckefjarden/stands/new.bvch',Buffer.from('new-stand')],['courses/v2-index.json',Buffer.from('new-root')]])};
  fs.writeFileSync(sourcePath,'changed-source');
  assert.throws(()=>writeOrthoVegetation(plan),/Input changed/);assert.equal(fs.readFileSync(rootPath,'utf8'),'old-root');
  fs.writeFileSync(sourcePath,'reviewed-source');
  const immutable=path.join(publicDir,'grounds/veckefjarden/stands/new.bvch');
  fs.mkdirSync(path.dirname(immutable),{recursive:true});fs.writeFileSync(immutable,'conflict');
  assert.throws(()=>writeOrthoVegetation(plan),/Immutable resource differs/);assert.equal(fs.readFileSync(rootPath,'utf8'),'old-root');
  fs.writeFileSync(immutable,'new-stand');writeOrthoVegetation(plan);
  assert.equal(fs.readFileSync(rootPath,'utf8'),'new-root');
  assert.equal(fs.readFileSync(immutable,'utf8'),'new-stand');
  assert.equal(JSON.parse(fs.readFileSync(path.join(repoRoot,'geo_data/course-v2/veckefjarden/vegetation/lm-ortho-exclusion-review.json'))).review,'accepted');
});
