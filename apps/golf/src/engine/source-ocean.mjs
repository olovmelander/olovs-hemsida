import { ShapeUtils, Vector2 } from 'three/webgpu';
import { inRingIndexed } from './ring-index.mjs';

const finite = Number.isFinite;
const CAP = 60;
const POLYGON_BIN = 128;
const polygonBinKey=(x,z)=>`${Math.floor(x/POLYGON_BIN)},${Math.floor(z/POLYGON_BIN)}`;

function boxOf(points) {
  const box = {x0:Infinity,z0:Infinity,x1:-Infinity,z1:-Infinity};
  for(const [x,z] of points) {
    box.x0=Math.min(box.x0,x);box.x1=Math.max(box.x1,x);
    box.z0=Math.min(box.z0,z);box.z1=Math.max(box.z1,z);
  }
  return box;
}
const containsBox=(b,x,z)=>x>=b.x0&&x<=b.x1&&z>=b.z0&&z<=b.z1;
const inside=(p,x,z)=>containsBox(p.bounds,x,z)&&inRingIndexed(x,z,p.rings[0])&&
  !(p.holeBins?(p.holeBins.get(polygonBinKey(x,z))??[]):p.holes).some(h=>containsBox(h.bounds,x,z)&&inRingIndexed(x,z,h.ring));

function polygonBins(parts) {
  const bins=new Map();
  for(const p of parts)for(let z=Math.floor(p.bounds.z0/POLYGON_BIN);z<=Math.floor(p.bounds.z1/POLYGON_BIN);z++)
    for(let x=Math.floor(p.bounds.x0/POLYGON_BIN);x<=Math.floor(p.bounds.x1/POLYGON_BIN);x++) {
      const key=`${x},${z}`,list=bins.get(key);if(list)list.push(p);else bins.set(key,[p]);
    }
  return bins;
}

function coastlineIndex(lines) {
  const bins=new Map(),size=CAP;
  const key=(x,z)=>`${x},${z}`;
  for(const line of lines)for(let i=1;i<line.length;i++) {
    const a=line[i-1],b=line[i],edge=[...a,...b];
    for(let z=Math.floor(Math.min(a[1],b[1])/size);z<=Math.floor(Math.max(a[1],b[1])/size);z++)
      for(let x=Math.floor(Math.min(a[0],b[0])/size);x<=Math.floor(Math.max(a[0],b[0])/size);x++) {
        const k=key(x,z),list=bins.get(k);if(list)list.push(edge);else bins.set(k,[edge]);
      }
  }
  return (x,z,cap=CAP)=>{
    let best=Math.min(cap,CAP)**2;
    const bx=Math.floor(x/size),bz=Math.floor(z/size);
    for(let j=bz-1;j<=bz+1;j++)for(let i=bx-1;i<=bx+1;i++)for(const [ax,az,bx,bz] of bins.get(key(i,j))??[]) {
      const dx=bx-ax,dz=bz-az,den=dx*dx+dz*dz;
      const t=den?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/den)):0;
      best=Math.min(best,(x-ax-dx*t)**2+(z-az-dz*t)**2);
    }
    return Math.sqrt(best);
  };
}

/** Exact marine polygons and their shore bands share one material and datum.
 * Inner rings preserve mapped islands and conservative dry contours in the
 * documented source gaps, even when their elevations are near zero.
 * World/source crop boundaries never become foamy shorelines. */
