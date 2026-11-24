#!/usr/bin/env node
/* Generalized bounded COPC microterrain & building-roof extractor (EPSG:5845).
 *
 * Uses Banvy's verified Node COPC reader (packages/course-geo/copc-reader) to
 * extract exact RH 2000 elevation + 1064 nm laser intensity statistics for
 * named targets:
 *   - Facility / landmark buildings (ASPRS Class 6 roofs vs Class 2 ground:
 *     eave height, ridge height, tower peaks, terrace elevations)
 *   - Signature green / bunker / bulkhead complexes (Class 2 ground crest vs
 *     Class 9 water plane, bank step height, 1064 nm intensity quartiles)
 *
 * Raw point arrays and optional local 0.5 m micro-grids remain strictly inside
 * the gitignored cache directory (for Blender reference scenes and mapping
 * assistance). Only aggregate statistics and provenance digests are written to
 * the committable summary ledger.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { lantmaterietCredentials, authorizationHeaders } from '../acquisition/credentials.mjs';
import { openItem, readWindow, createNodeCache } from '../copc-reader/copc-window.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  const val = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  return Math.round(val * 1000) / 1000;
}

function statsOf(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    count: sorted.length,
    min: Math.round(sorted[0] * 1000) / 1000,
    p10: quantile(sorted, 0.1),
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p98: quantile(sorted, 0.98),
    max: Math.round(sorted[sorted.length - 1] * 1000) / 1000,
    mean: Math.round((sum / sorted.length) * 1000) / 1000,
  };
}

/**
 * Compute aggregate RH 2000 elevation & 1064 nm intensity stats from a decoded
 * COPC point structure `{ count, x, y, z, classification, returnNumber, intensity }`.
 */
export function summarizeLaserPoints(points, boundsEpsg3006, { cellMetres = 0.5 } = {}) {
  const groundZ = [], buildingZ = [], waterZ = [], vegZ = [], allZ = [];
  const groundIntensity = [], buildingIntensity = [], waterIntensity = [];
  const byClass = {};

  for (let i = 0; i < points.count; i++) {
    const cls = points.classification[i];
    const z = points.z[i];
    const inten = points.intensity[i];
    byClass[cls] = (byClass[cls] || 0) + 1;
    allZ.push(z);
    if (cls === 2) { groundZ.push(z); groundIntensity.push(inten); }
    else if (cls === 6) { buildingZ.push(z); buildingIntensity.push(inten); }
    else if (cls === 9) { waterZ.push(z); waterIntensity.push(inten); }
    else if (cls === 3 || cls === 4 || cls === 5) { vegZ.push(z); }
  }

  const ground = statsOf(groundZ);
  const building = statsOf(buildingZ);
  const water = statsOf(waterZ);
  const vegetation = statsOf(vegZ);
  const area = Math.max(1e-6, (boundsEpsg3006[2] - boundsEpsg3006[0]) * (boundsEpsg3006[3] - boundsEpsg3006[1]));

  // Derive building heights relative to local median ground RH 2000
  const buildingRelative = (building && ground) ? {
    eaveAboveGroundMetres: Math.round((building.p10 - ground.median) * 100) / 100,
    medianRoofAboveGroundMetres: Math.round((building.median - ground.median) * 100) / 100,
    ridgeAboveGroundMetres: Math.round((building.p98 - ground.median) * 100) / 100,
    peakAboveGroundMetres: Math.round((building.max - ground.median) * 100) / 100,
  } : null;

  // Derive shoreline / bulkhead step height where both ground & water exist
  const shorelineDrop = (ground && water) ? {
    waterLevelMedianRH2000: water.median,
    bankCrestP90RH2000: ground.p90,
    stepHeightMetres: Math.round((ground.p90 - water.median) * 100) / 100,
  } : null;

  // Build compact 0.5 m micro-grid (for local cache Blender/mapping consumption only)
  const [minE, minN, maxE, maxN] = boundsEpsg3006;
  const cols = Math.max(1, Math.ceil((maxE - minE) / cellMetres));
  const rows = Math.max(1, Math.ceil((maxN - minN) / cellMetres));
  const groundMaxGrid = new Float32Array(cols * rows).fill(NaN);
  const roofMaxGrid = new Float32Array(cols * rows).fill(NaN);
  const intensitySum = new Float64Array(cols * rows);
  const intensityCnt = new Uint32Array(cols * rows);

  for (let i = 0; i < points.count; i++) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((points.x[i] - minE) / cellMetres)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((maxN - points.y[i]) / cellMetres)));
    const k = r * cols + c;
    const cls = points.classification[i];
    const z = points.z[i];
    if (cls === 2 || cls === 9) {
      if (Number.isNaN(groundMaxGrid[k]) || z > groundMaxGrid[k]) groundMaxGrid[k] = z;
      intensitySum[k] += points.intensity[i];
      intensityCnt[k]++;
    }
    if (cls === 6) {
      if (Number.isNaN(roofMaxGrid[k]) || z > roofMaxGrid[k]) roofMaxGrid[k] = z;
    }
  }
  const meanIntensityGrid = new Float32Array(cols * rows).fill(NaN);
  for (let k = 0; k < cols * rows; k++) {
    if (intensityCnt[k] > 0) meanIntensityGrid[k] = intensitySum[k] / intensityCnt[k];
  }

  return {
    summary: {
      pointCount: points.count,
      pointDensityPerSquareMetre: Math.round((points.count / area) * 100) / 100,
      byClass,
      allRH2000: statsOf(allZ),
      groundRH2000: ground,
      buildingRH2000: building,
      waterRH2000: water,
      vegetationRH2000: vegetation,
      buildingRelative,
      shorelineDrop,
      intensity1064nm: {
        ground: statsOf(groundIntensity),
        building: statsOf(buildingIntensity),
        water: statsOf(waterIntensity),
      },
    },
    microGrid: {
      cols, rows, cellMetres, boundsEpsg3006,
      groundMaxGrid, roofMaxGrid, meanIntensityGrid,
    },
  };
}

