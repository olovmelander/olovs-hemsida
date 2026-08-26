/* Re-anchor a set of holes as rigid bodies (translate + rotate about the hole's own
   midpoint), which preserves shape and card length exactly.

   Run:  node banguide/solve-routing.mjs <holes> [iters] [seed] [out.json]
         node banguide/solve-routing.mjs 2,3 220000 7 /tmp/solved.json
   Then: node banguide/apply-lines.mjs in.html out.html /tmp/solved.json
   and regenerate water, out-of-bounds and bunkers, which are keyed to hole positions.

   Scored on five independent sources, none of which is the app's current state:
     - the club's own hole markers, recovered from the overview map by registration
     - the land-cover raster traced from that same map (turf good, forest bad)
     - the guide's compass roses, where they were readable
     - the walk distances a real course must have, green(n) to tee(n+1)
     - separation: two holes may not share ground, and no green may sit in a corridor

   The last of those is what the phase 02 solver lacked, and is why holes 2 and 3 ended
   up crossing.                                                                        */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {load, alongLine, distToLine, hyp} from './lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/[/\\]banguide$/, '');
const c = load();
const M = JSON.parse(fs.readFileSync(path.join(ROOT,'banguide/guide-markers.json'),'utf8'));
const inv = JSON.parse(fs.readFileSync(path.join(ROOT,'banguide/guide-inventory.json'),'utf8')).holes;
const MOVE = (process.argv[2]||'1,2,3,4,5').split(',').map(Number);
const ITERS = +(process.argv[3]||260000);
const SEED  = +(process.argv[4]||12345);
const OUT   = process.argv[5] || path.join(ROOT,'banguide/solved.json');

let rngState = SEED>>>0;
const rnd = () => { rngState = (rngState*1664525 + 1013904223)>>>0; return rngState/4294967296; };
const gauss = () => { let u=0,v=0; while(!u)u=rnd(); while(!v)v=rnd();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };

const byN = {}; for(const h of c.HOLES) byN[h.n]=h;
const base = {};                       /* the untouched lines */
for(const h of c.HOLES) base[h.n] = h.line.map(p=>[p[0],p[1]]);

function apply(n, tx, tz, rotDeg){
  const L = base[n], mid = alongLine(L, 0.5);
  const a = rotDeg*Math.PI/180, ca=Math.cos(a), sa=Math.sin(a);
  return L.map(p=>{
    const dx=p[0]-mid.x, dz=p[1]-mid.z;
    return [mid.x + dx*ca - dz*sa + tx, mid.z + dx*sa + dz*ca + tz];
  });
}
function linesFor(st){
  const out={};
  for(const h of c.HOLES) out[h.n] = MOVE.includes(h.n) ? apply(h.n, st[h.n][0], st[h.n][1], st[h.n][2]) : base[h.n];
  return out;
}

const bearOf = L => { const t=L[0], g=L[L.length-1];
  return (Math.atan2(g[0]-t[0], -(g[1]-t[1]))*180/Math.PI + 360) % 360; };
const angDiff = (a,b) => Math.abs(((a-b+540)%360)-180);

/* corridor sampling: down the line and across it */
function ground(L, par){
  let turf=0, forest=0, water=0, tot=0;
  const half = par===3 ? 10 : 12;
  for(let k=0;k<=60;k++){
    const p=alongLine(L,k/60);
    const nx=-Math.cos(p.b), nz=Math.sin(p.b);
    for(const lat of [-half,0,half]){
      const X=p.x+nx*lat, Z=p.z+nz*lat, cl=c.lcClass(X,Z);
      tot++; if(cl===2)turf++; else if(cl===3)forest++; else if(cl===1)water++;
    }
  }
  return {turf:turf/tot, forest:forest/tot, water:water/tot};
}
function minSep(A,B){ let mn=1e9;
  for(let k=0;k<=36;k++){ const p=alongLine(A,k/36); mn=Math.min(mn, distToLine(p.x,p.z,B)); }
  return mn; }

const SEQ = c.HOLES.map(h=>h.n).sort((a,b)=>a-b);
const W = { turf:170, forest:150, marker:0.34, rose:1.5, walk:0.55, sep:5.2, greenIn:6.0, water:120 };
const SEP_MIN = 55, GREEN_CLEAR = 45;

