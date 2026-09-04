#!/usr/bin/env node
/* Stages 1-3 of the vegetation plan for one ground, in Node: read every
   finest tile's window from the campaign that owns it, build height above
   ground from the cloud's own ground returns, rasterise the canopy height
   model and the return counts, compare the cloud ground with the published
   DTM, and write per-campaign rasters plus credential-free evidence.

   usage: node packages/course-geo/copc-reader/build-canopy.mjs --ground puttom
            --out <dir> [--halo 32] [--tiles l0/0/0,l0/1/0] [--campaigns id,id]
            [--evidence geo_data/course-v2/<ground>/vegetation/canopy-evidence.json]

   Rasters (raw Float32 + JSON sidecar, NaN = void) go to --out, which must be
   outside the repository's committed tree; the evidence file is small and is
   what gets committed. Point bytes are never retained.                      */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, sha256File } from '../manifest.mjs';
import { ACQUISITION_GROUND_IDS, COURSE_DATA_DIR, loadPilotManifest } from '../acquisition/pilots.mjs';
import { authorizationHeaders, credentialState, lantmaterietCredentials } from '../acquisition/credentials.mjs';
import { createGroundSampler } from '../../course-v2/vegetation/ground-sampler.mjs';
import { createNodeCache, openItem, readWindow } from './copc-window.mjs';
import {
  blitInterior,
  canopyHeightModel,
  fillGround,
  gridSpec,
  groundGrid,
  smoothGround,
  windowStatistics,
} from './canopy-build.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const groundId = flag('ground');
const outDir = flag('out');
const halo = Number(flag('halo', 32));
const onlyTiles = (flag('tiles', '') || '').split(',').filter(Boolean);
const onlyCampaigns = (flag('campaigns', '') || '').split(',').filter(Boolean);
const observedOn = flag('observed-on', new Date().toISOString().slice(0, 10));
if (!ACQUISITION_GROUND_IDS.includes(groundId) || !outDir) {
  console.error(`usage: --ground <${ACQUISITION_GROUND_IDS.join('|')}> --out <dir> [--halo m] [--tiles ids] [--campaigns ids]`);
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const evidencePath = path.resolve(ROOT, flag('evidence', `geo_data/course-v2/${groundId}/vegetation/canopy-evidence.json`));
const dataDir = path.join(COURSE_DATA_DIR, groundId);
const manifest = loadPilotManifest(groundId);
const campaigns = readJson(path.join(dataDir, 'acquisition/laser-campaigns.json'));
const censusPath = path.join(dataDir, 'acquisition/copc-hierarchy-census.json');
const census = fs.existsSync(censusPath) ? readJson(censusPath) : null;
const publicDir = path.join(ROOT, 'apps/golf/public');
const graphRoot = readJson(path.join(publicDir, 'courses/v2-index.json'));
const rootEntry = graphRoot.courses?.find(course => course.groundId === groundId);
if (!rootEntry) throw new Error(`published v2 root has no ground ${groundId}`);
const courseManifest = readJson(path.join(publicDir, rootEntry.manifest.url));
const ground = readJson(path.join(publicDir, courseManifest.groundManifest.url));
if (ground.groundId !== groundId) throw new Error(`published root resolved ${ground.groundId}, not ${groundId}`);
const readAsset = async url => fs.readFileSync(path.join(publicDir, url));
const sampler = await createGroundSampler(ground, readAsset);
const credentials = lantmaterietCredentials();
if (!credentials) { console.error('Lantmäteriet credentials are required'); process.exit(1); }
const headers = authorizationHeaders(credentials);
const redact = text => {
  let out = String(text);
  for (const value of Object.values(headers)) out = out.split(value).join('<redacted>');
  if (credentials.password) out = out.split(credentials.password).join('<redacted>');
  if (credentials.username) out = out.split(credentials.username).join('<redacted>');
  return out.slice(0, 300);
};
fs.mkdirSync(outDir, { recursive: true });
if (path.resolve(outDir).startsWith(path.join(ROOT, 'geo_data')) || path.resolve(outDir).startsWith(path.join(ROOT, 'apps'))) {
  console.error('--out must not point into the committed tree');
  process.exit(2);
}

const finest = ground.tiles.filter(tile => tile.lod === 0 && (!onlyTiles.length || onlyTiles.includes(tile.id)));
const target = gridSpec({
  minEasting: ground.bounds.minEasting,
  maxNorthing: ground.bounds.maxNorthing,
  width: Math.round(ground.bounds.maxEasting - ground.bounds.minEasting),
  height: Math.round(ground.bounds.maxNorthing - ground.bounds.minNorthing),
});
const round = (value, decimals = 3) => (Number.isFinite(value) ? Math.round(value * 10 ** decimals) / 10 ** decimals : null);
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] : null);

