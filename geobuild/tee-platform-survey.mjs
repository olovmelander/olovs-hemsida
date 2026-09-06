#!/usr/bin/env node
/* Evidence-only tee terrain measurements from immutable published 1 m DTM.
 * node geobuild/tee-platform-survey.mjs --build upsalabuild --ground upsala \
 *   --out upsalabuild/cache/tee-terrain-current.json
 * Optional --repo REPO and --evidence FILE; BUILD/GROUND are also supported.
 * Evidence is [{id,hole,ring}], or {features:[{id,hole,ring}],provenance:{...}}.
 * A supplied frame:{origin,mPerLat,mPerLon} must equal the selected model frame.
 * Rings MUST use this build's local [x,z] frame. Without evidence, every current
 * model.holes[].tees.pads ring is measured. --out is a JSON file (not a prefix).
 *
 * The fitted slope and residual planarity are separate: a draining tilted plane
 * has nonzero slope but zero detrended roughness. A bowl can have zero net slope
 * and large residuals. The 2 m inner/edge bands and 2 m exterior annulus expose
 * shoulders and nearby relief. They do not establish tee identity or boundaries.
 * No automatic acceptance, shape edits, flattening, or raw terrain writes occur.
 * Missing/off-grid samples stay missing; partial fits describe finite samples
 * only. Native 1 m spacing and 1 cm encoding are NOT survey accuracy claims.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const finitePair = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
const round = (value, decimals = 6) => Number.isFinite(value) ? +value.toFixed(decimals) : null;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function boundaryDistance(e, n, ring) {
  let squared = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], de = b[0] - a[0], dn = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((e - a[0]) * de + (n - a[1]) * dn) / (de * de + dn * dn || 1)));
    squared = Math.min(squared, (e - a[0] - t * de) ** 2 + (n - a[1] - t * dn) ** 2);
  }
  return Math.sqrt(squared);
}

function inside(e, n, ring, distance = boundaryDistance(e, n, ring)) {
  if (distance < 1e-8) return true;
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i][1] > n) !== (ring[j][1] > n) && e < (ring[j][0] - ring[i][0]) * (n - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
  }
  return hit;
}

function polygon(ring) {
  assert(Array.isArray(ring) && ring.length >= 3 && ring.every(finitePair), 'requires a finite polygon ring');
  ring = ring.map(point => [...point]);
  if (ring.length > 3 && ring[0].every((value, i) => value === ring.at(-1)[i])) ring.pop();
  assert.equal(new Set(ring.map(point => JSON.stringify(point))).size, ring.length, 'repeated polygon vertex');
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a, b, c) => Math.abs(orient(a, b, c)) < 1e-9 && c[0] >= Math.min(a[0], b[0]) - 1e-9 && c[0] <= Math.max(a[0], b[0]) + 1e-9 && c[1] >= Math.min(a[1], b[1]) - 1e-9 && c[1] <= Math.max(a[1], b[1]) + 1e-9;
  for (let i = 0; i < ring.length; i++) for (let j = i + 2; j < ring.length; j++) {
    if (i === 0 && j === ring.length - 1) continue;
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[j], d = ring[(j + 1) % ring.length];
    const crosses = orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
    assert(!crosses && !onSegment(a, b, c) && !onSegment(a, b, d) && !onSegment(c, d, a) && !onSegment(c, d, b), 'self-intersecting polygon ring');
  }
  const [e0, n0] = ring[0];
  let twiceArea = 0, ce = 0, cn = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = [ring[i][0] - e0, ring[i][1] - n0], b = [ring[(i + 1) % ring.length][0] - e0, ring[(i + 1) % ring.length][1] - n0];
    const cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross; ce += (a[0] + b[0]) * cross; cn += (a[1] + b[1]) * cross;
  }
  assert(Math.abs(twiceArea) > 1e-8, 'degenerate polygon ring');
  return { ring, areaM2: Math.abs(twiceArea / 2), centre: [e0 + ce / (3 * twiceArea), n0 + cn / (3 * twiceArea)] };
}

function statistics(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = q => { const at = (sorted.length - 1) * q, low = Math.floor(at); return sorted[low] + (sorted[Math.ceil(at)] - sorted[low]) * (at - low); };
  return { count: values.length, meanM: round(mean(values)), medianM: round(quantile(.5)), p05M: round(quantile(.05)), p95M: round(quantile(.95)), p95MinusP05M: round(quantile(.95) - quantile(.05)), rmseM: round(Math.sqrt(mean(values.map(v => v * v)))), maxAbsoluteM: round(values.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0)) };
}

function fitPlane(samples, minimumSamples) {
  if (samples.length < minimumSamples) return null;
  const e0 = mean(samples.map(p => p.e)), n0 = mean(samples.map(p => p.n)), h0 = mean(samples.map(p => p.h));
  let ee = 0, nn = 0, en = 0, eh = 0, nh = 0;
  for (const p of samples) { const e = p.e - e0, n = p.n - n0, h = p.h - h0; ee += e * e; nn += n * n; en += e * n; eh += e * h; nh += n * h; }
  const determinant = ee * nn - en * en;
  if (!(determinant > 1e-10 * ee * nn)) return null;
  const east = (eh * nn - nh * en) / determinant, north = (nh * ee - eh * en) / determinant;
  const heightAt = (e, n) => h0 + east * (e - e0) + north * (n - n0);
  const gradient = Math.hypot(east, north);
  return {
    heightAt,
    report: { sampleCount: samples.length, anchorEPSG3006: [round(e0), round(n0)], anchorHeightRH2000M: round(h0), eastGradientMPerM: round(east), northGradientMPerM: round(north), slopePercent: round(gradient * 100), slopeDegrees: round(Math.atan(gradient) * 180 / Math.PI), uphillBearingDegrees: gradient < 1e-9 ? null : round((Math.atan2(east, north) * 180 / Math.PI + 360) % 360), residuals: statistics(samples.map(p => p.h - heightAt(p.e, p.n))) },
  };
}

function interpolate(grid, e, n) {
  const x = e - grid.e0, y = grid.n1 - n, x0 = Math.floor(x), y0 = Math.floor(y), dx = x - x0, dy = y - y0;
  let value = 0;
  for (const [xx, yy, weight] of [[x0, y0, (1 - dx) * (1 - dy)], [x0 + 1, y0, dx * (1 - dy)], [x0, y0 + 1, (1 - dx) * dy], [x0 + 1, y0 + 1, dx * dy]]) {
    if (weight <= 1e-12) continue;
    if (xx < 0 || yy < 0 || xx >= grid.width || yy >= grid.height) return null;
    const h = grid.heights[yy * grid.width + xx];
    if (!Number.isFinite(h)) return null;
    value += weight * h;
  }
  return value;
}

/** Pure measurement: ring in EPSG:3006, a 1 m north-to-south grid in RH 2000.
 * Expected counts include the native sampling lattice outside the loaded grid.
 * NoData is never filled and a fit is never an acceptance decision.
 */
