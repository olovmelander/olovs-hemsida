/* Fuse four independent records of Veckefjärden into one course model.

   None of the four is complete on its own. OpenStreetMap has surveyed outlines for
   twelve of the eighteen championship holes and for the nine-hole short course, but
   nothing at all for holes 1-5 and 7. The club's GPS survey covers all eighteen, but
   only as five points a hole. The banguide has the card, which is the one thing that
   must come out exactly right, plus prose about every bunker and hazard. The elevation
   model knows the ground but nothing about golf.

   They agree where they overlap, and that is what makes the fusion trustworthy: on the
   twelve holes both cover, the GPS green centre and the OSM green outline land within
   two to four metres of each other, and the height model reproduces the guide's printed
   "plays 28 m uphill" to within a couple of metres. So the survey is sound on the holes
   nobody can check as well, and it is used as the anchor there rather than guessed at.

   Precedence: OSM outlines where they exist, GPS points where they do not, the guide
   for everything that has no geometry at all, and the card verbatim for every number
   the page ever prints.                                                              */
import path from 'node:path';
import {
  ROOT, ORIGIN, M_PER_LAT, M_PER_LON, readJSON, writeJSON, hyp, polyLen, polyArea,
  centroid, bbox, distToLine, ptSeg, ptSegD, pointInPoly, polySD, alongLine, right,
  bearing, clamp, r1, ring1, offsetRing, lcg, simplifyDP, fitSimilarity,
} from './lib.mjs';

const osm = readJSON(path.join(ROOT, 'geobuild/osm-features.json'));
const hf = readJSON(path.join(ROOT, 'geobuild/heightfields.json'));
const card = readJSON(path.join(ROOT, 'banguide/guide-card.json')).holes;
const inv = readJSON(path.join(ROOT, 'banguide/guide-inventory.json')).holes;
const gpsRaw = readJSON(path.join(ROOT, 'geo_data/veckefjarden_clean.json'));

/* Geometry traced off the club's hole plans, if trace-plans.py has run. The tracer
   needs this script's output to know its anchors, so the pipeline is two passes:
   reconcile fixes the frame, the tracer reads the plans against it, and reconcile
   picks the traces up on the next run. Absent on the first pass, and that is fine --
   the six unmapped holes then fall back to the survey-and-guide synthesis. */
let TRACED = {};
try {
  TRACED = readJSON(path.join(ROOT, 'geobuild/traced-holes.json')).holes || {};
} catch { /* first pass */ }

/* Surroundings read off a georeferenced satellite screenshot (RMS 6.6 m) -- only
   the things OSM genuinely lacks: the clear-fells, the unmapped south parking lot,
   the machinery yard, the hayfields. OSM stays the authority everywhere it maps. */
let SURR = [];
try {
  SURR = readJSON(path.join(ROOT, 'geobuild/surroundings-traces.json')).features || [];
} catch { /* optional */ }
const traceRings = name => SURR.filter(f => f.name === name && f.world && f.world.length >= 3)
  .map(f => simplifyDP([...f.world, f.world[0]], 2).slice(0, -1).map(p => p.map(r1)));

/* Features derived from the 1 m laser terrain and the z18 orthoimagery
   (geobuild/derive-dtm-features.mjs -> dtm-features.json): bunkers as sand over a
   dish, the ditches that cross a playing line, and the flat decks under card tee
   marks. They outrank a plan reading and a guide placement, never an OSM outline. */
const DTM = (() => { try { return readJSON(path.join(ROOT, 'geobuild/dtm-features.json')); } catch { return { bunkers: [], ditches: [], decks: [] }; } })();
const dtmBunkers = n => (DTM.bunkers || []).filter(b => b.hole === n);
const dtmDecks = n => (DTM.decks || []).filter(d => d.hole === n);

/* The club's own local rules, transcribed (geobuild/course-rules.json): which colour
   its penalty areas are, and where its out-of-bounds stakes stand. */
const RULES = (() => { try { return readJSON(path.join(ROOT, 'geobuild/course-rules.json')); } catch { return null; } })();

/* the old page's prose and green rotations are worth keeping; its geometry is not */
const bg = await import('../banguide/lib.mjs');
const OLD = bg.load().HOLES;
/* The hålguide: geobuild/guide-notes.json (name, note per hole, the club's text kept under
   `club` for provenance) wins over the old page's HOLES prose when it has an entry. */
const NOTES = (() => { try { return readJSON(path.join(ROOT, 'geobuild/guide-notes.json')).holes || {}; } catch { return {}; } })();

const log = [];
const say = s => { console.log(s); log.push(s); };

/* --- the GPS survey in course metres ----------------------------------------- */
const G = {};
for (const f of gpsRaw.features) {
  const p = f.properties, [lo, la] = f.geometry.coordinates;
  (G[+p.hole] ||= {})[p.name] = [(lo - ORIGIN.lon) * M_PER_LON, -(la - ORIGIN.lat) * M_PER_LAT];
}
const teeOf = n => G[n]['TheTipsTee Back Reach'];
const grnOf = n => G[n]['Green Center'];
const tgtOf = n => G[n]['Tee Target'];

