// Emit only into output/visby-tree-pilot/round5/after. The live root is an invariant.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {OUT,ROOT,PUBLIC,json,save,sha} from './round5-preview.mjs';
import {readChunk,writeChunk,assetReferenceForChunk} from '../../packages/course-v2/chunk-node.mjs';
import {standFieldHeaderSection,inspectStandFieldPayload} from '../../packages/course-v2/stand-field.mjs';
import {treeRecord,compileObjectChunks} from '../../packages/course-v2/vegetation/object-compiler.mjs';
import {createGroundSampler} from '../../packages/course-v2/vegetation/ground-sampler.mjs';
import {assembleVegetationGraph} from '../../packages/course-v2/vegetation/publish-vegetation.mjs';
import {writeGroundGraphFiles} from '../../packages/course-v2/emit-ground-graph-node.mjs';
import {publishStartupPacks} from '../build-startup-packs.mjs';

const round='round5';
const work=path.join(OUT,round);
const baseline=json(path.join(OUT,'baseline.json'));
const liveRoot=fs.readFileSync(path.join(PUBLIC,'courses/v2-index.json'));
const readAsset=url=>fs.readFileSync(path.join(OUT,'before',url));
const sampler=await createGroundSampler(baseline.ground,readAsset);
const drafts=json(path.join(work,'pilot-record-drafts.json')),records=[];
for(const r of drafts){
 if(!r.pilotEdit){records.push(r);continue;}
 const base=await sampler.sample(r.easting,r.northing);
 records.push(treeRecord({...r,groundId:'visby',candidate:{heightMetres:r.objectHeightMetres,radiusMetres:r.radiusMetres},baseHeightRH2000:base?.heightRH2000}));
}
assert.equal(new Set(records.map(r=>r.id)).size,records.length,'duplicate IDs');
const compiled=compileObjectChunks({groundId:'visby',tiles:baseline.ground.tiles,records});
const resources=new Map();
resources.set(baseline.ground.shell.url,readAsset(baseline.ground.shell.url));
for(const tile of baseline.ground.tiles)for(const kind of ['terrain','surface']){
 const ref=tile.layers[kind];if(ref)resources.set(ref.url,readAsset(ref.url));
}
const layerChunks=new Map(compiled.chunks.map(c=>[c.reference.url,c.bytes]));
const standLayers={},standEvidence=[];
for(const job of json(path.join(work,'stand-output/index.json'))){
 const tile=baseline.ground.tiles.find(t=>t.id===job.tileId);
 if(!job.changed){standLayers[tile.id]=tile.layers.stands;resources.set(tile.layers.stands.url,readAsset(tile.layers.stands.url));continue;}
 const payload=fs.readFileSync(path.join(work,job.file));assert.equal(sha(payload),job.sha256);
 const header={schemaVersion:2,id:tile.id,kind:'stands',owner:{type:'ground',id:'visby'},bounds:tile.bounds,
   payloadFormat:'stand-field-u8-v1',requiredFeatures:['chunk-envelope-v2','stand-field-u8-v1'],
   standField:standFieldHeaderSection(job)};
 const inspected=inspectStandFieldPayload(payload,header);
 const bytes=writeChunk({header,payload});const reference=assetReferenceForChunk(bytes,{kind:'stands',directory:'grounds/visby/stands'});
 layerChunks.set(reference.url,bytes);standLayers[tile.id]=reference;
 standEvidence.push({tileId:tile.id,cellMetres:job.cellMetres,bytes:bytes.length,decodedBytes:payload.length,inspected});
}
const doc=path.join(ROOT,'geo_data/course-v2/visby/vegetation/pilot',round);
const evidence={kind:'local-vegetation-pilot',groundId:'visby',baselineSourceManifestSha256:baseline.ground.sourceManifestSha256,
 baselineGround:baseline.course.groundManifest,sourceEvidence:json(path.join(OUT,'source-evidence.json')),
 correctionsSha256:sha(fs.readFileSync(path.join(doc,'corrections.json'))),standSummary:json(path.join(doc,'stand-summary.json')),
 seasonalSource:json(path.join(OUT,'seasonal-source.json')),defaultRemainsBaseline:true};
if(round)evidence.previousPublicationSha256=sha(fs.readFileSync(path.join(OUT,'round4','publication.json')));
save(path.join(work,'pilot-source-manifest.json'),evidence);
const graph=await assembleVegetationGraph({slug:'visby',rootEntry:baseline.entry,courseManifest:baseline.course,groundManifest:baseline.ground,
 routingContent:readChunk(readAsset(baseline.course.routing.url)).content,resources,layerChunks,
 objectLayers:Object.fromEntries(compiled.layers),standLayers,sourceManifestSha256:sha(fs.readFileSync(path.join(work,'pilot-source-manifest.json'))),readAsset});
const after=path.join(work,'after');
assert(after.startsWith(OUT+path.sep));
const written=await writeGroundGraphFiles(after,graph);
// Match the baseline's lossless startup transport instead of falling back to
// hundreds of individual chunk requests for the new manifest generation.
fs.copyFileSync(path.join(OUT,'before/courses/index.json'),path.join(after,'courses/index.json'));
const startup=await publishStartupPacks(after);
assert(fs.readFileSync(path.join(PUBLIC,'courses/v2-index.json')).equals(liveRoot),'production root changed');
save(path.join(work,'pilot-records.json'),records);
save(path.join(work,'publication.json'),{mode:'isolated-local-preview',records:records.length,graph:graph.report,references:graph.references,
 standEvidence,startup,filesWritten:written.length,productionRootSha256:sha(liveRoot)});
console.log(JSON.stringify({records:records.length,files:written.length,graph:graph.report},null,2));
