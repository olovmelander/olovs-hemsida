import { verifyChunkAssetWeb } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import {
  createTerrainRenderResource,
  prepareTerrainRenderData,
} from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import {
  assertTerrainPreview,
  resolveTerrainPreviewAssetUrl,
} from '../../../../packages/course-v2/terrain-preview.mjs';
import { verifyJsonDescriptorIntegrity } from './descriptor-integrity.mjs';

const MAX_DESCRIPTOR_BYTES = 256 * 1024;
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
  if (!response?.ok) throw new Error(`terrain preview request failed with HTTP ${response?.status ?? 'unknown'}`);
  const declared = declaredResponseBytes(response);
  if (declared !== null && declared > maximumBytes) {
    await response.body?.cancel?.('terrain preview response exceeds its byte budget');
    throw new Error(`terrain preview response exceeds ${maximumBytes} bytes`);
  }
  if (expectedBytes !== null && declared !== null && declared !== expectedBytes) {
    await response.body?.cancel?.('terrain preview response has an unexpected byte count');
    throw new Error(`terrain preview response declares ${declared} bytes; expected ${expectedBytes}`);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error(`terrain preview response exceeds ${maximumBytes} bytes`);
    if (expectedBytes !== null && bytes.byteLength !== expectedBytes) {
      throw new Error(`terrain preview response has ${bytes.byteLength} bytes; expected ${expectedBytes}`);
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
      await reader.cancel('terrain preview response exceeds its byte budget');
      throw new Error(`terrain preview response exceeds ${maximumBytes} bytes`);
    }
    chunks.push(value);
  }
  if (expectedBytes !== null && total !== expectedBytes) {
    throw new Error(`terrain preview response has ${total} bytes; expected ${expectedBytes}`);
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

export async function loadTerrainPreview(descriptorUrl, {
  fetchImpl = globalThis.fetch,
  cryptoImpl = globalThis.crypto,
  DecompressionStreamImpl = globalThis.DecompressionStream,
  expectedDescriptorSha256 = null,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const base = new URL(descriptorUrl, globalThis.location?.href);
  if (globalThis.location && base.origin !== globalThis.location.origin) {
    throw new Error('terrain preview descriptor must be same-origin');
  }
  const descriptorResponse = await fetchImpl(base, {
    cache: 'no-store', credentials: 'same-origin', redirect: 'error',
  });
  const descriptorBytes = await responseBytes(descriptorResponse, MAX_DESCRIPTOR_BYTES);
  if (expectedDescriptorSha256 !== null) {
    await verifyJsonDescriptorIntegrity(
      descriptorBytes, expectedDescriptorSha256, cryptoImpl, 'terrain preview',
    );
  }
  let descriptor;
  try { descriptor = JSON.parse(decoder.decode(descriptorBytes)); }
  catch (error) { throw new Error(`invalid terrain preview JSON: ${error.message}`); }
  assertTerrainPreview(descriptor);

  const resources = await mapConcurrent(
    descriptor.tiles,
    MAX_CONCURRENT_PREVIEW_REQUESTS,
    async tile => {
      const assetUrl = resolveTerrainPreviewAssetUrl(tile.reference, base);
      const response = await fetchImpl(assetUrl, {
        cache: 'no-store', credentials: 'same-origin', redirect: 'error',
      });
      const encoded = await responseBytes(response, tile.reference.bytes, tile.reference.bytes);
      const decoded = await verifyChunkAssetWeb(tile.reference, encoded, {
        cryptoImpl,
        DecompressionStreamImpl,
      });
      if (decoded.header.id !== tile.id) {
        throw new Error(`preview tile ${tile.id} decoded as ${decoded.header.id}`);
      }
      /* texels are prepared on first use: the ring-graph world samples these
         tiles for construction and never uploads them */
      return createTerrainRenderResource({
        tileId: tile.id,
        decoded,
        frame: descriptor.frame,
        lazyRenderData: true,
      });
    },
  );
  return Object.freeze({ descriptor: Object.freeze(descriptor), resources: Object.freeze(resources) });
}
