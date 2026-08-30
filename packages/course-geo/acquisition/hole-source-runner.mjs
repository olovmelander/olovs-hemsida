import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { EXPECTED_GROUNDS } from '../manifest.mjs';
import { sweref99TmToLatLon } from '../proj.mjs';
import {
  STAC_ENDPOINTS,
  selectNewestCoverage,
  stacSearch,
  summarizeFeature,
} from './stac.mjs';
import {
  sourceControlDisposition,
  treeHeightQualityAssessment,
} from './hole-source-controls.mjs';
import { loadGroundHoleSourceControlPlan } from './hole-source-inventory.mjs';
import { acquireLaserWindow } from './laser-window.mjs';
import { acquireTreeHeightControlWindow } from './tree-height.mjs';

export const HOLE_SOURCE_EVIDENCE_VERSION = 1;
export const CONTROL_PROVIDERS = Object.freeze(['laser', 'tree-height']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function round(value, decimals = 6) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function controlKey(groundId, windowId) {
  return sha256(`${groundId}\0${windowId}`).slice(0, 24);
}

function validProviders(providers) {
  if (!Array.isArray(providers) || !providers.length ||
      providers.some(provider => !CONTROL_PROVIDERS.includes(provider)) ||
      new Set(providers).size !== providers.length) {
    throw new Error(`providers must be unique values from ${CONTROL_PROVIDERS.join(', ')}`);
  }
  return providers;
}

export function groundControlBbox(groundPlan) {
  if (!Array.isArray(groundPlan?.windows) || !groundPlan.windows.length) {
    throw new Error('ground plan has no control windows');
  }
  return groundPlan.windows.reduce((bbox, window) => [
    Math.min(bbox[0], window.bboxEpsg3006[0]),
    Math.min(bbox[1], window.bboxEpsg3006[1]),
    Math.max(bbox[2], window.bboxEpsg3006[2]),
    Math.max(bbox[3], window.bboxEpsg3006[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
}

function projectedBboxEdgePoints(bbox, segments = 8) {
  const [minX, minY, maxX, maxY] = bbox;
  const points = [];
  for (let index = 0; index <= segments; index++) {
    const t = index / segments;
    const easting = minX + (maxX - minX) * t;
    const northing = minY + (maxY - minY) * t;
    points.push({ easting, northing: minY }, { easting, northing: maxY });
    if (index > 0 && index < segments) {
      points.push({ easting: minX, northing }, { easting: maxX, northing });
    }
  }
  return points;
}

export async function discoverGroundLaserControl(groundPlan, {
  fetchImpl = globalThis.fetch,
  toLatLon = sweref99TmToLatLon,
} = {}) {
  const bboxEpsg3006 = groundControlBbox(groundPlan);
  const geographic = toLatLon(projectedBboxEdgePoints(bboxEpsg3006));
  const bboxWgs84 = geographic.reduce((bbox, point) => [
    Math.min(bbox[0], point.longitude),
    Math.min(bbox[1], point.latitude),
    Math.max(bbox[2], point.longitude),
    Math.max(bbox[3], point.latitude),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
  const features = await stacSearch(STAC_ENDPOINTS.height, {
    bbox: bboxWgs84,
    collections: ['dsm-skoglig-copc'],
    fetchImpl,
  });
  const selected = selectNewestCoverage(features, bboxEpsg3006);
  return Object.freeze({
    schemaVersion: 1,
    phase: 'D2-live-laser-control-discovery',
    groundId: groundPlan.groundId,
    aoi: Object.freeze({ bboxWgs84, bboxEpsg3006 }),
    laser: Object.freeze({
      collection: 'dsm-skoglig-copc',
      coverage: Object.freeze(selected.coverage),
      items: Object.freeze(selected.features.map(feature => summarizeFeature(feature, ['data']))),
    }),
  });
}

function errorCode(error, provider) {
  const message = String(error?.message || error);
  if (/HTTP (401|403)|denied|credential/i.test(message)) return `${provider}-access-denied`;
  if (/timeout|aborted/i.test(message)) return `${provider}-timeout`;
  if (provider === 'laser' && /no Laserdata Skog item contains/i.test(message)) {
    return 'laser-single-source-coverage-gap';
  }
  if (provider === 'laser' && /PDAL|COPC/i.test(message)) return 'laser-stream-failed';
  if (provider === 'tree-height' && /gdalinfo|JSON|raster/i.test(message)) {
    return 'tree-height-inspection-failed';
  }
  return `${provider}-provider-error`;
}

function safeLaserEvidence(value) {
  if (!value) return Object.freeze({ state: 'not-requested', usable: false });
  if (value.errorCode) return Object.freeze({
    state: value.state,
    usable: false,
    technicalError: value.technicalError,
    errorCode: value.errorCode,
  });
  return Object.freeze({
    state: value.usable ? 'usable' : (value.state || 'local-density-gap'),
    usable: value.usable === true,
    sourceItemId: value.source?.itemId || null,
    capturedAt: value.source?.capturedAt || null,
    sourceSha256: value.source?.sourceSha256 || null,
    pointCount: value.pointCount ?? null,
    observedPointDensityPerSquareMetre: round(value.observedPointDensityPerSquareMetre),
    advertisedPointDensityPerSquareMetre: round(value.advertisedPointDensityPerSquareMetre),
    advertisedDensityRatio: round(value.advertisedDensityRatio),
    heightRH2000Metres: value.heightRH2000Metres || null,
    classificationCounts: value.classificationCounts || [],
    returnNumberCounts: value.returnNumberCounts || [],
    numberOfReturnsCounts: value.numberOfReturnsCounts || [],
    elapsedMilliseconds: value.elapsedMilliseconds ?? null,
    retainedPointCloudBytes: 0,
  });
}

function safeTreeHeightEvidence(value) {
  if (!value) return Object.freeze({ state: 'not-requested', usable: false });
  if (value.errorCode) return Object.freeze({
    state: 'provider-error',
    usable: false,
    technicalError: true,
    errorCode: value.errorCode,
  });
  const raster = value.acquisition.raster;
  const quality = value.assessment;
  return Object.freeze({
    state: quality.usable ? 'usable' : 'quality-gate-failed',
    usable: quality.usable,
    reasons: quality.reasons,
    minimumMetres: quality.minimumMetres,
    maximumMetres: quality.maximumMetres,
    meanMetres: Number.isFinite(raster.meanDecimetres) ? round(raster.meanDecimetres / 10, 3) : null,
    standardDeviationMetres: Number.isFinite(raster.standardDeviationDecimetres)
      ? round(raster.standardDeviationDecimetres / 10, 3)
      : null,
    compressedBytes: raster.compressedBytes,
    sha256: raster.sha256,
    elapsedMilliseconds: value.acquisition.elapsedMilliseconds,
    retainedRasterBytes: 0,
  });
}

function inventoryFingerprint(groundPlan) {
  return sha256(JSON.stringify({
    groundId: groundPlan.groundId,
    courses: groundPlan.courses.map(course => ({
      courseSlug: course.courseSlug,
      modelSha256: course.model.sha256,
      holeCount: course.holeCount,
    })),
    holeCount: groundPlan.summary.holeCount,
    uniqueWindowCount: groundPlan.summary.uniqueWindowCount,
    requestedWindowReferences: groundPlan.summary.requestedWindowReferences,
  }));
}

export async function executeGroundHoleSourceControls(groundPlan, {
  providers = CONTROL_PROVIDERS,
  batchIndex = 0,
  batchCount = 1,
  checkLaser = null,
  checkTreeHeight = null,
  onProgress = null,
  executedAt = new Date().toISOString(),
} = {}) {
  validProviders(providers);
  if (!Number.isSafeInteger(batchCount) || batchCount < 1 || batchCount > 64 ||
      !Number.isSafeInteger(batchIndex) || batchIndex < 0 || batchIndex >= batchCount) {
    throw new Error('batch index/count must identify one of 1..64 deterministic shards');
  }
  if (providers.includes('laser') && typeof checkLaser !== 'function') {
    throw new Error('laser provider requires checkLaser');
  }
  if (providers.includes('tree-height') && typeof checkTreeHeight !== 'function') {
    throw new Error('tree-height provider requires checkTreeHeight');
  }
  const windows = groundPlan.windows.filter((window, index) => index % batchCount === batchIndex);
  if (!windows.length) throw new Error('selected shard contains no control windows');
  const evidence = [];
  let technicalErrorCount = 0;
  for (const [index, window] of windows.entries()) {
    let laser = null;
    let treeHeight = null;
    if (providers.includes('laser')) {
      try {
        laser = await checkLaser(window);
      } catch (error) {
        const code = errorCode(error, 'laser');
        const coverageGap = code === 'laser-single-source-coverage-gap';
        laser = {
          state: coverageGap ? 'single-source-coverage-gap' : 'provider-error',
          usable: false,
          technicalError: !coverageGap,
          errorCode: code,
        };
        if (!coverageGap) technicalErrorCount++;
      }
    }
    if (providers.includes('tree-height')) {
      try {
        treeHeight = await checkTreeHeight(window);
      } catch (error) {
        treeHeight = { errorCode: errorCode(error, 'tree-height') };
        technicalErrorCount++;
      }
    }
    const disposition = sourceControlDisposition({
      laserAssessments: laser ? [laser] : [],
      treeHeightAssessment: treeHeight?.assessment || null,
    });
    const result = Object.freeze({
      controlKey: controlKey(groundPlan.groundId, window.id),
      consumers: window.consumers,
      laser: safeLaserEvidence(laser),
      treeHeight: safeTreeHeightEvidence(treeHeight),
      disposition,
    });
    evidence.push(result);
    if (onProgress) onProgress({ completed: index + 1, total: windows.length, result });
  }
  const automaticEligibleCount = evidence.filter(item =>
    item.disposition.eligibleForAutomaticObjectCandidates).length;
  return Object.freeze({
    schemaVersion: HOLE_SOURCE_EVIDENCE_VERSION,
    phase: 'D2-authenticated-per-hole-source-control-evidence',
    state: 'quality-evidence-only-production-disabled',
    groundId: groundPlan.groundId,
    executedAt,
    providers: Object.freeze([...providers]),
    inventory: Object.freeze({
      fingerprintSha256: inventoryFingerprint(groundPlan),
      courseCount: groundPlan.summary.courseCount,
      holeCount: groundPlan.summary.holeCount,
      plannedUniqueWindowCount: groundPlan.summary.uniqueWindowCount,
      requestedWindowReferences: groundPlan.summary.requestedWindowReferences,
    }),
    shard: Object.freeze({ index: batchIndex, count: batchCount, selectedWindowCount: windows.length }),
    windows: Object.freeze(evidence),
    summary: Object.freeze({
      checkedWindowCount: evidence.length,
      laserUsableCount: evidence.filter(item => item.laser.usable).length,
      treeHeightUsableCount: evidence.filter(item => item.treeHeight.usable).length,
      automaticEligibleCount,
      fallbackOrReviewCount: evidence.length - automaticEligibleCount,
      technicalErrorCount,
      productionEnabled: false,
    }),
    gate: Object.freeze({
      controlsExecuted: technicalErrorCount === 0,
      allSelectedWindowsAutomaticallyEligible: technicalErrorCount === 0 &&
        automaticEligibleCount === evidence.length,
      runtimeReady: false,
      note: 'Controls produce candidate evidence only. Independent alignment and compiler gates remain mandatory.',
    }),
  });
}

export async function runAuthenticatedGroundHoleSourceControls(groundId, {
  providers = CONTROL_PROVIDERS,
  batchIndex = 0,
  batchCount = 1,
  lantmaterietCredentials = null,
  skogsstyrelsenCredentials = null,
  workRoot,
  fetchImpl = globalThis.fetch,
  onProgress = null,
} = {}) {
  if (!EXPECTED_GROUNDS[groundId]) throw new Error(`unknown physical ground ${groundId}`);
  validProviders(providers);
  if (providers.includes('laser') && !lantmaterietCredentials) {
    throw new Error('Lantmäteriet credentials are required for per-hole Laserdata controls');
  }
  if (providers.includes('tree-height') && !skogsstyrelsenCredentials) {
    throw new Error('Skogsstyrelsen credentials are required for per-hole tree-height controls');
  }
  if (!workRoot) throw new Error('per-hole controls require an ephemeral work root');

  const initialPlan = loadGroundHoleSourceControlPlan(groundId, { discovery: null });
  const discovery = providers.includes('laser')
    ? await discoverGroundLaserControl(initialPlan, { fetchImpl })
    : null;
  const groundPlan = loadGroundHoleSourceControlPlan(groundId, { discovery });
  fs.mkdirSync(workRoot, { recursive: true });
  return executeGroundHoleSourceControls(groundPlan, {
    providers,
    batchIndex,
    batchCount,
    onProgress,
    checkLaser: providers.includes('laser') ? async window => {
      if (window.laser.catalogCoverageRatio < 1 - 1e-9) return {
        state: 'catalog-coverage-gap', usable: false, technicalError: false,
      };
      const [minX, minY, maxX, maxY] = window.bboxEpsg3006;
      return acquireLaserWindow({
        groundId,
        aoi: { bboxEpsg3006: window.bboxEpsg3006 },
        laser: discovery.laser,
      }, {
        credentials: lantmaterietCredentials,
        spanMetres: window.spanMetres,
        focusEpsg3006: [(minX + maxX) / 2, (minY + maxY) / 2],
        allowSparse: true,
      });
    } : null,
    checkTreeHeight: providers.includes('tree-height') ? async window => {
      const directory = path.join(workRoot, controlKey(groundId, window.id));
      try {
        const acquisition = await acquireTreeHeightControlWindow(window, {
          credentials: skogsstyrelsenCredentials,
          workDirectory: directory,
          fetchImpl,
        });
        return {
          acquisition,
          assessment: treeHeightQualityAssessment(window, acquisition.raster),
        };
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    } : null,
  });
}
