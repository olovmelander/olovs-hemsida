/* THE REALISTIC CATALOGUE'S LEAF ATLASES (treeset v2, 3 November; owner request:
   trees as realistic as the new grass). One 1024 px atlas a species, four 512 px
   sprigs in a 2 x 2 grid, drawn here from leaf outlines rather than painted blobs:

   - birch: small ovate leaves with a drawn-out tip and a fine double serration,
     alternate on thin hanging twigs;
   - oak: lobed obovate leaves on short stalks, crowded at the shoot's end;
   - alder: rounded obovate leaves with a notched tip, alternate;
   - pine: tufts of long paired needles round each shoot's end, the pads a Scots
     pine's crown is made of;
   - spruce: flat sprays, a twig and its side shoots combed with short needles.

   Colours are NEAR-NEUTRAL (each leaf a lightness and a warm/cool shift round
   a mean of `MEAN`): the species' painted palette (painted-world-palette.mjs)
   still gives each tree its green and its autumn, and the material multiplies
   this variation in (ghibli-foliage-material.mjs, `realistic`). Each leaf is lit
   as folded along its midrib, its midrib and side veins paler, its stalk and
   the twig brown. Drawn three times over and box-filtered, so the alpha's edge
   is anti-aliased; the colour is bled into the clear texels round every leaf so
   the mipmaps do not darken the edges (the material reads straight alpha).

   node tools/blender-tree-study/realistic/make_leaf_atlas.mjs <outdir>
   writes <outdir>/<species>.png and atlas.json (sha256, bytes, mean). Seeded: the
   same bytes every run. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';

export const ATLAS = Object.freeze({ size: 1024, cells: 2, supersample: 3, mean: 0.8 });
const MEAN = ATLAS.mean;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* a cell's canvas at the supersampled size: straight colour and coverage */
function canvas(n) { return { n, rgb: new Float32Array(n * n * 3), a: new Float32Array(n * n) }; }
function put(c, x, y, r, g, b, alpha) {
  if (x < 0 || y < 0 || x >= c.n || y >= c.n || alpha <= 0) return;
  const i = y * c.n + x, k = i * 3, a0 = c.a[i], a = Math.min(1, alpha);
  /* over: the new texel in front of what is there */
  const out = a + a0 * (1 - a);
  if (out <= 0) return;
  c.rgb[k] = (r * a + c.rgb[k] * a0 * (1 - a)) / out;
  c.rgb[k + 1] = (g * a + c.rgb[k + 1] * a0 * (1 - a)) / out;
  c.rgb[k + 2] = (b * a + c.rgb[k + 2] * a0 * (1 - a)) / out;
  c.a[i] = out;
}

/* a line of width w (pixels), its colour by t along it */
function stroke(c, x0, y0, x1, y1, w0, w1, colourAt) {
  const minx = Math.floor(Math.min(x0, x1) - Math.max(w0, w1) - 1), maxx = Math.ceil(Math.max(x0, x1) + Math.max(w0, w1) + 1);
  const miny = Math.floor(Math.min(y0, y1) - Math.max(w0, w1) - 1), maxy = Math.ceil(Math.max(y0, y1) + Math.max(w0, w1) + 1);
  const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
  for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2));
    const px = x0 + dx * t, py = y0 + dy * t, d = Math.hypot(x - px, y - py), w = (w0 + (w1 - w0) * t) / 2;
    if (d > w + 0.5) continue;
    const [r, g, b] = colourAt(t);
    put(c, x, y, r, g, b, Math.min(1, w + 0.5 - d));
  }
}

/* a leaf: base at (x, y), pointing along angle `ang`, `len` long; `profile(u)` its half-width share (0..1) at u along
   the midrib and `edge(u, side)` its margin's cut; lit as folded along the midrib */
