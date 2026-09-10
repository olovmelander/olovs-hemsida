/* Decode only the published 1 m tiles needed by the authored facilities. */
import fs from 'node:fs';
import { readChunk, sha256Bytes } from '../../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../../packages/course-v2/terrain-grid.mjs';
const source=JSON.parse(fs.readFileSync('lidingobuild/cache/facilities-reference-2026-09-10/model-reference.json'));
const tiles=source.terrain.chunks.map(ref=>{
  const bytes=fs.readFileSync(`apps/golf/public/${ref.url}`);
  if(sha256Bytes(bytes)!==ref.sha256)throw Error('Terrain input changed');
  const {header,payload}=readChunk(bytes);
  return {bounds:ref.bounds,grid:header.grid,heights:Array.from(decodeTerrainGrid(payload,header.grid)),sha256:ref.sha256};
});
const out='lidingobuild/cache/facilities-model-2026-09-10';
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(`${out}/terrain-1m.json`,JSON.stringify({frame:source.frame,tiles}));
console.log(JSON.stringify({tiles:tiles.length,sourceSpacing:1,out}));
