#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from '../manifest.mjs';
import { validateD2DiscoveryReport } from './check-discovery.mjs';
import {
  authorizationHeaders,
  credentialState,
  lantmaterietCredentials,
  skogsstyrelsenCredentials,
} from './credentials.mjs';
import { TREE_HEIGHT_CONTRACT } from './discovery.mjs';
import {
  COURSE_DATA_DIR,
  PILOT_GROUND_IDS,
  loadPilotManifest,
} from './pilots.mjs';
import { treeHeightExportUrl } from './tree-height.mjs';

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_RASTER_PROBE_BYTES = 2 * 1024 * 1024;
const COPC_PROBE_BYTES = 589;
const PROVIDER_IDS = Object.freeze(['lantmateriet', 'skogsstyrelsen']);

function safeLantmaterietAsset(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'dl1.lantmateriet.se' ||
      !url.pathname.startsWith('/hojd/')) {
    throw new Error(`refusing non-height asset URL ${url.href}`);
  }
  return url;
}

function isTiff(value) {
  return value.length >= 4 &&
    ((value[0] === 0x49 && value[1] === 0x49 && [0x2a, 0x2b].includes(value[2]) && value[3] === 0x00) ||
     (value[0] === 0x4d && value[1] === 0x4d && value[2] === 0x00 && [0x2a, 0x2b].includes(value[3])));
}

function isCopc(value) {
  if (value.byteLength !== COPC_PROBE_BYTES) return false;
  const text = new TextDecoder('ascii');
  const pointDataRecordFormat = value[104] & 0x3f;
  const recordLength = value[395] | (value[396] << 8);
  return text.decode(value.subarray(0, 4)) === 'LASF' &&
    value[24] === 1 && value[25] === 4 &&
    [6, 7, 8].includes(pointDataRecordFormat) &&
    text.decode(value.subarray(377, 381)) === 'copc' &&
    value[393] === 1 && value[394] === 0 &&
    recordLength === 160;
}

async function readBounded(response, maximumBytes, label) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel(`${label} exceeds probe limit`);
    throw new Error(`${label} declares ${declared} bytes; probe limit is ${maximumBytes}`);
  }
  if (!response.body?.getReader) {
    const value = new Uint8Array(await response.arrayBuffer());
    if (value.byteLength > maximumBytes) throw new Error(`${label} exceeds probe limit`);
    return value;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel(`${label} exceeds probe limit`);
        throw new Error(`${label} exceeds probe limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function throwHttp(response, provider) {
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${provider} denied the configured account (HTTP ${response.status})`);
  }
  throw new Error(`${provider} access probe returned HTTP ${response.status}`);
}

async function readLantmaterietRange(asset, {
  credentials,
  fetchImpl,
  signal,
  rangeEnd,
  accept,
  label,
}) {
  const url = safeLantmaterietAsset(asset.href);
  const response = await fetchImpl(url, {
    headers: {
      Accept: accept,
      Range: `bytes=0-${rangeEnd}`,
      ...authorizationHeaders(credentials),
    },
    signal,
    redirect: 'error',
  });
  if (!response.ok) throwHttp(response, 'Lantmäteriet');
  if (response.status !== 206) {
    await response.body?.cancel('range response required');
    throw new Error(`Lantmäteriet authorized ${label} but did not provide byte ranges (HTTP ${response.status})`);
  }
  const contentRange = response.headers.get('content-range') || '';
  const match = contentRange.match(/^bytes 0-(\d+)\/(\d+)$/i);
  if (!match) throw new Error(`Lantmäteriet ${label} range response lacks a valid Content-Range header`);
  const returnedEnd = Number(match[1]);
  const sourceBytes = Number(match[2]);
  if (returnedEnd !== rangeEnd) {
    throw new Error(`Lantmäteriet ${label} returned range 0-${returnedEnd}; expected 0-${rangeEnd}`);
  }
  if (sourceBytes !== asset.bytes) {
    throw new Error(`Lantmäteriet ${label} source size ${sourceBytes} does not match discovery ${asset.bytes}`);
  }
  const data = await readBounded(response, rangeEnd + 1, `Lantmäteriet ${label} range response`);
  if (data.byteLength !== rangeEnd + 1) {
    throw new Error(`Lantmäteriet ${label} returned ${data.byteLength} probe bytes; expected ${rangeEnd + 1}`);
  }
  return Object.freeze({ data, httpStatus: response.status, sourceBytes });
}

