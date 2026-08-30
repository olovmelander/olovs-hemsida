import { canonicalJson } from '../canonical-json.mjs';
import {
  V2_COURSE_MEDIA_TYPE,
  V2_GROUND_MEDIA_TYPE,
  assertSupported,
  assertValid,
  assertValidManifestReference,
  validateCourseManifest,
  validateGroundManifest,
} from '../schema.mjs';
import { abortError } from './decode-web.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });

function bytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`${label} must be an ArrayBuffer or Uint8Array`);
}

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason?.name === 'AbortError' ? signal.reason : abortError();
}

export async function sha256HexWeb(value, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const digest = await cryptoImpl.subtle.digest('SHA-256', bytes(value, 'value'));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyManifest(reference, input, {
  mediaType,
  validate,
  label,
  signal,
  cryptoImpl = globalThis.crypto,
  supportedFeatures,
}) {
  assertValidManifestReference(reference, mediaType);
  checkAbort(signal);
  const source = bytes(input, label);
  if (source.byteLength !== reference.bytes) {
    throw new Error(`${label} size ${source.byteLength} does not match manifest ${reference.bytes}`);
  }
  const sha256 = await sha256HexWeb(source, cryptoImpl);
  checkAbort(signal);
  if (sha256 !== reference.sha256) {
    throw new Error(`${label} integrity mismatch: ${sha256} != ${reference.sha256}`);
  }
  let document;
  let text;
  try {
    text = decoder.decode(source);
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not canonical UTF-8 JSON: ${error.message}`, { cause: error });
  }
  if (canonicalJson(document) !== text) throw new Error(`${label} is not canonical JSON`);
  assertValid(label, validate(document));
  assertSupported(label, document.requiredFeatures, supportedFeatures);
  return document;
}

export function verifyCourseManifestWeb(reference, input, options = {}) {
  return verifyManifest(reference, input, {
    ...options,
    mediaType: V2_COURSE_MEDIA_TYPE,
    validate: validateCourseManifest,
    label: options.label || 'v2 course manifest',
  });
}

export function verifyGroundManifestWeb(reference, input, options = {}) {
  return verifyManifest(reference, input, {
    ...options,
    mediaType: V2_GROUND_MEDIA_TYPE,
    validate: validateGroundManifest,
    label: options.label || 'v2 ground manifest',
  });
}
