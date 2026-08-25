#!/usr/bin/env node
/* Turn the guide's per-hole water descriptions into world-space PONDS and STREAMS.
   Placement comes from each hole's own line: a fraction along it plus a lateral offset
   on the side the guide draws it. The side is taken from the target page's own normal
   (see banguide/lib.mjs) and written back onto every feature as `s`, so geomcheck can
   verify afterwards that the built water really is where the guide puts it.

   Hard rules, all learnt by breaking them:
     - never place water where the land-cover raster already has water (that is the
       fjord, and the guide's "lake" for such a hole IS the fjord)
     - never let a feature sit on a putting surface -- any hole's, not just its own
     - keep areal water out of the corridor unless the guide says it is carried

   Run:  node banguide/gen-water.mjs [target.html] out.json                          */
import fs from 'node:fs';
import {load, hyp, alongLine, distToLine, ptSegD, ellipseSD, fracs, sideOf} from './lib.mjs';

const [,, a1, a2] = process.argv;
const outFile = a2 || a1;
const c = load(a2 ? a1 : undefined);
const {HOLES, lcClass, lateral, inv} = c;
console.log('target lateral normal:', lateral.text, lateral.isRight ? '(the player\'s right)' : '(MIRRORED — the player\'s left)');

const OFF={lateral:34, carry:30, peripheral:60};
/* is the raster already water anywhere near here? then it is the fjord or one of its
   bays, and the guide's lake for this hole is that same water */
function nearRaster(px,pz,r){
  if(lcClass(px,pz)===1) return true;
  for(let a=0;a<16;a++){ const t=a*0.3927;
    if(lcClass(px+Math.cos(t)*r, pz+Math.sin(t)*r)===1) return true; }
  return false;
}

const PONDS=[], STREAMS=[], skipped=[];
for(const h of HOLES){
  const L=h.line, green=L[L.length-1];
  for(const w of ((inv[h.n]&&inv[h.n].water)||[])){
    let fr=fracs(w.extent) || [0.45,0.60];
    let [f0,f1]=fr;
    if(f1-f0<0.05){ const cc=(f0+f1)/2; f0=cc-0.04; f1=cc+0.04; }
    f0=Math.max(-0.05,f0); f1=Math.min(1.12,f1);
    const mid=alongLine(L,(f0+f1)/2);
    const [nx,nz]=lateral(mid.b);
    const dir = w.side==='left' ? -1 : 1;
    const base=OFF[w.inPlay]||40;
    const off = (w.side==='crosses'||w.side==='surrounds-green') ? 0 : dir*base;
    const cx=mid.x+nx*off, cz=mid.z+nz*off;
    const sideTag = (w.side==='left'||w.side==='right') ? w.side : null;

    if(w.side==='surrounds-green'){
      skipped.push('h'+h.n+' '+w.kind+' surrounds-green — the fjord already does this');
      continue;
    }
    if(w.kind==='lake' && nearRaster(cx,cz,90)){
      skipped.push('h'+h.n+' lake '+w.side+' — the fjord is already here');
      continue;
    }
    if(lcClass(cx,cz)===1){
      skipped.push('h'+h.n+' '+w.kind+' '+w.side+' — already water');
      continue;
    }

    const p0=alongLine(L,f0), p1=alongLine(L,f1);
    const spanM=Math.max(18, hyp([p0.x,p0.z],[p1.x,p1.z]));

    if(w.kind==='lake' || w.kind==='pond'){
      const big=w.kind==='lake';
      const crossCarry = (w.side==='crosses' && w.inPlay==='carry');
      let rx = big ? Math.min(58,Math.max(38,spanM*0.42)) : Math.max(15,Math.min(26,spanM*0.30));
      let rz = big ? Math.max(26,rx*0.58) : Math.max(12,rx*0.66);
      if(crossCarry){ rx=Math.min(rx,32); rz=Math.min(rz,22); }
      let px=cx, pz=cz;
      if(!crossCarry){                       /* clear the corridor */
        for(let k=0;k<80;k++){
          if(distToLine(px,pz,L) - Math.max(rx,rz) > 18) break;
          px+=nx*dir*4; pz+=nz*dir*4;
        }
      }
      for(let k=0;k<80;k++){                 /* and never sit on the green */
        if(hyp([px,pz],green) > Math.max(rx,rz)+34) break;
        px+=nx*dir*4; pz+=nz*dir*4;
      }
      const pen = (w.inPlay==='carry') ? 'y' : 'r';
      const rec={pen, c:[+px.toFixed(1),+pz.toFixed(1)], r:[+rx.toFixed(1),+rz.toFixed(1)],
                 rot:+(mid.b*180/Math.PI).toFixed(1), h:h.n, k:w.kind};
      if(sideTag) rec.s=sideTag;
      PONDS.push(rec);
    } else {
      const wdt = w.kind==='ditch' ? 2.0 : 2.8;
      let pts;
      if(w.side==='crosses'){
        const half = w.inPlay==='peripheral' ? 32 : 48;
        pts=[[mid.x-nx*half, mid.z-nz*half],
             [mid.x+nx*half*0.30, mid.z+nz*half*0.30],
             [mid.x+nx*half, mid.z+nz*half]];
      } else {
        const a=alongLine(L,f0), b=alongLine(L,f1);
        const an=lateral(a.b), bn=lateral(b.b);
        pts=[[a.x+an[0]*off, a.z+an[1]*off],
             [mid.x+nx*off*1.14, mid.z+nz*off*1.14],
             [b.x+bn[0]*off, b.z+bn[1]*off]];
      }
      /* a ditch quoted at fraction 1.0 would run straight over the putting surface;
         back it off along the hole until it clears the green */
      const gClear = pl => { let m=1e9;
        for(let i=0;i<pl.length-1;i++) m=Math.min(m,ptSegD(green[0],green[1],pl[i][0],pl[i][1],pl[i+1][0],pl[i+1][1]));
        return m; };
      const axis=[Math.sin(mid.b), Math.cos(mid.b)];        /* down the hole */
      for(let k=0;k<40 && gClear(pts)<30;k++)
        pts=pts.map(q=>[q[0]-axis[0]*5, q[1]-axis[1]*5]);
      const pen2 = (w.inPlay==='carry') ? 'y' : 'r';
      const rec={pen:pen2, p:pts.map(q=>[+q[0].toFixed(1),+q[1].toFixed(1)]), w:wdt, h:h.n, k:w.kind};
      if(sideTag) rec.s=sideTag;
      STREAMS.push(rec);
    }
  }
}

