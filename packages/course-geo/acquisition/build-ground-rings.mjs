#!/usr/bin/env node
/* Read the nested resolution rings of a ground from Lantmäteriet's DTM COGs
   (authenticated range requests, no whole-item download) into raw Float32
   rasters on each level's own lattice, and record what was read.

   node --env-file=.env packages/course-geo/acquisition/build-ground-rings.mjs [--ground puttom] [--only 1,2]

   Level 0 (the course) is read at 1 m and compared sample for sample with
   the published tiles, which is the proof that this reader and the CI
   extraction see the same source. Level 1 is the 1 m data subsampled at
   even positions, so its samples coincide exactly with the course tiles
   along their shared edge. Coarser levels read the COG's own overviews,
   which Lantmäteriet averaged, resampled bilinearly onto the ring lattice.
   Rasters go to packages/course-geo/toolchain/.cache/acquisition/<ground>-ground-rings/
   (gitignored); the evidence file is committed.                              */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { basicAuthorization, httpRange, openCog } from '../cog/cog-reader.mjs';
import { lantmaterietCredentials } from './credentials.mjs';
import { PUTTOM_GROUND_RINGS, dtmItemsFor, ringLevelExtent } from '../../course-v2/puttom-ground-rings.mjs';
import { readChunk } from '../../course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../../course-v2/terrain-grid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RINGS = { puttom: PUTTOM_GROUND_RINGS };

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const groundId = arg('--ground', 'puttom');
const spec = RINGS[groundId];
if (!spec) throw new Error(`no ring specification for ground ${groundId}`);
const only = arg('--only') ? new Set(arg('--only').split(',').map(Number)) : null;
const cacheDir = path.resolve(ROOT, 'packages/course-geo/toolchain/.cache/acquisition', `${groundId}-ground-rings`);
const evidencePath = path.resolve(ROOT, `geo_data/course-v2/${groundId}/acquisition/ground-rings.json`);
fs.mkdirSync(cacheDir, { recursive: true });

const credentials = lantmaterietCredentials(process.env);
const authorization = credentials.bearer
  ? `Bearer ${credentials.bearer}`
  : basicAuthorization(credentials.username, credentials.password);
const startedAt = Date.now();
const openItems = new Map();
const itemEvidence = new Map();

async function openItem(item) {
  if (openItems.has(item.id)) return openItems.get(item.id);
  const head = await fetch(item.href, { method: 'HEAD', headers: { Authorization: authorization }, signal: AbortSignal.timeout(60_000) });
  if (!head.ok) throw new Error(`HEAD ${item.href} returned HTTP ${head.status}`);
  const range = httpRange(item.href, { authorization });
  const cog = await openCog(range);
  if (cog.epsg !== 3006) throw new Error(`${item.id} is not EPSG:3006`);
  if (Math.abs(cog.originX - item.minEasting) > 1e-6 || Math.abs(cog.originY - item.maxNorthing) > 1e-6) {
    throw new Error(`${item.id} origin ${cog.originX},${cog.originY} is not the item square`);
  }
  const opened = { item, cog, range };
  openItems.set(item.id, opened);
  itemEvidence.set(item.id, {
    id: item.id,
    href: item.href,
    etag: head.headers.get('etag'),
    contentLength: Number(head.headers.get('content-length')),
    lastModified: head.headers.get('last-modified'),
    overviews: cog.levels.map(level => level.factor),
    noData: cog.noData,
    levelsUsed: [],
  });
  return opened;
}

/* Fill a level raster from every item it touches. At factor 1 samples are
   pixel centres and copied exactly; at coarser factors the level lattice
   does not coincide with the overview's pixel centres and is read
   bilinearly, clamped at each item's edge. */
