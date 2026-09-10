/* Independently validate the actual triangles used by the runtime. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildSourceOcean} from '../../apps/golf/src/engine/source-ocean.mjs';
import {NORRFALLSVIKEN_OCEAN_SOURCE as asset} from '../../apps/golf/src/engine/norrfallsviken-ocean-source.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const bytes=fs.readFileSync(path.join(root,'apps/golf/public',asset.url));
assert.equal(bytes.length,asset.bytes);
assert.equal(createHash('sha256').update(bytes).digest('hex'),asset.sha256);
const data=JSON.parse(gunzipSync(bytes));
const review=JSON.parse(fs.readFileSync(path.join(root,'geo_data/course-v2/norrfallsviken/reference/lm-marine-water-2026-09-09.json'),'utf8'));
const origin={easting:(data.bounds.minEasting+data.bounds.maxEasting)/2,northing:(data.bounds.minNorthing+data.bounds.maxNorthing)/2};
// Keep the independent area comparison in the source metric grid.
const ocean=buildSourceOcean({data,origin,bridge:{toLegacy:(x,z)=>[x,z]},seaLevel:data.seaLevelRH2000,
 maximumCoveredTerrainHeight:301,bounds:{x0:data.bounds.minEasting-origin.easting,x1:data.bounds.maxEasting-origin.easting,
 z0:origin.northing-data.bounds.maxNorthing,z1:origin.northing-data.bounds.minNorthing}});
let area=0;
for(let i=0;i<ocean.indices.length;i+=3) {
 const p=ocean.indices.slice(i,i+3).map(n=>ocean.positions.slice(n*3,n*3+3));
 const triangleArea=((p[1][2]-p[0][2])*(p[2][0]-p[0][0])-(p[1][0]-p[0][0])*(p[2][2]-p[0][2]))/2;
 assert(triangleArea>0,'Every triangle is finite and faces up');area+=triangleArea;
 const x=p.reduce((s,v)=>s+v[0],0)/3,z=p.reduce((s,v)=>s+v[2],0)/3;
 // Sub-centimetre slivers can place a floating-point centroid on a boundary;
 // triangles large enough to render must remain in the source union.
 if(triangleArea>.01)assert(ocean.isSeaAt(x,z),`Triangle leaves marine union: ${x},${z}`);
}
assert(Math.abs(area-review.geometry.finalAreaSquareMetres)<.05,'Runtime triangles reproduce source union area');
for(const p of review.islandProbes)assert.equal(ocean.isSeaAt(p.easting-origin.easting,origin.northing-p.northing),false);
const result={pass:true,asset:asset.sha256,vertices:ocean.positions.length/3,triangles:ocean.triangles,
 triangleAreaSquareMetres:area,sourceAreaSquareMetres:review.geometry.finalAreaSquareMetres,
 sourceIslandProbes:review.islandProbes.length,sourceIslands:ocean.sourceIslands};
const out=path.join(root,'nvgkbuild/mapping/coastal-runtime-validation.json');
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
