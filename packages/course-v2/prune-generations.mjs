#!/usr/bin/env node
/* Remove retired generations of a published v2 graph. Every publish leaves
   the previous course and ground manifests on disk for rollback; this keeps
   the generation the root serves, any generation named with --also, and
   EVERYTHING the retained preview descriptors reference (the pilot's
   terrain tiles and the surface preview's chunks live in the same
   directories), then deletes the rest. Dry by default; --apply deletes.

   node packages/course-v2/prune-generations.mjs --slug puttom [--also courses/puttom/course-v2-<sha>.json] [--apply]

   The first version of this, a one-off script, kept only what the ground
   manifests referenced and deleted the 30 committed surface-preview chunks
   beside them; the descriptors are part of the closure now.               */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}
const slug = flag('slug', 'puttom');
const publicDir = path.resolve(ROOT, flag('public', 'apps/golf/public'));
const also = process.argv.flatMap((value, index) => (value === '--also' ? [process.argv[index + 1]] : []));
const apply = process.argv.includes('--apply');

const read = url => JSON.parse(fs.readFileSync(path.join(publicDir, url), 'utf8'));
const keep = new Set();
function keepCourse(courseUrl) {
  keep.add(courseUrl);
  const course = read(courseUrl);
  keep.add(course.routing.url);
  keep.add(course.groundManifest.url);
  const ground = read(course.groundManifest.url);
  keep.add(ground.shell.url);
  for (const tile of ground.tiles) {
    for (const kind of ['terrain', 'surface', 'objects', 'stands']) if (tile.layers[kind]) keep.add(tile.layers[kind].url);
  }
  return ground.groundId;
}
const root = read('courses/v2-index.json');
const entry = root.courses.find(course => course.slug === slug);
if (!entry) throw new Error(`root index has no course ${slug}`);
const groundId = keepCourse(entry.manifest.url);
for (const url of also) keepCourse(url);
/* the descriptors read on their own, by loaders that never see the graph */
const groundDir = `grounds/${groundId}`;
for (const descriptorName of ['preview.json', 'surface-preview.json']) {
  const file = path.join(publicDir, groundDir, descriptorName);
  if (!fs.existsSync(file)) continue;
  keep.add(`${groundDir}/${descriptorName}`);
  const descriptor = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const tile of descriptor.tiles || []) keep.add(`${groundDir}/${tile.reference.url}`);
}

const candidates = [];
for (const dir of ['terrain', 'surface', 'objects', 'stands'].map(kind => `${groundDir}/${kind}`).concat([`courses/${slug}/routing`])) {
  const full = path.join(publicDir, dir);
  if (!fs.existsSync(full)) continue;
  for (const file of fs.readdirSync(full)) if (file.endsWith('.bvch')) candidates.push(`${dir}/${file}`);
}
for (const file of fs.readdirSync(path.join(publicDir, groundDir))) {
  if (/^ground-v2-[a-f0-9]{64}\.json$/.test(file)) candidates.push(`${groundDir}/${file}`);
}
for (const file of fs.readdirSync(path.join(publicDir, 'courses', slug))) {
  if (/^course-v2-[a-f0-9]{64}\.json$/.test(file)) candidates.push(`courses/${slug}/${file}`);
}
const remove = candidates.filter(url => !keep.has(url));
for (const url of remove) if (apply) fs.unlinkSync(path.join(publicDir, url));
console.log(JSON.stringify({
  slug, groundId, apply, kept: keep.size, candidates: candidates.length,
  removed: remove.length, manifestsRemoved: remove.filter(url => url.endsWith('.json')),
  bytesRemoved: apply ? null : remove.reduce((sum, url) => sum + fs.statSync(path.join(publicDir, url)).size, 0),
}, null, 2));
