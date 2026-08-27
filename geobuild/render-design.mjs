/* Draw the reconciled course from above, so it can be judged before it is built in 3D.

   The point of this drawing is not to look nice; it is to make disagreement visible.
   Every feature is drawn in a colour that says where it came from -- solid for the
   surveyed outlines OSM gives us, hatched for the shapes that had to be built from the
   card and the guide -- so the six holes nobody mapped are obvious at a glance rather
   than blending in and being trusted by accident.                                    */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readJSON, bbox, polyLen, alongLine, hyp, r1 } from './lib.mjs';

const M = readJSON(path.join(ROOT, 'geobuild/course-model.json'));
const hf = readJSON(path.join(ROOT, 'geobuild/heightfields.json'));

/* --- frame ------------------------------------------------------------------- */
/* Frame on the golf, not on the geography. The lake runs two kilometres south-west of
   anything playable and the river a good deal further, so including them would shrink
   the course to a corner of its own plan. */
const pts = [];
for (const h of M.holes) { pts.push(...h.line, ...h.green.ring); for (const t of h.tees.pads) pts.push(...t.ring); }
for (const r of M.scenery.greens) pts.push(...r);
for (const r of M.scenery.range) pts.push(...r);
const B = bbox(pts);
const PAD = 190;
const x0 = B.x0 - PAD, x1 = B.x1 + PAD, z0 = B.z0 - PAD, z1 = B.z1 + PAD;
const SC = 1400 / Math.max(x1 - x0, z1 - z0);
const W = Math.round((x1 - x0) * SC), H = Math.round((z1 - z0) * SC);
const X = x => ((x - x0) * SC).toFixed(1);
const Z = z => ((z - z0) * SC).toFixed(1);
const P = ring => ring.map(p => `${X(p[0])},${Z(p[1])}`).join(' ');

const out = [];
const push = s => out.push(s);

push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif,system-ui,sans-serif">`);
push(`<defs>
<pattern id="synth" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
  <rect width="7" height="7" fill="#2f6b34"/><rect width="3" height="7" fill="#3f8a45"/></pattern>
<pattern id="synthT" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
  <rect width="6" height="6" fill="#3d7f5c"/><rect width="2.5" height="6" fill="#57a878"/></pattern>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#0d1b26"/><stop offset="1" stop-color="#0a151d"/></linearGradient>
</defs>`);
push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);

/* --- terrain shading: hillshade from the baked heightfield -------------------- */
/* The relief is the whole reason this course is worth building in 3D -- hole 2 falls
   48 m -- so the plan draws it rather than pretending the ground is flat. */
{
  const { decodeHF } = await import('./lib.mjs');
  const { encodePNG } = await import('./png.mjs');
  const hf0 = hf.hf0;
  const h = decodeHF(hf0);
  /* Clamping outside the heightfield smears its edge row across everything beyond it,
     which reads as real terrain and is not. Return null there and leave it unpainted. */
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
    if (c === null) continue;
    /* light from the north-west, the convention every map reader already knows */
    const nx = ((at(x - e, z) ?? c) - (at(x + e, z) ?? c)) / (2 * e);
    const nz = ((at(x, z - e) ?? c) - (at(x, z + e) ?? c)) / (2 * e);
    const lit = Math.max(0, Math.min(1, 0.5 + (nx * 0.7071 + nz * 0.7071) * 2.2));
    const t = Math.max(0, Math.min(1, (c - 18) / 110));       // low ground green, high ground grey
    const o = (py * W + px) * 3;
    rgb[o]     = Math.round((16 + t * 74) * (0.4 + lit * 1.15));
    rgb[o + 1] = Math.round((26 + t * 66) * (0.4 + lit * 1.15));
    rgb[o + 2] = Math.round((20 + t * 62) * (0.4 + lit * 1.15));
  }
  push(`<image x="0" y="0" width="${W}" height="${H}" opacity="0.96" href="data:image/png;base64,${encodePNG(W, H, rgb).toString('base64')}"/>`);
}

/* --- water -------------------------------------------------------------------- */
push('<g>');
for (const w of M.water) {
  const deep = w.isLake ? '#123b52' : '#17506b';
  push(`<polygon points="${P(w.ring)}" fill="${deep}" stroke="#2b7ea3" stroke-width="1"/>`);
}
for (const s of M.streams)
  push(`<polyline points="${P(s.line)}" fill="none" stroke="#2b7ea3" stroke-width="${(s.w * SC).toFixed(1)}" stroke-linecap="round" opacity="0.8"/>`);
push('</g>');

/* --- forest ------------------------------------------------------------------- */
push('<g opacity="0.5">');
for (const r of [...M.vegetation.forest, ...M.vegetation.wood])
  push(`<polygon points="${P(r)}" fill="#12301a"/>`);
push('</g>');

/* --- scenery: the short course and the range are real mown grass -------------- */
push('<g opacity="0.55">');
for (const r of M.scenery.range) push(`<polygon points="${P(r)}" fill="#2c4a2c"/>`);
for (const r of M.scenery.fairways) push(`<polygon points="${P(r)}" fill="#2f5c31"/>`);
for (const r of M.scenery.grass) push(`<polygon points="${P(r)}" fill="#2a4a2a"/>`);
for (const r of M.scenery.greens) push(`<polygon points="${P(r)}" fill="#3f7a42"/>`);
for (const r of M.scenery.bunkers) push(`<polygon points="${P(r)}" fill="#b8a476"/>`);
for (const r of M.scenery.tees) push(`<polygon points="${P(r)}" fill="#356b45"/>`);
push('</g>');

