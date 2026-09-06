/* Build a nine-hole course that SHARES ITS GROUND with a parent build.

   usage: node tools/build-nine.mjs <config.json>
     e.g. node tools/build-nine.mjs johannesbergbuild/nio.json

   Three courses in this repo are a second course on a club's own land: Upsala's
   Mellanbanan, Johannesberg's Donald Steel nine, and Veckefjarden's par-3
   korthalsbana. They arrive by the same route and are therefore built by one
   tool rather than three near-identical reconcile scripts:

     a verified card  +  published GPS hole routes  +  the parent's environment

   What each contributes, and what none of them is allowed to become:

   - The CARD is the displayed length. The provisional route start is slid until
     the polyline measures its printed back-tee distance. This is a modelling
     assumption, not evidence for the physical deck or daily marker position.
   - The ROUTES are the shape and the direction. They are published third-party
     geometry, not a club survey, so their endpoints stay provisional and are
     never relabelled as a surveyed green centre. What they are good for is the
     routing -- which corridor is which hole, and which way it plays.
   - The PARENT is the place. Terrain, water, woods, roads, buildings and the
     clubhouse are the same ground and are reused verbatim; the parent's own
     holes are carried into `scenery` so its mown turf still reads as mown when
     you stand on the nine. That is symmetric, and it is what M.scenery is for.

   Unreviewed surfaces are synthesised around the routes and marked prov:"synth".
   Reviewed outlines can replace them. cfg.inferPads=false suppresses inferred
   decks; cfg.reviewedTees imports physical surfaces without assigning colours. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { applyReviewedNineTees } from './apply-reviewed-nine-tees.mjs';
import { applyReviewedNineFairways } from './apply-reviewed-nine-fairways.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const cfgPath = process.argv[2];
if (!cfgPath) { console.error('usage: build-nine.mjs <config.json>'); process.exit(2); }
const cfg = readJSON(path.resolve(ROOT, cfgPath));
/* the nine's hålguide, a guide-notes.json like the eighteens' (cfg.guideNotes, repo-relative) */
const NOTES = cfg.guideNotes ? (readJSON(path.resolve(ROOT, cfg.guideNotes)).holes || {}) : {};

const parent = readJSON(path.join(ROOT, cfg.parentBuild, 'course-model.json'));
/* Optional measured shapes (cfg.shapes -> <build>/trace-nine.mjs output): a hole
   whose green was ACCEPTED by the tracer's rules takes the traced ring and centre
   (the route is re-ended there before the card slide, so the length still measures
   the card), and its accepted bunkers. Everything not accepted stays synthesised. */
const SHAPES = cfg.shapes ? readJSON(path.resolve(ROOT, cfg.shapes)) : null;
const REVIEWED_GREENS = cfg.reviewedGreens ? readJSON(path.resolve(ROOT, cfg.reviewedGreens)).features : [];
const shapeOf = n => SHAPES?.holes?.find(h => h.hole === n) || null;
/* Optional laser-terrain readings (cfg.laserShapes): green centres and radii, and
   bunker centres, read off a hillshade of the 1 m DTM where the imagery showed
   nothing. Used only where no imagery-traced green was accepted; the ring is the
   synthesiser's ellipse at the measured place, prov:"laser". */
const LASER = cfg.laserShapes ? readJSON(path.resolve(ROOT, cfg.laserShapes)) : null;
const card = readJSON(path.resolve(ROOT, cfg.card));
const geo = readJSON(path.resolve(ROOT, cfg.routes));

/* ---- the parent's frame, so a lon/lat becomes the same metre it always was -- */
const { lat: OLAT, lon: OLON } = parent.origin;
const toWorld = ([lon, lat]) => [(lon - OLON) * parent.mPerLon, -(lat - OLAT) * parent.mPerLat];

/* ---- real ground height, decoded from the parent's own heightfield ----------
   The HUD prints "Spelas N m uppfor" from h.elev, so a placeholder here is a
   false statement about the hole. h.elev is {tee, green, rise}; a number breaks
   drawCard. The field is deflate-raw, then two byte planes, then zigzag deltas
   against a Paeth predictor -- decodeHF inverted. Reading it as plain
   little-endian pairs yields a perfectly flat course, which is what a wrong
   decode looks like when it does not throw.                                   */
