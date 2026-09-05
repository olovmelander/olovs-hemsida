/* Which Esri capture is the tracing frame here, and is there a better one?

   At Veckefjärden the live World Imagery mosaic turned out to be a patchwork of
   several capture dates, and Wayback release 27982 -- one leaf-on capture over the
   whole course -- became the tracing frame. This asks the same question of
   Johannesberg, whose nine's greens the live mosaic could not resolve, and answers
   it the other way: no release fixes them.

   Two things this measures that a hash census alone cannot:
   - a release that changes a tile's BYTES has not necessarily changed its PIXELS
     (Esri restates tiles), so captures are separated by decoded pixel agreement;
   - "leaf-off" is a claim about the ground, so it is measured as excess green
     (2G-R-B) inside the model's own greens and fairways, with the eighteen's greens
     as the reference for what a maintained putting surface looks like here.

     node johannesbergbuild/capture-census.mjs   -> johannesbergbuild/imagery-captures.json  */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, writeJSON } from './lib.mjs';
process.env.BUILD = process.env.BUILD || 'johannesbergbuild';
const { ensure, rgbAt, releases, pxOf } = await import('../geobuild/imagery/wayback.mjs');

const m18 = JSON.parse(fs.readFileSync(path.join(ROOT, 'johannesbergbuild/course-model.json'), 'utf8'));
const m9 = JSON.parse(fs.readFileSync(path.join(ROOT, 'johannesberg9build/course-model.json'), 'utf8'));
const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
const med = a => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); return s.length ? +s[s.length >> 1].toFixed(1) : null; };
const ptsIn = (rings, box, step = 2) => { const o = []; for (let z = box[1]; z <= box[3]; z += step) for (let x = box[0]; x <= box[2]; x += step) if (rings.some(r => inRing(x, z, r))) o.push([x, z]); return o; };

/* the two boxes: the eighteen's middle, and the nine's corner */
const BOX18 = [-250, -600, 450, 100], BOX9 = [-830, -940, -190, -470];
const g18 = m18.holes.map(h => h.green.ring), f18 = m18.holes.flatMap(h => h.fairway?.rings || []).filter(r => Array.isArray(r) && r.length > 3);
const P = { green18: ptsIn(g18, BOX18), fairway18: ptsIn(f18, BOX18, 3) };
const nineGreens = m9.holes.map(h => ({ n: h.n, prov: h.green.prov, pts: ptsIn([h.green.ring], BOX9) }));

/* Which releases are worth measuring? NOT the ones that answer: Wayback resolves a
   request to the latest release <= the one asked for, so EVERY release answers 200 over
   a tile that has ever been captured, and a HEAD sweep returns all 190 of them. A
   release is a new capture only where the tile's BYTES change from the release before,
   so the candidates are the distinct hashes over two probe tiles -- one under the
   eighteen, one under the nine, because the mosaic is a patchwork of both. */
const probe = [[-100, -300], [-600, -700]];
const rels = await releases();
const byId = Object.fromEntries(rels.map(r => [r.id, r.date]));
const crypto = await import('node:crypto');
const held = new Set();
for (const [x, z] of probe) {
  const [gx, gy] = pxOf(x, z), tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  let last = null;
  for (const r of rels) {
    const res = await fetch(`https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/${r.id}/18/${ty}/${tx}`);
    if (!res.ok) continue;
    const h = crypto.createHash('md5').update(Buffer.from(await res.arrayBuffer())).digest('hex');
    if (h !== last) { held.add(r.id); last = h; }
  }
}
const CAND = [['', 'live mosaic'], ...[...held].sort((a, b) => (byId[a] < byId[b] ? 1 : -1)).map(id => [id, byId[id]])];
console.log(`${rels.length} releases; ${held.size} are a new capture over one of the two probe tiles: ${[...held].map(id => `${id} (${byId[id]})`).join(', ')}`);

const rows = [], sig = {};
for (const [rel, label] of CAND) {
  try { await ensure(...BOX18, rel); await ensure(...BOX9, rel); }
  catch (e) { console.log(`${label}: ${e.message.slice(0, 70)}`); continue; }
  const exg = (pts) => { const v = []; for (const [x, z] of pts) { const c = rgbAt(x, z, rel); if (c) v.push(2 * c[1] - c[0] - c[2]); } return med(v); };
  const px = []; for (const [x, z] of P.green18) { const c = rgbAt(x, z, rel); px.push(c ? c.join(',') : '-'); }
  const px9 = []; for (const g of nineGreens) for (const [x, z] of g.pts) { const c = rgbAt(x, z, rel); px9.push(c ? c.join(',') : '-'); }
  sig[rel || 'live'] = { e18: px, e9: px9 };
  rows.push({
    release: rel || 'live', date: rel ? byId[rel] : 'the mosaic served today',
    green18Exg: exg(P.green18), fairway18Exg: exg(P.fairway18),
    nineGreensExg: Object.fromEntries(nineGreens.map(g => [`${g.n}:${g.prov}`, exg(g.pts)])),
  });
  const r = rows.at(-1);
  console.log(`${(r.release + ' ' + r.date).padEnd(34)} eighteen greens ${String(r.green18Exg).padStart(5)}  fairway ${String(r.fairway18Exg).padStart(5)}  nine ${Object.values(r.nineGreensExg).map(v => String(v).padStart(4)).join(' ')}`);
}
/* two releases are the same capture over a box when their decoded pixels agree */
const keys = Object.keys(sig), agree = [];
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
  const pc = (a, b) => { let s = 0; const n = Math.min(a.length, b.length); for (let k = 0; k < n; k++) if (a[k] === b[k]) s++; return +(100 * s / n).toFixed(1); };
  agree.push({ a: keys[i], b: keys[j], eighteenPct: pc(sig[keys[i]].e18, sig[keys[j]].e18), ninePct: pc(sig[keys[i]].e9, sig[keys[j]].e9) });
}
console.log('\ndecoded pixel agreement (100 = the same capture over that box):');
for (const a of agree) console.log(`  ${a.a.padStart(6)} vs ${a.b.padStart(6)}   eighteen ${String(a.eighteenPct).padStart(5)}%   nine ${String(a.ninePct).padStart(5)}%`);

writeJSON(path.join(ROOT, 'johannesbergbuild/imagery-captures.json'), {
  source: 'Esri World Imagery z18 (0.30 m/px), the live mosaic and every Wayback release holding a tile over the course, measured by johannesbergbuild/capture-census.mjs. Excess green (2G-R-B) is the median inside the model\'s own rings; the eighteen\'s greens are the reference for a maintained putting surface here. Captures are separated by DECODED PIXEL agreement, not by tile hash: a release can restate a tile\'s bytes without changing its picture.',
  measuredOn: new Date().toISOString().slice(0, 10),
  boxes: { eighteen: BOX18, nine: BOX9 },
  captures: rows, pixelAgreement: agree,
});
console.log('\n-> johannesbergbuild/imagery-captures.json');
