/* Bake a small reflection-only height field from the shipped survey chunks.
   node tools/bake-bank-reflections.mjs [bro-hof-stadium|norrfallsviken]
   R/G = centimetres above -32 m in the PLAYER frame. B = measured crown
   envelope above the DTM in 20 cm steps. A = mapped ground class.
   The output does not feed terrain, water geometry or tree placement. */
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { verifyChunkAsset, sha256Bytes } from '../packages/course-v2/chunk-node.mjs';
import { legacyGridBridge } from '../apps/golf/src/engine/geodetic-frame.mjs';
import { createRingHeightSampler } from '../apps/golf/src/engine/v2-graph-terrain.mjs';
import { BRO_HOF_STADIUM_V2_CONFIG } from '../apps/golf/src/engine/v2-bro-hof-config.mjs';
import { NORRFALLSVIKEN_V2_CONFIG } from '../apps/golf/src/engine/v2-norrfallsviken-config.mjs';

const publicRoot = 'apps/golf/public';
const layouts = {
  'bro-hof-stadium': { config: BRO_HOF_STADIUM_V2_CONFIG, build: 'brohofbuild' },
  norrfallsviken: { config: NORRFALLSVIKEN_V2_CONFIG, build: 'nvgkbuild' },
};
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const verified = ref => {
  const data = fs.readFileSync(path.join(publicRoot, ref.url));
  if (data.byteLength !== ref.bytes || sha256Bytes(data) !== ref.sha256) throw Error('Invalid source ' + ref.url);
  return data;
};
const list = read(path.join(publicRoot, 'courses/v2-index.json')).courses;
const cell = 2.5;
const margin = 160;
const identity = (x, z) => [x, z];

