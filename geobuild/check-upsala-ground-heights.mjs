#!/usr/bin/env node
/* Read-only comparison of public municipal ground-height observations with the
 * exact published 1 m terrain chunks. No fitting, terrain edits or source-row
 * attribution fields. Reports retain every exclusion and residual outlier.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyChunkAsset } from '../packages/course-v2/chunk-node.mjs';
import { sampleTerrainTile } from '../packages/course-v2/terrain-pyramid.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const round = n => Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function inside(directory, url) {
  assert(typeof url === 'string' && !path.isAbsolute(url) && !url.includes('\\'), 'expected relative asset URL');
  const filename = path.resolve(directory, url);
  assert(filename.startsWith(path.resolve(directory) + path.sep), 'asset escaped its directory');
  return filename;
}

function verifiedReference(publicDir, reference) {
  const bytes = fs.readFileSync(inside(publicDir, reference.url));
  assert(bytes.length === reference.bytes && sha(bytes) === reference.sha256, `published reference changed: ${reference.url}`);
  return bytes;
}

/** Finest-level terrain only: an incomplete four-corner stencil is excluded. */
export function publishedOneMetreSampler(publicDir, slug = 'upsala') {
  const rootBytes = fs.readFileSync(path.join(publicDir, 'courses/v2-index.json'));
  const entry = JSON.parse(rootBytes).courses.find(c => c.slug === slug);
  assert(entry, `missing published course ${slug}`);
  const course = JSON.parse(verifiedReference(publicDir, entry.manifest));
  const ground = JSON.parse(verifiedReference(publicDir, course.groundManifest));
  assert(ground.groundId === 'upsala' && entry.groundId === ground.groundId, 'wrong published ground');
  assert(ground.frame.horizontalCrs === 'EPSG:3006' && ground.frame.verticalCrs === 'EPSG:5613', 'terrain must use EPSG:3006 / RH2000');
  const tiles = ground.tiles.filter(t => t.lod === 0).sort((a, b) => a.id.localeCompare(b.id));
  const decoded = new Map(), used = new Map();
  return {
    provenance: { rootIndexSha256: sha(rootBytes), courseManifest: entry.manifest,
      groundManifest: course.groundManifest, groundSourceManifestSha256: ground.sourceManifestSha256,
      frame: ground.frame, lod: 0, requiredSampleSpacingM: 1,
      finestCoverageBoundsEPSG3006: [Math.min(...tiles.map(t => t.bounds.minEasting)), Math.min(...tiles.map(t => t.bounds.minNorthing)),
        Math.max(...tiles.map(t => t.bounds.maxEasting)), Math.max(...tiles.map(t => t.bounds.maxNorthing))] },
    usedTiles: () => [...used.values()].sort((a, b) => a.id.localeCompare(b.id)),
    sample(easting, northing) {
      const candidates = tiles.filter(t => easting >= t.bounds.minEasting && easting <= t.bounds.maxEasting &&
        northing >= t.bounds.minNorthing && northing <= t.bounds.maxNorthing);
      if (!candidates.length) return { exclusion: 'outside-published-one-metre-coverage' };
      for (const tile of candidates) {
        const ref = tile.layers.terrain;
        if (!decoded.has(tile.id)) {
          const chunk = verifyChunkAsset(ref, verifiedReference(publicDir, ref));
          assert(chunk.header.id === tile.id && chunk.header.kind === 'terrain', 'terrain chunk/tile identity mismatch');
          assert(chunk.header.owner?.id === ground.groundId, 'terrain chunk belongs to another ground');
          for (const key of ['minEasting', 'minNorthing', 'maxEasting', 'maxNorthing']) {
            assert(chunk.header.bounds[key] === tile.bounds[key], 'terrain chunk/tile horizontal bounds mismatch');
          }
          assert(chunk.header.grid.sampleSpacingMetres === 1, 'finest tile is not a 1 m source');
          decoded.set(tile.id, { bounds: tile.bounds, grid: chunk.header.grid, payload: chunk.payload });
        }
        const sample = decoded.get(tile.id);
        const height = sampleTerrainTile(sample, easting, northing);
        used.set(tile.id, { id: tile.id, bounds: tile.bounds, grid: sample.grid, terrain: ref });
        if (Number.isFinite(height)) return { heightRH2000: height, tileId: tile.id };
      }
      return { exclusion: 'incomplete-finite-one-metre-interpolation' };
    },
  };
}

