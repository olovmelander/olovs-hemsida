#!/usr/bin/env node
/* Alignment check: measures veckefjardensgc.html against the official banguide.
   Run from the repo root:  node banguide/check.mjs
   Every number the alignment plan quotes comes from here, so re-run it after any
   change to HOLES, the routing or the land-cover raster. Exits non-zero if one of
   the protected invariants regresses. */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname).replace(/\/banguide$/, '');
const TARGET = process.argv[2] || path.join(ROOT, 'veckefjardensgc.html');
const html = fs.readFileSync(TARGET, 'utf8');
const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'banguide/guide-card.json'), 'utf8')).holes;
const inv  = JSON.parse(fs.readFileSync(path.join(ROOT, 'banguide/guide-inventory.json'), 'utf8')).holes;

/* ---- pull HOLES out of the page without executing the page ---- */
const s = html.indexOf('const HOLES = ['), e = html.indexOf('\nconst CLUB=');
if (s < 0 || e < 0) { console.error('could not locate the HOLES array'); process.exit(2); }
const HOLES = eval(html.slice(s, e).replace('const HOLES = [', '[').replace(/\];[\s\S]*$/, '];'));

/* ---- land-cover raster read off the club course map ---- */
const g = re => html.match(re)[1];
const LCM = new Uint8Array(Buffer.from(g(/const LCB64='([^']+)'/), 'base64'));
const LCNW = +g(/const LCNW=(\d+)/), LCNH = +g(/,LCNH=(\d+)/), LCCELL = +g(/,LCCELL=([\d.]+)/);
const LCX0 = +g(/,LCX0=(-?[\d.]+)/), LCZ0 = +g(/,LCZ0=(-?[\d.]+)/);
const lcCell = (i, j) => {
  if (i < 0) return 1;
  if (j < 0 || i >= LCNW || j >= LCNH) return 0;
  const k = j * LCNW + i; return (LCM[k >> 2] >> ((k & 3) * 2)) & 3;
};
const lcClass = (x, z) => lcCell(Math.floor((x - LCX0) / LCCELL), Math.floor((z - LCZ0) / LCCELL));
const COVER = ['rough', 'water', 'turf', 'forest'];

const hyp = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const plen = L => { let t = 0; for (let i = 0; i < L.length - 1; i++) t += hyp(L[i], L[i + 1]); return t; };
/* the app's own convention: north is -z, east is +x */
const bearing = (a, b) => { const d = Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI; return d < 0 ? d + 360 : d; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function samples(L, n) {
  const segs = []; let tl = 0; const out = [];
  for (let i = 0; i < L.length - 1; i++) { const d = hyp(L[i], L[i + 1]); segs.push(d); tl += d; }
  for (let k = 0; k < n; k++) {
    let d = (k + 0.5) / n * tl;
    for (let i = 0; i < segs.length; i++) {
      if (d <= segs[i] || i === segs.length - 1) { out.push(lerp(L[i], L[i + 1], Math.max(0, Math.min(1, d / segs[i])))); break; }
      d -= segs[i];
    }
  }
  return out;
}

const fail = [];
const row = [];
for (let i = 0; i < HOLES.length; i++) {
  const h = HOLES[i], next = HOLES[(i + 1) % HOLES.length];
  const c = card[String(h.n)], gi = inv[String(h.n)] || {};
  const cardOK = c && h.par === c.par && h.idx === c.hcp && h.t.every((v, k) => v === c.t[k]);
  const lenErr = 100 * (plen(h.line) - h.t[0]) / h.t[0];
  const pts = samples(h.line, 120); const cnt = [0, 0, 0, 0];
  for (const p of pts) cnt[lcClass(p[0], p[1])]++;
  const gpt = h.line[h.line.length - 1];
  const b = bearing(h.line[0], gpt);
  let bDelta = null;
  if (gi.guideBearingDeg != null) { bDelta = Math.abs(b - gi.guideBearingDeg); if (bDelta > 180) bDelta = 360 - bDelta; }
  row.push({
    n: h.n, cardOK, lenErr, turf: 100 * cnt[2] / pts.length,
    greenOn: COVER[lcClass(gpt[0], gpt[1])],
    walk: hyp(gpt, next.line[0]), bearing: b, bDelta,
    bunkApp: (h.bk || []).length, bunkGuide: (gi.bunkers || []).length,
    waterApp: 0, waterGuide: (gi.water || []).length,
    markApp: h.ob ? 1 : 0, markGuide: (gi.boundaries || []).length,
  });
  if (!cardOK) fail.push(`hole ${h.n}: card does not match the guide`);
  if (Math.abs(lenErr) > 0.5) fail.push(`hole ${h.n}: drawn length off by ${lenErr.toFixed(2)}%`);
}

const f2 = (v, w) => String(v).padStart(w);
console.log('hole card  len%   turf% green    walk  bear  Δrose   bunk a/g  water a/g  mark a/g');
for (const r of row) console.log(
  f2(r.n, 4), f2(r.cardOK ? 'ok' : 'BAD', 5), f2(r.lenErr.toFixed(2), 6), f2(r.turf.toFixed(0), 7),
  r.greenOn.padStart(6), f2(r.walk.toFixed(0), 7), f2(r.bearing.toFixed(0), 5),
  f2(r.bDelta == null ? '—' : r.bDelta.toFixed(0), 6),
  f2(`${r.bunkApp}/${r.bunkGuide}`, 10), f2(`${r.waterApp}/${r.waterGuide}`, 10), f2(`${r.markApp}/${r.markGuide}`, 9));

const sum = (k) => row.reduce((a, r) => a + r[k], 0);
const walks = row.map(r => r.walk).sort((a, b) => a - b);
const withRose = row.filter(r => r.bDelta != null);
console.log('\n--- summary -------------------------------------------------');
console.log('card mismatches            ', row.filter(r => !r.cardOK).length, 'of', row.length, '   (target 0)');
console.log('worst drawn-length error   ', Math.max(...row.map(r => Math.abs(r.lenErr))).toFixed(2) + '%', '  (target <= 0.5%)');
console.log('mean corridor on turf      ', (sum('turf') / row.length).toFixed(1) + '%', '  (target >= 90%)');
console.log('greens off mown turf       ', row.filter(r => r.greenOn !== 'turf').length, 'of', row.length, '   (target 1 - hole 14 only)');
console.log('median green->tee walk     ', walks[Math.floor(walks.length / 2)].toFixed(0), 'm', '  (target 20-80 m)');
console.log('longest green->tee walk    ', Math.max(...walks).toFixed(0), 'm', '  (target < 120 m)');
console.log('bearings off the rose >35d ', withRose.filter(r => r.bDelta > 35).map(r => '#' + r.n).join(', ') || 'none',
            `  (${withRose.length} roses readable, mean ${(withRose.reduce((a, r) => a + r.bDelta, 0) / withRose.length).toFixed(0)}d)`);
console.log('bunkers  app / guide       ', sum('bunkApp'), '/', sum('bunkGuide'));
console.log('water    app / guide       ', sum('waterApp'), '/', sum('waterGuide'));
console.log('marking  app / guide       ', sum('markApp'), '/', sum('markGuide'));

if (fail.length) { console.error('\nPROTECTED INVARIANT BROKEN:'); for (const f of fail) console.error('  - ' + f); process.exit(1); }
console.log('\nprotected invariants intact: card data and drawn lengths.');
