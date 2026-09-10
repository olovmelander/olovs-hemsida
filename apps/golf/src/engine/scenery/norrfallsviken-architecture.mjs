/* Plan dimensions come from the retained LM review. Eave/ridge heights and
 * facade details are display estimates, not photogrammetric measurements. */
const centre = ring => ring.reduce((c,p)=>[c[0]+p[0]/ring.length,c[1]+p[1]/ring.length],[0,0]);
const midpoint = (a,b) => [(a[0]+b[0])/2,(a[1]+b[1])/2];
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1]);
const at = (p,y) => [p[0],y,p[1]];

function builder(tri,L) {
  const colours = new Map(); let triangles=0;
  const emit = (a,b,c,colour) => {
    if (!colours.has(colour)) colours.set(colour,L(colour));
    tri(a,b,c,colours.get(colour));triangles++;
  };
  return { emit, quad:(a,b,c,d,colour)=>{emit(a,b,c,colour);emit(a,c,d,colour);}, count:()=>triangles };
}

export function renderReviewedClubhouse({building,features,terrainH,tri,L}) {
  if (building.id !== 'w1205924894') return null;
  const roofs=features.filter(f=>f.kind==='clubhouse_roof_section');
  if (roofs.length!==2) return null;
  const B=builder(tri,L),c=centre(building.ring),floor=terrainH(...c)+0.12;
  const WALL=0x8b3a2c,TRIM=0xede9df,ROOF=0xb5705f,GLASS=0x536b70;
  for (let i=0;i<building.ring.length;i++) {
    const a=building.ring[i],b=building.ring[(i+1)%building.ring.length];
    B.quad(at(a,floor-.25),at(b,floor-.25),at(b,floor+3.6),at(a,floor+3.6),WALL);
    const len=distance(a,b),u=[(b[0]-a[0])/len,(b[1]-a[1])/len];
    const m=midpoint(a,b),n=[-u[1],u[0]],sign=(m[0]-c[0])*n[0]+(m[1]-c[1])*n[1]>0?1:-1;
    const p=(t,y)=>[a[0]+u[0]*t+n[0]*sign*.025,floor+y,a[1]+u[1]*t+n[1]*sign*.025];
    for(let s=1.5;s<len-1.2;s+=2.5) {
      B.quad(p(s-.58,1),p(s+.58,1),p(s+.58,2.35),p(s-.58,2.35),TRIM);
      const q=(t,y)=>{const v=p(t,y);v[0]+=n[0]*sign*.015;v[2]+=n[1]*sign*.015;return v;};
      B.quad(q(s-.48,1.1),q(s+.48,1.1),q(s+.48,2.25),q(s-.48,2.25),GLASS);
      B.quad(q(s-.035,1.1),q(s+.035,1.1),q(s+.035,2.25),q(s-.035,2.25),TRIM);
    }
  }
  const ridgeRecords=[];
  for(const roof of roofs) {
    let ring=roof.rings[0];
    const long=distance(ring[0],ring[1])>distance(ring[1],ring[2]);
    if ((roof.ridgeAxis==='long')===long) ring=[ring[1],ring[2],ring[3],ring[0]];
    const [a,b,c,d]=ring,r0=midpoint(a,b),r1=midpoint(c,d),e=floor+roof.eaveHeight,r=floor+roof.ridgeHeight;
    B.quad(at(a,e),at(d,e),at(r1,r),at(r0,r),ROOF);
    B.quad(at(b,e),at(r0,r),at(r1,r),at(c,e),ROOF);
    B.emit(at(a,e),at(r0,r),at(b,e),WALL);
    B.emit(at(d,e),at(c,e),at(r1,r),WALL);
    ridgeRecords.push({r0,r1,e,r,halfWidth:distance(a,b)/2});
  }
  const main=ridgeRecords[0];
  const roofHeight=p=>{
    const dx=main.r1[0]-main.r0[0],dz=main.r1[1]-main.r0[1];
    const perpendicular=Math.abs(dx*(main.r0[1]-p[1])-(main.r0[0]-p[0])*dz)/Math.hypot(dx,dz);
    return main.e+(main.r-main.e)*(1-Math.min(1,perpendicular/main.halfWidth))+.035;
  };
  for(const f of features.filter(f=>f.kind==='roof_solar')) {
    const [a,b,c,d]=f.rings[0].map(p=>at(p,roofHeight(p)));
    B.quad(a,b,c,d,0x25363e);
  }
  return {buildingId:building.id,triangles:B.count(),parts:['osm-wall-footprint','two-orthophoto-roof-sections','solar-panels','estimated-facade'],evidence:'lm-2024-06-27-plan; display-height-estimates'};
}

