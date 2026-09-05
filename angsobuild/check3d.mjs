/* The regression gate for angso3d.html. Exits non-zero on anything that
   would make the page state a falsehood about the real course:

   1. the card in the page is the club's card — 144 values, exact
   2. every drawn hole line measures its card length to 0.5%
   3. every green ring contains its GPS-surveyed centre, at a sane area
   4. no green or tee sits at or below the water that surrounds it
   5. the heightfields in the page decode to exactly what geobuild encoded
   6. the page's embedded block is current with the committed model

   Everything else it prints is a measurement, not a gate.

   Run:  node nvgkbuild/check3d.mjs [page.html]                                  */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ROOT, readJSON, decodeHF, polyLen, pointInPoly, polyArea } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const page = process.argv[2] || path.join(ROOT, 'angso3d.html');
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
{
  let worst = 0, worstN = 0;
  for (const h of vec.holes) {
    const dev = Math.abs(polyLen(h.line) - h.t[0]) / h.t[0] * 100;
    if (dev > worst) { worst = dev; worstN = h.n; }
  }
  gate(worst <= 0.5, `lengths: worst deviation ${worst.toFixed(3)}% (hole ${worstN}), gate 0.5%`);
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
  gate(out === 0, `greens: every surveyed centre inside its traced ring (${out} outside)`);
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
  `heightfields: page b64 identical to angsobuild/heightfields.json`);
{
  const back = decodeHF({ ...hf.hf0 });
  gate(back.length === hf.hf0.nx * hf.hf0.nz, `HF0 decodes to ${back.length} samples`);
}

/* --- 6: embedded data is current ----------------------------------------------- */
{
  const holesNow = model.holes.map(h => h.n + ':' + h.lineLen + ':' + h.green.c.join(','));
  const holesPage = vec.holes.map(h => h.n + ':' + Math.round(polyLen(h.line) * 10) / 10 + ':' + h.green.c.join(','));
  let stale = 0;
  for (let i = 0; i < 18; i++) if (holesNow[i] !== holesPage[i]) stale++;
  gate(stale === 0, `currency: page holes match course-model.json (${stale} stale)`);
  gate(GEO.seaLevel === model.seaLevel, `currency: seaLevel ${GEO.seaLevel} matches model`);
}

/* --- 7: a measured feature came from a calibrated instrument ------------------- */
/* The bunkers and the tee decks are read off ONE dated satellite capture over
   the laser terrain, and an imagery capture is only an instrument once it has
   reproduced something nobody read off it. The nine bunkers OpenStreetMap
   surveyed are that something. This gate fails if a re-run ever adopts a
   capture that does not find them: the live 2025-04-13 imagery finds 4 of 9 at
   4.5 m and would be refused here; the 2018-10-25 capture the model uses finds
   8 of 9 at 1.3 m. It also fails if a bunker the model calls measured has no
   dish under it after all. */
try {
  const dtm = JSON.parse(fs.readFileSync(path.join(HERE, 'dtm-features.json'), 'utf8'));
  const hit = (dtm.osmCheck || []).filter(o => o.dist != null);
  const worst = hit.length ? Math.max(...hit.map(o => o.dist)) : Infinity;
  gate(hit.length >= 7 && worst <= 3,
    `calibration: ${hit.length} of ${(dtm.osmCheck || []).length} surveyed bunkers reproduced by the sand-over-dish rule on capture ${dtm.imagery.release}, worst ${worst.toFixed(1)} m (gate: 7 and 3 m)`);
  const measured = (dtm.bunkers || []).filter(b => b.src !== 'osm');
  const shallow = measured.filter(b => !(b.dish >= 0.07)).length;
  gate(shallow === 0, `bunkers: every one of the ${measured.length} measured bunkers sits over a dish in the laser (${shallow} without)`);
} catch (e) { if (e.code !== 'ENOENT') throw e; }
try {
  const lp = JSON.parse(fs.readFileSync(path.join(HERE, 'laser-ponds.json'), 'utf8'));
  const traced = (lp.ponds || []).filter(p => p.verdict === 'traced');
  /* The plate, not the spread, is what says a ring is water: a ring drawn a few
     metres wide holds a real plate under the bank it took in (t2 reads 0.79 m of
     spread over 62% plate and is a pond), while the phantoms read 8-14%. */
  const thin = traced.filter(p => !(p.plateFraction >= 0.15)).length;
  gate(thin === 0, `ponds: all ${traced.length} laser-traced ponds are a plate over at least 15% of their ring (${thin} under), ${(lp.ponds || []).length - traced.length} refused with a stated reason`);
} catch (e) { if (e.code !== 'ENOENT') throw e; }

/* --- 8: the model may not draw water where the laser says there is none ------- */
/* Both halves of this failed at once and neither was visible in any number the
   build printed: laser-ponds REFUSED two OSM "lakes" in the woods beside the 3rd
   as not water surfaces and reconcile drew them anyway, and the shore tracer
   classified one loop of a strait as an outer ring so a 0.3 ha sheet sat inside
   a 47 ha one at the same level. A measurement taken and then ignored, and two
   coplanar sheets over one water -- the Ribbingsfors rule, met again here. */
{
  const refusedNotWater = new Set();
  try {
    const lp = JSON.parse(fs.readFileSync(path.join(HERE, 'laser-ponds.json'), 'utf8'));
    for (const p of (lp.ponds || [])) if (p.kind === 'not-water') refusedNotWater.add(p.id);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  /* Read the MODEL here, not the page's vector: embed drops `id` to save bytes,
     so a gate written against vec.water matches nothing and passes whatever the
     model does — it agreed with the bug until a probe put a phantom back and it
     still said ok. The page is checked against the model by the currency gate. */
  const drawnAnyway = model.water.filter(w => refusedNotWater.has(w.id)).map(w => w.id);
  gate(drawnAnyway.length === 0,
    `water: nothing the laser refused as not-water is drawn as water (${refusedNotWater.size} refused${drawnAnyway.length ? ': STILL DRAWN ' + drawnAnyway.join(', ') : ''})`);

  const inRing = (x, z, r) => { let o = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) o = !o; } return o; };
  const clashes = [];
  for (let a = 0; a < vec.water.length; a++) for (let b = 0; b < vec.water.length; b++) {
    if (a === b) continue;
    const A = vec.water[a], B = vec.water[b];
    if (A.level == null || B.level == null || Math.abs(A.level - B.level) >= 0.5) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of B.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    let inB = 0, both = 0;
    for (let x = x0; x <= x1; x += 8) for (let z = z0; z <= z1; z += 8) {
      if (!inRing(x, z, B.ring)) continue;
      inB++;
      if (inRing(x, z, A.ring)) both++;
    }
    if (inB >= 4 && both / inB > 0.2) clashes.push(`${B.id || b} is ${(100 * both / inB).toFixed(0)}% inside ${A.id || a} at the same level`);
  }
  gate(clashes.length === 0,
    `water: no two rings at one level overlap — one body, one ring (${vec.water.length} rings${clashes.length ? '; ' + clashes.join('; ') : ''})`);
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
