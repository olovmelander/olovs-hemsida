/* Stage `acquire`: Lantmäteriet's laser and orthophotos into the ignored cache.

   Without --fetch the stage is offline: it checks the source policy and
   verifies what is cached (COPC size and SHA-256 against the pin; every
   orthophoto tile against its recorded SHA-256; each mosaic against its
   sidecar). With --fetch (run through node --env-file=<.env>) it fetches what
   is missing (from the Johannesberg pilot's fetch-copc and fetch-ortho):

   - laser: whole COPC items streamed into the cache and verified against the
     pinned size and SHA-256 before they are renamed into place; a verified
     file is never fetched again. The point cloud is personal data under the
     licence and never leaves the cache.
   - orthophotos: for each configured campaign, the STAC record, the first
     64 KiB (layout and band identity from the TIFF tags, never assumed), then
     only the tiles the halo window touches, coalesced into range requests;
     compressed tiles go into a pack with per-tile SHA-256, and a 0.32 m
     analysis mosaic is an exact 2x2 block average on the items' 0.16 m lattice.
   Nothing here prints or writes a credential.                              */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { authorizationHeaders, lantmaterietCredentials } from '../../packages/course-geo/acquisition/credentials.mjs';
import { STAC_ENDPOINTS, sha256FromStacChecksum, stacSearch } from '../../packages/course-geo/acquisition/stac.mjs';
import { safeCopcUrl } from '../../packages/course-geo/copc-reader/copc-nodes.mjs';
import { decodeTile, orthoLayout, sha256, tilesForWindow } from './ortho-store.mjs';
import { laserPolicyProblems, orthoPolicyProblems, safeOrthoUrl } from './source-policy.mjs';
import { sha256File, writeReceipt } from './receipts.mjs';

const HEAD_BYTES = 65536;
const MOSAIC_FACTOR = 2;

export function readCampaigns(ctx) {
  return JSON.parse(fs.readFileSync(path.join(ctx.root, ctx.config.laser.campaigns), 'utf8'));
}

export function copcFile(ctx, item) {
  return path.join(ctx.paths.copc, path.basename(new URL(item.assets.data.href).pathname));
}

/** Source policy for this ground; throws with every problem. */
export function assertSourcePolicy(ctx) {
  const problems = [...laserPolicyProblems(readCampaigns(ctx), ctx.config.laser.items), ...orthoPolicyProblems(ctx.config.orthophotos.campaigns)];
  if (problems.length) throw new Error(`source policy (Lantmäteriet only, never the photo-matched surface model or Skogsstyrelsen):\n  - ${problems.join('\n  - ')}`);
}

function requireCredentials() {
  const credentials = lantmaterietCredentials();
  if (!credentials) throw new Error('Lantmäteriet credentials are required: run through node --env-file=<repository .env> (never print or commit them)');
  return authorizationHeaders(credentials);
}

/* ---------------- laser ---------------- */

async function fetchLaser(ctx, headers) {
  const campaigns = readCampaigns(ctx);
  fs.mkdirSync(ctx.paths.copc, { recursive: true });
  const ledger = [];
  for (const item of campaigns.items.filter(entry => ctx.config.laser.items.includes(entry.id))) {
    const asset = item.assets.data;
    const url = safeCopcUrl(asset.href);
    const file = path.join(ctx.paths.copc, path.basename(url.pathname));
    if (fs.existsSync(file) && fs.statSync(file).size === asset.bytes && sha256File(file) === asset.sha256) {
      console.log(`${item.id}: cached and verified`);
      ledger.push({ itemId: item.id, file: ctx.rel(file), bytes: asset.bytes, sha256: asset.sha256, verified: true, fetched: false });
      continue;
    }
    const partial = `${file}.partial`;
    const started = performance.now();
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30 * 60_000) });
    if (!response.ok) throw new Error(`${item.id}: HTTP ${response.status}`);
    const out = fs.createWriteStream(partial);
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body) {
      hash.update(chunk);
      bytes += chunk.length;
      if (!out.write(chunk)) await new Promise(resolve => out.once('drain', resolve));
    }
    await new Promise((resolve, reject) => out.end(error => (error ? reject(error) : resolve())));
    const digest = hash.digest('hex');
    if (bytes !== asset.bytes || digest !== asset.sha256) {
      fs.rmSync(partial, { force: true });
      throw new Error(`${item.id}: ${bytes} bytes sha256 ${digest} does not match the pin (${asset.bytes}, ${asset.sha256})`);
    }
    fs.renameSync(partial, file);
    console.log(`${item.id}: ${(bytes / 1e6).toFixed(1)} MB in ${((performance.now() - started) / 1000).toFixed(0)} s, sha256 verified`);
    ledger.push({ itemId: item.id, file: ctx.rel(file), bytes, sha256: digest, verified: true, fetched: true });
  }
  fs.writeFileSync(path.join(ctx.paths.copc, 'ledger.json'), JSON.stringify({ campaigns: ctx.config.laser.campaigns, items: ledger }, null, 2) + '\n');
}

