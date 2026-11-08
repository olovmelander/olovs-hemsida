/* Stage `canopy`: canopy rasters from the cached COPC items (from the
   Johannesberg pilot's build-chm).

   Over the inner window plus its halo: every non-noise return of the
   configured laser items; ground from the cloud's own class 2/9 returns (1 m
   mean, nearest-filled, 3x3 mean, as the published pipeline); height above
   that ground per return; then on the CHM lattice the highest return, the
   pit-free CHM (pit-free-chm.mjs), return counts (all, first, ground) and the
   empty cells; on a 1 m lattice the published method's CHM (highest return
   per cell) for the current detector's benchmark. The cloud ground is
   compared with the terrain of the review's baseline generation, the terrain
   the app draws: a systematic difference means a terrain revision, and the
   stage stops for the owner. Rasters and a compact point file go to the
   ignored cache; a credential-free evidence file goes to the review
   directory.                                                               */
import fs from 'node:fs';
import path from 'node:path';
import { readJson, sha256File } from '../../packages/course-geo/manifest.mjs';
import { openItem, readWindow } from '../../packages/course-geo/copc-reader/copc-window.mjs';
import { canopyHeightModel, fillGround, gridSpec, groundAt, groundGrid, smoothGround, GROUND_CLASSES, NOISE_CLASSES, HAG_CEILING_METRES } from '../../packages/course-geo/copc-reader/canopy-build.mjs';
import { createGroundHeightLookup } from '../../packages/course-v2/vegetation/ground-sampler.mjs';
import { PIT_FREE_DEFAULTS, pitFreeChm, rasterizeReturns } from '../../packages/course-v2/vegetation/pit-free-chm.mjs';
import { publishedGround } from './published-population.mjs';
import { writeReceipt } from './receipts.mjs';

/* the cloud ground against the published terrain: beyond these the terrain
   the app draws and the laser disagree, which is a terrain revision for the
   owner, not something the tree stage may paper over */
export const TERRAIN_STOP = Object.freeze({ absoluteMedianMetres: 0.1, absoluteP95Metres: 0.25 });
const round = (value, decimals = 3) => (Number.isFinite(value) ? Math.round(value * 10 ** decimals) / 10 ** decimals : null);
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))] : null);

/** A fetch stand-in that serves byte ranges of a cached COPC file. */
export function localRangeFetch(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  return async (_url, { headers }) => {
    const match = /bytes=(\d+)-(\d+)/.exec(headers?.Range || '');
    if (!match) throw new Error('range header required');
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), size - 1);
    const buffer = Buffer.alloc(end - start + 1);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return { status: 206, ok: true, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  };
}

export function writeRaster(ctx, name, values, grid, extra = {}) {
  const rasterDir = ctx.paths.rasters;
  fs.mkdirSync(rasterDir, { recursive: true });
  const file = path.join(rasterDir, `${name}.bin`);
  fs.writeFileSync(file, Buffer.from(values.buffer, values.byteOffset, values.byteLength));
  const sidecar = {
    layer: name,
    dtype: values.constructor.name.replace('Array', '').toLowerCase(),
    width: grid.width, height: grid.height, sampleSpacingMetres: grid.sampleSpacingMetres,
    originEasting: grid.minEasting, originNorthing: grid.maxNorthing,
    cellConvention: 'north-up; row 0 is the northern edge; cell edges on the origin', crs: 'EPSG:3006 / heights RH2000',
    sha256: sha256File(file), ...extra,
  };
  fs.writeFileSync(path.join(rasterDir, `${name}.json`), JSON.stringify(sidecar, null, 2) + '\n');
  return { file: ctx.rel(file), sha256: sidecar.sha256 };
}

