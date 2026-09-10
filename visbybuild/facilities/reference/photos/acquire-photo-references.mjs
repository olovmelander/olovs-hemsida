import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const pages = [
  ['club-contact','https://www.visbygk.com/besoka-kronholmen/'],
  ['restaurant','https://www.visbygk.com/restaurang/'],
  ['fyrhuset','https://www.visbygk.com/fyrhuset/'],
  ['shop','https://www.visbygk.com/shopen-pa-kronholmen/'],
  ['range','https://www.visbygk.com/trackman-range/'],
  ['press','https://www.visbygk.com/press-media/'],
  ['club-home','https://www.visbygk.com/'],
  ['lighthouse-society','https://fyr.org/wiki/index.php/Skansudde'],
  ['commons-clubhouse','https://commons.wikimedia.org/wiki/File:Visby_GKs_klubbhus_p%C3%A5_Kronholmens_golfbana_i_V%C3%A4stergarn.jpg'],
];
await fs.mkdir(dir,{recursive:true});
const collected=[];
for (const [id,url] of pages) {
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(40000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const html=await response.text();
    await fs.writeFile(path.join(dir,id+'.html'),html);
    const urls=[...new Set([...html.matchAll(/(?:https?:\/\/[^\s<>"']+|\/wiki\/images\/[^\s<>"']+)\.(?:jpg|jpeg|png|webp)(?:\?[^\s<>"']*)?/gi)].map(m=>new URL(m[0].replaceAll('&amp;','&'),url).href))];
    collected.push({id,url,localPage:id+'.html',retrievedAt:new Date().toISOString(),images:urls});
    console.log(id,urls.length);
  }catch(e){collected.push({id,url,error:e.message});console.log(id,e.message);}
}
await fs.writeFile(path.join(dir,'page-assets.json'),JSON.stringify(collected,null,2)+'\n');
const existing=JSON.parse(await fs.readFile(path.resolve(dir,'../../../reference/club-resources.json'),'utf8'));
console.log('Existing inventory keys:',Object.keys(existing));
