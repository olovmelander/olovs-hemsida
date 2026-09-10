#!/usr/bin/env node
/* The 2026 review, applied to the master input in plain Node.

   assemble-input.py is the Python assembler and this machine has no Python,
   so this script does the two things the review changes and nothing else:
   (1) the playing surfaces -- every hole's fairway rings are replaced by the
   rule-traced 2026 fairways (trace-fairways.mjs), and the tee platforms gain
   the decks and card-derived pads tee-decisions-2026.json names; (2) the
   holes' tee references -- one mark per card colour standing on a named
   platform, with the line's start moved onto the back tee. Greens, bunkers,
   water, buildings and everything else pass through untouched, and the
   input's own source-checksum ledger is refreshed so build-course.mjs's
   verifyInputSources still means what it means.

   Every replacement names what it replaces (`replacesFeatureIds`, the
   assembler's own convention) and the changeset is written beside the
   surfaces as mapping/review-2026.json.

     node tortunabuild/mapping/apply-review-2026.mjs [--write]           */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadReviewMosaic, exg, brightness, toEpsg, toLocal, sampleRaster, localStats, pointInRing, ringArea, ringCentroid, distToPolyline, dist } from '../lib/imagery.mjs';
import { loadTerrain } from '../lib/rasters.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WRITE = process.argv.includes('--write');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const sha = p => createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const write = (p, value) => fs.writeFileSync(path.join(ROOT, p), JSON.stringify(value, null, 2) + '\n');

const SURFACES = 'tortunabuild/mapping/playing-surfaces.geojson';
const INPUT = 'tortunabuild/mapping/course-input.json';
const FAIRWAYS = 'tortunabuild/mapping/fairways-2026.geojson';
const DECISIONS = 'tortunabuild/mapping/tee-decisions-2026.json';
const CANDIDATES = 'tortunabuild/mapping/tee-candidates-2026.geojson';
const FELLED = 'tortunabuild/mapping/canopy-changes-2026.geojson';
const REVIEW = 'tortunabuild/mapping/review-2026.json';

const surfaces = read(SURFACES), input = read(INPUT), fairways = read(FAIRWAYS), decisions = read(DECISIONS), candidates = read(CANDIDATES), felled = read(FELLED);
const { heightAt } = loadTerrain();
if (decisions.holes.length !== 18 || input.holes.length !== 18) throw new Error('need all eighteen holes');

/* the mown score, the fairway tracer's rule, so a derived pad lands on the mown corridor's middle */
const mosaic = loadReviewMosaic();
function mownCrossSection(p, normal, halfSpan = 26) {
  /* returns the mown run (S > 0.5) along the normal through p that contains p, or the nearest run; null if none */
  const size = halfSpan * 2 + 16;
  const [e, n] = toEpsg(p);
  const win = { boundsEpsg3006: [e - size / 2, n - size / 2, e + size / 2, n + size / 2], metres: 0.32 };
  const ex = sampleRaster(win, (E, N) => { const c = mosaic.rgb(E, N); return c ? exg(c) : 0; });
  const br = sampleRaster(win, (E, N) => { const c = mosaic.rgb(E, N); return c ? brightness(c) : 0; });
  const bl = sampleRaster(win, (E, N) => { const c = mosaic.rgb(E, N); return c ? c[2] / Math.max(1, c[1]) : 1; });
  const tex = localStats(br, 2).sd;
  const exs = localStats(ex, 6).mean, texs = localStats({ width: ex.width, height: ex.height, values: tex }, 6).mean, bls = localStats(bl, 6).mean;
  const S = (x, z) => { const [c, r] = ex.cell(...toEpsg([x, z])); if (c < 0 || r < 0 || c >= ex.width || r >= ex.height) return -9; const i = r * ex.width + c; return exs[i] / 6 - texs[i] / 4 - (bls[i] - 0.93) * 30; };
  const mown = [];
  for (let t = -halfSpan; t <= halfSpan; t += 0.5) mown.push(S(p[0] + normal[0] * t, p[1] + normal[1] * t) > 0.5 ? 1 : 0);
  const runs = [];
  for (let i = 0; i < mown.length; i++) { if (!mown[i]) continue; const start = i; while (i + 1 < mown.length && mown[i + 1]) i++; runs.push({ a: -halfSpan + start * 0.5, b: -halfSpan + i * 0.5 }); }
  if (!runs.length) return null;
  const wide = runs.filter(r => r.b - r.a >= 5);
  if (!wide.length) return null;
  const containing = wide.find(r => r.a <= 0 && r.b >= 0);
  const run = containing || wide.sort((r1, r2) => Math.min(Math.abs(r1.a), Math.abs(r1.b)) - Math.min(Math.abs(r2.a), Math.abs(r2.b)))[0];
  return { offset: (run.a + run.b) / 2, width: run.b - run.a, containing: !!containing };
}