async function readLevel(level) {
  const extent = ringLevelExtent(level, spec.tileSegments);
  const size = extent.size;
  const values = new Float32Array(size * size).fill(Number.NaN);
  const items = dtmItemsFor(level, { tileSegments: spec.tileSegments, itemMetres: spec.dtm.itemMetres });
  let requests = 0, bytes = 0;
  for (const item of items) {
    const opened = await openItem(item);
    const { cog, range } = opened;
    const factor = level.source.factor;
    /* an item may stop its overview chain early (the coast item is small);
       the finest overview no coarser than the level is then read bilinearly */
    const cogLevel = cog.levelForFactor(factor) ||
      [...cog.levels].filter(candidate => candidate.factor <= factor).sort((a, b) => b.factor - a.factor)[0];
    if (!cogLevel || (factor === 1 && cogLevel.factor !== 1)) throw new Error(`${item.id} has no usable overview for ${factor}x`);
    itemEvidence.get(item.id).levelsUsed.push({ lod: level.lod, overviewFactor: cogLevel.factor });
    /* the part of the level lattice inside this item */
    const step = level.sampleSpacingMetres;
    const c0 = Math.max(0, Math.ceil((item.minEasting - extent.minEasting) / step - 1e-9));
    const c1 = Math.min(size - 1, Math.floor((item.maxEasting - extent.minEasting) / step - 1e-9));
    const r0 = Math.max(0, Math.ceil((extent.maxNorthing - item.maxNorthing) / step - 1e-9));
    const r1 = Math.min(size - 1, Math.floor((extent.maxNorthing - item.minNorthing) / step - 1e-9));
    if (c1 < c0 || r1 < r0) continue;
    const before = range.transfer.bytes, beforeRequests = range.transfer.requests;
    if (cogLevel.factor === 1 && factor === 1) {
      /* level samples ARE pixel centres (x.5), `subsample` pixels apart */
      const pixelColumn0 = Math.round((extent.minEasting + c0 * step) - item.minEasting - 0.5);
      const pixelRow0 = Math.round(item.maxNorthing - (extent.maxNorthing - r0 * step) - 0.5);
      const columns = c1 - c0 + 1, rows = r1 - r0 + 1;
      const window = await cogLevel.readWindow({ column0: pixelColumn0, row0: pixelRow0, columns, rows, step: level.source.subsample });
      for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) values[(r0 + r) * size + c0 + c] = window[r * columns + c];
    } else {
      /* overview pixel centres sit at item origin + factor * (index + 0.5) */
      const read = cogLevel.factor;
      const px = e => (e - item.minEasting) / read - 0.5;
      const py = n => (item.maxNorthing - n) / read - 0.5;
      const pc0 = Math.max(0, Math.floor(px(extent.minEasting + c0 * step)));
      const pc1 = Math.min(cogLevel.width - 1, Math.ceil(px(extent.minEasting + c1 * step)));
      const pr0 = Math.max(0, Math.floor(py(extent.maxNorthing - r0 * step)));
      const pr1 = Math.min(cogLevel.height - 1, Math.ceil(py(extent.maxNorthing - r1 * step)));
      const columns = pc1 - pc0 + 1, rows = pr1 - pr0 + 1;
      const window = await cogLevel.readWindow({ column0: pc0, row0: pr0, columns, rows });
      const at = (c, r) => window[(Math.min(rows - 1, Math.max(0, r)) * columns) + Math.min(columns - 1, Math.max(0, c))];
      for (let r = r0; r <= r1; r++) {
        const y = py(extent.maxNorthing - r * step) - pr0;
        const north = Math.floor(y), ty = y - north;
        for (let c = c0; c <= c1; c++) {
          const x = px(extent.minEasting + c * step) - pc0;
          const west = Math.floor(x), tx = x - west;
          const a = at(west, north), b = at(west + 1, north), d = at(west, north + 1), e = at(west + 1, north + 1);
          let value;
          if ([a, b, d, e].every(Number.isFinite)) value = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
          else value = [a, b, d, e].find(Number.isFinite) ?? Number.NaN;
          values[r * size + c] = value;
        }
      }
    }
    bytes += range.transfer.bytes - before;
    requests += range.transfer.requests - beforeRequests;
    cogLevel.dropCache();
  }
  let finite = 0, minimum = Infinity, maximum = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    finite++;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return { extent, size, values, items: items.map(item => item.id), finite, minimum, maximum, requests, bytes };
}

function publishedCourseTiles() {
  const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public/courses/v2-index.json'), 'utf8'));
  const entry = root.courses.find(course => course.groundId === groundId);
  const course = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public', entry.manifest.url), 'utf8'));
  const ground = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/golf/public', course.groundManifest.url), 'utf8'));
  return ground.tiles.filter(tile => tile.lod === 0).map(tile => {
    const chunk = readChunk(fs.readFileSync(path.join(ROOT, 'apps/golf/public', tile.layers.terrain.url)));
    return { id: tile.id, bounds: tile.bounds, grid: chunk.header.grid, heights: decodeTerrainGrid(chunk.payload, chunk.header.grid) };
  });
}