export async function probeLantmaterietTerrainAccess(report, {
  credentials,
  fetchImpl = globalThis.fetch,
  signal = AbortSignal.timeout(20_000),
} = {}) {
  if (!credentials) throw new Error('Lantmäteriet credentials are missing');
  const item = report.terrain?.items?.[0];
  const asset = item?.assets?.data;
  if (!item?.id || !asset?.href || !Number.isSafeInteger(asset.bytes)) {
    throw new Error('discovery report has no bounded Lantmäteriet terrain probe asset');
  }
  const range = await readLantmaterietRange(asset, {
    credentials, fetchImpl, signal,
    rangeEnd: 15,
    accept: 'image/tiff, application/octet-stream',
    label: 'terrain asset',
  });
  if (!isTiff(range.data)) throw new Error('Lantmäteriet terrain probe is not a TIFF');
  return Object.freeze({
    ready: true,
    credentialType: credentials.type,
    assetId: item.id,
    httpStatus: range.httpStatus,
    rangeSupported: true,
    bytesRead: range.data.byteLength,
    sourceBytes: range.sourceBytes,
  });
}

export async function probeLantmaterietLaserAccess(report, {
  credentials,
  fetchImpl = globalThis.fetch,
  signal = AbortSignal.timeout(20_000),
} = {}) {
  if (!credentials) throw new Error('Lantmäteriet credentials are missing');
  const item = report.laser?.items?.[0];
  const asset = item?.assets?.data;
  if (report.laser?.collection !== 'dsm-skoglig-copc' || !item?.id ||
      asset?.type !== 'application/vnd.laszip+copc' ||
      typeof asset?.href !== 'string' || !asset.href.endsWith('.copc.laz') ||
      !Number.isSafeInteger(asset.bytes) || asset.bytes <= COPC_PROBE_BYTES) {
    throw new Error('discovery report has no bounded Lantmäteriet Laserdata Skog COPC probe asset');
  }
  const range = await readLantmaterietRange(asset, {
    credentials, fetchImpl, signal,
    rangeEnd: COPC_PROBE_BYTES - 1,
    accept: 'application/vnd.laszip+copc, application/octet-stream',
    label: 'Laserdata Skog COPC asset',
  });
  if (!isCopc(range.data)) {
    throw new Error('Lantmäteriet Laserdata Skog probe is not a valid COPC 1.0 header');
  }
  return Object.freeze({
    ready: true,
    credentialType: credentials.type,
    collection: report.laser.collection,
    assetId: item.id,
    httpStatus: range.httpStatus,
    rangeSupported: true,
    bytesRead: range.data.byteLength,
    sourceBytes: range.sourceBytes,
    pointDataRecordFormat: range.data[104] & 0x3f,
    advertisedPointCount: Number.isSafeInteger(item.pointCount) ? item.pointCount : null,
    pointDensityPerSquareMetre: Number.isFinite(item.pointDensityPerSquareMetre)
      ? item.pointDensityPerSquareMetre
      : null,
  });
}

export async function probeLantmaterietAccess(report, options = {}) {
  const [terrain, laser] = await Promise.all([
    probeLantmaterietTerrainAccess(report, options),
    probeLantmaterietLaserAccess(report, options),
  ]);
  return Object.freeze({
    ready: terrain.ready && laser.ready,
    credentialType: terrain.credentialType,
    rangeSupported: terrain.rangeSupported && laser.rangeSupported,
    terrain,
    laser,
  });
}

function treeHeightSample(report) {
  const bbox = report.aoi?.bboxEpsg3006;
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some(value => !Number.isFinite(value))) {
    throw new Error('discovery report lacks a tree-height probe AOI');
  }
  const x = Math.floor((bbox[0] + bbox[2]) / 2);
  const y = Math.floor((bbox[1] + bbox[3]) / 2);
  return { index: 0, bbox: [x, y, x + 16, y + 16], width: 16, height: 16 };
}

