#!/usr/bin/env node
/* Compile source-constrained 4m Visby stand fields. No live graph publication.
   node geo_data/course-v2/visby/vegetation/compile-stands.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readChunk } from '../../../../packages/course-v2/chunk-node.mjs';
import { distanceToCells, voidMask } from '../../../../packages/course-v2/vegetation/canopy-fields.mjs';
import { compileStandChunks, readRawRaster } from '../../../../packages/course-v2/vegetation/compile-vegetation.mjs';
import { lidingoExclusionFeatures, lidingoExclusionMask, excludeInvalidLidingoCanopy } from '../../../../packages/course-v2/vegetation/lidingo-stand-exclusions.mjs';
import { VISBY_CANOPY_CONFIG as C } from './build-canopy.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
const OUT=path.join(ROOT,'visbybuild/cache/vegetation/stands-stage');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const rel=file=>path.relative(ROOT,file).split(path.sep).join('/');
const json=relative=>JSON.parse(fs.readFileSync(path.join(ROOT,relative),'utf8'));
const input=relative=>({path:relative,sha256:sha256(fs.readFileSync(path.join(ROOT,relative)))});
const SURFACE_PATHS=Object.freeze(['visbybuild/mapping/playing-surfaces.geojson','visbybuild/mapping/surface-stage.geojson']);
const SUPPORT_PATHS=Object.freeze([
  'visbybuild/mapping/practice-surfaces.geojson',
  'geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson',
  'geo_data/course-v2/visby/mapping/water-breakgeometry-epsg3006.geojson',
]);

/** Retain exact polygon holes and linear roads; point observations do not
    establish a footprint to clear. The reused mask code has no fixed AOI. */
export function visbyExclusionFeatures(collections){
  const normalized=collections.map(collection=>{
    if(collection?.crs?.properties?.name!=='EPSG:3006')throw new Error('Visby exclusions require EPSG:3006');
    return {...collection,features:collection.features.filter(f=>['Polygon','MultiPolygon','LineString','MultiLineString'].includes(f.geometry?.type)).map(f=>{
      const p={...f.properties};
      if(['approach','fringe','collar','practice-green','practice_green'].includes(p.kind))p.kind='green';
      if(['driving-range','driving_range','practice'].includes(p.kind))p.tags={...p.tags,golf:'driving_range'};
      return {...f,properties:p};
    })};
  });
  return lidingoExclusionFeatures(normalized);
}

export function assertVisbyStandInputs(index,readSource){
  if(!SURFACE_PATHS.includes(index.surfacePath))throw new Error('Unsupported Visby playing-surface source');
  const expected=[index.surfacePath,...SUPPORT_PATHS];
  if(index.inputs?.length!==expected.length || index.inputs.some(s=>!expected.includes(s.path)) || new Set(index.inputs.map(s=>s.path)).size!==expected.length)throw new Error('Visby exclusion inventory differs');
  for(const source of [...index.inputs,index.terrainStageSource])if(sha256(readSource(source.path))!==source.sha256)throw new Error(`Visby stand source changed:${source.path};explicit stand rebuild required`);
  for(const source of [index.canopySource,index.groundSource])if(sha256(readSource(source.data))!==source.sha256)throw new Error('Visby canopy source changed after stand compilation');
}

/** Called only by an explicitly authorized graph publisher. This function
    returns a composition; it does not write a manifest or runtime resource. */
export function attachVisbyStands(compilation,frame){
  const index=json(rel(path.join(OUT,'layer-index.json')));
  if(compilation.groundId!=='visby' || index.groundId!=='visby' || frame.fingerprint!==C.frameFingerprint || index.frameFingerprint!==frame.fingerprint || index.state!=='provisional-measured-stand-fields')throw new Error('Visby stand identity/frame differs');
  assertVisbyStandInputs(index,p=>fs.readFileSync(path.join(ROOT,p)));
  const terrainTiles=new Map(compilation.tiles.filter(t=>t.lod===0).map(t=>[t.id,t]));
  const resources=new Map(compilation.resources);
  for(const [tileId,reference]of Object.entries(index.standLayers)){
    const tile=terrainTiles.get(tileId);if(!tile)throw new Error(`Stand references absent terrain:${tileId}`);
    const file=path.resolve(ROOT,index.resourceRoot,reference.url);
    if(!file.startsWith(`${path.resolve(OUT)}${path.sep}`))throw new Error('Stand asset path leaves stage');
    const bytes=fs.readFileSync(file);
    if(bytes.length!==reference.bytes || sha256(bytes)!==reference.sha256)throw new Error(`Stand bytes differ:${tileId}`);
    const chunk=readChunk(bytes);
    if(chunk.header.id!==tileId || chunk.header.kind!=='stands' || chunk.header.owner?.id!=='visby')throw new Error(`Stand ownership differs:${tileId}`);
    for(const [key,value]of Object.entries(tile.bounds))if(chunk.header.bounds[key]!==value)throw new Error(`Stand/terrain bounds differ:${tileId}.${key}`);
    const previous=resources.get(reference.url);if(previous && !Buffer.from(previous).equals(bytes))throw new Error('Stand asset collision');
    resources.set(reference.url,bytes);
  }
  return {...compilation,resources,tiles:compilation.tiles.map(t=>({...t,layers:{...t.layers,stands:index.standLayers[t.id]??null}}))};
}