const hf = readJSON(path.join(ROOT, cfg.parentBuild, 'heightfields.json')).hf0;
const heights = (() => {
  const raw = zlib.inflateRawSync(Buffer.from(hf.b64, 'base64'));
  const { nx, nz, h0, hs } = hf, n = nx * nz;
  const out = new Float32Array(n), q = new Int32Array(n);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const zz = raw[k] | (raw[n + k] << 8);
    const d = (zz >>> 1) ^ -(zz & 1);
    const a = i ? q[k - 1] : 0;
    const b = j ? q[k - nx] : (i ? q[k - 1] : 0);
    const c = (i && j) ? q[k - nx - 1] : b;
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    q[k] = ((pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)) + d;
    out[k] = h0 + q[k] * hs;
  }
  return out;
})();
const groundAt = (x, z) => {
  const fx = (x - hf.x0) / hf.dx, fz = (z - hf.z0) / hf.dx;
  const i = Math.max(0, Math.min(hf.nx - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(hf.nz - 2, Math.floor(fz)));
  const tx = fx - i, tz = fz - j, k = j * hf.nx + i;
  const a = heights[k], b = heights[k + 1], c = heights[k + hf.nx], d = heights[k + hf.nx + 1];
  return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
};

/* ---- geometry ---------------------------------------------------------------- */
const hyp = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const polyLen = l => { let s = 0; for (let i = 1; i < l.length; i++) s += hyp(l[i - 1], l[i]); return s; };
const rnd = p => [+p[0].toFixed(1), +p[1].toFixed(1)];

/* Slide the TEE end along the line's own axis until the polyline measures the
   card. Too long trims from the start (walking the polyline, so a slide past a
   bend is still a point on the hole); too short extends back along the first
   segment's direction, which is where a back tee is by definition. */
function setLength(line, target) {
  const L = polyLen(line);
  if (Math.abs(L - target) < 0.05) return { line: line.map(p => p.slice()), slide: 0 };
  if (L > target) {
    let need = L - target;
    const out = line.map(p => p.slice());
    while (out.length > 2 && hyp(out[0], out[1]) <= need) { need -= hyp(out[0], out[1]); out.shift(); }
    const seg = hyp(out[0], out[1]), t = need / seg;
    /* A trim that eats the last segment would place the new tee PAST the green
       and silently flip the hole end for end -- a wrong result that still
       measures the card length, which is the dangerous kind. It has never fired
       (the worst real trim leaves a 7.6 m segment) and it must never pass
       quietly if it does. */
    if (t >= 1) throw new Error(`slide of ${(L - target).toFixed(1)} m consumes the whole route ` +
      `(${L.toFixed(1)} m) down to ${target} m -- the hole would flip; check the route/card pairing`);
    out[0] = [out[0][0] + (out[1][0] - out[0][0]) * t, out[0][1] + (out[1][1] - out[0][1]) * t];
    return { line: out, slide: -(L - target) };
  }
  const out = line.map(p => p.slice());
  const seg = hyp(out[0], out[1]);
  const ux = (out[0][0] - out[1][0]) / seg, uz = (out[0][1] - out[1][1]) / seg;
  const need = target - L;
  out[0] = [out[0][0] + ux * need, out[0][1] + uz * need];
  return { line: out, slide: need };
}

const ellipse = (c, rx, rz, rot, n = 16) => {
  const co = Math.cos(rot), si = Math.sin(rot), out = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, x = Math.cos(a) * rx, z = Math.sin(a) * rz;
    out.push(rnd([c[0] + x * co - z * si, c[1] + x * si + z * co]));
  }
  return out;
};

/* ---- read the published routes ------------------------------------------------ */
const routes = {}, pubTee = {};
for (const f of geo.features) {
  const p = f.properties, n = p.hole;
  if (p.role === 'published_hole_route') routes[n] = f.geometry.coordinates.map(toWorld);
  else if (/_tee$/.test(p.role || '')) (pubTee[n] = pubTee[n] || {})[p.role] = toWorld(f.geometry.coordinates);
}
const missing = card.holes.map(h => h.n).filter(n => !routes[n]);
if (missing.length) throw new Error('no published route for hole(s) ' + missing.join(', '));