export async function probeSkogsstyrelsenAccess(report, {
  credentials,
  fetchImpl = globalThis.fetch,
  signal = AbortSignal.timeout(20_000),
} = {}) {
  if (!credentials) throw new Error('Skogsstyrelsen credentials are missing');
  const headers = { Accept: 'application/json', ...authorizationHeaders(credentials) };
  const serviceUrl = new URL(TREE_HEIGHT_CONTRACT.service);
  serviceUrl.searchParams.set('f', 'pjson');
  const metadataResponse = await fetchImpl(serviceUrl, { headers, signal, redirect: 'error' });
  if (!metadataResponse.ok) throwHttp(metadataResponse, 'Skogsstyrelsen');
  const metadataBytes = await readBounded(metadataResponse, MAX_JSON_BYTES, 'Skogsstyrelsen metadata');
  let metadata;
  try { metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(metadataBytes)); }
  catch (error) { throw new Error(`Skogsstyrelsen metadata is not JSON: ${error.message}`, { cause: error }); }
  if (metadata?.error) throw new Error(`Skogsstyrelsen ArcGIS error ${metadata.error.code}: ${metadata.error.message}`);

  const sampleUrl = treeHeightExportUrl(treeHeightSample(report));
  const sampleResponse = await fetchImpl(sampleUrl, {
    headers: { Accept: 'image/tiff, application/octet-stream', ...authorizationHeaders(credentials) },
    signal,
    redirect: 'error',
  });
  if (!sampleResponse.ok) throwHttp(sampleResponse, 'Skogsstyrelsen');
  const sample = await readBounded(sampleResponse, MAX_RASTER_PROBE_BYTES, 'Skogsstyrelsen raster sample');
  if (!isTiff(sample)) throw new Error('Skogsstyrelsen tree-height probe is not a TIFF');
  return Object.freeze({
    ready: true,
    credentialType: credentials.type,
    service: metadata.name || null,
    pixelType: metadata.pixelType || null,
    spatialReference: metadata.spatialReference || null,
    sampleBytes: sample.byteLength,
  });
}

function safeFailure(error, credentials) {
  return Object.freeze({
    ready: false,
    credentialState: credentialState(credentials),
    reason: String(error?.message || error).slice(0, 500),
  });
}

export async function probeProviderAccess(report, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  providers = PROVIDER_IDS,
} = {}) {
  if (!Array.isArray(providers) || providers.length === 0 ||
      providers.some(provider => !PROVIDER_IDS.includes(provider))) {
    throw new Error(`providers must contain one or more of ${PROVIDER_IDS.join(', ')}`);
  }
  const selectedProviders = [...new Set(providers)];
  const selected = new Set(selectedProviders);
  const lantmateriet = lantmaterietCredentials(env);
  const skogsstyrelsen = skogsstyrelsenCredentials(env);
  const probe = async (credentials, run) => {
    if (!credentials) return safeFailure(new Error('credentials are not configured'), credentials);
    try { return await run(credentials); }
    catch (error) { return safeFailure(error, credentials); }
  };
  const skipped = Object.freeze({ ready: false, skipped: true, reason: 'not requested' });
  const [lm, sks] = await Promise.all([
    selected.has('lantmateriet')
      ? probe(lantmateriet, credentials => probeLantmaterietAccess(report, { credentials, fetchImpl }))
      : skipped,
    selected.has('skogsstyrelsen')
      ? probe(skogsstyrelsen, credentials => probeSkogsstyrelsenAccess(report, { credentials, fetchImpl }))
      : skipped,
  ]);
  const providerStates = Object.freeze({ lantmateriet: lm, skogsstyrelsen: sks });
  return Object.freeze({
    schemaVersion: 1,
    phase: 'D2-provider-access-preflight',
    groundId: report.groundId,
    checkedAt: new Date().toISOString(),
    selectedProviders: Object.freeze(selectedProviders),
    ready: selectedProviders.every(provider => providerStates[provider].ready),
    providers: providerStates,
    note: 'No credentials, authorization headers or provider passwords are serialized.',
  });
}

function parseArguments(argv) {
  const options = { groundId: 'puttom', json: false, providers: PROVIDER_IDS };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--ground') options.groundId = argv[++index];
    else if (argv[index] === '--json') options.json = true;
    else if (argv[index] === '--provider') {
      const provider = argv[++index];
      if (provider === 'all') options.providers = PROVIDER_IDS;
      else if (PROVIDER_IDS.includes(provider)) options.providers = [provider];
      else throw new Error(`--provider must be all or one of ${PROVIDER_IDS.join(', ')}`);
    }
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  if (!PILOT_GROUND_IDS.includes(options.groundId)) {
    throw new Error(`--ground must be one of ${PILOT_GROUND_IDS.join(', ')}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const file = path.join(COURSE_DATA_DIR, options.groundId, 'acquisition', 'd2-discovery.json');
  const report = readJson(file);
  const errors = validateD2DiscoveryReport(report, loadPilotManifest(options.groundId));
  if (errors.length) throw new Error(`discovery snapshot is invalid:\n${errors.join('\n')}`);
  const result = await probeProviderAccess(report, { providers: options.providers });
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else {
    console.log(`provider access preflight: ${result.groundId}`);
    for (const [provider, state] of Object.entries(result.providers)) {
      console.log(`  ${provider}: ${state.ready ? 'ready' : state.skipped ? 'not requested' : state.reason}`);
    }
  }
  if (!result.ready) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`provider access preflight failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
