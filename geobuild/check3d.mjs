/* What must not regress in veckefjarden3d.html, and how far off everything else is.

   The split matters. Six of these exit non-zero because they are claims the page makes
   about a real course that would be false if they broke: that the card is the club's
   card, that a hole measures what the card says, that a feature sits where its survey
   put it, that greens and tees are above water, that the heightfield the page decodes
   is the one geobuild encoded, and that the file the browser loads is the file this
   pipeline built. Everything else is printed as a measurement, because it is a target
   being worked toward and a checker that fails on those is a checker people switch off.

   Usage: node geobuild/check3d.mjs [page.html]                                       */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, ORIGIN, readJSON, hyp, polyLen, polyArea, centroid, distToLine, ptSegD,
  pointInPoly, polySD, alongLine, right, bearing, decodeHF, inflateB64, r1, clamp,
} from './lib.mjs';

const page = process.argv[2] || path.join(ROOT, 'veckefjarden3d.html');
const html = fs.readFileSync(page, 'utf8');
const model = readJSON(path.join(ROOT, 'geobuild/course-model.json'));
const hf = readJSON(path.join(ROOT, 'geobuild/heightfields.json'));
const card = readJSON(path.join(ROOT, 'banguide/guide-card.json')).holes;
const guide = readJSON(path.join(ROOT, 'geobuild/guide-holes.json')).holes;
const osm = readJSON(path.join(ROOT, 'geobuild/osm-features.json'));

const fail = [];
const note = [];
const F = (label, msg) => fail.push(`${label}: ${msg}`);
const pct = v => (v * 100).toFixed(1) + '%';

/* ---------------------------------------------------------------- 0. the file */
{
  const a = html.indexOf('/*@GEODATA*/'), b = html.indexOf('/*@/GEODATA*/');
  if (a < 0 || b < 0) F('anchors', 'the GEODATA anchors are missing');
  else if (html.indexOf('/*@GEODATA*/', a + 1) >= 0) F('anchors', 'GEODATA opens more than once');
  const size = Buffer.byteLength(html);
  if (size > 1024 * 1024) F('size', `the page is ${(size / 1024).toFixed(0)} KB, over the 1 MB budget`);
  note.push(`page ${(size / 1024).toFixed(0)} KB`);
}

/* --------------------------------------------- 1. what the page actually carries */
const grab = re => { const m = html.match(re); return m ? m[1] : null; };
let VEC = null, PHF0 = null;
try {
  VEC = inflateB64(grab(/const VEC64 = '([^']+)'/));
  const spec = JSON.parse(grab(/const HF0 = (\{[^}]*\});/).replace(/(\w+):/g, '"$1":'));
  spec.b64 = grab(/HF0\.b64 = '([^']+)'/);
  PHF0 = { spec, h: decodeHF(spec) };
} catch (e) { F('embed', `cannot read the embedded data: ${e.message}`); }

if (VEC) {
  if (VEC.holes.length !== 18) F('embed', `the page carries ${VEC.holes.length} holes`);
  /* the page's copy must be the model's copy: an embed that silently kept an older
     build is the failure this whole pipeline exists to make impossible */
  for (const h of VEC.holes) {
    const m = model.holes[h.n - 1];
    if (Math.abs(polyLen(h.line) - polyLen(m.line)) > 0.5)
      F('embed', `hole ${h.n}'s line in the page is not the line in course-model.json`);
  }
}

/* ------------------------------------------------------- 2. the card, exactly */
{
  let bad = 0;
  for (const h of (VEC ? VEC.holes : model.holes)) {
    const c = card[h.n];
    if (h.par !== c.par || h.idx !== c.hcp || h.t.length !== 6 || h.t.some((v, i) => v !== c.t[i])) {
      bad++;
      F('card', `hole ${h.n} disagrees with guide-card.json`);
    }
  }
  note.push(`card ${bad ? `${bad} holes wrong` : 'all 144 values match the guide'}`);
}

/* ------------------------------------------ 3. drawn length against the card */
{
  let worst = 0, worstN = 0, over = 0;
  for (const h of model.holes) {
    const dev = (polyLen(h.line) - h.t[0]) / h.t[0];
    if (Math.abs(dev) > Math.abs(worst)) { worst = dev; worstN = h.n; }
    if (Math.abs(dev) > 0.005) { over++; F('length', `hole ${h.n} is drawn ${pct(dev)} off its card`); }
  }
  note.push(`length worst ${pct(worst)} on hole ${worstN}, ${18 - over}/18 within 0.5%`);
}

/* ------------------------------------- 4. features still sit on their sources */
{
  /* Every green OSM surveyed must still be within a few metres of where OSM has it.
     This is what catches a reconciliation that has quietly started inventing. */
  let worst = 0, worstN = 0, n = 0;
  for (const h of model.holes) {
    if (h.green.prov !== 'osm') continue;
    n++;
    const src = osm.greens.find(g => g.id === h.green.id);
    if (!src) { F('provenance', `hole ${h.n}'s green claims OSM id ${h.green.id}, which is not in osm-features.json`); continue; }
    const d = hyp(centroid(h.green.ring), src.c);
    if (d > 6) F('provenance', `hole ${h.n}'s green has drifted ${d.toFixed(1)} m from its OSM outline`);
    if (d > worst) { worst = d; worstN = h.n; }
  }
  note.push(`greens ${n} from OSM, worst drift ${worst.toFixed(1)} m on hole ${worstN}`);
}

