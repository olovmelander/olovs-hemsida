// Original soft brush silhouettes for the painterly canopy study.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const out=path.resolve('apps/golf/public/models/trees/foliage-study');
let seed=3017;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const shapes=[];
for(let tile=0;tile<4;tile++){
  const ox=tile%2*256,oy=Math.floor(tile/2)*256;
  const points=[];
  for(let i=0;i<24;i++){
    const a=i*Math.PI*2/24,r=87+random()*15;
    points.push([ox+128+Math.cos(a)*r,oy+128+Math.sin(a)*r]);
  }
  let d=`M${(points[0][0]+points[23][0])/2},${(points[0][1]+points[23][1])/2}`;
  for(let i=0;i<24;i++){
    const p=points[i],q=points[(i+1)%24];d+=` Q${p[0]},${p[1]} ${(p[0]+q[0])/2},${(p[1]+q[1])/2}`;
  }
  shapes.push(`<path d="${d}Z" fill="#f8f8f8"/>`);
  for(let j=0;j<34;j++){
    const a=j*2.39996323,r=76+random()*18,shade=Math.round(236+random()*18);
    const x=ox+128+Math.cos(a)*r,y=oy+128+Math.sin(a)*r;
    shapes.push(`<ellipse cx="${x}" cy="${y}" rx="${10+random()*10}" ry="${4+random()*6}" transform="rotate(${a*180/Math.PI+40} ${x} ${y})" fill="rgb(${shade},${shade},${shade})"/>`);
  }
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><filter id="soft"><feGaussianBlur stdDeviation="1.15"/></filter></defs><g filter="url(#soft)">${shapes.join('')}</g></svg>`;
fs.writeFileSync(path.join(out,'canopy-brush.svg'),svg);
const browser=await chromium.launch({channel:'chrome'});
try{
  const page=await browser.newPage();
  const png=await page.evaluate(async svg=>{
    const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(svg);await image.decode();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;canvas.getContext('2d').drawImage(image,0,0);return canvas.toDataURL('image/png').split(',')[1];
  },svg);
  fs.writeFileSync(path.join(out,'canopy-brush.png'),Buffer.from(png,'base64'));
}finally{await browser.close();}
console.log('Created soft canopy brush atlas.');
