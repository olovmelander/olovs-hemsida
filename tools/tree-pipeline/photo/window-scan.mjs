/* Round-4 window scan (evidence of how W1-W5 were chosen): for chosen 100 m census cells, every candidate window near play that keeps 15 m from earlier windows, with its detector-neutral apex strata.
   node tools/tree-pipeline/photo/window-scan.mjs <raw cache> <cells json> <sizes json> <sort key> */
import fs from 'node:fs';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { playGeometry, nearPlay, lineDistance } from '../geometry.mjs';
import { loadRaster } from '../panels.mjs';
import { overSegmentCandidates } from '../reference.mjs';
const ctx = loadGroundConfig(ROOT, 'johannesberg', { raw: process.argv[2], round: 'r4' });
const { holeLines, practiceRings } = playGeometry(ctx);
const chm = loadRaster(ctx, 'chm-pitfree-050');
const g = chm.grid;
const at = (e, n) => { const c = Math.floor((e - g.minEasting) / 0.5), r = Math.floor((g.maxNorthing - n) / 0.5); return chm.values[r * g.width + c]; };
const share = (e, n) => { let k = 0, t = 0; for (let y = -8; y < 8; y += 1) for (let x = -8; x < 8; x += 1) { t++; if (at(e + x, n + y) >= 3) k++; } return k / t; };
const prev = JSON.parse(fs.readFileSync(ctx.reviewFile('reference-windows-r3.json'))).windows;
const ov = (a, b, m) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
const cells = JSON.parse(process.argv[3]);
const sizes = JSON.parse(process.argv[4]);
for (const [ce, cn] of cells) for (const [w, h] of sizes) {
  const res = [];
  for (let e = ce; e + w <= ce + 100; e += 5) for (let n = cn; n + h <= cn + 100; n += 5) {
    const bbox = [e, n, e + w, n + h];
    if (prev.some(p => ov(bbox, p.bbox, 15))) continue;
    if (!nearPlay(e + w / 2, n + h / 2, holeLines, practiceRings, 90)) continue;
    const cand = overSegmentCandidates(chm, bbox, 0).filter(c => c.heightMetres >= 3 && c.easting >= e && c.easting < e + w && c.northing >= n && c.northing < n + h);
    const st = { iso: 0, grp: 0, edge: 0, cl: 0 };
    let hs = 0;
    for (const c of cand) { const s = share(c.easting, c.northing); hs += c.heightMetres; st[s < 0.2 ? 'iso' : s < 0.45 ? 'grp' : s < 0.75 ? 'edge' : 'cl']++; }
    const dist = Math.min(...holeLines.map(l => lineDistance(e + w / 2, n + h / 2, l)));
    res.push({ bbox, n: cand.length, ...st, meanH: Math.round(hs / cand.length), dist: Math.round(dist) });
  }
  console.log(`cell ${ce},${cn} ${w}x${h}`);
  const key = process.argv[5] || 'cl';
  res.sort((a, b) => b[key] / b.n - a[key] / a.n || a.dist - b.dist);
  for (const r of res.slice(0, 5)) console.log(' ', JSON.stringify(r));
}