export function measurePlatform(feature, grid, { edgeBandM = 2, exteriorBandM = 2, minimumSamples = 12, maxWindowSamples = 1_000_000 } = {}) {
  assert(Number.isInteger(grid.width) && grid.width > 1 && Number.isInteger(grid.height) && grid.height > 1 && grid.heights?.length === grid.width * grid.height && Number.isFinite(grid.e0) && Number.isFinite(grid.n1), 'invalid 1 m grid');
  assert(edgeBandM > 0 && exteriorBandM > 0 && Number.isInteger(minimumSamples) && minimumSamples >= 3 && maxWindowSamples > 0, 'invalid measurement options');
  const { ring, areaM2, centre } = polygon(feature.ring), xs = ring.map(p => p[0] - grid.e0), ys = ring.map(p => grid.n1 - p[1]);
  const x0 = Math.floor(Math.min(...xs) - exteriorBandM), x1 = Math.ceil(Math.max(...xs) + exteriorBandM), y0 = Math.floor(Math.min(...ys) - exteriorBandM), y1 = Math.ceil(Math.max(...ys) + exteriorBandM);
  assert((x1 - x0 + 1) * (y1 - y0 + 1) <= maxWindowSamples, 'tee measurement window exceeds budget');
  const groups = Object.fromEntries(['interior', 'edge', 'core', 'exterior'].map(name => [name, { expected: 0, outsideGrid: 0, noData: 0, samples: [] }]));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const e = grid.e0 + x, n = grid.n1 - y, distance = boundaryDistance(e, n, ring), isInside = inside(e, n, ring, distance);
    if (!isInside && distance > exteriorBandM) continue;
    const names = isInside ? ['interior', distance <= edgeBandM ? 'edge' : 'core'] : ['exterior'];
    const outside = x < 0 || y < 0 || x >= grid.width || y >= grid.height, h = outside ? NaN : grid.heights[y * grid.width + x];
    for (const name of names) {
      const group = groups[name]; group.expected++;
      if (outside) group.outsideGrid++;
      else if (!Number.isFinite(h)) group.noData++;
      else group.samples.push({ e, n, h });
    }
  }
  const coverage = Object.fromEntries(Object.entries(groups).map(([name, group]) => [name, { expectedSamples: group.expected, finiteSamples: group.samples.length, outsideGridSamples: group.outsideGrid, noDataSamples: group.noData, finiteFraction: group.expected ? round(group.samples.length / group.expected) : null, complete: group.expected > 0 && group.samples.length === group.expected }]));
  const full = fitPlane(groups.interior.samples, minimumSamples), core = fitPlane(groups.core.samples, minimumSamples), reference = core || full;
  const comparisons = reference ? Object.fromEntries(['edge', 'core', 'exterior'].map(name => [name, statistics(groups[name].samples.map(p => p.h - reference.heightAt(p.e, p.n)))])) : null;
  const warnings = [];
  if (!coverage.interior.expectedSamples) warnings.push('native-grid-has-no-interior-sample');
  else if (!coverage.interior.complete) warnings.push('incomplete-interior-coverage; fit describes only finite samples');
  if (!full) warnings.push('insufficient-samples-or-spatial-rank-for-plane');
  if (!core) warnings.push('no-supported-inner-plane; edge/core comparison uses full-ring plane if available');
  if (!coverage.exterior.complete) warnings.push('incomplete-exterior-context');
  return {
    id: feature.id, hole: feature.hole ?? null, reviewRequired: true, automaticAdoption: false,
    areaM2: round(areaM2), ringEPSG3006: ring.map(p => p.map(v => round(v))),
    coverage, centre: { method: 'polygon area centroid; DTM height uses finite native corners only', epsg3006: centre.map(v => round(v)), insideRing: inside(...centre, ring), sampledHeightRH2000M: round(interpolate(grid, ...centre)), fittedHeightRH2000M: round(full?.heightAt(...centre)) },
    fullPlane: full?.report ?? null, corePlane: core?.report ?? null,
    edgeCoreComparison: comparisons ? { referencePlane: core ? 'core' : 'full', ...comparisons, edgeMinusCoreMeanResidualM: comparisons.edge && comparisons.core ? round(comparisons.edge.meanM - comparisons.core.meanM) : null, exteriorMinusCoreMeanResidualM: comparisons.exterior && comparisons.core ? round(comparisons.exterior.meanM - comparisons.core.meanM) : null } : null,
    measurementStatus: !coverage.interior.expectedSamples ? 'insufficient-spatial-samples' : !coverage.interior.complete ? 'incomplete-terrain-coverage' : !full ? 'insufficient-spatial-samples' : 'measured-evidence-only', warnings,
  };
}

