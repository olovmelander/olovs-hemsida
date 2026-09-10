import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const url='https://semesterisverige.nu/semester-i-sverige/fyrhuset-visby-gk-kronholmen/';
const response=await fetch(url);const html=await response.text();await fs.writeFile(path.join(dir,'semester-2023.html'),html);
const requested=process.argv.slice(2);
const urls=[...new Set([...html.matchAll(/https?:\/\/[^\s<>"']+\.(?:jpg|jpeg|png)/gi)].map(m=>m[0]))].filter(u=>/uploads\/(2023\/04|2023\/06)/.test(u)&&!/-\d+x\d+\./.test(u)&&(!requested.length||requested.some(n=>u.endsWith('/'+n+'.jpg'))));
console.log(urls);
const manifest=JSON.parse((await fs.readFile(path.join(dir,'source-manifest.json'),'utf8')).replace(/^\uFEFF/,''));
for(let i=0;i<urls.length;i++){
 const u=urls[i];if(manifest.assets.some(a=>a.imageUrl===u&&a.status==='downloaded'))continue;try{const r=await fetch(u,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);const bytes=Buffer.from(await r.arrayBuffer());const file='semester--'+decodeURIComponent(new URL(u).pathname.split('/').pop());await fs.writeFile(path.join(dir,file),bytes);manifest.assets.push({id:'semester-2023-'+file.replace(/^semester--|\.jpg$/g,''),sourcePageUrl:url,imageUrl:u,localFile:file,status:'downloaded',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),contentType:r.headers.get('content-type'),retrievedAt:new Date().toISOString(),captureDate:'2023-04 (mid-April visit stated in article; exact day unknown)',publicationDate:'2023-06-26',author:'Johannes Helje (gallery photograph attribution)',rights:'Research reference only; no redistribution grant established'});console.log(file,bytes.length);}catch(e){manifest.failedDownloads??=[];manifest.failedDownloads.push({imageUrl:u,error:e.message,attemptedAt:new Date().toISOString()});console.log(e.message,u);}
}
await fs.writeFile(path.join(dir,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
