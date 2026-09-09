import test from 'node:test';
import assert from 'node:assert/strict';
import {assignTeeDisplayAnchors} from './tee-display-anchors.mjs';
import {pointInPoly} from '../lib.mjs';

test('provisional display anchors stay inside real platforms while preserving reference coordinates',()=>{
  const concave=[[0,0],[8,0],[8,2],[2,2],[2,8],[0,8]];
  const narrow=[[20,0],[21.5,0],[21.5,1.5],[20,1.5]];
  const hole={tees:{pads:[{ring:concave},{ring:narrow}],marks:[{c:[9,8],m:200},{c:[40,0],m:170}]}};
  const references=hole.tees.marks.map(m=>[...m.c]);
  assignTeeDisplayAnchors(hole);
  assert.deepEqual(hole.tees.marks.map(m=>m.c),references);
  for(const m of hole.tees.marks)assert(pointInPoly(...m.displayC,hole.tees.pads[m.displayPadIndex].ring));
  assert.match(hole.tees.markerPositionStatus,/unverified/);
  const once=structuredClone(hole);assignTeeDisplayAnchors(hole);assert.deepEqual(hole,once);
});
