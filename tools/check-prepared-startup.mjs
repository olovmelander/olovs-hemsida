#!/usr/bin/env node
// Release gate: never publish a build that silently rejects its prepared data.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { courseSourceRevision } from './course-source-revision.mjs';
import { groundTintIdentity } from '../apps/golf/src/engine/prepared-ground-tint.mjs';
import { preparedWaterIdentity, decodePreparedWater } from '../apps/golf/src/engine/prepared-water.mjs';
import { canonicalJson } from '../packages/course-v2/canonical-json.mjs';
import { validateStartupManifest } from '../packages/course-v2/startup-manifest.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function checkPreparedStartup(publicRoot, revision) {
  const read = async relative => {
    assert.equal(typeof relative, 'string');
    const target = path.resolve(publicRoot, relative);
    assert.ok(target.startsWith(path.resolve(publicRoot) + path.sep), 'asset outside public root');
    return fs.readFile(target);
  };
  const json = async relative => JSON.parse(await read(relative));
  const verified = async ref => {
    assert.ok(ref && /^[a-f0-9]{64}$/.test(ref.sha256), 'missing/invalid asset reference');
    const bytes = await read(ref.url);
    assert.equal(bytes.length, ref.bytes, `${ref.url}: bytes`);
    assert.equal(sha(bytes), ref.sha256, `${ref.url}: hash`);
    return bytes;
  };
  const compressed = async (ref, max) => {
    const bytes = await verified(ref);
    assert.ok(Number.isSafeInteger(ref.decodedBytes) && ref.decodedBytes > 0 && ref.decodedBytes <= max);
    const data = inflateRawSync(bytes, { maxOutputLength: max });
    assert.equal(data.length, ref.decodedBytes); assert.equal(sha(data), ref.decodedSha256);
    return data;
  };
  const catalog = await json('courses/index.json'), v2 = await json('courses/v2-index.json');
  const results = [];
  for (const meta of catalog.courses) {
    const entry = v2.courses.find(c => c.slug === meta.slug); assert.ok(entry, `${meta.slug}: missing v2`);
    const course = JSON.parse(await verified(entry.manifest));
    const ground = JSON.parse(await verified(course.groundManifest));
    const startupBytes = await verified(meta.startup), startup = JSON.parse(startupBytes);
    assert.equal(canonicalJson(startup), startupBytes.toString(), 'canonical startup');
    validateStartupManifest(startup, { ground, groundSha256: course.groundManifest.sha256, baseUrl: 'https://banvy.invalid/' });
    for (const pack of startup.packs) await verified(pack);
    const tints = [];
    for (const quality of ['hi', 'lo']) {
      const ref = meta.preparedTint?.[`painted-${quality}`];
      assert.equal(ref?.identity, await groundTintIdentity({ meta, groundSha256: course.groundManifest.sha256,
        painted: true, lowQuality: quality === 'lo', revision }), `${meta.slug}: stale/missing ${quality} tint`);
      const data = await compressed(ref, 16 * 1024 * 1024);
      assert.equal(ref.layers?.length, 2); let offset = 0;
      for (const layer of ref.layers) {
        assert.ok(Number.isSafeInteger(layer.n) && layer.n > 0 && Number.isFinite(layer.dx) && layer.dx > 0);
        assert.ok(['x0', 'x1', 'z0', 'z1'].every(k => Number.isFinite(layer.bounds?.[k])));
        assert.equal(layer.bytes, layer.n ** 2 * 4); assert.equal(layer.offset, offset); offset += layer.bytes;
      }
      assert.equal(offset, data.length); tints.push({ quality, sha256: ref.decodedSha256 });
    }
    const waterIdentity = await preparedWaterIdentity({ meta, groundSha256: course.groundManifest.sha256, revision });
    if (meta.preparedWater) {
      assert.equal(meta.preparedWater.identity, waterIdentity, `${meta.slug}: stale water`);
      const data = await compressed(meta.preparedWater, 128 * 1024 * 1024);
      decodePreparedWater(new Uint8Array(data), waterIdentity);
    } else {
      assert.equal(meta.preparedWaterUnsupported?.identity, waterIdentity, `${meta.slug}: missing current unsupported-water bake receipt`);
      assert.equal(meta.preparedWaterUnsupported?.revision, revision);
    }
    results.push({ course: meta.slug, chunks: Object.keys(startup.entries).length, packages: startup.packs.length,
      tints, water: meta.preparedWater ? 'prepared' : 'verified unsupported path' });
  }
  return { revision, courses: results };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--public'), root = path.resolve(i < 0 ? 'apps/golf/dist' : process.argv[i + 1]);
  const revision = JSON.parse(await fs.readFile(path.join(root, 'course-startup-build.json'))).revision;
  assert.equal(revision, courseSourceRevision(process.cwd()), 'built revision differs from source');
  console.log(JSON.stringify(await checkPreparedStartup(root, revision), null, 2));
}