export function buildSourceOcean({data,origin,bridge,bounds,seaLevel,
  maximumCoveredTerrainHeight,spacing=16}={}) {
  if(data?.schemaVersion!==1||data.crs!=='EPSG:3006'||!Array.isArray(data.marinePolygons)||
    !Array.isArray(data.bands)||!Array.isArray(data.coastlines))throw new Error('Invalid marine source geometry');
  if(!finite(seaLevel)||!finite(maximumCoveredTerrainHeight)||!finite(spacing)||spacing<=0||
    !bounds||!['x0','x1','z0','z1'].every(k=>finite(bounds[k]))||bounds.x1<=bounds.x0||bounds.z1<=bounds.z0)
    throw new Error('Invalid marine render frame');
  const project=p=>{
    if(!Array.isArray(p)||p.length<2||!finite(p[0])||!finite(p[1]))throw new Error('Non-finite marine coordinate');
    return bridge.toLegacy(p[0]-origin.easting,origin.northing-p[1]);
  };
  const ring=source=>{
    if(!Array.isArray(source)||source.length<4)throw new Error('Invalid marine ring');
    const first=source[0],last=source.at(-1);
    if(first[0]!==last[0]||first[1]!==last[1])throw new Error('Marine ring is not closed');
    return source.slice(0,-1).map(project);
  };
  const polygon=rings=>{
    const projected=rings.map(ring);
    const holes=projected.slice(1).map(r=>({ring:r,bounds:boxOf(r)}));
    return {rings:projected,bounds:boxOf(projected[0]),holes,holeBins:holes.length>10?polygonBins(holes):null};
  };
  const polygons=data.marinePolygons.map(polygon);
  const islands=(data.islandPolygons??[]).map(polygon);
  // Include the conservative gap contour's dry islands for rock/vegetation
  // styling. The count of independently mapped islands remains separate.
  const dryIslands=[...islands,...polygons.flatMap(p=>p.holes.map(h=>({rings:[h.ring],holes:[],bounds:h.bounds})))];
  const islandBins=polygonBins(dryIslands);
  const containsSea=(x,z)=>finite(x)&&finite(z)&&polygons.some(p=>inside(p,x,z));
  const isIslandAt=(x,z)=>finite(x)&&finite(z)&&(islandBins.get(polygonBinKey(x,z))??[]).some(p=>inside(p,x,z));
  const distanceToShore=coastlineIndex(data.coastlines.map(line=>line.map(project)));
  const positions=[],indices=[],shorelineDistances=[];
  let polygonCount=0,interiorRings=0;
  for(const band of data.bands)for(const part of band.polygons) {
    const rings=part.rings.map(ring),vertices=rings.flat();
    const distances=part.shorelineDistances?.flatMap((d,i)=>d.slice(0,rings[i].length));
    if(!distances||distances.length!==vertices.length||distances.some(d=>!finite(d)||d<0||d>CAP+.01))
      throw new Error('Invalid marine shore distances');
    const vectors=rings.map(r=>r.map(([x,z])=>new Vector2(x,z)));
    const faces=ShapeUtils.triangulateShape(vectors[0],vectors.slice(1));
    if(!faces.length)throw new Error('Marine polygon could not be triangulated');
    const offset=positions.length/3;
    for(let i=0;i<vertices.length;i++) {
      positions.push(vertices[i][0],seaLevel,vertices[i][1]);
      shorelineDistances.push(Math.min(CAP,distances[i]));
    }
    for(const [a,b,c] of faces) {
      const p=vertices[a],q=vertices[b],r=vertices[c];
      const up=(q[1]-p[1])*(r[0]-p[0])-(q[0]-p[0])*(r[1]-p[1]);
      if(Math.abs(up)>1e-10)indices.push(offset+a,offset+(up>0?b:c),offset+(up>0?c:b));
    }
    polygonCount++;interiorRings+=rings.length-1;
  }
  const width=Math.ceil((bounds.x1-bounds.x0)/spacing),height=Math.ceil((bounds.z1-bounds.z0)/spacing);
  if(width*height>2e6)throw new Error('Marine terrain mask exceeds its cell budget');
  const terrainCoverage=new Uint8Array(width*height);
  // A whole cell must fit inside water and clear every real coast/island edge.
  // This protects even an island too small to contain one mask sample centre.
  const radius=spacing/Math.sqrt(2)+.05;
  let cells=0;
  for(let j=0;j<height;j++)for(let i=0;i<width;i++) {
    const x0=bounds.x0+i*spacing,z0=bounds.z0+j*spacing,x=x0+spacing/2,z=z0+spacing/2;
    if(!containsSea(x,z))continue;
    cells++;
    if(distanceToShore(x,z,radius)<radius)continue;
    if([[x0,z0],[x0+spacing,z0],[x0,z0+spacing],[x0+spacing,z0+spacing]].every(([x,z])=>containsSea(x,z)))
      terrainCoverage[j*width+i]=1;
  }
  const isSeaAt=(x,z)=>{
    const col=Math.floor((x-bounds.x0)/spacing),row=Math.floor((z-bounds.z0)/spacing);
    if(col>=0&&row>=0&&col<width&&row<height&&terrainCoverage[row*width+col])return true;
    return containsSea(x,z);
  };
  return {kind:'source-ocean',bounds,sourceBounds:data.bounds,seaLevel,spacing,width,height,
    positions,indices,shorelineDistances,terrainCoverage,maximumCoveredTerrainHeight,
    cells,quads:0,triangles:indices.length/3,polygons:polygonCount,interiorRings,
    sourceIslands:islands.length,sourceGaps:data.sourceGaps??[],isSeaAt,isIslandAt,distanceToShore};
}

export async function loadSourceOcean({url,sha256,bytes,compression,decodedBytes,decodedSha256,baseUrl,fetchFn=fetch}) {
  const response=await fetchFn(new URL(url,baseUrl),{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Marine source HTTP ${response.status}`);
  const body=await response.arrayBuffer();
  const magic=new Uint8Array(body,0,Math.min(2,body.byteLength));
  // Static hosts may send .json.gz with Content-Encoding:gzip. Fetch then
  // returns decoded bytes; verify their separate pinned identity as well.
  const decodedByHttp=compression==='gzip'&&!(magic[0]===0x1f&&magic[1]===0x8b);
  if(body.byteLength!==(decodedByHttp?decodedBytes:bytes))throw new Error('Marine source size differs');
  const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(actual!==(decodedByHttp?decodedSha256:sha256))throw new Error('Marine source checksum differs');
  if(compression&&compression!=='gzip')throw new Error('Unsupported marine source compression');
  const text=compression==='gzip'&&!decodedByHttp
    ? await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : new TextDecoder().decode(body);
  return JSON.parse(text);
}
