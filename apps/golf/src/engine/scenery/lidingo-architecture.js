/* Display architecture, not a replacement survey. Public exterior photographs
 * identify the clubhouse forms; robust planes from the retained laser vertices
 * constrain heights. See docs/courses/lidingo-clubhouse-appearance.md. */
import { ShapeUtils, Vector2 } from 'three';

export const BUILDING_IDS = Object.freeze({
  restaurant: 'way/32262183', pavilion: 'way/32262176', annex: 'way/32262169',
  rangeWest: 'way/26408210', rangeEast: 'way/26408211',
});
const IDS = new Set(Object.values(BUILDING_IDS));
const C = { wall: 0xe6e5dd, trim: 0xf1f0e9, roof: 0x343b3e, edge: 0x242b2d,
  foundation: 0x9caaa5, glass: 0x29434a, reflection: 0x718884,
  blue: 0x204b86, wood: 0x958f80, stone: 0xb5b4a8 };

export function localFrame(a, b, inward = 1) {
  const length = Math.hypot(b[0]-a[0], b[1]-a[1]);
  if (length < .01) throw new Error('Architecture requires a finite facade edge');
  const ux=(b[0]-a[0])/length, uz=(b[1]-a[1])/length;
  return { length,
    point: (u,v,y) => [a[0]+ux*u-uz*v*inward,y,a[1]+uz*u+ux*v*inward],
    uv: ([x,z]) => [(x-a[0])*ux+(z-a[1])*uz, (-(x-a[0])*uz+(z-a[1])*ux)*inward] };
}
const openRing = ring => {
  const r=ring.map(p=>p.slice());
  if (r.length>1 && Math.hypot(r[0][0]-r.at(-1)[0],r[0][1]-r.at(-1)[1])<1e-5) r.pop();
  return r;
};
// Clip a polygon to a*u+b*v+c >= 0. No source object is modified.
export function clipPolygon(ring,a,b,c) {
  const out=[];
  for(let i=0;i<ring.length;i++) {
    const p=ring[i],q=ring[(i+1)%ring.length],hp=a*p[0]+b*p[1]+c,hq=a*q[0]+b*q[1]+c;
    if(hp>=-1e-7) out.push(p.slice());
    if((hp>1e-7&&hq<-1e-7)||(hp<-1e-7&&hq>1e-7)) {
      const t=hp/(hp-hq);out.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);
    }
  }
  return out.filter((p,i)=>i===0||Math.hypot(p[0]-out[i-1][0],p[1]-out[i-1][1])>1e-5);
}
const planeHeight = ([a,b,c],u,v) => a*u+b*v+c;