const BUILD_COURSES = { geobuild: 'veckefjarden', upsalabuild: 'upsala', upsalamellanbuild: 'upsala-mellanbanan', puttombuild: 'puttom', johannesbergbuild: 'johannesberg', angsobuild: 'angso', nvgkbuild: 'norrfallsviken', ribbingsforsbuild: 'ribbingsfors' };

/** Validate declared local-frame identity before any evidence ring is projected.
 * Frame-less arrays remain supported; a supplied incomplete/null frame is an error.
 */
export function validateEvidenceFrame(evidence, model) {
  if (!evidence || !Object.hasOwn(evidence, 'frame')) return false;
  const frame = evidence.frame;
  assert(frame && typeof frame === 'object' && !Array.isArray(frame), 'evidence frame must identify the selected source model frame');
  assert.deepEqual(
    { origin: frame.origin, mPerLat: frame.mPerLat, mPerLon: frame.mPerLon },
    { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon },
    'evidence frame differs from the selected source model frame; do not project these local rings',
  );
  return true;
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { console.log('node geobuild/tee-platform-survey.mjs --build BUILD --ground GROUND_OR_COURSE_SLUG --out REPORT.json [--evidence FILE.json] [--repo REPO]'); return; }
    const key = argv[i].replace(/^--/, '');
    assert(['repo', 'build', 'ground', 'out', 'evidence'].includes(key) && argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--'), `unknown or incomplete option ${argv[i]}`);
    assert(!Object.hasOwn(options, key), `duplicate option ${argv[i]}`); options[key] = argv[++i];
  }
  const repo = path.resolve(options.repo || process.env.COURSE_REPO || ROOT), build = options.build || process.env.BUILD, groundId = options.ground || process.env.GROUND || BUILD_COURSES[path.basename(build || '')];
  assert(build && groundId && options.out, '--build, --ground and --out are required');
  const modelPath = path.resolve(repo, build, 'course-model.json'), publicDir = path.join(repo, 'apps/golf/public'), output = path.resolve(options.out);
  const inputs = new Map();
  const read = filename => { const bytes = fs.readFileSync(filename); inputs.set(path.resolve(filename), sha(bytes)); return bytes; };
  const publicFile = reference => {
    assert(typeof reference?.url === 'string' && !path.isAbsolute(reference.url), 'invalid public asset URL');
    const filename = path.resolve(publicDir, reference.url);
    assert(filename.startsWith(publicDir + path.sep), 'asset URL escapes public directory');
    const bytes = read(filename); assert.equal(sha(bytes), reference.sha256, `asset checksum ${reference.url}`);
    if (reference.bytes !== undefined) assert.equal(bytes.length, reference.bytes, `asset length ${reference.url}`);
    return bytes;
  };
  const sourceBytes = read(modelPath), model = JSON.parse(sourceBytes);
  assert(Number.isFinite(model.origin?.lat) && Number.isFinite(model.origin?.lon) && model.mPerLat > 0 && model.mPerLon > 0, 'model requires an explicit flat-earth frame');
  const evidencePath = options.evidence ? path.resolve(options.evidence) : null, evidenceBytes = evidencePath ? read(evidencePath) : null, evidence = evidenceBytes ? JSON.parse(evidenceBytes) : null;
  validateEvidenceFrame(evidence, model);
  const features = evidence ? (Array.isArray(evidence) ? evidence : evidence.features) : model.holes.flatMap(hole => (hole.tees?.pads || []).map((pad, i) => ({ id: pad.id || `${path.basename(build)}-h${hole.n}-tee-${i + 1}`, hole: hole.n, ring: pad.ring })));
  assert(Array.isArray(features) && features.length, 'no tee polygon features');
  assert(features.every(f => typeof f.id === 'string' && f.id.length && Number.isInteger(f.hole) && f.hole > 0), 'features need unique string id and positive integer hole');
  assert.equal(new Set(features.map(f => f.id)).size, features.length, 'duplicate feature id');
  assert(features.every(f => model.holes.some(hole => hole.n === f.hole)), 'evidence references a hole outside this build');
  const [{ readChunk }, { decodeTerrainGrid }, { latLonToSweref99Tm }] = await Promise.all(['packages/course-v2/chunk-node.mjs', 'packages/course-v2/terrain-grid.mjs', 'packages/course-geo/chmv2/projection.mjs'].map(file => import(pathToFileURL(path.join(repo, file)))));
  const index = JSON.parse(read(path.join(publicDir, 'courses/v2-index.json')));
  const entry = index.courses.find(c => c.slug === groundId) || index.courses.find(c => c.groundId === groundId && c.slug === BUILD_COURSES[path.basename(build)]) || index.courses.find(c => c.groundId === groundId);
  assert(entry, `no published ground/course ${groundId}`);
  const courseBytes = publicFile(entry.manifest), course = JSON.parse(courseBytes), groundBytes = publicFile(course.groundManifest), ground = JSON.parse(groundBytes);
  assert.equal(course.groundId, ground.groundId); assert.equal(ground.frame.horizontalCrs, 'EPSG:3006'); assert.equal(ground.frame.verticalCrs, 'EPSG:5613');
  const tiles = ground.tiles.filter(t => t.lod === 0); assert(tiles.length, 'no published 1 m level-0 terrain');
  const e0 = Math.min(...tiles.map(t => t.bounds.minEasting)), n1 = Math.max(...tiles.map(t => t.bounds.maxNorthing)), e1 = Math.max(...tiles.map(t => t.bounds.maxEasting)), n0 = Math.min(...tiles.map(t => t.bounds.minNorthing));
  const width = Math.round(e1 - e0) + 1, height = Math.round(n1 - n0) + 1;
  assert(width * height <= 25_000_000, 'published terrain exceeds 25 million sample budget');
  const heights = new Float32Array(width * height).fill(NaN), seen = new Uint8Array(width * height), tileSources = [];
  for (const tile of tiles) {
    const reference = tile.layers.terrain, bytes = publicFile(reference), chunk = readChunk(bytes), grid = chunk.header.grid, values = decodeTerrainGrid(chunk.payload, grid);
    assert(Math.abs((tile.bounds.maxEasting - tile.bounds.minEasting) / (grid.width - 1) - 1) < 1e-8 && Math.abs((tile.bounds.maxNorthing - tile.bounds.minNorthing) / (grid.height - 1) - 1) < 1e-8, 'requires native 1 m terrain');
    const cx = tile.bounds.minEasting - e0, cy = n1 - tile.bounds.maxNorthing;
    assert(Number.isInteger(cx) && Number.isInteger(cy), 'unaligned terrain tile');
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
      const at = (cy + y) * width + cx + x, h = values[y * grid.width + x];
      if (seen[at]) assert((!Number.isFinite(h) && !Number.isFinite(heights[at])) || Math.abs(h - heights[at]) < .011, 'overlapping terrain samples disagree');
      heights[at] = h; seen[at] = 1;
    }
    tileSources.push({ id: tile.id, url: reference.url, sha256: sha(bytes), heightQuantizationStepM: grid.heightScaleMetres });
  }
  const project = ([x, z]) => latLonToSweref99Tm(model.origin.lat - z / model.mPerLat, model.origin.lon + x / model.mPerLon), origin = project([0, 0]);
  assert(origin[0] >= e0 - 2000 && origin[0] <= e1 + 2000 && origin[1] >= n0 - 2000 && origin[1] <= n1 + 2000, 'build frame is remote from selected ground');
  const rows = features.map(feature => measurePlatform({ ...feature, ring: polygon(feature.ring).ring.map(project) }, { width, height, e0, n1, heights }));
  const report = {
    schemaVersion: 1, build, groundId: ground.groundId, selectedCourseSlug: entry.slug, reviewRequired: true, automaticAdoption: false,
    method: { sampling: 'native 1 m DTM lattice inside or on polygon; missing and off-grid samples counted', plane: 'ordinary least squares height = intercept + east gradient + north gradient; all interior and separate inner core', minimumFitSamples: 12, edgeBandM: 2, exteriorBandM: 2, residuals: 'height minus fitted drainage plane; slope does not imply poor planarity', coreBoundary: 'strictly more than 2 m inside the polygon', centreHeight: 'bilinear finite native DTM corners, no extrapolation or NoData fill', acceptance: 'none; compare dated imagery and acquisition dates; terrain alone does not prove a tee outline', absoluteHorizontalAccuracyM: null, absoluteVerticalAccuracyM: null },
    provenance: { model: { path: path.relative(repo, modelPath), sha256: sha(sourceBytes), localFrame: { origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon } }, evidence: evidenceBytes ? { path: path.relative(repo, evidencePath), sha256: sha(evidenceBytes), coordinateFrame: 'source model local [x,z]', suppliedProvenance: Array.isArray(evidence) ? null : evidence.provenance ?? null } : { source: 'model.holes[].tees.pads' }, courseManifestSha256: sha(courseBytes), groundManifestSha256: sha(groundBytes), groundSourceManifestSha256: ground.sourceManifestSha256, publishedFrame: ground.frame, transformation: 'repository flat-earth inverse to latitude/longitude, then SWEREF99TM projection; no fitted registration', measurementCrs: 'EPSG:3006', heightDatum: 'RH2000 / EPSG:5613', terrainBounds: { e0, n0, e1, n1 }, tiles: tileSources, terrainSourceUnmodified: true },
    summary: { platforms: rows.length, completeInteriorCoverage: rows.filter(r => r.coverage.interior.complete).length, measuredPlanes: rows.filter(r => r.fullPlane).length, supportedCorePlanes: rows.filter(r => r.corePlane).length, automaticAdoptions: 0 }, platforms: rows,
  };
  assert(!output.startsWith(publicDir + path.sep) && !inputs.has(output) && output !== fileURLToPath(import.meta.url), 'output must not overwrite a source or published asset');
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report.summary, groundId: ground.groundId, report: output }));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
