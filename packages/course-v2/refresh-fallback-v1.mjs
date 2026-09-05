#!/usr/bin/env node
/* Refresh a course's GPK1 fallback identity in the published v2 graph after a
   pack re-emit that did NOT touch the terrain.

   The v2 root index and the course manifest both pin the exact live GPK1
   entry (fallbackV1), and the runtime fails v2 selection closed on any
   mismatch — so re-emitting pack.bin without this step silently downgrades
   every flagless visit to GPK1. Recompiling the whole ground graph needs the
   ignored acquisition raster; this tool re-emits only what the pack change
   actually invalidates: a new content-addressed course manifest (the old one
   stays on disk, per the retention rule) and the updated root entry.

   usage: node packages/course-v2/refresh-fallback-v1.mjs <slug>

   The fallback identity is read from the LIVE GPK1 manifest
   (apps/golf/public/courses/index.json) — the publish-ground-rings lesson:
   never from a previous root's copy. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJsonBytes } from './canonical-json.mjs';
import { sha256Bytes } from './chunk-node.mjs';
import { assertValid, validateCourseManifest, validateRootIndex } from './schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'apps/golf/public');
const slug = process.argv[2];
if (!slug) { console.error('usage: refresh-fallback-v1.mjs <slug>'); process.exit(2); }

const live = JSON.parse(await readFile(path.join(PUBLIC, 'courses/index.json'), 'utf8'))
  .courses?.find(course => course.slug === slug);
if (!live?.sha256) throw new Error(`live GPK1 manifest has no complete ${slug} entry`);
const fallbackV1 = {
  format: 1,
  packUrl: String(live.packUrl).replace(/^\//, ''),
  bytes: live.bytes,
  sha256: live.sha256,
};

const rootPath = path.join(PUBLIC, 'courses/v2-index.json');
const root = JSON.parse(await readFile(rootPath, 'utf8'));
const entry = root.courses?.find(course => course.slug === slug);
if (!entry) throw new Error(`v2 root index has no ${slug} entry`);
if (entry.fallbackV1.sha256 === fallbackV1.sha256 && entry.fallbackV1.bytes === fallbackV1.bytes) {
  console.log(`${slug}: fallbackV1 already matches the live pack; nothing to do`);
  process.exit(0);
}

const manifestPath = path.join(PUBLIC, entry.manifest.url);
const manifestBytes = await readFile(manifestPath);
if (sha256Bytes(manifestBytes) !== entry.manifest.sha256) {
  throw new Error(`stored course manifest does not hash to the root's ${entry.manifest.sha256}`);
}
const manifest = JSON.parse(manifestBytes.toString('utf8'));
manifest.fallbackV1 = fallbackV1;
assertValid('course manifest', validateCourseManifest(manifest));
const newBytes = canonicalJsonBytes(manifest);
const newSha = sha256Bytes(newBytes);
const newUrl = `courses/${slug}/course-v2-${newSha}.json`;
await writeFile(path.join(PUBLIC, newUrl), newBytes, { flag: 'wx' }).catch(async error => {
  if (error?.code !== 'EEXIST') throw error;
  const existing = await readFile(path.join(PUBLIC, newUrl));
  if (!existing.equals(Buffer.from(newBytes))) throw new Error(`content collision at ${newUrl}`);
});

entry.fallbackV1 = fallbackV1;
entry.manifest = {
  bytes: newBytes.length,
  mediaType: entry.manifest.mediaType,
  sha256: newSha,
  url: newUrl,
};
assertValid('v2 root index', validateRootIndex(root));
await writeFile(rootPath, canonicalJsonBytes(root));
console.log(`${slug}: fallbackV1 -> ${fallbackV1.sha256.slice(0, 16)}… (${fallbackV1.bytes} bytes)`);
console.log(`course manifest -> ${newUrl}`);
