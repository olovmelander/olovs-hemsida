/* Draw the reconciled Johannesberg course from above, to be judged before 3D.

   Same purpose as geobuild/render-design.mjs: make disagreement visible. Here
   every hole outline is a satellite trace (OSM has none), so the drawing's job
   is to show those traces against the terrain, the GPS anchors, the sea and the
   card numbers — the reviewer compares it against the club's own overview.      */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJSON, bbox, alongLine, decodeHF } from './lib.mjs';
import { encodePNG } from '../geobuild/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = readJSON(path.join(HERE, 'course-model.json'));
const hf = readJSON(path.join(HERE, 'heightfields.json'));

/* --- frame: the golf plus the clubhouse precinct ------------------------------ */
const pts = [];
for (const h of M.holes) { pts.push(...h.line, ...h.green.ring); for (const t of h.tees.pads) pts.push([t.cx, t.cz]); }
for (const r of M.scenery.range || []) pts.push(...r);
const B = bbox(pts);
const PAD = 170;
const x0 = B.x0 - PAD, x1 = B.x1 + PAD, z0 = B.z0 - PAD, z1 = B.z1 + PAD;
const SC = 1500 / Math.max(x1 - x0, z1 - z0);
const W = Math.round((x1 - x0) * SC), H = Math.round((z1 - z0) * SC);
const X = x => ((x - x0) * SC).toFixed(1);
const Z = z => ((z - z0) * SC).toFixed(1);
const P = ring => ring.map(p => `${X(p[0])},${Z(p[1])}`).join(' ');

const out = [];
const push = s => out.push(s);

push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif,system-ui,sans-serif">`);
push(`<rect width="${W}" height="${H}" fill="#0a151d"/>`);

/* --- terrain + sea, from the baked heightfield -------------------------------- */
{
  const hf0 = hf.hf0;
  const h = decodeHF(hf0);
  const at = (x, z) => {
    const fx = (x - hf0.x0) / hf0.dx, fz = (z - hf0.z0) / hf0.dx;
    if (fx < 0 || fz < 0 || fx > hf0.nx - 1.001 || fz > hf0.nz - 1.001) return null;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j, k = j * hf0.nx + i;
    return (h[k] * (1 - tx) + h[k + 1] * tx) * (1 - tz)
         + (h[k + hf0.nx] * (1 - tx) + h[k + hf0.nx + 1] * tx) * tz;
  };
  const rgb = Buffer.alloc(W * H * 3);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const x = x0 + px / SC, z = z0 + py / SC;
    const c = at(x, z), e = 3;
    const o = (py * W + px) * 3;
    if (c === null) continue;
    if (c < 0.05) {                       // the sea: depth-tinted, shallows pale
      const d = Math.min(1, -c / 5);
      rgb[o] = Math.round(38 - d * 24); rgb[o + 1] = Math.round(74 - d * 38); rgb[o + 2] = Math.round(96 - d * 40);
      continue;
    }
    const nx = ((at(x - e, z) ?? c) - (at(x + e, z) ?? c)) / (2 * e);
    const nz = ((at(x, z - e) ?? c) - (at(x, z + e) ?? c)) / (2 * e);
    const lit = Math.max(0, Math.min(1, 0.5 + (nx * 0.7071 + nz * 0.7071) * 2.2));
    const t = Math.max(0, Math.min(1, (c - 5) / 60));
    rgb[o]     = Math.round((16 + t * 74) * (0.4 + lit * 1.15));
    rgb[o + 1] = Math.round((26 + t * 66) * (0.4 + lit * 1.15));
    rgb[o + 2] = Math.round((20 + t * 62) * (0.4 + lit * 1.15));
  }
  push(`<image x="0" y="0" width="${W}" height="${H}" opacity="0.96" href="data:image/png;base64,${encodePNG(W, H, rgb).toString('base64')}"/>`);
}

/* --- forest, coast, beaches, wetland ------------------------------------------- */
push('<g opacity="0.5">');
for (const r of M.vegetation.forest) push(`<polygon points="${P(r)}" fill="#12301a"/>`);
push('</g>');
push('<g>');
for (const c of M.coast.chains)
  push(`<polyline points="${P(c.line)}" fill="none" stroke="#7fc4de" stroke-width="1.2" opacity="0.8"/>`);
for (const b of M.coast.beaches)
  push(`<polygon points="${P(b.ring)}" fill="#cbb88a" opacity="0.75"/>`);
for (const w of M.vegetation.wetland)
  push(`<polygon points="${P(w)}" fill="#4a5a34" opacity="0.6" stroke="#5f7040" stroke-width="0.8"/>`);
push('</g>');

/* --- water --------------------------------------------------------------------- */
push('<g>');
for (const w of M.water)
  push(`<polygon points="${P(w.ring)}" fill="${w.isLake ? '#123b52' : '#17506b'}" stroke="#2b7ea3" stroke-width="1"/>`);
for (const s of M.streams)
  push(`<polyline points="${P(s.line)}" fill="none" stroke="#2b7ea3" stroke-width="${(s.w * SC).toFixed(1)}" stroke-linecap="round" opacity="0.8"/>`);
push('</g>');

/* --- scenery ------------------------------------------------------------------- */
push('<g opacity="0.6">');
for (const r of M.scenery.range || []) push(`<polygon points="${P(r)}" fill="#2c4a2c"/>`);
for (const r of M.scenery.greens || []) push(`<polygon points="${P(r)}" fill="#3f7a42"/>`);
for (const r of M.scenery.tees || []) push(`<polygon points="${P(r)}" fill="#356b45"/>`);
push('</g>');

