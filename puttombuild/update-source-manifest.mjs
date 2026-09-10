#!/usr/bin/env node
/* Refresh reproducible Puttom orthophoto evidence without approving survey,
 * canonical-origin, legacy rights, or unrelated source-acquisition gates. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sha256File } from '../packages/course-geo/manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'geo_data/course-v2/puttom/';
const files = {
  manifest: BASE + 'source-manifest.json',
  discovery: 'puttombuild/mapping/lm-ortho-discovery.json',
  plan: 'puttombuild/mapping/lm-ortho-plan.json',
  cacheAcquisition: 'puttombuild/cache/lm-ortho/acquisition.json',
  acquisition: BASE + 'acquisition/orthophoto-review.json',
  review: 'puttombuild/mapping/orthophoto-review.json',
  model: 'puttombuild/course-model.json',
  migrated: BASE + 'migration/course-model.epsg3006.json',
  residuals: BASE + 'migration/residual-report.json',
  teeDiscovery: 'puttombuild/mapping/lm-tee-2022-discovery.json',
  teePlan: 'puttombuild/mapping/lm-tee-2022-plan.json',
  teeCacheAcquisition: 'puttombuild/cache/lm-ortho/tee-2022-acquisition.json',
  teeAcquisition: BASE + 'acquisition/tee-2022-review.json',
};
const absolute = p => path.join(ROOT, p);
const has = p => fs.existsSync(absolute(p));
const read = p => JSON.parse(fs.readFileSync(absolute(p), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rawHash = p => hash(fs.readFileSync(absolute(p)));
const SHA256 = /^[a-f0-9]{64}$/;
const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === new Set(a).size &&
  b.length === new Set(b).size && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const nearArray = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
  a.every((v, i) => Number.isFinite(v) && Number.isFinite(b[i]) && Math.abs(v - b[i]) < 1e-6);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const manifest = read(files.manifest);
assert(manifest.groundId === 'puttom', 'Expected the Puttom source manifest');
const discovery = read(files.discovery), plan = read(files.plan);
const acquisitionPath = has(files.cacheAcquisition) ? files.cacheAcquisition : files.acquisition;
const acquisition = read(acquisitionPath);
assert(discovery.groundId === 'puttom' && discovery.orthophoto?.coverage?.complete &&
  plan.groundId === 'puttom' && plan.horizontalCrs === 'EPSG:3006' && plan.resolutionMetres === 0.16 &&
  plan.collection === discovery.orthophoto.collection && plan.discoverySha256 === hash(JSON.stringify(discovery)),
'Puttom orthophoto plan no longer matches the pinned catalogue verification');
assert(acquisition.groundId === 'puttom' && acquisition.state === 'acquired-for-review' &&
  acquisition.collection === plan.collection && acquisition.access?.authorized === true &&
  acquisition.planSha256 === rawHash(files.plan) && acquisition.rawImageryRedistributed === false &&
  acquisition.geometryChanged === false, 'Puttom orthophoto acquisition is incomplete or unbound to the exact acquired plan bytes');
assert(plan.windows?.length > 0 && sameIds(acquisition.windows?.map(w => w.id), plan.windows.map(w => w.id)) &&
  sameIds(acquisition.selectedWindows, plan.windows.map(w => w.id)) &&
  sameIds(acquisition.access.assets?.map(s => s.id), plan.sources.map(s => s.id)),
'Puttom orthophoto acquisition inventory differs from its plan');
assert(acquisition.access.assets.every(s => s.status === 206 && s.readable === true && !s.error),
  'Every pinned source must have verified authenticated TIFF byte access');
assert(sameIds(plan.summary?.coveredHoles, Array.from({ length: 18 }, (_, i) => i + 1)),
  'Puttom review plan must cover all eighteen holes');

for (const source of plan.sources) {
  const item = discovery.orthophoto.items.find(i => i.id === source.id);
  assert(item && item.assets.data.href === source.href && item.assets.data.bytes === source.bytes &&
    item.capturedAt === source.capturedAt && nearArray(item.projBbox, source.boundsEpsg3006) &&
    item.assets.data.projShape[0] === source.height && item.assets.data.projShape[1] === source.width,
  `Pinned orthophoto source changed: ${source.id}`);
}
for (const window of plan.windows) {
  const record = acquisition.windows.find(w => w.id === window.id);
  const t = [window.boundsEpsg3006[0], plan.resolutionMetres, 0, window.boundsEpsg3006[3], 0, -plan.resolutionMetres];
  assert(record && SHA256.test(record.sha256) && SHA256.test(record.requestSha256) &&
    record.width === window.width && record.height === window.height && record.validFraction === 1 &&
    nearArray(record.boundsEpsg3006, window.boundsEpsg3006) && nearArray(record.geoTransform, t) &&
    sameIds(record.sources?.map(s => s.id), window.sourceIds) && record.rasterFile === `${window.id}.tif`,
  `Acquired orthophoto window differs from its native plan grid: ${window.id}`);
  assert(record.sources.every(s => s.capturedAt === plan.sources.find(p => p.id === s.id)?.capturedAt),
    `Acquired window has unbound capture dates: ${window.id}`);
  // The repository retains metadata only. While local pixels exist, verify that
  // the acquisition hashes identify those actual pixels rather than just a log.
  const cachedRaster = `puttombuild/cache/lm-ortho/${record.rasterFile}`;
  if (has(cachedRaster)) assert(rawHash(cachedRaster) === record.sha256, `Cached orthophoto hash changed: ${window.id}`);
}

// Morning/midday images from the earlier campaign clarify shadows; retain their actual
// capture dates and separate acquisition evidence instead of relabelling 2022.
const sourceGroups = [{ plan, items: discovery.orthophoto.items, acquisitionFile: files.acquisition }];
let teeIntake = null;
if (has(files.teePlan)) {
  const p = read(files.teePlan), d = read(files.teeDiscovery);
  const file = has(files.teeCacheAcquisition) ? files.teeCacheAcquisition : files.teeAcquisition;
  const a = read(file);
  assert(p.groundId === 'puttom' && d.groundId === 'puttom' && p.collection === 'orto-u2-2022' &&
    p.collection === d.collection && p.horizontalCrs === 'EPSG:3006' && p.resolutionMetres === .16 &&
    p.discoverySha256 === hash(JSON.stringify(d)), 'Unbound earlier tee imagery plan');
  assert(a.groundId === 'puttom' && a.collection === p.collection && a.state === 'acquired-for-review' &&
    a.planSha256 === rawHash(files.teePlan) && a.access?.authorized && a.rawImageryRedistributed === false &&
    a.geometryChanged === false && sameIds(a.windows.map(w => w.id), p.windows.map(w => w.id)) &&
    sameIds(a.selectedWindows, p.windows.map(w => w.id)) &&
    sameIds(a.access.assets.map(s => s.id), p.sources.map(s => s.id)) &&
    a.access.assets.every(s => s.status === 206 && s.readable && !s.error), 'Incomplete earlier tee imagery acquisition');
  assert(sameIds(p.windows.map(w => w.hole), Array.from({length:18}, (_, i) => i + 1)), 'Earlier tee imagery must cover all eighteen holes');
  for (const s of p.sources) {
    const item = d.items.find(i => i.id === s.id);
    assert(item && item.assets.data.href === s.href && item.assets.data.bytes === s.bytes &&
      item.capturedAt === s.capturedAt && nearArray(item.projBbox, s.boundsEpsg3006) &&
      item.assets.data.projShape[0] === s.height && item.assets.data.projShape[1] === s.width, `Earlier source changed: ${s.id}`);
  }
  for (const w of p.windows) {
    const r = a.windows.find(r => r.id === w.id);
    assert(r && SHA256.test(r.sha256) && SHA256.test(r.requestSha256) && r.validFraction === 1 &&
      r.width === w.width && r.height === w.height && r.rasterFile === `${w.id}.tif` &&
      nearArray(r.boundsEpsg3006, w.boundsEpsg3006) &&
      nearArray(r.geoTransform, [w.boundsEpsg3006[0], .16, 0, w.boundsEpsg3006[3], 0, -.16]) &&
      sameIds(r.sources.map(s => s.id), w.sourceIds) &&
      r.sources.every(s => s.capturedAt === p.sources.find(v => v.id === s.id)?.capturedAt), `Earlier native grid changed: ${w.id}`);
    const raster = `puttombuild/cache/lm-ortho/${r.rasterFile}`;
    if (has(raster)) assert(rawHash(raster) === r.sha256, `Earlier TIFF hash changed: ${w.id}`);
  }
  teeIntake = { plan: p, discovery: d, acquisition: a, acquisitionPath: file };
  sourceGroups.push({ plan: p, items: d.items, acquisitionFile: files.teeAcquisition });
}

const artifact = (id, kind, file, derivedFrom, notes, use = 'discovery-evidence') => {
  if (!has(file)) return;
  const value = { id, kind, path: file, sha256: sha256File(absolute(file)), derivedFrom: [...new Set(derivedFrom)], use, notes };
  const index = manifest.artifacts.findIndex(a => a.id === id);
  if (index < 0) manifest.artifacts.push(value); else manifest.artifacts[index] = value;
};

const imagery = manifest.sources.find(s => s.id === 'imagery-lm-ortho');
assert(imagery, 'Missing baseline imagery-lm-ortho source identity');
const capturedOn = plan.captureRange.first.slice(0, 10);
const acquiredOn = acquisition.observedAt.slice(0, 10);
const imageSourceIds = [];
const checksumReason = 'Only bounded native image windows were acquired and individually SHA-256 hashed; exact hashes and grids are in acquisition/orthophoto-review.json. Complete provider TIFFs were not downloaded or hashed.';
Object.assign(imagery, { lifecycle: 'planned', acquiredAt: null, capturedAt: capturedOn,
  localPath: null, checksum: null, checksumReason,
  notes: `Authenticated ${plan.collection} access verified ${acquiredOn}: ${plan.windows.length} RGBI windows at 0.16 m, all fully valid, cover all eighteen holes and facilities. The provider product/full-TIFF lifecycle remains planned because only bounded windows were acquired. Source imagery remains outside Git and the app; image interpretation and independent survey approval are separate.` });
for (const group of sourceGroups) for (const source of group.plan.sources) {
  const id = `imagery-lm-${source.id.replaceAll('_', '-')}`;
  const existing = manifest.sources.find(s => s.id === id);
  if (existing) assert(existing.sourceUri === source.href, `Source identity changed: ${id}`);
  const item = group.items.find(i => i.id === source.id);
  const value = { id, productId: 'lantmateriet-ortofoto', roles: ['imagery', 'surface'],
    lifecycle: 'planned', use: 'candidate', sourceUri: source.href, localPath: null,
    bboxWgs84: item.bboxWgs84, acquiredAt: null, capturedAt: source.capturedAt.slice(0, 10),
    checksum: null, checksumReason: `Only bounded native windows were acquired and individually hashed; see ${group.acquisitionFile}. Complete provider TIFFs were not downloaded or hashed.`, replacementSourceId: null, accuracyTier: 'B',
    horizontalAccuracyMetres: null, verticalAccuracyMetres: null,
    notes: `${source.id}: ${source.width} by ${source.height} native EPSG:3006 RGBI pixels, ${source.bytes} provider bytes. Authenticated HTTP 206 TIFF header and pinned size verified; only bounded course windows acquired. Pixel spacing is not measured positional accuracy. Attribution: Lantmäteriet, CC BY 4.0; delivery terms remain separate from independent geometry control.` };
  if (existing) Object.assign(existing, value); else manifest.sources.push(value);
  imageSourceIds.push(id);
}
const imageryLineage = ['imagery-lm-ortho', ...imageSourceIds];
const primaryLineage = ['imagery-lm-ortho', ...plan.sources.map(s => `imagery-lm-${s.id.replaceAll('_', '-')}`)];

// Preserve exact evidence bytes only after all inventory, access, grid and hash
// checks pass. Never regenerate or rewrite the plan used by this acquisition.
if (acquisitionPath !== files.acquisition) fs.copyFileSync(absolute(acquisitionPath), absolute(files.acquisition));
artifact('orthophoto-catalogue-verification', 'acquisition', files.discovery, primaryLineage,
  `Official STAC search observed ${discovery.observedAt.slice(0, 10)}: latest complete Puttom campaign ${plan.collection}, captured ${capturedOn}; four exact RGBI tile identities and native grids. Existing D2 discovery remains as baseline evidence.`);
artifact('authenticated-ortho-review-plan', 'acquisition', files.plan, primaryLineage,
  `The exact acquired plan bytes: ${plan.windows.length} native-grid windows, eighteen tee areas, eighteen greens and ${plan.summary.contextWindows} continuous whole-course context windows. Extents do not establish feature boundaries or survey accuracy.`);
artifact('authenticated-ortho-acquisition', 'acquisition', files.acquisition, primaryLineage,
  `${acquisition.windows.length}/${plan.windows.length} windows acquired with valid fraction 1, authenticated TIFF byte access, exact transforms and per-window SHA-256 hashes. Bound to plan SHA-256 ${acquisition.planSha256}. Source pixels are not committed or shipped.`);
if (teeIntake) {
  if (teeIntake.acquisitionPath !== files.teeAcquisition) fs.copyFileSync(absolute(teeIntake.acquisitionPath), absolute(files.teeAcquisition));
  const lineage = teeIntake.plan.sources.map(s => `imagery-lm-${s.id.replaceAll('_', '-')}`);
  const note = 'Morning 3 July and midday 24 June 2022 imagery corroborates tee platforms hidden by afternoon shadows in 2024. Each source retains its actual capture timestamp; continuity and numbered identity require explicit review.';
  artifact('tee-2022-catalogue', 'acquisition', files.teeDiscovery, lineage, note);
  artifact('tee-2022-native-plan', 'acquisition', files.teePlan, lineage, note);
  artifact('tee-2022-acquisition', 'acquisition', files.teeAcquisition, lineage,
    `${teeIntake.acquisition.windows.length} native windows, all fully valid, with verified TIFF bytes, grids and hashes. ${note}`);
}

const review = has(files.review) ? read(files.review) : null;
let reviewCounts = null;
if (review) {
  assert(review.schemaVersion === 1 && review.groundId === 'puttom' && Object.keys(review.sources || {}).length > 0,
    'Unexpected aggregate Puttom orthophoto review');
  for (const [key, source] of Object.entries(review.sources)) {
    const ids = source.sourceIds ?? source.sources?.map(s => s.id);
    assert(SHA256.test(source.sha256) && SHA256.test(source.requestSha256) && source.horizontalCrs === 'EPSG:3006' &&
      ids?.length && ids.every(id => sourceGroups.some(g => g.plan.sources.some(s => s.id === id))), `Unbound aggregate review image: ${key}`);
  }
  reviewCounts = { holes: review.holes?.length || 0,
    greens: (review.holes || []).filter(h => h.green).length,
    teePlatforms: (review.holes || []).reduce((n, h) => n + (h.tees?.length || 0), 0),
    cameraReferences: (review.holes || []).reduce((n, h) => n + (h.cameraReferences?.length || 0) +
      (h.tees || []).reduce((total, tee) => total + Object.keys(tee.cameraReferencesPixels || {}).length, 0), 0),
    fairways: (review.holes || []).reduce((n, h) => n + (h.fairways?.length || 0), 0),
    bunkers: (review.holes || []).reduce((n, h) => n + (Array.isArray(h.bunkers) ? h.bunkers.length : h.bunkers?.accepted?.length || 0), 0),
    water: review.water?.length || 0, paths: review.paths?.length || 0 };
  artifact('orthophoto-boundary-review-2024', 'control', files.review, [...imageryLineage, 'club-guide-legacy'],
    `Machine visual interpretation of native image pixels from the primary ${capturedOn} campaign and explicitly attributed older tee corroboration: ${reviewCounts.greens} greens, ${reviewCounts.teePlatforms} tee platforms, ${reviewCounts.cameraReferences} numbered virtual tee references, ${reviewCounts.fairways} fairway polygons, ${reviewCounts.bunkers} bunkers, ${reviewCounts.water} water polygons and ${reviewCounts.paths} paths. Per-feature pixel vertices, capture dates and source hashes are retained; ambiguous boundaries and independent registration remain unresolved. This is not human survey approval.`);
}

const model = read(files.model);
const legacyLineage = manifest.artifacts.find(a => a.id === 'legacy-course-model')?.derivedFrom ||
  ['terrarium-legacy', 'osm-legacy', 'esri-imagery-legacy', 'club-guide-legacy', 'golftraxx-legacy'];
const modelLineage = model.orthophotoReview ? [...legacyLineage, ...imageryLineage] : legacyLineage;
artifact('legacy-course-model', 'composite', files.model, modelLineage,
  model.orthophotoReview ? 'Compatibility model incorporating retained native orthophoto pixel traces in its unchanged legacy geographic frame. Unreviewed geometry and legacy height sources retain their existing lineage; no survey or canonical-origin approval is implied.' : 'Current composite vectors, routing, elevations and scenery inputs; orthophoto intake is recorded separately pending adoption.', 'migration-only');
const migrated = has(files.migrated) ? read(files.migrated) : null;
const migrationCurrent = migrated?.source?.sha256 === sha256File(absolute(files.model));
const migrationLineage = migrationCurrent ? modelLineage :
  manifest.artifacts.find(a => a.id === 'migration-course-model-epsg3006')?.derivedFrom || legacyLineage;
artifact('migration-course-model-epsg3006', 'composite', files.migrated, migrationLineage,
  migrationCurrent ? 'Deterministic conversion of the current compatibility model to absolute EPSG:3006 through the declared legacy frame. Coordinate preservation is a software check; scalar heights and canonical origin remain independently unapproved.' : 'Retained EPSG:3006 migration snapshot; its embedded source hash predates the current model and must be regenerated before current-model use. Independent controls and scalar height approval remain pending.', 'migration-only');
artifact('migration-residual-report', 'control', files.residuals, migrationLineage,
  migrationCurrent ? 'Current software coordinate migration residuals; fitted legacy-frame comparisons do not establish independent survey registration or approve the canonical origin.' : 'Retained migration residual report; regenerate together with the current model migration. This report is not independent control approval.', 'migration-only');

const accessBlocker = manifest.blockers.find(b => b.id === 'authoritative-assets');
if (accessBlocker) {
  accessBlocker.description = `Authenticated orthophoto access and ${plan.windows.length} fully valid native RGBI windows are now recorded. Remaining source acquisitions, interpretation gaps and independent geometry controls require their own evidence; this intake does not approve unrelated source or survey gates.`;
  accessBlocker.exitGate = 'Complete the remaining source-specific acquisitions and unresolved feature review, then verify independent controls before source promotion. Orthophoto byte access and bounded-window hashes are already recorded.';
}
if (review) {
  const legacyRights = manifest.blockers.find(b => b.id === 'legacy-imagery-rights');
  if (legacyRights) legacyRights.description = 'Reviewed features now retain Lantmäteriet orthophoto lineage and attribution. Unreviewed Esri, GolfTraxx and other legacy derivatives remain in the composite and retain their existing production-rights gate.';
}
artifact('orthophoto-alignment-audit', 'control', 'puttombuild/mapping/alignment-audit.json', modelLineage,
  'Source-pixel agreement, runtime-frame residuals, geometry topology and all 72 tee reference statuses. Software validation and machine interpretation, not survey approval.');
artifact('tee-coordinate-report', 'control', 'puttombuild/mapping/tee-coordinate-report.json', modelLineage,
  'All 72 tee references with native image, geographic and runtime coordinates, platform containment and decorative marker placement checks. Individual uncertainty and source dates are retained.');
artifact('tee-coordinate-inventory', 'control', 'puttombuild/mapping/tee-coordinates.csv', modelLineage,
  'Reviewable coordinate inventory for all 72 numbered virtual tee starts, including source dates and placement status; not a current survey of daily movable markers.');
artifact('orthophoto-open-water-candidate', 'surface', 'puttombuild/mapping/review-water.json', imageryLineage,
  'Unadopted spectral open-water candidate excluding reeds and occluded banks. The runtime hydrological outline and water levels retain their previous source; this candidate does not replace them.');
fs.writeFileSync(absolute(files.manifest), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ groundId: 'puttom', sources: manifest.sources.length, artifacts: manifest.artifacts.length,
  acquiredWindows: acquisition.windows.length, teeCorroborationWindows: teeIntake?.acquisition.windows.length ?? 0, reviewed: reviewCounts, migrationCurrent,
  openGates: manifest.blockers.length, canonicalOriginStatus: manifest.canonicalFrame.originStatus }));
