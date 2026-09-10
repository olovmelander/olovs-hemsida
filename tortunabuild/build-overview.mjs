/* Vector-only course overview; source photographs remain private inputs. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const model = JSON.parse(fs.readFileSync(path.join(root, 'tortunabuild/course-model.json')));
const points = model.holes.flatMap(h => [...h.line, ...h.green.ring]);
const west = Math.min(...points.map(p=>p[0]))-110, east = Math.max(...points.map(p=>p[0]))+110;
const north = Math.min(...points.map(p=>p[1]))-140, south = Math.max(...points.map(p=>p[1]))+110;
const w=east-west, h=south-north;
const coords = ring => ring.map(p=>`${(p[0]-west).toFixed(2)},${(p[1]-north).toFixed(2)}`).join(' ');
const poly = (ring, fill, stroke='none') => `<polygon points="${coords(ring)}" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>`;
let shapes='';
for(const f of model.infra.landuse || []) shapes+=poly(f.ring, ['farmland','farmyard'].includes(f.kind)?'#8a9264':['residential','allotments'].includes(f.kind)?'#60795a':'#687465');
for(const ring of [...model.vegetation.forest,...model.vegetation.wood]) shapes+=poly(ring,'#234838');
for(const ring of model.surround.clearfells || []) shapes+=poly(ring,'#6c7351');
for(const water of model.water) shapes+=poly(water.ring,'#639b9b');
for(const f of model.streams) shapes+=`<polyline points="${coords(f.line)}" fill="none" stroke="#639b9b" stroke-width="${f.widthMetres||2}"/>`;
for(const f of model.scenery.range) shapes+=poly(f,'#6f9362');
for(const f of model.scenery.mappedFeatures){
  const fill=/bunker/.test(f.kind)?'#e2d4b0':/green|target/.test(f.kind)?'#a4c681':/tee/.test(f.kind)?'#90ae76':'#a6a594';
  shapes+=`<path d="${f.rings.map(r=>`M ${coords(r).replaceAll(' ',' L ')} Z`).join(' ')}" fill="${fill}" fill-rule="evenodd"/>`;
}
for(const f of model.infra.parking) shapes+=poly(f.ring,'#939789');
for(const f of [...model.infra.paths,...model.infra.tracks,...model.infra.roads]) shapes+=`<polyline points="${coords(f.line)}" fill="none" stroke="${f.surface==='asphalt'?'#a9aea1':'#b4b3a0'}" stroke-width="${f.widthMetres||3}"/>`;
for(const f of model.infra.railway) shapes+=`<polyline points="${coords(f.line)}" fill="none" stroke="#b7beb3" stroke-width="3" stroke-dasharray="5 3"/>`;
for(const b of model.infra.buildings) shapes+=poly(b.ring,b.amenity==='clubhouse'?'#d7ba73':'#a4a195');
for(const hole of model.holes){
  for(const ring of hole.fairway.rings) shapes+=poly(ring,'#57845a');
  shapes+=poly(hole.green.ring,'#a4c681','#d0dfae');
  for(const pad of hole.tees.pads) shapes+=poly(pad.ring,'#90ae76');
  for(const bunker of hole.bunkers) shapes+=poly(bunker.ring,'#e2d4b0');
  shapes+=`<polyline points="${coords(hole.line)}" fill="none" stroke="#d2dcb7" stroke-width="1.4" stroke-dasharray="5 6" opacity=".75"/>`;
  const [x,y]=hole.line[0];
  shapes+=`<circle cx="${x-west}" cy="${y-north}" r="13" fill="#edf0d7"/><text x="${x-west}" y="${y-north+5}" fill="#16352c" text-anchor="middle" font-size="14" font-family="sans-serif">${hole.n}</text>`;
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Tortuna Golfklubb, preliminär bankarta med 18 hål"><title>Tortuna Golfklubb · 18 hål · par 71</title><rect width="100%" height="100%" fill="#36543f"/>${shapes}<text x="30" y="45" fill="#f0edce" font-family="sans-serif" font-size="25">TORTUNA GK</text><text x="30" y="76" fill="#cad6b5" font-family="sans-serif" font-size="17">18 hål · par 71</text><text x="${w-55}" y="50" fill="#f0edce" font-family="sans-serif" font-size="24">N ↑</text></svg>\n`;
const out=path.join(root,'apps/golf/public/courses/tortuna/overview.svg');
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,svg);console.log('Tortuna vector overview written');