function builder() {
  const triangles=[],parts=new Set();
  function tri(a,b,c,color,part) {
    if(![...a,...b,...c].every(Number.isFinite)) throw new Error('Non-finite architectural detail');
    const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
    if(Math.hypot(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])<1e-8) return;
    triangles.push({points:[a,b,c],color,part});parts.add(part);
  }
  const quad=(a,b,c,d,color,part)=>{tri(a,b,c,color,part);tri(a,c,d,color,part);};
  function box(P,u0,u1,v0,v1,y0,y1,color,part) {
    if(y1<=y0) return;
    const p=[P(u0,v0,y0),P(u1,v0,y0),P(u1,v1,y0),P(u0,v1,y0),P(u0,v0,y1),P(u1,v0,y1),P(u1,v1,y1),P(u0,v1,y1)];
    for(const [a,b,c,d] of [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7],[3,2,1,0]]) quad(p[a],p[b],p[c],p[d],color,part);
  }
  function polygon(ring,P,height,color,part) {
    const r=openRing(ring);
    if(r.length<3) return;
    for(const ids of ShapeUtils.triangulateShape(r.map(p=>new Vector2(...p)),[])) {
      let [a,b,c]=ids.map(i=>P(...r[i],height(...r[i])));
      if((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])<0) [b,c]=[c,b];
      tri(a,b,c,color,part);
    }
  }
  function glazing(P,u0,u1,v,y0,y1,bays,part='glazing') {
    if(y1-y0<.45) return;
    quad(P(u0,v,y0),P(u1,v,y0),P(u1,v,y1),P(u0,v,y1),C.trim,part);
    const pitch=(u1-u0)/bays;
    for(let i=0;i<bays;i++) {
      const a=u0+i*pitch+.075,b=u0+(i+1)*pitch-.075;
      quad(P(a,v-.024,y0+.075),P(b,v-.024,y0+.075),P(b,v-.024,y1-.075),P(a,v-.024,y1-.075),C.edge,part);
      quad(P(a+.055,v-.04,y0+.13),P(b-.055,v-.04,y0+.13),P(b-.055,v-.04,y1-.13),P(a+.055,v-.04,y1-.13),C.glass,part);
      quad(P(a+.055,v-.047,y1-.25),P(b-.055,v-.047,y1-.36),P(b-.055,v-.047,y1-.14),P(a+.055,v-.047,y1-.14),C.reflection,part);
    }
  }
  function shell(poly,P,H,terrainH,{frontInset=0,wall=C.wall}={}) {
    polygon(poly,P,H,C.roof,'roof-plane');
    const walls=frontInset ? clipPolygon(poly,0,1,-frontInset) : poly;
    for(let i=0;i<walls.length;i++) {
      const a=walls[i],b=walls[(i+1)%walls.length],A=P(...a,0),B=P(...b,0);
      const n=Math.max(1,Math.ceil(Math.hypot(B[0]-A[0],B[2]-A[2])));
      // The wall follows the DTM at metre intervals; a corner-only bottom can
      // leave an entire wall floating above a concave hillside.
      for(let k=0;k<n;k++) {
        const p=[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n],q=[a[0]+(b[0]-a[0])*(k+1)/n,a[1]+(b[1]-a[1])*(k+1)/n];
        const x=P(...p,0),z=P(...q,0),h0=terrainH(x[0],x[2])-.18,h1=terrainH(z[0],z[2])-.18;
        quad(P(...p,h0),P(...q,h1),P(...q,H(...q)-.08),P(...p,H(...p)-.08),wall,'closed-wall');
      }
    }
    for(let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length];
      quad(P(...a,H(...a)-.20),P(...b,H(...b)-.20),P(...b,H(...b)+.04),P(...a,H(...a)+.04),C.edge,'fascia');
      quad(P(...a,H(...a)-.26),P(...b,H(...b)-.26),P(...b,H(...b)-.20),P(...a,H(...a)-.20),C.trim,'soffit');
    }

  }
  return {tri,quad,box,polygon,glazing,shell,triangles,parts};
}

