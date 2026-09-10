/* Check the retained published crowns/stand cells against reviewed turf. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyChunkAsset, sha256Bytes } from '../../packages/course-v2/chunk-node.mjs';
import { decodeStandField } from '../../packages/course-v2/stand-field.mjs';
import { inRing } from '../../apps/golf/src/engine/geom.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),pub=path.join(root,'apps/golf/public');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const entry=read(path.join(pub,'courses/v2-index.json')).courses.find(c=>c.slug==='norrfallsviken');
const course=read(path.join(pub,entry.manifest.url));
const bytes=fs.readFileSync(path.join(pub,course.groundManifest.url));
if(sha256Bytes(bytes)!==course.groundManifest.sha256)throw new Error('Ground hash mismatch');
const ground=JSON.parse(bytes),surfaces=[];
for(const part of ['front9','back9','fairways']) {
  const review=read(path.join(root,`nvgkbuild/mapping/review-${part}-2026-09-09.json`));
  for(const h of review.holes)for(const [kind,features] of [['green',h.green?[h.green]:[]],['tee',h.tees||[]],['fairway',h.fairways||[]]])
    for(const f of features) {
      if(surfaces.some(s=>s.id===f.id))continue;
      const r=f.ringEpsg3006;
      surfaces.push({id:f.id,hole:h.hole,kind,ring:r,bounds:[Math.min(...r.map(p=>p[0])),Math.min(...r.map(p=>p[1])),Math.max(...r.map(p=>p[0])),Math.max(...r.map(p=>p[1]))]});
    }
}
const hits=p=>surfaces.filter(s=>p[0]>=s.bounds[0]&&p[1]>=s.bounds[1]&&p[0]<=s.bounds[2]&&p[1]<=s.bounds[3]&&inRing(...p,s.ring));
let treeTotal=0,standTotal=0;const treeConflicts=[],standConflicts=[];
for(const tile of ground.tiles.filter(t=>t.lod===0))for(const kind of ['objects','stands']) {
  const ref=tile.layers[kind];if(!ref)continue;
  const chunk=verifyChunkAsset(ref,fs.readFileSync(path.join(pub,ref.url)));
  if(kind==='objects')for(const t of chunk.content.records.filter(r=>r.class==='tree')) {
    treeTotal++;const within=hits([t.easting,t.northing]);
    if(within.length)treeConflicts.push({tree:t,surfaces:within.map(s=>({id:s.id,hole:s.hole,kind:s.kind}))});
  }else {
    const field=decodeStandField(chunk.payload,chunk.header.standField);
    for(let row=0;row<field.height;row++)for(let col=0;col<field.width;col++) {
      const i=row*field.width+col;
      if(!(field.flags[i]&1)||(field.flags[i]&4)||field.fraction[i]<.15||field.p95Height[i]<2.5)continue;
      standTotal++;
      const centre=[tile.bounds.minEasting+(col+.5)*field.cellMetres,tile.bounds.maxNorthing-(row+.5)*field.cellMetres];
      const within=hits(centre);
      if(within.length)standConflicts.push({id:`${tile.id}/${col}/${row}`,centreEpsg3006:centre,canopyFraction:field.fraction[i],p95HeightMetres:field.p95Height[i],surfaces:within.map(s=>({id:s.id,hole:s.hole,kind:s.kind}))});
    }
  }
}
const report={groundId:'norrfallsviken',groundManifest:course.groundManifest,treeTotal,standTotal,treeConflicts,standConflicts,
  visualReview:{reviewedOn:'2026-09-09',captureDate:'2024-06-27',
    method:'Inspect all eight candidate locations in native 400 by 400 pixel crops from their retained source GeoTIFF transforms.',
    decision:'Retain all measured vegetation. Both individual-tree locations show canopy at the fairway edge. The six stand-cell locations lie along tree rows, canopy edges or shadowed rough beside the mown corridor; the 4 m cell and crown overhang are not equivalent to an obstruction on the putting surface.',
    candidateIds:[...treeConflicts.map(t=>t.tree.id),...standConflicts.map(t=>t.id)],
    uncertainty:'Coarse fairway-edge interpretation can include narrow rough fingers around trunks. These remain boundary uncertainty, not evidence for deleting the newer laser measurements.'},
  interpretation:'Geometric review candidates only. Measured crown centres and 4 m canopy cells can legitimately overlap grass. The 2025 laser is newer than the June 2024 imagery; preserve measurements until individual source review supports a change.'};
fs.writeFileSync(path.join(root,'geo_data/course-v2/norrfallsviken/reference/lm-vegetation-audit-2026-09-09.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({treeTotal,standTotal,treeConflicts:treeConflicts.length,standConflicts:standConflicts.length}));
