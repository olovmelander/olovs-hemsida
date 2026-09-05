#!/usr/bin/env node
/* Fold the rule-traced surfaces (surface-traces.json) and the laser ditches
   (laser-ditches.json) into the course model.

   Greens: the accepted collar-bounded outline replaces the synthetic ellipse;
   the surveyed centre stays. Fairways: the mown mask by hole replaces the
   route corridor. Routing: each hole's line is the traced corridor route, its
   card marks at the card distance along it, snapped onto measured decks;
   the decks are the tee pads (a mark without a deck gets its pad synthesised
   by the app, as on every other course). Streams: the traced ditches re-laid
   on the laser, plus the crossings the laser found under the routes.

   Idempotent -- everything here is derived from the two trace files and the
   surveyed centres, never from what a previous run wrote. Order:
     build-course -> apply-sat-shapes -> trace-surfaces -> laser-ditches
       -> apply-surface-traces -> apply-surroundings                       */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { polyArea, polyLen, r1 } from '../geobuild/lib.mjs';
import { loadTerrain } from './laser-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const model = readJson(path.join(HERE, 'course-model.json'));
const traces = readJson(path.join(HERE, 'surface-traces.json'));
const ditches = fs.existsSync(path.join(HERE, 'laser-ditches.json')) ? readJson(path.join(HERE, 'laser-ditches.json')) : null;
const T = loadTerrain();
const bearingDeg = (a, b) => r1(Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180 / Math.PI);

const GREEN_PROV = 'Esri z18 imagery: the collar-bounded mown patch around the GPS green centre, rule-accepted (trace-surfaces.mjs); centre is the GolfTraxx survey point; migration-only';
const FAIRWAY_PROV = 'Esri z18 imagery: mown turf (2G-R-B > 70) assigned to the hole by its traced route (trace-surfaces.mjs); migration-only';
const DECK_PROV = 'measured tee deck: laser-flat (1 m DTM, 5x5 spread < 0.12 m) and mown or under the card mark (trace-surfaces.mjs)';
const ROUTE_PROV = 'least-cost route through the hole\'s own mown corridor from the back tee to the surveyed green centre (trace-surfaces.mjs)';

let greensReplaced = 0, decksPlaced = 0, marksOnDecks = 0;
for (const hole of model.holes) {
  const green = traces.greens.find(g => g.hole === hole.n);
  if (green?.accepted) { hole.green.ring = green.ring; hole.green.area = green.area; hole.green.prov = GREEN_PROV; hole.green.trace = { solidity: green.solidity, centroidShift: green.centroidShift, set: green.set, laserRoughness: green.laserRoughness }; greensReplaced++; }
  const fairway = traces.fairways.find(f => f.hole === hole.n);
  if (fairway?.rings.length) { hole.fairway.rings = fairway.rings; hole.fairway.prov = FAIRWAY_PROV; hole.fairway.area = fairway.area; }
  const route = traces.routes.find(r => r.hole === hole.n);
  if (route) {
    hole.line = route.line;
    hole.lineLen = r1(polyLen(route.line));
    hole.routeProv = ROUTE_PROV;
    hole.routeTrace = { backTee: route.backTee, cardBack: route.cardBack, bends: route.bends, corridorPath: route.pathLength };
    const b = bearingDeg(route.line[0], route.line[1]);
    /* marks in the card's own order */
    hole.tees.marks = hole.tees.marks.map(old => {
      const mk = route.marks.find(m => m.m === old.m);
      if (!mk) return old;
      if (mk.snapped) marksOnDecks++;
      return { c: mk.c, b, m: mk.m, prov: mk.snapped ? `on a measured deck (${mk.snapMetres} m from the card point)` : 'card distance along the traced route; no deck measured', cardPoint: mk.cardPoint };
    });
    const pads = [];
    for (const d of traces.decks.filter(d => d.hole === hole.n && d.accepted)) {
      if (pads.some(p => Math.hypot(p.c[0] - d.c[0], p.c[1] - d.c[1]) < 6)) continue;   /* one deck read from two card points */
      pads.push({ ring: d.ring, c: d.c, prov: DECK_PROV, area: d.area, bearing: d.bearing, mownShare: d.mownShare });
    }
    hole.tees.pads = pads;
    decksPlaced += pads.length;
    /* the laser heights at the back tee and the green, and the rise */
    const tee = T.hAt(route.line[0][0], route.line[0][1]), gr = T.hAt(hole.green.c[0], hole.green.c[1]);
    if (Number.isFinite(tee) && Number.isFinite(gr)) hole.elev = { tee: r1(tee), green: r1(gr), rise: r1(gr - tee), prov: 'laser 1 m DTM at the traced back tee and the surveyed green centre' };
  }
}