/* ---- the holes ---------------------------------------------------------------- */
const report = [];
let holes = card.holes.map(h => {
  const shape = shapeOf(h.n);
  const reviewed = REVIEWED_GREENS.find(g => g.hole === h.n);
  const tracedGreen = reviewed || (shape?.green?.accepted ? shape.green : null);
  const laserGreen = !tracedGreen && LASER?.greens?.[h.n] ? LASER.greens[h.n] : null;
  const raw = routes[h.n].map(p => p.slice());
  if (reviewed && JSON.stringify(rnd(raw.at(-1))) !== JSON.stringify(reviewed.originalC)) throw new Error(`hole ${h.n}: reviewed route reference changed`);
  if (tracedGreen) raw[raw.length - 1] = tracedGreen.c.slice();
  else if (laserGreen) raw[raw.length - 1] = laserGreen.c.slice();
  const back = h.t[0];                         /* the card's back tee, hole by hole */
  const { line: L, slide } = setLength(raw, back);
  const tee = L[0], green = L[L.length - 1];
  const b = Math.atan2(green[0] - tee[0], -(green[1] - tee[1]));   /* north is -z */
  const F = [Math.sin(b), -Math.cos(b)], R = [-Math.cos(b), Math.sin(b)];

  const gr = h.par === 3 ? 13 : h.par === 5 ? 15 : 14;
  const greenRing = reviewed ? structuredClone(reviewed.ring) : tracedGreen ? tracedGreen.ring.map(rnd) : laserGreen ? ellipse(green, laserGreen.r, laserGreen.r * 0.85, b) : ellipse(green, gr, gr * 0.78, b);
  const tracedBunkers = [
    ...(shape?.bunkers || []).filter(b => b.accepted).map(b => ({ ring: b.ring.map(rnd), prov: 'sat' })),
    ...((LASER?.bunkers?.[h.n]) || []).map(lb => ({ ring: ellipse(lb.c, lb.r, lb.r * 0.8, b, 10), prov: 'laser' })),
  ];

  /* a corridor from 42 m out to the green's front, narrowing in. Par 3s get
     none, which is what a par 3 has. */
  const rings = [];
  if (h.par > 3) {
    const from = 42, to = Math.max(50, polyLen(L) - 18);
    const halfW = h.par === 5 ? 21 : 19;
    const pts = [];
    for (const dw of [[from, halfW * 0.8], [(from + to) / 2, halfW], [to, halfW * 0.72]]) {
      const d = dw[0], w = dw[1];
      pts.push([[tee[0] + F[0] * d + R[0] * w, tee[1] + F[1] * d + R[1] * w],
                [tee[0] + F[0] * d - R[0] * w, tee[1] + F[1] * d - R[1] * w]]);
    }
    rings.push([...pts.map(p => p[0]), ...pts.reverse().map(p => p[1])].map(rnd));
  }

  /* Provisional markers follow card distance along the axis. If requested,
     inferred pads accompany them. Reviewed decks are imported independently
     below; the scorecard cannot establish their boundaries or colour ownership. */
  const pads = [], marks = [];
  h.t.forEach((len, k) => {
    const c = rnd([green[0] - F[0] * len, green[1] - F[1] * len]);
    if (cfg.inferPads !== false) pads.push({ ring: ellipse(c, 6.5, 4.6, b, 8), c, prov: 'synth', teeIdx: k });
    marks.push({ teeIdx: k, m: len, c, b: +(b * 180 / Math.PI).toFixed(1) });
  });

  const te = groundAt(tee[0], tee[1]), ge = groundAt(green[0], green[1]);
  report.push({ n: h.n, slide, routeLen: polyLen(raw), pub: pubTee[h.n], backC: marks[0]?.c ?? rnd(tee) });
  return {
    n: h.n, par: h.par, idx: h.hcp, t: h.t,
    line: L.map(rnd), lineLen: +polyLen(L).toFixed(1), lenDev: 0,
    lineSrc: cfg.lineSrc,
    green: { ring: greenRing, c: rnd(green), prov: reviewed ? 'dated-orthophoto-trace' : tracedGreen ? 'sat' : laserGreen ? 'laser' : 'synth',
             ...(reviewed ? { sourceId: reviewed.id, observedYear: reviewed.observedYear, sourceAbsoluteHorizontalAccuracyMetres: null, boundaryInterpretationUncertaintyMetres: reviewed.boundaryInterpretationUncertaintyMetres, centreProvenance: reviewed.centreProvenance } : {}),
             area: tracedGreen ? tracedGreen.area : laserGreen ? Math.round(Math.PI * laserGreen.r * laserGreen.r * 0.85) : Math.round(Math.PI * gr * gr * 0.78) },
    fairway: { rings, prov: 'synth' },
    tees: { pads, marks, ...(cfg.inferPads === false ? { inferPads: false } : {}) },
    bunkers: tracedBunkers,
    pin: rnd(green),
    elev: { tee: +te.toFixed(1), green: +ge.toFixed(1), rise: +(ge - te).toFixed(1) },
    tiers: 1,
    /* a nine's hålguide: cfg.holes[n] = { name, note, club } (club is the verbatim source text,
       kept for provenance and not carried into the model), else the older names/notes maps */
    name: NOTES[h.n]?.name ?? cfg.holes?.[h.n]?.name ?? (cfg.names || {})[h.n] ?? null,
    note: NOTES[h.n]?.note ?? cfg.holes?.[h.n]?.note ?? (cfg.notes || {})[h.n] ?? null,
    conf: cfg.conf,
  };
});

