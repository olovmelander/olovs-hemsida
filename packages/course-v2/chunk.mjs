import { canonicalJson, canonicalJsonBytes } from './canonical-json.mjs';
import {
  MAX_CHUNK_ENCODED_BYTES,
  V2_CHUNK_MAGIC,
  assertValid,
  validateChunkHeader,
} from './schema.mjs';

export const CHUNK_PREAMBLE_BYTES = 16;
export const CHUNK_CODECS = Object.freeze({ raw: 0, 'deflate-raw': 1 });
const CODEC_NAMES = new Map(Object.entries(CHUNK_CODECS).map(([name, code]) => [code, name]));
const HEADER_ENCODING_CANONICAL_JSON = 1;
const decoder = new TextDecoder('utf-8', { fatal: true });

function bytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`${label} must be an ArrayBuffer or Uint8Array`);
}

function codecCode(codec) {
  if (!Object.hasOwn(CHUNK_CODECS, codec)) throw new Error(`unsupported chunk codec ${JSON.stringify(codec)}`);
  return CHUNK_CODECS[codec];
}

export function buildChunkEnvelope(header, encodedPayload, codec) {
  assertValid('chunk header', validateChunkHeader(header));
  const headerBytes = canonicalJsonBytes(header);
  const payload = bytes(encodedPayload, 'encodedPayload');
  const total = CHUNK_PREAMBLE_BYTES + headerBytes.byteLength + payload.byteLength;
  if (headerBytes.byteLength > 64 * 1024) throw new RangeError('chunk header exceeds 64 KiB');
  if (total > MAX_CHUNK_ENCODED_BYTES) throw new RangeError('encoded chunk exceeds the 16 MiB chunk budget');

  const result = new Uint8Array(total);
  result.set(new TextEncoder().encode(V2_CHUNK_MAGIC), 0);
  const view = new DataView(result.buffer);
  view.setUint8(4, 2);
  view.setUint8(5, codecCode(codec));
  view.setUint8(6, HEADER_ENCODING_CANONICAL_JSON);
  view.setUint8(7, 0);
  view.setUint32(8, headerBytes.byteLength, true);
  view.setUint32(12, payload.byteLength, true);
  result.set(headerBytes, CHUNK_PREAMBLE_BYTES);
  result.set(payload, CHUNK_PREAMBLE_BYTES + headerBytes.byteLength);
  return result;
}

export function parseChunkEnvelope(input) {
  const source = bytes(input, 'chunk');
  if (source.byteLength < CHUNK_PREAMBLE_BYTES) throw new Error('truncated chunk preamble');
  if (source.byteLength > MAX_CHUNK_ENCODED_BYTES) throw new Error('encoded chunk exceeds the 16 MiB chunk budget');
  const magic = decoder.decode(source.subarray(0, 4));
  if (magic !== V2_CHUNK_MAGIC) throw new Error('bad v2 chunk magic');
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const version = view.getUint8(4);
  if (version !== 2) throw new Error(`unsupported v2 chunk envelope version ${version}`);
  const codec = CODEC_NAMES.get(view.getUint8(5));
  if (!codec) throw new Error(`unsupported v2 chunk codec ${view.getUint8(5)}`);
  if (view.getUint8(6) !== HEADER_ENCODING_CANONICAL_JSON) throw new Error('unsupported v2 chunk header encoding');
  if (view.getUint8(7) !== 0) throw new Error('v2 chunk reserved flags must be zero');
  const headerLength = view.getUint32(8, true);
  const payloadLength = view.getUint32(12, true);
  if (!headerLength || headerLength > 64 * 1024) throw new Error('invalid v2 chunk header length');
  const expected = CHUNK_PREAMBLE_BYTES + headerLength + payloadLength;
  if (source.byteLength !== expected) {
    const delta = source.byteLength - expected;
    throw new Error(delta > 0 ? `v2 chunk has ${delta} trailing bytes` : `v2 chunk is truncated by ${-delta} bytes`);
  }
  const headerText = decoder.decode(source.subarray(CHUNK_PREAMBLE_BYTES, CHUNK_PREAMBLE_BYTES + headerLength));
  let header;
  try { header = JSON.parse(headerText); }
  catch (error) { throw new Error(`invalid v2 chunk header JSON: ${error.message}`); }
  if (canonicalJson(header) !== headerText) throw new Error('v2 chunk header is not canonical JSON');
  assertValid('chunk header', validateChunkHeader(header));
  return {
    codec,
    header,
    encodedPayload: source.subarray(CHUNK_PREAMBLE_BYTES + headerLength),
  };
}