function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * fraction;
  const i = Math.floor(index), f = index - i;
  return sorted[i] * (1 - f) + sorted[Math.min(sorted.length - 1, i + 1)] * f;
}

export function residualMetrics(rows) {
  const values = rows.map(r => r.residualM).filter(Number.isFinite);
  if (!values.length) return { count: 0 };
  const median = quantile(values, .5), absolute = values.map(Math.abs);
  return { count: values.length,
    meanM: round(values.reduce((a, b) => a + b, 0) / values.length), medianM: round(median),
    rmseM: round(Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length)),
    medianAbsoluteResidualM: round(quantile(absolute, .5)),
    medianAbsoluteDeviationFromMedianM: round(quantile(values.map(v => Math.abs(v - median)), .5)),
    p95AbsoluteResidualM: round(quantile(absolute, .95)), maximumAbsoluteResidualM: round(Math.max(...absolute)),
    minimumResidualM: round(Math.min(...values)), maximumResidualM: round(Math.max(...values)),
    withinAbsoluteThresholdM: Object.fromEntries([.1, .25, .5, 1].map(t => [t, absolute.filter(v => v <= t).length])),
  };
}

/** Sanitise source observations before reporting. Registration is not capture. */
export function compareMunicipalGroundHeights(query, metadata, sampler) {
  assert(!query.error && !query.exceededTransferLimit && Array.isArray(query.features), 'query failed or was truncated');
  assert(query.geometryType === 'esriGeometryPoint' && query.spatialReference?.wkid === 3006,
    'municipal query must return EPSG:3006 points');
  const domainValue = (field, code) => metadata.fields.find(f => f.name === field)?.domain?.codedValues?.find(v => v.code === code)?.name;
  const domains = Object.fromEntries([['STATUS', 3], ['FITTED', 2], ['ORIGINPLAN', 109], ['ORIGINHEIGHT', 109],
    ['SRSORIGINHEIGHT', 103], ['SRSORIGINPLAN', 457]].map(([field, code]) => [field, { code, name: domainValue(field, code) }]));
  assert(domains.STATUS.name === 'Befintligt' && domains.FITTED.name === 'Nej' &&
    domains.ORIGINPLAN.name === 'Geod. Nätverks-RTK' && domains.ORIGINHEIGHT.name === 'Geod. Nätverks-RTK' &&
    domains.SRSORIGINHEIGHT.name === 'RH2000' && domains.SRSORIGINPLAN.name === 'SWEREF 99 18 00',
  'municipal code meanings changed; re-review eligibility');
  const ids = new Set();
  const rows = query.features.map(feature => {
    const a = feature.attributes || {}, p = feature.geometry || {};
    assert(Number.isSafeInteger(a.OBJECTID) && !ids.has(a.OBJECTID), 'invalid or duplicate municipal object identifier');
    ids.add(a.OBJECTID);
    const reasons = [];
    if (a.STATUS !== 3) reasons.push('not-existing-status');
    if (a.FITTED !== 2) reasons.push('fitted-or-unknown-fit-status');
    if (a.ORIGINPLAN !== 109 || a.ORIGINHEIGHT !== 109) reasons.push('not-network-rtk-in-plan-and-height');
    if (a.SRSORIGINHEIGHT !== 103) reasons.push('height-datum-not-confirmed-rh2000');
    if (a.SRSORIGINPLAN !== 457) reasons.push('original-plan-crs-not-confirmed-sweref99-18-00');
    if (![p.x, p.y, a.Z_VALUE].every(Number.isFinite)) reasons.push('non-finite-coordinate-or-height');
    if (![a.ACCURACYPLAN, a.ACCURACYHEIGHT].every(v => Number.isFinite(v) && v > 0)) reasons.push('unknown-source-accuracy');
    const registrationDate = Number.isFinite(a.REGDATE) && Number.isFinite(new Date(a.REGDATE).valueOf())
      ? new Date(a.REGDATE).toISOString().slice(0, 10) : null;
    const eligibleForSampling = reasons.length === 0;
    const sample = eligibleForSampling ? sampler.sample(p.x, p.y) : null;
    if (sample?.exclusion) reasons.push(sample.exclusion);
    const included = reasons.length === 0;
    assert(!included || Number.isFinite(sample?.heightRH2000), 'sampler returned a non-finite included height');
    return { objectId: a.OBJECTID, easting: round(p.x), northing: round(p.y), municipalHeightRH2000: round(a.Z_VALUE),
      sourceStatusCode: a.STATUS, fittedCode: a.FITTED, planMethodCode: a.ORIGINPLAN, heightMethodCode: a.ORIGINHEIGHT,
      originalPlanCrsCode: a.SRSORIGINPLAN, originalHeightCrsCode: a.SRSORIGINHEIGHT,
      advertisedPlanAccuracyM: round(a.ACCURACYPLAN), advertisedHeightAccuracyM: round(a.ACCURACYHEIGHT),
      registrationDate, registrationYear: registrationDate?.slice(0, 4) || 'unknown',
      measurementDate: null, eligibleForSampling, included, exclusions: reasons,
      ...(included ? { publishedHeightRH2000: round(sample.heightRH2000), residualM: round(sample.heightRH2000 - a.Z_VALUE), tileId: sample.tileId } : {}),
    };
  }).sort((a, b) => a.objectId - b.objectId);
  const included = rows.filter(r => r.included), years = [...new Set(rows.map(r => r.registrationYear))].sort();
  const bins = new Map();
  for (const row of included) {
    const easting = Math.floor(row.easting / 250) * 250, northing = Math.floor(row.northing / 250) * 250;
    const key = `${easting},${northing}`;
    if (!bins.has(key)) bins.set(key, { boundsEPSG3006: [easting, northing, easting + 250, northing + 250], rows: [] });
    bins.get(key).rows.push(row);
  }
  return { schemaVersion: 1, automaticTerrainCorrection: false, completeSurvey: false,
    residualDefinition: 'published 1 m DTM height minus municipal ground height, metres RH2000; positive means DTM is higher',
    horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613', sourceGeometryCrs: metadata.sourceSpatialReference,
    dateMeaning: 'REGDATE is database creation/registration date. No observation capture date is exposed. It is not a terrain-change timestamp.',
    acceptedSourceDomains: domains,
    eligibility: ['Existing status (3)', 'Not fitted (2)', 'Network RTK (109) in both plan and height',
      'Original height datum RH2000 (103)', 'Original plan CRS SWEREF99 18 00 (457); API transforms geometry to EPSG:3006',
      'Finite position and height, positive recorded source accuracy', 'Published 1 m coverage with complete finite bilinear interpolation'],
    counts: { source: rows.length, eligibleForSampling: rows.filter(r => r.eligibleForSampling).length,
      included: included.length, excluded: rows.length - included.length },
    exclusionCounts: rows.flatMap(r => r.exclusions).reduce((result, reason) => ({ ...result, [reason]: (result[reason] || 0) + 1 }), {}),
    metrics: residualMetrics(included),
    byRegistrationYear: Object.fromEntries(years.map(year => [year, {
      sourceCount: rows.filter(r => r.registrationYear === year).length,
      excludedCount: rows.filter(r => r.registrationYear === year && !r.included).length,
      ...residualMetrics(included.filter(r => r.registrationYear === year)),
    }])),
    spatialGroups250m: [...bins.values()].map(bin => ({ boundsEPSG3006: bin.boundsEPSG3006, ...residualMetrics(bin.rows) }))
      .sort((a, b) => b.maximumAbsoluteResidualM - a.maximumAbsoluteResidualM),
    outlierThresholdAbsoluteM: .5,
    outliers: included.filter(r => Math.abs(r.residualM) > .5).sort((a, b) => Math.abs(b.residualM) - Math.abs(a.residualM))
      .map(r => ({ objectId: r.objectId, easting: r.easting, northing: r.northing, registrationYear: r.registrationYear,
        residualM: r.residualM, tileId: r.tileId })),
    rows,
    limitations: [
      'No offset, tilt, fit or terrain replacement was estimated or applied. No row is excluded because of a large residual.',
      'Point coverage is spatially clustered and is not an independent survey of every playing surface.',
      'Registration dates are not measurement dates; source epochs may differ from the recorded DTM acquisition.',
      'Residuals combine source uncertainty, 1 m interpolation, ground change and possible point/surface mismatch.',
      'Recorded plan/height accuracy values are provider attributes, not independently verified point accuracy.',
      'The public layer and survey method provide independent-source evidence, but production-control approval still needs a qualified review of point suitability and epochs.',
      'Editor names, usernames, comments and unrelated municipal fields are intentionally absent from this sanitised report.',
    ],
  };
}

