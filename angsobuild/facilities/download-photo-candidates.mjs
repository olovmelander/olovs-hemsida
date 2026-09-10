// Candidate downloads retain source identities; visual curation is separate.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve('angsobuild/cache/facilities-2026-09-10/photos');
const discovery = JSON.parse(await fs.readFile(path.join(root, 'discovery.json'), 'utf8'));
const list = new Map();
const generated = /gemini|gpt-image|lucid-origin|leonardo|nano-banana|nb-ai|ai-golf|wepik/i;
const exclusions = discovery.imageCandidates.filter(x => generated.test(x.url)).map(x => ({...x,reason:'Filename explicitly identifies AI generation or generated artwork; excluded as site geometry evidence.'}));
for (const candidate of discovery.imageCandidates) {
  if (generated.test(candidate.url)) continue;
  let url = candidate.url;
  if (candidate.pages.includes('tourism-board')) {
    if (!url.includes('Angso-Golfklubb') || !url.endsWith('.jpg')) continue;
    url = url.replace(/\/_\d+x\d+[^/]+\//, '/');
  } else if (candidate.pages.includes('visitor-2014')) {
    if (!url.includes('/2014/05/')) continue;
    url = url.split('?')[0];
  } else {
    if (!url.includes('/wp-content/uploads/')) continue;
    if (/-\d+x\d+\./.test(url)) continue;
    if (candidate.pages.every(p=>p==='club-blog') && !/rest-bild|resized-20230413|range-oppen|img-0232|img-6418|img-4495|20230219|angso2024|flaggor|img-3318|img-6219|img-8369|img-1449|20260416|putting|vasteras/i.test(url)) continue;
    if (/frukost|ny-matbild|emmaj|fb-host|swerock|expandia|540449369|placeholder/i.test(url)) continue;
  }
  const current = list.get(url) ?? {...candidate, url, pages:[]};
  current.pages = [...new Set([...current.pages,...candidate.pages])]; list.set(url,current);
}
list.set('https://www.jmi-sweden.se/_project/_media/_gfx/angso-1.jpg',{url:'https://www.jmi-sweden.se/_project/_media/_gfx/angso-1.jpg',pages:['jmi-2020']});
const results=[];
const queue=[...list.values()];
await Promise.allSettled(Array.from({length:5}, async()=>{
  while(queue.length){
    const item=queue.shift();
    const basename=decodeURIComponent(new URL(item.url).pathname.split('/').pop());
    item.local=path.relative(process.cwd(),path.join(root,`${item.pages[0]}--${basename}`)).replaceAll('\\','/');
    try{
      const response=await fetch(item.url,{signal:AbortSignal.timeout(60000)});
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes=Buffer.from(await response.arrayBuffer());
      await fs.writeFile(item.local,bytes);
      item.bytes=bytes.length; item.sha256=crypto.createHash('sha256').update(bytes).digest('hex');
      item.contentType=response.headers.get('content-type');
    } catch(error){ item.error=error.message; }
    results.push(item);
  }
}));
results.sort((a,b)=>a.local.localeCompare(b.local));
await fs.writeFile(path.join(root,'photo-candidates.json'),JSON.stringify({retrievedAt:new Date().toISOString(),images:results,exclusions},null,2));
console.log(JSON.stringify({downloaded:results.filter(x=>!x.error).length,errors:results.filter(x=>x.error),excludedGenerated:exclusions.length}));