/* A reviewed parent source may replace an inferred outline while its existing
   route endpoint remains provisional. Refuse stale ownership if the pin is not
   inside the selected source polygon; do not move routing to make it fit. */
for (const [number, sourceId] of Object.entries(cfg.greenSourceIds || {})) {
  const hole = holes.find(h => h.n === +number);
  const source = (parent.scenery.sourceFeatures || []).find(f => f.id === sourceId && f.kind === 'green');
  if (!hole || !source) throw new Error(`missing reviewed green association ${number}: ${sourceId}`);
  const [x, z] = hole.green.c, ring = source.ring;
  let inside = false, twiceArea = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    twiceArea += b[0] * a[1] - a[0] * b[1];
  }
  if (!inside) throw new Error(`reviewed green ${sourceId} does not contain hole ${number}'s provisional pin`);
  hole.green = { ...hole.green, ring: structuredClone(ring), area: Math.round(Math.abs(twiceArea) / 2), prov: source.prov, sourceId, positionalAccuracyMetres: null };
}

/* Physical platforms were reviewed against the archived source-route model.
   Apply after green reconciliation, before scenery deduplication. Current
   card-derived markers are provisional and do not control deck geometry. */
if (cfg.reviewedTees) {
  const evidence = readJSON(path.resolve(ROOT, cfg.reviewedTees));
  holes = applyReviewedNineTees({ origin: parent.origin, mPerLat: parent.mPerLat, mPerLon: parent.mPerLon, holes },
    { evidence, sourceRoutes: geo, card }).holes;
}
if (cfg.reviewedFairways) {
  holes = applyReviewedNineFairways({ origin: parent.origin, mPerLat: parent.mPerLat, mPerLon: parent.mPerLon, holes },
    readJSON(path.resolve(ROOT, cfg.reviewedFairways))).holes;
}

/* ---- the parent's holes become scenery ----------------------------------------- */
/* The relationship is symmetric: the parent's reconcile may carry THIS nine's holes
   in its own scenery (Johannesberg does), and those rings must not come back here
   as scenery on top of the nine's real holes. A parent scenery ring whose centroid
   lies within 3 m of one of this nine's own rings is the same ring, and is dropped. */
const cen = r => { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; };
const own = [
  ...holes.map(h => h.green.ring), ...holes.flatMap(h => h.fairway.rings),
  ...holes.flatMap(h => h.tees.pads.map(p => p.ring)), ...holes.flatMap(h => h.bunkers.map(b => b.ring)),
].map(cen);
const notOwn = rings => (rings || []).filter(r => { const c = cen(r); return !own.some(o => Math.hypot(o[0] - c[0], o[1] - c[1]) < 3); });
const P = parent.scenery || {};
const scenery = {
  greens: [...notOwn(P.greens), ...parent.holes.map(h => h.green.ring)],
  fairways: [...notOwn(P.fairways), ...parent.holes.flatMap(h => h.fairway.rings)],
  tees: [...notOwn(P.tees), ...parent.holes.flatMap(h => h.tees.pads.map(p => p.ring))],
  bunkers: [...notOwn(P.bunkers), ...parent.holes.flatMap(h => h.bunkers.map(x => x.ring))],
  grass: P.grass || [], range: P.range || [],
  ...(P.mappedFeatures ? { mappedFeatures: P.mappedFeatures } : {}),
  ...(P.woodlandContext ? { woodlandContext: P.woodlandContext } : {}),
  ...(P.sourceFeatures ? { sourceFeatures: P.sourceFeatures } : {}),
  ...(P.retiredSourceFeatures ? { retiredSourceFeatures: P.retiredSourceFeatures } : {}),
  ...(P.practiceGreens ? { practiceGreens: P.practiceGreens } : {}),
  ...(P.rangeFacilities ? { rangeFacilities: P.rangeFacilities } : {}),
  ...(P.cartPark ? { cartPark: P.cartPark } : {}),
};
const dropped = (P.greens || []).length + (P.fairways || []).length + (P.tees || []).length + (P.bunkers || []).length
  - (notOwn(P.greens).length + notOwn(P.fairways).length + notOwn(P.tees).length + notOwn(P.bunkers).length);
