/* The club's own hole plans (Caddee, published on tortunagk.se/spela-golf/banan),
   read in plain Node: loaded from the ignored reference cache and held to the
   sha256 pinned in reference/source-assets.json (fetched from the pinned public
   URL when the cache lacks them), their drawn features found by colour, and
   registered onto the measured course.

   The plans are illustrations, not orthophotography, so nothing here trusts a
   plan's geometry on its own: a plan is placed by a similarity transform fitted
   to features the model has MEASURED -- its green (traced on the 2026
   orthophoto and a plateau on the laser), its bunkers (27 of 32 over a laser
   dish), and more weakly its tee platforms -- and every residual is reported.
   What a plan contributes is the one thing no image of this course can: which
   of the mown ground is FAIRWAY. The only 2026 capture is an early-May flight
   in which fairway, semi and mown rough are the same living turf (README,
   "The 2026 review"), while the plans draw the fairway as its own striped
   shape. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodePng } from './png.mjs';
import { chamferDistance, components, localStats } from './imagery.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ASSETS = 'tortunabuild/reference/source-assets.json';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** The pinned record of hole n's plan (id caddee-hole-N). */
export function planAsset(n) {
  const assets = JSON.parse(fs.readFileSync(path.join(ROOT, ASSETS), 'utf8')).assets;
  const asset = assets.find(a => a.id === `caddee-hole-${n}`);
  if (!asset?.sha256 || !asset.localPath || !asset.resolvedUrl) throw new Error(`hole ${n}: no pinned Caddee plan in ${ASSETS}`);
  return asset;
}

