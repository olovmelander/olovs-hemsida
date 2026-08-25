#!/usr/bin/env node
/* Rebuild every hole's bunker list from the guide plans. The page's bk entries are
   [fractionAlongHole, lateralOffset, rx, rz, angle]; the guide gives where/side/
   approxFraction/size per bunker. The lateral offset is signed against the page's own
   normal, so this reads that normal out of the target -- generating offsets for one
   sign and rendering them with the other is exactly how 51 bunkers ended up mirrored.

   Safety rules, learnt the hard way on the water:
     - a bunker may not sit on any green's putting surface
     - a bunker may not sit in water
     - bunkers on the same hole may not stack on top of each other

   Run this AFTER the water is applied, so it can see what it has to avoid.
   Run:  node banguide/gen-bunkers.mjs [target.html] out.json                         */
import fs from 'node:fs';
import {load, hyp, alongLine, ptSegD, ellipseSD} from './lib.mjs';

const [,, a1, a2] = process.argv;
const outFile = a2 || a1;
const c = load(a2 ? a1 : undefined);
const {HOLES, lcClass, lateral, inv, PONDS, STREAMS} = c;
console.log('target lateral normal:', lateral.text, lateral.isRight ? '(the player\'s right)' : '(MIRRORED)');

const inWater=(x,z,trustRaster)=>{
  if(trustRaster!==false && lcClass(x,z)===1) return true;
  for(const p of PONDS) if(p.r && ellipseSD(x,z,p.c[0],p.c[1],p.r[0],p.r[1],p.rot)<6) return true;
  for(const st of STREAMS) for(let i=0;i<st.p.length-1;i++)
    if(ptSegD(x,z,st.p[i][0],st.p[i][1],st.p[i+1][0],st.p[i+1][1])<st.w*2.2) return true;
  return false;
};
const GREENS=HOLES.map(h=>({n:h.n, p:h.line[h.line.length-1], rx:h.gr[0], rz:h.gr[1], rot:h.grot||0}));

const SIZE={small:[9,6], medium:[12,8], large:[16,10]};
const out={}; let total=0, moved=0, dropped=0;
const notes=[];

for(const h of HOLES){
  const L=h.line, list=(inv[h.n]&&inv[h.n].bunkers)||[];
  const gp=L[L.length-1];
  const greenOnRasterWater = lcClass(gp[0],gp[1])===1;
  const placed=[], bk=[];
  for(const b of list){
    let f = (typeof b.approxFraction==='number') ? b.approxFraction : (b.where==='greenside'?0.97:0.6);
    f = Math.max(0.05, Math.min(1.12, f));
    let [rx,rz] = SIZE[b.size]||SIZE.medium;
    /* lateral offset: greenside bunkers hug the putting surface, fairway bunkers sit
       at the edge of the corridor */
    let lat;
    if(b.side==='left')       lat = -(b.where==='greenside' ? h.gr[0]+6 : 24);
    else if(b.side==='right') lat =  (b.where==='greenside' ? h.gr[0]+6 : 24);
    else if(b.side==='centre')lat = 0;
    else                      lat = (b.where==='greenside' ? h.gr[0]*0.35 : 14);
    if(b.side==='front') f = Math.min(f, 0.94);
    if(b.side==='rear')  f = Math.max(f, 1.05);

    /* resolve to world space, then apply the safety rules */
    let ok=false, fx=f, lx=lat;
    for(let attempt=0; attempt<40 && !ok; attempt++){
      const p=alongLine(L,fx);
      const [nx,nz]=lateral(p.b);
      const X=p.x+nx*lx, Z=p.z+nz*lx;
      let bad=false;
      for(const G of GREENS)
        if(ellipseSD(X,Z,G.p[0],G.p[1],G.rx+3,G.rz+3,G.rot) < Math.max(rx,rz)*0.55){ bad=true; break; }
      /* a greenside bunker sits on the built-up green complex, which stands above the
         water around it -- the island 14th is the whole point of that. Where the raster
         already calls the green water, only the explicit water is reliable. */
      const onComplex = b.where==='greenside' && hyp([X,Z],gp) < h.gr[0]+18;
      if(!bad && !onComplex && inWater(X,Z, !greenOnRasterWater)) bad=true;
      if(!bad) for(const q of placed)
        if(hyp([X,Z],q) < Math.max(rx,rz)+8){ bad=true; break; }
      if(!bad){ placed.push([X,Z]); ok=true; break; }
      /* slide outward on even attempts, inward on odd. On the island green at 14 the
         only dry ground is toward the putting surface, not away from it. */
      const sgn = lx<0 ? -1 : 1;
      lx += (attempt%2===0) ? sgn*3 : -sgn*4;
      if(Math.abs(lx)<4) lx = sgn*4;
      if(attempt%7===6) fx = Math.max(0.05, fx-0.03);
      if(attempt===0) moved++;
    }
    if(!ok){ dropped++; notes.push('h'+h.n+' '+b.where+' '+b.side+' could not be placed clear'); continue; }
    bk.push([+fx.toFixed(2), +lx.toFixed(0), rx, rz, 0]);
    total++;
  }
  out[h.n]=bk;
}
console.log('guide bunkers      :', Object.values(inv).reduce((a,h)=>a+((h.bunkers||[]).length),0));
console.log('placed             :', total);
console.log('nudged to stay clear:', moved);
console.log('dropped            :', dropped);
for(const n of notes) console.log('   -', n);
fs.writeFileSync(outFile, JSON.stringify(out,null,1));