function pointAtRouteMetresToGreen(line, metres) {
  /* walk back from the END (the green centre) along the line; extend the first segment backwards if the card asks for more than the line has */
  let remaining = metres;
  for (let i = line.length - 1; i >= 1; i--) {
    const a = line[i - 1], b = line[i], len = dist(a, b);
    if (remaining <= len) { const t = remaining / len; return { p: [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t], seg: i }; }
    remaining -= len;
  }
  const a = line[0], b = line[1], len = dist(a, b);
  const F = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  return { p: [a[0] - F[0] * remaining, a[1] - F[1] * remaining], seg: 1, extendedMetres: remaining };
}
const segmentForward = (line, seg) => { const a = line[seg - 1], b = line[seg], len = dist(a, b); return [(b[0] - a[0]) / len, (b[1] - a[1]) / len]; };
const rectangle = (centre, forward, length, width) => {
  const R = [forward[1], -forward[0]];
  const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [centre[0] + R[0] * width / 2 * u + forward[0] * length / 2 * v, centre[1] + R[1] * width / 2 * u + forward[1] * length / 2 * v]);
  return [...ring, ring[0]];
};
/* a built deck is a rectangle: the candidate's principal axes, its length and width, about its centre */
function deckRectangle(ring) {
  const pts = ring.slice(0, -1);
  const c = ringCentroid(pts);
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) { const dx = x - c[0], dz = z - c[1]; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const theta = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const F = [Math.cos(theta), Math.sin(theta)], R = [-F[1], F[0]];
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [x, z] of pts) { const dx = x - c[0], dz = z - c[1]; const a = dx * F[0] + dz * F[1], b = dx * R[0] + dz * R[1]; if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b; }
  /* the flat-cell outline overstates the deck by about half a cell each way */
  const length = a1 - a0 - 1, width = Math.max(4, b1 - b0 - 1);
  const centre = [c[0] + F[0] * (a0 + a1) / 2 + R[0] * (b0 + b1) / 2, c[1] + F[1] * (a0 + a1) / 2 + R[1] * (b0 + b1) / 2];
  const rect = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [centre[0] + F[0] * length / 2 * v + R[0] * width / 2 * u, centre[1] + F[1] * length / 2 * v + R[1] * width / 2 * u]);
  return { ring: [...rect, rect[0]], length: +length.toFixed(1), width: +width.toFixed(1) };
}
const waterRings = input.water.map(w => w.rings[0].map(toLocal));
const inWater = (p, clearance = 0) => waterRings.some(ring => pointInRing(p[0], p[1], ring) || (clearance > 0 && distToPolyline(p, [...ring, ring[0]]).d < clearance));
/* a station in water walks forward along the route until it is dry and clear of the water's edge */
function dryStation(line, station, clearance = 6) {
  let { p, seg } = station;
  let walked = 0;
  while (inWater(p, clearance) && walked < 120) {
    const F = segmentForward(line, seg);
    const next = [p[0] + F[0] * 2, p[1] + F[1] * 2];
    walked += 2;
    const b = line[seg];
    if (dist(next, b) < 2 && seg < line.length - 1) { seg++; p = [...line[seg - 1]]; } else p = next;
  }
  return { p, seg, walkedMetres: walked };
}
/* the p95-p5 height spread of the laser over a rectangle's interior, sampled on a 1 m lattice */
function spreadOf(ring) {
  const [x0, z0, x1, z1] = [Math.min(...ring.map(p => p[0])), Math.min(...ring.map(p => p[1])), Math.max(...ring.map(p => p[0])), Math.max(...ring.map(p => p[1]))];
  const hs = [];
  for (let z = z0; z <= z1; z += 1) for (let x = x0; x <= x1; x += 1) if (pointInRing(x, z, ring)) hs.push(heightAt(x, z));
  hs.sort((a, b) => a - b);
  return hs.length ? hs[Math.floor(hs.length * 0.95)] - hs[Math.floor(hs.length * 0.05)] : Infinity;
}
function flattestPlacement(centre, forward, length, width) {
  const R = [-forward[1], forward[0]];
  const at = (a, b) => [centre[0] + forward[0] * a + R[0] * b, centre[1] + forward[1] * a + R[1] * b];
  let best = { shift: [0, 0], centre, ring: rectangle(centre, forward, length, width) };
  best.spread = spreadOf(best.ring);
  const spreadBefore = best.spread;
  for (let a = -6; a <= 6; a += 1) for (let b = -4; b <= 4; b += 1) {
    if (!a && !b) continue;
    const c = at(a, b);
    if (inWater(c, 6)) continue;
    const ring = rectangle(c, forward, length, width);
    const spread = spreadOf(ring);
    if (spread < best.spread - 0.02) best = { shift: [a, b], centre: c, ring, spread };
  }
  return { ...best, spreadBefore };
}
const interior = ring => { const c = ringCentroid(ring.slice(0, -1)); if (!pointInRing(...c, ring)) throw new Error('centroid outside ring'); return c; };
/* a point at the rear or front quarter of a pad along the hole's direction */
function padPoint(ring, forward, where) {
  const c = ringCentroid(ring.slice(0, -1));
  const along = ring.slice(0, -1).map(q => (q[0] - c[0]) * forward[0] + (q[1] - c[1]) * forward[1]);
  const lo = Math.min(...along), hi = Math.max(...along);
  const t = where === 'rear' ? lo * 0.5 : where === 'front' ? hi * 0.5 : 0;
  const p = [c[0] + forward[0] * t, c[1] + forward[1] * t];
  return pointInRing(...p, ring) ? p : c;
}

