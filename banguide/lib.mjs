/* Shared reading of the built page. Every generator and check goes through this so
   there is one place that knows how the page stores a course.

   The one thing worth reading twice is `lateral`. The page walks a hole with
   `alongLine`, which returns an angle b such that FORWARD is (sin b, cos b) in (x,z).
   North is -z and east is +x, so a player facing forward has their right hand at
   (-Fz, Fx) = (-cos b, sin b). The page used to use (cos b, -sin b) and call it the
   right-hand normal; that is the LEFT vector, and it put 51 bunkers, 33 water
   features and every sided OB run on the wrong side of their hole. Read the sign out
   of the target rather than assuming it, so a check can never be blind to the bug it
   exists to catch.                                                                  */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url)).replace(/[/\\]banguide$/, '');

export function load(target){
  const file = target || path.join(ROOT,'veckefjardensgc.html');
  const html = fs.readFileSync(file,'utf8');
  const s = html.indexOf('const HOLES = ['), e = html.indexOf('\nconst CLUB=');
  const HOLES = eval(html.slice(s,e).replace('const HOLES = [','[').replace(/\];[\s\S]*$/,'];'));
  const arr = name => { const i=html.indexOf('const '+name+'=');
    if(i<0) return []; const j=html.indexOf('];',i);
    try { return eval(html.slice(html.indexOf('[',i), j+1)); } catch(err){ return []; } };

  const g = re => { const m=html.match(re); return m?m[1]:null; };
  const LCM=new Uint8Array(Buffer.from(g(/const LCB64='([^']+)'/),'base64'));
  const LCNW=+g(/const LCNW=(\d+)/), LCNH=+g(/,LCNH=(\d+)/), LCCELL=+g(/,LCCELL=([\d.]+)/);
  const LCX0=+g(/,LCX0=(-?[\d.]+)/), LCZ0=+g(/,LCZ0=(-?[\d.]+)/);
  const lcCell=(i,j)=>{ if(i<0)return 1; if(j<0||i>=LCNW||j>=LCNH)return 0;
    const k=j*LCNW+i; return (LCM[k>>2]>>((k&3)*2))&3; };
  const lcClass=(x,z)=>lcCell(Math.floor((x-LCX0)/LCCELL),Math.floor((z-LCZ0)/LCCELL));

  /* the page's own lateral normal, read from its source */
  const m = html.match(/const nx=(-?)Math\.cos\(p\.b\),nz=(-?)Math\.sin\(p\.b\);/);
  if(!m) throw new Error('lib: cannot find the bunker lateral normal in '+file);
  const sx = m[1]==='-' ? -1 : 1, sz = m[2]==='-' ? -1 : 1;
  const lateral = b => [sx*Math.cos(b), sz*Math.sin(b)];
  lateral.text = '('+(sx<0?'-':'')+'cos b, '+(sz<0?'-':'')+'sin b)';
  /* is this normal the player's right? forward is (sin b, cos b), right is (-cos b, sin b) */
  lateral.isRight = (sx===-1 && sz===1);

  return {file, html, HOLES, lcClass, lateral,
          PONDS:arr('PONDS'), STREAMS:arr('STREAMS'), OBLINES:arr('OBLINES'),
          inv: JSON.parse(fs.readFileSync(path.join(ROOT,'banguide/guide-inventory.json'),'utf8')).holes};
}

export const hyp=(a,b)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
export const d2r=d=>d*Math.PI/180;

export function ptSeg(px,pz,ax,az,bx,bz){
  const dx=bx-ax,dz=bz-az,L2=dx*dx+dz*dz;
  let t=L2?((px-ax)*dx+(pz-az)*dz)/L2:0; t=Math.max(0,Math.min(1,t));
  return {d:Math.hypot(px-(ax+dx*t),pz-(az+dz*t)), t};
}
export const ptSegD=(px,pz,ax,az,bx,bz)=>ptSeg(px,pz,ax,az,bx,bz).d;
export const distToLine=(px,pz,L)=>{ let m=1e9;
  for(let i=0;i<L.length-1;i++) m=Math.min(m,ptSegD(px,pz,L[i][0],L[i][1],L[i+1][0],L[i+1][1]));
  return m; };

export function ellipseSD(x,z,cx,cz,rx,rz,rot){
  const a=d2r(rot||0),ca=Math.cos(a),sa=Math.sin(a);
  const dx=x-cx,dz=z-cz,u=(dx*ca+dz*sa)/rx,v=(-dx*sa+dz*ca)/rz;
  return (Math.hypot(u,v)-1)*Math.min(rx,rz);
}

/* the page's own walk along a hole: b is such that forward is (sin b, cos b) */
export function alongLine(L,f){
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

/* which side of its hole does a world point fall on, as a player sees it? */
export function sideOf(x,z,p){
  const F=[Math.sin(p.b),Math.cos(p.b)], R=[-F[1],F[0]];
  return ((x-p.x)*R[0]+(z-p.z)*R[1]) > 0 ? 'right' : 'left';
}

/* fractions quoted in the guide's prose, e.g. "roughly 0.2-0.45 of the hole" */
export function fracs(t){
  const out=[]; const r=/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/g; let m;
  while((m=r.exec(t))) out.push(+m[1],+m[2]);
  if(!out.length) for(const v of (t.match(/\d+(?:\.\d+)?/g)||[])) out.push(+v);
  const ok=out.filter(v=>v>=-0.15&&v<=1.2);
  return ok.length?[Math.min(...ok),Math.max(...ok)]:null;
}

/* anchored patching: assert the anchor matches exactly once, or refuse */
export function patcher(src){
  const applied=[];
  return {
    sub(label,a,b){
      const p=src.split(a);
      if(p.length-1!==1) throw new Error(`ANCHOR FAIL [${label}]: expected 1, found ${p.length-1}`);
      src=p.join(b); applied.push(label); return this;
    },
    get src(){ return src; },
    get applied(){ return applied; }
  };
}
