#!/usr/bin/env node
/* Repeatable source-to-pack checks. --write records the report; the default
 * verifies its exact inputs and results. No browser or survey claim. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { centroid, pointInPoly } from '../geobuild/lib.mjs';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';
import { openPublishedGround } from '../packages/course-v2/published-ground-lookup.mjs';
import { readChunk } from '../packages/course-v2/chunk-node.mjs';
import { decodeStandField } from '../packages/course-v2/stand-field.mjs';
import { planV2Vegetation } from '../apps/golf/src/engine/v2-vegetation.mjs';
import { gpsToLocal, playableLine } from '../apps/golf/src/engine/caddie.js';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { rasterizeGroundAtlas } from '../apps/golf/src/engine/atlas.js';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { applyReviewedApproaches, applyReviewedSurfaces } from './apply-reviewed-surfaces.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bytes = p => fs.readFileSync(path.join(ROOT,p));
const json = p => JSON.parse(bytes(p));
const sha = b => createHash('sha256').update(b).digest('hex');
const local = ([e,n]) => [e-677700.5,6586399.5-n];
const round = v => Math.round(v*1e6)/1e6;

// Everything outside the explicitly reviewed fields remains pinned to the
// starting model. This catches accidental facility/terrain/obstacle edits.
export function preservedModel(model) {
  const m = structuredClone(model);
  for (const h of m.holes) {
    delete h.green.ring; delete h.green.c; delete h.pin; delete h.note;
    delete h.elev.green; delete h.elev.rise;
    for (const mark of h.tees.marks) delete mark.c;
  }
  m.scenery.mappedFeatures = m.scenery.mappedFeatures.filter(f => f.kind !== 'mown_approach');
  delete m.evidence.puttingCutReview; delete m.evidence.reviewedTargetHeights; delete m.evidence.approachCutReview;
  return m;
}

export function validateAlignment() {
  const m = json('lidingobuild/course-model.json');
  const review = json('lidingobuild/mapping/putting-cuts-2025.json');
  const surfaces = json('lidingobuild/mapping/playing-surfaces.geojson');
  const approachSource = json('lidingobuild/mapping/approaches-2025.geojson');
  assert.equal(sha(JSON.stringify(preservedModel(m))),review.preservedModelSha256);
  const modelBefore = JSON.stringify(m);
  const greens = [];
  let starts = 0;
  for (const h of m.holes) {
    const source = surfaces.features.find(f => f.id === h.green.sourceFeatureId);
    assert.deepEqual(h.green.ring, source.geometry.coordinates[0].map(local));
    assert(pointInPoly(...h.pin,h.green.ring),`hole ${h.n}: flag outside green`);
    for (let i=0;i<h.tees.marks.length;i++) {
      assert(h.tees.pads.some(p => pointInPoly(...h.tees.marks[i].c,p.ring)),`hole ${h.n}: tee ${i} outside pads`);
      const route = playableLine(h,i);
      assert.deepEqual(route.origin,h.tees.marks[i].c);
      assert.deepEqual(route.line.at(-1),h.pin);
      if (h.par===3) assert.equal(route.line.length,2);
      starts++;
    }
    const decision = review.features.find(f=>f.hole===h.n);
    if (decision) {
      assert.deepEqual(source.geometry,decision.geometry);
      assert.deepEqual(h.pin,centroid(h.green.ring));
      greens.push({hole:h.n,areaBeforeM2:decision.beforeAreaM2,areaAfterM2:decision.afterAreaM2,
        targetMovementMetres:decision.centroidDisplacementMetres});
    }
  }
  assert.equal(JSON.stringify(m),modelBefore);
  assert.equal(greens.length,14);
  assert(greens.every(g=>Number.isFinite(g.targetMovementMetres)));
  const packed = JSON.parse(inflateStream(readPack(bytes('apps/golf/public/courses/lidingo/pack.bin')).sv));
  for (let i=0;i<m.holes.length;i++) {
    const p=packed.holes[i],h=m.holes[i];
    for (const key of ['n','par','idx','t','line','pin','elev','note']) assert.deepEqual(p[key],h[key]);
    assert.deepEqual(p.green.ring,h.green.ring); assert.deepEqual(p.green.c,h.green.c);
    assert.deepEqual(p.tees.pads.map(t=>t.ring),h.tees.pads.map(t=>t.ring));
    assert.deepEqual(p.tees.marks.map(t=>t.c),h.tees.marks.map(t=>t.c));
    assert.deepEqual(p.fairway.rings,h.fairway.rings);
  }
  assert.deepEqual(packed.scenery.mappedFeatures,m.scenery.mappedFeatures);
  assert.deepEqual(applyReviewedApproaches(m,approachSource),m,'approach adapter must be idempotent');
  const altered = structuredClone(m); altered.holes[0].green.ring[0][0] += 1;
  assert.throws(()=>applyReviewedSurfaces(altered,surfaces,review,()=>10),/boundary changed/);
  const features = buildGroundSurfaceFeatures({holes:m.holes,model:{...m,veg:m.vegetation}});
  const approaches = [];
  for (const source of approachSource.features) {
    const f = m.scenery.mappedFeatures.find(f=>f.id===source.id);
    assert.deepEqual(f.rings,source.geometry.coordinates.map(r=>r.map(local)));
    assert.equal(features.find(f=>f.sourceId===source.id).surface,SURFACE.SEMI);
    const p = centroid(f.rings[0]);
    const CORE = {x0:p[0]-60,z0:p[1]-60,x1:p[0]+60,z1:p[1]+60};
    const atlas = rasterizeGroundAtlas({CORE,features,res:1,classesOnly:true});
    let mownCells=0;
    for (let i=0;i<atlas.classes.length;i++) {
      const x=CORE.x0+(i%atlas.bounds.w+.5),z=CORE.z0+(Math.floor(i/atlas.bounds.w)+.5);
      if(pointInPoly(x,z,f.rings[0])&&atlas.classes[i]===SURFACE.SEMI)mownCells++;
    }
    assert(mownCells>30,`approach ${source.id} lost to another surface`);
    approaches.push({hole:f.hole,observedAreaM2:source.properties.areaSquareMetres,visibleSemiSquareMetresAt1m:mownCells});
  }
  const opened = openPublishedGround(fs,path,path.join(ROOT,'apps/golf/public'),'lidingo');
  assert.equal(sha(bytes('apps/golf/public/'+opened.courseManifest.groundManifest.url)),review.preservedGroundManifestSha256);
  const tiles = opened.ground.tiles.filter(t=>t.lod===0).map(t=>({...t,
    objects:t.layers.objects?readChunk(opened.readAsset(t.layers.objects.url)).content.records:[],
    stands:t.layers.stands?(()=>{const c=readChunk(opened.readAsset(t.layers.stands.url));return decodeStandField(c.payload,c.header.standField)})():null}));
  const vegetation = [];
  for (const lowQuality of [false,true]) {
    const plan = planV2Vegetation({tiles},{mapper:{toWorld:(e,n)=>local([e,n])},groundHeightAt:()=>0,lowQuality});
    let greenConflicts=0,approachConflicts=0;
    for(const tree of plan.instances) {
      if(m.holes.some(h=>pointInPoly(tree.x,tree.z,h.green.ring)))greenConflicts++;
      if(approachSource.features.some(f=>pointInPoly(tree.x,tree.z,f.geometry.coordinates[0].map(local))))approachConflicts++;
    }
    assert.equal(greenConflicts,0); assert.equal(approachConflicts,0);
    vegetation.push({lowQuality,instances:plan.instances.length,individuals:plan.stats.individuals,greenTrunkConflicts:greenConflicts,approachTrunkConflicts:approachConflicts});
  }
  // Fixed PROJ controls, independent of the browser projection implementation.
  const controls = [[59.378715385375614,18.12816746741512,677700.5,6586399.5],
    [59.37298170859494,18.116360534826395,677060,6585730],
    [59.3847644331165,18.138404685012777,678250,6587100],
    [59.38435276735087,18.118109417201236,677100,6587000],
    [59.373128933026656,18.13644843160652,678200,6585800]];
  const gps = controls.map(([latitude,longitude,e,n])=>{
    const p=gpsToLocal({latitude,longitude},m),q=local([e,n]);
    return Math.hypot(p[0]-q[0],p[1]-q[1]);
  });
  assert(Math.max(...gps)<.005);
  return {schemaVersion:1,groundId:'lidingo',baselineCommit:review.baselineCommit,
    inputs:Object.fromEntries(['lidingobuild/course-model.json','lidingobuild/mapping/putting-cuts-2025.json',
      'lidingobuild/mapping/approaches-2025.geojson','lidingobuild/mapping/playing-surfaces.geojson',
      'apps/golf/public/courses/lidingo/pack.bin'].map(p=>[p,sha(bytes(p))])),
    preservedModelSha256:review.preservedModelSha256,preservedGroundManifestSha256:review.preservedGroundManifestSha256,
    terrainTiles:opened.ground.tiles.length,greens,approaches,teeStartsInsideObservedPads:starts,
    selectedTeeRoutesVerified:starts,gpsControls:controls.length,gpsMaximumErrorMetres:round(Math.max(...gps)),vegetation,
    limitations:['Machine visual review against May 2025 imagery; no independent registration or survey.',
      'Four shaded putting surfaces retain earlier boundaries. Mowing height and current tee/flag colours are unmeasured.',
      'Vegetation checks compare displayed trunk positions; they do not establish individual stem/species survey accuracy.',
      'Browser could not reach the local preview (ERR_BLOCKED_BY_CLIENT); no interactive 3D or device-performance approval.']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=validateAlignment(),dest=path.join(ROOT,'lidingobuild/mapping/alignment-validation-2025.json');
  if(process.argv.includes('--write'))fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
  else assert.deepEqual(JSON.parse(fs.readFileSync(dest,'utf8')),report,'alignment report is stale; review changes before --write');
  console.log(JSON.stringify({greens:report.greens.length,approaches:report.approaches.length,teeStarts:report.teeStartsInsideObservedPads,terrainTiles:report.terrainTiles,gpsMaximumErrorMetres:report.gpsMaximumErrorMetres,vegetation:report.vegetation}));
}