const byId = new Map(surfaces.features.map(f => [f.id, f]));
const removed = new Set();
const added = [];
const holeRecords = [];
const DERIVED = decisions.derivedPlatform;
for (const decision of decisions.holes) {
  const hole = input.holes.find(h => h.number === decision.hole);
  const localLine = hole.line.map(toLocal);
  const cardLengths = hole.teeLengths;
  const pads = new Map();   /* id -> feature (EPSG:3006 ring) */
  const marks = new Array(cardLengths.length).fill(null);
  const record = { hole: decision.hole, platforms: [], marks: [] };
  for (const platform of decision.platforms) {
    let feature = pads.get(platform.id) || null;
    if (!feature) {
      if (platform.source === 'observed') {
        feature = byId.get(platform.id);
        if (!feature || feature.properties.kind !== 'tee' || feature.properties.hole !== decision.hole) throw new Error(`hole ${decision.hole}: observed platform ${platform.id} is not a tee of this hole`);
      } else if (platform.source === 'deck') {
        const deck = candidates.features.find(f => f.id === platform.deck);
        if (!deck) throw new Error(`hole ${decision.hole}: deck ${platform.deck} is not a candidate`);
        const rect = deckRectangle(deck.geometry.coordinates[0].map(toLocal));
        feature = { type: 'Feature', id: platform.id, properties: { kind: 'tee', hole: decision.hole, replacesFeatureIds: [], sourceId: 'laser-lm-1m+imagery-lm-ortho', sourceCollection: 'orto-n2-2026', observedYear: 2026,
          reviewedOn: decisions.reviewedOn, reviewer: 'assistant-rule-based-laser-and-orthophoto-review', reviewStatus: 'provisional-not-human-accepted', notSurveyed: true,
          teeRole: `${platform.role}-observed-platform`, method: 'laser-flat (5 x 5 m range under 0.14 m) mown deck at the card distance; trace-tees.mjs candidate ' + platform.deck,
          deckCandidate: platform.deck, laserHeightRangeMetres: deck.properties.heightRangeMetres, flatCellAreaSquareMetres: deck.properties.areaSquareMetres, deckLengthMetres: rect.length, deckWidthMetres: rect.width,
          outline: 'rectangle of the flat cells principal axes; the cell outline is kept in mapping/tee-candidates-2026.geojson', evidence: platform.evidence,
          horizontalUncertaintyMetres: 1.5, currentTeeColours: 'card-assigned', terrainModified: false }, geometry: { type: 'Polygon', coordinates: [rect.ring.map(toEpsg).map(p => p.map(v => Math.round(v * 100) / 100))] } };
        added.push(feature);
      } else if (platform.source === 'derived') {
        let station, forward;
        if (platform.atLineStart) { station = { p: localLine[0], seg: 1 }; forward = segmentForward(localLine, 1); }
        else { station = dryStation(localLine, pointAtRouteMetresToGreen(localLine, platform.cardMetres)); forward = segmentForward(localLine, station.seg); }
        const normal = [-forward[1], forward[0]];
        const section = mownCrossSection(station.p, normal);
        let centre = section ? [station.p[0] + normal[0] * section.offset, station.p[1] + normal[1] * section.offset] : station.p;
        if (inWater(centre, 6)) centre = station.p;
        const shifted = section ? +section.offset.toFixed(1) : null;
        const flat = flattestPlacement(centre, forward, DERIVED.lengthMetres, DERIVED.widthMetres);
        const ring = flat.ring;
        feature = { type: 'Feature', id: platform.id, properties: { kind: 'tee', hole: decision.hole, replacesFeatureIds: [], sourceId: 'card+imagery-lm-ortho', sourceCollection: 'orto-n2-2026', observedYear: 2026,
          reviewedOn: decisions.reviewedOn, reviewer: 'assistant-card-derived-position', reviewStatus: 'card-derived; not an observed platform', notSurveyed: true,
          teeRole: `${platform.role}-card-derived-platform`, method: platform.atLineStart ? 'the surveyed GolfTraxx back-tee point, on the mown corridor' : `${platform.cardMetres} m to the green centre along the route, moved ${shifted ?? 0} m sideways onto the middle of the mown corridor (2026 mown score)`,
          derivedPlatform: { ...DERIVED, cardMetres: platform.cardMetres ?? null, walkedOutOfWaterMetres: station.walkedMetres ?? 0,
            laserPlacement: { shiftAlongAcrossMetres: flat.shift, heightSpreadBeforeMetres: +flat.spreadBefore.toFixed(2), heightSpreadMetres: +flat.spread.toFixed(2), rule: 'the levellest 14 x 7 m within 6 m along and 4 m across the station on the 1 m laser' }, mownCorridorWidthMetres: section ? +section.width.toFixed(1) : null, mownCorridorContainsStation: section ? section.containing : null, routeExtendedMetres: station.extendedMetres ? +station.extendedMetres.toFixed(1) : 0 },
          evidence: platform.evidence, horizontalUncertaintyMetres: 15, currentTeeColours: 'card-assigned', terrainModified: false }, geometry: { type: 'Polygon', coordinates: [ring.map(toEpsg).map(p => p.map(v => Math.round(v * 100) / 100))] } };
        added.push(feature);
      } else throw new Error(`hole ${decision.hole}: unknown platform source ${platform.source}`);
      pads.set(platform.id, feature);
    }
    const ring = feature.geometry.coordinates[0].map(toLocal);
    const c = ringCentroid(ring.slice(0, -1));
    const { t } = distToPolyline(c, localLine);
    const seg = Math.max(1, Math.min(localLine.length - 1, Math.ceil(t * (localLine.length - 1))));
    const forward = segmentForward(localLine, seg);
    const at = platform.at || 'centre';
    const point = at === 'centre' ? interior(ring) : padPoint(ring, forward, at);
    for (const colour of platform.colours) {
      if (marks[colour]) throw new Error(`hole ${decision.hole}: colour ${colour} assigned twice`);
      marks[colour] = { c: toEpsg(point).map(v => Math.round(v * 1000) / 1000), sourcePadId: platform.id,
        kind: platform.source === 'derived' ? 'card-derived-platform-reference' : 'orthophoto-platform-reference',
        platformStatus: platform.source === 'observed' ? 'observed-2026-orthophoto-platform' : platform.source === 'deck' ? 'laser-flat-mown-deck-at-card-distance' : DERIVED.status, at };
    }
    record.platforms.push({ id: platform.id, source: platform.source, role: platform.role, colours: platform.colours, areaSquareMetres: Math.round(ringArea(ring.slice(0, -1))), centreLocal: c.map(v => +v.toFixed(1)) });
  }
  if (marks.some(m => !m)) throw new Error(`hole ${decision.hole}: a card colour has no platform`);
  /* the route starts on the back tee (colour 0's mark) */
  const back = toLocal(marks[0].c);
  const moved = dist(back, localLine[0]);
  const newLine = [toEpsg(back).map(v => Math.round(v * 1000) / 1000), ...hole.line.slice(1)];
  /* fairways: replace every fairway feature of this hole with the 2026 rule rings */
  const oldFairways = surfaces.features.filter(f => f.properties.kind === 'fairway' && f.properties.hole === decision.hole);
  const newFairways = fairways.features.filter(f => f.properties.hole === decision.hole).map((f, i) => ({ ...f, properties: { ...f.properties, replacesFeatureIds: i === 0 ? oldFairways.map(o => o.id) : [] } }));
  for (const o of oldFairways) removed.add(o.id);
  added.push(...newFairways);
  const teeFeatures = [...pads.values()];
  hole.teePlatforms = teeFeatures.map(f => ({ ...f.properties, ring: f.geometry.coordinates[0], sourceFeatureId: f.id }));
  hole.teeReferences = marks.map(m => m.c);
  hole.teeMarks = marks.map(m => ({ ...m }));
  hole.teeReferenceStatus = 'per-colour references on named platforms (observed, laser deck or card-derived); daily marker positions unverified';
  hole.line = newLine;
  hole.fairways = newFairways.map(f => ({ ...f.properties, ring: f.geometry.coordinates[0], sourceFeatureId: f.id }));
  record.marks = marks.map((m, i) => ({ colour: decisions.colours[i], cardMetres: cardLengths[i], platform: m.sourcePadId, kind: m.kind, at: m.at }));
  record.lineStartMovedMetres = +moved.toFixed(1);
  record.fairways = { replaced: oldFairways.map(o => o.id), adopted: newFairways.map(f => f.id), areaSquareMetres: Math.round(newFairways.reduce((s, f) => s + f.properties.areaSquareMetres, 0)) };
  holeRecords.push(record);
  console.log(`hole ${String(decision.hole).padStart(2)}: ${teeFeatures.length} platforms (${record.platforms.map(p => p.source[0]).join('')}), line start moved ${moved.toFixed(1)} m, fairways ${oldFairways.length} -> ${newFairways.length} (${record.fairways.areaSquareMetres} m²)`);
}

