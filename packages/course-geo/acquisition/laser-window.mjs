import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runGeoCommand } from '../proj.mjs';
import { authorizationHeaders } from './credentials.mjs';

const DEFAULT_SPAN_METRES = 256;
const MAXIMUM_SPAN_METRES = 512;
const MAXIMUM_POINTS = 1_000_000;

function finiteBbox(value, label) {
  if (!Array.isArray(value) || value.length !== 4 || value.some(item => !Number.isFinite(item)) ||
      value[0] >= value[2] || value[1] >= value[3]) {
    throw new Error(`${label} must be a finite non-empty [minX,minY,maxX,maxY] bbox`);
  }
  return value;
}

function intersection(left, right) {
  const value = [
    Math.max(left[0], right[0]), Math.max(left[1], right[1]),
    Math.min(left[2], right[2]), Math.min(left[3], right[3]),
  ];
  return value[0] < value[2] && value[1] < value[3] ? value : null;
}

function safeGroundId(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '')) {
    throw new Error(`invalid ground id ${value}`);
  }
  return value;
}

function safeLaserAsset(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'dl1.lantmateriet.se' ||
      !url.pathname.startsWith('/hojd/data/pointcloud/sls/') ||
      !url.pathname.endsWith('.copc.laz') || url.search || url.hash ||
      url.username || url.password || /[\r\n]/.test(url.href)) {
    throw new Error('refusing non-Laserdata Skog COPC asset URL');
  }
  return url;
}

function boundedSquare(overlap, aoi, span) {
  if (overlap[2] - overlap[0] < span || overlap[3] - overlap[1] < span) return null;
  const centreX = (aoi[0] + aoi[2]) / 2;
  const centreY = (aoi[1] + aoi[3]) / 2;
  const minX = Math.round(Math.min(
    Math.max(centreX - span / 2, overlap[0]),
    overlap[2] - span,
  ));
  const minY = Math.round(Math.min(
    Math.max(centreY - span / 2, overlap[1]),
    overlap[3] - span,
  ));
  return [minX, minY, minX + span, minY + span];
}

export function laserWindowPlan(report, {
  spanMetres = DEFAULT_SPAN_METRES,
  maximumPoints = MAXIMUM_POINTS,
} = {}) {
  safeGroundId(report?.groundId);
  if (!Number.isSafeInteger(spanMetres) || spanMetres < 32 || spanMetres > MAXIMUM_SPAN_METRES) {
    throw new Error(`spanMetres must be an integer from 32 to ${MAXIMUM_SPAN_METRES}`);
  }
  if (!Number.isSafeInteger(maximumPoints) || maximumPoints < 1 || maximumPoints > MAXIMUM_POINTS) {
    throw new Error(`maximumPoints must be an integer from 1 to ${MAXIMUM_POINTS}`);
  }
  const aoi = finiteBbox(report.aoi?.bboxEpsg3006, 'laser AOI');
  if (report.laser?.collection !== 'dsm-skoglig-copc') {
    throw new Error('laser discovery must use dsm-skoglig-copc');
  }
  const candidates = (report.laser?.items || []).map(item => {
    const asset = item.assets?.data;
    if (!item.id || item.collection !== 'dsm-skoglig-copc' ||
        asset?.type !== 'application/vnd.laszip+copc' ||
        !Number.isSafeInteger(asset.bytes) || asset.bytes <= 589 ||
        !/^[a-f0-9]{64}$/.test(asset.sha256 || '')) {
      throw new Error(`laser item ${item.id || '<unknown>'} lacks a checksummed COPC asset`);
    }
    const projected = finiteBbox(item.projBbox || asset.projBbox, `laser item ${item.id} projBbox`);
    return {
      id: item.id,
      capturedAt: item.capturedAt || item.captureEnd || '',
      pointCount: Number.isSafeInteger(item.pointCount) ? item.pointCount : null,
      pointDensityPerSquareMetre: Number.isFinite(item.pointDensityPerSquareMetre)
        ? item.pointDensityPerSquareMetre
        : null,
      sourceBytes: asset.bytes,
      sourceSha256: asset.sha256,
      sourceUrl: safeLaserAsset(asset.href).href,
      projectedBbox: projected,
    };
  });

  const viable = [];
  const aoiCentreX = (aoi[0] + aoi[2]) / 2;
  const aoiCentreY = (aoi[1] + aoi[3]) / 2;
  for (const source of candidates) {
    const overlap = intersection(aoi, source.projectedBbox);
    const bounds = overlap && boundedSquare(overlap, aoi, spanMetres);
    if (!bounds) continue;
    const windowCentreX = (bounds[0] + bounds[2]) / 2;
    const windowCentreY = (bounds[1] + bounds[3]) / 2;
    viable.push({
      source,
      bounds,
      centreDistanceSquared: (windowCentreX - aoiCentreX) ** 2 +
        (windowCentreY - aoiCentreY) ** 2,
    });
  }
  viable.sort((left, right) => left.centreDistanceSquared - right.centreDistanceSquared ||
    right.source.capturedAt.localeCompare(left.source.capturedAt) ||
    left.source.id.localeCompare(right.source.id));
  const selected = viable[0];
  if (selected) return Object.freeze({
    schemaVersion: 1,
    groundId: report.groundId,
    collection: report.laser.collection,
    source: Object.freeze(selected.source),
    boundsEpsg3006: Object.freeze(selected.bounds),
    spanMetres,
    areaSquareMetres: spanMetres * spanMetres,
    maximumPoints,
    selection: 'nearest-aoi-centre-then-newest',
  });
  throw new Error(`no Laserdata Skog item contains a ${spanMetres} m bounded AOI window`);
}

