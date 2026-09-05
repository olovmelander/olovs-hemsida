#!/usr/bin/env node
/* Re-bind a published v2 course graph to a new GPK1 pack.

   The v2 root index and each course manifest carry the EXACT live GPK1 entry as
   `fallbackV1` (bytes, sha256, packUrl), and check-app-build refuses a graph whose
   fallback disagrees with courses/index.json. So a new pack -- a model change,
   re-emitted -- strands the graph until the binding moves. publish-ground-rings
   moves it, but needs the ring rasters (a credentialed Lantmäteriet download) in
   its cache; this does only the binding, from files already on disk, for a pack
   change with no terrain change.

   The course manifest is content-addressed: the old file stays on disk for
   rollback (the convention every publisher here follows) and the root index
   points at the new one. Nothing else in the graph references the pack.

     node tools/rebind-v2-fallback.mjs --slug veckefjarden,veckefjarden-korthalsbanan   */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalJsonBytes } from '../packages/course-v2/canonical-json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'apps/golf/public');
const flag = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
const slugs = (flag('slug') || '').split(',').map(s => s.trim()).filter(Boolean);
if (!slugs.length) { console.error('usage: node tools/rebind-v2-fallback.mjs --slug a,b'); process.exit(2); }
const sha = b => createHash('sha256').update(b).digest('hex');

const live = JSON.parse(fs.readFileSync(path.join(PUB, 'courses/index.json'), 'utf8'));
const rootPath = path.join(PUB, 'courses/v2-index.json');
const root = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
for (const slug of slugs) {
  const entry = live.courses.find(c => c.slug === slug);
  if (!entry?.sha256 || !Number.isSafeInteger(entry.bytes) || !entry.packUrl) throw new Error(`live GPK1 manifest has no complete ${slug} entry`);
  const pack = fs.readFileSync(path.join(PUB, entry.packUrl.replace(/^\//, '')));
  if (sha(pack) !== entry.sha256 || pack.byteLength !== entry.bytes) throw new Error(`${slug}: courses/index.json does not describe the pack on disk -- run emit-manifest first`);
  const fallbackV1 = { format: 1, packUrl: entry.packUrl.replace(/^\//, ''), bytes: entry.bytes, sha256: entry.sha256 };
  const r = root.courses.find(c => c.slug === slug);
  if (!r) throw new Error(`v2 root has no ${slug}`);
  if (r.fallbackV1.sha256 === fallbackV1.sha256 && r.fallbackV1.bytes === fallbackV1.bytes) { console.log(`${slug}: already bound to ${fallbackV1.sha256.slice(0, 12)}`); continue; }
  const course = JSON.parse(fs.readFileSync(path.join(PUB, r.manifest.url), 'utf8'));
  course.fallbackV1 = fallbackV1;
  const bytes = canonicalJsonBytes(course);
  const digest = sha(bytes);
  const url = `courses/${slug}/course-v2-${digest}.json`;
  fs.writeFileSync(path.join(PUB, url), bytes);
  console.log(`${slug}: fallback ${r.fallbackV1.sha256.slice(0, 12)} -> ${fallbackV1.sha256.slice(0, 12)}; manifest ${r.manifest.sha256.slice(0, 12)} -> ${digest.slice(0, 12)} (${bytes.byteLength} bytes; the old manifest stays on disk)`);
  r.fallbackV1 = fallbackV1;
  r.manifest = { ...r.manifest, bytes: bytes.byteLength, sha256: digest, url };
}
fs.writeFileSync(rootPath, canonicalJsonBytes(root));
console.log('wrote courses/v2-index.json');