function leaf(c, x, y, ang, len, width, profile, edge, tone, rnd) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const half = len * width;
  const R = Math.ceil(len + half + 2);
  const light = 0.88 + rnd() * 0.26, warm = (rnd() - 0.5) * 2;
  const fold = 0.012 + rnd() * 0.025, sunSide = rnd() < 0.5 ? 1 : -1;
  const veins = 5 + Math.floor(rnd() * 4), veinAngle = 0.55 + rnd() * 0.2;
  for (let py = Math.floor(y - R); py <= y + R; py++) for (let px = Math.floor(x - R); px <= x + R; px++) {
    const lx = px - x, ly = py - y;
    const u = (lx * ca + ly * sa) / len, v = (-lx * sa + ly * ca) / half;
    if (u < 0 || u > 1) continue;
    const w = profile(u) * edge(u, v > 0 ? 1 : -1);
    const av = Math.abs(v);
    if (av > w) continue;
    /* coverage across the margin, a pixel wide */
    const cover = Math.min(1, (w - av) * half + 0.5);
    let k = light * (v * sunSide > 0 ? 1 + fold : 1 - fold);
    /* the blade darker toward its margin and its base, as a leaf's thickness and its shade on itself read */
    k *= 0.94 + 0.08 * (1 - av / Math.max(w, 1e-3)) - 0.06 * (1 - u) * (1 - u);
    /* the midrib and the side veins, paler */
    const rib = av * half < Math.max(0.8, len * 0.012) ? 0.08 : 0;
    const along = u - av * veinAngle;
    const side = av > 0.08 && Math.abs(((along * veins) % 1 + 1) % 1 - 0.5) > 0.47 ? 0.03 : 0;
    k *= 1 + rib + side;
    put(c, px, py, MEAN * k * tone[0] * (1 + 0.05 * warm), MEAN * k * tone[1], MEAN * k * tone[2] * (1 - 0.09 * warm), cover);
  }
}

const TWIG = [0.62, 0.5, 0.38], NEEDLE = [0.98, 1.02, 0.97];
const twigColour = (k = 1) => () => [MEAN * TWIG[0] * k, MEAN * TWIG[1] * k, MEAN * TWIG[2] * k];

/* broadleaf shapes: profile and margin */
const SHAPES = {
  björk: { len: [82, 112], width: 0.64, leaves: [70, 80], profile: u => Math.pow(Math.sin(Math.PI * Math.pow(u, 0.75)), 0.9) * (u < 0.25 ? 0.85 + u * 0.6 : 1),
    edge: (u) => 1 - 0.09 * Math.abs(Math.sin(u * 46)) - 0.05 * Math.abs(Math.sin(u * 23)), stalk: 0.35, hang: 0.9 },
  ek: { len: [108, 146], width: 0.5, leaves: [52, 60], profile: u => Math.pow(Math.sin(Math.PI * Math.pow(u, 1.25)), 0.7) * (0.45 + 0.55 * u),
    edge: (u, s) => 0.58 + 0.42 * Math.pow(Math.abs(Math.sin(u * Math.PI * 4.5 + (s > 0 ? 0.6 : 0))), 0.55), stalk: 0.08, hang: 0.25 },
  al: { len: [92, 122], width: 0.74, leaves: [54, 62], profile: u => Math.pow(Math.sin(Math.PI * Math.pow(u, 1.15)), 0.62) * (u > 0.93 ? 1 - (u - 0.93) * 4 : 1),
    edge: (u) => 1 - 0.05 * Math.abs(Math.sin(u * 34)), stalk: 0.25, hang: 0.45 },
};