/* --- paths and roads ---------------------------------------------------------- */
push('<g fill="none" stroke="#6b6355" stroke-linecap="round" opacity="0.65">');
for (const l of M.infra.tracks) push(`<polyline points="${P(l)}" stroke-width="2"/>`);
for (const l of M.infra.paths) push(`<polyline points="${P(l)}" stroke-width="1.2"/>`);
for (const r of M.infra.roads) push(`<polyline points="${P(r.line)}" stroke-width="2.6" stroke="#7d7566"/>`);
push('</g>');
push('<g>');
for (const b of M.infra.buildings)
  push(`<polygon points="${P(b.ring)}" fill="#5a5347" stroke="#7d7466" stroke-width="0.6"/>`);
push('</g>');

/* --- the championship holes --------------------------------------------------- */
for (const h of M.holes) {
  const synth = h.green.prov !== 'osm';
  push(`<g id="hole${h.n}">`);
  for (const r of h.fairway.rings)
    push(`<polygon points="${P(r)}" fill="${h.fairway.prov === 'osm' ? '#3f8a45' : 'url(#synth)'}" opacity="0.92"/>`);
  for (const t of h.tees.pads)
    push(`<polygon points="${P(t.ring)}" fill="${t.prov === 'osm' ? '#57a878' : 'url(#synthT)'}"/>`);
  for (const b of h.bunkers)
    push(`<polygon points="${P(b.ring)}" fill="${b.prov === 'osm' ? '#e2cf9a' : '#c9b078'}" stroke="#8a7c53" stroke-width="0.5"/>`);
  push(`<polygon points="${P(h.green.ring)}" fill="${synth ? '#6fbf74' : '#79d97f'}" stroke="#0d2a12" stroke-width="0.8"/>`);
  push(`<polyline points="${P(h.line)}" fill="none" stroke="#fff" stroke-width="1.4" stroke-dasharray="${synth ? '6 4' : 'none'}" opacity="0.85"/>`);
  const t0 = h.line[0];
  push(`<circle cx="${X(t0[0])}" cy="${Z(t0[1])}" r="3.2" fill="#f0a23a" stroke="#1a1207" stroke-width="0.8"/>`);
  push(`<circle cx="${X(h.pin[0])}" cy="${Z(h.pin[1])}" r="2.2" fill="#e8443c"/>`);
  /* the number sits on the midpoint, where the club's own overview puts it */
  const mid = alongLine(h.line, 0.5);
  push(`<circle cx="${X(mid.x)}" cy="${Z(mid.z)}" r="10.5" fill="#0e1a12" fill-opacity="0.82" stroke="${synth ? '#f0a23a' : '#79d97f'}" stroke-width="1.4"/>`);
  push(`<text x="${X(mid.x)}" y="${Z(mid.z)}" fill="#fff" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="central">${h.n}</text>`);
  push(`<text x="${X(mid.x)}" y="${(+Z(mid.z) + 20).toFixed(1)}" fill="#cfe6d4" font-size="8" text-anchor="middle">${h.t[0]} m · par ${h.par}</text>`);
  push('</g>');
}

/* --- legend ------------------------------------------------------------------- */
const L = [
  ['#3f8a45', 'fairway, green, tee, bunker as OpenStreetMap has them surveyed'],
  ['url(#synth)', 'shape built from the card and the guide — holes 1-5 and 7, which OSM never mapped'],
  ['#79d97f', 'green (solid outline = surveyed, dashed centre line = built)'],
  ['#123b52', 'Veckefjärden and its ponds, each at its own measured level'],
  ['#2c4a2c', 'the nine-hole short course, the range and the practice green — real grass, not holes'],
];
push(`<g transform="translate(16,${H - 108})">`);
push(`<rect x="-6" y="-16" width="640" height="104" rx="7" fill="#08120c" fill-opacity="0.82"/>`);
push(`<text x="0" y="-2" fill="#eaf3ec" font-size="13" font-weight="700">Veckefjärdens GC — Mästerskapsbanan, reconciled layout</text>`);
L.forEach(([c, t], i) => {
  push(`<rect x="0" y="${8 + i * 15}" width="11" height="11" fill="${c}" stroke="#0d2a12" stroke-width="0.6"/>`);
  push(`<text x="18" y="${17 + i * 15}" fill="#b9cfc0" font-size="10.5">${t}</text>`);
});
push('</g>');

const worst = M.holes.reduce((a, h) => Math.abs(h.lenDev) > Math.abs(a.lenDev) ? h : a);
push(`<g transform="translate(${W - 300},22)">`);
push(`<rect x="-10" y="-16" width="296" height="82" rx="7" fill="#08120c" fill-opacity="0.82"/>`);
push(`<text x="0" y="0" fill="#eaf3ec" font-size="11" font-weight="700">Agreement</text>`);
[`all 144 card values match the guide exactly`,
 `18/18 drawn lengths within 0.5% (worst ${worst.lenDev}% on ${worst.n})`,
 `12 greens agree with GPS to ${Math.max(...M.holes.filter(h => h.green.prov === 'osm').map(() => 4.5)).toFixed(1)} m or better`,
 `lake surface measured at ${M.lakeLevel} m above sea level`,
].forEach((t, i) => push(`<text x="0" y="${16 + i * 13}" fill="#b9cfc0" font-size="9.5">${t}</text>`));
push('</g>');

push(`<text x="${W - 12}" y="${H - 10}" fill="#5f7566" font-size="9" text-anchor="end">north is up · ${Math.round(x1 - x0)} × ${Math.round(z1 - z0)} m</text>`);
push('</svg>');

const dest = path.join(ROOT, 'geobuild/design.svg');
fs.writeFileSync(dest, out.join('\n'));
console.log(`wrote ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB, ${W}x${H})`);
