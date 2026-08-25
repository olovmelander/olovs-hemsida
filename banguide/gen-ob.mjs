#!/usr/bin/env node
/* White out-of-bounds runs from the guide's boundary list. Red and yellow runs trace
   the margins of the water they mark and are built in buildMarking; only white follows
   the property line, so only white is generated here.

   The guide gives four sides. left/right run parallel to the hole, well outside play.
   `behind-green` is a boundary BEHIND the putting surface: the earlier version treated
   it as "crosses" and drew it straight through the fairway, which is how five OB runs
   came to cross the holes they belong to.

   Run:  node banguide/gen-ob.mjs [target.html] out.json                             */
import fs from 'node:fs';
import {load, alongLine, distToLine, fracs} from './lib.mjs';

const [,, a1, a2] = process.argv;
const outFile = a2 || a1;
const c = load(a2 ? a1 : undefined);
const {HOLES, lateral, inv} = c;
console.log('target lateral normal:', lateral.text, lateral.isRight ? '(the player\'s right)' : '(MIRRORED)');

const SIDE_OFF = 62;      /* property boundary, well outside the corridor */
const BEHIND   = 34;      /* how far past the green the back boundary sits */
const HALFSPAN = 54;      /* how wide a behind-green run is drawn */

const OB=[]; let behind=0;
for(const h of HOLES){
  const L=h.line;
  for(const b of ((inv[h.n]&&inv[h.n].boundaries)||[])){
    if(b.colour!=='white') continue;

    if(b.side==='behind-green'){
      /* perpendicular to the last leg, set back beyond the green */
      const p=alongLine(L,1.0);
      const [nx,nz]=lateral(p.b);
      const ax=Math.sin(p.b), az=Math.cos(p.b);
      const bx=p.x+ax*(h.gr[0]+BEHIND), bz=p.z+az*(h.gr[1]+BEHIND);
      const pts=[];
      for(let k=-1;k<=1;k++) pts.push([+(bx+nx*HALFSPAN*k).toFixed(1), +(bz+nz*HALFSPAN*k).toFixed(1)]);
      OB.push({p:pts, h:h.n}); behind++;
      continue;
    }

    let fr=fracs(b.extent)||[0.05,0.95];
    let [f0,f1]=fr; if(f1-f0<0.15){const cc=(f0+f1)/2; f0=Math.max(0,cc-0.3); f1=Math.min(1.1,cc+0.3);}
    const sides = b.side==='both' ? [-1,1] : b.side==='left' ? [-1] : b.side==='right' ? [1] : [1];
    for(const dir of sides){
      const pts=[];
      for(let k=0;k<=6;k++){
        const f=f0+(f1-f0)*k/6, p=alongLine(L,f);
        const [nx,nz]=lateral(p.b);
        pts.push([+(p.x+nx*dir*SIDE_OFF).toFixed(1), +(p.z+nz*dir*SIDE_OFF).toFixed(1)]);
      }
      OB.push({p:pts, h:h.n});
    }
  }
}

let crossing=0;
for(const o of OB){
  const h=HOLES.find(x=>x.n===o.h); if(!h) continue;
  if(Math.min(...o.p.map(q=>distToLine(q[0],q[1],h.line))) < 12) crossing++;
}
console.log('white out-of-bounds runs generated:', OB.length, '(' + behind + ' behind a green)');
console.log('runs still crossing their own hole:', crossing);
fs.writeFileSync(outFile, JSON.stringify(OB,null,1));