function broadleafSprig(c, key, rnd) {
  const S = SHAPES[key], n = c.n, k = n / 512;
  /* the twig: from the cell's lower edge up through it, bending; side twigs off it */
  const baseX = n * (0.42 + rnd() * 0.16), baseY = n * 0.98;
  const twigs = [];
  const main = [];
  let x = baseX, y = baseY, ang = -Math.PI / 2 + (rnd() - 0.5) * 0.5;
  for (let i = 0; i < 14; i++) {
    const nx = x + Math.cos(ang) * n * 0.054, ny = y + Math.sin(ang) * n * 0.054;
    main.push([x, y, nx, ny, (1 - i / 14)]);
    x = nx; y = ny; ang += (rnd() - 0.5) * 0.35;
  }
  twigs.push(main);
  for (let s = 0; s < 5; s++) {
    const at = main[2 + Math.floor(rnd() * 8)], side = s % 2 ? 1 : -1;
    let sx = at[2], sy = at[3], sa = -Math.PI / 2 + side * (0.55 + rnd() * 0.5);
    const seg = [];
    for (let i = 0; i < 6; i++) { const nx = sx + Math.cos(sa) * n * 0.05, ny = sy + Math.sin(sa) * n * 0.05; seg.push([sx, sy, nx, ny, 0.6 * (1 - i / 6)]); sx = nx; sy = ny; sa += side * 0.12 + (rnd() - 0.5) * 0.3; }
    twigs.push(seg);
  }
  for (const t of twigs) for (const [x0, y0, x1, y1, w] of t) stroke(c, x0, y0, x1, y1, (2.2 + w * 3) * k, (2 + w * 2.6) * k, twigColour(0.9));
  /* leaves along every twig, alternate, the shoot's end crowded */
  const all = twigs.flat();
  const count = S.leaves[0] + Math.floor(rnd() * (S.leaves[1] - S.leaves[0]));
  for (let i = 0; i < count; i++) {
    const seg = all[Math.floor(Math.pow(rnd(), key === 'ek' ? 0.55 : 0.9) * all.length) % all.length];
    const t = rnd(), px = seg[0] + (seg[2] - seg[0]) * t, py = seg[1] + (seg[3] - seg[1]) * t;
    const segAng = Math.atan2(seg[3] - seg[1], seg[2] - seg[0]);
    const side = i % 2 ? 1 : -1;
    /* leaves turn out from the twig and droop by the species' hang */
    let la = segAng + side * (0.6 + rnd() * 0.9);
    la += (Math.PI / 2 - la) * S.hang * rnd() * 0.5;
    const len = (S.len[0] + rnd() * (S.len[1] - S.len[0])) * k;
    const stalk = len * S.stalk * (0.6 + rnd() * 0.6);
    const lx = px + Math.cos(la) * stalk, ly = py + Math.sin(la) * stalk;
    /* the whole blade inside its cell: a leaf cut by the cell's edge would draw a straight line in the crown */
    const tx = lx + Math.cos(la) * len, ty = ly + Math.sin(la) * len, pad = len * S.width + 3 * k;
    if ([lx, tx].some(v => v < pad || v > n - pad) || [ly, ty].some(v => v < pad || v > n - pad)) continue;
    if (stalk > 1) stroke(c, px, py, lx, ly, 1.6 * k, 1.2 * k, twigColour(1.05));
    leaf(c, lx, ly, la + (rnd() - 0.5) * 0.3, len, S.width, S.profile, S.edge, [1, 1, 1], rnd);
  }
}

/* pine: shoots radiating from the cell's centre, each a brush of paired needles round its end */
function pineSprig(c, rnd) {
  const n = c.n, k = n / 512, cx = n * 0.5, cy = n * 0.55;
  const shoots = 10 + Math.floor(rnd() * 3);
  for (let s = 0; s < shoots; s++) {
    const a = -Math.PI / 2 + (s / (shoots - 1) - 0.5) * 2.6 + (rnd() - 0.5) * 0.3;
    const L = n * (0.2 + rnd() * 0.12);
    const ex = cx + Math.cos(a) * L, ey = cy + Math.sin(a) * L;
    stroke(c, cx, cy + n * 0.08, ex, ey, 5 * k, 3 * k, twigColour(0.95));
    /* needles: from along the shoot's outer half, swept forward */
    const needles = 220 + Math.floor(rnd() * 40);
    for (let i = 0; i < needles; i++) {
      const t = 0.35 + 0.65 * Math.pow(rnd(), 0.7);
      const px = cx + (ex - cx) * t, py = cy + n * 0.08 * (1 - t) + (ey - cy - n * 0.08 * (1 - t)) * t;
      const na = a + (rnd() - 0.5) * 1.9 * (0.45 + 0.55 * t);
      const nl = n * (0.11 + rnd() * 0.07);
      const tone = 0.86 + rnd() * 0.3;
      stroke(c, px, py, px + Math.cos(na) * nl, py + Math.sin(na) * nl, 4.4 * k, 2.0 * k,
        u => [MEAN * NEEDLE[0] * tone * (0.92 + 0.12 * u), MEAN * NEEDLE[1] * tone * (0.92 + 0.12 * u), MEAN * NEEDLE[2] * tone * (0.9 + 0.1 * u)]);
    }
  }
}

