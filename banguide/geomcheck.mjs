#!/usr/bin/env node
/* Geometric sanity checks on the built course. Everything here is computable from the
   data in veckefjardensgc.html, so it runs without a browser.

   These exist because an adversarial review found defects that check.mjs could not see:
   it counts features and never asked whether they were on the right side, on top of each
   other, or on top of a tee. Counting is not checking.

   Run:  node banguide/geomcheck.mjs [path-to-html]                                     */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/\/banguide$/, '');
const TARGET = process.argv[2] || path.join(ROOT, 'veckefjardensgc.html');
const html = fs.readFileSync(TARGET, 'utf8');
const inv = JSON.parse(fs.readFileSync(path.join(ROOT,'banguide/guide-inventory.json'),'utf8')).holes;

const s = html.indexOf('const HOLES = ['), e = html.indexOf('\nconst CLUB=');
const HOLES = eval(html.slice(s,e).replace('const HOLES = [','[').replace(/\];[\s\S]*$/,'];'));
function arr(name){ const i=html.indexOf('const '+name+'=');
  if(i<0) return []; const j=html.indexOf('];',i);
  try { return eval(html.slice(html.indexOf('[',i), j+1)); } catch(err){ return []; } }
const PONDS=arr('PONDS'), STREAMS=arr('STREAMS'), OBLINES=arr('OBLINES');

