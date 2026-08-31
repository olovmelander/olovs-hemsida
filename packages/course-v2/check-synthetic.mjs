import { verifyAssetGraph } from './graph-node.mjs';
import { createSyntheticAssetGraph } from './synthetic-fixture.mjs';

const result = verifyAssetGraph(createSyntheticAssetGraph());
if (result.courses !== 2 || result.grounds !== 1 || result.chunks !== 7 || result.v1Fallbacks !== 2) {
  throw new Error(`unexpected synthetic graph shape: ${JSON.stringify(result)}`);
}
if (result.encodedChunkBytes >= 16 * 1024 || result.decodedChunkBytes >= 16 * 1024) {
  throw new Error(`synthetic fixture exceeded its 16 KiB test budget: ${JSON.stringify(result)}`);
}
console.log(JSON.stringify({ status: 'ok', ...result }, null, 2));
