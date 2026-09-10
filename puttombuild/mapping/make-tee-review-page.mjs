import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
import { orthophotoPointEpsg3006 } from './reviewed-orthophoto.mjs';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const model=read('puttombuild/course-model.json'),review=read('puttombuild/mapping/orthophoto-review.json');
const audit=read('puttombuild/mapping/alignment-audit.json');
const refs=new Map();
for(const h of review.holes){
  for(const p of h.tees??[])for(const [key,pixel]of Object.entries(p.cameraReferencesPixels??{}))refs.set(`${h.n}:${key}`,{sourceKey:p.sourceKey,pixel});
  for(const p of h.cameraReferences??[])refs.set(`${h.n}:${p.teeKey}`,{sourceKey:p.sourceKey,pixel:p.pointPixels});
}
const labels={
  'corrected-inside-reviewed-platform':'Reviewed platform and identity',
  'reviewed-visible-interior-anchor-boundary-unreviewed':'Reviewed start; platform edge uncertain',
  'inside-reviewed-platform-numbered-identity-unverified':'Platform reviewed; tee identity unresolved',
  'inside-unreviewed-mapped-platform':'Previous platform; placement unresolved',
  'outside-all-mapped-platforms':'Outside mapped platforms; placement unresolved',
};
const rows=model.holes.map(h=>({n:h.n,tees:h.tees.marks.map((mark,i)=>{
  const key=['tee-61','tee-57','tee-48','tee-41'][i],ref=refs.get(`${h.n}:${key}`);
  const grid=ref?orthophotoPointEpsg3006(review,ref.sourceKey,ref.pixel):latLonToSweref99Tm(model.origin.lat-mark.c[1]/model.mPerLat,model.origin.lon+mark.c[0]/model.mPerLon);
  const status=audit.marks.find(m=>m.hole===h.n&&m.tee===key)?.status;
  const dates=ref?[...new Set((review.sources[ref.sourceKey].sources??[]).map(s=>s.capturedAt?.slice(0,10)).filter(Boolean))]:[];
  return {tee:key.slice(4),metres:mark.m,easting:grid[0].toFixed(2),northing:grid[1].toFixed(2),
    reviewed:!!ref,status:labels[status]??status,date:dates.join(', ')||'Previous source'};
})}));
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Puttom tee placement</title><style>
*{box-sizing:border-box}body{margin:0;background:#111b18;color:#e5efe9;font:16px system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:28px}h1{margin:0 0 10px;font-size:30px}p{color:#b8cbbf;line-height:1.5;max-width:1100px}.controls{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:18px 0}select,button{font:inherit;background:#243a2f;color:inherit;padding:8px;border:1px solid #5a7665;border-radius:6px}input{accent-color:#80dba7}.comparison{position:relative;display:inline-block;max-width:100%}.comparison img{display:block;max-height:70vh;max-width:100%;object-fit:contain}#after{position:absolute;top:0;left:0;clip-path:inset(0 50% 0 0)}#raw{display:none}table{border-collapse:collapse;width:100%;margin-top:20px;font-size:14px}th,td{text-align:left;padding:10px;border-bottom:1px solid #344b3d}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}a{color:#9ee0b8}.uncertain{color:#ebc58d}small{color:#a8bcae}.scroll{overflow:auto}
</style><main><h1>Puttom · Tee placement and coordinates</h1>
<p>${review.summary.cameraReferences} of 72 numbered tee starts reviewed. ${review.summary.teePlatforms} platform outlines traced. Each retained or changed start keeps its source status.</p>
<p>2024 is the primary image campaign. Morning and midday images from 2022 clarify platforms obscured by afternoon shadows. Both sets use the same native 16 cm grid. Positions are virtual tee-view anchors; daily movable markers require a current observation.</p>
<div class="controls"><label>Hole <select id="hole">${rows.map(h=>`<option>${h.n}</option>`).join('')}</select></label><label>Image <select id="year"><option value="2024">27 June 2024</option><option value="2022">24 June / 3 July 2022</option></select></label><label>Revised coverage <input id="slider" type="range" min="0" max="100" value="50"></label><button id="toggle">Show source image</button></div>
<p>Revised positions on the left · previous positions on the right. Cyan outlines and crosses show tees.</p>
<div class="comparison"><img id="before" alt="Previous tee placements"><img id="after" alt="Revised tee placements"><img id="raw" alt="Source orthophoto"></div>
<div class="scroll"><table><thead><tr><th>Tee</th><th>Card distance</th><th>Easting · EPSG:3006</th><th>Northing · EPSG:3006</th><th>Placement evidence</th><th>Image date</th></tr></thead><tbody id="rows"></tbody></table></div>
<p>Coordinate precision describes the stored position. It does not establish survey accuracy. Unresolved references remain labelled, including forward starts on grass without a distinct platform.</p>
<p><a href="../mapping/tee-coordinates.csv">All 72 coordinates · CSV</a> · <a href="../mapping/alignment-audit.json">Coordinate audit</a> · <a href="../mapping/orthophoto-review.json">Native source pixels and decisions</a></p>
<small>Ortofoto Nedladdning © Lantmäteriet, bearbetad information, CC BY 4.0. Source rasters remain in the local review cache.</small></main>
<script>const data=${JSON.stringify(rows)};const hole=document.querySelector('#hole'),year=document.querySelector('#year'),slider=document.querySelector('#slider'),before=document.querySelector('#before'),after=document.querySelector('#after'),raw=document.querySelector('#raw'),toggle=document.querySelector('#toggle');let showRaw=false;function update(){const n=String(hole.value).padStart(2,'0'),old=year.value==='2022',stem=old?'tee-2022-hole-'+n:'hole-'+n+'-tees';before.src=(old?'lm-tee-2022-review/':'tee-followup-before/')+stem+'-overlay.png';after.src=(old?'lm-tee-followup-after-2022/':'lm-ortho-after/')+stem+'-overlay.png';raw.src=(old?'lm-tee-2022-review/':'lm-ortho-review/')+stem+'.png';after.style.clipPath='inset(0 '+(100-slider.value)+'% 0 0)';before.style.display=after.style.display=showRaw?'none':'block';raw.style.display=showRaw?'block':'none';toggle.textContent=showRaw?'Show compared positions':'Show source image';document.querySelector('#rows').replaceChildren(...data.find(h=>h.n===Number(hole.value)).tees.map(t=>{const tr=document.createElement('tr');for(const [key,value]of Object.entries({tee:t.tee,metres:t.metres+' m',easting:t.easting,northing:t.northing,status:t.status,date:t.date})){const td=document.createElement('td');td.textContent=value;if(['metres','easting','northing'].includes(key))td.className='num';if(key==='status'&&!t.reviewed)td.className='uncertain';tr.append(td)}return tr}));}hole.onchange=year.onchange=slider.oninput=update;toggle.onclick=()=>{showRaw=!showRaw;update()};update();</script></html>`;
const file=path.join(root,'puttombuild/cache/tee-placement-review.html');fs.writeFileSync(file,html);console.log(file);