/* spruce: a flat spray -- the twig down the cell's long axis, side shoots at a slant, all combed with short needles */
function spruceSprig(c, rnd) {
  const n = c.n, k = n / 512;
  const axis = [];
  let x = n * 0.5, y = n * 0.97, ang = -Math.PI / 2 + (rnd() - 0.5) * 0.15;
  for (let i = 0; i < 12; i++) { const nx = x + Math.cos(ang) * n * 0.075, ny = y + Math.sin(ang) * n * 0.075; axis.push([x, y, nx, ny, 1 - i / 12]); x = nx; y = ny; ang += (rnd() - 0.5) * 0.12; }
  const twigs = [axis];
  for (let i = 1; i < axis.length - 1; i++) for (const side of [-1, 1]) {
    if (rnd() < 0.15) continue;
    const [, , ax, ay] = axis[i], len = n * (0.1 + 0.3 * Math.sin(Math.PI * (i / axis.length)) * (0.7 + rnd() * 0.5));
    let sa = -Math.PI / 2 + side * (0.95 + rnd() * 0.3), sx = ax, sy = ay; const seg = [];
    for (let j = 0; j < 4; j++) { const nx = sx + Math.cos(sa) * len / 4, ny = sy + Math.sin(sa) * len / 4; seg.push([sx, sy, nx, ny, 0.5 * (1 - j / 4)]); sx = nx; sy = ny; sa -= side * 0.08; }
    twigs.push(seg);
  }
  for (const t of twigs) for (const [x0, y0, x1, y1, w] of t) stroke(c, x0, y0, x1, y1, (2 + w * 4) * k, (1.6 + w * 3.4) * k, twigColour(0.85));
  for (const t of twigs) for (const [x0, y0, x1, y1] of t) {
    const L = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0), count = Math.ceil(L / (2.2 * k));
    for (let i = 0; i < count; i++) for (const side of [-1, 1]) {
      const t0 = (i + rnd() * 0.5) / count, px = x0 + (x1 - x0) * t0, py = y0 + (y1 - y0) * t0;
      const na = a + side * (0.75 + rnd() * 0.5), nl = (16 + rnd() * 9) * k, tone = 0.84 + rnd() * 0.28;
      stroke(c, px, py, px + Math.cos(na) * nl, py + Math.sin(na) * nl, 2.9 * k, 1.5 * k,
        u => [MEAN * NEEDLE[0] * tone * (0.9 + 0.14 * u), MEAN * NEEDLE[1] * tone * (0.9 + 0.14 * u), MEAN * NEEDLE[2] * tone * (0.88 + 0.12 * u)]);
    }
  }
}

/* box-filter the supersampled cell down, colour weighted by coverage */
function resolve(c, s) {
  const m = c.n / s, rgb = new Float32Array(m * m * 3), a = new Float32Array(m * m);
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
    let r = 0, g = 0, b = 0, w = 0;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const p = (y * s + j) * c.n + x * s + i, al = c.a[p];
      r += c.rgb[p * 3] * al; g += c.rgb[p * 3 + 1] * al; b += c.rgb[p * 3 + 2] * al; w += al;
    }
    const q = y * m + x;
    a[q] = w / (s * s);
    if (w > 0) { rgb[q * 3] = r / w; rgb[q * 3 + 1] = g / w; rgb[q * 3 + 2] = b / w; }
  }
  return { m, rgb, a };
}

