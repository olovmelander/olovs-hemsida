/* Lidingö's white clubhouse complex, referenced to public club photographs.
 * See docs/courses/lidingo-clubhouse-appearance.md. Facade dimensions are visual
 * estimates, not survey measurements. The source footprint and roof TIN stay
 * untouched. All details join the existing static building batch: no textures,
 * transparent sorting, per-window meshes, extra draw calls or remote assets. */

const WHITE = 0xe4e2d9, TRIM = 0xf0eee6, DARK = 0x292f31;
const GLASS = 0x344b50, REFLECTION = 0x60716e, BLUE = 0x183c78;
export const buildingLooks = {
  'way/32262183': { wall: WHITE, roof: 0x333a3b }, // reception / restaurant
  'way/32262176': { wall: WHITE, roof: 0x303739 }, // lower courtyard pavilion
  'way/32262169': { wall: WHITE, roof: 0x303739 }, // connected southern wing
};

// The normal clubhouse path is unused when the measured roof is present.
export const clubhouse = { wall: WHITE, roof: 0x303739, windowRows: [], terrace: false };

function frame(a, b) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
  return { length, point: (u, v, y) => [a[0] + ux*u - uz*v, y, a[1] + uz*u + ux*v] };
}

export function clubhouseDetails(building, terrainH) {
  if (!buildingLooks[building?.id] || !building.roofSurface) return null;
  const roof = building.roofSurface;
  if (roof.verticalCrs !== 'EPSG:5613') throw new Error('Lidingö facade requires RH2000 roof heights');
  const triangles = [], parts = new Set();
  const tri = (a,b,c,color,part) => {
    if (![...a,...b,...c].every(Number.isFinite)) throw new Error('Non-finite clubhouse detail');
    triangles.push({ points: [a,b,c], color, part }); parts.add(part);
  };
  const quad = (a,b,c,d,color,part) => { tri(a,b,c,color,part); tri(a,c,d,color,part); };
  function box(P,u0,u1,v0,v1,y0,y1,color,part) {
    const p=[P(u0,v0,y0),P(u1,v0,y0),P(u1,v1,y0),P(u0,v1,y0),
      P(u0,v0,y1),P(u1,v0,y1),P(u1,v1,y1),P(u0,v1,y1)];
    for (const [a,b,c,d] of [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7],[4,5,6,7],[3,2,1,0]])
      quad(p[a],p[b],p[c],p[d],color,part);
  }
  // Cache triangle bounds once: facade sampling must not allocate arrays for
  // every roof triangle and every window during the phone's initial build.
  const roofTriangles=[];
  for (let i=0;i<roof.triangleIndices.length;i+=3) {
      const [a,b,c]=roof.triangleIndices.slice(i,i+3).map(j=>roof.vertices[j]);
      const [ax,az]=a.c,[bx,bz]=b.c,[cx,cz]=c.c;
      const det=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      if (Math.abs(det)<1e-10) continue;
      roofTriangles.push({a,b,c,ax,az,bx,bz,cx,cz,det,
        minX:Math.min(ax,bx,cx),maxX:Math.max(ax,bx,cx),
        minZ:Math.min(az,bz,cz),maxZ:Math.max(az,bz,cz)});
  }
  // Height of the actual retained triangle, never a smoothed or filled roof.
  function roofAt(x,z) {
    for (const t of roofTriangles) {
      if(x<t.minX-1e-6||x>t.maxX+1e-6||z<t.minZ-1e-6||z>t.maxZ+1e-6) continue;
      const {a,b,c,ax,az,bx,bz,cx,cz,det}=t;
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/det;
      const w=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/det;
      if (u>=-1e-6 && w>=-1e-6 && u+w<=1+1e-6)
        return u*a.heightRH2000+w*b.heightRH2000+(1-u-w)*c.heightRH2000;
    }
    return null;
  }
  function window(P,u0,u1,v,y0,y1,bays,part='glazing') {
    if (y1-y0<0.5 || u1-u0<0.5) return;
    quad(P(u0,v,y0),P(u1,v,y0),P(u1,v,y1),P(u0,v,y1),DARK,part);
    const pitch=(u1-u0)/bays;
    for(let i=0;i<bays;i++) {
      const a=u0+i*pitch+.09,b=u0+(i+1)*pitch-.09;
      quad(P(a,v-.018,y0+.09),P(b,v-.018,y0+.09),P(b,v-.018,y1-.09),P(a,v-.018,y1-.09),GLASS,part);
      quad(P(a,v-.021,y1-.27),P(b,v-.021,y1-.4),P(b,v-.021,y1-.12),P(a,v-.021,y1-.12),REFLECTION,part);
    }
  }
  // Appearance follows only existing, supported wall segments. The sampler
  // clips each decorative strip to its segment and its two measured roof tops.
  for (const segment of roof.boundaryWallSegments) {
    const [a,b]=segment, F=frame(a.c,b.c),P=F.point;
    if (F.length<.015) continue;
    const groundA=terrainH(...a.c),groundB=terrainH(...b.c);
    const top=Math.min(a.heightRH2000,b.heightRH2000);
    if (top-Math.max(groundA,groundB)<.4) continue;
    quad(P(0,-.025,groundA),P(F.length,-.025,groundB),P(F.length,-.025,groundB+.27),P(0,-.025,groundA+.27),0xaeb4b1,'foundation');
    // Dark fascia at the measured eave, with a narrow pale soffit beneath.
    quad(P(0,-.04,a.heightRH2000-.22),P(F.length,-.04,b.heightRH2000-.22),
      P(F.length,-.04,b.heightRH2000),P(0,-.04,a.heightRH2000),DARK,'fascia');
    quad(P(0,-.045,a.heightRH2000-.29),P(F.length,-.045,b.heightRH2000-.29),
      P(F.length,-.045,b.heightRH2000-.23),P(0,-.045,a.heightRH2000-.23),TRIM,'soffit');
  }

  if (building.id === 'way/32262183') {
    // The courtyard is south of the restaurant. The outer source footprint
    // includes a low balcony/deck strip; its 33.5 m samples are not the upper
    // storey's eave. Put the photographed facade INSIDE the high roof support.
    const F=frame(building.ring[2],building.ring[0]);
    // Reverse v so positive depth goes north, into this particular building.
    const P=(u,v,y)=>F.point(u,-v,y), inset=4.2;
    const floor=Math.min(...[3,10,18,25].map(u=>{const p=P(u,.2,0);return terrainH(p[0],p[2]);}))+.08;
    const deck=33.55; // low retained perimeter samples: 33.50–33.69 m RH2000
    const front=[];
    for(let u=1;u<27;u+=.5) {
      const a=P(u,inset,0),b=P(u+.5,inset,0);
      const ha=roofAt(a[0],a[2]),hb=roofAt(b[0],b[2]);
      if (ha===null || hb===null || Math.min(ha,hb)<36) continue;
      quad(P(u,inset,floor),P(u+.5,inset,floor),P(u+.5,inset,hb-.12),P(u,inset,ha-.12),WHITE,'restaurant-facade');
      front.push([u,u+.5,Math.min(ha,hb)]);
    }
    // Paired blue awnings, white balcony apron and dark handrail are the
    // recognisable courtyard elevation in the club's July 2024 photograph.
    const supported=(u0,u1)=>front.filter(f=>f[0]>=u0-.01&&f[1]<=u1+.01&&f[2]>=36.8)
      .reduce((sum,f)=>sum+f[1]-f[0],0)>=u1-u0-.01;
    if (supported(3,18.5) && deck-floor>1.6) {
      window(P,3,18.5,inset-.035,deck+.22,36.48,8,'upper-glazing');
      for (const [a,b,bays] of [[3,8,3],[9,14,3],[15,18.5,2]])
        window(P,a,b,inset-.04,floor+.12,deck-.28,bays,'reception-glazing');
      box(P,3,18.5,1.8,inset,deck-.14,deck,0x8d8b80,'balcony-deck');
      box(P,3,18.5,1.75,1.87,deck-.12,deck+.66,TRIM,'balcony-apron');
      for(let u=3.2;u<18.5;u+=.5)
        box(P,u,u+.025,1.728,1.75,deck-.09,deck+.62,0xb3b8b3,'balcony-panels');
      box(P,3,18.5,1.69,1.77,deck+.93,deck+1,DARK,'balcony-rail');
      for(let u=3.1;u<=18.5;u+=2.35)
        box(P,u,u+.055,1.70,1.76,deck+.62,deck+.98,DARK,'balcony-rail');
      for(const u of [3.15,10.75,18.35])
        box(P,u-.10,u+.10,1.9,2.1,floor,deck-.13,TRIM,'balcony-columns');
      for(const [a,b] of [[3,10.65],[10.85,18.5]]) {
        quad(P(a,inset-.05,36.62),P(b,inset-.05,36.62),P(b,1.56,35.30),P(a,1.56,35.30),BLUE,'blue-awnings');
        quad(P(a,1.56,35.30),P(b,1.56,35.30),P(b,1.56,35.07),P(a,1.56,35.07),0x123064,'awning-valance');
        for(let u=a+2.2;u<b;u+=2.35)
          quad(P(u,inset-.07,36.63),P(u+.018,inset-.07,36.63),P(u+.018,1.54,35.31),P(u,1.54,35.31),0x446086,'awning-seams');
      }
      // Clock sits in the pale pier beside the awnings; use small geometric
      // hands and a face, avoiding a texture or an always-changing clock time.
      const cu=19.1,cy=35.50,r=.34;
      if (supported(18.5,19.5)) {
        for(let i=0;i<24;i++) {
          const a=i*Math.PI/12,b=(i+1)*Math.PI/12;
          tri(P(cu,inset-.07,cy),P(cu+Math.cos(a)*r,inset-.07,cy+Math.sin(a)*r),P(cu+Math.cos(b)*r,inset-.07,cy+Math.sin(b)*r),TRIM,'clock');
        }
        box(P,cu-.018,cu+.018,inset-.10,inset-.085,cy-.04,cy+.24,DARK,'clock-hands');
        box(P,cu-.02,cu+.18,inset-.10,inset-.085,cy-.02,cy+.02,DARK,'clock-hands');
      }
    }
  } else {
    // Pavilion: long glazed north and east walls, with white veranda posts.
    const faces=building.id==='way/32262176'
      ? [{edge:8,bays:7,veranda:true},{edge:9,bays:8},{edge:0,bays:3}]
      : [{edge:0,bays:5},{edge:5,bays:2}];
    for (const face of faces) {
      const a=building.ring[face.edge],b=building.ring[face.edge+1];
      const F=frame(a,b), P=F.point, pitch=F.length/face.bays;
      // Source rings have positive signed x/z area: positive v goes inside.
      for(let i=0;i<face.bays;i++) {
        const u0=i*pitch+.3,u1=(i+1)*pitch-.3;
        const A=P(u0,.08,0),B=P(u1,.08,0);
        const ha=roofAt(A[0],A[2]),hb=roofAt(B[0],B[2]);
        if(ha===null||hb===null) continue;
        const ground=Math.max(terrainH(A[0],A[2]),terrainH(B[0],B[2]));
        const top=Math.min(ha,hb)-.38;
        window(P,u0,u1,-.045,ground+.5,top,2,'pavilion-glazing');
        if(face.veranda) {
          box(P,i*pitch+.02,i*pitch+.18,-.22,-.06,ground,top+.16,TRIM,'veranda-posts');
          box(P,u0,u1,-.17,-.08,ground+.82,ground+.9,TRIM,'veranda-rail');
        }
      }
    }
  }
  return { buildingId:building.id, triangles, parts:[...parts],
    evidence:'public-photo-appearance-estimate', sourceRoofUnchanged:true };
}

export function decorateMeasuredBuilding({ building, terrainH, tri, L }) {
  const details=clubhouseDetails(building,terrainH);
  if(!details) return null;
  const colors=new Map();
  for(const t of details.triangles) {
    if(!colors.has(t.color)) colors.set(t.color,L(t.color));
    tri(...t.points,colors.get(t.color));
  }
  return { buildingId:details.buildingId, triangles:details.triangles.length, parts:details.parts };
}