export function laserDensityEvidence(plan, pointCount, { minimumAdvertisedRatio = 0.1 } = {}) {
  if (!Number.isSafeInteger(pointCount) || pointCount < 1) {
    throw new Error('bounded COPC density requires a positive point count');
  }
  if (!Number.isFinite(minimumAdvertisedRatio) || minimumAdvertisedRatio <= 0 ||
      minimumAdvertisedRatio > 1) {
    throw new Error('minimumAdvertisedRatio must be greater than zero and at most one');
  }
  const advertised = plan.source.pointDensityPerSquareMetre;
  if (!Number.isFinite(advertised) || advertised <= 0) {
    throw new Error('Laserdata Skog source lacks a positive advertised point density');
  }
  const observed = pointCount / plan.areaSquareMetres;
  const ratio = observed / advertised;
  if (ratio < minimumAdvertisedRatio) {
    throw new Error(
      `bounded COPC density ratio ${ratio.toFixed(4)} is below ${minimumAdvertisedRatio}`,
    );
  }
  return Object.freeze({
    observedPointDensityPerSquareMetre: observed,
    advertisedPointDensityPerSquareMetre: advertised,
    advertisedDensityRatio: ratio,
    minimumAdvertisedDensityRatio: minimumAdvertisedRatio,
  });
}

function findStatsMetadata(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value.statistic) && value.statistic.some(item => item?.name === 'Z')) return value;
  for (const child of Object.values(value)) {
    const match = findStatsMetadata(child);
    if (match) return match;
  }
  return null;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function enumeratedCounts(value, dimension) {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).map(([category, count]) => `${category}/${count}`)
      : [];
  return Object.freeze(entries.slice(0, 256).map(entry => {
    if (typeof entry === 'object' && entry !== null) {
      const category = Number(entry.value ?? entry.category);
      const count = Number(entry.count);
      if (Number.isFinite(category) && Number.isSafeInteger(count) && count >= 0) {
        return Object.freeze({ value: category, count });
      }
    }
    const match = String(entry).match(/^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\/(\d+)$/);
    const category = match ? Number(match[1]) : Number.NaN;
    const count = match ? Number(match[2]) : Number.NaN;
    if (!Number.isFinite(category) || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`PDAL returned an invalid ${dimension} count`);
    }
    return Object.freeze({ value: category, count });
  }));
}