export function buildingArchitecture(building,terrainH) {
  if(!IDS.has(building?.id)||!building.roofSurface) return null;
  if(building.roofSurface.verticalCrs!=='EPSG:5613') throw new Error('Architecture requires RH2000 source heights');
  const B=builder(),restaurant=building.id===BUILDING_IDS.restaurant;
  const F=restaurant?localFrame(building.ring[2],building.ring[0],-1):localFrame(building.ring[0],building.ring[1]);
  const P=F.point,poly=openRing(building.ring).map(F.uv),ground=(u,v)=>{const p=P(u,v,0);return terrainH(p[0],p[2]);};
  let H;
  if(restaurant) {
    const high=(u,v)=>planeHeight([-.001,-.029,37.692],u,v);
    const low=(u,v)=>planeHeight([-.04,-.009,34.525],u,v);
    const east=(u,v)=>planeHeight([-.002,.036,36.57],u,v);
    const front=clipPolygon(clipPolygon(poly,-1,0,21),0,-1,15.11);
    const back=clipPolygon(clipPolygon(clipPolygon(poly,1,0,-8.9),-1,0,21),0,1,-15.11);
    const west=clipPolygon(clipPolygon(poly,-1,0,8.9),0,1,-15.11);
    const right=clipPolygon(poly,1,0,-21);
    for(const [r,h] of [[front,high],[back,high],[west,low],[right,east]]) B.shell(r,P,h,terrainH,{frontInset:2.1});
    H=(u,v)=>u>21?east(u,v):v>15.11&&u<8.9?low(u,v):high(u,v);
    const facade=2.1,deck=33.55,floor=Math.min(...[6.5,13.5,20.5].map(u=>ground(u,facade)))+.10;
    // A small entrance apron belongs to the building under its overhang. The
    // mapped courtyard stops at the roof outline, which otherwise left turf
    // between that outline and the recessed reception doors.
    for(let u=.3;u<27.9-.001;u+=.6) for(let v=0;v<facade-.001;v+=.6) {
      const u1=Math.min(27.9,u+.6),v1=Math.min(facade,v+.6);
      B.quad(P(u,v,ground(u,v)+.07),P(u1,v,ground(u1,v)+.07),
        P(u1,v1,ground(u1,v1)+.07),P(u,v1,ground(u,v1)+.07),0x60686a,'entrance-apron');
    }
    B.glazing(P,1.5,5.2,facade-.04,34.1,36.55,2,'upper-glazing');
    B.glazing(P,6.5,20.5,facade-.04,deck+.2,36.75,7,'upper-glazing');
    B.glazing(P,23,26.5,facade-.04,34.1,36.0,2,'upper-glazing');
    for(const [a,b,bays] of [[6.5,12.9,4],[13.7,20.5,4]])
      B.glazing(P,a,b,facade-.045,Math.max(floor,ground(a,facade)+.08,ground(b,facade)+.08),deck-.27,bays,'reception-glazing');
    // Door and handle are geometry; the landmark needs no font/image texture.
    B.box(P,10.15,10.20,facade-.13,facade-.08,floor+.6,floor+1.25,0xb9c2bd,'door-handle');
    B.box(P,6.25,21.0,-.10,facade,deck-.17,deck,C.wood,'balcony-deck');
    B.box(P,6.25,21.0,-.18,-.06,deck-.15,deck+.60,C.trim,'balcony-apron');
    for(let u=6.4;u<21;u+=.5) B.box(P,u,u+.025,-.201,-.18,deck-.10,deck+.56,0xb6bfba,'balcony-panels');
    B.box(P,6.25,21,-.23,-.16,deck+.90,deck+.96,C.edge,'balcony-rail');
    for(let u=6.4;u<21;u+=1.45) B.box(P,u,u+.055,-.22,-.16,deck+.59,deck+.95,C.edge,'balcony-rail');
    for(const u of [6.4,13.5,20.8]) B.box(P,u-.11,u+.11,.05,.27,ground(u,.16)-.1,deck-.15,C.trim,'balcony-columns');
    for(const [a,b] of [[6.5,13.4],[13.6,20.5]]) {
      B.quad(P(a,facade-.05,36.92),P(b,facade-.05,36.92),P(b,-.33,35.67),P(a,-.33,35.67),C.blue,'blue-awnings');
      B.quad(P(a,-.33,35.67),P(b,-.33,35.67),P(b,-.33,35.46),P(a,-.33,35.46),0x163a6b,'awning-valance');
    }
    for(let i=0;i<24;i++) {
      const a=i*Math.PI/12,b=(i+1)*Math.PI/12;
      B.tri(P(22,facade-.10,35.5),P(22+Math.cos(a)*.32,facade-.10,35.5+Math.sin(a)*.32),P(22+Math.cos(b)*.32,facade-.10,35.5+Math.sin(b)*.32),C.trim,'clock');
    }
    B.box(P,21.982,22.018,facade-.15,facade-.12,35.48,35.74,C.edge,'clock-hands');
    B.box(P,21.982,22.17,facade-.15,facade-.12,35.48,35.52,C.edge,'clock-hands');
    // The 2024 photo resolves the high laser returns as two distinct structures,
    // not the spiky tent shapes created by the raw TIN across vertical steps.
    B.box(P,8.6,13.5,22.2,27.2,36.9,39.95,0x32393c,'roof-service-room');
    B.box(P,8.45,13.65,22.05,27.35,39.95,40.10,C.edge,'service-room-roof');
    B.box(P,18.0,19.4,12.8,14.3,37.0,40.45,0xb0a48c,'chimney');
    B.box(P,17.9,19.5,12.7,14.4,40.45,40.58,0xc4c9c3,'chimney-cap');
    for(const [u,v] of [[13.5,20.3],[16,18.5]]) B.box(P,u,u+1.1,v,v+1.5,H(u,v),H(u,v)+.75,0xadb6b3,'roof-vent');
    // Side and rear elevations remain restrained, but no longer blank slabs.
    addFacadeWindows(B,building,F,H,terrainH,[{edge:2,bays:4},{edge:4,bays:4},{edge:7,bays:4},{edge:8,bays:4},{edge:10,bays:3}]);
  } else if(building.id===BUILDING_IDS.pavilion || building.id===BUILDING_IDS.annex) {
    const pavilion=building.id===BUILDING_IDS.pavilion;
    H=pavilion?(u,v)=>32.30-.006*u+.045*v:(u,v)=>31.92+.002*u-.024*v;
    B.shell(poly,P,H,terrainH);
    const faces=pavilion
      ? [{edge:0,bays:3},{edge:1,bays:3},{edge:3,bays:1},{edge:6,bays:1},{edge:7,bays:3},{edge:8,bays:7,veranda:true},{edge:9,bays:8}]
      : [{edge:0,bays:5},{edge:1,bays:1},{edge:2,bays:2},{edge:3,bays:1},{edge:4,bays:4},{edge:5,bays:2}];
    addFacadeWindows(B,building,F,H,terrainH,faces);
  } else {
    // Two robust fitted planes, clipped at their intersection, retain the
    // measured asymmetrical ridge. They remove scan noise, not roof height.
    const pair=building.id===BUILDING_IDS.rangeWest
      ? [[.888,-.003,32.354],[-.891,.005,38.616]]
      : [[.966,.013,29.320],[-.983,-.017,37.330]];
    const [a,b]=pair;
    for(const [p,q] of [[a,b],[b,a]]) {
      const r=clipPolygon(poly,q[0]-p[0],q[1]-p[1],q[2]-p[2]);
      B.shell(r,P,(u,v)=>planeHeight(p,u,v),terrainH,{wall:0xd8dcd6});
    }
    H=(u,v)=>Math.min(...pair.map(p=>planeHeight(p,u,v)));
    // Generic small windows; these buildings' exact uses/elevations are not
    // established by the clubhouse photos. No restaurant features here.
    addFacadeWindows(B,building,F,H,terrainH,[{edge:0,bays:3,small:true},{edge:1,bays:9,small:true},{edge:2,bays:5,small:true},{edge:3,bays:8,small:true}]);
  }
  return {buildingId:building.id,triangles:B.triangles,parts:[...B.parts],
    sourceRoofUnchanged:true,sourceRoofTriangles:building.roofSurface.triangleIndices.length/3,
    evidence:'photo-and-laser-informed-display-approximation'};
}