/** The plan's bytes, from the cache or its pinned URL, refused unless they hash to the pin. */
export async function loadPlanBytes(n) {
  const asset = planAsset(n);
  const file = path.join(ROOT, asset.localPath);
  if (!fs.existsSync(file)) {
    const response = await fetch(asset.resolvedUrl);
    if (!response.ok) throw new Error(`hole ${n}: plan fetch answered HTTP ${response.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const bytes = fs.readFileSync(file);
  if (sha256(bytes) !== asset.sha256) throw new Error(`hole ${n}: ${asset.localPath} does not hash to the pinned ${asset.sha256}`);
  return { bytes, asset };
}

/** Colour features of one decoded plan. Background is the white page and its vignette. */
export function planFeatures(image) {
  const W = image.width, H = image.height, ch = image.channels, N = W * H;
  const R = new Uint8Array(N), G = new Uint8Array(N), B = new Uint8Array(N);
  for (let i = 0; i < N; i++) { R[i] = image.data[i * ch]; G[i] = image.data[i * ch + 1]; B[i] = image.data[i * ch + 2]; }
  const background = new Uint8Array(N);
  for (let i = 0; i < N; i++) background[i] = R[i] > 238 && G[i] > 238 && B[i] > 238 ? 1 : 0;
  const bgDistance = chamferDistance(W, H, i => background[i] === 1);
  const blobs = (mask, minPx, maxPx) => {
    const comp = components(mask, W, H);
    const acc = new Map();
    for (let i = 0; i < N; i++) {
      const label = comp.labels[i]; if (!label) continue;
      let a = acc.get(label); if (!a) acc.set(label, a = { n: 0, x: 0, y: 0, minBg: Infinity, x0: W, x1: 0, y0: H, y1: 0 });
      const y = (i / W) | 0, x = i - y * W;
      a.n++; a.x += x; a.y += y; a.minBg = Math.min(a.minBg, bgDistance[i]);
      a.x0 = Math.min(a.x0, x); a.x1 = Math.max(a.x1, x); a.y0 = Math.min(a.y0, y); a.y1 = Math.max(a.y1, y);
    }
    const list = [];
    for (const [label, a] of acc) if (a.n >= minPx && a.n <= maxPx) list.push({ label, px: a.n, c: [a.x / a.n, a.y / a.n], minBg: a.minBg, fill: a.n / ((a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1)) });
    return { labels: comp.labels, list };
  };
  const orange = new Uint8Array(N), red = new Uint8Array(N), sand = new Uint8Array(N), water = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = R[i], g = G[i], b = B[i];
    orange[i] = r > 215 && g > 120 && g < 205 && b < 90 && r - g > 30 ? 1 : 0;
    red[i] = r > 150 && g < 80 && b < 80 && r - g > 90 ? 1 : 0;
    sand[i] = !background[i] && r > 200 && g > 188 && b > 150 && r >= b + 12 && bgDistance[i] > 12 ? 1 : 0;
    water[i] = b > r + 35 && b > 85 && g > r ? 1 : 0;
  }
  /* tee dots sit on the drawn tee box, inside the hole; the legend's dots sit on the white page */
  const teeDots = mask => blobs(mask, 12, 120).list.filter(d => d.minBg > 8).sort((a, b) => b.c[1] - a.c[1]);
  return {
    W, H, R, G, B, background, bgDistance,
    orangeDot: teeDots(orange)[0] || null,
    redDot: teeDots(red)[0] || null,
    sand: blobs(sand, REGISTRATION.sandMinPx, 5000).list.filter(b => b.minBg > 14 && b.fill > 0.35),
    water: blobs(water, 200, 400000),
  };
}

/** The putting green: the lightest smooth region in the plan's upper third, grown from its peak. */
export function planGreen(F) {
  const { W, H, R, G, B, bgDistance } = F, N = W * H;
  const L = new Float32Array(N), lum = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = (G[i] + R[i]) / 2 - B[i] * 0.6; lum[i] = (R[i] + G[i] + B[i]) / 3; }
  const smooth = localStats({ width: W, height: H, values: L }, 6).mean;
  const texture = localStats({ width: W, height: H, values: lum }, 3).sd;
  let best = -1, value = -Infinity;
  for (let y = 20; y < H * 0.32; y++) for (let x = 20; x < W - 20; x++) {
    const i = y * W + x;
    if (bgDistance[i] < 25 || texture[i] > 6) continue;
    if (smooth[i] > value) { value = smooth[i]; best = i; }
  }
  if (best < 0) throw new Error('plan green not found');
  const region = new Uint8Array(N), stack = [best];
  region[best] = 1;
  const threshold = value - 24;
  while (stack.length) {
    const j = stack.pop(), y = (j / W) | 0, x = j - y * W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const k = yy * W + xx;
      if (region[k] || L[k] < threshold || texture[k] > 9 || bgDistance[k] < 3) continue;
      region[k] = 1; stack.push(k);
    }
  }
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < N; i++) if (region[i]) { n++; sx += i % W; sy += (i / W) | 0; }
  return { c: [sx / n, sy / n], px: n, region };
}

/* THE PLANS DRAW A FAIRWAY WITH MOWING STRIPES AND NOTHING ELSE WITH THEM.
   Fairway colour alone also passes the lit side of the airbrushed rough, the
   pale bank of a pond and the apron round a green. The stripes are what the
   artist draws on fairway (and tee boxes) only, and they run in ONE direction
   across a whole plan. So the evidence is oriented: the structure tensor's
   local orientation must match the plan's dominant stripe angle (within
   12 degrees) with some coherence -- which a fairway's own edge, an oriented
   structure pointing every which way round the shape, does not, and which the
   faint stripes in the artist's airbrushed shadow still do. Fairway-coloured
   pixels that carry that evidence densely are the core; the fairway is the
   core grown a few pixels into connected fairway-coloured pixels, which takes
   in the shaded parts and the drawn outline without letting a lit patch of
   rough flood in through a bridge. */
/* Fairway, lit or in the artist's airbrushed shadow, is a YELLOW green: green exceeds red by 12-19 on the
   lit stripes and 17-19 in shadow, against 29-33 for the rough beside it, whatever the brightness. */
export const FAIRWAY_COLOUR = ({ r, g, b }) => r > 110 && g > 130 && b < 135 && g - r >= 4 && g - r < 24 && g - b > 50;
export const STRIPES = Object.freeze({ tensorRadiusPx: 4, coherence: 0.3, energy: 4, angleToleranceDegrees: 12,
  densityRadiusPx: 4, coreDensity: 0.35, growPx: 10, seedCoherence: 0.7 });

function structureTensor(F, radius) {
  const { W, H, R, G, B } = F, N = W * H;
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = 0.3 * R[i] + 0.59 * G[i] + 0.11 * B[i];
  const jxx = new Float32Array(N), jyy = new Float32Array(N), jxy = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, gx = (L[i + 1] - L[i - 1]) / 2, gy = (L[i + W] - L[i - W]) / 2;
    jxx[i] = gx * gx; jyy[i] = gy * gy; jxy[i] = gx * gy;
  }
  const sxx = localStats({ width: W, height: H, values: jxx }, radius).mean;
  const syy = localStats({ width: W, height: H, values: jyy }, radius).mean;
  const sxy = localStats({ width: W, height: H, values: jxy }, radius).mean;
  const coherence = new Float32Array(N), angle = new Float32Array(N), energy = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = sxx[i] + syy[i];
    energy[i] = t;
    coherence[i] = t > 1e-6 ? Math.sqrt((sxx[i] - syy[i]) ** 2 + 4 * sxy[i] ** 2) / t : 0;
    angle[i] = 0.5 * Math.atan2(2 * sxy[i], sxx[i] - syy[i]);
  }
  return { coherence, angle, energy };
}

/** The plan's fairway pixels (Uint8 mask) and the stripe angle it found, in degrees. */
export function planFairwayMask(F) {
  const { W, H, R, G, B, bgDistance } = F, N = W * H;
  const T = structureTensor(F, STRIPES.tensorRadiusPx);
  const colour = new Uint8Array(N);
  for (let i = 0; i < N; i++) colour[i] = bgDistance[i] > 2 && FAIRWAY_COLOUR({ r: R[i], g: G[i], b: B[i] }) ? 1 : 0;
  /* the plan's stripe direction: a COUNT of strongly coherent fairway-colour pixels per degree. Weighting
     by gradient energy let a few hard edges -- the drawn lines, the lettering, the green's outline -- outvote
     the stripes (the 13th read 65 degrees); counted, every plan reads 138-142. */
  const bins = new Float64Array(180);
  for (let i = 0; i < N; i++) if (colour[i] && T.coherence[i] >= STRIPES.seedCoherence) bins[(Math.round(T.angle[i] * 180 / Math.PI) + 180) % 180] += 1;
  let stripeDegrees = 0, bestSum = -1;
  for (let d = 0; d < 180; d++) { let sum = 0; for (let k = -4; k <= 4; k++) sum += bins[(d + k + 180) % 180]; if (sum > bestSum) { bestSum = sum; stripeDegrees = d; } }
  const a0 = stripeDegrees * Math.PI / 180, tolerance = STRIPES.angleToleranceDegrees * Math.PI / 180;
  const evidence = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (!colour[i] || T.coherence[i] < STRIPES.coherence || T.energy[i] < STRIPES.energy) continue;
    let d = Math.abs(T.angle[i] - a0); d = Math.min(d, Math.PI - d);
    if (d <= tolerance) evidence[i] = 1;
  }
  const density = localStats({ width: W, height: H, values: evidence }, STRIPES.densityRadiusPx).mean;
  const mask = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  const distance = new Int16Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (colour[i] && density[i] >= STRIPES.coreDensity) { mask[i] = 1; distance[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const j = queue[head++];
    if (distance[j] >= STRIPES.growPx) continue;
    const y = (j / W) | 0, x = j - y * W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const k = yy * W + xx;
      if (mask[k] || !colour[k]) continue;
      mask[k] = 1; distance[k] = distance[j] + 1; queue[tail++] = k;
    }
  }
  return { mask, stripeDegrees };
}

/** Least-squares similarity (scale, rotation, translation) from weighted point pairs, plan px -> local metres. */
export function fitSimilarity(pairs) {
  let sw = 0, px = 0, py = 0, wx = 0, wz = 0;
  for (const { p, w, weight = 1 } of pairs) { sw += weight; px += weight * p[0]; py += weight * p[1]; wx += weight * w[0]; wz += weight * w[1]; }
  px /= sw; py /= sw; wx /= sw; wz /= sw;
  let a = 0, b = 0, d = 0;
  for (const { p, w, weight = 1 } of pairs) {
    const u = p[0] - px, v = p[1] - py, X = w[0] - wx, Z = w[1] - wz;
    a += weight * (u * X + v * Z); b += weight * (u * Z - v * X); d += weight * (u * u + v * v);
  }
  const scale = Math.hypot(a, b) / d, rotation = Math.atan2(b, a);
  const c = Math.cos(rotation) * scale, s = Math.sin(rotation) * scale;
  const tx = wx - (c * px - s * py), tz = wz - (s * px + c * py);
  return { scale, rotation, tx, tz, apply: ([u, v]) => [c * u - s * v + tx, s * u + c * v + tz] };
}

export const polygonCentroid = ring => {
  let a = 0, x = 0, z = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f; x += (ring[j][0] + ring[i][0]) * f; z += (ring[j][1] + ring[i][1]) * f;
  }
  return [x / (3 * a), z / (3 * a)];
};

/* The anchors and their weights. The green is the anchor every plan has and
   the model has measured best, so it carries three; each matched bunker one;
   the two tee dots carry less once any bunker is matched, because 27 of this
   model's 72 colour marks stand on card-derived platforms (±15 m). */
export const REGISTRATION = Object.freeze({ greenWeight: 3, bunkerWeight: 1, teeWeightWithBunkers: [0.4, 0.3], teeWeightAlone: [1, 0.7],
  bunkerMatchMetres: [18, 18, 10, 10, 10], sandMinPx: 30 });

/** Fit hole `hole`'s plan onto the model; `bunkers` is every model bunker [{ hole, c, area }]. */
export function registerPlan(hole, F, green, bunkers) {
  const modelGreen = polygonCentroid(hole.green.ring);
  const padCentre = id => { const pad = hole.tees.pads.find(p => p.sourceFeatureId === id); return pad ? polygonCentroid(pad.ring.slice(0, -1)) : null; };
  const gul = padCentre(hole.tees.marks[0].sourcePadId) || hole.tees.marks[0].c;
  const red = padCentre(hole.tees.marks[2]?.sourcePadId) || hole.tees.marks.at(-1).c;
  const dots = [F.orangeDot && { p: F.orangeDot.c, w: gul, which: 'orange->Gul' }, F.redDot && { p: F.redDot.c, w: red, which: 'red->Röd' }].filter(Boolean);
  if (!dots.length) throw new Error(`hole ${hole.n}: the plan shows no tee dot to orient it`);
  let T = fitSimilarity([{ p: green.c, w: modelGreen }, dots[0]]);
  let matched = [];
  for (const limit of REGISTRATION.bunkerMatchMetres) {
    const used = new Set();
    const candidates = F.sand.map(blob => {
      const w = T.apply(blob.c);
      let best = null, bestD = limit;
      for (const b of bunkers) { const d = Math.hypot(b.c[0] - w[0], b.c[1] - w[1]); if (d < bestD) { bestD = d; best = b; } }
      return { blob, best, d: bestD };
    }).filter(c => c.best).sort((a, b) => a.d - b.d);
    matched = [];
    for (const c of candidates) { if (used.has(c.best)) continue; used.add(c.best); matched.push({ p: c.blob.c, w: c.best.c, weight: REGISTRATION.bunkerWeight, hole: c.best.hole, id: c.best.id }); }
    const teeWeights = matched.length ? REGISTRATION.teeWeightWithBunkers : REGISTRATION.teeWeightAlone;
    T = fitSimilarity([{ p: green.c, w: modelGreen, weight: REGISTRATION.greenWeight }, ...matched,
      ...dots.map((dot, i) => ({ ...dot, weight: teeWeights[i] ?? teeWeights.at(-1) }))]);
  }
  const residual = (p, w) => { const q = T.apply(p); return Math.hypot(q[0] - w[0], q[1] - w[1]); };
  return {
    transform: T,
    residuals: {
      greenMetres: residual(green.c, modelGreen),
      bunkers: matched.map(m => ({ hole: m.hole, id: m.id, metres: residual(m.p, m.w) })),
      tees: dots.map(dot => ({ anchor: dot.which, metres: residual(dot.p, dot.w) })),
    },
  };
}