/* ---------------- orthophotos ---------------- */

async function range(url, headers, offset, length) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { ...headers, Range: `bytes=${offset}-${offset + length - 1}` }, redirect: 'error', signal: AbortSignal.timeout(300_000) });
    if (response.status === 206) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length !== length) throw new Error(`range returned ${buffer.length} of ${length} bytes`);
      return { buffer, total: Number((response.headers.get('content-range') || '').split('/')[1]) };
    }
    await response.body?.cancel();
    if ((response.status === 429 || response.status >= 500) && attempt < 4) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
    throw new Error(`range request returned HTTP ${response.status}`);
  }
}

async function fetchOrtho(ctx, headers, wanted) {
  const window = ctx.haloWindow;
  const bbox = [window.minEasting, window.minNorthing, window.maxEasting, window.maxNorthing];
  const ledgerPath = path.join(ctx.paths.ortho, 'ledger.json');
  fs.mkdirSync(ctx.paths.ortho, { recursive: true });
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { campaigns: {} };
  for (const campaign of ctx.config.orthophotos.campaigns.filter(c => wanted.includes(c.key))) {
    const dir = path.join(ctx.paths.ortho, campaign.key);
    fs.mkdirSync(dir, { recursive: true });
    const features = await stacSearch(STAC_ENDPOINTS.imagery, { bbox: ctx.config.orthophotos.stacSearchBboxWgs84, collections: [campaign.collection] });
    const items = [];
    const layouts = [];
    for (const itemKey of ctx.config.orthophotos.items) {
      const feature = features.find(f => f.id === `o${itemKey}_${campaign.suffix}`);
      if (!feature) throw new Error(`${campaign.collection}: item o${itemKey}_${campaign.suffix} not in the catalogue`);
      const asset = feature.assets?.data;
      const url = safeOrthoUrl(asset.href);
      const { buffer: head, total } = await range(url, headers, 0, HEAD_BYTES);
      if (Number.isFinite(asset['file:size']) && total !== asset['file:size']) throw new Error(`${feature.id}: served ${total} bytes, STAC says ${asset['file:size']}`);
      const layout = orthoLayout(head);
      const tiles = tilesForWindow(layout, bbox);
      const indexPath = path.join(dir, `${feature.id}.index.json`);
      const packPath = path.join(dir, `${feature.id}.pack`);
      let index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : null;
      if (!index || index.sourceBytes !== total || index.tiles.length !== tiles.length) {
        /* coalesce tiles that sit back to back in the file */
        const spans = [];
        for (const tile of [...tiles].sort((a, b) => layout.tileOffsets[a] - layout.tileOffsets[b])) {
          const offset = layout.tileOffsets[tile];
          const length = layout.tileByteCounts[tile];
          const last = spans.at(-1);
          if (last && last.end === offset && last.end - last.start + length < 24 << 20) { last.end += length; last.tiles.push(tile); }
          else spans.push({ start: offset, end: offset + length, tiles: [tile] });
        }
        const fd = fs.openSync(packPath, 'w');
        const entries = [];
        let packOffset = 0;
        let bytes = 0;
        for (const span of spans) {
          const { buffer } = await range(url, headers, span.start, span.end - span.start);
          for (const tile of span.tiles) {
            const start = layout.tileOffsets[tile] - span.start;
            const piece = buffer.subarray(start, start + layout.tileByteCounts[tile]);
            fs.writeSync(fd, piece, 0, piece.length, packOffset);
            entries.push({ tile, sourceOffset: layout.tileOffsets[tile], length: piece.length, packOffset, sha256: sha256(piece) });
            packOffset += piece.length;
          }
          bytes += span.end - span.start;
        }
        fs.closeSync(fd);
        entries.sort((a, b) => a.tile - b.tile);
        const { tileOffsets, tileByteCounts, ...rest } = layout;
        index = { itemId: feature.id, collection: campaign.collection, href: url.href, sourceBytes: total, layout: rest, tiles: entries, requests: spans.length, bytes };
        fs.writeFileSync(indexPath, JSON.stringify(index) + '\n');
        console.log(`${campaign.key} ${feature.id}: ${entries.length} tiles, ${(bytes / 1e6).toFixed(1)} MB in ${spans.length} requests`);
      } else {
        console.log(`${campaign.key} ${feature.id}: ${index.tiles.length} tiles cached`);
      }
      layouts.push({ feature, layout, index, packPath });
      const p = feature.properties || {};
      items.push({
        id: feature.id, collection: campaign.collection, href: url.href,
        capturedAt: p.datetime || null, captureStart: p.start_datetime || null, captureEnd: p.end_datetime || null,
        spectralType: p.spektraltyp || null, resolutionMetres: p.geometriskupplosning ?? p.upplosning ?? null,
        sourceBytes: total, stacSha256: sha256FromStacChecksum(asset['file:checksum']), bands: layout.bands,
        tiffTags: {
          photometric: layout.photometric, samplesPerPixel: layout.samplesPerPixel, bitsPerSample: layout.bitsPerSample,
          extraSamples: layout.extraSamples, planarConfiguration: layout.planarConfiguration, compression: layout.compression,
          predictor: layout.predictor, description: layout.description, software: layout.software, gdalMetadata: layout.gdalMetadata, gdalNoData: layout.gdalNoData,
        },
        lattice: { originEasting: layout.originEasting, originNorthing: layout.originNorthing, pixelMetres: layout.pixelMetres, width: layout.width, height: layout.height },
        tilesCached: index.tiles.length,
        tileHashDigest: sha256(Buffer.from(index.tiles.map(t => `${t.tile}:${t.sha256}`).join('\n'))),
      });
    }
    const mosaic = buildMosaic(layouts, bbox);
    const mosaicPath = path.join(dir, `mosaic-${campaign.key}-032.rgbi`);
    fs.writeFileSync(mosaicPath, mosaic.data);
    const sidecar = { campaign: campaign.key, collection: campaign.collection, date: campaign.date, season: campaign.season, width: mosaic.width, height: mosaic.height, minEasting: mosaic.minEasting, maxNorthing: mosaic.maxNorthing, pixelMetres: mosaic.pixelMetres, bands: ['red', 'green', 'blue', 'near-infrared'], interleave: 'pixel', validFraction: mosaic.valid / (mosaic.width * mosaic.height), sha256: sha256(Buffer.from(mosaic.data.buffer)) };
    fs.writeFileSync(mosaicPath.replace(/\.rgbi$/, '.json'), JSON.stringify(sidecar, null, 2) + '\n');
    console.log(`${campaign.key}: mosaic ${mosaic.width} x ${mosaic.height} at ${mosaic.pixelMetres} m, valid ${(100 * sidecar.validFraction).toFixed(2)}%`);
    ledger.campaigns[campaign.key] = { ...campaign, windowEpsg3006: bbox, items, mosaic: { file: ctx.rel(mosaicPath), ...sidecar } };
  }
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}