/* --- which OSM green is which hole ------------------------------------------- */
const greenOf = {};                       // hole -> osm green record
const usedGreen = new Set();
for (const g of osm.greens) {
  let best = null, bd = Infinity;
  for (let n = 1; n <= 18; n++) { const d = hyp(g.c, grnOf(n)); if (d < bd) { bd = d; best = n; } }
  if (bd <= 15 && !greenOf[best]) { greenOf[best] = g; usedGreen.add(g.id); g.hole = best; g.dist = bd; }
}
const mapped = Object.keys(greenOf).map(Number).sort((a, b) => a - b);
const unmapped = [];
for (let n = 1; n <= 18; n++) if (!greenOf[n]) unmapped.push(n);
say(`greens: ${mapped.length} matched to OSM outlines (holes ${mapped.join(',')})`);
say(`        ${unmapped.length} from the GPS survey only (holes ${unmapped.join(',')})`);
say(`        worst matched offset ${Math.max(...mapped.map(n => greenOf[n].dist)).toFixed(1)} m`);

/* The greens OSM has that no championship hole claims are the nine-hole short course
   plus the practice green by the clubhouse. They are real mown grass and get rendered
   as scenery; they are not holes. */
const scenGreens = osm.greens.filter(g => !usedGreen.has(g.id));

/* --- centre lines ------------------------------------------------------------- */
/* The OSM hole ways are a mapper's tracing of the playing line and are the best shape
   available, but several of them start at a forward tee rather than the championship
   one, so the first vertex is replaced by the surveyed back tee and the interior
   vertices are kept. Where there is no way at all, the aiming point stands in as the
   single dogleg vertex, and only when it actually bends the line: on the par 3s the
   survey collapses it onto the tee. */
const holeWayOf = {};
for (const w of osm.holeWays) {
  const end = w.line[w.line.length - 1];
  let best = null, bd = Infinity;
  for (let n = 1; n <= 18; n++) { const d = hyp(end, grnOf(n)); if (d < bd) { bd = d; best = n; } }
  if (bd <= 25 && !holeWayOf[best]) holeWayOf[best] = w;
}
say(`hole ways: ${Object.keys(holeWayOf).length} traced in OSM (holes ${Object.keys(holeWayOf).sort((a, b) => a - b).join(',')})`);

function rawLine(n) {
  const tee = teeOf(n), grn = greenOf[n] ? greenOf[n].c : grnOf(n);
  const w = holeWayOf[n];
  if (w) {
    const mid = w.line.slice(1, -1).filter(p => hyp(p, tee) > 40 && hyp(p, grn) > 30);
    return { line: [tee, ...mid, grn], src: mid.length ? 'osm-way' : 'osm-ends' };
  }
  const t = tgtOf(n);
  const direct = hyp(tee, grn), via = hyp(tee, t) + hyp(t, grn);
  if (hyp(t, tee) > 40 && via > direct * 1.012) return { line: [tee, t, grn], src: 'gps-target' };
  return { line: [tee, grn], src: 'gps-straight' };
}

/* The card length is the distance from the back tee to the green along the playing
   line, so the length is a statement about where the back tee is. Every drawn line
   comes out a few percent short of its card, and systematically so, because the
   survey's back-tee point is one point on a tee complex that can be thirty metres
   deep and because several holes have a championship tee behind the one the survey
   recorded. The green and the dogleg are the surveyed geometry and are left alone;
   the tee end slides back along its own axis until the polyline measures what the
   club prints. That is where a back tee is by definition.

   The slide is then checked against the mapped tee pads: if OSM has a pad sitting
   where this says the back tee should be, two independent records agree. */
function fitLength(line, target) {
  const L = line.map(p => p.slice());
  const rest = polyLen(L.slice(1));
  const A = L[0], P = L[1];
  const dx = A[0] - P[0], dz = A[1] - P[1];
  const d = Math.hypot(dx, dz);
  if (d < 1) return { line: L, slide: 0 };
  const want = target - rest;                       // how long the first leg must be
  const slide = want - d;
  L[0] = [P[0] + dx / d * want, P[1] + dz / d * want];
  return { line: L, slide };
}

/* --- assign the areal features to holes --------------------------------------- */
const lines = {};
for (let n = 1; n <= 18; n++) lines[n] = rawLine(n).line;

/* A feature belongs to the hole whose centre line it lies nearest, but only if it is
   near enough to be part of that hole at all; the rest is the short course, the range,
   or somebody's garden, and becomes scenery. */
function assign(features, maxDist, key = f => f.c || centroid(f.ring)) {
  const out = {}, spare = [];
  for (const f of features) {
    const c = key(f);
    let best = null, bd = Infinity;
    for (let n = 1; n <= 18; n++) { const d = distToLine(c[0], c[1], lines[n]); if (d < bd) { bd = d; best = n; } }
    if (bd <= maxDist) { (out[best] ||= []).push({ ...f, d: r1(bd) }); f.hole = best; }
    else spare.push(f);
  }
  return { out, spare };
}

const fair = assign(osm.fairways, 70);
const bunk = assign(osm.bunkers, 60);
const tee = assign(osm.tees, 75);
say(`fairways: ${Object.values(fair.out).flat().length} on championship holes, ${fair.spare.length} scenery`);
say(`bunkers:  ${Object.values(bunk.out).flat().length} on championship holes, ${bunk.spare.length} scenery`);
say(`tees:     ${Object.values(tee.out).flat().length} on championship holes, ${tee.spare.length} scenery`);

/* --- the green: outline, axis and size ---------------------------------------- */
/* Where OSM has an outline it is used as drawn. Where it does not, the survey's front,
   centre and back points give a real depth and a real axis to build an ellipse on --
   which is more than the old page's hand-entered radii had. */
