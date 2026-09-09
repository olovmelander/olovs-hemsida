// Read the exact published graph; no recompilation or vegetation mutation.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyChunkAsset} from '../../packages/course-v2/chunk-node.mjs';
import {decodeStandField} from '../../packages/course-v2/stand-field.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const pub=path.join(root,'apps/golf/public');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const index=read(path.join(pub,'courses/v2-index.json'));
const entry=index.courses.find(c=>c.slug==='johannesberg');
const course=read(path.join(pub,entry.manifest.url));
const groundBytes=fs.readFileSync(path.join(pub,course.groundManifest.url));
if(createHash('sha256').update(groundBytes).digest('hex')!==course.groundManifest.sha256) throw new Error('Ground hash mismatch');
const ground=JSON.parse(groundBytes),trees=[],stands=[],sourceLayers=[];
for(const tile of ground.tiles.filter(t=>t.lod===0)) {
  for(const kind of ['objects','stands']) {
    const ref=tile.layers[kind]; if(!ref)continue;
    const chunk=verifyChunkAsset(ref,fs.readFileSync(path.join(pub,ref.url)));
    sourceLayers.push({tileId:tile.id,kind,sha256:ref.sha256});
    if(kind==='objects') {
      for(const record of chunk.content.records.filter(r=>r.class==='tree')) trees.push({...record,tileId:tile.id});
    } else {
      const d=decodeStandField(chunk.payload,chunk.header.standField);
      for(let row=0;row<d.height;row++)for(let col=0;col<d.width;col++){
        const i=row*d.width+col;
        if(!(d.flags[i]&1)||(d.flags[i]&4)||d.fraction[i]<=0)continue;
        const west=tile.bounds.minEasting+col*d.cellMetres,north=tile.bounds.maxNorthing-row*d.cellMetres;
        stands.push({id:`${tile.id}/${col}/${row}`,bounds:[west,north-d.cellMetres,west+d.cellMetres,north],
          canopyFraction:Number(d.fraction[i].toFixed(5)),meanHeightMetres:d.meanHeight[i],p95HeightMetres:d.p95Height[i]});
      }
    }
  }
}
const out={schemaVersion:1,groundId:'johannesberg',groundManifest:course.groundManifest,sourceLayers,trees,stands};
fs.writeFileSync(path.join(root,'johannesbergbuild/cache/lm-estate-review/published-vegetation.json'),JSON.stringify(out));
console.log(JSON.stringify({trees:trees.length,nonexcludedCanopyStandCells:stands.length,layers:sourceLayers.length}));