export function compileVisbyStands({surfacePath=SURFACE_PATHS[0]}={}){
  if(!SURFACE_PATHS.includes(surfacePath))throw new Error('Choose the final or preliminary Visby surface GeoJSON');
  const exclusionPaths=[surfacePath,...SUPPORT_PATHS];
  const exclusionInputs=exclusionPaths.map(p=>{const bytes=fs.readFileSync(path.join(ROOT,p));return {path:p,sha256:sha256(bytes),collection:JSON.parse(bytes)};});
  const evidence=json('geo_data/course-v2/visby/vegetation/canopy-evidence.json');
  const campaign=evidence.campaigns.find(c=>c.campaignId===C.campaignId);
  if(evidence.state!=='canopy-rasters-built' || campaign.tiles!==256 || evidence.configHash!==sha256(Buffer.from(JSON.stringify(C))))throw new Error('Complete pinned Visby canopy required');
  const source=campaign.files.chm,groundSource=campaign.files.ground;
  for(const s of [source,groundSource])if(sha256(fs.readFileSync(path.join(ROOT,s.data)))!==s.sha256)throw new Error('Canopy raster bytes changed');
  const raster=readRawRaster(path.join(ROOT,source.data),path.join(ROOT,source.sidecar));
  const ground=readRawRaster(path.join(ROOT,groundSource.data),path.join(ROOT,groundSource.sidecar));
  for(const r of [raster,ground])if(r.width!==C.width || r.height!==C.height || r.sampleSpacingMetres!==2 || r.originEasting!==C.originEasting || r.originNorthing!==C.originNorthing)throw new Error('Visby canopy lattice changed');
  const terrainEvidence=json('geo_data/course-v2/visby/acquisition/terrain-compile.json');
  const stagePath=terrainEvidence.stagingManifest.path;
  const stageBytes=fs.readFileSync(path.join(ROOT,stagePath));
  if(sha256(stageBytes)!==terrainEvidence.stagingManifest.sha256)throw new Error('Visby terrain stage changed');
  const stage=JSON.parse(stageBytes);
  if(stage.frame.fingerprint!==C.frameFingerprint || evidence.frameFingerprint!==C.frameFingerprint)throw new Error('Canopy/terrain frame differs');
  const tiles=stage.tiles.filter(t=>t.lod===0);
  if(tiles.length!==256)throw new Error('Complete 256 finest terrain tiles required');
  const features=visbyExclusionFeatures(exclusionInputs.map(s=>s.collection));
  const exclusions=lidingoExclusionMask(raster,features);
  // A 4m stand representative is jittered within its cell. Checking centres
  // alone missed seven fairway incursions in the first actual-runtime review.
  // A 2m guard still admitted one diagonal-edge point. Use the full 4m stand
  // cell width as a conservative guard, recorded separately from source widths.
  const guardDistances=distanceToCells(raster.width,raster.height,i=>exclusions.mask[i]===1);
  let jitterGuardAdditionalCells=0;
  for(let i=0;i<exclusions.mask.length;i++)if(guardDistances[i]<=2 && !exclusions.mask[i]){exclusions.mask[i]=1;jitterGuardAdditionalCells++;}
  exclusions.excludedCells+=jitterGuardAdditionalCells;
  const validity=excludeInvalidLidingoCanopy(exclusions.mask,raster.values,ground.values,{minimumVegetationGroundRH2000:0});
  exclusions.excludedCells+=validity.excludedAdditionalCells;
  const compiled=compileStandChunks({groundId:'visby',tiles,campaignFields:[{campaignId:C.campaignId,
    extent:[C.originEasting,C.originNorthing-C.height*2,C.originEasting+C.width*2,C.originNorthing],
    raster,voids:voidMask(raster),excludeMask:exclusions.mask,north:0}],cellMetres:4,canopyThresholdMetres:2});
  const assets=[];
  for(const chunk of compiled.chunks){
    readChunk(chunk.bytes);const file=path.join(OUT,chunk.reference.url);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    if(fs.existsSync(file) && !fs.readFileSync(file).equals(Buffer.from(chunk.bytes)))throw new Error('Stand content-address collision');
    fs.writeFileSync(file,chunk.bytes);assets.push({tileId:chunk.tileId,reference:chunk.reference,inspection:chunk.inspection});
  }
  const totals=assets.reduce((sum,a)=>({tiles:sum.tiles+1,encodedBytes:sum.encodedBytes+a.reference.bytes,
    measuredCells:sum.measuredCells+a.inspection.measuredCells,closedCanopyCells:sum.closedCanopyCells+a.inspection.closedCanopyCells,excludedCells:sum.excludedCells+a.inspection.excludedCells}),
  {tiles:0,encodedBytes:0,measuredCells:0,closedCanopyCells:0,excludedCells:0});
  const layerIndex={schemaVersion:1,groundId:'visby',frameFingerprint:C.frameFingerprint,state:'provisional-measured-stand-fields',campaignId:C.campaignId,
    captureStart:campaign.captureStart,captureEnd:campaign.captureEnd,resourceRoot:rel(OUT),standLayers:Object.fromEntries(compiled.layers),objectLayers:{},
    surfacePath,inputs:exclusionInputs.map(({path,sha256})=>({path,sha256})),terrainStageSource:input(stagePath),canopySource:source,groundSource,assets};
  for(const s of layerIndex.inputs)if(input(s.path).sha256!==s.sha256)throw new Error('An exclusion source changed during compilation; rerun explicitly');
  fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'layer-index.json'),JSON.stringify(layerIndex,null,2)+'\n');
  const report={schemaVersion:1,groundId:'visby',state:layerIndex.state,observedOn:new Date().toISOString().slice(0,10),frameFingerprint:C.frameFingerprint,
    campaignId:C.campaignId,captureStart:campaign.captureStart,captureEnd:campaign.captureEnd,sourceItems:C.sources.map(s=>s.id),sourceEvidence:'geo_data/course-v2/visby/vegetation/canopy-evidence.json',
    surfacePath,canopySource:source,groundSource,inputs:layerIndex.inputs,terrainStageSource:layerIndex.terrainStageSource,canopySampleSpacingMetres:2,cellMetres:4,canopyThresholdMetres:2,stands:totals,individualObjectRecords:0,
    exclusions:{features:features.length,cells2m:exclusions.excludedCells,fraction:exclusions.excludedCells/raster.values.length,byKind:exclusions.counts,buffers:exclusions.defaultBuffers,runtimeJitterGuardMetres:4,jitterGuardAdditionalCells,sourceValidity:validity},
    layerIndex:input(rel(path.join(OUT,'layer-index.json'))),
    baseHeightPolicy:{source:'same frame and finest terrain tile bounds as Visby staged terrain',terrainSha256:C.terrainSha256,storedIndividualBases:0,rule:'Runtime stand representatives must sample the exact visible terrain; canopy-ground is only the HAG normalization source.'},
    limitations:['Measured 4m canopy fractions and heights support representative vegetation; no individual stems or species were measured.',
      'Current presence since the 2024 capture remains subject to current imagery/site review.',
      'OSM, 2022 imagery-derived playing surfaces and national water exclusions are retained with distinct provenance.',
      'Void, invalid and below 0 m RH2000 cloud-ground cells are excluded conservatively; negative terrain remains valid terrain.',
      'No procedural population or object registry is generated; runtime representative size/species remains a display policy.',
      'Chunks remain staged; no runtime root or source manifest is published by this command.']};
  fs.writeFileSync(path.join(ROOT,'geo_data/course-v2/visby/vegetation/stand-evidence.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({stands:totals,exclusions:report.exclusions,layerIndex:report.layerIndex},null,2));
  return layerIndex;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{if(process.argv.length>3 || (process.argv[2] && process.argv[2]!=='--preliminary-surfaces'))throw new Error('usage: compile-stands.mjs [--preliminary-surfaces]');compileVisbyStands({surfacePath:process.argv[2]?SURFACE_PATHS[1]:SURFACE_PATHS[0]});}catch(e){console.error(e.message);process.exitCode=1;}}
