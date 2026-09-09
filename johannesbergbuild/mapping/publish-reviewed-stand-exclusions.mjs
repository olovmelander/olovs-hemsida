// Four inspected 2025 clear-turf cells; never rebuild or move measured canopy.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyChunkAsset,writeChunk,assetReferenceForChunk,readChunk} from '../../packages/course-v2/chunk-node.mjs';
import {assembleVegetationGraph} from '../../packages/course-v2/vegetation/publish-vegetation.mjs';
import {writeGroundGraphFiles} from '../../packages/course-v2/emit-ground-graph-node.mjs';
import {canonicalJsonBytes} from '../../packages/course-v2/canonical-json.mjs';
import {verifyAssetGraph} from '../../packages/course-v2/graph-node.mjs';

export function excludeReviewedCells(payload,section,cells) {
  assert.equal(payload.length,section.width*section.height*4);
  const next=Uint8Array.from(payload),offsets=new Set();
  for(const cell of cells) {
    assert(Number.isInteger(cell.column)&&cell.column>=0&&cell.column<section.width);
    assert(Number.isInteger(cell.row)&&cell.row>=0&&cell.row<section.height);
    const offset=(cell.row*section.width+cell.column)*4+3;
    assert(!offsets.has(offset),'duplicate stand cell');
    assert(payload[offset]&1,'unmeasured cell');
    assert(!(payload[offset]&4),'source cell already excluded');
    next[offset]|=4; offsets.add(offset);
  }
  let changed=0;
  for(let i=0;i<payload.length;i++)if(payload[i]!==next[i]){
    assert(offsets.has(i)&&next[i]===(payload[i]|4),'only reviewed exclusion flags may change');changed++;
  }
  assert.equal(changed,cells.length);
  return next;
}

