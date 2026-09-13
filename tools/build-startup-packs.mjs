#!/usr/bin/env node
// Publish optional transport artifacts. The original v2 manifests/chunks and
// decoded samples remain authoritative and are never rewritten.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { canonicalJsonBytes } from '../packages/course-v2/canonical-json.mjs';
import { verifyChunkAsset, sha256Bytes } from '../packages/course-v2/chunk-node.mjs';
import { buildChunkEnvelope } from '../packages/course-v2/chunk.mjs';
import { predictTerrain, restoreTerrain } from '../packages/course-v2/terrain-predictor.mjs';
import { groundAssetReferences, validateStartupManifest, STARTUP_VERSION, STARTUP_BUILDER, MAX_STARTUP_PACK_BYTES } from '../packages/course-v2/startup-manifest.mjs';

export async function publishStartupPacks(publicRoot) {
  const read = rel => fs.readFile(path.join(publicRoot, rel));
  const readVerifiedJson = async ref => {
    const bytes = await read(ref.url);
    if (bytes.length !== ref.bytes || sha256Bytes(bytes) !== ref.sha256) throw new Error(`invalid source ${ref.url}`);
    return JSON.parse(bytes);
  };
  const catalog = JSON.parse(await read('courses/index.json'));
  const root = JSON.parse(await read('courses/v2-index.json'));
  const published = new Map();
  const report = [];
  for (const courseEntry of root.courses) {
    const course = await readVerifiedJson(courseEntry.manifest);
    let result = published.get(course.groundManifest.sha256);
    if (!result) {
      const ground = await readVerifiedJson(course.groundManifest);
      const directory = `grounds/${ground.groundId}/startup`;
      await fs.mkdir(path.join(publicRoot, directory), { recursive: true });
      const manifest = { version: STARTUP_VERSION, builder: STARTUP_BUILDER, groundId: ground.groundId,
        groundSha256: course.groundManifest.sha256, packs: [], entries: {} };
      let parts = [], size = 0, originalBytes = 0, decodedBytes = 0, terrainSamples = 0;
      const flush = async () => {
        if (!size) return;
        const bytes = Buffer.concat(parts, size), sha256 = sha256Bytes(bytes);
        const url = `${directory}/${sha256}.bin`;
        await fs.writeFile(path.join(publicRoot, url), bytes);
        manifest.packs.push({ url, bytes: size, sha256 });
        parts = []; size = 0;
      };
      for (const reference of groundAssetReferences(ground)) {
        const original = await read(reference.url);
        const decoded = verifyChunkAsset(reference, original);
        let transport = original, extra = { codec: 'bvch' };
        originalBytes += original.length; decodedBytes += decoded.payload.length;
        if (decoded.header.payloadFormat === 'terrain-grid-u16-le-v1') {
          const compressed = deflateRawSync(predictTerrain(decoded.payload, decoded.header.grid.width), { level: 9 });
          const restored = restoreTerrain(inflateRawSync(compressed), decoded.header.grid.width);
          if (!Buffer.from(restored).equals(Buffer.from(decoded.payload))) throw new Error(`terrain round trip failed: ${reference.url}`);
          const header = canonicalJsonBytes(decoded.header);
          transport = Buffer.alloc(4 + header.length + compressed.length);
          transport.writeUInt32LE(header.length, 0); transport.set(header, 4); transport.set(compressed, 4 + header.length);
          const raw = buildChunkEnvelope(decoded.header, decoded.payload, 'raw');
          extra = { codec: 'terrain-predictor-v1', rawBytes: raw.length, rawSha256: sha256Bytes(raw) };
          terrainSamples += restored.length / 2;
        }
        if (transport.length > MAX_STARTUP_PACK_BYTES) throw new Error(`startup entry exceeds pack budget: ${reference.url}`);
        if (size + transport.length > MAX_STARTUP_PACK_BYTES) await flush();
        manifest.entries[reference.sha256] = { pack: manifest.packs.length, offset: size, bytes: transport.length, ...extra };
        parts.push(transport); size += transport.length;
      }
      await flush();
      validateStartupManifest(manifest, { ground, groundSha256: course.groundManifest.sha256, baseUrl: 'https://banvy.invalid/' });
      const bytes = canonicalJsonBytes(manifest), sha256 = sha256Bytes(bytes);
      const url = `${directory}/manifest-${sha256}.json`;
      await fs.writeFile(path.join(publicRoot, url), bytes);
      result = { url, bytes: bytes.length, sha256 };
      published.set(course.groundManifest.sha256, result);
      report.push({ ground: ground.groundId, chunks: Object.keys(manifest.entries).length, packages: manifest.packs.length,
        originalBytes, packagedBytes: manifest.packs.reduce((n, p) => n + p.bytes, 0), manifestBytes: bytes.length, decodedBytes, exactTerrainSamples: terrainSamples });
    }
    const meta = catalog.courses.find(c => c.slug === course.slug);
    if (!meta) throw new Error(`course missing from catalog: ${course.slug}`);
    meta.startup = result;
  }
  // Write the pointer last. Interrupted publication never advertises half a generation.
  await fs.writeFile(path.join(publicRoot, 'courses/index.json'), JSON.stringify(catalog, null, 1) + '\n');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const publicRoot = path.resolve(process.argv[2] || 'apps/golf/public');
  const report = await publishStartupPacks(publicRoot);
  console.log(JSON.stringify(report, null, 2));
}
