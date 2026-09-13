#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { verifyChunkAsset, sha256Bytes } from '../packages/course-v2/chunk-node.mjs';
import { groundAssetReferences, validateStartupManifest } from '../packages/course-v2/startup-manifest.mjs';
import { decodeStartupTerrain } from '../packages/course-v2/runtime/startup-decode.mjs';
import { verifyChunkAssetWeb } from '../packages/course-v2/runtime/decode-web.mjs';

const root = path.resolve(process.argv[2] || 'apps/golf/public');
const read = async ref => {
  const bytes = await fs.readFile(path.join(root, ref.url));
  assert.equal(bytes.length, ref.bytes, ref.url);
  assert.equal(sha256Bytes(bytes), ref.sha256, ref.url);
  return bytes;
};
const catalog = JSON.parse(await fs.readFile(path.join(root, 'courses/index.json')));
const index = JSON.parse(await fs.readFile(path.join(root, 'courses/v2-index.json')));
const seen = new Set();
let chunks = 0, samples = 0, courses = 0, bytesBefore = 0, bytesAfter = 0;
for (const entry of index.courses) {
  const course = JSON.parse(await read(entry.manifest));
  const meta = catalog.courses.find(c => c.slug === course.slug);
  assert.ok(meta.startup, course.slug);
  courses++;
  if (seen.has(meta.startup.sha256)) continue;
  const ground = JSON.parse(await read(course.groundManifest));
  const manifest = validateStartupManifest(JSON.parse(await read(meta.startup)), {
    ground, groundSha256: course.groundManifest.sha256, baseUrl: 'https://banvy.invalid/' });
  const packs = await Promise.all(manifest.packs.map(read));
  bytesAfter += packs.reduce((n, pack) => n + pack.length, meta.startup.bytes);
  for (const ref of groundAssetReferences(ground)) {
    const original = verifyChunkAsset(ref, await read(ref));
    const item = manifest.entries[ref.sha256];
    const input = new Uint8Array(packs[item.pack].subarray(item.offset, item.offset + item.bytes));
    const decoded = item.codec === 'terrain-predictor-v1'
      ? await decodeStartupTerrain(ref, input, item) : await verifyChunkAssetWeb(ref, input);
    assert.deepEqual(decoded.header, original.header, ref.url);
    assert.ok(Buffer.from(decoded.payload).equals(Buffer.from(original.payload)), ref.url);
    assert.deepEqual(decoded.content, original.content, ref.url);
    chunks++; bytesBefore += ref.bytes;
    if (ref.kind === 'terrain') samples += decoded.payload.length / 2;
  }
  seen.add(meta.startup.sha256);
  console.log(`${ground.groundId}: all ${Object.keys(manifest.entries).length} chunks match through the browser decoder`);
}
console.log(JSON.stringify({ courses, grounds: seen.size, chunks, exactTerrainSamples: samples,
  originalBytes: bytesBefore, startupBytesIncludingManifests: bytesAfter }, null, 2));