function greenFor(n) {
  const g = greenOf[n];
  if (g) {
    const c = centroid(g.ring);
    let rx = 0;
    for (const p of g.ring) rx = Math.max(rx, hyp(p, c));
    return { ring: g.ring, c: c.map(r1), prov: 'osm', area: g.area, id: g.id };
  }
  /* traced off the club's own plan, when the tracer has run and found it */
  const tr = TRACED[n];
  if (tr?.green?.ring?.length >= 4) {
    const c = centroid(tr.green.ring);
    return { ring: ring1(tr.green.ring), c: c.map(r1), prov: 'plan',
             area: Math.round(Math.abs(polyArea(tr.green.ring))) };
  }
  const F = G[n]['Green Front'], C = grnOf(n), B = G[n]['Green Back'];
  const depth = Math.max(18, hyp(F, B));
  const b = Math.atan2(B[0] - F[0], B[1] - F[1]);
  const rz = depth / 2, rx = clamp(depth * 0.62, 11, 19);
  const ring = [];
  const rnd = lcg(0x9e37 + n);
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2;
    const w = 1 + (rnd() - 0.5) * 0.14;                    // greens are not ellipses
    const lx = Math.cos(a) * rx * w, lz = Math.sin(a) * rz * w;
    ring.push([r1(C[0] + lx * Math.cos(b) + lz * Math.sin(b)),
               r1(C[1] - lx * Math.sin(b) + lz * Math.cos(b))]);
  }
  return { ring, c: C.map(r1), prov: 'gps', area: Math.round(Math.abs(polyArea(ring))), depth: r1(depth), axis: r1(b * 180 / Math.PI) };
}

/* --- tees --------------------------------------------------------------------- */
/* Two different things share the name. The PADS are the mown decks you stand on, and
   OSM has 53 of them drawn as they really are; they get rendered as they are drawn.
   The MARKS are the six card distances, which are measurements rather than places:
   each is the point on the playing line that far from the green, and that is where a
   set of tee markers goes. Where a hole has no mapped pad near a mark -- the six holes
   OSM never mapped -- a pad is built around the mark, because the card length is
   measured from a tee that must therefore exist there. */
function teesFor(n, line) {
  const pads = (tee.out[n] || []).map(t => ({ ring: t.ring, c: (t.c || centroid(t.ring)).map(r1), prov: 'osm', id: t.id }));
  /* the flat decks the laser terrain shows under card marks OSM never mapped: a
     real prepared surface, so it stands in for the synthesised rectangle */
  for (const d of dtmDecks(n)) {
    if (pads.some(p => hyp(p.c, d.c) < 4)) continue;
    pads.push({ ring: ring1(d.ring), c: d.c.map(r1), prov: 'dtm', area: d.area, teeIdx: d.teeIdx });
  }
  const total = polyLen(line);
  const marks = [];
  for (let k = 0; k < 6; k++) {
    const want = card[n].t[k];
    const p = alongLine(line, clamp(1 - want / total, -0.15, 0.96));
    let bd = Infinity;
    for (const q of pads) bd = Math.min(bd, hyp(q.c, [p.x, p.z]));
    marks.push({ teeIdx: k, m: want, c: [r1(p.x), r1(p.z)], b: r1(p.b * 180 / Math.PI), padDist: bd < 1e8 ? r1(bd) : null });
  }
  /* build pads only where none is mapped within a tee-complex's own length */
  for (const mk of marks) {
    if (mk.padDist !== null && mk.padDist <= 30) continue;
    const b = mk.b * Math.PI / 180, R = right(b), F = [Math.sin(b), Math.cos(b)];
    const ring = [[-5.2, -4.4], [5.2, -4.4], [5.2, 4.4], [-5.2, 4.4]]
      .map(([u, v]) => [r1(mk.c[0] + R[0] * u + F[0] * v), r1(mk.c[1] + R[1] * u + F[1] * v)]);
    pads.push({ ring, c: mk.c, prov: 'synth', teeIdx: mk.teeIdx });
  }
  return { pads, marks };
}

/* --- fairway: outlines where mapped, traced where drawn, a corridor last ------ */
function fairwayFor(n, line) {
  const got = fair.out[n] || [];
  if (got.length) return { rings: got.map(f => f.ring), prov: 'osm', ids: got.map(f => f.id) };
  const tr = TRACED[n];
  if (tr?.fairways?.length) {
    /* keep the traced pieces that actually lie along this hole */
    const rings = tr.fairways
      .filter(f => distToLine(f.c[0], f.c[1], line) < 45 && f.area > 350)
      .map(f => ring1(f.ring));
    if (rings.length) return { rings, prov: 'plan' };
  }
  if (card[n].par === 3) return { rings: [], prov: 'none' };
  /* A corridor, tapered at both ends the way a mown fairway is, starting past the
     landing area and stopping short of the green so the collar can take over. */
  const total = polyLen(line);
  const f0 = clamp(52 / total, 0.05, 0.4), f1 = 1 - clamp(26 / total, 0.04, 0.3);
  const wid = card[n].par === 5 ? 27 : 24;
  const L = [], Rr = [];
  const N = 26;
  for (let i = 0; i <= N; i++) {
    const f = f0 + (f1 - f0) * i / N;
    const p = alongLine(line, f);
    const R = right(p.b);
    const t = i / N;
    const w = wid * (0.62 + 0.38 * Math.sin(Math.PI * clamp(t * 1.06, 0, 1)) ** 0.55);
    L.push([r1(p.x - R[0] * w), r1(p.z - R[1] * w)]);
    Rr.push([r1(p.x + R[0] * w), r1(p.z + R[1] * w)]);
  }
  return { rings: [[...Rr, ...L.reverse()]], prov: 'synth' };
}