/* Global de-collision. The per-hole guards above only know about their own hole, but
   water from one hole can land on a neighbour's green -- hole 17's lake was sitting on
   the 8th green. Push any offender away from every green until all of them are clear.
   Pushing radially can shove a sided feature across its own centre line, so a feature
   that carries a side is pushed along its lateral axis instead, away from the hole. */
const GREENS=HOLES.map(h=>({n:h.n, p:h.line[h.line.length-1]}));
const holeOf=n=>HOLES.find(h=>h.n===n);
function escapeDir(rec, cx, cz, gx, gz){
  if(!rec.s) return [cx-gx, cz-gz];
  const h=holeOf(rec.h); if(!h) return [cx-gx, cz-gz];
  const p=alongLine(h.line, 0.5);
  const F=[Math.sin(p.b),Math.cos(p.b)], R=[-F[1],F[0]];
  const s = rec.s==='right' ? 1 : -1;
  return [R[0]*s, R[1]*s];
}
let nudged=0;
for(const p of PONDS){
  for(let k=0;k<120;k++){
    let worst=null;
    for(const G of GREENS){
      const sd=ellipseSD(G.p[0],G.p[1],p.c[0],p.c[1],p.r[0],p.r[1],p.rot);
      if(sd<24 && (!worst||sd<worst.sd)) worst={G,sd};
    }
    if(!worst) break;
    const [dx,dz]=escapeDir(p, p.c[0], p.c[1], worst.G.p[0], worst.G.p[1]);
    const m=Math.hypot(dx,dz)||1;
    p.c[0]=+(p.c[0]+dx/m*5).toFixed(1); p.c[1]=+(p.c[1]+dz/m*5).toFixed(1);
    if(k===0) nudged++;
  }
}
for(const st of STREAMS){
  for(let k=0;k<120;k++){
    let worst=null;
    for(const G of GREENS){
      let m=1e9;
      for(let i=0;i<st.p.length-1;i++)
        m=Math.min(m,ptSegD(G.p[0],G.p[1],st.p[i][0],st.p[i][1],st.p[i+1][0],st.p[i+1][1]));
      if(m<st.w*1.3+26 && (!worst||m<worst.m)) worst={G,m};
    }
    if(!worst) break;
    let cx=0,cz=0; for(const q of st.p){cx+=q[0];cz+=q[1];} cx/=st.p.length; cz/=st.p.length;
    const [dx,dz]=escapeDir(st, cx, cz, worst.G.p[0], worst.G.p[1]);
    const m2=Math.hypot(dx,dz)||1;
    st.p=st.p.map(q=>[+(q[0]+dx/m2*5).toFixed(1), +(q[1]+dz/m2*5).toFixed(1)]);
    if(k===0) nudged++;
  }
}

/* did anything end up on the wrong side of its own hole after all that? */
let wrong=0;
for(const rec of [...PONDS,...STREAMS]){
  if(!rec.s) continue;
  const h=holeOf(rec.h); if(!h) continue;
  let cx,cz;
  if(rec.c){ [cx,cz]=rec.c; }
  else { cx=0; cz=0; for(const q of rec.p){cx+=q[0];cz+=q[1];} cx/=rec.p.length; cz/=rec.p.length; }
  let best={d:1e9,p:null};
  for(let f=0;f<=40;f++){ const p=alongLine(h.line,f/40);
    const d=Math.hypot(cx-p.x,cz-p.z); if(d<best.d) best={d,p}; }
  if(sideOf(cx,cz,best.p)!==rec.s){ wrong++; console.log('   ! h'+rec.h+' '+rec.k+' ended up on the wrong side'); }
}

console.log('features nudged clear of a green :', nudged);
console.log('guide water features :', 56);
console.log('built                :', PONDS.length+STREAMS.length,
            '(' + PONDS.length + ' areal, ' + STREAMS.length + ' linear)');
console.log('carrying a guide side:', [...PONDS,...STREAMS].filter(r=>r.s).length, '| on the wrong side:', wrong);
console.log('skipped as existing  :', skipped.length);
for(const s2 of skipped) console.log('   -', s2);
fs.writeFileSync(outFile, JSON.stringify({PONDS,STREAMS},null,1));