function addFacadeWindows(B,building,F,H,terrainH,faces) {
  for(const {edge,bays,veranda,small} of faces) {
    const a=building.ring[edge],b=building.ring[edge+1];
    if(!a||!b||Math.hypot(b[0]-a[0],b[1]-a[1])<.6) continue;
    const W=localFrame(a,b),P=W.point,pitch=W.length/bays;
    for(let i=0;i<bays;i++) {
      const u0=i*pitch+(small?pitch*.26:.26),u1=(i+1)*pitch-(small?pitch*.26:.26);
      const A=P(u0,0,0),D=P(u1,0,0),ha=H(...F.uv([A[0],A[2]])),hb=H(...F.uv([D[0],D[2]]));
      const floor=Math.max(terrainH(A[0],A[2]),terrainH(D[0],D[2]));
      // Public pavilion views show ordinary windows in white walls. A roof-
      // limited glazing strip turned every downhill elevation into a glass box.
      const y0=floor+(small ? 1.0 : veranda ? .5 : .85);
      const y1=Math.min(y0+(small ? 1.25 : veranda ? 2.25 : 1.45),ha-.45,hb-.45);
      B.glazing(P,u0,u1,-.065,y0,y1,small?1:2,'facade-glazing');
      if(veranda) {
        B.box(P,i*pitch+.025,i*pitch+.19,-.25,-.08,floor-.1,Math.min(ha,hb)-.22,C.trim,'veranda-posts');
        B.box(P,u0,u1,-.20,-.11,floor+.8,floor+.9,C.trim,'veranda-rail');
      }
    }
  }
}

