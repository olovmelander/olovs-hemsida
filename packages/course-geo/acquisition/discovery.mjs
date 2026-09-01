import { performance } from 'node:perf_hooks';
import {
  STAC_ENDPOINTS,
  coverageSummary,
  selectLatestCampaign,
  selectNewestCoverage,
  sha256Bytes,
  sha256FromStacChecksum,
  stacSearch,
  summarizeFeature,
} from './stac.mjs';

export const D2_DISCOVERY_SCHEMA_VERSION = 1;
export const TREE_HEIGHT_CONTRACT = Object.freeze({
  service: 'https://geodata.skogsstyrelsen.se/arcgis/rest/services/Publikt/Tradhojd_3_2/ImageServer',
  metadataService: 'https://geodpags.skogsstyrelsen.se/arcgis/rest/services/Geodataportal/GeodataportalVisaSkogligaGrunddataMetadata/MapServer',
  horizontalCrs: 'EPSG:3006',
  verticalMeasure: 'height-above-ground',
  resolutionMetres: 1,
  dataType: 'signed-int16',
  unit: 'decimetre',
  nodataMeaning: '0 means no Laserdata skog return',
});

export const SOURCE_CONTRACTS = Object.freeze({
  terrain: {
    provider: 'Lantmäteriet',
    product: 'Markhöjdmodell Nedladdning',
    discovery: STAC_ENDPOINTS.height,
    collection: 'dtm-cog',
    dataAccess: 'authenticated Basic or OAuth2 access after a free product order',
    horizontalCrs: 'EPSG:3006',
    verticalCrs: 'EPSG:5613 (RH 2000)',
    compoundCrs: 'EPSG:5845',
    licence: 'CC-BY-4.0',
    terms: 'https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor_for_vardefulla_datamangder.pdf',
    termsVersion: 'LM2025/009266 version 1.0, 2025-02-01',
  },
  laser: {
    provider: 'Lantmäteriet',
    product: 'Laserdata Nedladdning, skog',
    discovery: STAC_ENDPOINTS.height,
    collection: 'dsm-skoglig-copc',
    dataAccess: 'authenticated Basic or OAuth2 access after a free product order',
    horizontalCrs: 'EPSG:3006',
    verticalCrs: 'EPSG:5613 (RH 2000)',
    compoundCrs: 'EPSG:5845',
    licence: 'CC-BY-4.0',
    terms: 'https://www.lantmateriet.se/globalassets/geodata/geodataprodukter/anvandningsvillkor-for-laserdata-nedladdning-skog.pdf',
    termsVersion: 'LM2026/077164 version 1.0, 2026-05-20',
  },
  orthophoto: {
    provider: 'Lantmäteriet',
    product: 'Ortofoto Nedladdning',
    discovery: STAC_ENDPOINTS.imagery,
    collection: 'selected dynamically from the newest complete campaign',
    /* Verified against Lantmäteriet's own product page rather than inferred
       from the 403. It states, verbatim: "Produkten är avgiftsfri" and "Din
       användning kommer att prövas juridiskt i enlighet med
       dataskyddsförordningen och du behöver godkänna särskilda
       användningsvillkor."
       So the review is of the USE, under data protection law, and it is free.
       That is consistent with the catalogue licence being CC-BY-4.0: copyright
       is open, and 0.16 m aerial imagery is reviewed because it can show
       people, vehicles and private ground. Nothing here is a copyright
       restriction, and the two must not be conflated. */
    dataAccess: 'authenticated access after a free order; Lantmäteriet reviews the intended USE under GDPR and requires accepting särskilda användningsvillkor',
    horizontalCrs: 'EPSG:3006',
    verticalCrs: null,
    licence: 'CC-BY-4.0 (catalogue), with a GDPR use review and special terms on delivery',
    terms: 'https://geotorget.lantmateriet.se/dokument/projects/ortofoto-nedladdning/released/2025.02/',
    termsVersion: 'Geotorget product page 2025.02, read 2026-09-01: avgiftsfri, GDPR use review, särskilda användningsvillkor',
  },
  treeHeight: {
    provider: 'Skogsstyrelsen',
    product: 'Trädhöjd från Laserdata skog',
    discovery: TREE_HEIGHT_CONTRACT.service,
    dataAccess: 'authenticated REST/WMS account or the published FTPS distribution',
    horizontalCrs: TREE_HEIGHT_CONTRACT.horizontalCrs,
    verticalCrs: TREE_HEIGHT_CONTRACT.verticalMeasure,
    licence: 'CC0-1.0 unless a product-specific exception is supplied',
    terms: 'https://www.skogsstyrelsen.se/e-tjanster-och-kartor/karttjanster/geodatatjanster/villkor/',
    termsVersion: 'official page updated 2026-05-13',
  },
});