/** The 0.32 m analysis mosaic, tile by tile, exact 2x2 blocks on the shared lattice. */
function buildMosaic(layouts, bbox) {
  const base = layouts[0].layout;
  const step = base.pixelMetres * MOSAIC_FACTOR;
  const minE = base.originEasting + Math.floor((bbox[0] - base.originEasting) / step) * step;
  const maxN = base.originNorthing - Math.floor((base.originNorthing - bbox[3]) / step) * step;
  const width = Math.ceil((bbox[2] - minE) / step);
  const height = Math.ceil((maxN - bbox[1]) / step);
  const sums = new Uint32Array(width * height * 4);
  const counts = new Uint8Array(width * height);
  for (const { layout, index, packPath } of layouts) {
    const fd = fs.openSync(packPath, 'r');
    for (const entry of index.tiles) {
      const buffer = Buffer.alloc(entry.length);
      fs.readSync(fd, buffer, 0, entry.length, entry.packOffset);
      if (sha256(buffer) !== entry.sha256) throw new Error(`${index.itemId} tile ${entry.tile} fails its hash`);
      const data = decodeTile({ ...layout, compression: index.layout.compression, predictor: index.layout.predictor }, buffer);
      const tileRow = Math.floor(entry.tile / layout.tilesAcross);
      const tileColumn = entry.tile % layout.tilesAcross;
      for (let y = 0; y < layout.tileLength; y++) {
        const row = tileRow * layout.tileLength + y;
        if (row >= layout.height) break;
        const northing = layout.originNorthing - (row + 0.5) * layout.pixelMetres;
        const mr = Math.floor((maxN - northing) / step);
        if (mr < 0 || mr >= height) continue;
        for (let x = 0; x < layout.tileWidth; x++) {
          const column = tileColumn * layout.tileWidth + x;
          if (column >= layout.width) break;
          const easting = layout.originEasting + (column + 0.5) * layout.pixelMetres;
          const mc = Math.floor((easting - minE) / step);
          if (mc < 0 || mc >= width) continue;
          const m = mr * width + mc;
          if (counts[m] >= MOSAIC_FACTOR * MOSAIC_FACTOR) continue;
          const o = (y * layout.tileWidth + x) * 4;
          sums[m * 4] += data[o]; sums[m * 4 + 1] += data[o + 1]; sums[m * 4 + 2] += data[o + 2]; sums[m * 4 + 3] += data[o + 3];
          counts[m]++;
        }
      }
    }
    fs.closeSync(fd);
  }
  const data = new Uint8Array(width * height * 4);
  let valid = 0;
  for (let m = 0; m < width * height; m++) {
    if (!counts[m]) continue;
    valid++;
    for (let b = 0; b < 4; b++) data[m * 4 + b] = Math.round(sums[m * 4 + b] / counts[m]);
  }
  return { data, width, height, minEasting: minE, maxNorthing: maxN, pixelMetres: step, valid };
}

