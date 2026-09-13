// Original vector foliage sprites. Each species gets four variants in one atlas.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const out=path.resolve('apps/golf/public/models/trees/foliage-study');
let state=7251;
const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
const browser=await chromium.launch({channel:'chrome'});
try{
  const page=await browser.newPage();
  for(const species of ['gran','bjork','al','ek']){
    const shapes=[];
    for(let tile=0;tile<4;tile++){
      const ox=tile%2*256,oy=Math.floor(tile/2)*256;
      shapes.push(`<circle cx="${ox+128}" cy="${oy+128}" r="32" fill="white"/>`);
      for(let j=0;j<160;j++){
        const a=j*2.39996323, r=Math.sqrt((j+.5)/160)*91;
        const x=ox+128+Math.cos(a)*r, y=oy+128+Math.sin(a)*r;
        const rot=a*180/Math.PI+(random()-.5)*100;
        const shade=Math.round(222+random()*33),fill=`rgb(${shade},${shade},${shade})`;
        const length=10+random()*11,width=species==='bjork'?6:species==='ek'?8:7;
        let d;
        if(species==='gran'){
          d=`M-10,0 Q2,-4 23,-2 Q8,3 -10,0 M-10,0 Q-2,-8 17,-13 Q9,-4 -10,0 M-10,0 Q0,6 19,12 Q5,8 -10,0`;
        }else if(species==='bjork'){
          d=`M-${length*.65},0 Q-4,-${width} 0,-${width} L${length},0 L0,${width} Q-4,${width} -${length*.65},0Z`;
        }else if(species==='ek'){
          d=`M-${length},0 Q-${length},-5 -8,-4 Q-8,-11 -2,-7 Q3,-13 7,-6 Q${length+7},-6 ${length},0 Q${length+7},6 7,6 Q3,13 -2,7 Q-8,11 -8,4 Q-${length},5 -${length},0Z`;
        }else{
          d=`M-${length},0 C-${length},-${width} 8,-${width+2} ${length},0 C8,${width+2} -${length},${width} -${length},0Z`;
        }
        shapes.push(`<path fill="${fill}" transform="translate(${x} ${y}) rotate(${rot})" d="${d}"/>`);
      }
    }
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${shapes.join('')}</svg>`;
    fs.writeFileSync(path.join(out,`${species}-leaves.svg`),svg);
    const data=await page.evaluate(async svg=>{
      const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(svg);await img.decode();
      const c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').drawImage(img,0,0);
      return c.toDataURL('image/png').split(',')[1];
    },svg);
    fs.writeFileSync(path.join(out,`${species}-leaves.png`),Buffer.from(data,'base64'));
  }
}finally{await browser.close();}
console.log('Created spruce, birch, alder and oak foliage atlases.');
