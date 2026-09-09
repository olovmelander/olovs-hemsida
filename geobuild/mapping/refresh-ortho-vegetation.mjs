#!/usr/bin/env node
/* Update compiled stand exclusions after reviewed Veckefjarden turf changes.
 * Run after model/pack/migration/routing refresh. Default is a dry run; --write
 * publishes both courses together, with the root index replaced last.
 * Existing exclusions remain set. Crown objects require individual source
 * review if their centres lie on accepted turf, and are never removed here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { pointInPoly } from '../lib.mjs';
import { applyOrthoReview, ORTHO_REVIEW_PATH } from './apply-ortho-review.mjs';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
import { readChunk, writeChunk, assetReferenceForChunk } from '../../packages/course-v2/chunk-node.mjs';
import { canonicalJsonBytes } from '../../packages/course-v2/canonical-json.mjs';
import { assembleVegetationGraph } from '../../packages/course-v2/vegetation/publish-vegetation.mjs';
import { readPack, inflateStream } from '../../packages/course-pack/lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SLUGS = ['veckefjarden', 'veckefjarden-korthalsbanan'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const playable = h => ({n:h.n,line:h.line,pin:h.pin,green:{ring:h.green.ring,c:h.green.c},fairway:h.fairway.rings,
  tees:h.tees.pads.map(p=>({ring:p.ring,preserveTerrain:p.preserveTerrain})),inferPads:h.tees.inferPads,
  marks:h.tees.marks.map(m=>({c:m.c,b:m.b,m:m.m})),bunkers:h.bunkers.map(b=>b.ring)});

export function nearRing(x, z, ring, margin = 0) {
  if (pointInPoly(x,z,ring)) return true;
  return ring.some((a, i) => {
    const b = ring[(i+1)%ring.length], dx = b[0]-a[0], dz = b[1]-a[1];
    const t = Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz || 1)));
    return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz) <= margin;
  });
}

export function reviewedPlayingAreas(model, review) {
  // Require the accepted geometry to have actually reached the compatibility
  // model; a candidate ledger must never change the published forest alone.
  const applied = applyOrthoReview(model,review);
  if (!equal(applied,model)) throw new Error('Apply accepted orthophoto geometry to the model before updating vegetation');
  const project = ([x,z]) => latLonToSweref99Tm(model.origin.lat-z/model.mPerLat,model.origin.lon+x/model.mPerLon);
  return review.features.flatMap(feature => {
    const h = model.holes.find(h => h.n === feature.hole);
    const rings = feature.kind === 'fairway' ? h.fairway.rings : feature.kind === 'tee-set' ? h.tees.pads.map(pad=>pad.ring)
      : [feature.kind === 'green' ? h.green.ring : feature.kind === 'tee' ? h.tees.pads[feature.index].ring : h.bunkers[feature.index].ring];
    return rings.map(local => {
      const ring = local.map(project);
      return { id: feature.id, hole: feature.hole, kind: feature.kind, ring,
        bounds: [Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))] };
    });
  });
}

export function excludeReviewedStandCells(header, source, areas) {
  const s = header.standField;
  if (!s || !Number.isSafeInteger(s.width) || !Number.isSafeInteger(s.height) || s.width < 1 || s.height < 1 ||
      !Number.isFinite(s.cellMetres) || s.cellMetres <= 0 || source.length !== s.width*s.height*4) throw new Error('Invalid stand field lattice');
  const payload = Uint8Array.from(source), margin = s.cellMetres/Math.SQRT2;
  const candidates = areas.filter(a => a.bounds[0] <= header.bounds.maxEasting+margin && a.bounds[2] >= header.bounds.minEasting-margin &&
    a.bounds[1] <= header.bounds.maxNorthing+margin && a.bounds[3] >= header.bounds.minNorthing-margin);
  let changed = 0, eligibleCanopyRemoved = 0;
  for (let row=0;row<s.height;row++) for (let col=0;col<s.width;col++) {
    const i=(row*s.width+col)*4;
    if (!(payload[i+3]&1) || (payload[i+3]&4)) continue;
    const e=header.bounds.minEasting+(col+.5)*s.cellMetres, n=header.bounds.maxNorthing-(row+.5)*s.cellMetres;
    if (!candidates.some(a => e>=a.bounds[0]-margin && e<=a.bounds[2]+margin && n>=a.bounds[1]-margin && n<=a.bounds[3]+margin && nearRing(e,n,a.ring,margin))) continue;
    payload[i+3] |= 4; changed++;
    if (payload[i]) eligibleCanopyRemoved++;
  }
  return {payload,changed,eligibleCanopyRemoved};
}

export function individualTurfIntersections(records, areas) {
  return records.filter(o=>o.class==='tree').flatMap(o => {
    const hits = areas.filter(a => o.easting>=a.bounds[0] && o.easting<=a.bounds[2] && o.northing>=a.bounds[1] && o.northing<=a.bounds[3] && nearRing(o.easting,o.northing,a.ring));
    return hits.length ? [{id:o.id,easting:o.easting,northing:o.northing,reviewIds:[...new Set(hits.map(a=>a.id))]}] : [];
  });
}

/** Old immutable stand chunks remain on disk for rollback, but a candidate
 * graph must contain only chunks its final tile references reach. A chunk
 * shared by an unchanged tile must survive replacement on another tile. */
