/* Stage `candidates`: the decided candidate table for the inner window (from
   the Johannesberg pilot's build-candidates and type-check).

   1. The round's locked detector over the whole pit-free CHM; crowns owned by
      the inner window (position inside it). A typed round's detector reads
      its conifer map from the leaf-off photo before detection.
   2. Evidence per crown: leaf-off return structure, the leaf-off and presence
      photos' statistics in the crown disc widened for relief displacement,
      the conifer/broadleaf rule, a presence score, the course's semantic
      surfaces under the crown position, and a structure check (no vegetation
      in the presence photo, no ground return, all pulses stopped).
   3. Sparse-laser recovery: clusters of >= 3 m returns the detector left
      outside every crown, proposed at the highest return when the presence
      photo shows a crown there; photo-only canopy with no return >= 2 m goes
      to the unresolved list, never placed.
   4. Stable identity against the baseline generation's records: one-to-one
      within 1.5 m keeps the ID (retain, or adjust with before/after); a
      second pass to 3 m keeps an ID with an explicit larger move; new crowns
      get new IDs after the ground's highest sequence. An earlier
      generation's IDs are carried as lineage where a record stands within
      0.5 m of one of its records.
   5. Decisions: retain / adjust / add / merge / remove / hold / not placed,
      with reasons. A record with no crown is removed only where the laser
      shows no canopy within 2 m and the presence photo shows no tree-like
      crown; a record whose canopy is now carried by a neighbouring crown is
      merged into it. Felling since the laser is screened outside closed
      stands (the crown's own shadow present in the leaf-off photo, absent in
      the presence photo, little crown there) and every screened crown is
      decided by the interpreter in felling-review.json: absent -> remove,
      else kept. Pole-like crowns (holds.poleLike) are held until
      pole-review.json decides them.
   6. Type: a logistic fit of conifer probability on the leaf-off vegetated
      share (type rule's calibration examples only); confidence max(p, 1 - p),
      unknown below typeRule.unknownBelowConfidence, and a broadleaf call also
      needs a clearly leafless crown (share below
      typeRule.broadleafMaximumAprilShare). Between the two calls the type is
      unknown and the runtime's own species mix chooses.
   Tree bases sample the baseline generation's published terrain.          */
import fs from 'node:fs';
import path from 'node:path';
import { readChunk } from '../../packages/course-v2/chunk-node.mjs';
import { createRaster } from '../../packages/course-v2/vegetation/canopy-fields.mjs';
import { createGroundHeightLookup } from '../../packages/course-v2/vegetation/ground-sampler.mjs';
import { courseExclusionFeatures, rasterizeExclusions } from '../../packages/course-v2/vegetation/semantic-exclusions.mjs';
import { parseTreeId, treeId } from '../../packages/course-v2/vegetation/registry-identity.mjs';
import { crownOutlines, crownReturnMetrics, detectTreesTyped, detectTreesV2, matchOneToOne, typeMapFromPhoto } from '../../packages/course-v2/vegetation/tree-detect-v2.mjs';
import { detectTreesRefined } from './tree-refine.mjs';
import { refereeFor, refereeInputs } from './benchmark.mjs';
import { loadMosaic, loadRaster } from './panels.mjs';
import { closedness, displacementAllowance, loadPointsFor, openGroundBrightness, photoDisc, photoEvidenceKey, photoLabel, shadowEvidenceKey, shadowProbe } from './crown-evidence.mjs';
import { nearPlay, playGeometry } from './geometry.mjs';
import { publishedGround, publishedPopulation } from './published-population.mjs';
import { writeReceipt } from './receipts.mjs';

const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/** The pole-like hold (holds.poleLike): a tall crown narrower than a tree of its height. */
export function poleLike(tree, rule) {
  return Boolean(rule) && tree.radiusMetres < rule.maximumRadiusMetres && tree.heightMetres >= rule.minimumHeightMetres;
}

function ruleFrom(typeRule) {
  const term = ({ name, dir, t }) => f => (Number.isFinite(f[name]) ? (dir === '>=' ? f[name] >= t : f[name] < t) : null);
  const terms = typeRule.chosen.terms.map(term);
  return f => {
    const values = terms.map(fn => fn(f));
    if (values.some(v => v === null)) return null;
    return typeRule.chosen.op === 'OR' ? values.some(Boolean) : values.every(Boolean);
  };
}

/** A presence-photo (leaf-on) tree-likeness score in [0, 1] from the disc statistics, scaled by the reference crowns' own distribution. */
export function presenceScore(june, scale) {
  if (!june) return null;
  const veg = Math.min(1, june.vegetatedShare / scale.vegetatedShare);
  const texture = Math.min(1, june.nirTexture / scale.nirTexture);
  const shade = Math.min(1, june.darkShare / Math.max(0.01, scale.darkShare));
  return round(0.4 * veg + 0.4 * texture + 0.2 * shade, 3);
}