/* the surfaces collection: originals minus the replaced fairways, plus everything added */
  input.clearfells = felled.features.map(f => ({ id: f.id, ring: f.geometry.coordinates[0], sourceId: 'imagery-lm-ortho', sourceFeatureId: f.id, captureDate: f.properties.captureDate, reason: f.properties.reason,
    areaSquareMetres: f.properties.areaSquareMetres, canopyExclusion: false, canopyExcludedBy: 'geo_data/course-v2/tortuna/vegetation/compile-stands.mjs reads the same polygons as override exclusions; here they are ground-cover records only',
    reviewStatus: f.properties.reviewStatus, notSurveyed: true }));
const kept = surfaces.features.filter(f => !removed.has(f.id));
const ids = new Set(kept.map(f => f.id));
for (const f of added) { if (ids.has(f.id)) throw new Error(`duplicate feature id ${f.id}`); ids.add(f.id); }
const newSurfaces = { ...surfaces, features: [...kept, ...added], status: 'provisional-orthophoto-interpretation-not-surveyed; 2026 rule-traced fairways and tee decisions applied (mapping/review-2026.json)',
  inputs: [...surfaces.inputs.filter(i => ![FAIRWAYS, DECISIONS, CANDIDATES].includes(i.path)), { path: FAIRWAYS, sha256: sha(FAIRWAYS) }, { path: DECISIONS, sha256: sha(DECISIONS) }, { path: CANDIDATES, sha256: sha(CANDIDATES) }],
  review2026: { path: REVIEW, applied: decisions.reviewedOn } };
