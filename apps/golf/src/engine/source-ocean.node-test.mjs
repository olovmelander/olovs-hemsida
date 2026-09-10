import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {buildSourceOcean,loadSourceOcean} from './source-ocean.mjs';
const outer=[[0,0],[100,0],[100,100],[0,100],[0,0]];
const hole=[[46,46],[48,46],[48,48],[46,48],[46,46]];
const make=()=>({schemaVersion:1,crs:'EPSG:3006',bounds:{},marinePolygons:[[outer,hole]],
 islandPolygons:[[hole]],coastlines:[hole],bands:[{polygons:[{rings:[outer,hole],
 shorelineDistances:[outer.map(()=>60),hole.map(()=>0)]}]}]});
const build=data=>buildSourceOcean({data,origin:{easting:0,northing:100},bridge:{toLegacy:(x,z)=>[x,z]},
 bounds:{x0:0,z0:0,x1:100,z1:100},seaLevel:20.3032,maximumCoveredTerrainHeight:301,spacing:16});

test('source polygons retain a two-metre island, independent of its elevation or coarse terrain mask',()=>{
 const ocean=build(make());
 assert.equal(ocean.isSeaAt(20,20),true);
 assert.equal(ocean.isSeaAt(47,53),false);
 assert.equal(ocean.isIslandAt(47,53),true);
 assert.equal(ocean.terrainCoverage[3*ocean.width+2],0);
 let area=0;
 for(let i=0;i<ocean.indices.length;i+=3) {
  const p=ocean.indices.slice(i,i+3).map(n=>ocean.positions.slice(n*3,n*3+3));
  const a=(p[1][2]-p[0][2])*(p[2][0]-p[0][0])-(p[1][0]-p[0][0])*(p[2][2]-p[0][2]);
  assert(a>0,'All triangles face up');area+=a/2;
  assert.equal(ocean.isSeaAt(p.reduce((s,v)=>s+v[0],0)/3,p.reduce((s,v)=>s+v[2],0)/3),true);
 }
 assert.equal(area,9996);
 assert(ocean.positions.every((v,i)=>i%3!==1||v===20.3032));
});

test('only real coastlines contribute shore distance; world crop edges stay deep',()=>{
 const ocean=build(make());
 assert.equal(ocean.distanceToShore(0,0),60);
 assert.equal(ocean.distanceToShore(45,53),1);
 assert.equal(ocean.distanceToShore(47,50),2);
 assert.equal(ocean.isSeaAt(-1,10),false);
});

test('the indexed archipelago classifier preserves every small island',()=>{
 const holes=Array.from({length:16},(_,i)=>{
  const x=10+(i%4)*20,z=10+Math.floor(i/4)*20;
  return [[x,z],[x+1,z],[x+1,z+1],[x,z+1],[x,z]];
 });
 const data=make();data.marinePolygons=[[outer,...holes]];data.islandPolygons=holes.map(h=>[h]);data.coastlines=holes;
 data.bands=[{polygons:[{rings:[outer,...holes],shorelineDistances:[outer.map(()=>60),...holes.map(h=>h.map(()=>0))]}]}];
 const ocean=build(data);
 for(const h of holes){const x=h[0][0]+.5,z=100-h[0][1]-.5;assert.equal(ocean.isSeaAt(x,z),false);assert.equal(ocean.isIslandAt(x,z),true);}
 assert.equal(ocean.isSeaAt(5,5),true);
});

test('marine geometry validates closed rings and complete finite shade distances',()=>{
 const a=make();a.marinePolygons=[[[[0,0],[10,0],[10,10],[0,1]]]];
 assert.throws(()=>build(a),/not closed/);
 const b=make();b.bands[0].polygons[0].shorelineDistances[0][1]=NaN;
 assert.throws(()=>build(b),/shore distances/);
});

test('marine asset loader checks both byte count and source hash before accepting geometry',async()=>{
 const bytes=new TextEncoder().encode(JSON.stringify(make()));
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const args={url:'water.json',baseUrl:'https://example.test/',bytes:bytes.length,sha256:digest,
 fetchFn:async()=>({ok:true,arrayBuffer:async()=>bytes.buffer})};
 assert.deepEqual(await loadSourceOcean(args),make());
 await assert.rejects(loadSourceOcean({...args,sha256:'0'.repeat(64)}),/checksum/);
 await assert.rejects(loadSourceOcean({...args,bytes:1}),/size/);
 const compressed=gzipSync(bytes),raw=compressed.buffer.slice(compressed.byteOffset,compressed.byteOffset+compressed.byteLength);
 const zippedHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(n=>n.toString(16).padStart(2,'0')).join('');
 assert.deepEqual(await loadSourceOcean({...args,bytes:raw.byteLength,sha256:zippedHash,compression:'gzip',
 fetchFn:async()=>({ok:true,arrayBuffer:async()=>raw})}),make());
 const httpDecoded={...args,bytes:raw.byteLength,sha256:zippedHash,compression:'gzip',decodedBytes:bytes.length,decodedSha256:digest};
 assert.deepEqual(await loadSourceOcean(httpDecoded),make());
 await assert.rejects(loadSourceOcean({...httpDecoded,decodedSha256:'0'.repeat(64)}),/checksum/);
});
