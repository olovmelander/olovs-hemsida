import { canonicalJson } from '../canonical-json.mjs';
import { parseChunkEnvelope } from '../chunk.mjs';
import {
  MAX_CHUNK_DECODED_BYTES,
  assertSupported,
  assertValidAssetReference,
} from '../schema.mjs';
import { inspectTerrainPayload } from '../terrain-grid.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });

function bytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`${label} must be an ArrayBuffer or Uint8Array`);
}

export function abortError(message = 'The operation was aborted') {
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason?.name === 'AbortError' ? signal.reason : abortError();
}

async function sha256Hex(value, cryptoImpl) {
  if (!cryptoImpl?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes(value, 'value'));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function inflateBounded(encoded, expectedBytes, { signal, DecompressionStreamImpl }) {
  if (typeof DecompressionStreamImpl !== 'function') throw new Error('DecompressionStream is unavailable');
  const source = new Blob([encoded]);
  const reader = source.stream().pipeThrough(new DecompressionStreamImpl('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      checkAbort(signal);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > expectedBytes) {
        await reader.cancel('decoded payload exceeds declared size');
        throw new Error('decoded payload exceeds its declared byte count');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function inspectJsonPayload(payload, header) {
  const text = decoder.decode(payload);
  let content;
  try { content = JSON.parse(text); }
  catch (error) { throw new Error(`invalid canonical JSON payload: ${error.message}`); }
  if (canonicalJson(content) !== text) throw new Error('JSON chunk payload is not canonical');
  const count = Array.isArray(content?.holes) ? content.holes.length
    : Array.isArray(content?.records) ? content.records.length
      : null;
  if (count !== header.records.count) {
    throw new Error(`JSON chunk record count ${count} does not match header ${header.records.count}`);
  }
  return content;
}

export async function verifyChunkAssetWeb(reference, input, options = {}) {
  assertValidAssetReference(reference);
  assertSupported('asset', reference.requiredFeatures, options.supportedFeatures);
  checkAbort(options.signal);
  const source = bytes(input, 'chunk');
  if (source.byteLength !== reference.bytes) {
    throw new Error(`chunk size ${source.byteLength} does not match manifest ${reference.bytes}`);
  }
  const cryptoImpl = options.cryptoImpl ?? globalThis.crypto;
  const encodedSha256 = await sha256Hex(source, cryptoImpl);
  checkAbort(options.signal);
  if (encodedSha256 !== reference.sha256) {
    throw new Error(`chunk integrity mismatch: ${encodedSha256} != ${reference.sha256}`);
  }
  const envelope = parseChunkEnvelope(source);
  assertSupported('chunk', envelope.header.requiredFeatures, options.supportedFeatures);
  if (envelope.header.decodedBytes > (options.maxDecodedBytes ?? MAX_CHUNK_DECODED_BYTES)) {
    throw new Error('chunk exceeds the configured decoded-byte budget');
  }
  if (envelope.header.kind !== reference.kind ||
      envelope.header.decodedBytes !== reference.decodedBytes ||
      envelope.header.decodedSha256 !== reference.decodedSha256 ||
      canonicalJson(envelope.header.requiredFeatures) !== canonicalJson(reference.requiredFeatures)) {
    throw new Error('chunk header identity does not match its asset reference');
  }
  checkAbort(options.signal);
  const payload = envelope.codec === 'raw'
    ? new Uint8Array(envelope.encodedPayload)
    : await inflateBounded(envelope.encodedPayload, envelope.header.decodedBytes, {
      signal: options.signal,
      DecompressionStreamImpl: options.DecompressionStreamImpl ?? globalThis.DecompressionStream,
    });
  checkAbort(options.signal);
  if (payload.byteLength !== envelope.header.decodedBytes) {
    throw new Error(`decoded chunk has ${payload.byteLength} bytes; header declares ${envelope.header.decodedBytes}`);
  }
  const decodedSha256 = await sha256Hex(payload, cryptoImpl);
  checkAbort(options.signal);
  if (decodedSha256 !== envelope.header.decodedSha256) {
    throw new Error(`decoded chunk integrity mismatch: ${decodedSha256} != ${envelope.header.decodedSha256}`);
  }
  let content = null;
  let inspection = null;
  if (envelope.header.payloadFormat === 'terrain-grid-u16-le-v1') {
    inspection = inspectTerrainPayload(payload, envelope.header);
  } else if (envelope.header.payloadFormat === 'json-canonical-v1') {
    content = inspectJsonPayload(payload, envelope.header);
  }
  return { header: envelope.header, payload, content, inspection };
}