export async function run(ctx) {
  const started = performance.now();
  const window = ctx.haloWindow;
  const bbox = [window.minEasting, window.minNorthing, window.maxEasting, window.maxNorthing];
  const campaignsPath = path.join(ctx.root, ctx.config.laser.campaigns);
  const campaigns = readJson(campaignsPath);
  const copcFiles = [];
  /* ---------- read every return in the window ---------- */
  const parts = [];
  const itemEvidence = [];
  for (const id of ctx.config.laser.items) {
    const item = campaigns.items.find(entry => entry.id === id);
    const file = path.join(ctx.paths.copc, path.basename(new URL(item.assets.data.href).pathname));
    copcFiles.push(file);
    if (fs.statSync(file).size !== item.assets.data.bytes) throw new Error(`${id}: cached file size differs from the pin`);
    const opened = await openItem({ url: item.assets.data.href, fetchImpl: localRangeFetch(file) });
    const [x0, y0, x1, y1] = item.projBbox;
    const sub = [Math.max(bbox[0], x0), Math.max(bbox[1], y0), Math.min(bbox[2], x1), Math.min(bbox[3], y1)];
    if (sub[0] >= sub[2] || sub[1] >= sub[3]) continue;
    const read = await readWindow(opened, sub, { padMetres: 2 });
    parts.push(read.points);
    itemEvidence.push({ itemId: id, sha256: item.assets.data.sha256, windowEpsg3006: sub, nodes: read.statistics.nodes, decodedPoints: read.statistics.decodedPoints, pointsInWindow: read.statistics.pointsInWindow, firstReturns: read.statistics.firstReturns, byClass: read.statistics.byClass, headerPointCount: opened.header.pointCount });
    console.log(`${id}: ${read.statistics.pointsInWindow} points in window (${read.statistics.nodes} nodes), classes ${JSON.stringify(read.statistics.byClass)}`);
  }
  const count = parts.reduce((sum, part) => sum + part.count, 0);
  const points = {
    count,
    x: new Float64Array(count), y: new Float64Array(count), z: new Float32Array(count),
    classification: new Uint8Array(count), returnNumber: new Uint8Array(count), numberOfReturns: new Uint8Array(count), intensity: new Uint16Array(count),
  };
  let offset = 0;
  for (const part of parts) {
    for (const key of ['x', 'y', 'z', 'classification', 'returnNumber', 'numberOfReturns', 'intensity']) points[key].set(part[key], offset);
    offset += part.count;
  }
  parts.length = 0;
  /* ---------- ground from the cloud, 1 m ---------- */
  const ground1 = gridSpec({ minEasting: bbox[0], maxNorthing: bbox[3], width: Math.round(bbox[2] - bbox[0]), height: Math.round(bbox[3] - bbox[1]) });
  const { mean, count: groundCount } = groundGrid(ground1, points);
  const { ground: filledGround, fillDistance } = fillGround(ground1, mean);
  const ground = smoothGround(ground1, filledGround);
  /* ---------- height above ground per return ---------- */
  const hag = new Float32Array(count);
  let noise = 0, clipped = 0, unreferenced = 0;
  for (let i = 0; i < count; i++) {
    const c = points.classification[i];
    if (NOISE_CLASSES.has(c)) { hag[i] = Number.NaN; noise++; continue; }
    if (GROUND_CLASSES.has(c)) { hag[i] = 0; continue; }
    const base = groundAt(ground1, ground, points.x[i], points.y[i]);
    if (Number.isNaN(base)) { hag[i] = Number.NaN; unreferenced++; continue; }
    let h = points.z[i] - base;
    if (h < 0) h = 0;
    if (h > HAG_CEILING_METRES) { hag[i] = Number.NaN; clipped++; continue; }
    hag[i] = h;
  }
  /* ---------- 0.5 m rasters ---------- */
  const grid = ctx.chmGrid;
  const raster = rasterizeReturns(grid, points, hag);
  const pitFree = pitFreeChm(grid, raster, PIT_FREE_DEFAULTS);
  const empty = new Uint8Array(grid.width * grid.height);
  let emptyCells = 0, voidCells = 0;
  for (let i = 0; i < empty.length; i++) { if (!raster.all[i]) { empty[i] = 1; emptyCells++; } if (Number.isNaN(pitFree.values[i])) voidCells++; }
  /* ---------- the published method's 1 m CHM, same ground ---------- */
  const legacy = canopyHeightModel(ground1, points, ground);
  /* ---------- cloud ground against the published terrain ---------- */
  /* the review's baseline generation: the terrain the app drew when the review began */
  const { publicDir, groundManifestUrl, ground: groundManifest } = publishedGround(ctx, ctx.config.published.baselineGroundManifest);
  const lookup = await createGroundHeightLookup(groundManifest, async url => fs.readFileSync(path.join(publicDir, url)));
  const inner = ctx.innerWindow;
  const signed = [];
  const absolute = [];
  for (let row = 0; row < ground1.height; row++) {
    const northing = ground1.maxNorthing - row - 0.5;
    if (northing < inner.minNorthing || northing > inner.maxNorthing) continue;
    for (let column = 0; column < ground1.width; column++) {
      const easting = ground1.minEasting + column + 0.5;
      if (easting < inner.minEasting || easting > inner.maxEasting) continue;
      const index = row * ground1.width + column;
      if (!groundCount[index]) continue;
      const published = lookup.heightAt(easting, northing);
      if (!Number.isFinite(published)) continue;
      const d = mean[index] - published;
      signed.push(d);
      absolute.push(Math.abs(d));
    }
  }
  signed.sort((a, b) => a - b);
  absolute.sort((a, b) => a - b);
  /* ---------- write ---------- */
  const files = {
    chmPitFree: writeRaster(ctx, 'chm-pitfree-050', pitFree.values, grid, { method: 'pit-free-chm.mjs layered quadrant-IDW + pit pass', parameters: PIT_FREE_DEFAULTS, noData: 'NaN = unmeasured' }),
    chmHighest: writeRaster(ctx, 'chm-highest-050', raster.max, grid, { method: 'highest non-noise return per 0.5 m cell, no fill', noData: 'NaN = no return' }),
    returnsAll: writeRaster(ctx, 'returns-all-050', raster.all, grid),
    returnsFirst: writeRaster(ctx, 'returns-first-050', raster.first, grid),
    returnsGround: writeRaster(ctx, 'returns-ground-050', raster.ground, grid),
    emptyCells: writeRaster(ctx, 'empty-050', empty, grid, { meaning: '1 = no return in the 0.5 m cell' }),
    groundCloud: writeRaster(ctx, 'ground-cloud-100', ground, ground1, { method: 'class 2/9 mean per 1 m cell, nearest fill 60 m, 3x3 mean' }),
    groundFillDistance: writeRaster(ctx, 'ground-fill-100', fillDistance, ground1, { meaning: '0 measured ground, >0 cells filled from nearest, -1 unknown' }),
    chmLegacy: writeRaster(ctx, 'chm-legacy-100', legacy.chm, ground1, { method: 'canopy-build.mjs canopyHeightModel (published method), 1 m' }),
  };
  /* compact points for crown attributes: float32 offsets from the grid origin */
  const rasterDir = ctx.paths.rasters;
  const pointFile = path.join(rasterDir, 'points.bin');
  const record = 4 + 4 + 4 + 1 + 1 + 1 + 1 + 2;
  const buffer = Buffer.alloc(count * record);
  for (let i = 0; i < count; i++) {
    const o = i * record;
    buffer.writeFloatLE(points.x[i] - grid.minEasting, o);
    buffer.writeFloatLE(grid.maxNorthing - points.y[i], o + 4);
    buffer.writeFloatLE(hag[i], o + 8);
    buffer[o + 12] = points.classification[i];
    buffer[o + 13] = points.returnNumber[i];
    buffer[o + 14] = points.numberOfReturns[i];
    buffer[o + 15] = 0;
    buffer.writeUInt16LE(points.intensity[i], o + 16);
  }
  fs.writeFileSync(pointFile, buffer);
  fs.writeFileSync(path.join(rasterDir, 'points.json'), JSON.stringify({ count, recordBytes: record, fields: ['eastOffset f32 (m from originEasting)', 'southOffset f32 (m from originNorthing)', 'hag f32 (NaN noise/clipped)', 'class u8', 'returnNumber u8', 'numberOfReturns u8', 'pad u8', 'intensity u16'], originEasting: grid.minEasting, originNorthing: grid.maxNorthing, sha256: sha256File(pointFile) }, null, 2) + '\n');
  /* ---------- evidence ---------- */
  const innerCells = (() => {
    let all = 0, first = 0, emptyInner = 0, voidInner = 0, n = 0;
    for (let row = 0; row < grid.height; row++) {
      const northing = grid.maxNorthing - (row + 0.5) * grid.sampleSpacingMetres;
      if (northing < inner.minNorthing || northing > inner.maxNorthing) continue;
      for (let column = 0; column < grid.width; column++) {
        const easting = grid.minEasting + (column + 0.5) * grid.sampleSpacingMetres;
        if (easting < inner.minEasting || easting > inner.maxEasting) continue;
        const index = row * grid.width + column;
        n++; all += raster.all[index]; first += raster.first[index];
        if (!raster.all[index]) emptyInner++;
        if (Number.isNaN(pitFree.values[index])) voidInner++;
      }
    }
    const area = n * grid.sampleSpacingMetres ** 2;
    return { cells: n, squareMetres: area, allReturnsPerSquareMetre: round(all / area), firstReturnsPerSquareMetre: round(first / area), emptyCellFraction050: round(emptyInner / n, 4), voidFractionAfterPitFree: round(voidInner / n, 5) };
  })();
  const empty1m = (() => { let e = 0, n = 0; for (let row = 0; row < ground1.height; row++) { const nn = ground1.maxNorthing - row - 0.5; if (nn < inner.minNorthing || nn > inner.maxNorthing) continue; for (let column = 0; column < ground1.width; column++) { const ee = ground1.minEasting + column + 0.5; if (ee < inner.minEasting || ee > inner.maxEasting) continue; n++; if (!legacy.allReturns[row * ground1.width + column]) e++; } } return round(e / n, 4); })();
  const evidence = {
    schemaVersion: 1,
    kind: 'pilot-canopy-rasters',
    groundId: ctx.groundId,
    reviewId: ctx.config.reviewId,
    builtFrom: { laserCampaigns: ctx.config.laser.campaigns, laserCampaignsSha256: sha256File(campaignsPath), items: itemEvidence },
    windowEpsg3006: bbox,
    innerWindowEpsg3006: [inner.minEasting, inner.minNorthing, inner.maxEasting, inner.maxNorthing],
    points: { total: count, noiseDropped: noise, clippedAbove60m: clipped, unreferenced },
    innerDensity: { ...innerCells, emptyCellFraction100: empty1m },
    pitFree: { parameters: PIT_FREE_DEFAULTS, layers: pitFree.layers, pitCellsFilled: pitFree.pitCellsFilled, emptyCells050: emptyCells, voidCells050: voidCells },
    groundCheck: {
      statement: 'cloud ground (mean of class 2/9 returns per 1 m cell, measured cells only) minus the published RH2000 terrain the app draws, inner window, every measured cell',
      publishedGroundManifest: groundManifestUrl,
      samples: signed.length,
      medianMetres: round(quantile(signed, 0.5)),
      meanMetres: round(signed.reduce((a, b) => a + b, 0) / Math.max(1, signed.length)),
      p05Metres: round(quantile(signed, 0.05)),
      p95Metres: round(quantile(signed, 0.95)),
      absoluteMedianMetres: round(quantile(absolute, 0.5)),
      absoluteP95Metres: round(quantile(absolute, 0.95)),
      absoluteP99Metres: round(quantile(absolute, 0.99)),
    },
    files,
    elapsedSeconds: round((performance.now() - started) / 1000, 1),
  };
  fs.mkdirSync(ctx.paths.reviewDir, { recursive: true });
  const evidencePath = ctx.reviewFile('canopy-rasters.json');
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ innerDensity: evidence.innerDensity, pitFree: { layers: evidence.pitFree.layers, pitCellsFilled: evidence.pitFree.pitCellsFilled }, groundCheck: evidence.groundCheck, elapsedSeconds: evidence.elapsedSeconds }, null, 1));
  const terrain = terrainVerdict(evidence.groundCheck);
  const rasterFiles = Object.values(files).map(f => path.resolve(ctx.root, f.file));
  writeReceipt(ctx, 'canopy', { inputs: [campaignsPath, ...copcFiles], outputs: [evidencePath, ...rasterFiles, pointFile], result: { innerDensity: evidence.innerDensity, groundCheck: evidence.groundCheck, terrain } });
  if (terrain.stop) return { status: 'stop', message: `terrain revision? ${terrain.reason}. Stop and ask the owner: the tree bases sample the published terrain, and a terrain change is a separate reviewed source revision.` };
  return { status: 'done', message: `pit-free CHM ${grid.width} x ${grid.height} at ${grid.sampleSpacingMetres} m; ${evidence.innerDensity.firstReturnsPerSquareMetre} first returns/m2; cloud ground against the published terrain |p95| ${evidence.groundCheck.absoluteP95Metres} m` };
}

/** Whether the laser ground and the published terrain disagree enough to stop for a terrain revision. */
export function terrainVerdict(groundCheck) {
  const median = Math.abs(groundCheck.medianMetres ?? 0);
  const p95 = groundCheck.absoluteP95Metres;
  if (!(groundCheck.samples > 0)) return { stop: true, reason: 'no measured ground cell to compare with the published terrain' };
  if (median > TERRAIN_STOP.absoluteMedianMetres) return { stop: true, reason: `the cloud ground sits ${groundCheck.medianMetres} m from the published terrain (median; limit ${TERRAIN_STOP.absoluteMedianMetres} m)` };
  if (!(p95 <= TERRAIN_STOP.absoluteP95Metres)) return { stop: true, reason: `|cloud ground - published terrain| p95 is ${p95} m (limit ${TERRAIN_STOP.absoluteP95Metres} m)` };
  return { stop: false, reason: null };
}