/* --- bunkers ------------------------------------------------------------------ */
const SIZE = { small: [8, 5.5], medium: [11.5, 7.5], large: [15.5, 9.5] };
function bunkersFor(n, line) {
  const got = (bunk.out[n] || []).map(b => ({ ring: b.ring, c: (b.c || centroid(b.ring)).map(r1), prov: 'osm', id: b.id }));
  const want = (inv[n]?.bunkers) || [];
  /* Sand in the orthoimagery over a dish in the laser terrain: where the derivation
     found a hole's bunkers they replace every plan reading and guide placement on
     it -- the plan readings landed 2-7 m from them once re-anchored, the guide
     placements 8-40 m or on ground with no dish at all. OSM outlines are kept. */
  const dtm = dtmBunkers(n).filter(b => !got.some(o => hyp(o.c, b.c) < 8))
    .map(b => ({ ring: ring1(b.ring), c: b.c.map(r1), prov: 'dtm', area: b.area, dish: b.dish }));
  if (dtm.length) return got.concat(dtm);
  /* Once the terrain has been read, a guide placement with no dish under it is not a
     bunker: the three the guide placed measured -0.43, -0.20 and +0.13 m of "dish"
     and no sand, and the DTM found the real ones 8-19 m away or not at all. */
  if ((DTM.bunkers || []).length) return got;
  /* traced bunkers beat placed ones: real shapes in real places off the club's plan */
  const tr = TRACED[n];
  if (!got.length && tr?.bunkers?.length) {
    return tr.bunkers.map(b => ({ ring: ring1(b.ring), c: b.c.map(r1), prov: 'plan' }));
  }
  if (got.length >= want.length || !want.length) return got;
  /* Fill only what OSM is missing, and place it where the guide says: a fraction along
     the hole and a side, read through the page's own lateral normal so a filled bunker
     can never end up mirrored against a mapped one. */
  const out = got.slice();
  const rnd = lcg(0xB0FFE7 + n);
  for (const b of want) {
    if (out.length >= want.length) break;
    const f = clamp(b.approxFraction ?? 0.8, 0.12, 1.04);
    const p = alongLine(line, f);
    const R = right(p.b);
    const [rx, rz] = SIZE[b.size] || SIZE.medium;
    const green = greenFor(n);
    const gr = Math.max(...green.ring.map(q => hyp(q, green.c)));
    let lat = 0;
    if (b.side === 'left') lat = -(b.where === 'greenside' ? gr + 5 : 22);
    else if (b.side === 'right') lat = (b.where === 'greenside' ? gr + 5 : 22);
    else if (b.side === 'rear') lat = 0;
    const cx = p.x + R[0] * lat, cz = p.z + R[1] * lat;
    if (out.some(o => hyp(o.c, [cx, cz]) < Math.max(rx, rz) + 9)) continue;
    const ring = [];
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2;
      const w = 1 + (rnd() - 0.5) * 0.3;
      const lx = Math.cos(a) * rx * w, lz = Math.sin(a) * rz * w;
      ring.push([r1(cx + R[0] * lx + Math.sin(p.b) * lz), r1(cz + R[1] * lx + Math.cos(p.b) * lz)]);
    }
    out.push({ ring, c: [r1(cx), r1(cz)], prov: 'guide', side: b.side, where: b.where });
  }
  return out;
}

/* --- build -------------------------------------------------------------------- */
const holes = [];
say('\nhole par card  drawn   dev    slide  pad   line source   green  fw    pads  bunkers');
for (let n = 1; n <= 18; n++) {
  const raw = rawLine(n);
  const fitted = fitLength(raw.line, card[n].t[0]);
  const line = ring1(fitted.line);
  const drawn = polyLen(line);
  const dev = (drawn - card[n].t[0]) / card[n].t[0];
  /* independent check: is there a mapped tee pad where the slide put the back tee? */
  let padD = Infinity;
  for (const t of (tee.out[n] || [])) padD = Math.min(padD, hyp(t.c || centroid(t.ring), line[0]));
  const green = greenFor(n);
  const fw = fairwayFor(n, line);
  const tees = teesFor(n, line);
  const bunkers = bunkersFor(n, line);
  const old = OLD[n - 1];
  const nOsmTee = tees.pads.filter(t => t.prov === 'osm').length;
  const nOsmBk = bunkers.filter(b => b.prov === 'osm').length;
  say(`${String(n).padStart(4)} ${card[n].par}   ${String(card[n].t[0]).padStart(3)}  ${drawn.toFixed(0).padStart(5)}  ${(dev * 100).toFixed(2).padStart(6)}%  ${fitted.slide.toFixed(0).padStart(5)}  ${(padD < 999 ? padD.toFixed(0) : '-').padStart(4)}  ${raw.src.padEnd(12)} ${green.prov.padEnd(6)} ${fw.prov.padEnd(5)} ${String(nOsmTee).padStart(2)}/${String(tees.pads.length).padEnd(2)} ${nOsmBk}/${bunkers.length}`);
  holes.push({
    n, par: card[n].par, idx: card[n].hcp, t: card[n].t.slice(),
    line, lineLen: r1(drawn), lenDev: +(dev * 1000).toFixed(1) / 10, lineSrc: raw.src,
    teeSlide: r1(fitted.slide), teePadDist: padD < 999 ? r1(padD) : null,
    green, fairway: fw, tees, bunkers,
    pin: green.c,
    elev: hf.holeElev[n],
    name: NOTES[n]?.name ?? old?.name ?? null, note: NOTES[n]?.note ?? old?.note ?? null, sp: old?.sp || null,
    tiers: old?.tiers || 1,
    guideBearingDeg: inv[n]?.guideBearingDeg ?? null,
    guideGreen: inv[n]?.green || null, guideTrees: inv[n]?.trees || null,
    shape: inv[n]?.shape || null, orientation: inv[n]?.orientation || null,
  });
}

