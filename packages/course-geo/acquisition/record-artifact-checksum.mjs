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
       --ground visby --path geo_data/course-v2/visby/vegetation/canopy-evidence.json

   Only an artifact the manifest already registers is touched: an id the
   manifest does not carry is reported and skipped, so the same workflow step
   serves grounds that pin the census (Puttom, Johannesberg, Ängsö) and grounds
   that do not (Upsala). The manifest is written back in the same 2-space JSON
   it is committed in, so the diff is the one line that changed.

   --path re-pins by the FILE a run rewrote rather than by the name a ground
   happened to give it, and it exists because an id is not a stable handle
   across grounds. canopy-evidence.json is registered as `canopy-evidence` at
   Johannesberg, `canopy-raster-acquisition` at Lidingö,
   `canopy-raster-evidence` at Ribbingsfors and `measured-canopy-evidence` at
   Visby -- four names for one file that every vegetation acquire rewrites --
   so a workflow step naming ids could only ever re-pin some of them, and the
   rest went red on their own evidence. A path no ground registers is reported
   and skipped, exactly as an unknown id is. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from '../manifest.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const ids = args.flatMap((value, index) => (value === '--id' && index + 1 < args.length ? [args[index + 1]] : []));
const paths = args.flatMap((value, index) => (value === '--path' && index + 1 < args.length ? [args[index + 1]] : []));
const groundId = flag('ground');
if (!groundId || !(ids.length || paths.length)) throw new Error('usage: --ground <id> [--id <artifact id>]... [--path <repo-relative file>]...');

const manifestPath = path.join(REPO_ROOT, 'geo_data', 'course-v2', groundId, 'source-manifest.json');
const text = fs.readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(text);
if (JSON.stringify(manifest, null, 2) + '\n' !== text.replace(/\r\n/g, '\n')) {
  throw new Error(`${path.relative(REPO_ROOT, manifestPath)} is not in the 2-space JSON this tool writes; refusing to reformat it`);
}
/* Resolve every selector to the artifact records it names, keeping the order
   the caller gave and never re-pinning the same record twice. */
const normalise = value => value.replaceAll('\\', '/');
const selected = [];
for (const id of ids) {
  const artifact = (manifest.artifacts || []).find(entry => entry.id === id);
  if (!artifact) { console.log(`  ${groundId}: no registered artifact ${id}; nothing to re-pin`); continue; }
  if (!selected.includes(artifact)) selected.push(artifact);
}
for (const wanted of paths.map(normalise)) {
  const matches = (manifest.artifacts || []).filter(entry => normalise(entry.path) === wanted);
  if (!matches.length) { console.log(`  ${groundId}: no registered artifact at ${wanted}; nothing to re-pin`); continue; }
  for (const artifact of matches) if (!selected.includes(artifact)) selected.push(artifact);
}
let changed = 0;
for (const artifact of selected) {
  const id = artifact.id;
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