/* ---------------- offline verification ---------------- */

/** Verify the cache against the pins without touching the network. Returns { ok, problems, laser, ortho }. */
export function verifyCache(ctx) {
  const problems = [];
  const campaigns = readCampaigns(ctx);
  const laser = [];
  for (const id of ctx.config.laser.items) {
    const item = campaigns.items.find(entry => entry.id === id);
    const file = copcFile(ctx, item);
    if (!fs.existsSync(file)) { problems.push(`laser ${id}: not cached (${ctx.rel(file)})`); continue; }
    const bytes = fs.statSync(file).size;
    const digest = bytes === item.assets.data.bytes ? sha256File(file) : null;
    if (digest !== item.assets.data.sha256) problems.push(`laser ${id}: cached file does not match the pinned size and SHA-256`);
    laser.push({ itemId: id, bytes, verified: digest === item.assets.data.sha256 });
  }
  const ortho = [];
  const ledgerPath = path.join(ctx.paths.ortho, 'ledger.json');
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : null;
  if (!ledger) problems.push(`orthophoto ledger missing (${ctx.rel(ledgerPath)})`);
  for (const campaign of ctx.config.orthophotos.campaigns) {
    const entry = ledger?.campaigns?.[campaign.key];
    if (!entry) { problems.push(`orthophoto ${campaign.key}: not in the ledger`); continue; }
    if (entry.collection !== campaign.collection || entry.date !== campaign.date) problems.push(`orthophoto ${campaign.key}: the ledger records ${entry.collection} ${entry.date}, the config ${campaign.collection} ${campaign.date}`);
    let tiles = 0, bad = 0;
    for (const item of entry.items) {
      const indexPath = path.join(ctx.paths.ortho, campaign.key, `${item.id}.index.json`);
      const packPath = path.join(ctx.paths.ortho, campaign.key, `${item.id}.pack`);
      if (!fs.existsSync(indexPath) || !fs.existsSync(packPath)) { problems.push(`orthophoto ${item.id}: pack missing`); continue; }
      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (sha256(Buffer.from(index.tiles.map(t => `${t.tile}:${t.sha256}`).join('\n'))) !== item.tileHashDigest) problems.push(`orthophoto ${item.id}: tile index differs from the ledger`);
      const fd = fs.openSync(packPath, 'r');
      for (const t of index.tiles) {
        const buffer = Buffer.alloc(t.length);
        fs.readSync(fd, buffer, 0, t.length, t.packOffset);
        tiles++;
        if (sha256(buffer) !== t.sha256) bad++;
      }
      fs.closeSync(fd);
    }
    if (bad) problems.push(`orthophoto ${campaign.key}: ${bad} of ${tiles} cached tiles fail their SHA-256`);
    const mosaicPath = path.join(ctx.paths.ortho, campaign.key, `mosaic-${campaign.key}-032.rgbi`);
    const mosaicOk = fs.existsSync(mosaicPath) && sha256File(mosaicPath) === entry.mosaic.sha256;
    if (!mosaicOk) problems.push(`orthophoto ${campaign.key}: mosaic missing or not the recorded bytes`);
    ortho.push({ campaign: campaign.key, collection: campaign.collection, date: campaign.date, items: entry.items.length, tiles, badTiles: bad, mosaicVerified: mosaicOk });
  }
  return { ok: !problems.length, problems, laser, ortho };
}