function cost(st, detail){
  const L = linesFor(st);
  let total=0; const parts={turf:0,forest:0,marker:0,rose:0,walk:0,sep:0,greenIn:0,water:0};
  for(const n of MOVE){
    const h=byN[n], g=ground(L[n], h.par);
    parts.turf   += W.turf   * (1-g.turf);
    parts.forest += W.forest * g.forest;
    parts.water  += W.water  * g.water;
    const mid=alongLine(L[n],0.5);
    parts.marker += W.marker * hyp(M[n], [mid.x, mid.z]);
    const rose = inv[n] && inv[n].guideBearingDeg;
    if(rose!=null) parts.rose += W.rose * angDiff(bearOf(L[n]), rose);
  }
  /* walks: every consecutive pair that touches a moved hole */
  for(let i=0;i<SEQ.length;i++){
    const a=SEQ[i], b=SEQ[(i+1)%SEQ.length];
    if(!MOVE.includes(a) && !MOVE.includes(b)) continue;
    const ga=L[a][L[a].length-1], tb=L[b][0];
    const d=hyp(ga,tb);
    parts.walk += W.walk * (d<20 ? (20-d)*2 : d>80 ? (d-80) : 0);
  }
  /* separation and greens in corridors, against every hole */
  for(const n of MOVE) for(const h of c.HOLES){
    if(h.n===n) continue;
    if(MOVE.includes(h.n) && h.n < n) continue;         /* count each pair once */
    const s=minSep(L[n], L[h.n]);
    if(s<SEP_MIN) parts.sep += W.sep * (SEP_MIN-s);
  }
  for(const n of MOVE){
    const gp=L[n][L[n].length-1];
    for(const h of c.HOLES){ if(h.n===n) continue;
      const d=distToLine(gp[0],gp[1],L[h.n]);
      if(d<GREEN_CLEAR) parts.greenIn += W.greenIn * (GREEN_CLEAR-d); }
    const tp=L[n][0];
    for(const h of c.HOLES){ if(h.n===n) continue;
      const d=distToLine(tp[0],tp[1],L[h.n]);
      if(d<GREEN_CLEAR) parts.greenIn += W.greenIn * (GREEN_CLEAR-d); }
  }
  for(const k in parts) total+=parts[k];
  return detail ? {total, parts, L} : total;
}

let st={}; for(const n of MOVE) st[n]=[0,0,0];
let cur=cost(st), best=cur, bestSt=JSON.parse(JSON.stringify(st));
const start=cost(st,true);
console.log('start cost', start.total.toFixed(1), JSON.stringify(Object.fromEntries(
  Object.entries(start.parts).map(([k,v])=>[k,+v.toFixed(1)]))));

for(let it=0; it<ITERS; it++){
  const T = 26 * Math.pow(0.00025/26, it/ITERS);
  const n = MOVE[Math.floor(rnd()*MOVE.length)];
  const prev = st[n].slice();
  const amp = 1 + 44*T/26;
  const which = rnd();
  if(which<0.42){ st[n][0]+=gauss()*amp; st[n][1]+=gauss()*amp; }
  else if(which<0.84){ st[n][2]+=gauss()*amp*0.55; }
  else { st[n][0]+=gauss()*amp; st[n][1]+=gauss()*amp; st[n][2]+=gauss()*amp*0.55; }
  st[n][0]=Math.max(-190,Math.min(190,st[n][0]));
  st[n][1]=Math.max(-190,Math.min(190,st[n][1]));
  st[n][2]=Math.max(-70,Math.min(70,st[n][2]));
  const v=cost(st);
  if(v<cur || rnd()<Math.exp((cur-v)/T)){ cur=v; if(v<best){best=v; bestSt=JSON.parse(JSON.stringify(st));} }
  else st[n]=prev;
  if(it%40000===0) console.log('  it',it,'T',T.toFixed(3),'cur',cur.toFixed(1),'best',best.toFixed(1));
}

const fin=cost(bestSt,true);
console.log('\nfinal cost', fin.total.toFixed(1), JSON.stringify(Object.fromEntries(
  Object.entries(fin.parts).map(([k,v])=>[k,+v.toFixed(1)]))));
console.log('\nhole  dx     dz     rot    bearing(rose)   turf   forest  midOffMarker');
for(const n of MOVE){
  const L=fin.L[n], g=ground(L, byN[n].par), mid=alongLine(L,0.5);
  const rose=inv[n]&&inv[n].guideBearingDeg;
  console.log(String(n).padStart(4),
    String(bestSt[n][0].toFixed(0)).padStart(6), String(bestSt[n][1].toFixed(0)).padStart(6),
    String(bestSt[n][2].toFixed(1)).padStart(6),
    String(bearOf(L).toFixed(0)+'('+(rose==null?'--':rose)+')').padStart(15),
    String((g.turf*100).toFixed(0)+'%').padStart(7), String((g.forest*100).toFixed(0)+'%').padStart(7),
    String(hyp(M[n],[mid.x,mid.z]).toFixed(0)+' m').padStart(13));
}
console.log('\nwalks:');
for(let i=0;i<SEQ.length;i++){ const a=SEQ[i], b=SEQ[(i+1)%SEQ.length];
  if(!MOVE.includes(a) && !MOVE.includes(b)) continue;
  const L=fin.L; console.log('  ',a,'->',b,':',hyp(L[a][L[a].length-1],L[b][0]).toFixed(0),'m'); }
console.log('\nclosest approaches involving a moved hole:');
for(const n of MOVE) for(const h of c.HOLES){ if(h.n===n) continue;
  if(MOVE.includes(h.n)&&h.n<n) continue;
  const s=minSep(fin.L[n],fin.L[h.n]);
  if(s<90) console.log('  ',n,'and',h.n,':',s.toFixed(0),'m'); }
const out={}; for(const n of MOVE) out[n]={t:bestSt[n], line:fin.L[n].map(p=>[+p[0].toFixed(1),+p[1].toFixed(1)])};
fs.writeFileSync(OUT, JSON.stringify(out,null,1));
console.log('\nwrote', OUT);
