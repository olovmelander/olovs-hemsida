/* Reproducible architecture QA from the shipping GPK1 model and public 1 m
 * terrain chunks. No acquisition credentials or private raw cache required. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readPack } from '../packages/course-pack/lib.mjs';
import { readChunk, sha256Bytes } from '../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../packages/course-v2/terrain-grid.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function loadArchitectureFixture() {
  const report=JSON.parse(fs.readFileSync(path.join(ROOT,'apps/golf/public/lidingo-ground-graph-report.json')));
  const ground=JSON.parse(fs.readFileSync(path.join(ROOT,`apps/golf/public/grounds/lidingo/ground-v2-${report.graph.groundManifestSha256}.json`)));
  const {sv}=readPack(fs.readFileSync(path.join(ROOT,'apps/golf/public/courses/lidingo/pack.bin')));
  const model=JSON.parse(zlib.inflateRawSync(sv)),origin=report.frame.origin;
  const tiles=ground.tiles.filter(t=>t.lod===0&&t.bounds.maxEasting>origin.easting-360&&t.bounds.minEasting<origin.easting+80&&t.bounds.maxNorthing>origin.northing-240&&t.bounds.minNorthing<origin.northing+200).map(t=>{
    const ref=t.layers.terrain,bytes=fs.readFileSync(path.join(ROOT,'apps/golf/public',ref.url));
    if(sha256Bytes(bytes)!==ref.sha256) throw new Error('Terrain fixture checksum mismatch');
    const {header,payload}=readChunk(bytes);
    if(header.grid.sampleSpacingMetres!==1) throw new Error('Architecture QA requires the published 1 m terrain');
    return {...t,grid:header.grid,heights:decodeTerrainGrid(payload,header.grid),sha256:ref.sha256};
  });
  function terrainH(x,z) {
    const e=origin.easting+x,n=origin.northing-z;
    const tile=tiles.find(t=>e>=t.bounds.minEasting&&e<=t.bounds.maxEasting&&n>=t.bounds.minNorthing&&n<=t.bounds.maxNorthing);
    if(!tile) throw new Error(`Architecture sample outside fixture: ${x},${z}`);
    const {grid:g,heights:h,bounds:b}=tile,u=e-b.minEasting,v=b.maxNorthing-n;
    const i=Math.min(g.width-2,Math.floor(u)),j=Math.min(g.height-2,Math.floor(v)),a=u-i,c=v-j,k=j*g.width+i;
    return (h[k]*(1-a)+h[k+1]*a)*(1-c)+(h[k+g.width]*(1-a)+h[k+g.width+1]*a)*c;
  }
  return {model,terrainH,terrainChunkSha256:tiles.map(t=>t.sha256)};
}