export function activeGroundResources(resources, ground, standLayers) {
  const referenced = new Set([ground.shell.url]);
  for (const tile of ground.tiles) for (const [kind, prior] of Object.entries(tile.layers)) {
    const reference = kind === 'stands' ? standLayers[tile.id] : prior;
    if (reference) referenced.add(reference.url);
  }
  return new Map([...resources].filter(([url]) => referenced.has(url)));
}

export async function prepareOrthoVegetation({repoRoot=ROOT,publicDir=path.join(repoRoot,'apps/golf/public')}={}) {
  const snapshots = new Map();
  const readFile = name => {const bytes=fs.readFileSync(name);snapshots.set(name,sha(bytes));return bytes;};
  const read = url => readFile(path.join(publicDir,url));
  const json = url => JSON.parse(read(url));
  const verify = reference => {
    const bytes=read(reference.url);
    if(bytes.length!==reference.bytes || sha(bytes)!==reference.sha256) throw new Error(`Published reference differs: ${reference.url}`);
    return bytes;
  };
  const modelBytes=readFile(path.join(repoRoot,'geobuild/course-model.json'));
  const reviewBytes=readFile(path.join(repoRoot,ORTHO_REVIEW_PATH));
  const model=JSON.parse(modelBytes),review=JSON.parse(reviewBytes),areas=reviewedPlayingAreas(model,review);
  const root=json('courses/v2-index.json'), entries=root.courses.filter(c=>c.groundId==='veckefjarden');
  if (!equal(entries.map(e=>e.slug).sort(),[...SLUGS].sort())) throw new Error('Expected both Veckefjarden courses on one shared ground');
  const courses=entries.map(e=>JSON.parse(verify(e.manifest)));
  if(new Set(courses.map(c=>c.groundManifest.sha256)).size!==1) throw new Error('Shared courses have different ground manifests');
  const ground=JSON.parse(verify(courses[0].groundManifest));
  if(ground.groundId!=='veckefjarden') throw new Error('Wrong vegetation ground');
  const live=json('courses/index.json');
  for(let i=0;i<entries.length;i++) {
    const fallback=entries[i].fallbackV1,pack=live.courses.find(c=>c.slug===entries[i].slug);
    if(!pack || fallback.sha256!==pack.sha256 || fallback.bytes!==pack.bytes || fallback.packUrl!==pack.packUrl.replace(/^\//,'')) throw new Error('Rebind current course packs before vegetation publication');
    const bytes=read(fallback.packUrl);
    if(bytes.length!==fallback.bytes || sha(bytes)!==fallback.sha256) throw new Error('Published course pack checksum differs');
    const primary=entries[i].slug==='veckefjarden';
    const sourceBytes=primary ? modelBytes : readFile(path.join(repoRoot,'veckefjardenkortbuild/course-model.json'));
    const source=primary ? model : JSON.parse(sourceBytes);
    const vectors=JSON.parse(inflateStream(readPack(bytes).sv));
    if(!equal(vectors.holes.map(playable),source.holes.map(playable))) throw new Error(`Published ${entries[i].slug} pack has stale playing geometry`);
    if(vectors.infra?.preserveMappedBoundaries!==model.infra?.preserveMappedBoundaries) throw new Error(`Published ${entries[i].slug} pack has stale boundary rendering policy`);
    const migrated=JSON.parse(readFile(path.join(repoRoot,`geo_data/course-v2/veckefjarden/migration/${primary?'course-model':'short-course-model'}.epsg3006.json`)));
    if(migrated.source.sha256!==sha(Buffer.from(sourceBytes.toString('utf8').replace(/\r\n/g,'\n')))) throw new Error(`Regenerate ${entries[i].slug} migration before vegetation publication`);
    const routing=readChunk(verify(courses[i].routing)).content;
    if(!equal(routing.holes.map(h=>h.line.map(p=>p.slice(0,2))),migrated.geometry.holes.map(h=>h.line))) throw new Error(`Rebind ${entries[i].slug} routing before vegetation publication`);
    if(!primary) {
      for(const feature of review.features) {
        const hole=model.holes.find(h=>h.n===feature.hole),key={green:'greens',fairway:'fairways',tee:'tees','tee-set':'tees',bunker:'bunkers'}[feature.kind];
        const rings=feature.kind==='fairway'?hole.fairway.rings:feature.kind==='tee-set'?hole.tees.pads.map(pad=>pad.ring)
          :[feature.kind==='green'?hole.green.ring:feature.kind==='tee'?hole.tees.pads[feature.index].ring:hole.bunkers[feature.index].ring];
        if(rings.some(ring=>!(vectors.scenery[key]||[]).some(other=>equal(other,ring)))) throw new Error(`Rebuild shared short-course scenery for ${feature.id} before vegetation publication`);
      }
    }
  }
  const resources=new Map([[ground.shell.url,verify(ground.shell)]]),layerChunks=new Map(),objectLayers={},standLayers={},changes=[];
  const intersections=new Map(); let individualCrowns=0;
  for(const tile of ground.tiles) {
    for(const reference of Object.values(tile.layers)) if(reference&&!resources.has(reference.url)) resources.set(reference.url,verify(reference));
    if(tile.layers.objects) {
      objectLayers[tile.id]=tile.layers.objects;
      const records=readChunk(resources.get(tile.layers.objects.url)).content.records;
      individualCrowns+=records.filter(o=>o.class==='tree').length;
      for(const hit of individualTurfIntersections(records,areas)) intersections.set(hit.id,hit);
    }
    if(!tile.layers.stands) continue;
    standLayers[tile.id]=tile.layers.stands;
    const original=readChunk(resources.get(tile.layers.stands.url));
    const changed=excludeReviewedStandCells(original.header,original.payload,areas);
    if(!changed.changed) continue;
    for(let i=0;i<original.payload.length;i++) if(i%4!==3 && original.payload[i]!==changed.payload[i]) throw new Error('A measured canopy channel changed');
    const bytes=writeChunk({header:original.header,payload:changed.payload,codec:original.codec});
    const reference=assetReferenceForChunk(bytes,{kind:'stands',directory:'grounds/veckefjarden/stands'});
    standLayers[tile.id]=reference; layerChunks.set(reference.url,bytes);
    changes.push({tileId:tile.id,previous:tile.layers.stands,updated:reference,excludedCellsAdded:changed.changed,eligibleCanopyCellsRemoved:changed.eligibleCanopyRemoved});
  }
  const sourcePath=path.join(repoRoot,'geo_data/course-v2/veckefjarden/source-manifest.json');
  const sourceManifestSha256=sha(Buffer.from(readFile(sourcePath).toString('utf8').replace(/\r\n/g,'\n')));
  const report={schemaVersion:1,groundId:'veckefjarden',review:{path:ORTHO_REVIEW_PATH,sha256:sha(Buffer.from(reviewBytes.toString('utf8').replace(/\r\n/g,'\n')))},
    sourceModelSha256:sha(Buffer.from(modelBytes.toString('utf8').replace(/\r\n/g,'\n'))),sourceManifestSha256,inputGround:courses[0].groundManifest,
    method:'Monotonically add stand exclusions within one cell half diagonal of accepted playing surfaces; preserve canopy channels, crown objects, terrain, surfaces and routing.',
    reviewedAreas:areas.length,individualCrownsPreserved:individualCrowns,individualIntersections:[...intersections.values()],
    changedTiles:changes.length,excludedCellsAdded:changes.reduce((s,c)=>s+c.excludedCellsAdded,0),eligibleCanopyCellsRemoved:changes.reduce((s,c)=>s+c.eligibleCanopyCellsRemoved,0),changes};
  const writes=new Map(), blocked=intersections.size>0;
  if(blocked) return {repoRoot,publicDir,snapshots,writes,report,blocked};
  const emitted=[];
  const activeResources=activeGroundResources(resources,ground,standLayers);
  for(let i=0;i<entries.length;i++) {
    const entry=entries[i],course=courses[i];
    const routing=readChunk(verify(course.routing)).content;
    const graph=await assembleVegetationGraph({slug:entry.slug,rootEntry:entry,courseManifest:course,groundManifest:ground,routingContent:routing,
      resources:activeResources,layerChunks,objectLayers,standLayers,sourceManifestSha256,courseSlugs:SLUGS});
    if(graph.references.routing.sha256!==course.routing.sha256) throw new Error('Vegetation refresh changed course routing');
    const nextGround=JSON.parse(Buffer.from(graph.resources.get(graph.references.ground.url)).toString('utf8'));
    for(const tile of ground.tiles) {
      const next=nextGround.tiles.find(t=>t.id===tile.id);
      if(!next || !equal(next.layers.terrain,tile.layers.terrain) || !equal(next.layers.surface,tile.layers.surface) || !equal(next.layers.objects,tile.layers.objects) || next.parentId!==tile.parentId) throw new Error('Vegetation refresh changed a protected ground layer');
    }
    for(const [url,bytes] of graph.resources) writes.set(url,bytes);
    emitted.push({entry:graph.root.courses[0],ground:graph.references.ground});
  }
  if(new Set(emitted.map(e=>e.ground.sha256)).size!==1) throw new Error('Vegetation refresh did not produce one shared ground');
  const nextRoot={...root,courses:root.courses.map(e=>emitted.find(x=>x.entry.slug===e.slug)?.entry??e)};
  writes.set('courses/v2-index.json',canonicalJsonBytes(nextRoot));
  report.outputGround=emitted[0].ground;
  return {repoRoot,publicDir,snapshots,writes,report,blocked};
}

export function writeOrthoVegetation(plan) {
  if(plan.blocked) throw new Error('Individual crowns intersect reviewed turf; review the reported objects against source images before publication');
  for(const [name,digest] of plan.snapshots) if(sha(fs.readFileSync(name))!==digest) throw new Error(`Input changed during vegetation preparation: ${name}`);
  for(const [url,bytes] of plan.writes) {
    if(url==='courses/v2-index.json') continue;
    const filename=path.join(plan.publicDir,url);
    if(fs.existsSync(filename)) {if(sha(fs.readFileSync(filename))!==sha(bytes)) throw new Error(`Immutable resource differs: ${url}`);continue;}
    fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,bytes);
  }
  const reportPath=path.join(plan.repoRoot,'geo_data/course-v2/veckefjarden/vegetation/lm-ortho-exclusion-review.json');
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(plan.report,null,2)+'\n');
  const rootPath=path.join(plan.publicDir,'courses/v2-index.json'),temp=`${rootPath}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp,plan.writes.get('courses/v2-index.json'));fs.renameSync(temp,rootPath);
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.slice(2).some(arg=>arg!=='--write')) throw new Error('Usage: node geobuild/mapping/refresh-ortho-vegetation.mjs [--write]');
  const plan=await prepareOrthoVegetation();
  console.log(JSON.stringify({...plan.report,dryRun:!process.argv.includes('--write'),blocked:plan.blocked},null,2));
  if(process.argv.includes('--write')) writeOrthoVegetation(plan);
}