const allowedMetadataHosts = new Set(['dl1.lantmateriet.se']);

function safeMetadataUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !allowedMetadataHosts.has(url.hostname)) {
    throw new Error(`refusing metadata URL ${url.href}`);
  }
  return url;
}

function round(value, decimals = 3) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function sourceBytes(features) {
  return features.reduce((total, feature) => total +
    (Number.isFinite(feature.assets?.data?.['file:size']) ? feature.assets.data['file:size'] : 0), 0);
}

function uniqueAssets(features, names) {
  const result = [];
  const seen = new Set();
  for (const feature of features) {
    for (const name of names) {
      const asset = feature.assets?.[name];
      if (!asset?.href || seen.has(asset.href)) continue;
      seen.add(asset.href);
      result.push({ feature, name, asset });
    }
  }
  return result.sort((left, right) => left.asset.href.localeCompare(right.asset.href));
}

async function mapLimit(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function fetchBytesWithRetry(url, { fetchImpl, timeoutMs, attempts = 3 }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: { Accept: 'application/json, application/geo+json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('metadata exceeds 8 MiB safety limit');
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
  }
  throw lastError;
}

export async function fetchMetadataEvidence(entries, {
  fetchImpl = globalThis.fetch,
  concurrency = 6,
  timeoutMs = 60_000,
} = {}) {
  return mapLimit(entries, concurrency, async ({ feature, name, asset }) => {
    const url = safeMetadataUrl(asset.href);
    const started = performance.now();
    const expectedSha256 = sha256FromStacChecksum(asset['file:checksum']);
    try {
      const bytes = await fetchBytesWithRetry(url, { fetchImpl, timeoutMs });
      const sha256 = sha256Bytes(bytes);
      const expectedBytes = Number.isFinite(asset['file:size']) ? asset['file:size'] : null;
      return {
        itemId: feature.id,
        collection: feature.collection,
        asset: name,
        href: url.href,
        status: 'verified',
        bytes: bytes.byteLength,
        expectedBytes,
        sha256,
        expectedSha256,
        sizeVerified: expectedBytes === null || expectedBytes === bytes.byteLength,
        checksumVerified: expectedSha256 === null || expectedSha256 === sha256,
        elapsedMilliseconds: round(performance.now() - started),
      };
    } catch (error) {
      return {
        itemId: feature.id,
        collection: feature.collection,
        asset: name,
        href: url.href,
        status: 'unavailable',
        bytes: null,
        expectedBytes: Number.isFinite(asset['file:size']) ? asset['file:size'] : null,
        sha256: null,
        expectedSha256,
        sizeVerified: false,
        checksumVerified: false,
        elapsedMilliseconds: round(performance.now() - started),
        error: String(error?.message || error),
      };
    }
  });
}

function decodedBudget(aoiBbox, resolutionMetres, bytesPerPixel) {
  const widthMetres = aoiBbox[2] - aoiBbox[0];
  const heightMetres = aoiBbox[3] - aoiBbox[1];
  const pixelWidth = Math.ceil(widthMetres / resolutionMetres);
  const pixelHeight = Math.ceil(heightMetres / resolutionMetres);
  return {
    resolutionMetres,
    pixelWidth,
    pixelHeight,
    pixels: pixelWidth * pixelHeight,
    decodedBytes: pixelWidth * pixelHeight * bytesPerPixel,
  };
}

function captureRange(features) {
  const values = features.flatMap(feature => [
    feature.properties?.start_datetime,
    feature.properties?.datetime,
    feature.properties?.end_datetime,
  ]).filter(Boolean).sort();
  return values.length ? { first: values[0], last: values.at(-1) } : { first: null, last: null };
}

function metadataStatus(evidence) {
  const verified = evidence.filter(item => item.status === 'verified' && item.sizeVerified && item.checksumVerified);
  return {
    requestedAssets: evidence.length,
    verifiedAssets: verified.length,
    downloadedBytes: verified.reduce((total, item) => total + item.bytes, 0),
    elapsedMilliseconds: round(evidence.reduce((total, item) => total + item.elapsedMilliseconds, 0)),
    complete: verified.length === evidence.length,
  };
}

function featureSummaries(features, assets) {
  return features.map(feature => summarizeFeature(feature, assets));
}

export async function discoverPilot(aoi, {
  observedOn,
  fetchImpl = globalThis.fetch,
  fetchMetadata = true,
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observedOn || '')) {
    throw new Error('observedOn must be YYYY-MM-DD');
  }
  const started = performance.now();
  const [terrainItems, laserItems, imageryItems] = await Promise.all([
    stacSearch(STAC_ENDPOINTS.height, {
      bbox: aoi.bboxWgs84,
      collections: ['dtm-cog'],
      fetchImpl,
    }),
    stacSearch(STAC_ENDPOINTS.height, {
      bbox: aoi.bboxWgs84,
      collections: ['dsm-skoglig-copc'],
      fetchImpl,
    }),
    stacSearch(STAC_ENDPOINTS.imagery, {
      bbox: aoi.bboxWgs84,
      fetchImpl,
    }),
  ]);

  const terrain = selectNewestCoverage(terrainItems, aoi.bboxEpsg3006);
  const laser = selectNewestCoverage(laserItems, aoi.bboxEpsg3006);
  const imagery = selectLatestCampaign(imageryItems, aoi.bboxEpsg3006);
  const metadataEntries = [
    ...uniqueAssets(terrain.features, ['info', 'metadata']),
    ...uniqueAssets(laser.features, ['info']),
    ...uniqueAssets(imagery.features, ['metadata']),
  ];
  const metadataStarted = performance.now();
  const evidence = fetchMetadata
    ? await fetchMetadataEvidence(metadataEntries, { fetchImpl })
    : [];
  const discoveryElapsed = performance.now() - started;
  const metadataElapsed = performance.now() - metadataStarted;

  const terrainResolution = terrain.features[0]?.properties?.geometriskupplosning || 1;
  const imageryResolution = imagery.primaryFeatures[0]?.properties?.upplosning || null;
  const breakAssets = terrain.features.filter(feature => feature.assets?.breakgeometry);
  const terrainCrsValid = terrain.features.every(feature => feature.properties?.['proj:code'] === 'EPSG:5845');
  const laserCrsValid = laser.features.every(feature => feature.properties?.['proj:code'] === 'EPSG:5845');
  const imageryCrsValid = imagery.features.every(feature => feature.properties?.['proj:code'] === 'EPSG:3006');
  const verifiedMetadata = fetchMetadata ? metadataStatus(evidence) : {
    requestedAssets: metadataEntries.length,
    verifiedAssets: 0,
    downloadedBytes: 0,
    elapsedMilliseconds: null,
    complete: false,
  };
  const discoveryReady = terrain.coverage.complete && imagery.coverage.complete &&
    terrainCrsValid && laserCrsValid && imageryCrsValid &&
    breakAssets.length === terrain.features.length &&
    (!fetchMetadata || verifiedMetadata.complete);

  return {
    $schema: '../../../../packages/course-geo/acquisition/d2-discovery.schema.json',
    schemaVersion: D2_DISCOVERY_SCHEMA_VERSION,
    phase: 'D2-authoritative-acquisition-spike',
    groundId: aoi.groundId,
    groundName: aoi.groundName,
    courseSlugs: aoi.courseSlugs,
    observedOn,
    state: 'discovery-evidence-only',
    aoi: {
      bboxWgs84: aoi.bboxWgs84,
      bboxEpsg3006: aoi.bboxEpsg3006,
      widthMetres: round(aoi.bboxEpsg3006[2] - aoi.bboxEpsg3006[0]),
      heightMetres: round(aoi.bboxEpsg3006[3] - aoi.bboxEpsg3006[1]),
      squareMetres: round((aoi.bboxEpsg3006[2] - aoi.bboxEpsg3006[0]) *
        (aoi.bboxEpsg3006[3] - aoi.bboxEpsg3006[1])),
    },
    sourceContracts: SOURCE_CONTRACTS,
    terrain: {
      collection: 'dtm-cog',
      itemCount: terrain.features.length,
      coverage: terrain.coverage,
      crsValidated: terrainCrsValid,
      compoundCrs: 'EPSG:5845',
      horizontalCrs: 'EPSG:3006',
      verticalCrs: 'EPSG:5613 (RH 2000)',
      resolutionMetres: terrainResolution,
      fullSourceCompressedBytes: sourceBytes(terrain.features),
      captureRange: captureRange(terrain.features),
      items: featureSummaries(terrain.features, ['data', 'breakgeometry', 'info', 'metadata']),
      state: 'coverage-and-metadata-discovered-cog-window-pending',
      cogWindow: {
        state: 'blocked-missing-data-credentials',
        transferredBytes: null,
        outputCompressedBytes: null,
        outputSha256: null,
        elapsedMilliseconds: null,
      },
    },
    waterBreakGeometry: {
      itemCount: breakAssets.length,
      allTerrainItemsAdvertiseAsset: breakAssets.length === terrain.features.length,
      fullSourceCompressedBytes: breakAssets.reduce((total, feature) => total +
        (feature.assets.breakgeometry['file:size'] || 0), 0),
      state: 'discovered-authenticated-ingest-pending',
    },
    laser: {
      collection: 'dsm-skoglig-copc',
      itemCount: laser.features.length,
      coverage: laser.coverage,
      crsValidated: laserCrsValid,
      compoundCrs: 'EPSG:5845',
      horizontalCrs: 'EPSG:3006',
      verticalCrs: 'EPSG:5613 (RH 2000)',
      fullSourceCompressedBytes: sourceBytes(laser.features),
      advertisedPointCount: laser.features.reduce((total, feature) =>
        total + (feature.properties?.['pc:count'] || 0), 0),
      captureRange: captureRange(laser.features),
      items: featureSummaries(laser.features, ['data', 'info']),
      state: 'metadata-discovered-copc-window-pending',
    },
    orthophoto: {
      collection: imagery.collection,
      primaryItemCount: imagery.primaryFeatures.length,
      itemCount: imagery.features.length,
      primaryCoverage: imagery.primaryCoverage,
      coverage: imagery.coverage,
      fallbackCollections: imagery.fallbackCollections,
      completeCampaignAvailable: imagery.completeCampaignAvailable,
      crsValidated: imageryCrsValid,
      horizontalCrs: 'EPSG:3006',
      resolutionMetres: imageryResolution,
      spectralType: imagery.primaryFeatures[0]?.properties?.spektraltyp || null,
      fullSourceCompressedBytes: sourceBytes(imagery.features),
      captureRange: captureRange(imagery.primaryFeatures),
      items: featureSummaries(imagery.features, ['data', 'metadata']),
      alternativeCampaigns: imagery.campaigns.slice(0, 5),
      state: imagery.fallbackCollections.length
        ? 'latest-campaign-with-explicit-older-gap-fill-discovered-data-access-pending'
        : 'latest-complete-campaign-discovered-data-access-pending',
    },
    treeHeight: {
      ...TREE_HEIGHT_CONTRACT,
      coverage: null,
      capturedAt: null,
      state: 'blocked-missing-skogsstyrelsen-raster-credentials',
    },
    metadataEvidence: evidence,
    measurements: {
      discoveryElapsedMilliseconds: round(discoveryElapsed),
      metadataFetchElapsedMilliseconds: fetchMetadata ? round(metadataElapsed) : null,
      metadata: verifiedMetadata,
      decodedAoiBudgets: {
        terrainFloat32: decodedBudget(aoi.bboxEpsg3006, terrainResolution, 4),
        treeHeightInt16: decodedBudget(aoi.bboxEpsg3006, TREE_HEIGHT_CONTRACT.resolutionMetres, 2),
        orthophotoRgba: imageryResolution ? decodedBudget(aoi.bboxEpsg3006, imageryResolution, 4) : null,
      },
      note: 'Decoded AOI values are offline whole-bbox upper bounds, not proposed runtime payloads. COG range-transfer and compressed clip measurements require authenticated asset access.',
    },
    gate: {
      discoveryReady,
      acquisitionComplete: false,
      blockers: [
        'Lantmäteriet data assets require ordered credentials before COG/COPC and break-geometry reads.',
        'Skogsstyrelsen tree-height REST/WMS requires a separate raster account (or FTPS ingestion).',
        'Independent course control points are still required before any source is promoted to authoritative.',
        ...(laser.coverage.complete ? [] : ['The newest Laserdata skog selection does not cover the entire target bbox.']),
      ],
    },
  };
}

