/* The regression gate for johannesberg3d.html. Exits non-zero on anything that
   would make the page state a falsehood about the real course:

   1. the card in the page is the club's card — par, index and tee values, exact
   2. drawn lines match the card to 0.5%, except an evidenced green endpoint move
   3. every green ring contains its display target, at a sane area
   4. no green or tee sits at or below the water that surrounds it
   5. the heightfields in the page decode to exactly what geobuild encoded
   6. the page's embedded block is current with the committed model

   Everything else it prints is a measurement, not a gate.

   Run:  node johannesbergbuild/check3d.mjs [page.html]                          */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ROOT, readJSON, decodeHF, polyLen, pointInPoly, polyArea } from './lib.mjs';
import { geometrySha256 } from './mapping/apply-ortho-review.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const page = process.argv[2] || path.join(ROOT, 'johannesberg3d.html');
const src = fs.readFileSync(page, 'utf8');
const card = readJSON(path.join(HERE, 'card.json'));
const model = readJSON(path.join(HERE, 'course-model.json'));
const hf = readJSON(path.join(HERE, 'heightfields.json'));

let fails = 0;
const gate = (ok, msg) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${msg}`); if (!ok) fails++; };

/* --- pull the embedded block out of the page ---------------------------------- */
const grab = re => { const m = src.match(re); if (!m) throw new Error(`page: ${re} not found`); return m[1]; };
const GEO = JSON.parse(grab(/const GEO = (\{.*?\});/));
const P0 = JSON.parse(grab(/const HF0 = (\{.*?\});/));
const P1 = JSON.parse(grab(/const HF1 = (\{.*?\});/));
P0.b64 = grab(/HF0\.b64 = '([^']+)'/);
P1.b64 = grab(/HF1\.b64 = '([^']+)'/);
const VEC64 = grab(/const VEC64 = '([^']+)'/);
const vec = JSON.parse(zlib.inflateRawSync(Buffer.from(VEC64, 'base64')).toString('utf8'));

/* --- 1: the card -------------------------------------------------------------- */
{
  let bad = 0, checked = 0;
  const nTee = card.holes[0].t.length;
  for (const ch of card.holes) {
    const h = vec.holes.find(x => x.n === ch.n);
    if (!h) { bad++; continue; }
    if (h.par !== ch.par) bad++;
    if (h.idx !== ch.hcp) bad++;
    checked += 2;
    if (h.t.length !== ch.t.length) bad++;
    for (let k = 0; k < nTee; k++) { checked++; if (h.t[k] !== ch.t[k]) bad++; }
  }
  gate(bad === 0 && checked === 18 * (2 + nTee), `card: ${checked} par/index/tee values checked against the club's card, ${bad} mismatches`);
}

/* --- 2: drawn lengths --------------------------------------------------------- */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* A reviewed putting surface may move the display target away from an old
   card-fitted endpoint. Accept only that endpoint change: the original route
   must pass the existing length gate, and every earlier vertex must be intact.
   The original line is retained in the model, not added to the page payload. */