export function courtyardArchitecture(features,buildings,terrainH) {
  const putting=features.find(f=>f.id==='lidingo-courtyard-putting-green-2019');
  const restaurant=buildings.find(b=>b.id===BUILDING_IDS.restaurant);
  if(!putting||!restaurant) return null;
  const B=builder();
  // Follow the existing mapped edge exactly; don't round or move a green.
  const ring=openRing(putting.rings[0]);
  for(let i=0;i<ring.length;i++) {
    const a=ring[i],b=ring[(i+1)%ring.length],F=localFrame(a,b),P=F.point;
    const n=Math.max(1,Math.ceil(F.length));
    for(let j=0;j<n;j++) {
      const u0=j*F.length/n,u1=(j+1)*F.length/n;
      const A=P(u0,0,0),D=P(u1,0,0),ya=terrainH(A[0],A[2]),yb=terrainH(D[0],D[2]);
      B.quad(P(u0,-.22,ya+.05),P(u1,-.22,yb+.05),P(u1,0,yb+.12),P(u0,0,ya+.12),C.stone,'putting-green-kerb');
      B.quad(P(u0,-.22,ya-.08),P(u1,-.22,yb-.08),P(u1,-.22,yb+.05),P(u0,-.22,ya+.05),0x898c83,'putting-green-kerb');
    }
  }
  // Three photo-referenced terrace levels, anchored to the restaurant frame.
  // Extents are appearance estimates; they are not added to mapped facilities.
  const F=localFrame(restaurant.ring[2],restaurant.ring[0],-1);
  const anchor=F.point(27.1,-.6,0);
  // The terrace follows the courtyard's nearly north/south east edge. Extending
  // the restaurant's rotated roof axes sent its lower tiers out onto the slope.
  const P=(u,v,y)=>[anchor[0]+u-28.8,y,anchor[2]-v-.6];
  const levels=[{v0:-7,v1:2.1,y:33.55},{v0:-14,v1:-9,y:32.50},{v0:-21,v1:-16,y:31.45}];
  for(const {v0,v1,y} of levels) {
    B.box(P,28.8,35.2,v0,v1,y-.20,y,C.wood,'terrace-deck');
    B.box(P,35.10,35.20,v0,v1,y-.65,y-.18,0x817d70,'terrace-skirt');
    for(let u=28.9;u<35.2;u+=.28) B.box(P,u,u+.014,v0,v1,y,y+.012,0x756f64,'terrace-planks');
    for(const u of [28.9,35.1]) {
      const entrySide=u===28.9&&v0===-21;
      const spans=entrySide?[[v0,-20.3],[-17.7,v1]]:[[v0,v1]];
      for(const [a,b] of spans) B.box(P,u-.035,u+.035,a,b,y+1.0,y+1.07,C.edge,'terrace-handrail');
      for(let v=v0+.1;v<v1;v+=1.4) {
        if(entrySide&&v>-20.3&&v<-17.7) continue;
        B.box(P,u-.035,u+.035,v,v+.065,y,y+1.05,C.edge,'terrace-posts');
      }
    }
    for(const u of [29,35])for(const v of [v0+.2,v1-.2]) {
      const p=P(u,v,0);B.box(P,u-.10,u+.10,v-.10,v+.10,terrainH(p[0],p[2])-.15,y-.19,0x76796f,'terrace-supports');
    }
  }
  for(let k=0;k<2;k++) {
    const upper=levels[k],lower=levels[k+1],n=6;
    for(let s=0;s<n;s++) {
      const v1=upper.v0-s*2/n,v0=upper.v0-(s+1)*2/n,y=upper.y-(s+1)*(upper.y-lower.y)/n;
      B.box(P,29,32.1,v0,v1,y-.16,y,C.wood,'terrace-stairs');
    }
  }
  const entry=P(26.9,-19,0),entryY=terrainH(entry[0],entry[2])+.06,top=levels[2].y;
  for(let i=0;i<7;i++) {
    const u0=26.9+i*1.9/7,u1=26.9+(i+1)*1.9/7,y=entryY+(i+1)*(top-entryY)/7;
    B.box(P,u0,u1,-20.3,-17.7,y-.18,y,C.wood,'courtyard-access-stairs');
  }
  return {triangles:B.triangles,parts:[...B.parts],evidence:'mapped-kerb-and-photo-estimated-terrace'};
}