export function summarizeDiscoveryReport(report) {
  return {
    groundId: report.groundId,
    observedOn: report.observedOn,
    discoveryReady: report.gate.discoveryReady,
    acquisitionComplete: report.gate.acquisitionComplete,
    aoiSquareMetres: report.aoi.squareMetres,
    terrain: {
      items: report.terrain.itemCount,
      coverage: report.terrain.coverage.ratio,
      sourceBytes: report.terrain.fullSourceCompressedBytes,
      decodedBytes: report.measurements.decodedAoiBudgets.terrainFloat32.decodedBytes,
    },
    waterBreakGeometry: {
      items: report.waterBreakGeometry.itemCount,
      sourceBytes: report.waterBreakGeometry.fullSourceCompressedBytes,
    },
    laser: {
      items: report.laser.itemCount,
      coverage: report.laser.coverage.ratio,
      sourceBytes: report.laser.fullSourceCompressedBytes,
      advertisedPointCount: report.laser.advertisedPointCount,
    },
    orthophoto: {
      campaign: report.orthophoto.collection,
      items: report.orthophoto.itemCount,
      coverage: report.orthophoto.coverage.ratio,
      resolutionMetres: report.orthophoto.resolutionMetres,
      sourceBytes: report.orthophoto.fullSourceCompressedBytes,
      decodedBytes: report.measurements.decodedAoiBudgets.orthophotoRgba.decodedBytes,
    },
    treeHeight: report.treeHeight.state,
    blockers: report.gate.blockers,
  };
}