/* --- card integrity: the one thing that must be exact ------------------------- */
let bad = 0;
for (const h of holes) {
  const c = card[h.n];
  if (h.par !== c.par || h.idx !== c.hcp || h.t.some((v, i) => v !== c.t[i])) bad++;
}
say(`\ncard: ${bad ? `${bad} HOLES DISAGREE` : 'all 144 values match guide-card.json'}`);

const worst = holes.reduce((a, h) => Math.abs(h.lenDev) > Math.abs(a.lenDev) ? h : a);
say(`length: worst deviation hole ${worst.n} at ${worst.lenDev}%  (${holes.filter(h => Math.abs(h.lenDev) <= 0.5).length}/18 within 0.5%)`);

/* --- does the ground agree with the club's own printed rise? ------------------ */
/* This is the check that carries the most weight, because neither side can be tuned
   to please the other: the club printed "plays 28 m uphill" on its plan, and the
   elevation model was sampled at a tee and a green located by a GPS survey nobody
   involved had seen. If the survey put a hole in the wrong place the two would not
   agree, and on the thirteen holes that print a figure they agree to a few metres. */
const gh = readJSON(path.join(ROOT, 'geobuild/guide-holes.json')).holes;
let errs = [], bearErr = [];
for (const h of holes) {
  const g = gh[h.n];
  if (g?.elevM != null) {
    const d = h.elev.rise - g.elevM;
    errs.push(Math.abs(d));
    h.guideElevM = g.elevM; h.elevErr = r1(d);
  }
  if (g?.upDeg != null) {
    /* a compass bearing is atan2(dx, -dz), not atan2(dx, dz) -- north is -z here, and
       the reflected version looks plausible enough to have fooled this repo before */
    const A = h.line[0], Bp = h.line[h.line.length - 1];
    const deg = bearing(Bp[0] - A[0], Bp[1] - A[1]) * 180 / Math.PI;
    let dd = ((deg - g.upDeg) % 360 + 540) % 360 - 180;
    h.guideBearingDeg = g.upDeg; h.bearingErr = r1(dd);
    bearErr.push(Math.abs(dd));
  }
  h.shape = g?.shape || h.shape;
}
errs.sort((a, b) => a - b); bearErr.sort((a, b) => a - b);
say(`elevation: model vs the guide's printed rise on ${errs.length} holes — mean ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(1)} m, worst ${errs[errs.length - 1].toFixed(1)} m`);
say(`bearing:   drawn line vs the plans' compass roses on ${bearErr.length} holes — median ${bearErr[bearErr.length >> 1].toFixed(0)}°, worst ${bearErr[bearErr.length - 1].toFixed(0)}°`);

/* --- water -------------------------------------------------------------------- */
const levelById = Object.fromEntries(hf.water.map(w => [w.id, w.level]));
const water = osm.water.map(w => ({
  id: w.id, ring: w.ring, name: w.name, area: w.area,
  level: levelById[w.id] ?? hf.lakeLevel,
  isLake: w.id === hf.lakeId,
}));
/* --- the shorelines read off the laser ground (geobuild/laser-water.mjs) --------
   Laser does not penetrate water, so the 1 m DTM carries every water surface as a
   flat plate; the fjärd's is 0.280 m RH 2000, one plate, no flight-strip seam. The
   shoreline traced round it is 2 m-vertexed near the course and replaces the OSM
   ring inside the DTM window (spliced on the window boundary, OSM verbatim beyond
   it): median 2.0 m from the OSM shore near the course, p95 8.6 m, and two real
   corrections -- a 17 m chord error by the 3rd and the 45 m mole by the 15th's
   piers that OSM never drew. Every pond inside the window has a plate too, and its
   ring is the plate's outline; the 12th's pond is a dumbbell the laser splits in
   two lobes, carried as two bodies. LEVELS stay the heightfields' (Terrarium datum,
   which is the terrain the pack's water sits on -- the laser plate re-expressed in
   legacy metres lands 0.1-0.4 m from them); the laser reading is kept as
   levelLaser beside each. */