function compareWithPublished(level, read) {
  const tiles = publishedCourseTiles();
  let samples = 0, withinQuantum = 0, maximumDifference = 0;
  for (const tile of tiles) {
    const quantum = tile.grid.heightScaleMetres / 2 + 1e-6;
    for (let row = 0; row < tile.grid.height; row++) {
      const northing = tile.bounds.maxNorthing - row * tile.grid.sampleSpacingMetres;
      const levelRow = Math.round((read.extent.maxNorthing - northing) / level.sampleSpacingMetres);
      for (let column = 0; column < tile.grid.width; column++) {
        const easting = tile.bounds.minEasting + column * tile.grid.sampleSpacingMetres;
        const levelColumn = Math.round((easting - read.extent.minEasting) / level.sampleSpacingMetres);
        const a = tile.heights[row * tile.grid.width + column];
        const b = read.values[levelRow * read.size + levelColumn];
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        samples++;
        const difference = Math.abs(a - b);
        if (difference > maximumDifference) maximumDifference = difference;
        if (difference <= quantum) withinQuantum++;
      }
    }
  }
  return { tiles: tiles.length, samples, withinQuantum, maximumDifferenceMetres: maximumDifference };
}

const levelEvidence = [];
for (const level of spec.levels) {
  if (only && !only.has(level.lod)) continue;
  const t0 = Date.now();
  const read = await readLevel(level);
  const gate = spec.coverageGate;
  if (gate.requireEverySampleFinite && read.finite !== read.size * read.size) {
    throw new Error(`level ${level.lod} has ${read.size * read.size - read.finite} non-finite samples`);
  }
  if (read.minimum < gate.minimumHeightRH2000 || read.maximum > gate.maximumHeightRH2000) {
    throw new Error(`level ${level.lod} heights ${read.minimum}..${read.maximum} leave the reviewed band`);
  }
  const dataPath = path.join(cacheDir, `l${level.lod}.f32`);
  fs.writeFileSync(dataPath, Buffer.from(read.values.buffer));
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(dataPath)).digest('hex');
  const sidecar = {
    groundId, lod: level.lod, sampleSpacingMetres: level.sampleSpacingMetres, tilesPerSide: level.tilesPerSide,
    tileSegments: spec.tileSegments, originEasting: level.originEasting, originNorthing: level.originNorthing,
    width: read.size, height: read.size, heightScaleMetres: level.heightScaleMetres, source: level.source,
    items: read.items, minimumHeightRH2000: read.minimum, maximumHeightRH2000: read.maximum, finite: read.finite, sha256,
  };
  fs.writeFileSync(path.join(cacheDir, `l${level.lod}.json`), JSON.stringify(sidecar, null, 2) + '\n');
  const entry = {
    lod: level.lod, sampleSpacingMetres: level.sampleSpacingMetres, tilesPerSide: level.tilesPerSide,
    extent: read.extent, source: level.source, items: read.items, samples: read.size * read.size, finite: read.finite,
    minimumHeightRH2000: read.minimum, maximumHeightRH2000: read.maximum, requests: read.requests, bytes: read.bytes,
    elapsedSeconds: (Date.now() - t0) / 1000, rasterSha256: sha256,
  };
  if (level.source.kind === 'published-and-dtm') entry.publishedAgreement = compareWithPublished(level, read);
  levelEvidence.push(entry);
  console.log(JSON.stringify({ lod: level.lod, spacing: level.sampleSpacingMetres, size: read.size, items: read.items, min: +read.minimum.toFixed(2), max: +read.maximum.toFixed(2), requests: read.requests, mb: +(read.bytes / 1e6).toFixed(1), s: entry.elapsedSeconds, published: entry.publishedAgreement }));
}

const evidence = {
  kind: 'ground-rings',
  groundId,
  observedOn: new Date().toISOString().slice(0, 10),
  provider: { name: 'Lantmäteriet', collection: spec.dtm.collection, authenticated: true, credentialsSerialized: false, licence: 'CC BY 4.0', attribution: 'Markhöjdmodell Nedladdning, © Lantmäteriet, bearbetad, CC BY 4.0' },
  tileSegments: spec.tileSegments,
  levels: levelEvidence,
  items: [...itemEvidence.values()],
  overviewResampling: 'the COG overviews are block averages (measured: 2x overview vs 1 m block mean, mean |diff| 0.08 m), so level 1 is subsampled from the 1 m data and levels 2 and up read the overviews',
  elapsedSeconds: (Date.now() - startedAt) / 1000,
};
const previous = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : null;
if (only && previous) {
  /* a partial run refreshes only the levels it read */
  const kept = (previous.levels || []).filter(level => !only.has(level.lod));
  evidence.levels = [...kept, ...levelEvidence].sort((a, b) => a.lod - b.lod);
  evidence.items = [...new Map([...(previous.items || []), ...evidence.items].map(item => [item.id, item])).values()];
}
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
console.log('wrote', path.relative(ROOT, evidencePath), 'levels', evidence.levels.length, 'items', evidence.items.length, 'elapsed s', evidence.elapsedSeconds);