console.log(`${groundId}: ${finest.length} finest tiles, ground ${target.width} x ${target.height} m, halo ${halo} m, credentials ${credentialState(credentials)}`);
const campaignEvidence = [];
let failures = 0;
const cache = createNodeCache();
for (const item of campaigns.items) {
  if (item.role !== 'active') continue;
  if (onlyCampaigns.length && !onlyCampaigns.includes(item.id)) continue;
  const extent = item.projBbox;
  const tiles = finest.filter(tile =>
    tile.bounds.minEasting < extent[2] && tile.bounds.maxEasting > extent[0] &&
    tile.bounds.minNorthing < extent[3] && tile.bounds.maxNorthing > extent[1]);
  console.log(`\n${item.id} (${item.captureStart?.slice(0, 10)}..${item.captureEnd?.slice(0, 10)}): ${tiles.length} tiles intersect its extent`);
  /* A WGS84 discovery rectangle can graze a neighbouring catalogue item even
     when the aligned projected ground stops half a sample before its seam.
     Do not authenticate or emit an all-void raster for an item that owns no
     published finest tile. */
  if (!tiles.length) {
    console.log('  skipped: no published finest tile intersects this campaign');
    continue;
  }
  let opened;
  try {
    opened = await openItem({ url: item.assets.data.href, headers });
  } catch (error) {
    failures++;
    console.log(`  open FAILED: ${redact(error.message)}`);
    continue;
  }
  const rasters = {
    chm: new Float32Array(target.width * target.height).fill(Number.NaN),
    ground: new Float32Array(target.width * target.height).fill(Number.NaN),
    allReturns: new Float32Array(target.width * target.height).fill(Number.NaN),
    firstReturns: new Float32Array(target.width * target.height).fill(Number.NaN),
  };
  const tileEvidence = [];
  const started = performance.now();
  for (const tile of tiles) {
    const b = tile.bounds;
    const window = [
      Math.max(extent[0], b.minEasting - halo), Math.max(extent[1], b.minNorthing - halo),
      Math.min(extent[2], b.maxEasting + halo), Math.min(extent[3], b.maxNorthing + halo),
    ];
    const grid = gridSpec({
      minEasting: window[0],
      maxNorthing: window[3],
      width: Math.round(window[2] - window[0]),
      height: Math.round(window[3] - window[1]),
    });
    let read;
    try {
      read = await readWindow(opened, window, { cache });
    } catch (error) {
      failures++;
      console.log(`  ${tile.id} read FAILED: ${redact(error.message)}`);
      continue;
    }
    const { mean, count } = groundGrid(grid, read.points);
    const { ground: filledGround, fillDistance } = fillGround(grid, mean);
    const smooth = smoothGround(grid, filledGround);
    const model = canopyHeightModel(grid, read.points, smooth);
    /* interior cells of this tile within the campaign extent */
    const interior = [];
    const interiorBbox = [Math.max(extent[0], b.minEasting), Math.max(extent[1], b.minNorthing), Math.min(extent[2], b.maxEasting), Math.min(extent[3], b.maxNorthing)];
    for (let row = 0; row < grid.height; row++) {
      const northing = grid.maxNorthing - (row + 0.5);
      if (northing <= interiorBbox[1] || northing > interiorBbox[3]) continue;
      for (let column = 0; column < grid.width; column++) {
        const easting = grid.minEasting + column + 0.5;
        if (easting < interiorBbox[0] || easting >= interiorBbox[2]) continue;
        interior.push(row * grid.width + column);
      }
    }
    const stats = windowStatistics(grid, model, { interior });
    /* cloud ground against the published DTM, on measured ground cells, every fourth cell each way */
    const differences = [];
    for (const index of interior) {
      const row = Math.floor(index / grid.width);
      const column = index - row * grid.width;
      if ((row & 3) || (column & 3) || !count[index]) continue;
      const easting = grid.minEasting + column + 0.5;
      const northing = grid.maxNorthing - row - 0.5;
      const dtm = await sampler.sample(easting, northing);
      if (!dtm || dtm.nodata) continue;
      differences.push(mean[index] - dtm.heightRH2000);
    }
    differences.sort((a, b) => a - b);
    const meanDifference = differences.length ? differences.reduce((sum, value) => sum + value, 0) / differences.length : null;
    let groundFilledCells = 0;
    let groundMeasuredCells = 0;
    let groundUnknownCells = 0;
    for (const index of interior) {
      if (fillDistance[index] === 0) groundMeasuredCells++;
      else if (fillDistance[index] > 0) groundFilledCells++;
      else groundUnknownCells++;
    }
    const written = blitInterior(model.chm, grid, rasters.chm, target, interiorBbox);
    blitInterior(smooth, grid, rasters.ground, target, interiorBbox);
    blitInterior(Float32Array.from(model.allReturns), grid, rasters.allReturns, target, interiorBbox);
    blitInterior(Float32Array.from(model.firstReturns), grid, rasters.firstReturns, target, interiorBbox);
    tileEvidence.push({
      tileId: tile.id,
      interiorBboxEpsg3006: interiorBbox,
      windowBboxEpsg3006: window,
      read: read.statistics,
      interior: stats,
      groundCells: { measured: groundMeasuredCells, filled: groundFilledCells, unknown: groundUnknownCells },
      cloudGroundMinusDtm: differences.length ? {
        samples: differences.length,
        meanMetres: round(meanDifference),
        medianMetres: round(quantile(differences, 0.5)),
        p05Metres: round(quantile(differences, 0.05)),
        p95Metres: round(quantile(differences, 0.95)),
      } : null,
      cellsWritten: written,
    });
    console.log(`  ${tile.id.padEnd(9)} nodes ${String(read.statistics.nodes).padStart(3)} pts ${String(read.statistics.pointsInWindow).padStart(8)}  pulses ${stats.pulseDensityPerSquareMetre.toFixed(2)}/m² returns ${stats.allReturnDensityPerSquareMetre.toFixed(2)}/m²  canopy ${stats.canopyFractionOfMeasured === null ? '-' : (100 * stats.canopyFractionOfMeasured).toFixed(0) + '%'} void ${(100 * stats.voidFraction).toFixed(1)}%  ground-DTM median ${differences.length ? quantile(differences, 0.5).toFixed(2) : '-'} m`);
  }
  const elapsed = performance.now() - started;
  const campaignDirName = item.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const sidecar = { width: target.width, height: target.height, sampleSpacingMetres: 1, originEasting: target.minEasting, originNorthing: target.maxNorthing, noData: null, campaignId: item.id, groundId, frameFingerprint: ground.frame.fingerprint, observedOn };
  const files = {};
  for (const [name, values] of Object.entries(rasters)) {
    const dataPath = path.join(outDir, `${name}-${campaignDirName}.f32`);
    const sidecarPath = path.join(outDir, `${name}-${campaignDirName}.json`);
    fs.writeFileSync(dataPath, Buffer.from(values.buffer, values.byteOffset, values.byteLength));
    fs.writeFileSync(sidecarPath, JSON.stringify({ ...sidecar, layer: name }, null, 2) + '\n');
    files[name] = { data: path.relative(ROOT, dataPath), sidecar: path.relative(ROOT, sidecarPath), sha256: sha256File(dataPath) };
  }
  /* census equivalence over the census's own windows: exact counts against the area-weighted estimates */
  const censusChecks = [];
  const censusItem = census?.items?.find(entry => entry.itemId === item.id);
  if (censusItem?.windows) {
    for (const window of censusItem.windows) {
      if (!/^w256-|origin|seam/.test(window.id)) continue;
      try {
        const read = await readWindow(opened, window.bboxEpsg3006, { cache });
        censusChecks.push({ id: window.id, censusEstimate: window.estimatedPoints, exact: read.statistics.pointsInWindow, ratio: window.estimatedPoints ? round(read.statistics.pointsInWindow / window.estimatedPoints) : null });
      } catch (error) {
        censusChecks.push({ id: window.id, error: redact(error.message) });
      }
    }
  }
  const totals = tileEvidence.reduce((sum, tile) => ({
    points: sum.points + tile.read.pointsInWindow,
    allReturns: sum.allReturns + tile.interior.allReturns,
    firstReturns: sum.firstReturns + tile.interior.firstReturns,
    cells: sum.cells + tile.interior.cells,
    voidCells: sum.voidCells + tile.interior.voidCells,
    canopyCells: sum.canopyCells + tile.interior.canopyCells,
    measuredCells: sum.measuredCells + tile.interior.measuredCells,
  }), { points: 0, allReturns: 0, firstReturns: 0, cells: 0, voidCells: 0, canopyCells: 0, measuredCells: 0 });
  campaignEvidence.push({
    campaignId: item.id,
    captureStart: item.captureStart,
    captureEnd: item.captureEnd,
    dataBounds: opened.dataBounds,
    hierarchyPages: opened.hierarchyPages,
    hierarchyNodes: opened.entries.length,
    subdivision: 'header-extent per axis (verified; not the specification cube)',
    tiles: tileEvidence.length,
    elapsedMilliseconds: round(elapsed, 1),
    transfer: { ...opened.transfer },
    totals: {
      ...totals,
      allReturnDensityPerSquareMetre: round(totals.allReturns / totals.cells),
      pulseDensityPerSquareMetre: round(totals.firstReturns / totals.cells),
      voidFraction: round(totals.voidCells / totals.cells),
      canopyFractionOfMeasured: totals.measuredCells ? round(totals.canopyCells / totals.measuredCells) : null,
    },
    censusChecks,
    files,
    perTile: tileEvidence,
  });
  console.log(`  ${item.id}: ${totals.points} points, pulses ${(totals.firstReturns / totals.cells).toFixed(2)}/m², returns ${(totals.allReturns / totals.cells).toFixed(2)}/m², void ${(100 * totals.voidCells / totals.cells).toFixed(2)}%, canopy ${(100 * totals.canopyCells / Math.max(1, totals.measuredCells)).toFixed(1)}% of measured; ${opened.transfer.requests} requests, ${(opened.transfer.bytes / 1e6).toFixed(1)} MB, ${(elapsed / 1000).toFixed(0)} s; cache ${cache.size} nodes`);
}

const evidence = {
  schemaVersion: 1,
  groundId,
  groundName: manifest.groundName,
  observedOn,
  state: failures ? 'incomplete' : 'canopy-rasters-built',
  method: 'Node reader over authenticated range requests (copc + laz-perf); ground from the cloud\'s own class 2/9 returns, mean per 1 m cell, nearest-fill to 60 m, 3x3 mean; height above ground bilinear; CHM = highest non-noise return per cell, 0 where only ground returns exist, NaN where none; densities counted, never copied',
  haloMetres: halo,
  frameFingerprint: ground.frame.fingerprint,
  groundManifest: courseManifest.groundManifest.url,
  campaignsSha256: sha256File(path.join(dataDir, 'acquisition/laser-campaigns.json')),
  censusSha256: fs.existsSync(censusPath) ? sha256File(censusPath) : null,
  rasterDirectory: path.relative(ROOT, path.resolve(outDir)),
  campaigns: campaignEvidence,
};
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
console.log(`\nwrote ${path.relative(ROOT, evidencePath)} (${failures ? failures + ' failure(s)' : 'complete'})`);
process.exit(failures ? 1 : 0);
