// Original vector pine shoots, rasterized for Blender and the runtime cutout map.
// Paired narrow needles replace the older broad radial leaf-shaped marks.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
const doc=path.resolve('docs/graphics/visby-martall-2026-09-21');
const out=path.resolve('apps/golf/public/models/trees');
let seed=21921;
const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const shapes=[];
for(let tile=0;tile<4;tile++){
  const ox=tile%2*256,oy=Math.floor(tile/2)*256;
  shapes.push(`<g transform="translate(${ox} ${oy})"><ellipse cx="128" cy="128" rx="22" ry="30" fill="#eee"/>`);
  for(let shoot=0;shoot<32;shoot++){
    const a=shoot*2.39996323;
    const r=Math.sqrt((shoot+.5)/32);
    const x=128+Math.cos(a)*64*r,y=137+Math.sin(a)*65*r;
    const angle=-Math.PI/2+(x-128)/105+(rand()-.5)*.45;
    const length=32+rand()*30,dx=Math.cos(angle),dy=Math.sin(angle);
    const shade=Math.round(223+rand()*32);
    shapes.push(`<path d="M128 157 Q${x} ${y+20} ${x+dx*length} ${y+dy*length}" fill="none" stroke="rgb(${shade},${shade},${shade})" stroke-width="3"/>`);
    for(let n=0;n<11;n++)for(const side of [-1,1]){
      const t=n/12;
      const bx=x+dx*length*t,by=y+dy*length*t;
      const theta=angle+side*(.42+rand()*.65);
      const len=17+rand()*15,width=1.1+rand()*1.0;
      const nx=Math.cos(theta),ny=Math.sin(theta);
      // Two tapering needles from the same fascicle, readable in the silhouette.
      for(const offset of [-.7,.7])shapes.push(`<path fill="rgb(${shade},${shade},${shade})" d="M${bx-ny*offset} ${by+nx*offset} Q${bx+nx*len*.55-ny*width} ${by+ny*len*.55+nx*width} ${bx+nx*len} ${by+ny*len} Q${bx+nx*len*.55+ny*width*.3} ${by+ny*len*.55-nx*width*.3} ${bx-ny*offset} ${by+nx*offset}Z"/>`);
    }
  }
  shapes.push('</g>');
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${shapes.join('')}</svg>`;
fs.writeFileSync(path.join(doc,'needle-shoots.svg'),svg);
const browser=await chromium.launch({channel:'chrome'});
try{
  const page=await browser.newPage();
  const data=await page.evaluate(async svg=>{
    const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];
  },svg);
  const bytes=Buffer.from(data,'base64'),sha256=createHash('sha256').update(bytes).digest('hex');
  const file=`visby-pine/${sha256}.png`;
  fs.writeFileSync(path.join(out,file),bytes);
  fs.writeFileSync(path.join(doc,'needle-atlas.json'),JSON.stringify({file,bytes:bytes.length,sha256},null,2)+'\n');
  console.log('Martall needle atlas:',file,bytes.length,'bytes');
}finally{await browser.close();}
