#!/usr/bin/env node
/* Re-record the sha256 of a REGISTERED artifact in a ground's source manifest.

   The source manifest pins every committed artifact by checksum, and
   check-manifests (and manifest.node-test) refuse a mismatch. Some of those
   artifacts are evidence a CI run legitimately re-takes -- the COPC hierarchy
   census is rewritten by every ground-vegetation run with a new observedOn
   and its own elapsed times -- so the run must re-pin what it rewrote before
   the gate reads it, or the publish dies on its own evidence (Ängsö, run 18:
   the acquire committed a fresh census and left the pin on the old one).

     node packages/course-geo/acquisition/record-artifact-checksum.mjs \
       --ground angso --id copc-hierarchy-census [--id canopy-evidence]

   Only an artifact the manifest already registers is touched: an id the
   manifest does not carry is reported and skipped, so the same workflow step
   serves grounds that pin the census (Puttom, Johannesberg, Ängsö) and grounds
   that do not (Upsala). The manifest is written back in the same 2-space JSON
   it is committed in, so the diff is the one line that changed. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const ids = args.flatMap((value, index) => (value === '--id' && index + 1 < args.length ? [args[index + 1]] : []));
const groundId = flag('ground');
if (!groundId || !ids.length) throw new Error('usage: --ground <id> --id <artifact id> [--id ...]');

const manifestPath = path.join(REPO_ROOT, 'geo_data', 'course-v2', groundId, 'source-manifest.json');
const text = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(text);
if (JSON.stringify(manifest, null, 2) + '\n' !== text.replace(/\r\n/g, '\n')) {
  throw new Error(`${path.relative(REPO_ROOT, manifestPath)} is not in the 2-space JSON this tool writes; refusing to reformat it`);
}
let changed = 0;
for (const id of ids) {
  const artifact = (manifest.artifacts || []).find(entry => entry.id === id);
  if (!artifact) { console.log(`  ${groundId}: no registered artifact ${id}; nothing to re-pin`); continue; }
  const file = path.join(REPO_ROOT, artifact.path);
  if (!fs.existsSync(file)) throw new Error(`registered artifact ${id} is missing at ${artifact.path}`);
  const actual = sha256File(file);
  if (actual === artifact.sha256) { console.log(`  ${groundId}: ${id} unchanged (${actual.slice(0, 12)}…)`); continue; }
  console.log(`  ${groundId}: ${id} ${artifact.sha256.slice(0, 12)}… -> ${actual.slice(0, 12)}…`);
  artifact.sha256 = actual;
  changed++;
}
if (changed) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`  wrote ${path.relative(REPO_ROOT, manifestPath)} (${changed} artifact${changed === 1 ? '' : 's'} re-pinned)`);
}