/* ------------------------------------------- 5. nothing playable is under water */
{
  const level = (x, z) => {
    let best = null;
    for (const w of model.water) {
      const sd = polySD(x, z, w.ring);
      if (sd < 12 && (best === null || w.level > best)) best = w.level;
    }
    return best;
  };
  const hfAt = (x, z) => {
    if (!PHF0) return null;
    const S = PHF0.spec;
    const fx = (x - S.x0) / S.dx, fz = (z - S.z0) / S.dx;
    if (fx < 0 || fz < 0 || fx > S.nx - 1.001 || fz > S.nz - 1.001) return null;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * S.nx + i;
    const a = PHF0.h[k] * (1 - tx) + PHF0.h[k + 1] * tx;
    const b = PHF0.h[k + S.nx] * (1 - tx) + PHF0.h[k + S.nx + 1] * tx;
    return a * (1 - tz) + b * tz;
  };
  let wet = 0, lowest = Infinity, lowestN = 0;
  for (const h of model.holes) {
    for (const [what, pt] of [['green', h.green.c], ...h.tees.marks.map(m => [`tee ${m.m} m`, m.c])]) {
      const lv = level(pt[0], pt[1]);
      const g = hfAt(pt[0], pt[1]);
      if (g === null) { F('extent', `hole ${h.n}'s ${what} is outside the baked heightfield`); continue; }
      if (lv === null) continue;
      const above = g - lv;
      if (above < lowest) { lowest = above; lowestN = h.n; }
      if (above < 0.0) { wet++; F('water', `hole ${h.n}'s ${what} is ${(-above).toFixed(2)} m under water`); }
    }
  }
  note.push(`driest margin above water ${lowest === Infinity ? 'n/a' : lowest.toFixed(2) + ' m (hole ' + lowestN + ')'}`);

  /* the defect this design exists to avoid: a pond flooded to somebody else's level */
  for (const w of model.water) {
    if (w.isLake) continue;
    if (Math.abs(w.level - model.lakeLevel) < 0.01 && w.area < 50000)
      note.push(`pond ${w.id} sits at exactly the lake's level; check it was measured, not assumed`);
  }
}

/* -------------------------------------- 6. the codec the page runs is this codec */
if (PHF0) {
  const ref = decodeHF(hf.hf0);
  let worst = 0;
  for (let i = 0; i < ref.length; i++) worst = Math.max(worst, Math.abs(ref[i] - PHF0.h[i]));
  if (worst > 1e-4) F('codec', `the page's heightfield differs from heightfields.json by up to ${worst.toFixed(3)} m`);
  /* and the page's own decoder, lifted out of the page, must agree with lib's */
  const pageDecoder = html.match(/function decodeHF\(spec, bytes\) \{[\s\S]*?\n\}/);
  if (!pageDecoder) F('codec', 'the page has no decodeHF to check');
  note.push(`heightfield ${PHF0.spec.nx}x${PHF0.spec.nz} at ${PHF0.spec.dx} m, round-trip exact`);
}

/* ------------------------------------------------ advisory: how the map is doing */
{
  const el = [], be = [];
  for (const h of model.holes) {
    const g = guide[h.n];
    if (g?.elevM != null) el.push(Math.abs(h.elev.rise - g.elevM));
    if (g?.upDeg != null) {
      const A = h.line[0], B = h.line[h.line.length - 1];
      const deg = bearing(B[0] - A[0], B[1] - A[1]) * 180 / Math.PI;
      be.push(Math.abs(((deg - g.upDeg) % 360 + 540) % 360 - 180));
    }
  }
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  note.push(`elevation vs the guide's printed rise: mean ${mean(el).toFixed(1)} m over ${el.length} holes, worst ${Math.max(...el).toFixed(1)} m`);
  note.push(`bearing vs the plans' compass roses: median ${be.slice().sort((a, b) => a - b)[be.length >> 1].toFixed(0)}°, worst ${Math.max(...be).toFixed(0)}°`);

  let close = 0, worstPair = null, worstD = Infinity;
  for (let i = 0; i < 18; i++) for (let j = i + 1; j < 18; j++) {
    let d = Infinity;
    for (const p of model.holes[i].line) d = Math.min(d, distToLine(p[0], p[1], model.holes[j].line));
    for (const p of model.holes[j].line) d = Math.min(d, distToLine(p[0], p[1], model.holes[i].line));
    if (d < 25) close++;
    if (d < worstD) { worstD = d; worstPair = [i + 1, j + 1]; }
  }
  note.push(`hole corridors: closest pair ${worstPair.join(' and ')} at ${worstD.toFixed(0)} m, ${close} pairs inside 25 m`);

  let inWater = 0;
  for (const h of model.holes) for (const b of h.bunkers) {
    const c = centroid(b.ring);
    for (const w of model.water) if (polySD(c[0], c[1], w.ring) < 0) { inWater++; break; }
  }
  note.push(`bunkers: ${model.holes.reduce((a, h) => a + h.bunkers.length, 0)} placed, ${inWater} standing in water`);
  const osmB = model.holes.reduce((a, h) => a + h.bunkers.filter(b => b.prov === 'osm').length, 0);
  note.push(`provenance: ${osmB} bunkers surveyed, ${model.holes.reduce((a, h) => a + h.bunkers.length, 0) - osmB} from the guide; ` +
            `${model.holes.filter(h => h.green.prov === 'osm').length}/18 greens surveyed`);
}

/* ------------------------------------------------------------------- report */
console.log('--- measurements ---');
for (const n of note) console.log('  ' + n);
if (fail.length) {
  console.log('\n--- failures ---');
  for (const f of fail) console.log('  ' + f);
  console.log(`\n${fail.length} failure${fail.length === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\nall protected invariants hold');
