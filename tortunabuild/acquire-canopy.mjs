/* Bounded 2021 Tortuna COPC acquisition, using the shared count-checked reader.
 * Run in the credentialed source workflow; no point-cloud bytes are published. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authorizationHeaders, lantmaterietCredentials } from '../packages/course-geo/acquisition/credentials.mjs';
import { openItem, readWindow, createNodeCache } from '../packages/course-geo/copc-reader/copc-window.mjs';
import { gridSpec, groundGrid, fillGround, smoothGround, canopyHeightModel, blitInterior, windowStatistics } from '../packages/course-geo/copc-reader/canopy-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
const target = gridSpec({ minEasting: 596632.5, maxNorthing: 6616179.5, width: 1536, height: 2560 });
const tileMetres = 256, halo = 64;
const OUT = path.join(ROOT, 'tortunabuild/cache/canopy');

async function main() {
  const discovery = read('geo_data/course-v2/tortuna/acquisition/d2-discovery.json');
  const item = discovery.laser.items.find(i => i.id === '21c035-661_59');
  if (item?.assets.data.sha256 !== '4354289e6e6e5c0e42188f62bda0400997e121704dc85a98d88e68b231508b45' ||
      item.assets.data.bytes !== 930359431 || item.projCode !== 'EPSG:5845') throw new Error('Pinned Tortuna laser identity changed');
  const headers = authorizationHeaders(lantmaterietCredentials());
  if (!headers.Authorization) throw new Error('Lantmäteriet credentials missing');
  const opened = await openItem({ url: item.assets.data.href, headers });
  if (opened.header.pointCount !== item.pointCount) throw new Error('LAS and STAC point counts differ');
  const rasters = Object.fromEntries(['chm', 'ground', 'allReturns', 'firstReturns'].map(k =>
    [k, new Float32Array(target.width * target.height).fill(NaN)]));
  const cache = createNodeCache(), perTile = [];
  for (let row = 0; row < 10; row++) for (let col = 0; col < 6; col++) {
    const west = target.minEasting + col * tileMetres, north = target.maxNorthing - row * tileMetres;
    const bbox = [west, north - tileMetres, west + tileMetres, north];
    const window = [west - halo, north - tileMetres - halo, west + tileMetres + halo, north + halo];
    const grid = gridSpec({ minEasting: window[0], maxNorthing: window[3], width: 384, height: 384 });
    const read = await readWindow(opened, window, { cache });
    const measured = groundGrid(grid, read.points);
    const filled = fillGround(grid, measured.mean, { radiusCells: 60 });
    const ground = smoothGround(grid, filled.ground);
    const model = canopyHeightModel(grid, read.points, ground);
    const interior = [];
    for (let r = halo; r < halo + tileMetres; r++) for (let c = halo; c < halo + tileMetres; c++) interior.push(r * grid.width + c);
    for (const [key, values] of Object.entries({ chm: model.chm, ground,
      allReturns: Float32Array.from(model.allReturns), firstReturns: Float32Array.from(model.firstReturns) })) {
      if (blitInterior(values, grid, rasters[key], target, bbox) !== tileMetres ** 2) throw new Error('Canopy interior copy is incomplete');
    }
    const stats = windowStatistics(grid, model, { interior });
    perTile.push({ id: `tortuna/${col}/${row}`, bbox, points: read.points.count, statistics: stats });
    console.log(JSON.stringify({ tile: perTile.length, total: 60, voidFraction: stats.voidFraction, transferBytes: opened.transfer.bytes }));
  }
  fs.mkdirSync(OUT, { recursive: true });
  const files = {};
  for (const [layer, values] of Object.entries(rasters)) {
    const data = `tortunabuild/cache/canopy/${layer}.f32`, sidecar = `tortunabuild/cache/canopy/${layer}.json`;
    const bytes = Buffer.allocUnsafe(values.length * 4);
    values.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
    fs.writeFileSync(path.join(ROOT, data), bytes);
    fs.writeFileSync(path.join(ROOT, sidecar), JSON.stringify({ width: target.width, height: target.height,
      originEasting: target.minEasting + .5, originNorthing: target.maxNorthing - .5,
      sampleSpacingMetres: 1, format: 'float32-le', noData: null, groundId: 'tortuna', campaignId: item.id,
      coordinateMeaning: 'cell centres; extent edges are half a metre outside these centres',
      layer, measure: layer === 'chm' ? 'height-above-cloud-ground-metres' : layer === 'ground' ? 'RH2000-metres' : 'returns-per-square-metre' }, null, 2) + '\n');
    files[layer] = { data, sidecar, sha256: hash(bytes), bytes: bytes.length };
  }
  const evidence = { schemaVersion: 1, groundId: 'tortuna', observedOn: new Date().toISOString().slice(0, 10),
    sourceCommit: process.env.GITHUB_SHA || null, state: 'canopy-rasters-built',
    source: item, grid: target, haloMetres: halo, tiles: perTile.length, files, perTile,
    transfer: opened.transfer, fullSourceSha256Verified: false,
    method: 'Complete count-checked COPC hierarchy, bounded point windows, class 2/9 ground, nearest ground fill up to 60 m, 3x3 smoothing, maximum non-noise height above cloud ground; no returns means unknown.',
    limitations: ['April 2021 canopy needs May 2026 clearing and building/surface exclusions.',
      'These are canopy cells, not surveyed stems or verified species.', 'Unknown cells must not become procedural trees.'] };
  fs.writeFileSync(path.join(ROOT, 'geo_data/course-v2/tortuna/vegetation/canopy-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
}
main().catch(error => { console.error(`Tortuna canopy failed: ${error.name}`); process.exitCode = 1; });
