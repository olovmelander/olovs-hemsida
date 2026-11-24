#!/usr/bin/env node
/* Ground-agnostic official club / SGF / Caddee source harvester.
 *
 * Downloads declared official web pages, scorecard JSONs, banguide PDFs/diagrams,
 * and dated renovation articles into a gitignored local cache directory while
 * writing a committable SHA-256 provenance ledger (no copyrighted media bytes
 * are ever written outside cacheDir).
 *
 * Usage:
 *   node packages/course-geo/intake/acquire-club-sources.mjs \
 *     --ground bro-hof --manifest sources-to-fetch.json \
 *     --cache-dir brohofbuild/cache/club-sources \
 *     --ledger-out geo_data/course-v2/bro-hof/reference/club-source-ledger.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * Parse pixel dimensions from PNG, JPEG, or WEBP binary headers without external deps.
 * Returns { format, width, height } or null if not a recognised image.
 */
export function parseImageDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 16) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A, IHDR at offset 12, width at 16, height at 20
  if (buf.length >= 24 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // WEBP: RIFF....WEBP
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buf.length >= 30) {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { format: 'webp', width, height };
    }
    if (chunk === 'VP8 ' && buf.length >= 30 && buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      return { format: 'webp', width, height };
    }
    if (chunk === 'VP8L' && buf.length >= 25 && buf[20] === 0x2f) {
      const bits = buf.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { format: 'webp', width, height };
    }
  }
  // JPEG: FF D8
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset++; continue; }
      while (offset < buf.length && buf[offset] === 0xff) offset++;
      if (offset >= buf.length) break;
      const marker = buf[offset++];
      if (marker === 0xd9 || marker === 0xda) break; // EOI / SOS
      if (offset + 2 > buf.length) break;
      const len = buf.readUInt16BE(offset);
      if (len < 2 || offset + len > buf.length) break;
      const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 7 < buf.length) {
        const height = buf.readUInt16BE(offset + 3);
        const width = buf.readUInt16BE(offset + 5);
        return { format: 'jpeg', width, height };
      }
      offset += len;
    }
  }
  return null;
}

export function safeSourceId(id) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) {
    throw new Error(`invalid source id ${JSON.stringify(id)}`);
  }
  return id;
}

function extensionFor(url, contentType = '') {
  const ct = String(contentType).split(';')[0].trim().toLowerCase();
  const byType = {
    'application/json': '.json',
    'application/pdf': '.pdf',
    'text/html': '.html',
    'text/plain': '.txt',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
  };
  if (byType[ct]) return byType[ct];
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.[a-z0-9]{1,5}$/.test(ext)) return ext;
  } catch { /* fallback below */ }
  return '.bin';
}

export async function acquireClubSources({
  groundId,
  items,
  cacheDir,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30_000,
}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(groundId || '')) {
    throw new Error(`invalid groundId ${JSON.stringify(groundId)}`);
  }
  if (!Array.isArray(items) || !items.length) {
    throw new Error('items must be a non-empty array of { id, url, kind, role }');
  }
  const resolvedCache = path.resolve(cacheDir);
  fs.mkdirSync(resolvedCache, { recursive: true });

  const entries = [];
  const seen = new Set();
  for (const item of items) {
    const id = safeSourceId(item.id);
    if (seen.has(id)) throw new Error(`duplicate source id ${id}`);
    seen.add(id);
    const parsedUrl = new URL(item.url);
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
      throw new Error(`unsupported protocol for ${id}: ${parsedUrl.protocol}`);
    }
    const retrievedAt = new Date().toISOString();
    try {
      const res = await fetchImpl(parsedUrl.href, {
        headers: {
          'User-Agent': 'BanvyCourseGeoIntake/1.0 (+https://github.com/olovmelander/olovs-hemsida)',
          ...(item.headers || {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const bytes = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers?.get?.('content-type') || null;
      const ext = extensionFor(parsedUrl.href, contentType);
      const filename = `${id}${ext}`;
      const cachedPath = path.join(resolvedCache, filename);
      if (res.ok) fs.writeFileSync(cachedPath, bytes);
      const image = res.ok ? parseImageDimensions(bytes) : null;
      entries.push({
        id,
        url: parsedUrl.href,
        finalUrl: res.url || parsedUrl.href,
        kind: item.kind || 'reference',
        role: item.role || 'club-source',
        date: item.date || null,
        retrievedAt,
        httpStatus: res.status,
        ok: Boolean(res.ok),
        contentType,
        bytes: bytes.length,
        sha256: res.ok ? sha256(bytes) : null,
        image,
        cachedFile: res.ok ? filename : null,
        notes: item.notes || null,
      });
    } catch (error) {
      entries.push({
        id,
        url: parsedUrl.href,
        finalUrl: null,
        kind: item.kind || 'reference',
        role: item.role || 'club-source',
        date: item.date || null,
        retrievedAt,
        httpStatus: null,
        ok: false,
        contentType: null,
        bytes: 0,
        sha256: null,
        image: null,
        cachedFile: null,
        error: String(error?.message || error).slice(0, 240),
        notes: item.notes || null,
      });
    }
  }

  return {
    schemaVersion: 1,
    groundId,
    generatedAt: new Date().toISOString(),
    redistribution: 'local-reference-only-not-committed',
    cacheRelativeNote: 'Raw downloads remain in gitignored local cache; this ledger records provenance and SHA-256 digests only.',
    total: entries.length,
    succeeded: entries.filter(e => e.ok).length,
    failed: entries.filter(e => !e.ok).length,
    entries,
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
  if (!opts.ground || !opts.manifest || !opts['cache-dir'] || !opts['ledger-out']) {
    throw new Error('Usage: acquire-club-sources.mjs --ground ID --manifest FILE --cache-dir DIR --ledger-out FILE');
  }
  const spec = JSON.parse(fs.readFileSync(path.resolve(opts.manifest), 'utf8'));
  const items = Array.isArray(spec) ? spec : spec.items;
  const ledger = await acquireClubSources({
    groundId: opts.ground,
    items,
    cacheDir: opts['cache-dir'],
  });
  const outPath = path.resolve(opts['ledger-out']);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({
    groundId: ledger.groundId,
    total: ledger.total,
    succeeded: ledger.succeeded,
    failed: ledger.failed,
    ledgerOut: outPath,
  }, null, 2));
  if (ledger.failed > 0 && opts['allow-partial'] !== 'true') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
}