export function buildCandidates(ctx) {
  const started = performance.now();
  /* evidence keys name each photo by its month and year (april2021, june2025) */
  const leafOffKey = photoEvidenceKey(ctx.leafOff), presenceKey = photoEvidenceKey(ctx.presence);
  const shadowLeafOffKey = shadowEvidenceKey(ctx.leafOff, ctx.presence), shadowPresenceKey = shadowEvidenceKey(ctx.presence, ctx.leafOff);
  const W = ctx.innerWindow;
  const inInner = (e, n) => e >= W.minEasting && e < W.maxEasting && n >= W.minNorthing && n < W.maxNorthing;
  const { broadleafMaximumAprilShare: BROADLEAF_MAXIMUM_APRIL_SHARE, unknownBelowConfidence } = ctx.config.typeRule;
  const lockPath = ctx.reviewFile(ctx.sampleFile('detector-lock'));
  const typeRulePath = ctx.reviewFile(ctx.sampleFile('type-rule', 'json', ctx.config.typeRule.round));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const typeRule = JSON.parse(fs.readFileSync(typeRulePath, 'utf8'));
  const isConifer = ruleFrom(typeRule);
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const grid = chm.grid;
  /* 1. detection over the whole halo window: the type-aware detector for a
     typed lock (per-type settings), else detector v2 */
  const typed = Boolean(lock.selected?.parameters?.conifer);
  const m21early = typed ? loadMosaic(ctx, ctx.leafOff.key) : null;
  /* a refined lock (round 3 on): the typed detector, then its suppressed tops
     refereed by the laser apex and the photos (tree-refine.mjs) */
  const refined = Boolean(lock.selected?.refine);
  const typeMapEarly = typed ? typeMapFromPhoto(grid, chm.values, m21early, lock.selected.parameters.type).type : null;
  const detected = refined
    ? detectTreesRefined(grid, chm.values, typeMapEarly, lock.selected.parameters, lock.selected.refine, refereeFor(refereeInputs(ctx, grid), lock.selected.refine))
    : typed
      ? detectTreesTyped(grid, chm.values, typeMapEarly, lock.selected.parameters)
      : detectTreesV2(grid, chm.values, { parameters: lock.selected.parameters });
  if (refined) console.log(`refined: ${detected.suppressed} suppressed tops refereed, ${detected.recovered} recovered`);
  const position = c => (typed ? c.position : lock.selected.position === 'centroid' ? c.centroid : c.apex);
  const positionWord = typed ? 'per-type position (conifer and broadleaf: crown centroid)' : lock.selected.position;
  /* owned by the inner window as the table records it (2 decimals): a crown
     a hair inside the edge must not round onto it */
  const crowns = detected.crowns.filter(c => inInner(round(position(c).easting, 2), round(position(c).northing, 2)));
  console.log(`detector: ${detected.maxima.length} maxima, ${detected.crowns.length} crowns, ${crowns.length} owned by the inner window`);
  /* 2. evidence */
  const points = loadPointsFor(ctx, grid);
  const returnMetrics = crownReturnMetrics(grid, detected.labels, crowns, points);
  const m21 = loadMosaic(ctx, ctx.leafOff.key);
  const m25 = loadMosaic(ctx, ctx.presence.key);
  const outlines = crownOutlines(grid, detected.labels, crowns.map(c => c.id));
  const publicDir = ctx.paths.publicDir;
  const baselineManifest = ctx.config.published.baselineGroundManifest;
  const { ground } = publishedGround(ctx, baselineManifest);
  const lookupReady = createGroundHeightLookup(ground, async url => fs.readFileSync(path.join(publicDir, url)));
  return lookupReady.then(lookup => decide(lookup));
  function decide(lookup) {
  /* play zone: the app's zone A (main.js LEGACY_ZONE_A_METRES, playZone.nearMetres
     from a hole's tee-to-green line), every routing, plus the practice areas
     (driving range and practice greens) by the same distance */
  const { geometry, holeLines, practiceRings } = playGeometry(ctx);
  const nearMetres = ctx.config.playZone.nearMetres;
  const playOf = (e, n) => nearPlay(e, n, holeLines, practiceRings, nearMetres) ? 'near' : 'woodland';
  const laserYear = ctx.config.laser.capturedOn.slice(0, 4);
  const leafOffLabel = photoLabel(ctx.leafOff);
  const presenceLabel = photoLabel(ctx.presence);
  const typeRoundLabel = ctx.config.typeRule.round === 'r1' ? 'round-1' : `${ctx.config.typeRule.round}`;
  /* conifer probability from the leaf-off vegetated share: a logistic fit on
     the type round's CALIBRATION examples only; confidence = max(p, 1 - p).
     A BROADLEAF CALL NEEDS A CLEARLY LEAFLESS CROWN (share below
     typeRule.broadleafMaximumAprilShare). Between that and the conifer call
     the crown is 'unknown' and the runtime's own species mix chooses. At
     Johannesberg (0.2) the logistic alone called broadleaf up to a share of
     0.41, and a spot check of
     24 such calls within 90 m of holes 1 and 17 (type-panels.mjs) found 8
     shaded or edge conifers (3 uncertain), all with shares of 0.26-0.40: in leaf-off April
     a conifer in its neighbour's shadow, or a narrow one whose disc takes in
     brown ground, reads as partly leafless. Below 0.2 lie 17 of the 35
     reference broadleaves and none of the 60 reference conifers, and none of
     the 11 spot-checked calls there was a conifer (owner-requested species
     check, 2026-11-08). */
  const typeExamplesAll = typeRule.examplesTable;
  const logistic = fitLogistic(typeExamplesAll.filter(x => x.role === 'calibration' && Number.isFinite(x.features.aprilVegetatedShare)).map(x => [x.features.aprilVegetatedShare, x.type === 'conifer' ? 1 : 0]));
  const typeOf = share => {
    if (!Number.isFinite(share)) return { type: 'unknown', typeConfidence: null, coniferProbability: null };
    const pc = 1 / (1 + Math.exp(-(logistic.w0 + logistic.w1 * share)));
    const confidence = Math.max(pc, 1 - pc);
    const type = confidence >= unknownBelowConfidence && pc >= 0.5 ? 'conifer' : confidence >= unknownBelowConfidence && share < BROADLEAF_MAXIMUM_APRIL_SHARE ? 'broadleaf' : 'unknown';
    return { type, typeConfidence: type === 'unknown' ? null : round(confidence, 3), coniferProbability: round(pc, 3) };
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
  const referencePath = ctx.reviewFile(ctx.sampleFile('reference', 'geojson'));
  const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8')).features.filter(f => f.properties.scored);
  const refJune = reference.map(f => photoDisc(m25, f.properties.easting, f.properties.northing, (f.properties.segment?.equivalentRadiusMetres || 2) + displacementAllowance(f.properties.heightMetres))).filter(Boolean);
  const median = values => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const scale = { vegetatedShare: median(refJune.map(j => j.vegetatedShare)), nirTexture: median(refJune.map(j => j.nirTexture)), darkShare: median(refJune.map(j => j.darkShare)) };
  const refScores = refJune.map(j => presenceScore(j, scale)).sort((a, b) => a - b);
  const presenceFloor = refScores[Math.floor(0.02 * (refScores.length - 1))];
  const dark25 = 0.7 * openGroundBrightness(m25, chm), dark21 = 0.7 * openGroundBrightness(m21, chm);
  const fellingReviewPath = ctx.reviewFile('felling-review.json');
  const fellingReview = fs.existsSync(fellingReviewPath) ? JSON.parse(fs.readFileSync(fellingReviewPath, 'utf8')) : { decisions: {} };
  const poleRule = ctx.config.holds.poleLike;
  const poleReviewPath = ctx.reviewFile('pole-review.json');
  const poleReview = fs.existsSync(poleReviewPath) ? JSON.parse(fs.readFileSync(poleReviewPath, 'utf8')) : { decisions: {} };
  const poles = [];
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
    const shadow25 = shadowProbe(m25, crown.apex.easting, crown.apex.northing, crown.heightMetres, crown.equivalentRadiusMetres, ctx.presence.sun, dark25);
    const shadow21 = shadowProbe(m21, crown.apex.easting, crown.apex.northing, crown.heightMetres, crown.equivalentRadiusMetres, ctx.leafOff.sun, dark21);
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
        laser: { campaign: ctx.config.laser.label, returns: returns?.returns ?? 0, firstReturns: returns?.firstReturns ?? 0, firstCanopyShare: returns?.firstCanopyShare ?? null, groundShare: returns?.groundShare ?? null },
        [leafOffKey]: april ? { contrastP90: round(april.contrastP90, 3), vegetatedShare: round(april.vegetatedShare, 3) } : null,
        [presenceKey]: june ? { vegetatedShare: round(june.vegetatedShare, 3), nirTexture: round(june.nirTexture, 1), darkShare: round(june.darkShare, 3), presence } : null,
        surface: surfaceAt(at.easting, at.northing),
        structureSuspect: Boolean(structure),
        closedness: round(closed, 2), [shadowLeafOffKey]: round(shadow21, 3), [shadowPresenceKey]: round(shadow25, 3),
        fellingScreen,
        ...(crown.recovered ? { recoveredTop: 'a top the type-aware detector suppressed, taken back on its laser cone and apex and a separate crown in the photo' } : {}),
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
    const entry = { easting: round(e, 2), northing: round(n, 2), heightMetres: round(h, 2), tallReturns: count, cells, [presenceKey]: june ? { vegetatedShare: round(june.vegetatedShare, 3), nirTexture: round(june.nirTexture, 1), presence } : null, [leafOffKey]: april ? { contrastP90: round(april.contrastP90, 3), vegetatedShare: round(april.vegetatedShare, 3) } : null, surface: surfaceAt(e, n) };
    if (presence !== null && presence >= presenceFloor && june.vegetatedShare >= 0.5) recovered.push(entry);
    else sparseUnresolved.push({ ...entry, reason: `laser returns >= 3 m without a crown in the ${presenceLabel} photo` });
  }
  for (const r of recovered) {
    trees.push({
      crownId: null, easting: r.easting, northing: r.northing, apex: { easting: r.easting, northing: r.northing },
      heightMetres: r.heightMetres, radiusMetres: round(Math.max(1.5, Math.min(4, 0.25 * r.heightMetres + 0.5)), 2), areaSquareMetres: null,
      type: (r[leafOffKey]?.contrastP90 ?? 0) >= 0.2 ? 'conifer' : 'broadleaf',
      evidence: { laser: { campaign: ctx.config.laser.label, tallReturns: r.tallReturns, note: 'sparse leaf-off returns: no crown on the CHM' }, [leafOffKey]: r[leafOffKey], [presenceKey]: r[presenceKey], surface: r.surface, structureSuspect: false },
      source: 'sparse-laser-recovery',
    });
  }
  /* photo-only canopy: presence-photo tree-like 1 m cells with no return >= 2 m within 3 m */
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
    photoOnly.push({ easting: round(g1.minEasting + se / queue.length + 0.5, 1), northing: round(g1.maxNorthing - sn / queue.length - 0.5, 1), areaSquareMetres: queue.length, reason: `tree-like canopy in the ${presenceLabel} photo with no laser return >= 2 m within 3 m: photo-only, never placed` });
  }
  /* 4. identities */
  const population = publishedPopulation(ctx, { bbox: [W.minEasting, W.minNorthing, W.maxEasting, W.maxNorthing], groundManifestUrl: baselineManifest });
  const allRecords = publishedPopulation(ctx, { groundManifestUrl: baselineManifest }).records;
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
  /* lineage from an earlier generation (published.lineage), when there is one */
  const lineageConfig = ctx.config.published.lineage || null;
  const previousManifest = lineageConfig ? JSON.parse(fs.readFileSync(path.join(publicDir, lineageConfig.groundManifest), 'utf8')) : { tiles: [] };
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
      const verdict = reviewedVerdict(fellingReview, tree.easting, tree.northing);
      screened.push({ key, easting: tree.easting, northing: tree.northing, heightMetres: tree.heightMetres, radiusMetres: tree.radiusMetres, verdict: verdict?.verdict ?? 'unreviewed' });
      if (!verdict) holdReasons.push(`felling screen: own shadow in ${leafOffLabel}, none in ${presenceLabel}; not yet reviewed`);
      else if (verdict.verdict === 'absent' || verdict.verdict === 'structure') felled = verdict.verdict;
      else if (verdict.verdict === 'unclear') holdReasons.push(`felling screen reviewed unclear: ${verdict.note || ''}`);
    }
    /* pole-like crowns: a tall crown narrower than a tree of its height is a
       pole, mast or lamp as often as a narrow tree; held until pole-review.json
       decides it (tree -> placed, not-tree -> removed / not placed) */
    let notTreePole = null;
    if (!felled && poleLike(tree, poleRule)) {
      const verdict = reviewedVerdict(poleReview, tree.easting, tree.northing);
      poles.push({ key: keyOf(tree.easting, tree.northing), easting: tree.easting, northing: tree.northing, heightMetres: tree.heightMetres, radiusMetres: tree.radiusMetres, verdict: verdict?.verdict ?? 'unreviewed' });
      if (!verdict) holdReasons.push(`pole-like crown (radius ${tree.radiusMetres} m, height ${tree.heightMetres} m): pole, mast or narrow tree? unreviewed`);
      else if (verdict.verdict === 'not-tree') notTreePole = `not a tree (pole review): ${verdict.note || ''}`;
      else if (verdict.verdict === 'unclear') holdReasons.push(`pole-like crown reviewed unclear: ${verdict.note || ''}`);
    }
    if (notTreePole) felled = 'pole';
    /* no vegetation at all in the presence photo's crown disc: every reference crown
       but one has a vegetated share above 0.7; roofs, vehicles, heaps and
       felled trees do not. Held until reviewed. */
    if (!felled && !tree.evidence.fellingScreen && tree.source === 'detector' && (tree.evidence[presenceKey]?.vegetatedShare ?? 1) < 0.15) {
      holdReasons.push(`no vegetation in the ${presenceLabel} crown disc (roof, vehicle, heap or felled?): unreviewed`);
    }
    const notTree = felled ? (felled === 'pole' ? notTreePole : felled === 'structure' ? `not a tree: ${reviewedVerdict(fellingReview, tree.easting, tree.northing).note}` : `felled after ${laserYear}: ${reviewedVerdict(fellingReview, tree.easting, tree.northing).note}`) : null;
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
      id = treeId(ctx.groundId, sequence);
      decision = felled ? 'not-placed' : holdReasons.length ? 'hold' : 'add';
      if (felled) { holdReasons.length = 0; holdReasons.push(notTree); }
    }
    const typed = typeOf(tree.evidence[leafOffKey]?.vegetatedShare);
    out.push({
      id, decision, ...(holdReasons.length ? { reasons: holdReasons } : {}),
      play: playOf(tree.easting, tree.northing), typeConfidence: typed.typeConfidence, coniferProbability: typed.coniferProbability,
      easting: tree.easting, northing: tree.northing, positionSemantics: tree.source === 'detector' ? `${positionWord} of the laser crown segment (not a surveyed stem)` : 'highest leaf-off return (not a surveyed stem)',
      heightRH2000: Number.isFinite(base) ? round(base, 3) : null,
      objectHeightMetres: tree.heightMetres, radiusMetres: tree.radiusMetres, type: typed.type, typeRule1: tree.type, source: tree.source,
      ...(before ? { before } : {}),
      ...(match && lineage.has(match.record.id) ? { lineage: { previousGenerationId: lineage.get(match.record.id), previousGeneration: lineageConfig.label } } : {}),
      evidence: tree.evidence,
      outline: tree.crownId !== null ? outlines.get(tree.crownId) || null : null,
    });
  });
  for (const r of unmatchedRecords) {
    /* is there canopy at the record at all, in the laser? */
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
      reasons: [noCanopy ? `no canopy >= 2 m within 2 m in the ${laserYear} laser (max ${round(maxChm, 2)} m) and no tree-like crown in ${presenceLabel} (presence ${presence})` : merge ? `canopy (max ${round(maxChm, 2)} m) carried by crown ${host.id} ${round(hostDistance, 2)} m away; ID retired into it` : `canopy present (max ${round(maxChm, 2)} m within 2 m) but no placed crown within 6 m`],
      ...(merge ? { mergedInto: host.id } : {}),
      play: playOf(r.easting, r.northing), typeConfidence: null, coniferProbability: null,
      easting: r.easting, northing: r.northing, heightRH2000: r.heightRH2000, objectHeightMetres: r.objectHeightMetres, radiusMetres: r.radiusMetres, type: 'unknown', source: 'published-record',
      ...(lineage.has(r.id) ? { lineage: { previousGenerationId: lineage.get(r.id), previousGeneration: lineageConfig.label } } : {}),
    });
  }
  /* counts */
  const count = (list, key) => list.reduce((a, t) => { const k = key(t); a[k] = (a[k] || 0) + 1; return a; }, {});
  const placed = out.filter(t => ['retain', 'adjust', 'add'].includes(t.decision));
  const summary = {
    schemaVersion: 1,
    kind: 'inner-ring-tree-candidates',
    state: 'candidate, not published',
    groundId: ctx.groundId,
    innerWindowEpsg3006: [W.minEasting, W.minNorthing, W.maxEasting, W.maxNorthing],
    detectorLockSha256: lock.selected,
    publishedGroundManifest: population.groundManifestUrl,
    today: { individualRecords: records.length, standTreesHighQuality: population.standTrees.length, total: records.length + population.standTrees.length },
    notPlacedOrRemovedByReview: count(out.filter(t => t.decision === 'not-placed' || (t.decision === 'remove' && /felled|not a tree/.test((t.reasons || [''])[0]))), t => `${t.decision}:${/felled/.test(t.reasons[0]) ? `felled after ${laserYear}` : 'not a tree'}`),
    candidates: { total: out.length, byDecision: count(out, t => t.decision), placedTrees: placed.length, placedByType: count(placed, t => t.type), placedBySource: count(placed, t => t.source), holdByReason: count(out.filter(t => t.decision === 'hold'), t => { const r = (t.reasons || ['?'])[0]; return /pole-like/.test(r) ? 'pole-like crown' : /crown disc \(roof, vehicle/.test(r) ? `no ${presenceLabel} vegetation (unreviewed)` : /played surface/.test(r) ? 'crown over a played surface' : /building/.test(r) ? 'on a mapped building' : /structure/.test(r) ? 'structure suspect' : /felling/.test(r) ? 'felling screen' : /mapped (water|road|path|railway)/.test(r) ? 'on water, road or path' : /no placed crown/.test(r) ? 'record without crown' : 'other'; }) },
    fellingScreen: { screened: screened.length, byVerdict: count(screened, t => t.verdict) },
    ...(poleRule ? { poleScreen: { rule: poleRule, screened: poles.length, byVerdict: count(poles, t => t.verdict) } } : {}),
    playTypeDecision: (() => {
      const table = {};
      for (const t of out) { const key = `${t.play}|${t.type}`; table[key] = table[key] || {}; table[key][t.decision] = (table[key][t.decision] || 0) + 1; }
      return table;
    })(),
    typeModel: { feature: `share of vegetated pixels ((NIR-red)/(NIR+red) > 0.12) in the ${leafOffLabel} crown disc (crown radius + 0.3 h + 1 m)`, fit: `logistic, ${typeRoundLabel} calibration examples only`, w0: round(logistic.w0, 4), w1: round(logistic.w1, 4), examples: logistic.n, unknownBelowConfidence, broadleafBelowAprilShare: BROADLEAF_MAXIMUM_APRIL_SHARE, unknownTypeConfidence: null },
    playZone: { rule: `near = within ${nearMetres} m of any hole tee-to-green line of ${ctx.config.courseSlugs.length === 2 ? 'either routing' : ctx.config.courseSlugs.length > 2 ? 'any routing' : 'the routing'} (the app zone A) or of the driving range / practice greens; woodland otherwise`, holeLines: holeLines.length, practiceRings: practiceRings.length },
    identity: { matchedWithin15m: pass1.matches.length, matchedWithin3m: pass2.matches.length, newIds: out.filter(t => t.decision === 'add' || (t.decision === 'hold' && t.source !== 'published-record' && !t.before)).length, nextSequence: sequence + 1, previousGenerationRecords: previous.length, previousGenerationLineageCarried: out.filter(t => t.lineage).length },
    presence: { referenceFloor: round(presenceFloor, 3), scale },
    unresolved: { sparseLaserWithoutPhotoCrown: sparseUnresolved.length, photoOnlyCanopy: photoOnly.length },
    elapsedSeconds: round((performance.now() - started) / 1000, 1),
  };
  const files = { summary: ctx.reviewFile('candidates-summary.json'), csv: ctx.reviewFile('candidates.csv'), unresolved: ctx.reviewFile('unresolved.json'), outlines: path.join(ctx.paths.candidates, 'candidates-outlines.geojson'), full: path.join(ctx.paths.candidates, 'candidates-full.json'), felling: path.join(ctx.paths.candidates, 'felling-screen.json'), poles: path.join(ctx.paths.candidates, 'pole-screen.json'), residualChm: path.join(ctx.paths.rasters, 'residual-chm-050.bin'), residualLabels: path.join(ctx.paths.rasters, 'residual-labels-050.bin') };
  fs.writeFileSync(files.summary, JSON.stringify(summary, null, 2) + '\n');
  /* committed: a compact CSV (a QGIS delimited-text layer in EPSG:3006);
     ignored cache: the full records with evidence and crown outlines, and
     the same layer as GeoJSON with outlines */
  const csvColumns = ['id', 'decision', 'play', 'easting', 'northing', 'heightRH2000', 'objectHeightMetres', 'radiusMetres', 'type', 'typeConfidence', 'source', 'previousGenerationId', 'mergedInto', 'moveMetres', 'beforeHeightMetres', 'beforeRadiusMetres', 'reason'];
  const csvValue = value => (value === null || value === undefined ? '' : /[",\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value));
  const csvRows = out.map(t => [t.id, t.decision, t.play, t.easting, t.northing, t.heightRH2000, t.objectHeightMetres, t.radiusMetres, t.type, t.typeConfidence, t.source, t.lineage?.previousGenerationId, t.mergedInto, t.before?.moveMetres, t.before?.heightMetres, t.before?.radiusMetres, t.reasons?.[0]].map(csvValue).join(','));
  fs.writeFileSync(files.csv, `${csvColumns.join(',')}\n${csvRows.join('\n')}\n`);
  const geojson = { type: 'FeatureCollection', name: `${ctx.groundId}-candidates-${ctx.reviewDate}`, crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3006' } }, features: out.map(t => ({ type: 'Feature', geometry: t.outline ? { type: 'Polygon', coordinates: [t.outline] } : { type: 'Point', coordinates: [t.easting, t.northing] }, properties: { id: t.id, decision: t.decision, type: t.type, easting: t.easting, northing: t.northing, h: t.objectHeightMetres, r: t.radiusMetres, src: t.source, base: t.heightRH2000, reason: t.reasons?.[0] ?? null, prev: t.lineage?.previousGenerationId ?? null, move: t.before?.moveMetres ?? null } })) };
  fs.mkdirSync(ctx.paths.candidates, { recursive: true });
  fs.writeFileSync(files.outlines, JSON.stringify(geojson) + '\n');
  fs.writeFileSync(files.unresolved, JSON.stringify({ schemaVersion: 1, note: 'never placed; next evidence: field check, newer leaf-on laser, or club confirmation', sparseLaserWithoutPhotoCrown: sparseUnresolved, photoOnlyCanopy: photoOnly }, null, 1) + '\n');
  fs.writeFileSync(files.full, JSON.stringify(out));
  fs.writeFileSync(files.felling, JSON.stringify(screened, null, 1));
  if (poleRule) fs.writeFileSync(files.poles, JSON.stringify(poles, null, 1));
  /* the residual inputs of the reviewed import, cropped to the inner window:
     the pit-free CHM, and every cell a detected crown (placed or not) or a
     sparse-laser recovery (a disc of its radius) claims */
  {
    const s = grid.sampleSpacingMetres;
    const c0 = Math.round((W.minEasting - grid.minEasting) / s), r0 = Math.round((grid.maxNorthing - W.maxNorthing) / s);
    const width = Math.round((W.maxEasting - W.minEasting) / s), height = Math.round((W.maxNorthing - W.minNorthing) / s);
    const chmOut = new Float32Array(width * height);
    const labelOut = new Int32Array(width * height).fill(-1);
    for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
      const i = (r0 + r) * grid.width + c0 + c;
      chmOut[r * width + c] = chm.values[i];
      labelOut[r * width + c] = detected.labels[i] >= 0 ? detected.labels[i] : -1;
    }
    let recoveredCells = 0;
    for (const t of out.filter(x => x.source === 'sparse-laser-recovery')) {
      const reach = Math.ceil(t.radiusMetres / s);
      const cc = Math.floor((t.easting - W.minEasting) / s), rr = Math.floor((W.maxNorthing - t.northing) / s);
      for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
        const r = rr + dy, c = cc + dx;
        if (r < 0 || c < 0 || r >= height || c >= width || (dx * dx + dy * dy) * s * s > t.radiusMetres ** 2) continue;
        if (labelOut[r * width + c] < 0) { labelOut[r * width + c] = 1 << 30; recoveredCells++; }
      }
    }
    const sidecar = { width, height, sampleSpacingMetres: s, originEasting: W.minEasting, originNorthing: W.maxNorthing, crs: 'EPSG:3006 / RH2000' };
    const dir = ctx.paths.rasters;
    fs.writeFileSync(path.join(dir, 'residual-chm-050.bin'), Buffer.from(chmOut.buffer));
    fs.writeFileSync(path.join(dir, 'residual-chm-050.json'), JSON.stringify({ ...sidecar, layer: 'pit-free CHM, inner window', dtype: 'float32' }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'residual-labels-050.bin'), Buffer.from(labelOut.buffer));
    fs.writeFileSync(path.join(dir, 'residual-labels-050.json'), JSON.stringify({ ...sidecar, layer: 'crown claims: detected crown id, 1<<30 for a sparse-laser recovery disc, -1 none', dtype: 'int32', recoveredCells }, null, 2) + '\n');
  }
  return { summary, out, screened, poles, files, inputs: [lockPath, typeRulePath, referencePath, fellingReviewPath, poleReviewPath, path.join(ctx.paths.rasters, 'chm-pitfree-050.bin'), path.join(ctx.paths.rasters, 'points.bin')] };
  }
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

/** The interpreter's verdict for a screened crown: exact key first, else the nearest reviewed position within 2 m. */
export function reviewedVerdict(review, easting, northing) {
  const exact = review.decisions[`${easting.toFixed(1)}_${northing.toFixed(1)}`];
  if (exact) return exact;
  let best = null, distance = 2;
  for (const verdict of Object.values(review.decisions)) {
    const d = Math.hypot(verdict.easting - easting, verdict.northing - northing);
    if (d <= distance) { distance = d; best = verdict; }
  }
  return best;
}

/**
 * How well the candidate set's type agrees with the interpreter's typed
 * reference crowns, per role of the active round (from the pilot's
 * type-check). Adds `typeCheck` to candidates-summary.json.
 */
export function typeCheck(ctx, full, summaryPath) {
  const placedOrHeld = full.filter(t => ['retain', 'adjust', 'add', 'hold'].includes(t.decision));
  const reference = JSON.parse(fs.readFileSync(ctx.reviewFile(ctx.sampleFile('reference', 'geojson')), 'utf8'));
  const windows = JSON.parse(fs.readFileSync(ctx.reviewFile(ctx.sampleFile('reference-windows')), 'utf8'));
  const minimum = windows.minimumScoredHeightMetres;
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const unseen = ctx.round.roles.filter(role => role !== 'calibration');
  const result = { method: `placed or held candidates matched (nearest within 4 m) to reference crowns typed conifer/broadleaf by the interpreter; calibration was used to fit the model, ${unseen.join(' and ')} ${unseen.length === 1 ? 'was' : 'were'} not` };
  for (const role of ctx.round.roles) {
    const refs = reference.features.filter(f => f.properties.role === role && ['conifer', 'broadleaf'].includes(f.properties.type) && f.properties.heightMetres >= minimum).map(f => f.properties);
    let matched = 0, correct = 0, unknown = 0, high = 0, highCorrect = 0;
    for (const r of refs) {
      let best = null, distance = 4;
      for (const t of placedOrHeld) { const d = Math.hypot(t.easting - r.easting, t.northing - r.northing); if (d < distance) { distance = d; best = t; } }
      if (!best) continue;
      matched++;
      if (best.type === 'unknown') { unknown++; continue; }
      if (best.type === r.type) correct++;
      if (best.typeConfidence >= 0.8) { high++; if (best.type === r.type) highCorrect++; }
    }
    result[role] = { matched, typed: matched - unknown, correct, accuracyOfTyped: Math.round((1000 * correct) / Math.max(1, matched - unknown)) / 1000, unknown, confidence80: { n: high, accuracy: Math.round((1000 * highCorrect) / Math.max(1, high)) / 1000 } };
  }
  summary.typeCheck = result;
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  return result;
}

export async function run(ctx) {
  for (const [what, file] of [['detector lock', ctx.reviewFile(ctx.sampleFile('detector-lock'))], ['type rule', ctx.reviewFile(ctx.sampleFile('type-rule', 'json', ctx.config.typeRule.round))], ['frozen reference', ctx.reviewFile(ctx.sampleFile('reference', 'geojson'))]]) {
    if (!fs.existsSync(file)) return { status: 'stop', message: `no ${what} (${ctx.rel(file)}): run the reference and benchmark stages first` };
  }
  const built = await buildCandidates(ctx);
  const check = typeCheck(ctx, built.out, built.files.summary);
  console.log(JSON.stringify({ candidates: built.summary.candidates, typeCheck: check }, null, 1));
  const f = built.files;
  writeReceipt(ctx, 'candidates', {
    inputs: built.inputs.filter(file => fs.existsSync(file)),
    outputs: [f.csv, f.summary, f.unresolved, f.full, f.outlines, f.felling, ...(ctx.config.holds.poleLike ? [f.poles] : []), f.residualChm, f.residualLabels],
    perRound: false,
    result: { round: ctx.round.id, byDecision: built.summary.candidates.byDecision, placedByType: built.summary.candidates.placedByType, fellingScreen: built.summary.fellingScreen, poleScreen: built.summary.poleScreen ?? null },
  });
  const unreviewedFelling = built.screened.filter(s => s.verdict === 'unreviewed').length;
  const unreviewedPoles = built.poles.filter(s => s.verdict === 'unreviewed').length;
  const felled = built.out.filter(t => (t.decision === 'remove' || t.decision === 'not-placed') && /felled/.test((t.reasons || [''])[0])).length;
  const lines = [`${built.summary.candidates.placedTrees} placed (${Object.entries(built.summary.candidates.placedByType).map(([k, v]) => `${k} ${v}`).join(', ')}); decisions ${JSON.stringify(built.summary.candidates.byDecision)}`];
  if (unreviewedFelling || unreviewedPoles) {
    lines.push(`HUMAN REVIEW: ${unreviewedFelling} felling-screened and ${unreviewedPoles} pole-like crowns are unreviewed (held). Draw their chips with --stage review --only screens, record each verdict in felling-review.json (absent | structure | present | unclear) and pole-review.json (tree | not-tree | unclear), keyed "<easting.1>_<northing.1>" with easting, northing and note, then rerun this stage.`);
    return { status: 'stop', message: lines.join('\n') };
  }
  if (felled) lines.push(`${felled} crowns are decided felled since the laser: the owner confirms that list before publication (review checklist).`);
  return { status: 'done', message: lines.join('\n') };
}