/* ---- streams ---- */
if (ditches) {
  const streams = [];
  for (const d of ditches.refined) {
    if (d.runs.length) for (const run of d.runs) streams.push({ line: run.line, w: d.w, name: d.name ?? undefined, prov: `${d.prov}; re-laid on the laser channel bottom (${run.meanDepth} m deep over ${run.length} m; laser-ditches.mjs)` });
    else streams.push({ line: d.tracedLine, w: d.w, name: d.name ?? undefined, prov: `${d.prov}; the laser reads no channel here (piped or shallower than 0.10 m) -- satellite trace kept` });
  }
  for (const c of ditches.crossings) streams.push({ line: c.line, w: 1.2, name: `ditch across hole ${c.hole}`, prov: `laser 1 m DTM: incised channel ${c.meanDepth} m deep crossing the traced route ${c.crossesAt} m from the green (valley score ${c.valleyScore}); laser-ditches.mjs` });
  for (const c of ditches.channels || []) streams.push({ line: c.line, w: 1.2, name: `ditch by hole ${c.holes.join('/')}`, prov: `laser 1 m DTM: ${c.note}, ${c.meanDepth} m deep over ${c.length} m, untraced in any imagery; laser-ditches.mjs` });
  model.streams = streams.map(s => { const o = { ...s }; if (o.name === undefined) delete o.name; return o; });
}

model.evidence.playedSurfaces = {
  source: traces.source, rules: traces.rules,
  greens: traces.greens.map(g => ({ hole: g.hole, accepted: g.accepted, area: g.area, solidity: g.solidity, centroidShift: g.centroidShift, readings: g.readings })),
  decks: traces.decks.map(d => ({ hole: d.hole, tee: d.tee, accepted: d.accepted, area: d.area, markToDeck: d.markToDeck, mownShare: d.mownShare, why: d.why })),
  routes: traces.routes.map(r => ({ hole: r.hole, length: r.length, cardBack: r.cardBack, backTee: r.backTee, bends: r.bends })),
  ditches: ditches ? { source: ditches.source, rules: ditches.rules, relaid: ditches.refined.map(d => ({ name: d.name, tracedMetres: d.tracedMetres, laserMetres: d.laserMetres, runs: d.runs.length })), crossings: ditches.crossings.map(c => ({ hole: c.hole, crossesAt: c.crossesAt, meanDepth: c.meanDepth })), channels: (ditches.channels || []).map(c => ({ holes: c.holes, length: c.length, meanDepth: c.meanDepth, drains: c.drains })) } : null,
};
fs.writeFileSync(path.join(HERE, 'course-model.json'), JSON.stringify(model));
console.log(`greens: ${greensReplaced}/9 replaced by traced outlines; tee pads: ${decksPlaced} measured decks, ${marksOnDecks}/27 marks on a deck; fairways: ${traces.fairways.reduce((s, f) => s + f.rings.length, 0)} rings; streams: ${model.streams.length}`);
for (const h of model.holes) console.log(`  hole ${h.n}: line ${h.lineLen} m (card ${h.t[0]}), green ${Math.round(h.green.area)} m², fairway ${Math.round(h.fairway.area || 0)} m², pads ${h.tees.pads.length}, rise ${h.elev.rise}`);
