#!/usr/bin/env node
/* Bounded Lidingö 2021 laser intake without a published course/ground graph.
   node --env-file=.env packages/course-geo/copc-reader/build-lidingo-canopy.mjs
   Outputs only local rasters and credential-free acquisition evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authorizationHeaders, lantmaterietCredentials } from '../acquisition/credentials.mjs';
import { readFloat32TerrainFile } from '../../course-v2/terrain-compiler-node.mjs';
import { assertLidingoAcquisition } from '../../course-v2/lidingo-ground-graph.mjs';
import { createNodeCache, openItem, readWindow } from './copc-window.mjs';
import { blitInterior, canopyHeightModel, fillGround, gridSpec, groundGrid, smoothGround, windowStatistics } from './canopy-build.mjs';
import { LIDINGO_CANOPY_CONFIG as CONFIG, assertLidingoLaserSource, lidingoCanopyTiles, sampleLidingoDtm } from './lidingo-canopy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'lidingobuild/cache/vegetation');
const EVIDENCE = path.join(ROOT, 'geo_data/course-v2/lidingo/vegetation/canopy-evidence.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const round = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
const quantile = (values, q) => values.length ? values[Math.floor((values.length - 1) * q)] : null;

async function main() {
  if (process.argv.length > 2) throw new Error('This pinned intake driver accepts no arguments; its source and bounds are explicit in lidingo-canopy.mjs');
  const discovery = readJson('geo_data/course-v2/lidingo/acquisition/d2-discovery.json');
  const item = assertLidingoLaserSource(discovery.laser.items.find(entry => entry.id === CONFIG.campaignId));
  const acquired = readJson('geo_data/course-v2/lidingo/acquisition/terrain-window.json');
  const dtmPath = path.join(ROOT, acquired.raster.path);
  assertLidingoAcquisition(acquired, sha256(fs.readFileSync(dtmPath)));
  const dtm = await readFloat32TerrainFile(dtmPath, { width: CONFIG.width + 1, height: CONFIG.height + 1 });
  const frame = readJson('geo_data/course-v2/lidingo/acquisition/terrain-compile.json').frame;
  const credentials = lantmaterietCredentials();
  if (!credentials) throw new Error('Configured Lantmäteriet account is required');
  const headers = authorizationHeaders(credentials);
  const head = await fetch(CONFIG.sourceHref, { method: 'HEAD', headers, signal: AbortSignal.timeout(60000) });
  if (head.status !== 200 || head.headers.get('etag') !== CONFIG.sourceEtag ||
      Number(head.headers.get('content-length')) !== CONFIG.sourceBytes) {
    throw new Error(`Pinned Lidingö laser asset is unavailable or has changed (HTTP ${head.status})`);
  }
  const opened = await openItem({ url: item.assets.data.href, headers });
  if (opened.header.pointCount !== CONFIG.sourcePoints) throw new Error('Laser header point count differs from the pinned STAC item');
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  const target = gridSpec({ minEasting: CONFIG.originEasting, maxNorthing: CONFIG.originNorthing,
    width: CONFIG.width, height: CONFIG.height });
  const rasters = Object.fromEntries(['chm', 'ground', 'allReturns', 'firstReturns'].map(name =>
    [name, new Float32Array(CONFIG.width * CONFIG.height).fill(Number.NaN)]));
  const cache = createNodeCache();
  const tiles = lidingoCanopyTiles();
  const perTile = [];
  const started = performance.now();
  console.log(`Lidingö: pinned 2021-03-23 laser, ${tiles.length} windows, 2048-square cells, 64 m halo`);
  for (const tile of tiles) {
    const grid = gridSpec({ minEasting: tile.window[0], maxNorthing: tile.window[3],
      width: tile.window[2] - tile.window[0], height: tile.window[3] - tile.window[1] });
    const read = await readWindow(opened, tile.window, { cache });
    const measured = groundGrid(grid, read.points);
    const filled = fillGround(grid, measured.mean, { radiusCells: CONFIG.groundFillRadiusCells });
    const smoothed = smoothGround(grid, filled.ground);
    const model = canopyHeightModel(grid, read.points, smoothed);
    const interior = [];
    const differences = [];
    let measuredGroundCells = 0, filledGroundCells = 0, unknownGroundCells = 0;
    for (let row = CONFIG.haloMetres; row < CONFIG.haloMetres + CONFIG.tileMetres; row++) {
      for (let column = CONFIG.haloMetres; column < CONFIG.haloMetres + CONFIG.tileMetres; column++) {
        const index = row * grid.width + column;
        interior.push(index);
        if (filled.fillDistance[index] === 0) measuredGroundCells++;
        else if (filled.fillDistance[index] > 0) filledGroundCells++;
        else unknownGroundCells++;
        if ((row & 3) || (column & 3) || !measured.count[index]) continue;
        const easting = grid.minEasting + column + 0.5;
        const northing = grid.maxNorthing - row - 0.5;
        const height = sampleLidingoDtm(dtm.heights, easting, northing);
        if (Number.isFinite(height)) differences.push(measured.mean[index] - height);
      }
    }
    differences.sort((a, b) => a - b);
    const stats = windowStatistics(grid, model, { interior });
    const written = blitInterior(model.chm, grid, rasters.chm, target, tile.bbox);
    if (written !== CONFIG.tileMetres ** 2) throw new Error(`Incomplete canopy interior for ${tile.id}`);
    blitInterior(smoothed, grid, rasters.ground, target, tile.bbox);
    blitInterior(Float32Array.from(model.allReturns), grid, rasters.allReturns, target, tile.bbox);
    blitInterior(Float32Array.from(model.firstReturns), grid, rasters.firstReturns, target, tile.bbox);
    const record = { tileId: tile.id, interiorBboxEpsg3006: tile.bbox, windowBboxEpsg3006: tile.window,
      read: read.statistics, interior: stats, cellsWritten: written,
      groundCells: { measured: measuredGroundCells, filled: filledGroundCells, unknown: unknownGroundCells },
      cloudGroundMinusDtm: { samples: differences.length,
        meanMetres: round(differences.reduce((sum, value) => sum + value, 0) / differences.length),
        medianMetres: round(quantile(differences, 0.5)), p05Metres: round(quantile(differences, 0.05)),
        p95Metres: round(quantile(differences, 0.95)) } };
    perTile.push(record);
    console.log(`${tile.id}: ${read.statistics.pointsInWindow} points, ${(stats.voidFraction * 100).toFixed(1)}% void, ground-DTM median ${record.cloudGroundMinusDtm.medianMetres} m (${perTile.length}/${tiles.length})`);
  }
  const sidecarBase = { width: CONFIG.width, height: CONFIG.height, sampleSpacingMetres: 1,
    originEasting: CONFIG.originEasting, originNorthing: CONFIG.originNorthing,
    horizontalCrs: 'EPSG:3006', verticalCrs: 'EPSG:5613', compoundCrs: 'EPSG:5845',
    originConvention: 'northwest pixel edge; cell centres are origin +0.5m east and -0.5m north',
    noData: null, campaignId: CONFIG.campaignId, groundId: CONFIG.groundId,
    frameFingerprint: frame.fingerprint, observedOn: new Date().toISOString().slice(0, 10) };
  const files = {};
  for (const [layer, values] of Object.entries(rasters)) {
    const stem = `${layer}-${CONFIG.campaignId}`;
    const dataPath = path.join(OUT, `${stem}.f32`);
    const sidecarPath = path.join(OUT, `${stem}.json`);
    const bytes = Buffer.allocUnsafe(values.length * 4);
    values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
    fs.writeFileSync(dataPath, bytes);
    fs.writeFileSync(sidecarPath, `${JSON.stringify({ ...sidecarBase, layer,
      measure: layer === 'chm' ? 'height-above-cloud-ground-metres' : layer === 'ground' ? 'height-RH2000-metres' : 'returns-per-square-metre' }, null, 2)}\n`);
    files[layer] = { data: path.relative(ROOT, dataPath).split(path.sep).join('/'),
      sidecar: path.relative(ROOT, sidecarPath).split(path.sep).join('/'), bytes: bytes.length, sha256: sha256(bytes) };
  }
  const totals = perTile.reduce((result, tile) => {
    for (const field of ['cells', 'allReturns', 'firstReturns', 'groundReturns', 'voidCells', 'measuredCells', 'canopyCells']) result[field] += tile.interior[field];
    return result;
  }, { cells: 0, allReturns: 0, firstReturns: 0, groundReturns: 0, voidCells: 0, measuredCells: 0, canopyCells: 0 });
  if (totals.cells !== CONFIG.width * CONFIG.height || perTile.length !== 64) throw new Error('Canopy acquisition coverage is incomplete');
  const evidence = { schemaVersion: 1, groundId: CONFIG.groundId, observedOn: sidecarBase.observedOn,
    state: 'canopy-rasters-built', frameFingerprint: frame.fingerprint,
    frameStatus: 'provisional-terrain-preview-frame-not-survey-control',
    method: 'Existing COPC + laz-perf reader; exact node point counts; class 2/9 mean ground per 1m cell; nearest ground fill at most60m and 3x3 smoothing; bilinear HAG; highest non-noise return; NaN remains unmeasured; ground-only cells are0.',
    haloMetres: CONFIG.haloMetres, rasterDirectory: path.relative(ROOT, OUT).split(path.sep).join('/'),
    terrainEvidence: 'geo_data/course-v2/lidingo/acquisition/terrain-window.json', terrainSha256: acquired.raster.sha256,
    sourceIdentity: { itemId: item.id, href: CONFIG.sourceHref, catalogueSha256: CONFIG.sourceSha256,
      etag: head.headers.get('etag'), contentLength: Number(head.headers.get('content-length')),
      fullAssetSha256Verified: false, verification: 'Bounded HTTP reads; pinned STAC SHA/ETag/size, complete hierarchy matches LAS header and every decoded node matches its count. Full1.35GB source was not downloaded.' },
    campaigns: [{ campaignId: item.id, captureStart: item.captureStart, captureEnd: item.captureEnd,
      dataBounds: opened.dataBounds, hierarchyPages: opened.hierarchyPages, hierarchyNodes: opened.entries.length,
      tiles: perTile.length, elapsedMilliseconds: round(performance.now() - started), transfer: { ...opened.transfer },
      totals: { ...totals, allReturnDensityPerSquareMetre: round(totals.allReturns / totals.cells),
        pulseDensityPerSquareMetre: round(totals.firstReturns / totals.cells), voidFraction: round(totals.voidCells / totals.cells),
        canopyFractionOfMeasured: round(totals.canopyCells / totals.measuredCells) }, files, perTile }],
    limitations: ['2021 capture is older than the newest2025 imagery and may contain subsequently changed vegetation.',
      'Raw canopy includes non-ground structures; building, water and played-surface exclusions must be applied before rendering vegetation.',
      'These rasters describe measured canopy evidence, not surveyed individual stems.',
      'Void cells are unknown, not clearings. Ground-fill distances and voids remain explicit.'],
  };
  fs.writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ state: evidence.state, campaignId: item.id, totals: evidence.campaigns[0].totals,
    transfer: opened.transfer, files, evidence: path.relative(ROOT, EVIDENCE).split(path.sep).join('/') }, null, 2));
}

main().catch(error => { console.error(`Lidingö canopy acquisition failed: ${error.message}`); process.exitCode = 1; });