export function runGroundHeightComparison({ sourceDir, publicDir = path.join(root, 'apps/golf/public') }) {
  const downloadsPath = path.join(sourceDir, 'municipal-downloads.json');
  const downloadsBytes = fs.readFileSync(downloadsPath), downloads = JSON.parse(downloadsBytes);
  const inputs = {};
  for (const kind of ['meta', 'query']) {
    const record = downloads.find(r => r.id === 'groundheights' && r.type === kind);
    assert(record, `missing ground-height ${kind} acquisition reference`);
    const bytes = fs.readFileSync(path.join(sourceDir, `groundheights-${kind}.json`));
    assert(bytes.length === record.bytes && sha(bytes) === record.sha256, `municipal ${kind} bytes changed; reacquire and re-review`);
    inputs[kind] = { record, value: JSON.parse(bytes) };
  }
  const sampler = publishedOneMetreSampler(publicDir);
  const report = compareMunicipalGroundHeights(inputs.query.value, inputs.meta.value, sampler);
  const terrainSourcePath = 'geo_data/course-v2/upsala/source-manifest.json';
  const terrainSourceBytes = fs.readFileSync(path.join(root, terrainSourcePath));
  const terrainSources = JSON.parse(terrainSourceBytes).sources.filter(s => s.productId === 'lantmateriet-markhojdmodell-1m');
  return { ...report, sourceAcquisition: { downloadsSha256: sha(downloadsBytes),
    metadata: inputs.meta.record, query: inputs.query.record },
    terrainAcquisitionContext: { sourceManifestPath: terrainSourcePath, sourceManifestFileSha256: sha(terrainSourceBytes),
      meaning: 'Current repository acquisition records provide date/product context. The exact evaluated terrain is independently identified by the immutable published manifest and chunk hashes below.',
      sources: terrainSources.map(s => ({ id: s.id, productId: s.productId, sourceUri: s.sourceUri, capturedAt: s.capturedAt,
        acquiredAt: s.acquiredAt, checksum: s.checksum, advertisedHorizontalAccuracyM: s.horizontalAccuracyMetres,
        advertisedVerticalAccuracyM: s.verticalAccuracyMetres })) },
    publishedTerrain: { ...sampler.provenance, sampledTiles: sampler.usedTiles() } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--source-dir', '--public', '--out'].includes(args[i]) && args[i + 1], 'usage: --source-dir DIR --out FILE [--public DIR]');
    options[args[i]] = path.resolve(args[i + 1]);
  }
  assert(options['--source-dir'] && options['--out'], '--source-dir and --out are required');
  const report = runGroundHeightComparison({ sourceDir: options['--source-dir'], publicDir: options['--public'] });
  fs.mkdirSync(path.dirname(options['--out']), { recursive: true });
  fs.writeFileSync(options['--out'], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ counts: report.counts, metrics: report.metrics, byRegistrationYear: report.byRegistrationYear,
    outliers: report.outliers.length, terrainTiles: report.publishedTerrain.sampledTiles.length }, null, 2));
}
