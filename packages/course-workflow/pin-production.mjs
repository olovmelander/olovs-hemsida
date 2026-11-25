#!/usr/bin/env node
/* Re-pin a ground's production profile to the files it names.

   node packages/course-workflow/pin-production.mjs --ground <id>            rewrite the checksums that moved
   node packages/course-workflow/pin-production.mjs --ground <id> --check    fail when one is stale

   course-workflows/<ground>/production.json names every input of a build as { path, sha256 }: the course
   models, heightfields, cards, land cover, the mapping evidence, the tree candidates. Each rebuild of a model
   moves its checksum, and the six stages refuse inputs that do not match their pin. At Bro Hof this was a
   scratch script run before every build; it is a step of the pipeline, so it lives here.

   Only checksums are written. A path that does not exist is an error when writing (the profile names a file
   that is gone) and is listed, not failed, under --check: the raw caches a profile may name are private and
   are not in CI. After a write, run `production.mjs --ground <id> --configure`. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHA = /^[a-f0-9]{64}$/;

/** Every { path, sha256 } in a profile, with where it sits. */
export function pinnedFiles(value, at = '') {
  if (!value || typeof value !== 'object') return [];
  if (typeof value.path === 'string' && typeof value.sha256 === 'string') return [{ at, ref: value }];
  return Object.entries(value).flatMap(([key, child]) => pinnedFiles(child, at ? `${at}.${key}` : key));
}

/** The profile with each pin set to its file's checksum, and what moved or is missing. */
export function pinProduction(profile, { root = ROOT } = {}) {
  const next = structuredClone(profile), moved = [], missing = [];
  for (const { at, ref } of pinnedFiles(next)) {
    assert.match(ref.sha256, SHA, `${at}: not a checksum`);
    const file = path.join(root, ref.path);
    if (!fs.existsSync(file)) { missing.push({ at, path: ref.path }); continue; }
    const sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (sha256 !== ref.sha256) { moved.push({ at, path: ref.path, from: ref.sha256, to: sha256 }); ref.sha256 = sha256; }
  }
  return { profile: next, moved, missing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), i = argv.indexOf('--ground');
  assert(i >= 0 && argv[i + 1], 'usage: pin-production.mjs --ground <id> [--check]');
  const file = path.join(ROOT, `course-workflows/${argv[i + 1]}/production.json`), check = argv.includes('--check');
  const { profile, moved, missing } = pinProduction(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!check) {
    assert.equal(missing.length, 0, `the profile names files that are gone: ${missing.map(m => m.path).join(', ')}`);
    if (moved.length) fs.writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`);
  }
  console.log(JSON.stringify({ ground: argv[i + 1], check, moved: moved.map(m => `${m.at} (${m.path})`), missing: missing.map(m => m.path) }, null, 1));
  process.exitCode = check && moved.length ? 1 : 0;
}
