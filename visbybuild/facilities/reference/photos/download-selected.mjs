import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const pages=JSON.parse(await fs.readFile(path.join(dir,'page-assets.json'),'utf8'));
const queue=[];
for(const p of pages){
 const urls=(p.images||[]).filter(u=>/visbygk.com\/wp-content\/uploads\//.test(u)&& !/-\d+x\d+\.|favicon|orjan|macka|Havdhem|logga|titleist|cobra|steffe|ellen|courses|spel|practice|default|Magnus|golf-svv|ocean|Golflamm|film/.test(u));
 for(const u of urls)if(!queue.find(x=>x.imageUrl===u))queue.push({id:p.id+'-'+String(urls.indexOf(u)+1).padStart(2,'0'),sourcePageUrl:p.url,imageUrl:u,localFile:p.id+'--'+decodeURIComponent(new URL(u).pathname.split('/').pop()),rights:'Research reference only; no redistribution or texture-use grant established',captureDate:null});
}
const cm=pages.find(p=>p.id==='commons-clubhouse');
const cu=cm.images.find(u=>/^https:\/\/upload.wikimedia.org\/wikipedia\/commons\/(?!thumb)/.test(u)&&/Visby_GKs/.test(u));
queue.push({id:'commons-clubhouse-2009',sourcePageUrl:cm.url,imageUrl:cu,localFile:'commons-clubhouse-2009.jpg',rights:'CC BY-SA 2.0',author:'Daniel Glifberg',captureDate:'2009-08-02T12:46:00',licenseUrl:'https://creativecommons.org/licenses/by-sa/2.0/'});
queue.push({id:'chab-2016-survey',sourcePageUrl:'https://www.chab.se/wp-content/uploads/2016/12/forundersokningKronholmen.pdf',imageUrl:'https://www.chab.se/wp-content/uploads/2016/12/forundersokningKronholmen.pdf',localFile:'chab-kronholmen-survey-2016.pdf',rights:'Research reference only; no redistribution grant established',captureDate:null});
const results=[];
async function worker(){while(queue.length){const r=queue.shift();try{const response=await fetch(r.imageUrl,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const bytes=Buffer.from(await response.arrayBuffer());if(!/image\/|application\/pdf/.test(response.headers.get('content-type')))throw new Error('Not an image/PDF');await fs.writeFile(path.join(dir,r.localFile),bytes);results.push({...r,status:'downloaded',retrievedAt:new Date().toISOString(),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),contentType:response.headers.get('content-type'),lastModified:response.headers.get('last-modified'),etag:response.headers.get('etag')});console.log('saved',r.localFile,bytes.length);}catch(e){results.push({...r,status:'failed',error:e.message});console.log('failed',r.id,e.message);}}}
await Promise.all([worker(),worker(),worker()]);
await fs.writeFile(path.join(dir,'source-manifest.json'),JSON.stringify({schemaVersion:1,groundId:'visby',retrievedDate:'2026-09-10',note:'Photographs are reference evidence; dimensions/heights inferred from a photograph are not surveyed. Upload path dates are not confirmed capture dates.',assets:results},null,2)+'\n');
