// Publish one shared ground into an isolated local preview, for both routings.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {OUT,DOC,PUBLIC,SLUGS,json,save,sha} from './preview.mjs';
import {readChunk,writeChunk,assetReferenceForChunk} from '../../packages/course-v2/chunk-node.mjs';
import {standFieldHeaderSection,inspectStandFieldPayload} from '../../packages/course-v2/stand-field.mjs';
import {treeRecord,compileObjectChunks} from '../../packages/course-v2/vegetation/object-compiler.mjs';
import {createGroundSampler} from '../../packages/course-v2/vegetation/ground-sampler.mjs';
import {assembleVegetationGraph} from '../../packages/course-v2/vegetation/publish-vegetation.mjs';
import {canonicalJsonBytes} from '../../packages/course-v2/canonical-json.mjs';
import {publishStartupPacks} from '../build-startup-packs.mjs';

const baseline=json(path.join(OUT,'baseline.json')),liveRoot=fs.readFileSync(path.join(PUBLIC,'courses/v2-index.json'));
const readAsset=url=>fs.readFileSync(path.join(OUT,'before',url));
const sampler=await createGroundSampler(baseline.ground,readAsset),records=[];
for(const r of json(path.join(OUT,'pilot-record-drafts.json'))){
 if(!r.pilotEdit){records.push(r);continue;}
 const base=await sampler.sample(r.easting,r.northing);
 records.push(treeRecord({...r,candidate:{heightMetres:r.objectHeightMetres,radiusMetres:r.radiusMetres},baseHeightRH2000:base?.heightRH2000}));
}
assert.equal(new Set(records.map(r=>r.id)).size,records.length);
const compiled=compileObjectChunks({groundId:'veckefjarden',tiles:baseline.ground.tiles,records});
const resources=new Map([[baseline.ground.shell.url,readAsset(baseline.ground.shell.url)]]);
for(const t of baseline.ground.tiles)for(const k of ['terrain','surface'])if(t.layers[k])resources.set(t.layers[k].url,readAsset(t.layers[k].url));
const layerChunks=new Map(compiled.chunks.map(c=>[c.reference.url,c.bytes])),standLayers={},standEvidence=[];
for(const job of json(path.join(OUT,'stand-output/index.json'))){
 const tile=baseline.ground.tiles.find(t=>t.id===job.tileId);
 if(!job.changed){standLayers[tile.id]=tile.layers.stands;resources.set(tile.layers.stands.url,readAsset(tile.layers.stands.url));continue;}
 const payload=fs.readFileSync(path.join(OUT,job.file));assert.equal(sha(payload),job.sha256);
 const header={schemaVersion:2,id:tile.id,kind:'stands',owner:{type:'ground',id:'veckefjarden'},bounds:tile.bounds,
  payloadFormat:'stand-field-u8-v1',requiredFeatures:['chunk-envelope-v2','stand-field-u8-v1'],standField:standFieldHeaderSection(job)};
 const inspected=inspectStandFieldPayload(payload,header);const bytes=writeChunk({header,payload});
 const ref=assetReferenceForChunk(bytes,{kind:'stands',directory:'grounds/veckefjarden/stands'});
 layerChunks.set(ref.url,bytes);standLayers[tile.id]=ref;standEvidence.push({tileId:tile.id,cellMetres:job.cellMetres,bytes:bytes.length,decodedBytes:payload.length,inspected});
}
const evidence={kind:'local-vegetation-pilot',groundId:'veckefjarden',courses:SLUGS,baselineGround:baseline.courses[0].groundManifest,
 sourceInventory:json(path.join(DOC,'source-inventory.json')),scopeSha256:sha(fs.readFileSync(path.join(DOC,'facility-scope.geojson'))),
 correctionsSha256:sha(fs.readFileSync(path.join(DOC,'corrections.geojson'))),standSummary:json(path.join(DOC,'stand-summary.json')),defaultRemainsBaseline:true};
save(path.join(OUT,'pilot-source-manifest.json'),evidence);
const sourceManifestSha256=sha(fs.readFileSync(path.join(OUT,'pilot-source-manifest.json'))),writes=new Map(),entries=[],graphs=[];
for(let i=0;i<SLUGS.length;i++){
 const course=baseline.courses[i];const graph=await assembleVegetationGraph({slug:SLUGS[i],rootEntry:baseline.entries[i],courseManifest:course,groundManifest:baseline.ground,
  routingContent:readChunk(readAsset(course.routing.url)).content,resources,layerChunks,objectLayers:Object.fromEntries(compiled.layers),standLayers,sourceManifestSha256,courseSlugs:SLUGS,readAsset});
 assert.equal(graph.references.routing.sha256,course.routing.sha256);for(const [url,bytes] of graph.resources)writes.set(url,bytes);
 entries.push(graph.root.courses[0]);graphs.push({report:graph.report,references:graph.references});
}
assert.equal(graphs[0].references.ground.sha256,graphs[1].references.ground.sha256);
const root=json(path.join(OUT,'before/courses/v2-index.json'));
writes.set('courses/v2-index.json',canonicalJsonBytes({...root,courses:entries}));
const after=path.join(OUT,'after');
for(const [url,bytes] of writes){const p=path.join(after,url);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes);}
fs.copyFileSync(path.join(OUT,'before/courses/index.json'),path.join(after,'courses/index.json'));
const startup=await publishStartupPacks(after);
assert(fs.readFileSync(path.join(PUBLIC,'courses/v2-index.json')).equals(liveRoot));
save(path.join(OUT,'pilot-records.json'),records);
save(path.join(OUT,'publication.json'),{mode:'isolated-local-preview',records:records.length,graphs,standEvidence,startup,filesWritten:writes.size,productionRootSha256:sha(liveRoot)});
console.log(JSON.stringify({records:records.length,files:writes.size,ground:graphs[0].references.ground.sha256,sharedCourses:SLUGS}));
