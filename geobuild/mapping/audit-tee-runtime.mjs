#!/usr/bin/env node
/* Diagnose source -> pack -> runtime tee coordinates and decorative pairs.
 * No geometry is changed. --base-url additionally measures a real browser boot.
 * Reports use LF metadata hashes and distinguish source pads from runtime
 * inferences. The affine bridge residual is not a source accuracy estimate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
import { withInferredTeePads } from '../../apps/golf/src/engine/tee-pads.mjs';
import { teeMarkerPlacement } from '../../apps/golf/src/engine/tee-marker-placement.mjs';
import { teeView } from '../../apps/golf/src/engine/tee-view.mjs';
import { inRing, rightOf } from '../../apps/golf/src/engine/geom.js';
import { legacyGridBridge } from '../../apps/golf/src/engine/geodetic-frame.mjs';
import { VECKEFJARDEN_V2_CONFIG as config } from '../../apps/golf/src/engine/v2-veckefjarden-config.mjs';

const ROOT = fileURLToPath(new URL('../../',import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);

export function auditTeeRuntime(model, vectors, { runtimeHoles = withInferredTeePads(vectors.holes) } = {}) {
  const bridge = legacyGridBridge(config.legacyFrame), issues = [];
  const holes = model.holes.map(source => {
    const packed = vectors.holes.find(h=>h.n===source.n), runtime = runtimeHoles.find(h=>h.n===source.n);
    if (!packed || !runtime) throw new Error(`Missing source/pack/runtime hole ${source.n}`);
    const marks = source.tees.marks.map((sourceMark,index) => {
      const packMark=packed.tees.marks[index],mark=runtime.tees.marks[index];
      const expected=packMark.displayC??sourceMark.c;
      if(!same(sourceMark.c,packMark.c)) issues.push(`H${source.n}M${index+1}: pack coordinate differs from source`);
      if(sourceMark.sourcePadId!==undefined&&packMark.sourcePadId!==sourceMark.sourcePadId) issues.push(`H${source.n}M${index+1}: pack lost the explicit source pad identity`);
      if(packMark.sourcePadId!==undefined&&!packed.tees.pads.some(p=>p.id===packMark.sourcePadId)) issues.push(`H${source.n}M${index+1}: pack lacks the nominated pad identity`);
      if(!same(expected,mark.c)) issues.push(`H${source.n}M${index+1}: runtime coordinate differs from its declared anchor`);
      const epsg3006=latLonToSweref99Tm(model.origin.lat-mark.c[1]/model.mPerLat,model.origin.lon+mark.c[0]/model.mPerLon);
      const terrainWorld=bridge.toLegacy(epsg3006[0]-config.legacyOriginEpsg3006.easting,config.legacyOriginEpsg3006.northing-epsg3006[1]);
      const direction=rightOf(mark.b*Math.PI/180);
      const nominalPair=[-2.6,2.6].map(s=>[mark.c[0]+direction[0]*s,mark.c[1]+direction[1]*s]);
      const placement=teeMarkerPlacement(runtime,mark),pairPositions=placement.positions;
      const pairContained=pairPositions.length===2&&runtime.tees.pads.some(p=>pairPositions.every(c=>inRing(...c,p.ring)));
      if(pairPositions.length&&!pairContained) issues.push(`H${source.n}M${index+1}: rendered pair leaves its runtime deck`);
      const sourcePadIndices=source.tees.pads.flatMap((p,i)=>inRing(...mark.c,p.ring)?[i]:[]);
      return {index,sourceC:sourceMark.c,packC:packMark.c,runtimeC:mark.c,displayC:packMark.displayC??null,
        associationConfidence:sourceMark.associationConfidence??'unreviewed',sourceReviewId:sourceMark.sourceReviewId??null,sourcePadId:sourceMark.sourcePadId??null,runtimeSourcePadId:mark.sourcePadId??null,
        sourcePadIndices,epsg3006,bridgeResidualM:distance(terrainWorld,mark.c),cameraC:teeView(runtime,mark).position,
        referenceInWater:model.water.some(w=>inRing(...mark.c,w.ring)),nominalPair,
        nominalPairInSourcePad:source.tees.pads.some(p=>nominalPair.every(c=>inRing(...c,p.ring))),
        pairPositions,pairDisplayC:placement.displayC,pairDisplayShiftM:placement.displayShiftM,
        pairPlacementReason:placement.reason,pairDisplayShiftLimitM:placement.maxDisplayShiftM,
        pairInteriorAnchorWouldFit:placement.interiorAnchorWouldFit??null,pairPadId:placement.padId??null,
        pairContained:pairPositions.length?pairContained:null,
        pairInSourcePad:pairPositions.length?source.tees.pads.some(p=>pairPositions.every(c=>inRing(...c,p.ring))):null};
    });
    return {hole:source.n,pads:{source:source.tees.pads.length,runtime:runtime.tees.pads.length,added:runtime.tees.pads.length-source.tees.pads.length},inferPads:runtime.tees.inferPads!==false,marks};
  });
  const marks=holes.flatMap(h=>h.marks);
  return {schemaVersion:1,groundId:'veckefjarden',kind:'tee-runtime-coordinate-audit',
    pairDisplayPolicy:'Decorative pairs may use an inward anchor at most one metre from a reference already inside the nominated surface. pairDisplayC is never assigned to a source mark or camera. The search follows the same surface toward its contained centroid and stops at its first boundary; omitted pairs include a reason.',
    bridge:{rotationDegrees:bridge.rotationDegrees,scaleX:bridge.scaleX,scaleZ:bridge.scaleZ,
      method:'Compare exact forward EPSG:3006 point projection with the existing local affine terrain bridge; no correction is applied.',
      maxResidualM:Math.max(...marks.map(m=>m.bridgeResidualM))},
    summary:{references:marks.length,addedSyntheticPads:holes.reduce((n,h)=>n+h.pads.added,0),referencesOutsideSourcePads:marks.filter(m=>!m.sourcePadIndices.length).length,
      referencesInWater:marks.filter(m=>m.referenceInWater).length,displayAnchors:marks.filter(m=>m.displayC).length,
      nominalPairsOutsideSourcePads:marks.filter(m=>!m.nominalPairInSourcePad).length,
      pairsClipped:marks.filter(m=>m.pairPositions.length&&!same(m.nominalPair,m.pairPositions)).length,
      pairsDisplayAdjusted:marks.filter(m=>m.pairDisplayShiftM>0).length,
      maxPairDisplayShiftM:Math.max(0,...marks.map(m=>m.pairDisplayShiftM??0)),
      pairsBeyondDisplayShiftLimit:marks.filter(m=>m.pairPlacementReason==='display-inset-exceeds-limit').length,
      pairsOmitted:marks.filter(m=>!m.pairPositions.length).length,
      renderedPairsOutsideRuntimePads:marks.filter(m=>m.pairContained===false).length,
      renderedPairsOutsideSourcePads:marks.filter(m=>m.pairInSourcePad===false).length,issues:issues.length},holes,issues};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),flag=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
  const modelPath=path.join(ROOT,'geobuild/course-model.json'),packPath=path.join(ROOT,'apps/golf/public/courses/veckefjarden/pack.bin');
  const modelBytes=fs.readFileSync(modelPath),packBytes=fs.readFileSync(packPath),model=JSON.parse(modelBytes),vectors=JSON.parse(inflateStream(readPack(packBytes).sv));
  const baseUrl=flag('--base-url',null);let measured=null;
  if(baseUrl) {
    const {chromium}=await import('playwright-core'),{browserArgs}=await import('../../tools/browser-args.mjs');
    const browser=await chromium.launch({channel:'chrome',args:browserArgs()});
    try {
      const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
      page.on('pageerror',error=>errors.push(String(error)));
      await page.goto(baseUrl.replace(/\/$/,'')+'/?bana=veckefjarden&hal=1&tee=4&vy=tee&det=1',{waitUntil:'load',timeout:120000});
      await page.waitForSelector('#boot.done',{timeout:420000});
      measured=await page.evaluate(()=>({holes:window.V3D.HOLES,camera:window.V3D.camExact(),terrain:window.V3D.v2Terrain(),
        markerBatches:window.V3D.census().filter(entry=>entry.key.includes('|markers|'))}));
      measured.errors=errors;
    } finally {await browser.close();}
  }
  const report=auditTeeRuntime(model,vectors,measured?{runtimeHoles:measured.holes}:{});
  report.inputs={modelPath:'geobuild/course-model.json',modelSha256:sha(modelBytes.toString('utf8').replace(/\r\n/g,'\n')),
    packPath:'apps/golf/public/courses/veckefjarden/pack.bin',packSha256:sha(packBytes)};
  if(measured){
    const selected=measured.holes.find(h=>h.n===1).tees.marks[3].c;
    measured.selectedCameraHorizontalResidualM=distance([measured.camera.pos[0],measured.camera.pos[2]],selected);
    measured.expectedMarkerInstances=report.holes.flatMap(h=>h.marks).reduce((n,m)=>n+m.pairPositions.length,0);
    measured.actualMarkerInstances=measured.markerBatches.reduce((n,b)=>n+b.instances,0);
    if(measured.selectedCameraHorizontalResidualM>1e-5)report.issues.push('Browser tee camera differs from the selected reference');
    if(measured.actualMarkerInstances!==measured.expectedMarkerInstances)report.issues.push('Browser marker instance count differs from fitted pairs');
    delete measured.holes;report.browser=measured;if(measured.errors.length)report.issues.push(...measured.errors);
  }
  report.summary.issues=report.issues.length;
  if(sha(fs.readFileSync(modelPath))!==sha(modelBytes)||sha(fs.readFileSync(packPath))!==sha(packBytes))throw new Error('Source model or pack changed during runtime audit');
  const out=path.resolve(ROOT,flag('--out','geobuild/cache/lm-ortho-review/tee-runtime-audit.json'));
  fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({out,summary:report.summary,bridge:report.bridge,browserErrors:report.browser?.errors,issues:report.issues},null,2));
  if(report.issues.length)process.exitCode=1;
}
