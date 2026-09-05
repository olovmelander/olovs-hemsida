/* How green is each putting surface, in every capture Esri holds of this course?

   §7.9 left six of the nine's greens unresolved because the imagery could not
   separate them from the ground around them, and the working assumption was that a
   leaf-on capture from Wayback would fix it, as one did at Veckefjärden. This asks
   the question directly: it reads the capture inventory tools/wayback-captures.mjs
   wrote, and measures excess green (2G-R-B) inside every green ring of BOTH courses
   in each one. The eighteen's greens are the reference for what a maintained putting
   surface looks like here, so the nine's are a fraction of a known quantity rather
   than a number on their own.

     node tools/wayback-captures.mjs --build johannesbergbuild --out johannesbergbuild/imagery-captures.json
     node johannesbergbuild/green-vigour.mjs   -> johannesbergbuild/green-vigour.json  */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, writeJSON } from './lib.mjs';
process.env.BUILD = process.env.BUILD || 'johannesbergbuild';
const { ensure, rgbAt } = await import('../geobuild/imagery/wayback.mjs');

const m18 = readJSON(path.join(ROOT, 'johannesbergbuild/course-model.json'));
const m9 = readJSON(path.join(ROOT, 'johannesberg9build/course-model.json'));
const caps = readJSON(path.join(ROOT, 'johannesbergbuild/imagery-captures.json'));
const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
const med = a => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); return s.length ? +s[s.length >> 1].toFixed(1) : null; };
const ptsIn = ring => { const o = []; let b = [1e9, 1e9, -1e9, -1e9]; for (const p of ring) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); } for (let z = b[1]; z <= b[3]; z += 1.5) for (let x = b[0]; x <= b[2]; x += 1.5) if (inRing(x, z, ring)) o.push([x, z]); return o; };

const greens18 = m18.holes.map(h => ({ n: h.n, pts: ptsIn(h.green.ring) }));
const greens9 = m9.holes.map(h => ({ n: h.n, prov: h.green.prov, pts: ptsIn(h.green.ring) }));
const box = arr => { let b = [1e9, 1e9, -1e9, -1e9]; for (const g of arr) for (const [x, z] of g.pts) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], z); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], z); } return b; };
const B18 = box(greens18), B9 = box(greens9);

/* one release per distinct capture, plus the live mosaic */
const uniq = new Map();
for (const p of caps.probes) for (const r of p.runs) if (!uniq.has(r.capture?.date || r.sha)) uniq.set(r.capture?.date || r.sha, { release: String(r.newestRelease), capture: r.capture });
const CAND = [['', { date: 'the mosaic served today' }], ...[...uniq.values()].map(v => [v.release, v.capture])];
console.log(`${uniq.size} distinct capture(s) over this course, plus the live mosaic`);

const rows = [];
for (const [rel, cap] of CAND) {
  try { await ensure(B18[0] - 5, B18[1] - 5, B18[2] + 5, B18[3] + 5, rel); await ensure(B9[0] - 5, B9[1] - 5, B9[2] + 5, B9[3] + 5, rel); }
  catch (e) { console.log(`  release ${rel || 'live'}: ${e.message.slice(0, 60)}`); continue; }
  const exg = pts => { const v = []; for (const [x, z] of pts) { const c = rgbAt(x, z, rel); if (c) v.push(2 * c[1] - c[0] - c[2]); } return med(v); };
  const e18 = greens18.map(g => exg(g.pts)).filter(v => v !== null);
  const e9 = greens9.map(g => ({ n: g.n, prov: g.prov, exg: exg(g.pts) }));
  const ref = med(e18);
  rows.push({
    release: rel || 'live', captureDate: cap?.date ?? null, sensor: cap?.sensor ?? null,
    resolutionMetres: cap?.res ? +cap.res.toFixed(2) : null,
    eighteenGreensExg: ref, eighteenRange: [Math.min(...e18), Math.max(...e18)],
    nineGreens: Object.fromEntries(e9.map(g => [`${g.n}:${g.prov}`, g.exg])),
    nineMedianAsFractionOfEighteen: +(med(e9.map(g => g.exg)) / ref).toFixed(2),
  });
  const r = rows.at(-1);
  console.log(`${String(r.release).padEnd(6)} capture ${String(r.captureDate).padEnd(24)} ${String(r.sensor ?? '').padEnd(5)} eighteen ${String(r.eighteenGreensExg).padStart(5)}  nine ${Object.values(r.nineGreens).map(v => String(v).padStart(4)).join(' ')}  (nine is ${(100 * r.nineMedianAsFractionOfEighteen).toFixed(0)}% of the eighteen)`);
}
writeJSON(path.join(ROOT, 'johannesbergbuild/green-vigour.json'), {
  source: 'Excess green (2G-R-B), median inside every green ring of both courses, in each distinct Esri capture named by johannesbergbuild/imagery-captures.json (written by tools/wayback-captures.mjs). The eighteen\'s greens are the reference for a maintained putting surface on this property; the nine\'s are reported against it.',
  measuredOn: new Date().toISOString().slice(0, 10),
  captures: rows,
});
console.log('-> johannesbergbuild/green-vigour.json');
