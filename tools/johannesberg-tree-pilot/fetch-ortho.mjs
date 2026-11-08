#!/usr/bin/env node
/* Cache the 0.16 m RGBI orthophoto tiles over the pilot window and build a
   0.32 m analysis mosaic per campaign.

   usage: node --env-file=<.env> tools/johannesberg-tree-pilot/fetch-ortho.mjs [--campaigns 2025,2021]

   For every campaign item: the STAC record (date, checksum, size), the first
   64 KiB (layout and band identity from the TIFF tags), then only the tiles
   the halo window touches, coalesced into range requests. Compressed tile
   bytes go into an ignored pack with per-tile SHA-256; the analysis mosaic is
   an exact 2x2 block average on the items' shared 0.16 m lattice. A
   credential-free ledger (items, dates, checksums, band tags, tile hashes,
   coverage) is written beside the cache for the evidence report.           */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorizationHeaders, lantmaterietCredentials } from '../../packages/course-geo/acquisition/credentials.mjs';
import { STAC_ENDPOINTS, sha256FromStacChecksum, stacSearch } from '../../packages/course-geo/acquisition/stac.mjs';
import { PILOT, haloWindow } from './pilot-config.mjs';
import { decodeTile, orthoLayout, sha256, tilesForWindow } from './ortho-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const wanted = (flag('campaigns', PILOT.orthoCampaigns.map(c => c.key).join(','))).split(',');
const HEAD_BYTES = 65536;
const MOSAIC_FACTOR = 2;

function safeOrthoUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'dl1.lantmateriet.se' || !url.pathname.startsWith('/bild/data/orto/') ||
      !url.pathname.endsWith('.tif') || url.search || url.hash || url.username || url.password) {
    throw new Error('refusing a URL that is not a Lantmäteriet orthophoto asset');
  }
  return url;
}

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

async function main() {
  const credentials = lantmaterietCredentials();
  if (!credentials) throw new Error('Lantmäteriet credentials are required');
  const headers = authorizationHeaders(credentials);
  const window = haloWindow();
  const bbox = [window.minEasting, window.minNorthing, window.maxEasting, window.maxNorthing];
  const ledgerPath = path.join(ROOT, PILOT.orthoCache, 'ledger.json');
  const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { campaigns: {} };
  for (const campaign of PILOT.orthoCampaigns.filter(c => wanted.includes(c.key))) {
    const dir = path.join(ROOT, PILOT.orthoCache, campaign.key);
    fs.mkdirSync(dir, { recursive: true });
    const features = await stacSearch(STAC_ENDPOINTS.imagery, { bbox: [18.145, 59.698, 18.24, 59.758], collections: [campaign.collection] });
    const items = [];
    const layouts = [];
    for (const itemKey of PILOT.orthoItems) {
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
        id: feature.id,
        collection: campaign.collection,
        href: url.href,
        capturedAt: p.datetime || null,
        captureStart: p.start_datetime || null,
        captureEnd: p.end_datetime || null,
        spectralType: p.spektraltyp || null,
        resolutionMetres: p.geometriskupplosning ?? p.upplosning ?? null,
        sourceBytes: total,
        stacSha256: sha256FromStacChecksum(asset['file:checksum']),
        bands: layout.bands,
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
    /* the 0.32 m analysis mosaic, tile by tile, exact 2x2 blocks on the shared lattice */
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
    const mosaic = new Uint8Array(width * height * 4);
    let valid = 0;
    for (let m = 0; m < width * height; m++) {
      if (!counts[m]) continue;
      valid++;
      for (let b = 0; b < 4; b++) mosaic[m * 4 + b] = Math.round(sums[m * 4 + b] / counts[m]);
    }
    const mosaicPath = path.join(dir, `mosaic-${campaign.key}-032.rgbi`);
    fs.writeFileSync(mosaicPath, mosaic);
    const sidecar = { campaign: campaign.key, collection: campaign.collection, date: campaign.date, season: campaign.season, width, height, minEasting: minE, maxNorthing: maxN, pixelMetres: step, bands: ['red', 'green', 'blue', 'near-infrared'], interleave: 'pixel', validFraction: valid / (width * height), sha256: sha256(Buffer.from(mosaic.buffer)) };
    fs.writeFileSync(mosaicPath.replace(/\.rgbi$/, '.json'), JSON.stringify(sidecar, null, 2) + '\n');
    console.log(`${campaign.key}: mosaic ${width} x ${height} at ${step} m, valid ${(100 * sidecar.validFraction).toFixed(2)}%`);
    ledger.campaigns[campaign.key] = { ...campaign, windowEpsg3006: bbox, items, mosaic: { file: path.relative(ROOT, mosaicPath).replaceAll('\\', '/'), ...sidecar } };
  }
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`fetch-ortho failed: ${error.message}`); process.exitCode = 1; });
}
