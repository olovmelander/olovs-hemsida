#!/usr/bin/env node
/* The candidate tree set for the inner 2,048 m frontier (not published).

   usage: node tools/johannesberg-tree-pilot/build-candidates.mjs

   1. The locked detector over the whole pit-free CHM; crowns owned by the
      inner window (position inside it).
   2. Evidence per crown: leaf-off return structure, April 2021 and June 2025
      photo statistics in the crown disc widened for relief displacement, the
      conifer/broadleaf rule from type-rule.json, a 2025 presence score, the
      course's semantic surfaces under the crown position, and a structure
      check (no vegetation in June, no ground return, all pulses stopped).
   3. Sparse-laser recovery: clusters of >= 3 m returns the detector left
      outside every crown, proposed at the highest return when the June 2025
      photo shows a crown there; photo-only canopy with no return >= 2 m goes
      to the unresolved list, never placed.
   4. Stable identity against the CURRENT published records: one-to-one within
      1.5 m keeps the ID (retain, or adjust with before/after); a second pass
      to 3 m keeps an ID with an explicit larger move; new crowns get new IDs
      after the ground's highest sequence. The previous generation's IDs
      (ground-v2-1f0f72bb, renumbered by the 2026-09-11 re-run) are carried as
      lineage where a current record stands within 0.5 m of an old one.
   5. Decisions: retain / adjust / add / merge / remove / hold, with reasons.
      A record with no crown is removed only where the 2021 laser shows no
      canopy within 2 m and June 2025 shows no tree-like crown; a record whose
      canopy is now carried by a neighbouring crown is merged into it (its ID
      retired with lineage). Felling since 2021 is screened outside closed
      stands (the crown's own shadow present in April 2021, absent in June
      2025, little crown in 2025) and every screened crown is decided by the
      interpreter in felling-review.json: absent -> remove, else kept.
   Tree bases sample the published terrain the app draws.                 */
import fs from 'node:fs';
import path from 'node:path';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { createRaster } from '../../packages/course-v2/vegetation/canopy-fields.mjs';
import { loadGroundCourseGeometries, mergeCourseGeometries } from '../../packages/course-v2/vegetation/compile-vegetation.mjs';
import { createGroundHeightLookup } from '../../packages/course-v2/vegetation/ground-sampler.mjs';
import { courseExclusionFeatures, rasterizeExclusions } from '../../packages/course-v2/vegetation/semantic-exclusions.mjs';
import { parseTreeId, treeId } from '../../packages/course-v2/vegetation/registry-identity.mjs';
import { convexHull, crownOutlines, crownReturnMetrics, detectTreesV2, matchOneToOne } from '../../packages/course-v2/vegetation/tree-detect-v2.mjs';
import { PILOT, sampleFile } from './pilot-config.mjs';
import { ROOT, loadMosaic, loadRaster } from './panels.mjs';
import { PHOTO_SUN, closedness, displacementAllowance, loadPointsFor, openGroundBrightness, photoDisc, shadowProbe } from './crown-evidence.mjs';
import { publishedGround, publishedPopulation } from './published-population.mjs';

const reviewDir = path.join(ROOT, PILOT.reviewDir);
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const W = PILOT.innerWindow;
const inInner = (e, n) => e >= W.minEasting && e < W.maxEasting && n >= W.minNorthing && n < W.maxNorthing;

function ruleFrom(typeRule) {
  const term = ({ name, dir, t }) => f => (Number.isFinite(f[name]) ? (dir === '>=' ? f[name] >= t : f[name] < t) : null);
  const terms = typeRule.chosen.terms.map(term);
  return f => {
    const values = terms.map(fn => fn(f));
    if (values.some(v => v === null)) return null;
    return typeRule.chosen.op === 'OR' ? values.some(Boolean) : values.every(Boolean);
  };
}

/** A June-2025 tree-likeness score in [0, 1] from the disc statistics, scaled by the reference crowns' own distribution. */
export function presenceScore(june, scale) {
  if (!june) return null;
  const veg = Math.min(1, june.vegetatedShare / scale.vegetatedShare);
  const texture = Math.min(1, june.nirTexture / scale.nirTexture);
  const shade = Math.min(1, june.darkShare / Math.max(0.01, scale.darkShare));
  return round(0.4 * veg + 0.4 * texture + 0.2 * shade, 3);
}