export async function run(ctx, options) {
  assertSourcePolicy(ctx);
  if (options.fetch) {
    const headers = requireCredentials();
    const only = options.only || 'laser,ortho';
    if (only.includes('laser')) await fetchLaser(ctx, headers);
    if (only.includes('ortho')) await fetchOrtho(ctx, headers, (options.campaigns || ctx.config.orthophotos.campaigns.map(c => c.key).join(',')).split(','));
  }
  const verified = verifyCache(ctx);
  const campaigns = readCampaigns(ctx);
  const inputs = [path.join(ctx.root, ctx.config.laser.campaigns)];
  const outputs = [
    ...ctx.config.laser.items.map(id => copcFile(ctx, campaigns.items.find(entry => entry.id === id))),
    path.join(ctx.paths.ortho, 'ledger.json'),
    ...ctx.config.orthophotos.campaigns.map(c => path.join(ctx.paths.ortho, c.key, `mosaic-${c.key}-032.rgbi`)),
  ];
  writeReceipt(ctx, 'acquire', { inputs, outputs, options: { fetch: Boolean(options.fetch) }, result: { ok: verified.ok, laser: verified.laser, ortho: verified.ortho, problems: verified.problems } });
  if (!verified.ok) {
    return { status: 'stop', message: `the cache does not verify:\n  - ${verified.problems.join('\n  - ')}\nFetch with: node --env-file=<repository .env> tools/tree-pipeline.mjs --ground ${ctx.groundId} --stage acquire --fetch` };
  }
  return { status: 'done', message: `laser ${verified.laser.length} items and orthophotos ${verified.ortho.map(o => `${o.campaign} (${o.tiles} tiles)`).join(', ')} verified against their pins` };
}
