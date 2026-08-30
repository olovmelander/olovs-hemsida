import { verifyChunkAssetWeb } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import {
  createTerrainRenderResource,
  prepareTerrainRenderData,
} from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import {
  assertTerrainPreview,
  resolveTerrainPreviewAssetUrl,
} from '../../../../packages/course-v2/terrain-preview.mjs';

const MAX_DESCRIPTOR_BYTES = 256 * 1024;
const MAX_CONCURRENT_PREVIEW_REQUESTS = 4;
const decoder = new TextDecoder('utf-8', { fatal: true });

async function responseBytes(response, maximumBytes, expectedBytes = null) {
  if (!response?.ok) throw new Error(`terrain preview request failed with HTTP ${response?.status ?? 'unknown'}`);
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel?.('terrain preview response exceeds its byte budget');
    throw new Error(`terrain preview response exceeds ${maximumBytes} bytes`);
  }
  if (expectedBytes !== null && Number.isFinite(declared) && declared !== expectedBytes) {
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
    if (!/^[a-f0-9]{64}$/.test(expectedDescriptorSha256 || '') || !cryptoImpl?.subtle?.digest) {
      throw new Error('terrain preview expected descriptor SHA-256 is invalid or unavailable');
    }
    const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', descriptorBytes));
    const actual = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== expectedDescriptorSha256) {
      throw new Error(`terrain preview descriptor integrity mismatch: ${actual} != ${expectedDescriptorSha256}`);
    }
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
      return createTerrainRenderResource({
        tileId: tile.id,
        decoded: { ...decoded, terrainRenderData: prepareTerrainRenderData(decoded) },
        frame: descriptor.frame,
      });
    },
  );
  return Object.freeze({ descriptor: Object.freeze(descriptor), resources: Object.freeze(resources) });
}