let LASER = null;
try { LASER = readJSON(path.join(ROOT, 'geobuild/laser-water.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; /* not run yet */ }
if (LASER) {
  const byId = Object.fromEntries((LASER.ponds || []).map(q => [q.id, q]));
  const extra = []; let lakeDone = false, pondsDone = 0;
  for (const w of water) {
    if (w.isLake && LASER.lake?.spliced?.length >= 3) {
      w.ring = ring1(LASER.lake.spliced); w.area = Math.round(polyArea(w.ring)); w.prov = 'laser';
      w.levelLaser = LASER.lake.levelLegacy; lakeDone = true;
    }
    const q = byId[w.id]; if (!q) continue;
    if (q.plateFound) w.levelLaser = q.levelLegacy;
    if (q.ringLaser && q.ringLaser.length >= 3) {
      w.ring = ring1(q.ringLaser); w.area = Math.round(polyArea(w.ring)); w.prov = 'laser'; pondsDone++;
      for (const [k, lobe] of (q.ringsLaser || []).slice(1).entries()) {
        const r = lobe.ring || lobe;
        extra.push({ id: `${w.id}-${String.fromCharCode(98 + k)}`, ring: ring1(r), name: w.name, area: Math.round(polyArea(ring1(r))),
                     level: w.level, isLake: false, prov: 'laser', levelLaser: q.levelLegacy, lobeOf: w.id });
      }
    }
  }
  water.push(...extra);
  say(`laser water: ${lakeDone ? 'fjärd shoreline spliced (' + LASER.lake.spliced.length + ' vertices, level ' + LASER.lake.levelLegacy + ' legacy vs ' + hf.lakeLevel + ' kept), ' : ''}${pondsDone} pond rings from the plate, ${extra.length} extra lobes`);
}
const streams = osm.waterway.filter(w => w.kind !== 'drain' || true).map(w => ({
  id: w.id, line: w.line, kind: w.kind, w: w.kind === 'stream' ? 2.2 : w.kind === 'ditch' ? 1.6 : 3.2,
}));
/* the ditches the laser terrain shows crossing the playing lines, which OSM has no
   waterway for; each carries the hole it crosses and how far from the green */
for (const [i, d] of (DTM.ditches || []).entries()) {
  streams.push({ id: `dtm-ditch-${i + 1}`, line: ring1(d.line), kind: 'ditch', w: 1.6, prov: 'dtm',
                 hole: d.hole, crossesAt: d.crossesAt ?? null, depth: d.meanDepth ?? null, note: d.note || null });
}
say(`water: ${water.length} bodies (lake at ${hf.lakeLevel} m, ${water.filter(w => !w.isLake).length} ponds ${Math.min(...water.filter(w => !w.isLake).map(w => w.level))}..${Math.max(...water.map(w => w.level))} m), ${streams.length} watercourses`);

/* --- penalty and boundary marking ---------------------------------------------
   The one rule that keeps this honest: red and yellow lines trace the margin of the
   water they mark, so a line can never drift away from its hazard the way a
   separately-stored one eventually does. White follows the club's own property
   polygon. The guide's inventory decides colour -- yellow where a hole's water is in
   play as a carry, red where it is lateral -- and which stretch matters is decided by
   distance to the corridors: a bank nobody plays along gets no stakes, exactly as on
   the ground.                                                                     */
const marking = [];
{
  const NEAR = 55;
  const nearestHole = (x, z) => {
    let best = null, bd = Infinity;
    for (const h of holes) { const d = distToLine(x, z, h.line); if (d < bd) { bd = d; best = h; } }
    return { h: best, d: bd };
  };
  /* does this hole's centre line cross the feature? crossing water is a carry */
  const crosses = (h, ring) => {
    for (let i = 0; i <= 30; i++) {
      const p = alongLine(h.line, i / 30);
      if (pointInPoly(p.x, p.z, ring)) return true;
    }
    return false;
  };
  const carryWanted = h => (inv[h.n]?.water || []).some(w => w.inPlay === 'carry');

  /* sample a ring at ~8 m, offset outward (onto dry land), keep near-corridor
     stretches, split where the gap says the stakes should stop */
  const runsAlongRing = (ring, offset) => {
    const ccw = polyArea(ring) > 0;
    const runs = []; let cur = null;
    const step = 11;
    let acc = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const seg = hyp(a, b);
      for (let d = acc; d < seg; d += step) {
        const t = d / seg;
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        let nx = (b[1] - a[1]), nz = -(b[0] - a[0]);
        const L = Math.hypot(nx, nz) || 1;
        nx /= L; nz /= L;
        if (ccw) { nx = -nx; nz = -nz; }
        const px = x + nx * offset, pz = z + nz * offset;
        const nh = nearestHole(px, pz);
        if (nh.d < NEAR) {
          if (!cur) { cur = { pts: [], hole: nh.h.n }; runs.push(cur); }
          cur.pts.push([r1(px), r1(pz)]);
        } else cur = null;
      }
      acc = (acc + seg) % step ? 0 : 0;
    }
    return runs.filter(r => r.pts.length >= 3);
  };

  /* The generic rule paints a carry yellow. This club abolished yellow in 2022:
     "Från och med 2022 har Veckefjärdens GC endast röda pliktområden" -- so the
     colour is the club's, read from its rules, and the carry rule is left for
     courses that still stake both. */
  const REDONLY = RULES?.penaltyAreas?.colour === 'red';
  for (const w of water) {
    for (const run of runsAlongRing(w.ring, 1.4)) {
      const h = holes[run.hole - 1];
      const color = !REDONLY && crosses(h, w.ring) && carryWanted(h) ? 'y' : 'r';
      marking.push({ color, hole: run.hole, pts: run.pts, of: w.id });
    }
  }
  /* streams: both banks where they run beside a corridor; the bank a hole must
     carry is yellow by the same rule */
  for (const st of streams) {
    for (const side of [-1, 1]) {
      let cur = null;
      for (let i = 0; i < st.line.length - 1; i++) {
        const a = st.line[i], b = st.line[i + 1];
        const seg = hyp(a, b);
        for (let d = 0; d < seg; d += 16) {
          const t = d / seg;
          const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
          let nx = (b[1] - a[1]), nz = -(b[0] - a[0]);
          const L = Math.hypot(nx, nz) || 1;
          const px = x + nx / L * side * (st.w + 1.4), pz = z + nz / L * side * (st.w + 1.4);
          const nh = nearestHole(px, pz);
          if (nh.d < 40) {
            if (!cur) { cur = { color: 'r', hole: nh.h.n, pts: [], of: st.id }; marking.push(cur); }
            cur.pts.push([r1(px), r1(pz)]);
          } else cur = null;
        }
      }
    }
  }
  /* White, from the club's own out-of-bounds list where it exists. Each entry names a
     hole, a side and what the stakes divide the hole from -- the range, the short
     course, the practice green, or the property line. The run is derived: along
     the hole on that side, snapped to the property polygon where it runs within
     reach, otherwise half way to the named neighbour, otherwise at the edge of
     the rough; behind or around a green as an arc past the collar. A statement of
     where the club stakes its course, drawn onto the geometry it has. */
  const rulesOB = RULES?.outOfBounds?.holes || null;
  if (rulesOB) {
    const neighbours = {
      range: osm.drivingRange.map(d => d.ring),
      korthalsbanan: scenGreens.map(g => g.ring).concat(fair.spare.map(f => f.ring), tee.spare.map(t => t.ring)),
      'practice-green': scenGreens.filter(g => hyp(g.c, [234, -465]) < 140).map(g => g.ring),
    };
    const nearestOn = (rings, x, z, dirx, dirz) => {
      /* nearest point of any ring that lies ahead of (x,z) along (dirx,dirz) */
      let bd = Infinity;
      for (const r of rings) for (const q of r) {
        const dx = q[0] - x, dz = q[1] - z, d = Math.hypot(dx, dz);
        if (d < 1 || (dx * dirx + dz * dirz) / d < 0.5) continue;
        if (d < bd) bd = d;
      }
      return bd;
    };
    const mownEdge = (h, x, z, dirx, dirz) => {
      /* how far out on this side the hole's own mown ground reaches */
      let e = 0;
      for (let d = 2; d <= 40; d += 2) {
        const px = x + dirx * d, pz = z + dirz * d;
        if (h.fairway.rings.some(r => pointInPoly(px, pz, r)) || pointInPoly(px, pz, h.green.ring)) e = d;
      }
      return Math.max(e, 12);
    };
    const bnd = osm.courseBoundary?.ring || null;
    const greenR = h => Math.max(...h.green.ring.map(q => hyp(q, h.green.c)));
    for (const [hn, entries] of Object.entries(rulesOB)) {
      const h = holes[+hn - 1];
      if (!h) continue;
      const total = polyLen(h.line);
      for (const e of entries) {
        const pts = [];
        if (e.side === 'left' || e.side === 'right') {
          const sign = e.side === 'right' ? 1 : -1;
          let s0 = 0, s1 = total;
          if (e.fromToGreen != null) s0 = Math.max(0, total - e.fromToGreen);
          if (e.toToGreen != null) s1 = total - e.toToGreen;
          if (e.from === 'level-with-green') s0 = total - greenR(h) - 8;
          for (let sd = s0; sd <= s1; sd += 9) {
            const p = alongLine(h.line, sd / total);
            const R = right(p.b);
            const dirx = R[0] * sign, dirz = R[1] * sign;
            const edge = mownEdge(h, p.x, p.z, dirx, dirz);
            let off = edge + 6;
            let snapped = null;
            if (bnd) {
              let bd = Infinity;
              for (const q of bnd) {
                const dx = q[0] - p.x, dz = q[1] - p.z, d = Math.hypot(dx, dz);
                if (d < 6 || (dx * dirx + dz * dirz) / d < 0.6) continue;
                if (d < bd) { bd = d; snapped = q; }
              }
              if (bd > 95) snapped = null;
            }
            if (snapped) { pts.push([r1(snapped[0]), r1(snapped[1])]); continue; }
            if (e.toward && neighbours[e.toward]) {
              const dn = nearestOn(neighbours[e.toward], p.x, p.z, dirx, dirz);
              if (dn < 120) off = clamp(dn / 2, edge + 3, 60);
            }
            pts.push([r1(p.x + dirx * off), r1(p.z + dirz * off)]);
          }
        } else if (e.side === 'behind-green' || e.side === 'around-green') {
          const c = h.green.c, rad = greenR(h) + (e.side === 'around-green' ? 14 : 16);
          const p = alongLine(h.line, 0.97);
          const a0 = e.side === 'around-green' ? 0 : Math.PI / 2, a1 = e.side === 'around-green' ? Math.PI * 2 : Math.PI * 1.5;
          for (let a = a0; a <= a1 + 1e-6; a += (a1 - a0) / (e.side === 'around-green' ? 22 : 9)) {
            /* angle measured from the hole's forward direction: behind the green is a = PI */
            const fx = Math.sin(p.b), fz = Math.cos(p.b), R = right(p.b);
            const ux = fx * Math.cos(a) + R[0] * Math.sin(a), uz = fz * Math.cos(a) + R[1] * Math.sin(a);
            pts.push([r1(c[0] + ux * rad), r1(c[1] + uz * rad)]);
          }
        }
        const dry = pts.filter(q => !water.some(w => Math.abs(polySD(q[0], q[1], w.ring)) < 4 && pointInPoly(q[0], q[1], w.ring)));
        if (dry.length >= 3) marking.push({ color: 'w', hole: +hn, pts: dry, of: 'rules:' + (e.toward || e.side), quote: e.quote });
      }
    }
  } else if (osm.courseBoundary) {
    const whiteHoles = new Set(
      Object.entries(inv).filter(([, v]) => (v.boundaries || []).some(b => b.colour === 'white'))
        .map(([k]) => +k));
    for (const run of runsAlongRing(osm.courseBoundary.ring, -1.0)) {
      if (!whiteHoles.has(run.hole)) continue;
      const pts = run.pts.filter(p => !water.some(w => Math.abs(polySD(p[0], p[1], w.ring)) < 12));
      if (pts.length >= 3) marking.push({ color: 'w', hole: run.hole, pts, of: 'boundary' });
    }
  }
  /* two features sharing a bank -- the lake and an arm of it, the pond and the
     boundary -- each contribute a run along the same ground; one stake per spot */
  const taken = [];
  for (const m of marking) {
    m.pts = m.pts.filter(p => {
      for (const q of taken) if (hyp(p, q) < 5) return false;
      taken.push(p);
      return true;
    });
  }
  for (let i = marking.length - 1; i >= 0; i--) if (marking[i].pts.length < 3) marking.splice(i, 1);
  /* the white runs of the generic path duplicate nothing here: the rules path
     replaces them wholesale, so a stake never stands twice */
  const count = c => marking.filter(m => m.color === c).length;
  const stakes = marking.reduce((a, m) => a + m.pts.length, 0);
  say(`marking: ${marking.length} runs (${count('r')} red, ${count('y')} yellow, ${count('w')} white), ${stakes} stakes; guide lists 63 runs`);
}

/* --- the model ---------------------------------------------------------------- */
const model = {
  version: 1,
  origin: { lat: ORIGIN.lat, lon: ORIGIN.lon },
  mPerLat: M_PER_LAT, mPerLon: +M_PER_LON.toFixed(2),
  frame: 'north=-z, east=+x, bearing=atan2(dx,-dz), right=(-cos b, sin b)',
  lakeLevel: hf.lakeLevel,
  holes,
  water, streams, marking,
  boundary: osm.courseBoundary ? osm.courseBoundary.ring : null,
  vegetation: {
    forest: osm.forest.map(f => f.ring),
    wood: osm.wood.map(f => f.ring),
    scrub: osm.scrub.map(f => f.ring),
    wetland: osm.wetland.map(f => f.ring),
    sand: osm.sand.map(f => f.ring),
    rock: osm.rock.map(f => f.ring),
  },
  infra: {
    paths: osm.paths.map(p => ({ line: p.line, kind: p.kind, surface: p.surface || null })),
    tracks: osm.tracks.map(p => ({ line: p.line, kind: p.kind, surface: p.surface || null })),
    roads: osm.roads.map(p => ({ line: p.line, kind: p.kind, name: p.name || null,
      surface: p.surface || null, lanes: p.lanes || null, oneway: !!p.oneway,
      maxspeed: p.maxspeed || null, lit: !!p.lit })),
    buildings: osm.buildings.map(b => ({ ring: b.ring, h: b.h, kind: b.kind, name: b.name }))
      .concat(SURR.filter(f => f.kind === 'building' && f.world && f.world.length >= 3)
        .map(f => ({ ring: f.world.map(p => p.map(r1)), h: null, kind: 'yes', name: null, prov: 'trace', trace: f.name }))),
    farB: osm.farBuildings || [],
    parking: (osm.parking || []).map(p => ({ ring: p.ring, surface: p.surface || null, prov: 'osm' }))
      .concat(traceRings('parking-clubhouse-south').map(ring => ({ ring, surface: null, prov: 'trace' }))),
    piers: osm.piers || [],
    power: osm.power || { lines: [], towers: [], poles: [] },
    railway: osm.railway || [],
    landuse: (osm.landuse || []).map(l => ({ ring: l.ring, kind: l.kind })),
    reserves: (osm.reserves || []).map(r => ({ ring: r.ring, name: r.name })),
  },
  surround: {
    clearfells: traceRings('clearfell-1').concat(traceRings('clearfell-2')),
    yard: traceRings('gravel-yard')[0] || null,
    hayfields: traceRings('as-hayfields-W')[0] || null,
    shallows: traceRings('mudflat-1').concat(traceRings('mudflat-2')),
  },
  scenery: {
    greens: scenGreens.map(g => g.ring),
    fairways: fair.spare.map(f => f.ring),
    tees: tee.spare.map(t => t.ring),
    bunkers: bunk.spare.map(b => b.ring),
    grass: osm.grass.map(g => g.ring),
    range: osm.drivingRange.map(d => d.ring),
  },
};

const dest = path.join(ROOT, 'geobuild/course-model.json');
writeJSON(dest, model);

say(`\nwrote ${path.relative(process.cwd(), dest)}`);
writeJSON(path.join(ROOT, 'geobuild/reconcile-report.json'), { log });
