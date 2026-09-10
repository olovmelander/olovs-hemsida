#!/usr/bin/env node
/* Portable visual comparison, referencing the five matching camera captures. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(ROOT, 'visbybuild/cache/facilities-runtime');
const before = JSON.parse(fs.readFileSync(path.join(out, 'baseline-webgpu/report.json'), 'utf8'));
const after = JSON.parse(fs.readFileSync(path.join(out, 'authored-webgpu/report.json'), 'utf8'));
if (before.status !== 'passed' || after.status !== 'passed') throw new Error('Comparison requires both passing browser reviews');
const poses = [['clubhouse-seaward', 'Clubhouse · sea side'], ['clubhouse-entrance', 'Clubhouse · entrance'],
  ['lighthouse', 'Lighthouse and cottages'], ['range', 'Practice building'], ['facility-overview', 'Facility overview']];
const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visby facility model comparison</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#11221b;color:#edf0e8;font:16px system-ui,sans-serif}
main{max-width:1500px;margin:auto;padding:30px 24px}h1{font-size:30px;margin:0 0 8px}p{color:#c0cdbf;line-height:1.5}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}button{font:inherit;color:inherit;background:#253a30;border:1px solid #44604d;border-radius:6px;padding:10px 14px;cursor:pointer}button[aria-pressed=true]{background:#3e7650}
.compare{position:relative;aspect-ratio:8/5;background:#0b1610;border-radius:8px;overflow:hidden;--split:50%}
.compare img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.compare .after{clip-path:inset(0 0 0 var(--split))}.line{position:absolute;left:var(--split);height:100%;border-left:2px solid #fff;pointer-events:none}
.caption{position:absolute;top:12px;background:#102117e8;padding:8px 12px;border-radius:4px;font-size:14px}.before-label{left:12px}.after-label{right:12px}
label{display:block;margin:20px 0 8px}input{width:100%;accent-color:#72bf7f}a{color:#a8d9ad}footer{display:flex;gap:20px;flex-wrap:wrap;margin:22px 0}small{color:#afbeaf}
</style>
<main><h1>Visby · Facility models</h1>
<p>Move the divider to compare the previous course buildings with the Blender models at exactly the same camera position.</p>
<nav aria-label="Camera view">${poses.map(([id, label], i) => `<button type="button" data-pose="${id}" aria-pressed="${i === 0}">${label}</button>`).join('')}</nav>
<div class="compare"><img class="before" src="baseline-webgpu/clubhouse-seaward.png" alt="Previous generic clubhouse geometry"><img class="after" src="authored-webgpu/clubhouse-seaward.png" alt="Authored Blender clubhouse model"><span class="line"></span><span class="caption before-label">Previous buildings</span><span class="caption after-label">Blender models</span></div>
<label for="divider">Comparison divider</label><input id="divider" type="range" min="0" max="100" value="50">
<p>These are exterior reconstructions from orthophotos and photographs. Unmeasured heights and unseen details remain estimates.</p>
<footer><a href="authored-webgpu/report.json">Browser validation</a><a href="asset-audit.json">GLB validation</a><a href="../../../apps/golf/public/models/visby/facilities-v1.glb">Facility GLB</a></footer>
<small>Captured ${after.completedAt.slice(0, 10)} · ${after.state.stats.facilities.facilities.length} modeled facilities · ${after.state.stats.facilities.triangles.toLocaleString('en-US')} triangles</small></main>
<script>
const panel=document.querySelector('.compare');
document.querySelector('#divider').addEventListener('input',event=>panel.style.setProperty('--split',event.target.value+'%'));
document.querySelectorAll('[data-pose]').forEach(button=>button.addEventListener('click',()=>{
document.querySelector('.before').src='baseline-webgpu/'+button.dataset.pose+'.png';
document.querySelector('.after').src='authored-webgpu/'+button.dataset.pose+'.png';
document.querySelector('.before').alt='Previous geometry: '+button.textContent;
document.querySelector('.after').alt='Blender geometry: '+button.textContent;
document.querySelectorAll('[data-pose]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
}));
</script></html>`;
fs.writeFileSync(path.join(out, 'index.html'), html);
console.log(path.relative(ROOT, path.join(out, 'index.html')));
