/* Recheck the source evidence and the bank defect on published terrain.
 * node johannesbergbuild/mapping/check-water-source-review.mjs
 * No model/pack/terrain writes; diagnostic output stays in the ignored cache. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { main as survey } from '../../geobuild/pond-survey.mjs';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';
import { rasterFromRingTiles, waterRingTiles, detectFlatWater } from '../../apps/golf/src/engine/v2-flat-water.mjs';
import { buildWaterBedField } from '../../apps/golf/src/engine/v2-water-bed.mjs';
import { refineMappedWaterBeds } from '../../apps/golf/src/engine/mapped-water-bed.mjs';
import { inRingIndexed } from '../../apps/golf/src/engine/ring-index.mjs';
import { JOHANNESBERG_V2_CONFIG as config } from '../../apps/golf/src/engine/v2-johannesberg-config.mjs';
import { applyWaterSourceReview, reviewedWaterLevel, JOHANNESBERG_WATER_REVIEW as review } from '../../apps/golf/src/engine/scenery/johannesberg-water.mjs';

process.env.BUILD = 'johannesbergbuild';
const { loadTerrain } = await import('../../geobuild/dtm-lib.mjs');
const T = loadTerrain('johannesberg');
const read = p => JSON.parse(fs.readFileSync(p));
const cache = 'johannesbergbuild/cache/water-review';
fs.mkdirSync(cache, { recursive: true });
await survey(['--repo', '.', '--build', 'johannesbergbuild', '--ground', 'johannesberg', '--out', `${cache}/verified-dtm`]);
const measured = read(`${cache}/verified-dtm.json`);
assert.equal(measured.provenance.groundManifestSha256, review.terrain.groundManifestSha256);
assert.equal(measured.provenance.sourceModel.sha256, review.terrain.sourceModelSha256);
const p = readPack(fs.readFileSync('apps/golf/public/courses/johannesberg/pack.bin'));
const model = JSON.parse(inflateStream(p.sv));
applyWaterSourceReview(model, p.header.GEO);
const baseline = structuredClone(model.water), after = structuredClone(model.water), levels = [];
for (const source of review.bodies) {
  const surveyBody = measured.bodies.find(w => w.id === source.id);
  assert.equal(surveyBody.levelRH2000M, source.levelRH2000Metres);
  assert.equal(surveyBody.samples, source.terrainSamples);
  assert.equal(surveyBody.fractionWithinBand, source.plateFraction);
  for (const c of source.controls) {
    assert.ok(inRingIndexed(...c.point, source.baseline.ring));
    assert.ok(Math.abs(T.hAt(...c.point) - c.heightRH2000Metres) < .005);
  }
  const w = after[source.packIndex];
  const result = reviewedWaterLevel(w, (x,z) => T.hAt(x,z) + T.datum, T.datum);
  assert.ok(result, source.id);
  w.level = result.level; w.exactShore = true;
  baseline[source.packIndex].level = source.baselineRuntimeLevelLegacyMetres;
  levels.push({ id:source.id, sourceRH2000:source.levelRH2000Metres,
    beforeLegacy:source.baselineRuntimeLevelLegacyMetres, afterLegacy:+w.level.toFixed(4),
    changeMetres:+(w.level-source.baselineRuntimeLevelLegacyMetres).toFixed(4) });
}
const index = read('apps/golf/public/courses/v2-index.json');
const course = read(`apps/golf/public/${index.courses.find(c=>c.slug==='johannesberg').manifest.url}`);
const ground = read(`apps/golf/public/${course.groundManifest.url}`);
const rings = new Map();
for (const tile of ground.tiles.filter(t=>t.lod>=1)) {
  if(!rings.has(tile.lod)) rings.set(tile.lod,[]);
  rings.get(tile.lod).push({...tile,grid:{sampleSpacingMetres:2**tile.lod}});
}
const tiles = waterRingTiles(rings).map(t=>{
  const ch=readChunk(fs.readFileSync(`apps/golf/public/${t.layers.terrain.url}`));
  return {...t,grid:ch.header.grid,payload:ch.payload};
});
const origin=config.legacyOriginEpsg3006;
const raster=rasterFromRingTiles(tiles,{legacyOrigin:origin,verticalDatumOffsetMetres:T.datum});
const flat=detectFlatWater({raster,knownBodies:baseline,toLegacy:T.bridge.toLegacy,quantizationAware:true});
const coarse=buildWaterBedField({flatWater:flat,knownBodies:baseline,toLegacy:T.bridge.toLegacy,toGrid:T.bridge.toGrid});
const revised=refineMappedWaterBeds(buildWaterBedField({flatWater:flat,knownBodies:after,toLegacy:T.bridge.toLegacy,toGrid:T.bridge.toGrid}),after,T.bridge.toGrid);
let oldDryCuts=0,newDryCuts=0,maximumOldDryCut=0;
// Native 1 m source nodes within the nine ponds' immediate region. The old
// bed's near mask bounds the expensive polygon work; exact controls below
// additionally exercise ponds narrower than a coarse cell.
for(let row=0;row<T.H;row++) for(let col=0;col<T.W;col++) {
  const e=T.E0+col,n=T.N1-row,gx=e-origin.easting,gz=origin.northing-n;
  if(!coarse.nearWater(gx,gz))continue;
  const [x,z]=T.bridge.toLegacy(gx,gz);
  if(x < -850 || x > 410 || z < -890 || z > 490)continue;
  const depth=coarse.depthAt(gx,gz);
  if(!(depth>0))continue;
  if(after.some(w=>inRingIndexed(x,z,w.ring)))continue;
  const h=T.dem[row*T.W+col]+T.datum,level=coarse.levelAt(gx,gz);
  if(h <= level+.5 && h > level-depth) {
    oldDryCuts++;maximumOldDryCut=Math.max(maximumOldDryCut,h-(level-depth));
  }
  const nd=revised.depthAt(gx,gz),nl=revised.levelAt(gx,gz);
  if(nd>0 && h<=nl+.5 && h>nl-nd)newDryCuts++;
}
assert.ok(oldDryCuts>100,'must reproduce coarse carving of dry bank nodes');
assert.equal(newDryCuts,0,'the refined field must not carve dry bank nodes');
for(const b of review.bodies)for(const c of b.controls)assert.ok(revised.inWater(...T.bridge.toGrid(...c.point)));
const report={reviewId:review.id,terrainSha256:review.terrain.groundManifestSha256,sourceControls:45,levels,
  oldDryBankNodesCarved:oldDryCuts,newDryBankNodesCarved:newDryCuts,maximumOldDryCutMetres:+maximumOldDryCut.toFixed(3),
  worldRasterUnchanged:[coarse.width,coarse.height,coarse.spacing],refinedBodies:revised.refinedBodies};
fs.writeFileSync(`${cache}/terrain-verification.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
