import { createHash } from 'node:crypto';
import { constants as zlibConstants, deflateRawSync, inflateRawSync } from 'node:zlib';
import { canonicalJson, canonicalJsonBytes } from './canonical-json.mjs';
import { buildChunkEnvelope, parseChunkEnvelope } from './chunk.mjs';
import {
  MAX_CHUNK_DECODED_BYTES,
  V2_CHUNK_MEDIA_TYPE,
  assertSupported,
  assertValidAssetReference,
} from './schema.mjs';
import { inspectTerrainPayload } from './terrain-grid.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });

function bytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`${label} must be an ArrayBuffer or Uint8Array`);
}

export function sha256Bytes(value) {
  return createHash('sha256').update(bytes(value, 'value')).digest('hex');
}

function encodePayload(payload, codec) {
  const source = bytes(payload, 'payload');
  if (codec === 'raw') return source;
  if (codec === 'deflate-raw') {
    return deflateRawSync(source, {
      level: 9,
      memLevel: 9,
      strategy: zlibConstants.Z_DEFAULT_STRATEGY,
    });
  }
  throw new Error(`unsupported chunk codec ${JSON.stringify(codec)}`);
}

function decodePayload(encodedPayload, codec, expectedBytes) {
  if (codec === 'raw') return bytes(encodedPayload, 'encodedPayload');
  if (codec === 'deflate-raw') {
    return inflateRawSync(encodedPayload, { maxOutputLength: expectedBytes });
  }
  throw new Error(`unsupported chunk codec ${JSON.stringify(codec)}`);
}

export function writeChunk({ header, payload, codec = 'deflate-raw' }) {
  const decoded = bytes(payload, 'payload');
  if (decoded.byteLength > MAX_CHUNK_DECODED_BYTES) throw new RangeError('decoded chunk exceeds the 64 MiB budget');
  const completeHeader = {
    ...header,
    decodedBytes: decoded.byteLength,
    decodedSha256: sha256Bytes(decoded),
  };
  return Buffer.from(buildChunkEnvelope(completeHeader, encodePayload(decoded, codec), codec));
}

export function writeCanonicalJsonChunk({ header, value, codec = 'deflate-raw' }) {
  return writeChunk({ header, payload: canonicalJsonBytes(value), codec });
}

export function readChunk(input, options = {}) {
  const envelope = parseChunkEnvelope(input);
  assertSupported('chunk', envelope.header.requiredFeatures, options.supportedFeatures);
  if (envelope.header.decodedBytes > (options.maxDecodedBytes ?? MAX_CHUNK_DECODED_BYTES)) {
    throw new Error('chunk exceeds the configured decoded-byte budget');
  }
  let payload;
  try {
    payload = decodePayload(envelope.encodedPayload, envelope.codec, envelope.header.decodedBytes);
  } catch (error) {
    throw new Error(`v2 chunk payload decode failed: ${error.message}`);
  }
  if (payload.byteLength !== envelope.header.decodedBytes) {
    throw new Error(`decoded chunk has ${payload.byteLength} bytes; header declares ${envelope.header.decodedBytes}`);
  }
  const payloadSha256 = sha256Bytes(payload);
  if (payloadSha256 !== envelope.header.decodedSha256) {
    throw new Error(`decoded chunk integrity mismatch: ${payloadSha256} != ${envelope.header.decodedSha256}`);
  }

  let content = null;
  let inspection = null;
  if (envelope.header.payloadFormat === 'terrain-grid-u16-le-v1') {
    inspection = inspectTerrainPayload(payload, envelope.header);
  } else if (envelope.header.payloadFormat === 'json-canonical-v1') {
    const text = decoder.decode(payload);
    try { content = JSON.parse(text); }
    catch (error) { throw new Error(`invalid canonical JSON payload: ${error.message}`); }
    if (canonicalJson(content) !== text) throw new Error('JSON chunk payload is not canonical');
    const count = Array.isArray(content?.holes) ? content.holes.length
      : Array.isArray(content?.records) ? content.records.length
        : null;
    if (count !== envelope.header.records.count) {
      throw new Error(`JSON chunk record count ${count} does not match header ${envelope.header.records.count}`);
    }
  }
  return { ...envelope, payload, content, inspection };
}

export function assetReferenceForChunk(chunk, { kind, directory }) {
  const source = bytes(chunk, 'chunk');
  const parsed = parseChunkEnvelope(source);
  if (parsed.header.kind !== kind) throw new Error(`chunk kind ${parsed.header.kind} does not match ${kind}`);
  const sha256 = sha256Bytes(source);
  const cleanDirectory = String(directory).replace(/^\/+|\/+$/g, '');
  const reference = {
    kind,
    url: `${cleanDirectory}/${sha256}.bvch`,
    mediaType: V2_CHUNK_MEDIA_TYPE,
    bytes: source.byteLength,
    sha256,
    decodedBytes: parsed.header.decodedBytes,
    decodedSha256: parsed.header.decodedSha256,
    requiredFeatures: [...parsed.header.requiredFeatures],
  };
  assertValidAssetReference(reference, kind);
  return reference;
}

export function verifyChunkAsset(reference, input, options = {}) {
  assertValidAssetReference(reference);
  assertSupported('asset', reference.requiredFeatures, options.supportedFeatures);
  const source = bytes(input, 'chunk');
  if (source.byteLength !== reference.bytes) {
    throw new Error(`chunk size ${source.byteLength} does not match manifest ${reference.bytes}`);
  }
  const encodedSha256 = sha256Bytes(source);
  if (encodedSha256 !== reference.sha256) {
    throw new Error(`chunk integrity mismatch: ${encodedSha256} != ${reference.sha256}`);
  }
  const decoded = readChunk(source, options);
  if (decoded.header.kind !== reference.kind) throw new Error('chunk kind does not match its asset reference');
  if (decoded.header.decodedBytes !== reference.decodedBytes ||
      decoded.header.decodedSha256 !== reference.decodedSha256) {
    throw new Error('chunk decoded identity does not match its asset reference');
  }
  if (canonicalJson(decoded.header.requiredFeatures) !== canonicalJson(reference.requiredFeatures)) {
    throw new Error('chunk features do not match its asset reference');
  }
  return decoded;
}
