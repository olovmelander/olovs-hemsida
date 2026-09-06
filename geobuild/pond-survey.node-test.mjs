import assert from 'node:assert/strict';
import test from 'node:test';
import { traceCellPolygons, measureBody } from './pond-survey.mjs';

test('cell tracing retains an interior island with exact net area', () => {
  const mask=new Uint8Array(25).fill(1);mask[12]=0;
  const out=traceCellPolygons(mask,5,5);
  assert.equal(out.outerCount,1);assert.equal(out.holeCount,1);assert.equal(out.occupiedCells,24);
});
test('a single-cell neck is preserved rather than morphologically removed', () => {
  const mask=new Uint8Array(13*6);
  for(let y=1;y<=4;y++)for(let x=1;x<=4;x++)mask[y*13+x]=1;
  for(let y=1;y<=4;y++)for(let x=8;x<=11;x++)mask[y*13+x]=1;
  for(let x=5;x<=7;x++)mask[2*13+x]=1;
  const out=traceCellPolygons(mask,13,6);assert.equal(out.outerCount,1);assert.equal(out.occupiedCells,35);
});
function fixture(){
  const grid={width:50,height:50,e0:640000,n1:6636000,heights:new Float32Array(2500).fill(20)};
  for(let y=10;y<=25;y++)for(let x=10;x<=25;x++)grid.heights[y*50+x]=8.5;
  grid.heights[17*50+17]=20;
  const body={id:'pond-a',level:999,rings:[[[640009.5,6635990.5],[640025.5,6635990.5],[640025.5,6635974.5],[640009.5,6635974.5]]]};
  return {grid,body};
}
test('plate level comes from this body in RH2000, independent of legacy source level',()=>{
  const {grid,body}=fixture(),out=measureBody(body,grid);
  assert.equal(out.levelRH2000M,8.5);assert.equal(out.sourceLevelLegacyM,999);assert.equal(out.holeCount,1);assert.equal(out.floodCells,255);assert(out.geometry);assert.match(out.decision,/candidate/);
});
test('NoData inside a source is never converted into a complete replacement outline',()=>{
  const {grid,body}=fixture();grid.heights[15*50+15]=NaN;
  const out=measureBody(body,grid);assert.equal(out.geometry,null);assert.equal(out.decision,'source-has-nodata-level-only');
});
