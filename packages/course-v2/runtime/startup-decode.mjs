import { buildChunkEnvelope } from '../chunk.mjs';
import { restoreTerrain } from '../terrain-predictor.mjs';
import { inflateBounded, verifyChunkAssetWeb } from './decode-web.mjs';

// The content-addressed startup manifest authenticates the NEW raw-envelope
// identity. It does not claim to reconstruct the old deflate encoder's bytes.
// Existing chunk verification still checks the original decoded SHA and schema.
export async function decodeStartupTerrain(reference, bytes, entry, options = {}) {
  if (entry.codec !== 'terrain-predictor-v1' || bytes.byteLength < 5) throw new Error('invalid startup terrain transport');
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (headerLength < 1 || headerLength > 65536 || headerLength + 4 >= bytes.byteLength) throw new Error('invalid startup terrain header');
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + headerLength)));
  if (header.payloadFormat !== 'terrain-grid-u16-le-v1' || header.decodedBytes !== reference.decodedBytes ||
      header.decodedSha256 !== reference.decodedSha256 || !Number.isSafeInteger(header.grid?.width) ||
      !Number.isSafeInteger(header.grid?.height) || header.grid.width < 1 || header.grid.height < 1 ||
      header.grid.width * header.grid.height * 2 !== reference.decodedBytes) throw new Error('startup terrain identity mismatch');
  const planes = await inflateBounded(bytes.subarray(4 + headerLength), reference.decodedBytes, options);
  if (planes.byteLength !== reference.decodedBytes) throw new Error('startup terrain decoded size mismatch');
  const payload = restoreTerrain(planes, header.grid.width);
  // This is an in-memory envelope, never a network URL. Its reference must
  // carry the new hash in the filename too, as required by the v2 schema.
  return verifyChunkAssetWeb({ ...reference, url: `startup-decoded/${entry.rawSha256}.bvch`,
    bytes: entry.rawBytes, sha256: entry.rawSha256 },
    buildChunkEnvelope(header, payload, 'raw'), options);
}
