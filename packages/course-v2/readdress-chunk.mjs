/* A published chunk under a new tile id.

   A tile's id is its lattice position, `l<lod>/<column>/<row>`, and every
   consumer -- the graph verifier, the frontier loader, the vegetation
   sampler and loader -- holds a chunk's own header id to the manifest id it
   is served under. When a level's lattice grows around the published tiles
   (a 2,048 m level zero becoming the 4,096 m standard keeps its 64 tiles in
   the middle, at columns 4-11) the content is unchanged and the address is
   not, so the chunk is rewritten with the decoded payload VERBATIM, the
   header with only its id changed (the envelope's decoded byte count and
   digest are recomputed and come out identical), and -- for an object
   registry, whose canonical JSON repeats the tile id and is held to the
   header by the validator -- the payload's tileId moved with it. */
import { assetReferenceForChunk, readChunk, writeCanonicalJsonChunk, writeChunk } from './chunk-node.mjs';

export function readdressChunk(bytes, reference, tileId) {
  if (typeof tileId !== 'string' || !/^l\d+\/\d+\/\d+$/.test(tileId)) throw new TypeError(`tileId must be a lattice id; got ${tileId}`);
  const chunk = readChunk(bytes);
  if (chunk.header.kind !== reference.kind) throw new Error(`${reference.url} is a ${chunk.header.kind} chunk, not ${reference.kind}`);
  const { decodedBytes, decodedSha256, ...header } = chunk.header;
  header.id = tileId;
  const directory = reference.url.replace(/\/[^/]+$/, '');
  let rewritten;
  if (chunk.header.payloadFormat === 'json-canonical-v1') {
    const content = chunk.content;
    if (content && 'tileId' in content) content.tileId = tileId;
    rewritten = writeCanonicalJsonChunk({ header, value: content, codec: chunk.codec });
  } else {
    rewritten = writeChunk({ header, payload: chunk.payload, codec: chunk.codec });
  }
  const verified = readChunk(rewritten);
  const payloadIntact = chunk.header.payloadFormat === 'json-canonical-v1'
    ? verified.content?.tileId === tileId && JSON.stringify({ ...verified.content, tileId: null }) === JSON.stringify({ ...chunk.content, tileId: null })
    : verified.header.decodedSha256 === decodedSha256 && verified.header.decodedBytes === decodedBytes;
  if (verified.header.id !== tileId || verified.header.kind !== reference.kind || !payloadIntact) {
    throw new Error(`${reference.kind} chunk ${reference.url} could not be re-addressed to ${tileId}`);
  }
  return Object.freeze({ chunk: rewritten, reference: assetReferenceForChunk(rewritten, { kind: reference.kind, directory }), header: verified.header });
}
