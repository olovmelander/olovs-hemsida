import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { localPoint } from './apply-orthophoto-review.mjs';
import { withInferredTeePads } from '../../apps/golf/src/engine/tee-pads.mjs';
import { reviewedTeeMarkerPositions } from '../../apps/golf/src/engine/reviewed-tee-marker-placement.mjs';
import { inRing } from '../../apps/golf/src/engine/geom.js';
import { collectCoordinatePairs } from '../../packages/course-geo/migration.mjs';
import { renderReviewedClubhouse, renderReviewedFacilities } from '../../apps/golf/src/engine/scenery/norrfallsviken-architecture.mjs';
const model=JSON.parse(fs.readFileSync(new URL('../course-model.json',import.meta.url),'utf8'));
test('frozen frame rejects local coordinates presented as grid coordinates',()=>{
  assert.throws(()=>localPoint(model,[0,0]),/EPSG:3006/);
  const origin=localPoint(model,[678970.625,6988556.634]);
  assert(Math.hypot(...origin)<.002);
});
test('reviewed platforms survive runtime without invented decks or colliding marker colours',()=>{
  const holes=withInferredTeePads(model.holes);
  assert.deepEqual(holes.map(h=>h.tees.pads),model.holes.map(h=>h.tees.pads));
  for(const h of holes) {
    const positions=[];
    for(const m of h.tees.marks) {
      const pair=reviewedTeeMarkerPositions(h,m);
      if(m.orthophotoReference.kind==='unresolved-guide-tee-reference'){assert.equal(pair.length,0);continue;}
      assert.equal(pair.length,2,`H${h.n}: accepted reference must render`);
      const pad=h.tees.pads.find(p=>p.id===m.sourcePadId);
      for(const p of pair){assert(inRing(...p,pad.ring));assert(positions.every(q=>Math.hypot(p[0]-q[0],p[1]-q[1])>=.35));}
      positions.push(...pair);
      const target=h.green.c;
      const angle=m.b*Math.PI/180,dx=target[0]-m.c[0],dz=target[1]-m.c[1];
      const alignment=(Math.sin(angle)*dx+Math.cos(angle)*dz)/Math.hypot(dx,dz);
      assert(alignment>0,`H${h.n}: camera must face the green's half-plane (${alignment})`);
    }
  }
});
test('shared green has one boundary and two contained lobe references',()=>{
  assert.deepEqual(model.holes[3].green.ring,model.holes[7].green.ring);
  assert.notDeepEqual(model.holes[3].green.c,model.holes[7].green.c);
  for(const n of [3,7])assert(inRing(...model.holes[n].green.c,model.holes[n].green.ring));
});
test('boundary islands and all new geometry can migrate without classifying scorecard as coordinates',()=>{
  const {coordinates}=collectCoordinatePairs(model);
  assert(coordinates.some(c=>c.path==='courseBoundary.holes.[].[]'));
  assert(!coordinates.some(c=>c.path.endsWith('.t')));
});
test('clubhouse and measured range facilities emit finite geometry at the source footprints',()=>{
  const triangles=[],args={features:model.scenery.mappedFeatures,terrainH:()=>10,tri:(...t)=>triangles.push(t),L:c=>c};
  const result=renderReviewedClubhouse({...args,building:model.infra.buildings.find(b=>b.id==='w1205924894')});
  assert(result.triangles>50);
  assert.equal(renderReviewedClubhouse({...args,building:{id:'unrelated'}}),null);
  const facilities=renderReviewedFacilities({...args,buildings:model.infra.buildings});
  assert.equal(facilities.counts.range_mat,12);
  assert.equal(facilities.counts.range_target_surface,3);
  for(const tri of triangles)for(const p of tri.slice(0,3))assert(p.every(Number.isFinite));
});
