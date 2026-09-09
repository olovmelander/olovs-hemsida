import test from 'node:test';
import assert from 'node:assert/strict';
import {excludeReviewedCells} from './publish-reviewed-stand-exclusions.mjs';
test('stand exclusion changes only selected flag bits, preserving measurements and source',()=>{
  const source=new Uint8Array([51,37,48,1,17,29,29,3,128,40,60,1,0,0,0,0]);
  const before=source.slice();
  const result=excludeReviewedCells(source,{width:2,height:2},[{row:0,column:1}]);
  assert.deepEqual(source,before);
  assert.deepEqual(result,new Uint8Array([51,37,48,1,17,29,29,7,128,40,60,1,0,0,0,0]));
});
test('duplicate, unmeasured and out-of-range review cells fail without mutation',()=>{
  const source=new Uint8Array([51,37,48,1,0,0,0,0]),before=source.slice(),grid={width:2,height:1};
  assert.throws(()=>excludeReviewedCells(source,grid,[{row:0,column:0},{row:0,column:0}]),/duplicate/);
  assert.throws(()=>excludeReviewedCells(source,grid,[{row:0,column:1}]),/unmeasured/);
  assert.throws(()=>excludeReviewedCells(source,grid,[{row:1,column:0}]));
  assert.deepEqual(source,before);
});
