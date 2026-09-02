#!/usr/bin/env node
/* Per-hole geometry facts from a build's course-model.json, for writing or
   checking a hålguide: which way each hole bends and where, tee/green
   heights and the DEM profile along the line, bunkers by side and distance
   to the green, water and streams by side and fraction, the walk to the
   next tee. Left/right is the PLAYER'S, facing the green.

     node tools/hole-geometry.mjs <buildDir> [hole]

   Conventions (see CLAUDE.md "Bearings" and "Left and right"): north is -z,
   a compass bearing is atan2(dx, -dz); for that bearing forward is
   (sin b, -cos b) and the player's right hand is (cos b, sin b). lib's
   right() pairs with alongLine's angle, NOT with bearing(); mixing them
   reflects sides in a bearing-dependent way, which is how the first draft
   of this script put every bunker on the wrong side of a north-going hole. */
import path from 'node:path';
import { readJSON, decodeHF, bearing, hyp, polyLen, centroid, polySD, ptSeg } from '../geobuild/lib.mjs';

const [buildDir, onlyHole] = process.argv.slice(2);
if (!buildDir) { console.error('usage: node tools/hole-geometry.mjs <buildDir> [hole]'); process.exit(2); }
const m = readJSON(path.join(buildDir, 'course-model.json'));
const deg = r => r * 180 / Math.PI;
const rightOf = b => [Math.cos(b), Math.sin(b)];

