/* Actual published terrain regression, with no raw acquisition cache required.
 * node visbybuild/check-coastal-water.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openPublishedGround, createPublishedGroundLookup } from '../packages/course-v2/published-ground-lookup.mjs';
import { buildCoastalWater } from '../apps/golf/src/engine/coastal-water.mjs';
import { VISBY_FRAME as frame, local } from './frame.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = p => JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const model = json('visbybuild/course-model.json');
const source = json('geo_data/course-v2/visby/mapping/water-breakgeometry-epsg3006.geojson');
const { ground, courseManifest, readAsset } = openPublishedGround(fs,path,path.join(root,'apps/golf/public'),'visby');
const lookup = createPublishedGroundLookup(ground, readAsset);
const b = ground.bounds;
const sourceBounds = {x0:-2048,x1:2048,z0:-2048,z1:2048};
const bounds = {x0:b.minEasting-frame.easting,x1:b.maxEasting-frame.easting,z0:frame.northing-b.maxNorthing,z1:frame.northing-b.minNorthing};
const heightAt = (x,z) => lookup.heightAt(frame.easting+x,frame.northing-z);
const start = performance.now();
const water = buildCoastalWater({bounds,sourceBounds,bodies:model.water,heightAt,seaLevel:model.seaLevel,tolerance:model.seaTintBandMetres});
const terrainCoveredAt = (x,z) => {
  const col=Math.floor((x-bounds.x0)/water.spacing),row=Math.floor((z-bounds.z0)/water.spacing);
  return col>=0&&row>=0&&col<water.width&&row<water.height&&water.terrainCoverage[row*water.width+col]===1;
};
const milliseconds = Math.round(performance.now()-start);
const played = model.holes.flatMap(h => [h.pin,...h.green.ring,...h.tees.marks.map(t=>t.c),...h.tees.pads.flatMap(p=>p.ring),...h.fairway.rings.flat()]);
assert.ok(played.every(p=>!water.isSeaAt(...p)), 'sea must exclude every played ring vertex, pin and tee');
assert.ok(played.every(p=>!terrainCoveredAt(...p)), 'terrain masking must preserve every played point');
let lowDrySamples=0, islandSamples=0;
// Every original island vertex's neighbourhood is handled by the original
// source topology. Check interior points against all water partitions below.
const inside = (x,z,r) => { let hit=false; for(let i=0,j=r.length-1;i<r.length;j=i++) {
  const [a,c]=r[i],[d,e]=r[j];if((c>z)!==(e>z)&&x<(d-a)*(z-c)/(e-c)+a)hit=!hit;
} return hit; };
const islands = source.features.flatMap(f=>f.geometry.coordinates.slice(1)).map(r=>r.map(p=>local(p.slice(0,2))));
for(let z=-2040;z<2048;z+=16) for(let x=-2040;x<2048;x+=16) {
  const mapped=model.water.some(w=>w.isSea&&inside(x,z,w.ring));
  assert.equal(water.isSeaAt(x,z),mapped);
  if(!mapped) assert.equal(terrainCoveredAt(x,z),false,'dry source terrain must not be masked');
  if(!mapped&&heightAt(x,z)<model.seaLevel+model.seaTintBandMetres) lowDrySamples++;
}
for(const r of islands) {
  for(let z=Math.min(...r.map(p=>p[1]))+1;z<Math.max(...r.map(p=>p[1]));z+=2)
    for(let x=Math.min(...r.map(p=>p[0]))+1;x<Math.max(...r.map(p=>p[0]));x+=2)
      if(inside(x,z,r)){assert.equal(water.isSeaAt(x,z),false);assert.equal(terrainCoveredAt(x,z),false);islandSamples++;}
}
assert.ok(islands.length===10&&islandSamples>0);
assert.ok(water.cells>10000&&water.quads<10000, 'a bounded, compact ocean must reach beyond the source window');
const report={groundManifestSha256:courseManifest.groundManifest.sha256,modelSha256:createHash('sha256').update(fs.readFileSync(path.join(root,'visbybuild/course-model.json'))).digest('hex'),
  bounds,sourceBounds,spacingMetres:water.spacing,extensionHectares:water.cells*water.spacing**2/10000,quads:water.quads,milliseconds,
  playedPointsExcluded:played.length,sourceGridComparisons:256**2,lowDrySamplesProtected:lowDrySamples,islands:islands.length,islandSamplesExcluded:islandSamples,
  terrainMaskBytes:water.terrainCoverage.byteLength,terrainMaskDryLandChecks:true,
  sourceTerrainModified:false,sourceGeometryModified:false,visualCameraChecks:'not run by this command; see docs/graphics/visby-water-distance-2026-09-09',
  limitation:'Outside the 4096 m source window this is a conservative DTM-connected visual extension, not a surveyed coastline. Distant features narrower than the 32 m sampling can remain unresolved.'};
console.log(JSON.stringify(report,null,2));
if(process.argv.includes('--write'))fs.writeFileSync(path.join(root,'visbybuild/mapping/coastal-water-review.json'),JSON.stringify(report,null,2)+'\n');