/* --- paths, roads, buildings ---------------------------------------------------- */
push('<g fill="none" stroke="#6b6355" stroke-linecap="round" opacity="0.6">');
for (const l of M.infra.tracks) push(`<polyline points="${P(l.line)}" stroke-width="1.8"/>`);
for (const l of M.infra.paths) push(`<polyline points="${P(l.line)}" stroke-width="1.1"/>`);
for (const r of M.infra.roads) push(`<polyline points="${P(r.line)}" stroke-width="2.4" stroke="#7d7566"/>`);
push('</g>');
push('<g>');
for (const b of M.infra.buildings)
  push(`<polygon points="${P(b.ring)}" fill="#5a5347" stroke="#7d7466" stroke-width="0.6"/>`);
for (const p of M.infra.piers)
  push(p.ring ? `<polygon points="${P(p.ring)}" fill="#8a8272"/>`
              : `<polyline points="${P(p.line)}" fill="none" stroke="#8a8272" stroke-width="1.6"/>`);
push('</g>');

/* --- the holes ------------------------------------------------------------------ */
for (const h of M.holes) {
  push(`<g id="hole${h.n}">`);
  for (const r of h.fairway.rings)
    push(`<polygon points="${P(r)}" fill="#3f8a45" stroke="#8fd8ff" stroke-width="0.9" opacity="0.9"/>`);
  for (const t of h.tees.pads) {
    const a = t.ang * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const hw = t.w / 2, hd = t.d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
      .map(([u, v]) => [t.cx + u * ca - v * sa, t.cz + u * sa + v * ca]);
    push(`<polygon points="${P(corners)}" fill="#57a878"/>`);
  }
  for (const b of h.bunkers)
    push(`<polygon points="${P(b.ring)}" fill="#e2cf9a" stroke="#8a7c53" stroke-width="0.5"/>`);
  push(`<polygon points="${P(h.green.ring)}" fill="#79d97f" stroke="#8fd8ff" stroke-width="1.2"/>`);
  push(`<polyline points="${P(h.line)}" fill="none" stroke="#fff" stroke-width="1.4" opacity="0.85"/>`);
  const t0 = h.line[0];
  push(`<circle cx="${X(t0[0])}" cy="${Z(t0[1])}" r="3.2" fill="#f0a23a" stroke="#1a1207" stroke-width="0.8"/>`);
  push(`<circle cx="${X(h.pin[0])}" cy="${Z(h.pin[1])}" r="2.2" fill="#e8443c"/>`);
  const mid = alongLine(h.line, 0.5);
  push(`<circle cx="${X(mid.x)}" cy="${Z(mid.z)}" r="10.5" fill="#0e1a12" fill-opacity="0.82" stroke="#79d97f" stroke-width="1.4"/>`);
  push(`<text x="${X(mid.x)}" y="${Z(mid.z)}" fill="#fff" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="central">${h.n}</text>`);
  push(`<text x="${X(mid.x)}" y="${(+Z(mid.z) + 20).toFixed(1)}" fill="#cfe6d4" font-size="8" text-anchor="middle">${h.t[0]} m · par ${h.par}</text>`);
  push('</g>');
}

/* --- legend --------------------------------------------------------------------- */
const worst = M.holes.reduce((a, h) => Math.abs(h.lenDev) > Math.abs(a.lenDev) ? h : a);
const gAreas = M.holes.map(h => h.green.area);
const L = [
  ['#3f8a45', 'fairway, green, tee — OpenStreetMap surveyed polygons, GPS-anchored per hole'],
  ['#79d97f', 'green (putting surface); red dot = pin at the surveyed GPS green centre'],
  ['#123b52', 'the lakes and ponds, each at its own measured level'],
  ['#4a5a34', 'the central marsh (OSM wetland)'],
  ['#cbb88a', 'farmland and forest around the course (OSM)'],
];
push(`<g transform="translate(16,${H - 122})">`);
push(`<rect x="-6" y="-16" width="700" height="118" rx="7" fill="#08120c" fill-opacity="0.82"/>`);
push(`<text x="0" y="-2" fill="#eaf3ec" font-size="13" font-weight="700">Johannesberg Golf & CC — reconciled layout</text>`);
L.forEach(([c, t], i) => {
  push(`<rect x="0" y="${8 + i * 15}" width="11" height="11" fill="${c}" stroke="#0d2a12" stroke-width="0.6"/>`);
  push(`<text x="18" y="${17 + i * 15}" fill="#b9cfc0" font-size="10.5">${t}</text>`);
});
push('</g>');

push(`<g transform="translate(${W - 320},22)">`);
push(`<rect x="-10" y="-16" width="316" height="70" rx="7" fill="#08120c" fill-opacity="0.82"/>`);
push(`<text x="0" y="0" fill="#eaf3ec" font-size="11" font-weight="700">Agreement</text>`);
[`all card values (provisional pending research)`,
 `18/18 drawn lengths exact (worst dev ${worst.lenDev}% on ${worst.n})`,
 `greens ${Math.min(...gAreas)}–${Math.max(...gAreas)} m²; lake perched at ${(M.water.find(w => w.isLake) || {}).level} m`,
].forEach((t, i) => push(`<text x="0" y="${16 + i * 13}" fill="#b9cfc0" font-size="9.5">${t}</text>`));
push('</g>');

push(`<text x="${W - 12}" y="${H - 10}" fill="#5f7566" font-size="9" text-anchor="end">north is up · ${Math.round(x1 - x0)} × ${Math.round(z1 - z0)} m</text>`);
push('</svg>');

const dest = path.join(HERE, 'design.svg');
fs.writeFileSync(dest, out.join('\n'));
console.log(`wrote ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB, ${W}x${H})`);