const g = re => { const m=html.match(re); return m?m[1]:null; };
const LCM=new Uint8Array(Buffer.from(g(/const LCB64='([^']+)'/),'base64'));
const LCNW=+g(/const LCNW=(\d+)/), LCNH=+g(/,LCNH=(\d+)/), LCCELL=+g(/,LCCELL=([\d.]+)/);
const LCX0=+g(/,LCX0=(-?[\d.]+)/), LCZ0=+g(/,LCZ0=(-?[\d.]+)/);
const lcCell=(i,j)=>{ if(i<0)return 1; if(j<0||i>=LCNW||j>=LCNH)return 0;
  const k=j*LCNW+i; return (LCM[k>>2]>>((k&3)*2))&3; };
const lcClass=(x,z)=>lcCell(Math.floor((x-LCX0)/LCCELL),Math.floor((z-LCZ0)/LCCELL));

const hyp=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const d2r=d=>d*Math.PI/180;
function ptSeg(px,pz,ax,az,bx,bz){
  const dx=bx-ax,dz=bz-az,L2=dx*dx+dz*dz;
  let t=L2?((px-ax)*dx+(pz-az)*dz)/L2:0; t=Math.max(0,Math.min(1,t));
  return {d:Math.hypot(px-(ax+dx*t),pz-(az+dz*t)), t};
}
const distToLine=(px,pz,L)=>{ let m=1e9;
  for(let i=0;i<L.length-1;i++) m=Math.min(m,ptSeg(px,pz,L[i][0],L[i][1],L[i+1][0],L[i+1][1]).d);
  return m; };
function ellipseSD(x,z,cx,cz,rx,rz,rot){
  const a=d2r(rot||0),ca=Math.cos(a),sa=Math.sin(a);
  const dx=x-cx,dz=z-cz,u=(dx*ca+dz*sa)/rx,v=(-dx*sa+dz*ca)/rz;
  return (Math.hypot(u,v)-1)*Math.min(rx,rz);
}
function alongLine(L,f){
  const seg=[]; let tot=0;
  for(let i=0;i<L.length-1;i++){const d=hyp(L[i],L[i+1]); seg.push(d); tot+=d;}
  let d=Math.max(-0.2,Math.min(1.25,f))*tot;
  for(let i=0;i<seg.length;i++){
    if(d<=seg[i]||i===seg.length-1){
      const t=d/seg[i];
      const b=Math.atan2(L[i+1][0]-L[i][0],L[i+1][1]-L[i][1]);
      return {x:L[i][0]+(L[i+1][0]-L[i][0])*t, z:L[i][1]+(L[i+1][1]-L[i][1])*t, b};
    }
    d-=seg[i];
  }
}
const inWater=(x,z)=>{
  if(lcClass(x,z)===1) return true;
  for(const p of PONDS) if(ellipseSD(x,z,p.c[0],p.c[1],p.r[0],p.r[1],p.rot)<0) return true;
  for(const t of STREAMS) for(let i=0;i<t.p.length-1;i++)
    if(ptSeg(x,z,t.p[i][0],t.p[i][1],t.p[i+1][0],t.p[i+1][1]).d < t.w*1.4) return true;
  return false;
};

const fails=[]; const warns=[];
const note=(bad,msg)=> (bad?fails:warns).push(msg);
let section=t=>console.log('\n== '+t+' '+'='.repeat(Math.max(0,58-t.length)));

/* ---- 1. which side is a bunker actually on? ------------------------------------
   Forward for the page's internal angle b is F=(sin b, cos b); with north=-z and
   east=+x the player's right is (-Fz, Fx) = (-cos b, sin b). The page places bunkers
   at a signed lateral offset from a normal it builds itself, so read that normal out
   of the target rather than assuming it -- a check that hardcodes the formula it is
   testing cannot see the bug it exists to catch, nor the fix. */
const NRM=html.match(/const nx=(-?)Math\.cos\(p\.b\),nz=(-?)Math\.sin\(p\.b\);/);
if(!NRM) throw new Error('geomcheck: cannot find the bunker lateral normal in '+TARGET);
const NSX = NRM[1]==='-' ? -1 : 1, NSZ = NRM[2]==='-' ? -1 : 1;
const pageNormal = b => [NSX*Math.cos(b), NSZ*Math.sin(b)];
section('bunker side vs the guide');
console.log('page lateral normal              : ('+(NSX<0?'-':'')+'cos b, '+(NSZ<0?'-':'')+'sin b)');
let mirrored=0, sided=0;
for(const h of HOLES){
  const gd=(inv[h.n]&&inv[h.n].bunkers)||[];
  (h.bk||[]).forEach((b,i)=>{
    const want=gd[i]&&gd[i].side;
    if(want!=='left'&&want!=='right') return;
    sided++;
    const p=alongLine(h.line,b[0]);
    const [nx,nz]=pageNormal(p.b);                       /* whatever the page uses */
    const X=p.x+nx*b[1], Z=p.z+nz*b[1];
    const F=[Math.sin(p.b),Math.cos(p.b)];
    const R=[-F[1],F[0]];                                /* the player's true right */
    const cross=(X-p.x)*R[0]+(Z-p.z)*R[1];
    const actual = cross>0 ? 'right' : 'left';
    if(actual!==want) mirrored++;
  });
}
console.log('bunkers with a side in the guide :', sided);
console.log('rendered on the opposite side    :', mirrored);
note(mirrored>0, `${mirrored} of ${sided} side-specified bunkers are mirrored`);

/* ---- 2. do two holes occupy the same ground? ----------------------------------- */
section('hole-on-hole overlap');
let worst={d:1e9};
for(let i=0;i<HOLES.length;i++)for(let j=i+1;j<HOLES.length;j++){
  const A=HOLES[i], B=HOLES[j];
  let m=1e9;
  for(let k=0;k<=20;k++){ const p=alongLine(A.line,k/20);
    m=Math.min(m, distToLine(p.x,p.z,B.line)); }
  if(m<worst.d) worst={d:m,a:A.n,b:B.n};
  if(m<30) console.log(`  holes ${A.n} and ${B.n} run ${m.toFixed(0)} m apart at closest`);
}
console.log('closest pair:', worst.a, 'and', worst.b, 'at', worst.d.toFixed(1), 'm');
note(worst.d<25, `holes ${worst.a} and ${worst.b} overlap (${worst.d.toFixed(0)} m apart)`);

/* ---- 3. is any green sitting in another hole's corridor? ------------------------ */
section('greens inside another hole corridor');
let gBad=0;
for(const h of HOLES){
  const gp=h.line[h.line.length-1];
  for(const o of HOLES){
    if(o.n===h.n) continue;
    const d=distToLine(gp[0],gp[1],o.line);
    if(d<26){ console.log(`  green ${h.n} is ${d.toFixed(1)} m from hole ${o.n}'s centre line`); gBad++; }
  }
}
note(gBad>0, `${gBad} green/corridor conflicts`);

/* ---- 4. tee integrity: in water, and does it play its card distance? ------------ */
section('tee boxes');
let wetTees=0, offCard=0;
for(const h of HOLES){
  const L=h.line, gp=L[L.length-1];
  const b0=Math.atan2(L[1][0]-L[0][0], L[1][1]-L[0][1]);
  h.t.forEach((len)=>{
    const off=h.t[0]-len;
    let x=L[0][0]+Math.sin(b0)*off, z=L[0][1]+Math.cos(b0)*off;
    const wasWet=inWater(x,z);
    if(wasWet){
      wetTees++;
      /* replicate the page's own escape hatch, which walks the pad sideways up to
         126 m looking for dry ground -- the tee that actually gets rendered is the
         one after this walk, not the nominal one */
      const nx=Math.cos(b0), nz=-Math.sin(b0);
      for(let k=1;k<=14;k++){
        const cand=[[x-nx*k*9,z-nz*k*9],[x+nx*k*9,z+nz*k*9]];
        let done=false;
        for(const c of cand) if(!inWater(c[0],c[1])){ x=c[0]; z=c[1]; done=true; break; }
        if(done) break;
      }
      console.log(`  hole ${h.n} tee ${len} m starts in water, displaced ${
        hyp([x,z],[L[0][0]+Math.sin(b0)*off, L[0][1]+Math.cos(b0)*off]).toFixed(0)} m`);
    }
    const played=hyp([x,z],gp);
    if(Math.abs(played-len)/len > 0.06){
      offCard++;
      console.log(`  hole ${h.n} tee ${len} m actually plays ${played.toFixed(0)} m`);
    }
  });
}
note(wetTees>0, `${wetTees} tee boxes stand in water`);
note(offCard>0, `${offCard} tees do not play their card distance`);

/* ---- 5. out-of-bounds runs that cross the hole they belong to ------------------- */
section('out-of-bounds runs');
let crossing=0;
for(const o of OBLINES){
  const h=HOLES[o.h-1]; if(!h) continue;
  const ds=o.p.map(q=>distToLine(q[0],q[1],h.line));
  if(Math.min(...ds) < 12){
    crossing++;
    console.log(`  OB run on hole ${o.h} comes within ${Math.min(...ds).toFixed(0)} m of its own centre line`);
  }
}
note(crossing>0, `${crossing} out-of-bounds runs cross their own hole`);

/* ---- 5b. is a sided water feature on the side the guide draws it? ---------------
   gen-water writes the guide's side onto every left/right feature as `s`, so this is
   checking the built geometry against the guide's own words rather than against the
   generator's arithmetic. Untagged features (crosses, or water that predates the
   generator) are counted but not judged. */
section('water side vs the guide');
let wSided=0, wWrong=0, wUntagged=0;
for(const rec of [...PONDS,...STREAMS]){
  if(!rec.h){ wUntagged++; continue; }
  if(rec.s!=='left' && rec.s!=='right'){ wUntagged++; continue; }
  const h=HOLES.find(x=>x.n===rec.h); if(!h) continue;
  wSided++;
  let cx,cz;
  if(rec.c){ [cx,cz]=rec.c; }
  else { cx=0; cz=0; for(const q of rec.p){cx+=q[0];cz+=q[1];} cx/=rec.p.length; cz/=rec.p.length; }
  let best={d:1e9,p:null};
  for(let f=0;f<=40;f++){ const p=alongLine(h.line,f/40);
    const d=Math.hypot(cx-p.x,cz-p.z); if(d<best.d) best={d,p}; }
  const F=[Math.sin(best.p.b),Math.cos(best.p.b)], R=[-F[1],F[0]];
  const actual=((cx-best.p.x)*R[0]+(cz-best.p.z)*R[1])>0 ? 'right' : 'left';
  if(actual!==rec.s){ wWrong++; console.log(`  hole ${rec.h} ${rec.k} should be ${rec.s}, is ${actual}`); }
}
console.log('water features carrying a side   :', wSided, '(' + wUntagged + ' untagged)');
console.log('rendered on the opposite side    :', wWrong);
note(wWrong>0, `${wWrong} of ${wSided} sided water features are mirrored`);

/* ---- 6. water sitting on the hole it is tagged to ------------------------------- */
section('water tagged to the wrong hole');
let far=0;
for(const p of PONDS.filter(x=>x.h)){
  const h=HOLES[p.h-1]; if(!h) continue;
  const own=distToLine(p.c[0],p.c[1],h.line);
  let best={d:own,n:p.h};
  for(const o of HOLES){ const d=distToLine(p.c[0],p.c[1],o.line); if(d<best.d) best={d,n:o.n}; }
  if(best.n!==p.h && own-best.d > 25){
    far++;
    console.log(`  ${p.k} tagged hole ${p.h} is ${own.toFixed(0)} m from it but ${best.d.toFixed(0)} m from hole ${best.n}`);
  }
}
note(far>0, `${far} water features are nearer another hole than their own`);

/* ---- summary ------------------------------------------------------------------- */
console.log('\n'+'='.repeat(64));
if(!fails.length && !warns.length) console.log('all geometric checks pass');
for(const w of warns) console.log('  ok   ', w);
for(const f of fails) console.log('  FAIL ', f);
console.log('='.repeat(64));
if(fails.length){ console.log(fails.length+' geometric check(s) failing'); process.exit(1); }