/* bleed colour into the clear texels: a few passes of the covered neighbours' mean, then the cell's own mean */
function bleed(cell) {
  const { m, rgb, a } = cell, have = new Uint8Array(m * m);
  let mean = [0, 0, 0], wsum = 0;
  for (let i = 0; i < m * m; i++) if (a[i] > 0.02) { have[i] = 1; for (let k = 0; k < 3; k++) mean[k] += rgb[i * 3 + k] * a[i]; wsum += a[i]; }
  mean = mean.map(v => v / Math.max(wsum, 1e-6));
  for (let pass = 0; pass < 24; pass++) {
    const next = have.slice(), out = rgb.slice();
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const i = y * m + x; if (have[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= m || yy >= m) continue;
        const j = yy * m + xx; if (!have[j]) continue;
        r += rgb[j * 3]; g += rgb[j * 3 + 1]; b += rgb[j * 3 + 2]; n++;
      }
      if (n) { out[i * 3] = r / n; out[i * 3 + 1] = g / n; out[i * 3 + 2] = b / n; next[i] = 1; }
    }
    rgb.set(out); have.set(next);
  }
  for (let i = 0; i < m * m; i++) if (!have[i]) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = mean[k];
  return mean;
}

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
export function encodeRGBA(w, h, px) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.subarray(y * w * 4, (y + 1) * w * 4).forEach((v, i) => { raw[y * (w * 4 + 1) + 1 + i] = v; }); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export const SPECIES_SEEDS = Object.freeze({ björk: 3101, ek: 3203, al: 3307, tall: 3409, gran: 3511 });
const toSrgb = v => { v = Math.max(0, Math.min(1, v)); return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255); };

export function makeAtlas(key) {
  const { size, cells, supersample: s } = ATLAS, cellPx = size / cells;
  const px = new Uint8Array(size * size * 4);
  const rnd = rng(SPECIES_SEEDS[key]);
  const means = [];
  for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
    const c = canvas(cellPx * s);
    if (key === 'tall') pineSprig(c, rnd); else if (key === 'gran') spruceSprig(c, rnd); else broadleafSprig(c, key, rnd);
    const cell = resolve(c, s);
    means.push(bleed(cell));
    for (let y = 0; y < cellPx; y++) for (let x = 0; x < cellPx; x++) {
      const q = y * cellPx + x, o = ((cy * cellPx + y) * size + cx * cellPx + x) * 4;
      /* linear colour stored as sRGB (the atlas is read as an sRGB texture) */
      px[o] = toSrgb(cell.rgb[q * 3]); px[o + 1] = toSrgb(cell.rgb[q * 3 + 1]); px[o + 2] = toSrgb(cell.rgb[q * 3 + 2]);
      px[o + 3] = Math.round(Math.min(1, cell.a[q]) * 255);
    }
  }
  /* coverage of each cell: the share of its texels a leaf covers */
  return { png: encodeRGBA(size, size, px), mean: means.reduce((a, m) => a.map((v, i) => v + m[i] / means.length), [0, 0, 0]) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const out = path.resolve(process.argv[2] ?? 'tools/blender-tree-study/realistic/out');
  fs.mkdirSync(out, { recursive: true });
  const record = {};
  for (const key of Object.keys(SPECIES_SEEDS)) {
    const { png, mean } = makeAtlas(key);
    fs.writeFileSync(path.join(out, `${key}.png`), png);
    record[key] = { bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), mean: mean.map(v => +v.toFixed(4)) };
    console.log(key, record[key]);
  }
  fs.writeFileSync(path.join(out, 'atlas.json'), JSON.stringify({ atlas: ATLAS, species: record }, null, 2));
}
