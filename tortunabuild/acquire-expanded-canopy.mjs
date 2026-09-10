/* Expand the measured Tortuna surroundings without changing retained cells.
 * node --env-file=../olovs-hemsida/.env tortunabuild/acquire-expanded-canopy.mjs
 * --plan inspects the complete hierarchy and budgets distinct compressed nodes.
 * Original four rasters and the native DTM remain unchanged. Private cache only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authorizationHeaders, lantmaterietCredentials } from '../packages/course-geo/acquisition/credentials.mjs';
import { openItem, readWindow, createNodeCache, nodesForWindow, nodeKey } from '../packages/course-geo/copc-reader/copc-window.mjs';
import { gridSpec, groundGrid, fillGround, smoothGround, canopyHeightModel, blitInterior, windowStatistics } from '../packages/course-geo/copc-reader/canopy-build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'tortunabuild/cache/expanded-canopy';
const RECEIPT = 'geo_data/course-v2/tortuna/vegetation/expanded-canopy-evidence.json';
const ORIGINAL_RECEIPT = 'geo_data/course-v2/tortuna/vegetation/canopy-evidence.json';
const SOURCE_SHA = '4354289e6e6e5c0e42188f62bda0400997e121704dc85a98d88e68b231508b45';
const SOURCE_BYTES = 930359431;
const TRANSFER_CAP = 180_000_000;
const ORIGINAL_PINS = {
  chm: 'f7648dd78beb6f34afc9a76702c64f6e72c5d444975f1677801bcb61c3d33e76',
  ground: 'c2b6e8626b87c12f2d4be314e6739ac82536351fa23c673eea2426eb6687fb05',
  allReturns: '5cad68a3d0b79f8f363b93f11fe9e7e7afffad85b09579cfe72bdf70dd8482ae',
  firstReturns: '9d496c47ab2f254d2eb73d4a1e10f5d2c90327b54bee83e071cf79bdf2930868',
};
const target = gridSpec({ minEasting: 596120.5, maxNorthing: 6616435.5, width: 2560, height: 3072 });
const originalGrid = gridSpec({ minEasting: 596632.5, maxNorthing: 6616179.5, width: 1536, height: 2560 });
const tileMetres = 256, halo = 64;
const hash = data => createHash('sha256').update(data).digest('hex');
const read = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const writeJson = (relative, value) => fs.writeFileSync(path.join(ROOT, relative), JSON.stringify(value, null, 2) + '\n');
const identity = relative => { const bytes = fs.readFileSync(path.join(ROOT, relative)); return { path: relative, bytes: bytes.length, sha256: hash(bytes) }; };
const codeIdentity = relative => ({ path: relative, sha256LfNormalized: hash(fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n')) });

function verifyOriginal() {
  const evidence = read(ORIGINAL_RECEIPT);
  if (evidence.source.id !== '21c035-661_59' || evidence.source.assets.data.sha256 !== SOURCE_SHA ||
      JSON.stringify(evidence.grid) !== JSON.stringify(originalGrid) || evidence.tiles !== 60) throw new Error('Original canopy source/grid changed');
  const buffers = {};
  for (const [layer, sha] of Object.entries(ORIGINAL_PINS)) {
    const file = evidence.files[layer];
    const bytes = fs.readFileSync(path.join(ROOT, file.data));
    if (file.sha256 !== sha || bytes.length !== 1536 * 2560 * 4 || hash(bytes) !== sha) throw new Error('Original canopy bytes changed');
    buffers[layer] = bytes;
  }
  return { evidence, buffers };
}

function encodeFloat32(values) {
  const bytes = Buffer.allocUnsafe(values.length * 4);
  values.forEach((value, index) => bytes.writeFloatLE(value, index * 4));
  return bytes;
}

async function main() {
  if (process.argv.slice(2).some(arg => arg !== '--plan')) throw new Error('Unsupported argument');
  const { evidence: original, buffers: originals } = verifyOriginal();
  const source = read('geo_data/course-v2/tortuna/acquisition/d2-discovery.json').laser.items.find(item => item.id === '21c035-661_59');
  if (source?.assets.data.sha256 !== SOURCE_SHA || source.assets.data.bytes !== SOURCE_BYTES || source.projCode !== 'EPSG:5845') throw new Error('Pinned laser source changed');
  const headers = authorizationHeaders(lantmaterietCredentials());
  if (!headers.Authorization) throw new Error('Existing Lantmateriet access required');
  const head = await fetch(source.assets.data.href, { method: 'HEAD', headers, redirect: 'error', signal: AbortSignal.timeout(60000) });
  if (head.status !== 200 || Number(head.headers.get('content-length')) !== SOURCE_BYTES) throw new Error('Source byte identity differs');
  const etag = head.headers.get('etag');
  let requestedBytes = 0;
  const boundedFetch = async (url, options) => {
    const range = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range || '');
    if (!range) throw new Error('Only bounded range reads are allowed');
    requestedBytes += Number(range[2]) - Number(range[1]) + 1;
    if (requestedBytes > TRANSFER_CAP) throw new Error('Bounded source transfer cap exceeded');
    return fetch(url, { ...options, redirect: 'error' });
  };
  const opened = await openItem({ url: source.assets.data.href, headers, fetchImpl: boundedFetch, timeoutMs: 60000 });
  if (opened.header.pointCount !== source.pointCount) throw new Error('Source hierarchy/header count differs');
  const windows = [], distinct = new Map();
  for (let row = 0; row < 12; row++) for (let col = 0; col < 10; col++) {
    if (col >= 2 && col < 8 && row >= 1 && row < 11) continue;
    const west = target.minEasting + col * tileMetres, north = target.maxNorthing - row * tileMetres;
    const bbox = [west, north - tileMetres, west + tileMetres, north];
    const window = [west - halo, north - tileMetres - halo, west + tileMetres + halo, north + halo];
    const grid = gridSpec({ minEasting: window[0], maxNorthing: window[3], width: 384, height: 384 });
    for (const entry of nodesForWindow(opened.dataBounds, opened.entries, window)) distinct.set(nodeKey(entry), entry);
    windows.push({ id: `tortuna-expanded/${col}/${row}`, col, row, bbox, window, grid });
  }
  if (windows.length !== 60) throw new Error('Unexpected new tile count');
  const plan = { schemaVersion: 1, groundId: 'tortuna', grid: target, originalGrid, newTiles: windows.length, retainedTiles: 60,
    sourceId: source.id, sourceSha256: SOURCE_SHA, etag, haloMetres: halo, transferCapBytes: TRANSFER_CAP,
    distinctNodes: distinct.size, distinctCompressedNodeBytes: [...distinct.values()].reduce((n, entry) => n + entry.byteSize, 0),
    distinctDecodedPoints: [...distinct.values()].reduce((n, entry) => n + entry.pointCount, 0),
    hierarchyTransferBytes: opened.transfer.bytes,
    algorithmInputs: ['packages/course-geo/copc-reader/canopy-build.mjs', 'packages/course-geo/copc-reader/copc-window.mjs', 'packages/course-geo/copc-reader/copc-nodes.mjs'].map(codeIdentity) };
  fs.mkdirSync(path.join(ROOT, OUT, 'tiles'), { recursive: true });
  writeJson(`${OUT}/acquisition-plan.json`, plan);
  console.log(JSON.stringify({ state: 'bounded-expansion-planned', newTiles: 60, retainedTiles: 60, distinctCompressedBytes: plan.distinctCompressedNodeBytes,
    decodedPoints: plan.distinctDecodedPoints, transferCapBytes: TRANSFER_CAP }), '\n');
  if (process.argv.includes('--plan')) return;
  if (plan.distinctCompressedNodeBytes + opened.transfer.bytes > TRANSFER_CAP) throw new Error('Required source nodes exceed declared acquisition cap');
  const planHash = hash(JSON.stringify(plan));
  const rasters = Object.fromEntries(Object.keys(ORIGINAL_PINS).map(layer => [layer, new Float32Array(target.width * target.height).fill(NaN)]));
  const cache = createNodeCache({ maxPoints: 16_000_000 });
  const perTile = [];
  for (const w of windows) {
    const checkpoint = `${OUT}/tiles/${w.col}-${w.row}.json`;
    let record;
    if (fs.existsSync(path.join(ROOT, checkpoint))) {
      record = read(checkpoint);
      if (record.planHash !== planHash || JSON.stringify(record.bbox) !== JSON.stringify(w.bbox)) throw new Error('Retained expansion tile plan differs');
      for (const [layer, file] of Object.entries(record.files)) {
        const bytes = fs.readFileSync(path.join(ROOT, file.path));
        if (bytes.length !== 256 * 256 * 4 || hash(bytes) !== file.sha256) throw new Error('Retained expansion tile bytes differ');
        const values = Float32Array.from({ length: 256 * 256 }, (_, index) => bytes.readFloatLE(index * 4));
        const interiorGrid = gridSpec({ minEasting: w.bbox[0], maxNorthing: w.bbox[3], width: 256, height: 256 });
        if (blitInterior(values, interiorGrid, rasters[layer], target, w.bbox) !== 65536) throw new Error('Cached tile copy failed');
      }
    } else {
      const measuredWindow = await readWindow(opened, w.window, { cache });
      if (!measuredWindow.statistics.nodeCountsExact) throw new Error('Source node counts not exact');
      const measured = groundGrid(w.grid, measuredWindow.points);
      const filled = fillGround(w.grid, measured.mean, { radiusCells: 60 });
      const ground = smoothGround(w.grid, filled.ground);
      const model = canopyHeightModel(w.grid, measuredWindow.points, ground);
      const interior = [];
      for (let row = halo; row < halo + 256; row++) for (let col = halo; col < halo + 256; col++) interior.push(row * w.grid.width + col);
      record = { id: w.id, bbox: w.bbox, haloBbox: w.window, planHash, points: measuredWindow.points.count,
        nodeStatistics: measuredWindow.statistics, statistics: windowStatistics(w.grid, model, { interior }), files: {}, acquisition: 'new-bounded-source-window' };
      for (const [layer, values] of Object.entries({ chm: model.chm, ground,
        allReturns: Float32Array.from(model.allReturns), firstReturns: Float32Array.from(model.firstReturns) })) {
        if (blitInterior(values, w.grid, rasters[layer], target, w.bbox) !== 65536) throw new Error('New canopy interior copy is incomplete');
        const localValues = Float32Array.from(interior, index => values[index]);
        const bytes = encodeFloat32(localValues);
        const file = `${OUT}/tiles/${w.col}-${w.row}-${layer}.f32`;
        fs.writeFileSync(path.join(ROOT, file), bytes);
        record.files[layer] = { path: file, bytes: bytes.length, sha256: hash(bytes) };
      }
      writeJson(checkpoint, record);
    }
    perTile.push(record);
    console.log(JSON.stringify({ completedNewTiles: perTile.length, newTiles: 60, retainedOriginalTiles: 60, voidFraction: record.statistics.voidFraction, transferBytes: opened.transfer.bytes }));
  }
  const files = {}, overlap = {};
  for (const [layer, values] of Object.entries(rasters)) {
    const bytes = encodeFloat32(values);
    const recovered = Buffer.alloc(originals[layer].length);
    // Raw row copies preserve every original float bit, including NaN payloads.
    for (let row = 0; row < 2560; row++) {
      const start = ((row + 256) * target.width + 512) * 4;
      originals[layer].copy(bytes, start, row * 1536 * 4, (row + 1) * 1536 * 4);
      bytes.copy(recovered, row * 1536 * 4, start, start + 1536 * 4);
    }
    if (!recovered.equals(originals[layer])) throw new Error('Original overlap changed');
    const data = `${OUT}/${layer}.f32`, sidecar = `${OUT}/${layer}.json`;
    fs.writeFileSync(path.join(ROOT, data), bytes);
    writeJson(sidecar, { width: target.width, height: target.height, originEasting: target.minEasting + .5,
      originNorthing: target.maxNorthing - .5, sampleSpacingMetres: 1, format: 'float32-le', noData: null,
      groundId: 'tortuna', campaignId: source.id, coordinateMeaning: 'cell centres; extent edges are half a metre outside these centres',
      layer, measure: layer === 'chm' ? 'height-above-cloud-ground-metres' : layer === 'ground' ? 'RH2000-metres' : 'returns-per-square-metre' });
    files[layer] = { data, sidecar, sha256: hash(bytes), bytes: bytes.length };
    overlap[layer] = { source: original.files[layer].data, sourceSha256: ORIGINAL_PINS[layer], extractedSha256: hash(recovered),
      preservedByteForByte: true, preservedBytes: recovered.length, offsetColumns: 512, offsetRows: 256, width: 1536, height: 2560 };
  }
  verifyOriginal();
  const retained = original.perTile.map(tile => ({ ...tile, id: `tortuna-expanded/${Number(tile.id.split('/')[1]) + 2}/${Number(tile.id.split('/')[2]) + 1}`,
    originalTileId: tile.id, acquisition: 'original-raster-bytes-retained' }));
  const receipt = { schemaVersion: 1, groundId: 'tortuna', observedOn: new Date().toISOString().slice(0, 10), state: 'canopy-rasters-built',
    source, sourceEtag: etag, grid: target, haloMetres: halo, tiles: 120, newlyAcquiredTiles: 60, retainedOriginalTiles: 60,
    files, originalOverlap: overlap, originalEvidence: identity(ORIGINAL_RECEIPT), originalGrid,
    perTile: [...retained, ...perTile], transfer: opened.transfer, plan, fullSourceSha256Verified: false,
    method: 'Original 60 tiles copied byte-for-byte; 60 additional count-checked COPC windows use the identical class 2/9 ground, 60 m nearest fill, 3x3 smoothing and maximum non-noise height above cloud ground. No-return cells remain unknown.',
    limitations: ['April 2021 canopy is dated evidence; current clearing, building and playing-surface exclusions remain separately reviewed.',
      'Canopy cells are not surveyed stems or verified species.', 'Ground layer is cloud-derived canopy reference, not a replacement for the frozen native DTM.',
      'The complete 930359431-byte asset hash was not recomputed; bounded source counts, catalogue identity, ETag and output hashes are retained.'] };
  writeJson(RECEIPT, receipt);
  console.log(JSON.stringify({ state: receipt.state, tiles: 120, transferBytes: opened.transfer.bytes, files, overlapPreserved: true }));
}

main().catch(error => { console.error(`Tortuna expanded canopy failed: ${error.name} ${error.code || ''}`); process.exitCode = 1; });