if (dropped) console.log('parent scenery: ' + dropped + ' rings were this nine\'s own holes carried back; dropped');

/* Carry the parent's schema through verbatim. Veckefjarden's is the older one
   (lakeLevel, marking, surround, a sponsor line per hole) and its extras are the
   only non-empty ones in the repo; a nine on that ground must keep them or the
   fjard loses its penalty marking and its silt shallows. */
const model = {
  version: parent.version,
  origin: parent.origin, mPerLat: parent.mPerLat, mPerLon: parent.mPerLon, frame: parent.frame,
  card: card.holes.map(h => ({ n: h.n, par: h.par, hcp: h.hcp, t: h.t })),
  holes,
  water: parent.water, streams: parent.streams, coast: parent.coast,
  vegetation: parent.vegetation, infra: parent.infra, pois: parent.pois,
  scenery,
  note: cfg.note,
};
if (parent.seaLevel !== undefined) model.seaLevel = parent.seaLevel;
if (parent.lakeLevel !== undefined) model.lakeLevel = parent.lakeLevel;
if (parent.marking) model.marking = parent.marking;
if (parent.surround) model.surround = parent.surround;

const outDir = path.join(ROOT, cfg.outBuild);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'course-model.json'), JSON.stringify(model) + '\n');
fs.writeFileSync(path.join(outDir, 'card.json'), JSON.stringify(card, null, 2) + '\n');
/* the ground is the parent's ground; a pack is self-contained by design, so each
   course carries its own copy rather than inventing a shared-asset mechanism */
for (const f of ['heightfields.json', 'tree-cover.json']) {
  const src = path.join(ROOT, cfg.parentBuild, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, f));
}

/* ---- the report, which is the point of running this ---------------------------- */
const N = holes.length;
console.log(cfg.slug + ': ' + N + ' holes, par ' + holes.reduce((s, h) => s + h.par, 0));
console.log('\nhole  par  card  route   slide    drawn    rise   nearest published tee point');
let maxDev = 0;
for (const h of holes) {
  const r = report.find(x => x.n === h.n);
  maxDev = Math.max(maxDev, Math.abs(h.lineLen - h.t[0]));
  let pub = '';
  if (r.pub) {
    const ks = Object.keys(r.pub);
    const d = Math.min(...ks.map(k => hyp(r.pub[k], r.backC)));
    const best = ks.find(k => Math.abs(hyp(r.pub[k], r.backC) - d) < 1e-9);
    pub = d.toFixed(0) + ' m  (' + best.replace('_tee', '') + ', of ' + ks.length + ' published)';
  }
  console.log(String(h.n).padStart(4) + String(h.par).padStart(5) + String(h.t[0]).padStart(6) +
    r.routeLen.toFixed(0).padStart(7) + ((r.slide >= 0 ? '+' : '') + r.slide.toFixed(1)).padStart(8) +
    h.lineLen.toFixed(1).padStart(9) + ((h.elev.rise >= 0 ? '+' : '') + h.elev.rise.toFixed(1)).padStart(8) + '   ' + pub);
}
console.log('\nworst length deviation from the card: ' + maxDev.toFixed(2) + ' m');
/* The first physical deck is an ordering detail, not the back-tee marker. */
const walks = holes.map((h, i) => hyp(h.green.c, holes[(i + 1) % N].tees.marks[0]?.c ?? holes[(i + 1) % N].line[0]));
const sw = [...walks].sort((a, b) => a - b);
const close = walks[N - 1];
console.log('walk green->next tee: median ' + sw[Math.floor(N / 2)].toFixed(0) + ' m, range ' +
  sw[0].toFixed(0) + '-' + sw[N - 1].toFixed(0) + ' m;  green ' + N + ' -> tee 1 is ' + close.toFixed(0) +
  ' m, so the loop ' + (close < 150 ? 'CLOSES' : 'does NOT close'));
console.log('scenery from the parent: ' + scenery.greens.length + ' greens, ' + scenery.fairways.length +
  ' fairway rings, ' + scenery.tees.length + ' tee pads');
console.log('wrote ' + cfg.outBuild + '/course-model.json  (+ card.json, heightfields.json, tree-cover.json)');
