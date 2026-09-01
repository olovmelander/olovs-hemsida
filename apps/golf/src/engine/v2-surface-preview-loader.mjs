import { verifyChunkAssetWeb } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import {
  assertSurfacePreview,
  resolveSurfacePreviewAssetUrl,
} from '../../../../packages/course-v2/surface-preview.mjs';
import { verifyJsonDescriptorIntegrity } from './descriptor-integrity.mjs';

const MAX_DESCRIPTOR_BYTES = 256 * 1024;
const MAX_DECODED_BYTES = 32 * 1024 * 1024;
const MAX_CONCURRENT_PREVIEW_REQUESTS = 4;
const decoder = new TextDecoder('utf-8', { fatal: true });

/* An ABSENT content-length is not a declared zero, and reading it as one made
   the whole v2 path fail closed on a perfectly good delivery. `Number(null)`
   is 0 and `Number.isFinite(0)` is true, so every host that answers with
   chunked transfer encoding -- which is every host that does not know the
   length up front, this repo's own tools/serve.mjs among them -- had each
   chunk rejected as "declares 0 bytes". Only the v2 capture harnesses set the
   header, so the bug was invisible: the loader tests build a Response with a
   content-length every time, and thus never asked this question.

   Nothing is weakened by skipping a header that is not there. The byte budget
   is still enforced on the stream itself, the authoritative count is `total`
   below -- measured on the bytes that actually arrived -- and the chunk's
   sha256 is verified after that. The header only buys an early abort. */
function declaredResponseBytes(response) {
  /* A CONTENT-ENCODED response declares the length of the ENCODED body, while
     expectedBytes is the decoded size -- and fetch() decodes transparently, so
     the two describe different things and comparing them always fails.
     GitHub Pages gzips .bvch: 81628 declared against 81751 expected, which
     failed the whole pilot closed on the live site while every local harness
     passed. The morning's note dismissed exactly this case on the reasoning
     that a sane host would not gzip an already-deflated binary. Pages does,
     for a 0.15% saving. Do not reason about what a host ought to do; ask it. */
  const encoding = response?.headers?.get?.('content-encoding');
  if (encoding && encoding.trim().toLowerCase() !== 'identity') return null;
  const raw = response?.headers?.get?.('content-length');
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function responseBytes(response, maximumBytes, expectedBytes = null) {
  if (!response?.ok) throw new Error(`surface preview request failed with HTTP ${response?.status ?? 'unknown'}`);
  const declared = declaredResponseBytes(response);
  if (declared !== null && declared > maximumBytes) {
    await response.body?.cancel?.('surface preview response exceeds its byte budget');
    throw new Error(`surface preview response exceeds ${maximumBytes} bytes`);
  }
  if (expectedBytes !== null && declared !== null && declared !== expectedBytes) {
    await response.body?.cancel?.('surface preview response has an unexpected byte count');
    throw new Error(`surface preview response declares ${declared} bytes; expected ${expectedBytes}`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error(`surface preview response exceeds ${maximumBytes} bytes`);
    if (expectedBytes !== null && bytes.byteLength !== expectedBytes) {
      throw new Error(`surface preview response has ${bytes.byteLength} bytes; expected ${expectedBytes}`);
    }
    return bytes;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel('surface preview response exceeds its byte budget');
      throw new Error(`surface preview response exceeds ${maximumBytes} bytes`);
    }
    chunks.push(value);
  }
  if (expectedBytes !== null && total !== expectedBytes) {
    throw new Error(`surface preview response has ${total} bytes; expected ${expectedBytes}`);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function mapConcurrent(items, concurrency, operation) {
  const result = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      result[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}

/** Fetch, integrity-check and decode every retained preview tile before any of
    its data can reach a render texture. */
export async function loadSurfacePreview(descriptorUrl, {
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  DecompressionStreamImpl = globalThis.DecompressionStream,
  expectedDescriptorSha256 = null,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const base = new URL(descriptorUrl, globalThis.location?.href);
  if (globalThis.location && base.origin !== globalThis.location.origin) {
    throw new Error('surface preview descriptor must be same-origin');
  }
  const response = await fetchImpl(base, {
    cache: 'no-store', credentials: 'same-origin', redirect: 'error',
  });
  const descriptorBytes = await responseBytes(response, MAX_DESCRIPTOR_BYTES);
  if (expectedDescriptorSha256 !== null) {
    await verifyJsonDescriptorIntegrity(
      descriptorBytes, expectedDescriptorSha256, cryptoImpl, 'surface preview',
    );
  }
  let descriptor;
  try { descriptor = JSON.parse(decoder.decode(descriptorBytes)); }
  catch (error) { throw new Error(`invalid surface preview JSON: ${error.message}`); }
  assertSurfacePreview(descriptor);
  const declaredDecodedBytes = descriptor.tiles.reduce((sum, tile) => sum + tile.reference.decodedBytes, 0);
  if (declaredDecodedBytes > MAX_DECODED_BYTES) {
    throw new Error(`surface preview exceeds its ${MAX_DECODED_BYTES} decoded-byte budget`);
  }

  const resources = await mapConcurrent(
    descriptor.tiles,
    MAX_CONCURRENT_PREVIEW_REQUESTS,
    async tile => {
      const assetUrl = resolveSurfacePreviewAssetUrl(tile.reference, base);
      const assetResponse = await fetchImpl(assetUrl, {
        cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      });
      const encoded = await responseBytes(assetResponse, tile.reference.bytes, tile.reference.bytes);
      const decoded = await verifyChunkAssetWeb(tile.reference, encoded, {
        cryptoImpl,
        DecompressionStreamImpl,
        maxDecodedBytes: MAX_DECODED_BYTES,
      });
      if (decoded.header.id !== tile.id || decoded.header.kind !== 'surface') {
        throw new Error(`surface preview tile ${tile.id} decoded as ${decoded.header.kind}/${decoded.header.id}`);
      }
      return Object.freeze({
        tileId: tile.id,
        header: Object.freeze(decoded.header),
        payload: decoded.payload,
        /* verifyChunkAssetWeb has already walked and validated every sample.
           Retaining a second fully decoded set of channel arrays added more
           than 32 MiB of transient allocations for Puttom, while the atlas
           consumes the verified interleaved payload directly. */
        inspection: Object.freeze(decoded.inspection),
      });
    },
  );
  return Object.freeze({
    descriptor: Object.freeze(descriptor),
    resources: Object.freeze(resources),
    encodedBytes: descriptor.tiles.reduce((sum, tile) => sum + tile.reference.bytes, 0),
    decodedBytes: declaredDecodedBytes,
  });
}