/* DEM sampler, the same bilinear read reconcile uses for elev */
let terr = null;
try {
  const hf = readJSON(path.join(buildDir, 'heightfields.json'));
  const H0 = hf.hf0, g = decodeHF(H0);
  terr = (x, z) => {
    const gx = (x - H0.x0) / H0.dx, gz = (z - H0.z0) / H0.dx;
    const i = Math.max(0, Math.min(H0.nx - 2, Math.floor(gx))), j = Math.max(0, Math.min(H0.nz - 2, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - i)), fz = Math.min(1, Math.max(0, gz - j));
    const a = g[j * H0.nx + i], b = g[j * H0.nx + i + 1], c = g[(j + 1) * H0.nx + i], d = g[(j + 1) * H0.nx + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  };
} catch { /* no heightfields beside the model: skip the profile */ }

function at(L, s) {
  let acc = 0;
  for (let i = 0; i + 1 < L.length; i++) {
    const sl = hyp(L[i], L[i + 1]);
    if (acc + sl >= s) { const t = (s - acc) / sl; return [L[i][0] + (L[i + 1][0] - L[i][0]) * t, L[i][1] + (L[i + 1][1] - L[i][1]) * t]; }
    acc += sl;
  }
  return L[L.length - 1];
}
/* nearest point of a polyline to p: fraction along it, signed lateral offset (+ right), distance */
function project(L, p) {
  let best = null, acc = 0; const tot = polyLen(L);
  for (let i = 0; i + 1 < L.length; i++) {
    const a = L[i], b = L[i + 1], sl = hyp(a, b);
    const s = ptSeg(p[0], p[1], a[0], a[1], b[0], b[1]);
    if (!best || s.d < best.d) {
      const R = rightOf(bearing(b[0] - a[0], b[1] - a[1]));
      const fx = a[0] + (b[0] - a[0]) * s.t, fz = a[1] + (b[1] - a[1]) * s.t;
      best = { d: s.d, f: (acc + sl * s.t) / tot, lat: (p[0] - fx) * R[0] + (p[1] - fz) * R[1] };
    }
    acc += sl;
  }
  return best;
}
function ringNear(L, ring, step = 4) {
  let best = { sd: 1e9, f: 0, p: L[0] }; const tot = polyLen(L);
  for (let s = 0; s <= tot; s += step) { const p = at(L, s); const sd = polySD(p[0], p[1], ring); if (sd < best.sd) best = { sd, f: s / tot, p }; }
  return best;
}

const water = (m.water || []).map((w, i) => ({ name: w.name || `vatten#${i}`, level: w.level, ring: w.ring || w.pts })).filter(w => w.ring && w.ring.length > 2);
const streams = (m.streams || []).map((s, i) => ({ i, pts: s.line || s.pts || s.ring })).filter(s => Array.isArray(s.pts));
const H = m.holes.filter(h => !onlyHole || String(h.n) === String(onlyHole));

for (const h of H) {
  const k = m.holes.indexOf(h), L = h.line, tot = polyLen(L);
  const b0 = bearing(L[1][0] - L[0][0], L[1][1] - L[0][1]);
  const bl = bearing(L[L.length - 1][0] - L[L.length - 2][0], L[L.length - 1][1] - L[L.length - 2][1]);
  let turn = deg(bl - b0); while (turn > 180) turn -= 360; while (turn < -180) turn += 360;
  const A = L[0], B = L[L.length - 1], R = rightOf(bearing(B[0] - A[0], B[1] - A[1]));
  let dev = 0, devf = 0;
  for (let i = 1; i + 1 < L.length; i++) { const d = (L[i][0] - A[0]) * R[0] + (L[i][1] - A[1]) * R[1]; if (Math.abs(d) > Math.abs(dev)) { dev = d; devf = polyLen(L.slice(0, i + 1)) / tot; } }
  const gc = h.green?.c || h.pin || B;
  const bunk = (h.bunkers || []).map(bk => { const c = centroid(bk.ring); const p = project(L, c); return `${p.lat > 0 ? 'R' : 'L'}${Math.abs(p.lat).toFixed(0)}m @${Math.round(hyp(c, gc))}m-to-green`; });
  const wat = water.map(w => ({ w, n: ringNear(L, w.ring) })).filter(x => x.n.sd < 40).map(x => {
    const side = project(L, centroid(x.w.ring)).lat > 0 ? 'R' : 'L';
    return `${x.w.name}${x.w.level != null ? ` (lvl ${x.w.level})` : ''}: ${x.n.sd < 0 ? 'LINE CROSSES IT' : Math.round(x.n.sd) + ' m off the line'} at f=${x.n.f.toFixed(2)}, ${side} side, green ${Math.max(0, Math.round(polySD(gc[0], gc[1], x.w.ring)))} m, tee ${Math.max(0, Math.round(polySD(A[0], A[1], x.w.ring)))} m`;
  });
  const str = streams.map(s => { let best = { d: 1e9 }; for (const p of s.pts) { const pr = project(L, p); if (pr.d < best.d) best = pr; } return best.d < 30 ? `stream#${s.i} ${Math.round(best.d)} m at f=${best.f.toFixed(2)} ${best.lat > 0 ? 'R' : 'L'}` : null; }).filter(Boolean);
  const nxt = m.holes[k + 1];
  const walk = nxt ? Math.round(hyp(gc, nxt.line[0])) : null;
  /* direction from the heading change; when the line straightens again (an S or a bend
     followed by a straight run) fall back to the elbow, which lies on the OUTSIDE of the
     turn: an elbow RIGHT of the tee-green chord is a LEFT dogleg. */
  const dir = Math.abs(turn) >= 8 ? (turn > 0 ? 'RIGHT' : 'LEFT') : (dev > 0 ? 'LEFT' : 'RIGHT');
  const bend = Math.abs(turn) < 8 && Math.abs(dev) < 15 ? 'straight' : `dogleg ${dir} (turn ${turn.toFixed(0)}°, elbow ${Math.abs(dev).toFixed(0)} m ${dev > 0 ? 'right' : 'left'} of the chord at ${(devf * 100).toFixed(0)}%)`;
  console.log(`\nHOLE ${h.n}  par ${h.par}  idx ${h.idx ?? h.hcp ?? '-'}  card ${(h.t || []).join('/')}  line ${tot.toFixed(0)} m  ${bend}`);
  if (h.elev) console.log(`  tee ${h.elev.tee} m  green ${h.elev.green} m  rise ${h.elev.rise >= 0 ? '+' : ''}${h.elev.rise} m`);
  if (terr) { const row = []; for (let s = 0; s <= tot + 1; s += 25) { const p = at(L, Math.min(s, tot)); row.push(`${Math.round(tot - Math.min(s, tot))}:${terr(p[0], p[1]).toFixed(1)}`); } console.log(`  profile (m-to-green:height) ${row.join(' ')}`); }
  console.log(`  green ${h.green?.area ? Math.round(h.green.area) + ' m²' : '?'} ${h.green?.prov || ''}  bunkers ${bunk.length}: ${bunk.join(' ; ') || 'none'}`);
  console.log(`  water: ${wat.join(' | ') || 'none within 40 m'}${str.length ? `  streams: ${str.join(' | ')}` : ''}`);
  if (walk != null) console.log(`  walk to next tee ${walk} m`);
}