export function renderReviewedFacilities({features,buildings,terrainH,tri,L,siteHeights=null}) {
  const B=builder(tri,L),counts={};
  const colours={range_mat:0x315c34,range_target_surface:0x5e724a,sports_court:0x315880,terrace:0x9a8c74};
  const club=buildings.find(b=>b.id==='w1205924894');
  const floor=club?terrainH(...centre(club.ring))+.12:null;
  for(const feature of features) {
    if(feature.kind==='ditch' && feature.line?.length>1) {
      // Retain the observed drainage centreline. Width is a display estimate;
      // do not invent a water level or excavate the measured bare-earth DTM.
      for(let i=1;i<feature.line.length;i++) {
        const a=feature.line[i-1],b=feature.line[i],len=distance(a,b);
        if(len<.01)continue;
        const nx=-(b[1]-a[1])/len*.45,nz=(b[0]-a[0])/len*.45;
        const p=(q,s)=>[q[0]+nx*s,terrainH(q[0]+nx*s,q[1]+nz*s)+.025,q[1]+nz*s];
        B.quad(p(a,-1),p(b,-1),p(b,1),p(a,1),0x655d42);
      }
      counts.ditch=(counts.ditch||0)+1;
      continue;
    }
    const colour=colours[feature.kind];
    if(colour===undefined)continue;
    const ring=feature.rings?.[0];if(!ring?.length)continue;
    if(feature.kind==='terrace'&&siteHeights&&ring.length===4) {
      // A ground-level paving surface follows the 1 m DTM, including small
      // bumps between its corners. A single median-height quad let grass show
      // through. Subdivision changes only this small surface, not the terrain.
      const [a,b,c,d]=ring;
      const nu=Math.ceil(Math.max(distance(a,b),distance(d,c))/.5);
      const nv=Math.ceil(Math.max(distance(a,d),distance(b,c))/.5);
      const point=(u,v)=>{
        const x=a[0]*(1-u)*(1-v)+b[0]*u*(1-v)+c[0]*u*v+d[0]*(1-u)*v;
        const z=a[1]*(1-u)*(1-v)+b[1]*u*(1-v)+c[1]*u*v+d[1]*(1-u)*v;
        return [x,Math.max(siteHeights.terrace,terrainH(x,z)+.045),z];
      };
      for(let i=0;i<nu;i++)for(let j=0;j<nv;j++) {
        const q=[point(i/nu,j/nv),point((i+1)/nu,j/nv),point((i+1)/nu,(j+1)/nv),point(i/nu,(j+1)/nv)];
        const up=(q[1][2]-q[0][2])*(q[2][0]-q[0][0])-(q[1][0]-q[0][0])*(q[2][2]-q[0][2]);
        if(up<0)q.reverse();
        B.quad(...q,colour);
      }
      counts.terrace=(counts.terrace||0)+1;
      continue;
    }
    const height=p=>feature.kind==='terrace'&&siteHeights ? siteHeights.terrace
      : feature.kind==='sports_court'&&siteHeights?.padelCourt!=null ? siteHeights.padelCourt
      : feature.kind==='terrace'&&floor!==null?floor+(feature.height||0):terrainH(...p)+.10;
    const p=ring.map(p=>at(p,height(p)));
    for(let i=1;i<p.length-1;i++)B.emit(p[0],p[i],p[i+1],colour);
    counts[feature.kind]=(counts[feature.kind]||0)+1;
    if(feature.kind==='sports_court') {
      for(let i=0;i<ring.length;i++) {
        const a=ring[i],b=ring[(i+1)%ring.length],len=distance(a,b),normal=[-(b[1]-a[1])/len*.06,(b[0]-a[0])/len*.06];
        B.quad(at(a,height(a)+.01),at(b,height(b)+.01),at([b[0]+normal[0],b[1]+normal[1]],height(b)+.01),at([a[0]+normal[0],a[1]+normal[1]],height(a)+.01),0xe9e7d9);
      }
      const a=midpoint(ring[0],ring[3]),b=midpoint(ring[1],ring[2]);
      B.quad(at(a,height(a)),at(b,height(b)),at(b,height(b)+.9),at(a,height(a)+.9),0x737c80);
    }
    if(feature.kind==='terrace'&&!siteHeights) {
      for(let i=0;i<ring.length;i++) {
        const a=ring[i],b=ring[(i+1)%ring.length],len=distance(a,b);
        for(let s=0;s<len;s+=1.2){const q=[a[0]+(b[0]-a[0])*s/len,a[1]+(b[1]-a[1])*s/len];B.quad(at([q[0]-.025,q[1]],height(q)),at([q[0]+.025,q[1]],height(q)),at([q[0]+.025,q[1]],height(q)+.95),at([q[0]-.025,q[1]],height(q)+.95),0xe9e7dc);}
      }
    }
  }
  return {triangles:B.count(),counts,evidence:'lm-2024-06-27-visible-facility-outlines'};
}
