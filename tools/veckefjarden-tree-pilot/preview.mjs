// Ground-specific local adapter: both routings share one frozen ground.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {readChunk} from '../../packages/course-v2/chunk-node.mjs';
import {courseExclusionFeatures,EXCLUSION_REASONS} from '../../packages/course-v2/vegetation/semantic-exclusions.mjs';

export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const OUT=path.join(ROOT,'output/veckefjarden-tree-pilot');
export const DOC=path.join(ROOT,'geo_data/course-v2/veckefjarden/vegetation/reviews/2026-09-16');
export const PUBLIC=path.join(ROOT,'apps/golf/public');
export const SLUGS=['veckefjarden','veckefjarden-korthalsbanan'];
export const sha=b=>createHash('sha256').update(b).digest('hex');
export const json=p=>JSON.parse(fs.readFileSync(p,'utf8'));
export function save(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');}

export function freeze(){
 if(fs.existsSync(path.join(OUT,'baseline.json')))throw Error('Baseline already exists; preserve it');
 const root=json(path.join(PUBLIC,'courses/v2-index.json'));
 const entries=SLUGS.map(s=>root.courses.find(c=>c.slug===s));
 const courses=entries.map(e=>json(path.join(PUBLIC,e.manifest.url)));
 if(courses[0].groundManifest.sha256!==courses[1].groundManifest.sha256)throw Error('Shared ground mismatch');
 const ground=json(path.join(PUBLIC,courses[0].groundManifest.url));
 const files=new Set(['courses/v2-index.json','courses/index.json',courses[0].groundManifest.url,ground.shell.url]);
 for(let i=0;i<entries.length;i++){
  const e=entries[i],c=courses[i];for(const f of [e.manifest.url,c.routing.url,e.fallbackV1.packUrl])files.add(f);
  const start=json(path.join(PUBLIC,'courses/index.json')).courses.find(c=>c.slug===e.slug)?.startup;
  if(start){files.add(start.url);for(const p of json(path.join(PUBLIC,start.url)).packs)files.add(p.url);}
 }
 for(const t of ground.tiles)for(const r of Object.values(t.layers))if(r)files.add(r.url);
 for(const folder of ['models/trees','models/veckefjarden']){
  const walk=dir=>{for(const d of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,d.name);if(d.isDirectory())walk(f);else files.add(path.relative(PUBLIC,f));}};walk(path.join(PUBLIC,folder));
 }
 const identities=[];
 for(const url of files){const bytes=fs.readFileSync(path.join(PUBLIC,url)),dest=path.join(OUT,'before',url);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);identities.push({url,sha256:sha(bytes),bytes:bytes.length});}
 const records=ground.tiles.flatMap(t=>t.layers.objects?readChunk(fs.readFileSync(path.join(PUBLIC,t.layers.objects.url))).content.records:[]);
 if(new Set(records.map(r=>r.id)).size!==records.length)throw Error('Duplicate baseline IDs');
 save(path.join(OUT,'baseline-records.json'),records);
 save(path.join(OUT,'baseline.json'),{version:1,capturedAt:new Date().toISOString(),entries,courses,ground,identities,records:records.length,productionRootSha256:sha(fs.readFileSync(path.join(PUBLIC,'courses/v2-index.json')))});
 const geometries=['course-model','short-course-model'].map(name=>json(path.join(ROOT,`geo_data/course-v2/veckefjarden/migration/${name}.epsg3006.json`)).geometry);
 save(path.join(OUT,'exclusions.json'),{geometries,features:geometries.flatMap(courseExclusionFeatures),reasons:EXCLUSION_REASONS});
 const stands=[];
 for(const tile of ground.tiles)if(tile.lod===0&&tile.layers.stands){const c=readChunk(fs.readFileSync(path.join(OUT,'before',tile.layers.stands.url))),file=tile.id.replaceAll('/','-')+'.u8';fs.mkdirSync(path.join(OUT,'stand-inputs'),{recursive:true});fs.writeFileSync(path.join(OUT,'stand-inputs',file),c.payload);stands.push({tile,header:c.header,file});}
 save(path.join(OUT,'stand-inputs/index.json'),stands);
 console.log(JSON.stringify({records:records.length,files:files.size,sharedCourses:courses.length,standTiles:stands.length}));
}
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.geojson':'application/geo+json'};
export async function serve(mode='before',port=0){
 if(!['before','after'].includes(mode))throw Error('Invalid preview generation');
 const roots=[path.join(OUT,mode),path.join(OUT,'build'),path.join(OUT,'before'),PUBLIC];
 const server=http.createServer((req,res)=>{let relative;try{relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1)||'index.html'}catch{res.writeHead(400);res.end();return;}
 const candidates=relative.startsWith('tree-review/')?[{root:OUT,relative:relative.slice(12)}]:roots.map(root=>({root,relative}));
 const file=candidates.map(({root,relative})=>({root,file:path.resolve(root,relative)})).find(({root,file})=>file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())?.file;
 if(!file){res.writeHead(404);res.end('not found');return;}res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','content-length':fs.statSync(file).size,'cache-control':'no-store'});fs.createReadStream(file).pipe(res);});
 await new Promise(r=>server.listen(port,'127.0.0.1',r));return{server,url:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='freeze')freeze();else if(process.argv[2]==='serve'){const s=await serve(process.argv[3]||'before',Number(process.argv[4])||8652);console.log(s.url);}else throw Error('freeze | serve before|after [port]');
}