const counts = newSurfaces.features.reduce((a, f) => { a[f.properties.kind] = (a[f.properties.kind] || 0) + 1; return a; }, {});
const review = { schemaVersion: 1, groundId: 'tortuna', reviewedOn: decisions.reviewedOn, captureDate: decisions.captureDate, script: 'tortunabuild/mapping/apply-review-2026.mjs',
  sources: { fairways: { path: FAIRWAYS, sha256: sha(FAIRWAYS) }, decisions: { path: DECISIONS, sha256: sha(DECISIONS) }, candidates: { path: CANDIDATES, sha256: sha(CANDIDATES) } },
  method: decisions.method, removedFeatureIds: [...removed], addedFeatureIds: added.map(f => f.id), surfaceCounts: counts, holes: holeRecords,
  clearfells: { path: FELLED, sha256: sha(FELLED), polygons: felled.features.length, areaSquareMetres: felled.totalAreaSquareMetres, runtime: 'surround.clearfells (slash-coloured ground, no trees); the stand compiler excludes the 2021 canopy inside them' },
  limits: ['Card-derived platforms are positions, not observations: 14 x 7 m rectangles on the mown corridor at the card distance, flagged in every record they touch.',
    'Fairways are a rule-based classification of the 2026-05-02 orthophoto clipped to a design half-width; the mown estate beyond them is not fairway in the model.',
    'Daily flag and marker positions remain unverified; nothing here is surveyed.'] };
console.log(`surfaces: ${surfaces.features.length} -> ${newSurfaces.features.length} (${JSON.stringify(counts)}); removed ${removed.size}, added ${added.length}`);
if (!WRITE) { console.log('dry run; pass --write to apply'); process.exit(0); }
write(SURFACES, newSurfaces);
input.inputs = input.inputs.map(i => i.path === SURFACES ? { path: SURFACES, sha256: sha(SURFACES) } : i);
for (const extra of [FAIRWAYS, DECISIONS, FELLED, REVIEW]) if (!input.inputs.some(i => i.path === extra)) input.inputs.push({ path: extra, sha256: null });
write(REVIEW, review);
for (const i of input.inputs) if (i.sha256 === null) i.sha256 = sha(i.path);
input.status = 'provisional-source-derived; 2026 review applied';
write(INPUT, input);
console.log(`wrote ${SURFACES}, ${INPUT}, ${REVIEW}`);