export function laserStatisticsFromMetadata(metadata, maximumPoints) {
  const stats = findStatsMetadata(metadata);
  if (!stats) throw new Error('PDAL did not return filters.stats metadata');
  const byName = new Map(stats.statistic.map(item => [item.name, item]));
  const z = byName.get('Z');
  const pointCount = Number(z?.count);
  if (!Number.isSafeInteger(pointCount) || pointCount < 1 || pointCount >= maximumPoints) {
    throw new Error(`bounded COPC point count ${pointCount} is outside 1..${maximumPoints - 1}`);
  }
  const enumeration = dimension => {
    const item = byName.get(dimension);
    return enumeratedCounts(item?.counts, dimension);
  };
  const classificationCounts = enumeration('Classification');
  const returnNumberCounts = enumeration('ReturnNumber');
  const numberOfReturnsCounts = enumeration('NumberOfReturns');
  for (const [dimension, counts] of [
    ['Classification', classificationCounts],
    ['ReturnNumber', returnNumberCounts],
    ['NumberOfReturns', numberOfReturnsCounts],
  ]) {
    const countedPoints = counts.reduce((total, item) => total + item.count, 0);
    if (!counts.length || countedPoints !== pointCount) {
      throw new Error(`PDAL ${dimension} counts cover ${countedPoints} of ${pointCount} points`);
    }
  }
  return Object.freeze({
    pointCount,
    heightRH2000Metres: Object.freeze({
      minimum: finiteOrNull(z.minimum),
      maximum: finiteOrNull(z.maximum),
      mean: finiteOrNull(z.average),
      standardDeviation: finiteOrNull(z.stddev),
    }),
    classificationCounts,
    returnNumberCounts,
    numberOfReturnsCounts,
  });
}

function redact(value, secrets) {
  let result = String(value);
  for (const secret of secrets.filter(Boolean).sort((left, right) => right.length - left.length)) {
    result = result.replaceAll(secret, '<redacted>');
  }
  return result;
}

export function copcStatsPipeline(plan, credentials) {
  if (!credentials) throw new Error('Lantmäteriet credentials are required for Laserdata Skog');
  const header = authorizationHeaders(credentials);
  const [minX, minY, maxX, maxY] = plan.boundsEpsg3006;
  return Object.freeze([
    Object.freeze({
      type: 'readers.copc',
      filename: Object.freeze({
        path: plan.source.sourceUrl,
        headers: header,
      }),
      bounds: `([${minX},${maxX}],[${minY},${maxY}])`,
      requests: 4,
    }),
    Object.freeze({ type: 'filters.head', count: plan.maximumPoints }),
    Object.freeze({
      type: 'filters.stats',
      dimensions: 'Z,Classification,ReturnNumber,NumberOfReturns',
      count: 'Classification,ReturnNumber,NumberOfReturns',
    }),
    Object.freeze({ type: 'writers.null' }),
  ]);
}

/** Stream one bounded COPC window and retain aggregate metadata only. */
export function acquireLaserWindow(report, {
  credentials,
  spanMetres = DEFAULT_SPAN_METRES,
  maximumPoints = MAXIMUM_POINTS,
} = {}) {
  const plan = laserWindowPlan(report, { spanMetres, maximumPoints });
  const pipeline = copcStatsPipeline(plan, credentials);
  const authorization = Object.values(pipeline[0].filename.headers);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-copc-stats-'));
  const metadataFile = path.join(temporaryDirectory, 'metadata.json');
  const started = performance.now();
  let metadata;
  try {
    try {
      runGeoCommand('pdal', ['pipeline', '--stdin', '--stream', '--metadata', metadataFile], {
        input: JSON.stringify(pipeline),
      });
    } catch (error) {
      throw new Error(`PDAL bounded COPC stream failed: ${redact(error.message, authorization)}`);
    }
    metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  const statistics = laserStatisticsFromMetadata(metadata, plan.maximumPoints);
  const density = laserDensityEvidence(plan, statistics.pointCount);
  return Object.freeze({
    schemaVersion: 1,
    phase: 'D2-authenticated-laser-window',
    groundId: plan.groundId,
    collection: plan.collection,
    source: Object.freeze({
      itemId: plan.source.id,
      capturedAt: plan.source.capturedAt,
      sourceBytes: plan.source.sourceBytes,
      sourceSha256: plan.source.sourceSha256,
      advertisedPointCount: plan.source.pointCount,
      advertisedPointDensityPerSquareMetre: plan.source.pointDensityPerSquareMetre,
    }),
    boundsEpsg3006: plan.boundsEpsg3006,
    spanMetres: plan.spanMetres,
    areaSquareMetres: plan.areaSquareMetres,
    ...statistics,
    ...density,
    elapsedMilliseconds: Math.round(performance.now() - started),
    retainedPointCloudBytes: 0,
    note: 'COPC was range-streamed; only aggregate statistics are retained.',
  });
}