async function main() {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),pub=path.join(root,'apps/golf/public');
  const digest=b=>createHash('sha256').update(b).digest('hex');
  const read=url=>fs.readFileSync(path.join(pub,url));
  const reviewFile=path.join(root,'johannesbergbuild/mapping/lm-review-stand-exclusions.json');
  const reviewBytes=fs.readFileSync(reviewFile),review=JSON.parse(reviewBytes);
  assert.equal(review.groundId,'johannesberg');assert.equal(review.kind,'reviewed-stand-cell-exclusions');assert.equal(review.cells.length,4);
  for(const cell of review.cells){
    assert.equal(cell.status,'accepted');
    for(const source of cell.evidence.sourceFiles)assert.equal(digest(fs.readFileSync(path.join(root,source.path))),source.sha256,'source image drift');
  }
  const rootBytes=read('courses/v2-index.json'),index=JSON.parse(rootBytes);
  const entries=index.courses.filter(entry=>JSON.parse(read(entry.manifest.url)).groundId==='johannesberg');
  assert(entries.length>0);
  const firstCourse=JSON.parse(read(entries[0].manifest.url)),ground=JSON.parse(read(firstCourse.groundManifest.url));
  assert.equal(ground.frame.fingerprint,review.frameFingerprint);
  const resources=new Map([[ground.shell.url,read(ground.shell.url)]]),layerChunks=new Map(),standLayers={},updates=[];
  for(const tile of ground.tiles)for(const ref of Object.values(tile.layers))if(ref)resources.set(ref.url,read(ref.url));
  for(const [tileId,originalReference] of Object.entries(review.sourceStandLayers)){
    const tile=ground.tiles.find(t=>t.id===tileId);assert(tile&&tile.lod===0);
    const original=verifyChunkAsset(originalReference,read(originalReference.url));
    const cells=review.cells.filter(c=>c.tileId===tileId),section=original.header.standField;
    for(const cell of cells){
      const west=tile.bounds.minEasting+cell.column*section.cellMetres,north=tile.bounds.maxNorthing-cell.row*section.cellMetres;
      assert.deepEqual(cell.boundsEpsg3006,[west,north-section.cellMetres,west+section.cellMetres,north],'review grid drift');
    }
    const payload=excludeReviewedCells(original.payload,section,cells);
    const chunk=writeChunk({header:original.header,payload,codec:original.codec});
    const reference=assetReferenceForChunk(chunk,{kind:'stands',directory:'grounds/johannesberg/stands'});
    assert([originalReference.sha256,reference.sha256].includes(tile.layers.stands.sha256),'published stand source drift');
    verifyChunkAsset(reference,chunk);
    assert.equal(ground.tiles.filter(t=>t.layers.stands?.url===tile.layers.stands.url).length,1);
    resources.delete(tile.layers.stands.url);
    standLayers[tileId]=reference;layerChunks.set(reference.url,chunk);
    updates.push({tileId,original:originalReference,replacement:reference,changedFlagBytes:cells.length,cells:cells.map(c=>c.id)});
  }
  const graphs=[];
  for(const entry of entries){
    const course=JSON.parse(read(entry.manifest.url));assert.equal(course.groundManifest.sha256,firstCourse.groundManifest.sha256);
    const graph=await assembleVegetationGraph({slug:entry.slug,rootEntry:entry,courseManifest:course,groundManifest:ground,
      routingContent:readChunk(read(course.routing.url)).content,resources,layerChunks,standLayers,
      sourceManifestSha256:ground.sourceManifestSha256,courseSlugs:entries.map(e=>e.slug),
      fallbackV1:course.fallbackV1,replaceExistingLayers:false});
    assert.equal(graph.references.routing.sha256,course.routing.sha256,'routing must remain byte-identical');
    const updated=JSON.parse(Buffer.from(graph.resources.get(graph.references.ground.url)).toString('utf8'));
    assert.deepEqual(updated.frame,ground.frame);assert.equal(updated.tiles.length,ground.tiles.length);
    for(const tile of updated.tiles){
      const old=ground.tiles.find(t=>t.id===tile.id);
      for(const kind of ['terrain','surface','objects'])assert.deepEqual(tile.layers[kind],old.layers[kind]??null);
      assert.deepEqual(tile.layers.stands,standLayers[tile.id]??old.layers.stands??null);
    }
    graphs.push(graph);
  }
  assert.equal(new Set(graphs.map(g=>g.references.ground.sha256)).size,1);
  // Preserve the currently served course set; a nine-hole v2 entry is never added.
  const combinedRoot={...graphs[0].root,courses:graphs.flatMap(g=>g.root.courses)};
  const combinedResources=new Map(graphs.flatMap(g=>[...g.resources]));
  verifyAssetGraph({root:combinedRoot,resources:combinedResources,strictResources:true});
  assert.equal(digest(read('courses/v2-index.json')),digest(rootBytes),'root changed during review publication');
  await writeGroundGraphFiles(pub,{root:combinedRoot,rootBytes:canonicalJsonBytes(combinedRoot),resources:combinedResources});
  const finalRoot=JSON.parse(read('courses/v2-index.json'));
  assert.deepEqual(finalRoot.courses.map(c=>c.slug),index.courses.map(c=>c.slug));
  const report={schemaVersion:1,groundId:'johannesberg',kind:'reviewed-stand-cell-exclusion-publication',state:'published',
    reviewSha256:digest(reviewBytes),beforeGroundManifest:firstCourse.groundManifest,afterGroundManifest:graphs[0].references.ground,
    changedStandChunks:updates.length,changedFlagBytes:4,updates,preserved:['all 2417 individual trees and object chunk references','all other stand payload bytes',
      'all canopy fraction and height measurements','frame and tile count','terrain and surface chunks','routing chunks','existing course set and fallback identities']};
  fs.writeFileSync(path.join(root,'geo_data/course-v2/johannesberg/reference/lm-stand-exclusions-publication-2026-09-09.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({state:'published',changedStandChunks:updates.length,changedFlagBytes:4,groundSha256:graphs[0].references.ground.sha256,slugs:entries.map(e=>e.slug)}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