/**
 * Filter laser discovery items overlapping a target bbox and plan which COPC
 * items must be read.
 */
export function selectCopcItemsForBbox(discoveryReport, bboxEpsg3006) {
  const items = discoveryReport?.laser?.items || [];
  const [w, s, e, n] = bboxEpsg3006;
  const overlapping = items.filter(item => {
    const bb = item.projBbox || item.assets?.data?.projBbox;
    if (!Array.isArray(bb) || bb.length !== 4) return false;
    return bb[0] < e && bb[2] > w && bb[1] < n && bb[3] > s;
  });
  // Prefer newest campaign first
  overlapping.sort((a, b) => String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')) || String(a.id).localeCompare(String(b.id)));
  return overlapping;
}

function mergePointSets(sets) {
  const total = sets.reduce((acc, s) => acc + s.count, 0);
  const out = {
    count: total,
    x: new Float64Array(total),
    y: new Float64Array(total),
    z: new Float32Array(total),
    classification: new Uint8Array(total),
    returnNumber: new Uint8Array(total),
    numberOfReturns: new Uint8Array(total),
    intensity: new Uint16Array(total),
  };
  let offset = 0;
  for (const s of sets) {
    out.x.set(s.x, offset);
    out.y.set(s.y, offset);
    out.z.set(s.z, offset);
    out.classification.set(s.classification, offset);
    out.returnNumber.set(s.returnNumber, offset);
    out.numberOfReturns.set(s.numberOfReturns, offset);
    out.intensity.set(s.intensity, offset);
    offset += s.count;
  }
  return out;
}

export async function acquireMicroterrainTargets({
  groundId,
  discoveryReport,
  targets,
  cacheDir,
  credentials,
  cellMetres = 0.5,
  writeCachePoints = true,
}) {
  if (!credentials) throw new Error('Lantmäteriet credentials are required for COPC microterrain extraction');
  const headers = authorizationHeaders(credentials);
  const opened = new Map();
  const nodeCache = createNodeCache(64);
  if (cacheDir) fs.mkdirSync(path.resolve(cacheDir), { recursive: true });

  const results = [];
  for (const target of targets) {
    const id = target.id;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) throw new Error(`invalid target id ${id}`);
    const bbox = target.boundsEpsg3006;
    if (!Array.isArray(bbox) || bbox.length !== 4 || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
      throw new Error(`target ${id} requires valid boundsEpsg3006`);
    }
    const items = selectCopcItemsForBbox(discoveryReport, bbox);
    if (!items.length) throw new Error(`no COPC item overlaps target ${id} ${JSON.stringify(bbox)}`);

    const pointSets = [];
    const usedItems = [];
    for (const item of items) {
      const url = item.assets?.data?.href;
      if (!url) continue;
      let handle = opened.get(url);
      if (!handle) {
        handle = await openItem({ url, headers });
        opened.set(url, handle);
      }
      const { points, statistics } = await readWindow(handle, bbox, { cache: nodeCache });
      if (points.count > 0) {
        pointSets.push(points);
        usedItems.push({
          id: item.id,
          capturedAt: item.capturedAt || item.captureEnd || null,
          sha256: item.assets?.data?.sha256 || null,
          pointsInWindow: statistics.pointsInWindow,
        });
      }
    }

    const merged = mergePointSets(pointSets);
    const { summary, microGrid } = summarizeLaserPoints(merged, bbox, { cellMetres });

    let cacheArtifacts = null;
    if (cacheDir && writeCachePoints) {
      const dir = path.resolve(cacheDir);
      const gridPath = path.join(dir, `${id}.microgrid.json`);
      const groundF32 = path.join(dir, `${id}.ground-max.f32`);
      const roofF32 = path.join(dir, `${id}.roof-max.f32`);
      const intenF32 = path.join(dir, `${id}.intensity-mean.f32`);
      fs.writeFileSync(groundF32, Buffer.from(microGrid.groundMaxGrid.buffer));
      fs.writeFileSync(roofF32, Buffer.from(microGrid.roofMaxGrid.buffer));
      fs.writeFileSync(intenF32, Buffer.from(microGrid.meanIntensityGrid.buffer));

      // Save compact XYZ+Class points in cache for Blender reference import
      const pts = [];
      for (let i = 0; i < merged.count; i++) {
        pts.push([
          Math.round(merged.x[i] * 100) / 100,
          Math.round(merged.y[i] * 100) / 100,
          Math.round(merged.z[i] * 100) / 100,
          merged.classification[i],
          merged.intensity[i],
        ]);
      }
      const ptsPath = path.join(dir, `${id}.points.json`);
      fs.writeFileSync(ptsPath, JSON.stringify({
        targetId: id,
        crs: 'EPSG:5845',
        boundsEpsg3006: bbox,
        columns: ['easting', 'northing', 'heightRH2000', 'classification', 'intensity'],
        points: pts,
      }));
      fs.writeFileSync(gridPath, JSON.stringify({
        targetId: id,
        crs: 'EPSG:5845',
        boundsEpsg3006: bbox,
        cols: microGrid.cols,
        rows: microGrid.rows,
        cellMetres: microGrid.cellMetres,
        files: {
          groundMax: path.basename(groundF32),
          roofMax: path.basename(roofF32),
          intensityMean: path.basename(intenF32),
          points: path.basename(ptsPath),
        },
      }, null, 2) + '\n');
      cacheArtifacts = {
        gridMeta: path.basename(gridPath),
        pointsSha256: sha256(fs.readFileSync(ptsPath)),
      };
    }

    results.push({
      id,
      kind: target.kind || 'microterrain',
      boundsEpsg3006: bbox,
      sources: usedItems,
      summary,
      cacheArtifacts,
    });
  }

  return {
    schemaVersion: 1,
    groundId,
    crs: 'EPSG:5845',
    generatedAt: new Date().toISOString(),
    retainedPointCloudBytes: 0,
    note: 'Raw COPC points and micro-grids stay in gitignored local cache; this ledger records aggregate RH 2000 & intensity measurements only.',
    targets: results,
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`Unexpected argument: ${k}`);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${k} requires a value`);
    opts[k.slice(2)] = v;
    i++;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.ground || !opts.discovery || !opts.targets || !opts['summary-out']) {
    throw new Error('Usage: acquire-microterrain-laser.mjs --ground ID --discovery FILE --targets FILE --summary-out FILE [--cache-dir DIR] [--cell-metres 0.5]');
  }
  const credentials = lantmaterietCredentials();
  const discoveryReport = JSON.parse(fs.readFileSync(path.resolve(opts.discovery), 'utf8'));
  const targetSpec = JSON.parse(fs.readFileSync(path.resolve(opts.targets), 'utf8'));
  const targets = Array.isArray(targetSpec) ? targetSpec : targetSpec.targets;
  const result = await acquireMicroterrainTargets({
    groundId: opts.ground,
    discoveryReport,
    targets,
    cacheDir: opts['cache-dir'] || null,
    credentials,
    cellMetres: opts['cell-metres'] ? Number(opts['cell-metres']) : 0.5,
  });
  const outPath = path.resolve(opts['summary-out']);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({
    groundId: result.groundId,
    targets: result.targets.map(t => ({ id: t.id, points: t.summary.pointCount, buildingRelative: t.summary.buildingRelative, shorelineDrop: t.summary.shorelineDrop })),
    summaryOut: outPath,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
}