async function main() {
  const started = performance.now();
  const lock = JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('detector-lock')), 'utf8'));
  const typeRule = JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('type-rule')), 'utf8'));
  const isConifer = ruleFrom(typeRule);
  const chm = loadRaster('chm-pitfree-050');
  const grid = chm.grid;
  /* 1. detection over the whole halo window */
  const detected = detectTreesV2(grid, chm.values, { parameters: lock.selected.parameters });
  const position = c => (lock.selected.position === 'centroid' ? c.centroid : c.apex);
  const crowns = detected.crowns.filter(c => inInner(position(c).easting, position(c).northing));
  console.log(`detector: ${detected.maxima.length} maxima, ${detected.crowns.length} crowns, ${crowns.length} owned by the inner window`);
  /* 2. evidence */
  const points = loadPointsFor(grid);
  const returnMetrics = crownReturnMetrics(grid, detected.labels, crowns, points);
  const m21 = loadMosaic('2021');
  const m25 = loadMosaic('2025');
  const outlines = crownOutlines(grid, detected.labels, crowns.map(c => c.id));
  const publicDir = path.join(ROOT, PILOT.publicDir);
  const { ground } = publishedGround();
  const lookup = await createGroundHeightLookup(ground, async url => fs.readFileSync(path.join(publicDir, url)));
  const groundCourses = loadGroundCourseGeometries(path.join(ROOT, 'geo_data/course-v2/johannesberg'), 'johannesberg');
  const geometry = mergeCourseGeometries(groundCourses.map(c => c.geometry));
  /* play zone: the app's zone A (main.js LEGACY_ZONE_A_METRES = 90 m from a
     hole's tee-to-green line), both routings, plus the practice areas
     (driving range and practice greens) by the same 90 m */
  const holeLines = groundCourses.flatMap(c => (c.geometry.holes || []).map(h => h.line).filter(l => Array.isArray(l) && l.length >= 2));
  const practiceRings = groundCourses.flatMap(c => {
    const sc = c.geometry.scenery || {};
    const range = Array.isArray(sc.range?.[0]?.[0]) ? sc.range : Array.isArray(sc.range) && sc.range.length ? [sc.range] : [];
    return [...range, ...(sc.practiceGreens || [])];
  }).filter(r => Array.isArray(r) && r.length >= 3);
  const playOf = (e, n) => nearPlay(e, n, holeLines, practiceRings, 90) ? 'near' : 'woodland';
  /* conifer probability from the April vegetated share: a logistic fit on the
     round-1 CALIBRATION examples only; confidence = max(p, 1 - p) */
  const typeExamplesAll = JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('type-rule')), 'utf8')).examplesTable;
  const logistic = fitLogistic(typeExamplesAll.filter(x => x.role === 'calibration' && Number.isFinite(x.features.aprilVegetatedShare)).map(x => [x.features.aprilVegetatedShare, x.type === 'conifer' ? 1 : 0]));
  const typeOf = share => {
    if (!Number.isFinite(share)) return { type: 'unknown', typeConfidence: null, coniferProbability: null };
    const pc = 1 / (1 + Math.exp(-(logistic.w0 + logistic.w1 * share)));
    const confidence = Math.max(pc, 1 - pc);
    return { type: confidence >= 0.6 ? (pc >= 0.5 ? 'conifer' : 'broadleaf') : 'unknown', typeConfidence: round(confidence, 3), coniferProbability: round(pc, 3) };
  };
  /* semantic surfaces at 1 m with no buffers beyond the surface itself
     (buildings 0.5 m): these are where a crown's BASE would be, not overhang */
  const ex1 = createRaster({ width: Math.round(W.maxEasting - W.minEasting), height: Math.round(W.maxNorthing - W.minNorthing), sampleSpacingMetres: 1, originEasting: W.minEasting, originNorthing: W.maxNorthing });
  const features = courseExclusionFeatures(geometry).map(f => ({ ...f, bufferMetres: f.kind === 'building' ? 0.5 : 0 }));
  const exclusions = rasterizeExclusions(ex1, features, { groundHeightAt: lookup.heightAt });
  const surfaceAt = (e, n) => {
    const c = Math.floor(e - W.minEasting), r = Math.floor(W.maxNorthing - n);
    if (c < 0 || r < 0 || c >= ex1.width || r >= ex1.height) return null;
    const code = exclusions.reason[r * ex1.width + c];
    return code ? exclusions.legend[code] : null;
  };
  /* presence scale from the reference crowns' June statistics (all present) */
  const typeExamples = typeRule.examplesTable;
  const reference = JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('reference', 'geojson')), 'utf8')).features.filter(f => f.properties.scored);
  const refJune = reference.map(f => photoDisc(m25, f.properties.easting, f.properties.northing, (f.properties.segment?.equivalentRadiusMetres || 2) + displacementAllowance(f.properties.heightMetres))).filter(Boolean);
  const median = values => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const scale = { vegetatedShare: median(refJune.map(j => j.vegetatedShare)), nirTexture: median(refJune.map(j => j.nirTexture)), darkShare: median(refJune.map(j => j.darkShare)) };
  const refScores = refJune.map(j => presenceScore(j, scale)).sort((a, b) => a - b);
  const presenceFloor = refScores[Math.floor(0.02 * (refScores.length - 1))];
  const dark25 = 0.7 * openGroundBrightness(m25, chm), dark21 = 0.7 * openGroundBrightness(m21, chm);
  const fellingReviewPath = path.join(reviewDir, 'felling-review.json');
  const fellingReview = fs.existsSync(fellingReviewPath) ? JSON.parse(fs.readFileSync(fellingReviewPath, 'utf8')) : { decisions: {} };
  const keyOf = (e, n) => `${e.toFixed(1)}_${n.toFixed(1)}`;
  const screened = [];
  const trees = crowns.map(crown => {
    const at = position(crown);
    const returns = returnMetrics.get(crown.id);
    const radius = crown.equivalentRadiusMetres + displacementAllowance(crown.heightMetres);
    const april = photoDisc(m21, crown.apex.easting, crown.apex.northing, radius);
    const june = photoDisc(m25, crown.apex.easting, crown.apex.northing, radius);
    const featuresForType = { firstCanopyShare: returns?.firstCanopyShare, groundShare: returns?.groundShare, aprilContrastP90: april?.contrastP90, aprilVegetatedShare: april?.vegetatedShare };
    const conifer = isConifer(featuresForType);
    const presence = presenceScore(june, scale);
    const structure = june && returns && june.vegetatedShare < 0.2 && (returns.groundShare ?? 1) < 0.02 && (returns.firstCanopyShare ?? 0) > 0.95;
    const closed = closedness(chm, crown.apex.easting, crown.apex.northing);
    const shadow25 = shadowProbe(m25, crown.apex.easting, crown.apex.northing, crown.heightMetres, crown.equivalentRadiusMetres, PHOTO_SUN[2025], dark25);
    const shadow21 = shadowProbe(m21, crown.apex.easting, crown.apex.northing, crown.heightMetres, crown.equivalentRadiusMetres, PHOTO_SUN[2021], dark21);
    const fellingScreen = closed < 0.6 && shadow21 >= 0.25 && shadow25 < 0.02 && presence !== null && presence < presenceFloor;
    return {
      crownId: crown.id,
      easting: round(at.easting, 2), northing: round(at.northing, 2),
      apex: { easting: crown.apex.easting, northing: crown.apex.northing },
      heightMetres: round(crown.heightMetres, 2),
      radiusMetres: round(crown.equivalentRadiusMetres, 2),
      areaSquareMetres: crown.areaSquareMetres,
      type: conifer === null ? 'unknown' : conifer ? 'conifer' : 'broadleaf',
      evidence: {
        laser: { campaign: '21C039 2021-04-17 leaf-off', returns: returns?.returns ?? 0, firstReturns: returns?.firstReturns ?? 0, firstCanopyShare: returns?.firstCanopyShare ?? null, groundShare: returns?.groundShare ?? null },
        april2021: april ? { contrastP90: round(april.contrastP90, 3), vegetatedShare: round(april.vegetatedShare, 3) } : null,
        june2025: june ? { vegetatedShare: round(june.vegetatedShare, 3), nirTexture: round(june.nirTexture, 1), darkShare: round(june.darkShare, 3), presence } : null,
        surface: surfaceAt(at.easting, at.northing),
        structureSuspect: Boolean(structure),
        closedness: round(closed, 2), shadow2021: round(shadow21, 3), shadow2025: round(shadow25, 3),
        fellingScreen,
      },
      source: 'detector',
    };
  });
  /* 3. sparse-laser recovery: >= 3 m returns outside every crown (and every
        crown's 1 m fringe), clustered on a 1 m lattice */
  const g1 = { minEasting: W.minEasting, maxNorthing: W.maxNorthing, width: ex1.width, height: ex1.height };
  const tall = new Uint16Array(g1.width * g1.height);
  const topH = new Float32Array(g1.width * g1.height);
  const topE = new Float64Array(g1.width * g1.height), topN = new Float64Array(g1.width * g1.height);
  const labels = detected.labels;
  const nearCrown = (column, row) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const c = column + dx, r = row + dy;
      if (c >= 0 && r >= 0 && c < grid.width && r < grid.height && labels[r * grid.width + c] >= 0) return true;
    }
    return false;
  };
  for (let i = 0; i < points.count; i++) {
    if (!(points.hag[i] >= 3)) continue;
    if (!inInner(points.easting[i], points.northing[i])) continue;
    if (nearCrown(points.column[i], points.row[i])) continue;
    const c = Math.floor(points.easting[i] - g1.minEasting), r = Math.floor(g1.maxNorthing - points.northing[i]);
    const k = r * g1.width + c;
    tall[k]++;
    if (points.hag[i] > topH[k]) { topH[k] = points.hag[i]; topE[k] = points.easting[i]; topN[k] = points.northing[i]; }
  }
  const seen = new Uint8Array(tall.length);
  const recovered = [];
  const sparseUnresolved = [];
  for (let k = 0; k < tall.length; k++) {
    if (!tall[k] || seen[k]) continue;
    const queue = [k]; seen[k] = 1;
    let count = 0, best = k, cells = 0;
    for (let h = 0; h < queue.length; h++) {
      const q = queue[h]; cells++; count += tall[q];
      if (topH[q] > topH[best]) best = q;
      const r = Math.floor(q / g1.width), c = q - r * g1.width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const rr = r + dy, cc = c + dx;
        if (rr < 0 || cc < 0 || rr >= g1.height || cc >= g1.width) continue;
        const n = rr * g1.width + cc;
        if (tall[n] && !seen[n]) { seen[n] = 1; queue.push(n); }
      }
    }
    if (count < 2) continue;
    const e = topE[best], n = topN[best], h = topH[best];
    const disc = Math.sqrt(cells / Math.PI) + displacementAllowance(h);
    const june = photoDisc(m25, e, n, disc);
    const april = photoDisc(m21, e, n, disc);
    const presence = presenceScore(june, scale);
    const entry = { easting: round(e, 2), northing: round(n, 2), heightMetres: round(h, 2), tallReturns: count, cells, june2025: june ? { vegetatedShare: round(june.vegetatedShare, 3), nirTexture: round(june.nirTexture, 1), presence } : null, april2021: april ? { contrastP90: round(april.contrastP90, 3), vegetatedShare: round(april.vegetatedShare, 3) } : null, surface: surfaceAt(e, n) };
    if (presence !== null && presence >= presenceFloor && june.vegetatedShare >= 0.5) recovered.push(entry);
    else sparseUnresolved.push({ ...entry, reason: 'laser returns >= 3 m without a crown in the June 2025 photo' });
  }
  for (const r of recovered) {
    trees.push({
      crownId: null, easting: r.easting, northing: r.northing, apex: { easting: r.easting, northing: r.northing },
      heightMetres: r.heightMetres, radiusMetres: round(Math.max(1.5, Math.min(4, 0.25 * r.heightMetres + 0.5)), 2), areaSquareMetres: null,
      type: (r.april2021?.contrastP90 ?? 0) >= 0.2 ? 'conifer' : 'broadleaf',
      evidence: { laser: { campaign: '21C039 2021-04-17 leaf-off', tallReturns: r.tallReturns, note: 'sparse leaf-off returns: no crown on the CHM' }, april2021: r.april2021, june2025: r.june2025, surface: r.surface, structureSuspect: false },
      source: 'sparse-laser-recovery',
    });
  }
  /* photo-only canopy: June 2025 tree-like 1 m cells with no return >= 2 m within 3 m */
  const tallAny = new Uint8Array(g1.width * g1.height);
  for (let i = 0; i < points.count; i++) {
    if (!(points.hag[i] >= 2) || !inInner(points.easting[i], points.northing[i])) continue;
    const c = Math.floor(points.easting[i] - g1.minEasting), r = Math.floor(g1.maxNorthing - points.northing[i]);
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const rr = r + dy, cc = c + dx; if (rr >= 0 && cc >= 0 && rr < g1.height && cc < g1.width) tallAny[rr * g1.width + cc] = 1; }
  }
  const photoTree = new Uint8Array(g1.width * g1.height);
  for (let r = 0; r < g1.height; r++) for (let c = 0; c < g1.width; c++) {
    const k = r * g1.width + c;
    if (tallAny[k]) continue;
    if (exclusions.reason[k]) continue;
    const j = photoDisc(m25, g1.minEasting + c + 0.5, g1.maxNorthing - r - 0.5, 0.8);
    if (j && j.vegetatedShare > 0.9 && j.nirTexture > scale.nirTexture && j.darkShare > 0.1) photoTree[k] = 1;
  }
  const photoOnly = [];
  const seenP = new Uint8Array(photoTree.length);
  for (let k = 0; k < photoTree.length; k++) {
    if (!photoTree[k] || seenP[k]) continue;
    const queue = [k]; seenP[k] = 1;
    let se = 0, sn = 0;
    for (let h = 0; h < queue.length; h++) {
      const q = queue[h]; const r = Math.floor(q / g1.width), c = q - r * g1.width; se += c; sn += r;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const rr = r + dy, cc = c + dx; if (rr < 0 || cc < 0 || rr >= g1.height || cc >= g1.width) continue; const n = rr * g1.width + cc; if (photoTree[n] && !seenP[n]) { seenP[n] = 1; queue.push(n); } }
    }
    if (queue.length < 6) continue;
    photoOnly.push({ easting: round(g1.minEasting + se / queue.length + 0.5, 1), northing: round(g1.maxNorthing - sn / queue.length - 0.5, 1), areaSquareMetres: queue.length, reason: 'tree-like canopy in the June 2025 photo with no laser return >= 2 m within 3 m: photo-only, never placed' });
  }
  /* 4. identities */
  const population = publishedPopulation({ bbox: [W.minEasting, W.minNorthing, W.maxEasting, W.maxNorthing] });
  const allRecords = publishedPopulation({}).records;
  let sequence = allRecords.reduce((max, r) => Math.max(max, parseTreeId(r.id)?.sequence || 0), 0);
  const records = population.records;
  const pass1 = matchOneToOne(records, trees, 1.5);
  const recordFor = new Map();
  for (const m of pass1.matches) recordFor.set(m.pi, { record: records[m.ri], distance: m.d, pass: 1 });
  const leftRecords = pass1.unmatchedReference.map(i => records[i]);
  const leftTrees = pass1.unmatchedPredicted;
  const pass2 = matchOneToOne(leftRecords, leftTrees.map(i => trees[i]), 3);
  for (const m of pass2.matches) recordFor.set(leftTrees[m.pi], { record: leftRecords[m.ri], distance: m.d, pass: 2 });
  const unmatchedRecords = pass2.unmatchedReference.map(i => leftRecords[i]);
  /* lineage from the previous generation */
  const previousManifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'grounds/johannesberg/ground-v2-1f0f72bbbac45925e255ee312e9632628f355048110c744be7a04750136709aa.json'), 'utf8'));
  const previous = [];
  for (const tile of previousManifest.tiles.filter(t => t.lod === 0 && t.layers.objects)) {
    const file = path.join(publicDir, tile.layers.objects.url);
    if (!fs.existsSync(file)) continue;
    for (const r of readChunk(fs.readFileSync(file)).content.records) if (r.class === 'tree') previous.push(r);
  }
  const lineage = new Map();
  const lin = matchOneToOne(records, previous, 0.5);
  for (const m of lin.matches) lineage.set(records[m.ri].id, previous[m.pi].id);
  /* 5. decisions */
  const out = [];
  trees.forEach((tree, index) => {
    const match = recordFor.get(index);
    const base = lookup.heightAt(tree.easting, tree.northing);
    const holdReasons = [];
    if (tree.evidence.structureSuspect) holdReasons.push('structure suspect: no June vegetation, no ground return, every pulse stopped');
    const surface = tree.evidence.surface;
    if (surface === 'building') holdReasons.push('position on a mapped building');
    else if (['green', 'tee', 'bunker', 'fairway', 'practice'].includes(surface)) holdReasons.push(`position on a mapped ${surface}: crown over a played surface, base unproven`);
    else if (['water', 'road', 'path', 'railway'].includes(surface)) holdReasons.push(`position on mapped ${surface}`);
    let felled = false;
    if (tree.evidence.fellingScreen) {
      const key = keyOf(tree.easting, tree.northing);
      const verdict = fellingReview.decisions[key];
      screened.push({ key, easting: tree.easting, northing: tree.northing, heightMetres: tree.heightMetres, radiusMetres: tree.radiusMetres, verdict: verdict?.verdict ?? 'unreviewed' });
      if (!verdict) holdReasons.push('felling screen: own shadow in April 2021, none in June 2025; not yet reviewed');
      else if (verdict.verdict === 'absent' || verdict.verdict === 'structure') felled = verdict.verdict;
      else if (verdict.verdict === 'unclear') holdReasons.push(`felling screen reviewed unclear: ${verdict.note || ''}`);
    }
    /* no vegetation at all in the June 2025 crown disc: every reference crown
       but one has a vegetated share above 0.7; roofs, vehicles, heaps and
       felled trees do not. Held until reviewed. */
    if (!felled && !tree.evidence.fellingScreen && tree.source === 'detector' && (tree.evidence.june2025?.vegetatedShare ?? 1) < 0.15) {
      holdReasons.push('no vegetation in the June 2025 crown disc (roof, vehicle, heap or felled?): unreviewed');
    }
    const notTree = felled ? (felled === 'structure' ? `not a tree: ${fellingReview.decisions[keyOf(tree.easting, tree.northing)].note}` : `felled after 2021: ${fellingReview.decisions[keyOf(tree.easting, tree.northing)].note}`) : null;
    let decision, id, before = null;
    if (match) {
      id = match.record.id;
      const r = match.record;
      const dh = tree.heightMetres - r.objectHeightMetres, dr = tree.radiusMetres - r.radiusMetres;
      before = { easting: r.easting, northing: r.northing, heightMetres: r.objectHeightMetres, radiusMetres: r.radiusMetres, moveMetres: round(match.distance, 2) };
      decision = felled ? 'remove' : holdReasons.length ? 'hold' : match.distance <= 0.5 && Math.abs(dh) <= 1.5 && Math.abs(dr) <= 1 ? 'retain' : 'adjust';
      if (felled) { holdReasons.length = 0; holdReasons.push(notTree); }
    } else {
      sequence++;
      id = treeId(PILOT.groundId, sequence);
      decision = felled ? 'not-placed' : holdReasons.length ? 'hold' : 'add';
      if (felled) { holdReasons.length = 0; holdReasons.push(notTree); }
    }
    const typed = typeOf(tree.evidence.april2021?.vegetatedShare);
    out.push({
      id, decision, ...(holdReasons.length ? { reasons: holdReasons } : {}),
      play: playOf(tree.easting, tree.northing), typeConfidence: typed.typeConfidence, coniferProbability: typed.coniferProbability,
      easting: tree.easting, northing: tree.northing, positionSemantics: tree.source === 'detector' ? `${lock.selected.position} of the laser crown segment (not a surveyed stem)` : 'highest leaf-off return (not a surveyed stem)',
      heightRH2000: Number.isFinite(base) ? round(base, 3) : null,
      objectHeightMetres: tree.heightMetres, radiusMetres: tree.radiusMetres, type: typed.type, typeRule1: tree.type, source: tree.source,
      ...(before ? { before } : {}),
      ...(match && lineage.has(match.record.id) ? { lineage: { previousGenerationId: lineage.get(match.record.id), previousGeneration: 'ground-v2-1f0f72bb' } } : {}),
      evidence: tree.evidence,
      outline: tree.crownId !== null ? outlines.get(tree.crownId) || null : null,
    });
  });
  for (const r of unmatchedRecords) {
    /* is there canopy at the record at all, in 2021? */
    let maxChm = 0;
    const s = grid.sampleSpacingMetres;
    for (let dy = -2; dy <= 2; dy += s) for (let dx = -2; dx <= 2; dx += s) {
      const c = Math.floor((r.easting + dx - grid.minEasting) / s), rr = Math.floor((grid.maxNorthing - r.northing - dy) / s);
      const v = chm.values[rr * grid.width + c];
      if (v > maxChm) maxChm = v;
    }
    const june = photoDisc(m25, r.easting, r.northing, 2 + displacementAllowance(r.objectHeightMetres));
    const presence = presenceScore(june, scale);
    const noCanopy = maxChm < 2 && (presence === null || presence < presenceFloor);
    /* the nearest placed crown that now carries this canopy */
    let host = null, hostDistance = Infinity;
    for (const t of out) {
      if (!['retain', 'adjust', 'add'].includes(t.decision)) continue;
      const d = Math.hypot(t.easting - r.easting, t.northing - r.northing);
      if (d < hostDistance) { hostDistance = d; host = t; }
    }
    const merge = !noCanopy && host && hostDistance <= Math.max(6, host.radiusMetres + 2);
    out.push({
      id: r.id, decision: noCanopy ? 'remove' : merge ? 'merge' : 'hold',
      reasons: [noCanopy ? `no canopy >= 2 m within 2 m in the 2021 laser (max ${round(maxChm, 2)} m) and no tree-like crown in June 2025 (presence ${presence})` : merge ? `canopy (max ${round(maxChm, 2)} m) carried by crown ${host.id} ${round(hostDistance, 2)} m away; ID retired into it` : `canopy present (max ${round(maxChm, 2)} m within 2 m) but no placed crown within 6 m`],
      ...(merge ? { mergedInto: host.id } : {}),
      play: playOf(r.easting, r.northing), typeConfidence: null, coniferProbability: null,
      easting: r.easting, northing: r.northing, heightRH2000: r.heightRH2000, objectHeightMetres: r.objectHeightMetres, radiusMetres: r.radiusMetres, type: 'unknown', source: 'published-record',
      ...(lineage.has(r.id) ? { lineage: { previousGenerationId: lineage.get(r.id), previousGeneration: 'ground-v2-1f0f72bb' } } : {}),
    });
  }
  /* counts */
  const count = (list, key) => list.reduce((a, t) => { const k = key(t); a[k] = (a[k] || 0) + 1; return a; }, {});
  const placed = out.filter(t => ['retain', 'adjust', 'add'].includes(t.decision));
  const summary = {
    schemaVersion: 1,
    kind: 'inner-ring-tree-candidates',
    state: 'candidate, not published',
    groundId: PILOT.groundId,
    innerWindowEpsg3006: [W.minEasting, W.minNorthing, W.maxEasting, W.maxNorthing],
    detectorLockSha256: lock.selected,
    publishedGroundManifest: population.groundManifestUrl,
    today: { individualRecords: records.length, standTreesHighQuality: population.standTrees.length, total: records.length + population.standTrees.length },
    notPlacedOrRemovedByReview: count(out.filter(t => t.decision === 'not-placed' || (t.decision === 'remove' && /felled|not a tree/.test((t.reasons || [''])[0]))), t => `${t.decision}:${/felled/.test(t.reasons[0]) ? 'felled after 2021' : 'not a tree'}`),
    candidates: { total: out.length, byDecision: count(out, t => t.decision), placedTrees: placed.length, placedByType: count(placed, t => t.type), placedBySource: count(placed, t => t.source), holdByReason: count(out.filter(t => t.decision === 'hold'), t => { const r = (t.reasons || ['?'])[0]; return /June 2025 crown disc/.test(r) ? 'no June 2025 vegetation (unreviewed)' : /played surface/.test(r) ? 'crown over a played surface' : /building/.test(r) ? 'on a mapped building' : /structure/.test(r) ? 'structure suspect' : /felling/.test(r) ? 'felling screen' : /mapped (water|road|path|railway)/.test(r) ? 'on water, road or path' : /no placed crown/.test(r) ? 'record without crown' : 'other'; }) },
    fellingScreen: { screened: screened.length, byVerdict: count(screened, t => t.verdict) },
    playTypeDecision: (() => {
      const table = {};
      for (const t of out) { const key = `${t.play}|${t.type}`; table[key] = table[key] || {}; table[key][t.decision] = (table[key][t.decision] || 0) + 1; }
      return table;
    })(),
    typeModel: { feature: 'share of vegetated pixels ((NIR-red)/(NIR+red) > 0.12) in the April 2021 crown disc (crown radius + 0.3 h + 1 m)', fit: 'logistic, round-1 calibration examples only', w0: round(logistic.w0, 4), w1: round(logistic.w1, 4), examples: logistic.n, unknownBelowConfidence: 0.6 },
    playZone: { rule: 'near = within 90 m of any hole tee-to-green line of either routing (the app zone A) or of the driving range / practice greens; woodland otherwise', holeLines: holeLines.length, practiceRings: practiceRings.length },
    identity: { matchedWithin15m: pass1.matches.length, matchedWithin3m: pass2.matches.length, newIds: out.filter(t => t.decision === 'add' || (t.decision === 'hold' && t.source !== 'published-record' && !t.before)).length, nextSequence: sequence + 1, previousGenerationRecords: previous.length, previousGenerationLineageCarried: out.filter(t => t.lineage).length },
    presence: { referenceFloor: round(presenceFloor, 3), scale },
    unresolved: { sparseLaserWithoutPhotoCrown: sparseUnresolved.length, photoOnlyCanopy: photoOnly.length },
    elapsedSeconds: round((performance.now() - started) / 1000, 1),
  };
  fs.writeFileSync(path.join(reviewDir, 'candidates-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  /* committed: a compact CSV (a QGIS delimited-text layer in EPSG:3006);
     ignored cache: the full records with evidence and crown outlines, and
     the same layer as GeoJSON with outlines */
  const csvColumns = ['id', 'decision', 'play', 'easting', 'northing', 'heightRH2000', 'objectHeightMetres', 'radiusMetres', 'type', 'typeConfidence', 'source', 'previousGenerationId', 'mergedInto', 'moveMetres', 'beforeHeightMetres', 'beforeRadiusMetres', 'reason'];
  const csvValue = value => (value === null || value === undefined ? '' : /[",\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value));
  const csvRows = out.map(t => [t.id, t.decision, t.play, t.easting, t.northing, t.heightRH2000, t.objectHeightMetres, t.radiusMetres, t.type, t.typeConfidence, t.source, t.lineage?.previousGenerationId, t.mergedInto, t.before?.moveMetres, t.before?.heightMetres, t.before?.radiusMetres, t.reasons?.[0]].map(csvValue).join(','));
  fs.writeFileSync(path.join(reviewDir, 'candidates.csv'), `${csvColumns.join(',')}\n${csvRows.join('\n')}\n`);
  const geojson = { type: 'FeatureCollection', name: 'johannesberg-candidates-2026-11-08', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3006' } }, features: out.map(t => ({ type: 'Feature', geometry: t.outline ? { type: 'Polygon', coordinates: [t.outline] } : { type: 'Point', coordinates: [t.easting, t.northing] }, properties: { id: t.id, decision: t.decision, type: t.type, easting: t.easting, northing: t.northing, h: t.objectHeightMetres, r: t.radiusMetres, src: t.source, base: t.heightRH2000, reason: t.reasons?.[0] ?? null, prev: t.lineage?.previousGenerationId ?? null, move: t.before?.moveMetres ?? null } })) };
  fs.mkdirSync(path.join(ROOT, PILOT.cacheDir, 'candidates'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, PILOT.cacheDir, 'candidates', 'candidates-outlines.geojson'), JSON.stringify(geojson) + '\n');
  fs.writeFileSync(path.join(reviewDir, 'unresolved.json'), JSON.stringify({ schemaVersion: 1, note: 'never placed; next evidence: field check, newer leaf-on laser, or club confirmation', sparseLaserWithoutPhotoCrown: sparseUnresolved, photoOnlyCanopy: photoOnly }, null, 1) + '\n');
  fs.mkdirSync(path.join(ROOT, PILOT.cacheDir, 'candidates'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, PILOT.cacheDir, 'candidates', 'candidates-full.json'), JSON.stringify(out));
  fs.writeFileSync(path.join(ROOT, PILOT.cacheDir, 'candidates', 'felling-screen.json'), JSON.stringify(screened, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

/** Is a point within `reach` metres of a polyline or inside / within reach of a ring? */
export function nearPlay(e, n, lines, rings, reach) {
  const segment = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - ay) * dy) / l2));
    return Math.hypot(ax + dx * t - e, ay + dy * t - n);
  };
  for (const line of lines) for (let i = 1; i < line.length; i++) if (segment(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]) <= reach) return true;
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) inside = !inside;
      if (segment(xi, yi, xj, yj) <= reach) return true;
    }
    if (inside) return true;
  }
  return false;
}

/** One-feature logistic regression by Newton's method: [[x, y]] -> { w0, w1, n }. */
export function fitLogistic(rows) {
  let w0 = 0, w1 = 0;
  for (let iteration = 0; iteration < 50; iteration++) {
    let g0 = 0, g1 = 0, h00 = 1e-6, h01 = 0, h11 = 1e-6;
    for (const [x, y] of rows) {
      const p = 1 / (1 + Math.exp(-(w0 + w1 * x)));
      g0 += y - p; g1 += (y - p) * x;
      const w = p * (1 - p);
      h00 += w; h01 += w * x; h11 += w * x * x;
    }
    const det = h00 * h11 - h01 * h01;
    const d0 = (h11 * g0 - h01 * g1) / det, d1 = (h00 * g1 - h01 * g0) / det;
    w0 += d0; w1 += d1;
    if (Math.abs(d0) + Math.abs(d1) < 1e-9) break;
  }
  return { w0, w1, n: rows.length };
}