function reviewedEndpointEvidence(h, original, feature) {
  const review = original?.routingReview;
  if (!review || !feature || feature.status !== 'accepted' || feature.kind !== 'green' || feature.hole !== h.n) return false;
  if (original.routingReviewId !== feature.id || review.reviewId !== feature.id) return false;
  if (original.green.prov !== 'reviewed-lm-orthophoto' || original.green.reviewId !== feature.id) return false;
  if (!same(h.green.ring, feature.ring) || !same(h.green.ring, original.green.ring)) return false;
  const evidence = feature.evidence;
  if (!(evidence?.uncertaintyM > 0) || !evidence.sourceFiles?.length ||
      !evidence.sourceFiles.every(s => s.path && /^[0-9a-f]{64}$/.test(s.sha256)) ||
      !evidence.sourceCaptureDates?.length || !same(original.green.sourceCaptureDates, evidence.sourceCaptureDates)) return false;
  const before = review.originalLine;
  if (!Array.isArray(before) || before.length < 2 || before.length !== h.line.length ||
      !before.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return false;
  if (geometrySha256(before) !== review.originalLineSha256 || !same(h.line, original.line)) return false;
  if (!same(h.line.slice(0, -1), before.slice(0, -1)) || same(h.line.at(-1), before.at(-1))) return false;
  if (!same(h.line.at(-1), h.green.c) || !same(h.pin, h.green.c) || !same(h.green.c, original.green.c)) return false;
  if (feature.target && !same(h.green.c, feature.target)) return false;
  if (!pointInPoly(h.green.c[0], h.green.c[1], feature.ring)) return false;
  return Math.abs(polyLen(before) - h.t[0]) / h.t[0] * 100 <= 0.5;
}

{
  const acceptedGreens = new Map();
  for (const name of ['lm-review-front9.json', 'lm-review-back9.json']) {
    const file = path.join(HERE, 'mapping', name);
    if (!fs.existsSync(file)) continue;
    const ledger = readJSON(file);
    if (ledger.groundId !== 'johannesberg' || ledger.course !== 'johannesberg') throw new Error(`wrong review identity: ${name}`);
    for (const f of ledger.features) if (f.kind === 'green' && f.status === 'accepted') acceptedGreens.set(f.id, f);
  }
  let worst = 0, worstN = 0;
  const rejected = [], reviewed = [];
  for (const h of vec.holes) {
    const dev = Math.abs(polyLen(h.line) - h.t[0]) / h.t[0] * 100;
    if (dev > worst) { worst = dev; worstN = h.n; }
    if (dev <= 0.5) continue;
    const sourceHole = model.holes.find(q => q.n === h.n);
    if (reviewedEndpointEvidence(h, sourceHole, acceptedGreens.get(sourceHole?.routingReviewId))) reviewed.push(h.n);
    else rejected.push(h.n);
  }
  gate(rejected.length === 0, `lengths: worst deviation ${worst.toFixed(3)}% (hole ${worstN}); 0.5% gate, ${reviewed.length} evidenced endpoint changes, ${rejected.length} unsupported deviations${rejected.length ? ' on holes ' + rejected.join(', ') : ''}`);
  if (reviewed.length) console.log(`       holes ${reviewed.join(', ')}: reviewed green targets; original tee and intermediate route vertices unchanged`);
}

/* --- 3: greens ---------------------------------------------------------------- */
{
  let out = 0, small = 0, big = 0;
  for (const h of vec.holes) {
    if (!pointInPoly(h.green.c[0], h.green.c[1], h.green.ring)) out++;
    const a = Math.abs(polyArea(h.green.ring));
    if (a < 150) small++;
    if (a > 1200) big++;
  }
  gate(out === 0, `greens: every display target inside its traced ring (${out} outside)`);
  gate(small === 0 && big === 0, `green areas within 150–1200 m² (${small} small, ${big} large)`);
}

/* --- 4: nothing under water --------------------------------------------------- */
{
  const H0 = decodeHF(P0);
  const terr = (x, z) => {
    const fx = (x - P0.x0) / P0.dx, fz = (z - P0.z0) / P0.dx;
    const i = Math.max(0, Math.min(P0.nx - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(P0.nz - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j));
    const k = j * P0.nx + i;
    return (H0[k] * (1 - tx) + H0[k + 1] * tx) * (1 - tz) + (H0[k + P0.nx] * (1 - tx) + H0[k + P0.nx + 1] * tx) * tz;
  };
  /* Submersion is LOCAL. A course can carry water at a dozen levels (Ängsö spans
     6.5 to 42 m) and its ground can legitimately sit below a distant lake's
     surface -- Terrarium reads Mälaren's bay 3 m above the greens beside it, which
     is DEM bias on a flat shore, not a flooded green. So a point is wet only if it
     lies inside a water ring AND below that ring's own level. The flat-floor test
     is kept only where there is a real sea, at one level, to catch a hole that has
     wandered off the map entirely. */
  const hasSea = vec.water.some(w => w.isSea);
  let wet = 0;
  const check = (label, x, z) => {
    const h = terr(x, z);
    if (hasSea && h < GEO.seaLevel + 0.4) { wet++; console.log(`       ${label} at ${h.toFixed(2)} m, below sea level`); return; }
    for (const w of vec.water) {
      if (w.isSea || w.level == null) continue;
      const bb = w.ring.reduce((a, p) => ({ x0: Math.min(a.x0, p[0]), x1: Math.max(a.x1, p[0]), z0: Math.min(a.z0, p[1]), z1: Math.max(a.z1, p[1]) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
      if (x < bb.x0 || x > bb.x1 || z < bb.z0 || z > bb.z1) continue;
      if (pointInPoly(x, z, w.ring) && h < w.level + 0.3) {
        wet++; console.log(`       ${label} inside water at ${h.toFixed(2)} m vs level ${w.level}`); return;
      }
    }
  };
  for (const h of vec.holes) { check(`green ${h.n}`, h.green.c[0], h.green.c[1]); check(`tee ${h.n}`, h.line[0][0], h.line[0][1]); }
  gate(wet === 0, `water: no green or tee submerged (${wet} wet)`);
}

/* --- 5: heightfield integrity -------------------------------------------------- */
gate(P0.b64 === hf.hf0.b64 && P1.b64 === hf.hf1.b64,
  `heightfields: page b64 identical to johannesbergbuild/heightfields.json`);
{
  const back = decodeHF({ ...hf.hf0 });
  gate(back.length === hf.hf0.nx * hf.hf0.nz, `HF0 decodes to ${back.length} samples`);
}

/* --- 6: embedded data is current ----------------------------------------------- */
{
  const geometryState = h => ({
    n: h.n, line: h.line, lineLen: h.lineLen, pin: h.pin,
    green: { ring: h.green.ring, c: h.green.c },
    fairway: h.fairway.rings,
    tees: {
      ...(h.tees.inferPads === false ? { inferPads: false } : {}),
      ...(h.tees.status ? { status: h.tees.status } : {}),
      pads: h.tees.pads.map(p => ({ ring: p.ring, ...(p.preserveTerrain ? { preserveTerrain: true } : {}) })),
      marks: h.tees.marks.map(m => ({ c: m.c, b: m.b, m: m.m, ...(m.displayC !== undefined ? { displayC: m.displayC } : {}) })),
    },
    bunkers: h.bunkers.map(b => b.ring),
  });
  const stale = model.holes.filter(h => {
    const embedded = vec.holes.find(q => q.n === h.n);
    return !embedded || !same(geometryState(h), geometryState(embedded)) || embedded.lineLen !== Math.round(polyLen(embedded.line) * 10) / 10;
  }).length;
  gate(stale === 0 && vec.holes.length === model.holes.length, `currency: exact hole geometry, targets and tee policies match course-model.json (${stale} stale)`);
  gate(vec.infra.preserveMappedBoundaries === model.infra.preserveMappedBoundaries, 'currency: mapped-boundary display policy matches model');
  gate(same(vec.scenery, model.scenery), 'currency: neighbouring course and practice geometry matches model');
  gate(GEO.seaLevel === model.seaLevel, `currency: seaLevel ${GEO.seaLevel} matches model`);
}

/* --- measurements -------------------------------------------------------------- */
console.log('\nmeasurements:');
console.log(`  page size ${(src.length / 1024).toFixed(0)} KB`);
const areas = vec.holes.map(h => Math.round(Math.abs(polyArea(h.green.ring))));
console.log(`  green areas ${Math.min(...areas)}–${Math.max(...areas)} m² (median ${areas.sort((a, b) => a - b)[9]})`);
console.log(`  water features ${vec.water.length}, streams ${vec.streams.length}`);
console.log(`  buildings ${vec.infra.buildings.length}, piers ${vec.infra.piers.length}`);

if (fails) { console.error(`\n${fails} GATE FAILURE(S)`); process.exit(1); }
console.log('\nall gates pass');
