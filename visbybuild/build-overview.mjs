/* Semantic vector overview derived from canonical geometry, never draped imagery. */
import fs from 'node:fs';
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const geometry = read('visbybuild/mapping/geometry.json');
const water = read('geo_data/course-v2/visby/mapping/water-breakgeometry-epsg3006.geojson');
const surfaces = read('visbybuild/mapping/playing-surfaces.geojson');
const practice = read('visbybuild/mapping/practice-surfaces.geojson');
const context = read('geo_data/course-v2/visby/mapping/osm-context-epsg3006.geojson');
const bounds = [686990, 6370460, 688510, 6372050];
const x = e => ((e - bounds[0]) / (bounds[2] - bounds[0]) * 960).toFixed(1);
const y = n => ((bounds[3] - n) / (bounds[3] - bounds[1]) * 1040).toFixed(1);
const ringPath = ring => ring.map(([e,n],i) => `${i ? 'L' : 'M'}${x(e)},${y(n)}`).join(' ') + 'Z';
const polygon = (rings, fill, stroke = 'none', width = 1) => `<path d="${rings.map(ringPath).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" fill-rule="evenodd"/>`;
const out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 1100" role="img" aria-label="Visby GK: översikt över Kronholmens 18 hål"><rect width="960" height="1100" fill="#829279"/>'];
for(const f of context.features) {
  const t=f.properties?.tags??{};
  if(f.geometry.type==='Polygon'&&(t.natural==='wood'||t.landuse==='forest'))out.push(polygon(f.geometry.coordinates,'#64785f'));
}
for (const f of water.features) for (const rings of f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]) out.push(polygon(rings,'#406d80','#a2b6a7',1.5));
for(const f of practice.features) out.push(polygon(f.geometry.coordinates,'#94a37e'));
const colours = {fairway:'#adbb8d',tee:'#c7cfa0',green:'#d1dbaa',bunker:'#e0d6ba'};
for(const kind of ['fairway','tee','green','bunker'])for(const f of surfaces.features.filter(f=>f.properties.kind===kind))out.push(polygon(f.geometry.coordinates,colours[kind]));
for(const f of context.features)if(f.geometry.type==='Polygon'&&f.properties?.tags?.building)out.push(polygon(f.geometry.coordinates,'#ddd2bb','#626753',0.8));
for(const h of geometry.holes){
  const p=h.green.reference;
  out.push(`<path d="${h.line.map(([e,n],i)=>`${i?'L':'M'}${x(e)},${y(n)}`).join(' ')}" fill="none" stroke="#f3eddb" stroke-opacity=".5" stroke-width="1.3"/>`);
  out.push(`<circle cx="${x(p[0])}" cy="${y(p[1])}" r="12" fill="#1f443e" stroke="#dce3c6" stroke-width="1.4"/><text x="${x(p[0])}" y="${(+y(p[1])+4).toFixed(1)}" text-anchor="middle" fill="#fff7e4" font-family="Arial,sans-serif" font-size="12" font-weight="bold">${h.n}</text>`);
}
out.push('<rect y="1040" width="960" height="60" fill="#183c37"/><text x="30" y="1079" fill="#f1ebd8" font-family="Arial,sans-serif" font-size="27" letter-spacing="2">VISBY GK · KRONHOLMEN</text><text x="930" y="1076" text-anchor="end" fill="#c7d1b9" font-family="Arial,sans-serif" font-size="13">18 HÅL · PAR 72</text><metadata>Provisional source-derived illustration. Terrain/water: Lantmäteriet; supplementary map data © OpenStreetMap contributors, ODbL. Playing surface candidates: retained Region Gotland 2022 imagery. Survey and production rights review pending. No raw source imagery embedded.</metadata></svg>');
fs.writeFileSync('apps/golf/public/courses/visby/overview.svg', out.join('\n')+'\n');