for (const slug of process.argv[2] ? [process.argv[2]] : Object.keys(layouts)) {
  const { config, build } = layouts[slug];
  const course = JSON.parse(verified(list.find(c => c.slug === slug).manifest));
  const ground = JSON.parse(verified(course.groundManifest));
  if (ground.frame.fingerprint !== config.frameFingerprint) throw Error('Unreviewed coordinate frame');
  const model = read(build + '/course-model.json');
  const points = model.holes.flatMap(h => [...h.line, ...h.green.ring]);
  const x0 = Math.floor((Math.min(...points.map(p => p[0])) - margin) / cell) * cell;
  const z0 = Math.floor((Math.min(...points.map(p => p[1])) - margin) / cell) * cell;
  const width = Math.ceil((Math.max(...points.map(p => p[0])) + margin - x0) / cell);
  const height = Math.ceil((Math.max(...points.map(p => p[1])) + margin - z0) / cell);
  const pixels = Buffer.alloc(width * height * 4);
  const classes = new Uint8Array(width * height).fill(104); // rough
  const frame = config.legacyFrame ? legacyGridBridge(config.legacyFrame) : { toGrid: identity, toLegacy: identity };
  const origin = config.legacyOriginEpsg3006;
  const gridCorners = [[x0,z0],[x0+width*cell,z0],[x0,z0+height*cell],[x0+width*cell,z0+height*cell]]
    .map(([x,z]) => frame.toGrid(x,z));
  const xs = gridCorners.map(p => origin.easting + p[0]), ns = gridCorners.map(p => origin.northing - p[1]);
  const inBounds = b => b.maxEasting >= Math.min(...xs) && b.minEasting <= Math.max(...xs)
    && b.maxNorthing >= Math.min(...ns) && b.minNorthing <= Math.max(...ns);
  const relevant = ground.tiles.filter(t => inBounds(t.bounds) && t.courses.includes(slug));
  const levels = new Map();
  for (const t of relevant) {
    const decoded = verifyChunkAsset(t.layers.terrain, verified(t.layers.terrain));
    if (!levels.has(t.lod)) levels.set(t.lod, []);
    levels.get(t.lod).push({ ...t, grid: decoded.header.grid, payload: decoded.payload });
  }
  const terrain = createRingHeightSampler({
    levels: [...levels].map(([lod,tiles]) => ({lod,tiles})), legacyOrigin:origin,
    verticalDatumOffsetMetres: config.legacyFrame?.verticalDatumOffsetMetres ?? 0,
  });
  // Even-odd scanline fill honours islands and does not enlarge shorelines.
  function paint(rings, material) {
    const edges = rings.filter(r => r?.length >= 3).flatMap(r => r.map((p,i) => [p,r[(i+1)%r.length]]));
    if (!edges.length) return;
    const zs = edges.map(([p])=>p[1]);
    const firstRow = Math.max(0,Math.ceil((Math.min(...zs)-z0)/cell-.5));
    const lastRow = Math.min(height-1,Math.floor((Math.max(...zs)-z0)/cell-.5));
    for (let row=firstRow;row<=lastRow;row++) {
      const z=z0+(row+.5)*cell, hits=[];
      for (const [a,b] of edges) if ((a[1]>z)!==(b[1]>z))
        hits.push(a[0]+(z-a[1])*(b[0]-a[0])/(b[1]-a[1]));
      hits.sort((a,b)=>a-b);
      for (let i=0;i+1<hits.length;i+=2) {
        const left=Math.max(0,Math.ceil((hits[i]-x0)/cell-.5));
        const right=Math.min(width,Math.ceil((hits[i+1]-x0)/cell-.5));
        if(right>left) classes.fill(material,row*width+left,row*width+right);
      }
    }
  }
  const rings = (seq=[]) => seq.map(v=>Array.isArray(v)?v:v.ring).filter(Boolean);
  for (const r of rings(model.vegetation?.rock)) paint([r],198);
  for (const h of model.holes) {
    for (const r of [...h.fairway.rings, h.green.ring, ...rings(h.tees?.pads)]) paint([r],148);
    for (const b of h.bunkers) paint([b.ring,...(b.innerRings??[])],245);
  }
  for(const w of model.water) if (w.ring) paint([w.ring,...(w.innerRings??[])],24);
  for(let i=0;i<width*height;i++) {
    const x=x0+(i%width+.5)*cell, z=z0+(Math.floor(i/width)+.5)*cell;
    const h=terrain.sample(...frame.toGrid(x,z));
    if(!Number.isFinite(h)) continue;
    const quant=Math.round((h+32)*100);
    if(quant<0 || quant>65535) throw Error('Height out of range');
    pixels[i*4]=quant>>>8; pixels[i*4+1]=quant&255; pixels[i*4+3]=classes[i];
  }
  let count=0;
  for (const t of relevant.filter(t=>t.lod===0&&t.layers.objects)) {
    const data=verifyChunkAsset(t.layers.objects, verified(t.layers.objects));
    for (const record of data.content.records) {
      if(record.class!=='tree' || record.reviewStatus!=='approved') continue;
      const [x,z]=frame.toLegacy(record.easting-origin.easting,origin.northing-record.northing);
      const col=(x-x0)/cell-.5,row=(z-z0)/cell-.5,radius=record.radiusMetres/cell;
      if(col<0||row<0||col>=width||row>=height||!(radius>0)) continue;
      const centre=Math.min(width-1,Math.round(col))+Math.min(height-1,Math.round(row))*width;
      if(classes[centre]===24||classes[centre]===148||classes[centre]===245) continue;
      count++;
      for(let j=Math.max(0,Math.ceil(row-radius));j<=Math.min(height-1,Math.floor(row+radius));j++) {
        for(let i=Math.max(0,Math.ceil(col-radius));i<=Math.min(width-1,Math.floor(col+radius));i++) {
          const unit=((i-col)**2+(j-row)**2)/radius**2;
          if(unit>=1) continue;
          // A smooth envelope for this measured crown, fitted inside its own
          // radius and height. It is used only when the actual leaf mesh is off screen.
          const envelope=record.objectHeightMetres*(.39+.61*Math.sqrt(1-unit));
          const k=(j*width+i)*4+2;
          pixels[k]=Math.max(pixels[k],Math.min(255,Math.round(envelope*5)));
        }
      }
    }
  }
  const header=Buffer.alloc(24);
  header.write('BNK1'); header.writeUInt16LE(width,4); header.writeUInt16LE(height,6);
  header.writeFloatLE(x0,8); header.writeFloatLE(z0,12); header.writeFloatLE(cell,16);
  header.writeUInt32LE(count,20);
  const out=Buffer.concat([header,deflateRawSync(pixels,{level:9})]);
  const file='apps/golf/src/engine/assets/bank-'+slug+'.bin';
  fs.writeFileSync(file,out);
  console.log(slug, {width,height,trees:count,bytes:out.byteLength,sha256:sha256Bytes(out)});
}
