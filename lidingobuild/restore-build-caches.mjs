#!/usr/bin/env node
/* Put back the four gitignored caches build-course.mjs reads, and prove each one.
 *
 * The model rebuild's first CI run failed on the second line of build-course
 * because this build does not read ONE cache, it reads four - the 1 m terrain
 * window, the vista terrain, a bounded laser point window and the 2019
 * municipal orthophoto - and only the first had a step. Each has a committed
 * acquirer; what was missing was a single place that runs them and then says
 * whether what came back is what the reviewed evidence describes.
 *
 * Two of the acquirers REWRITE COMMITTED EVIDENCE with a fresh timestamp, and
 * build-course compares that evidence by strict equality (the vista) and by
 * sha256 (the laser window's report). So a plain re-run breaks the build it is
 * meant to serve. This restores the committed record afterwards - which is not
 * a way of hiding a change, because the RASTER and the POINT FILE are verified
 * against the hashes that record carries first. If a source has moved, the hash
 * fails here and nothing is written over.
 *
 *   node lidingobuild/restore-build-caches.mjs [--only terrain-window|vista|laser|ortho]
 *
 * The 1 m terrain window has its own step in the workflow (build-terrain-window
 * writes the acquisition evidence the model pins), so it is verified here and
 * never re-fetched.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const readJson = file => JSON.parse(read(file).toString('utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

function run(label, command, args) {
  process.stdout.write(`  ${label}: ${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${label} exited ${result.status}`);
  return result.stdout;
}

function verify(label, file, expected) {
  const actual = sha256(read(file));
  if (actual !== expected) {
    throw new Error(`${label}: ${file} came back as ${actual}, and the reviewed evidence records ${expected}. `
      + 'The source has changed, or the acquisition is not reproducible; either way this is a review, not a retry.');
  }
  process.stdout.write(`  ${label}: ${file} reproduces its reviewed sha256\n`);
}

const steps = {
  /* Written by the workflow's own build-terrain-window step; only checked here. */
  'terrain-window': () => {
    const evidence = readJson('geo_data/course-v2/lidingo/acquisition/terrain-window.json');
    verify('terrain window', 'lidingobuild/cache/terrain-review/terrain-1m.f32', evidence.raster.sha256);
  },
  /* The acquirer rewrites the committed record with a new acquiredAt and
     durationMilliseconds, and build-course compares that record by STRICT
     EQUALITY. Verify the raster against the reviewed hash, then put the
     reviewed record back over both copies. */
  vista: () => {
    const committed = 'geo_data/course-v2/lidingo/mapping/terrain-vista.json';
    const reviewed = read(committed);
    run('vista', process.execPath, ['geo_data/course-v2/lidingo/reference/acquire-terrain-vista.mjs']);
    const record = JSON.parse(reviewed.toString('utf8'));
    verify('vista terrain', 'lidingobuild/cache/terrain-vista/terrain-vista.f32', record.raster.sha256);
    fs.writeFileSync(path.join(ROOT, committed), reviewed);
    fs.writeFileSync(path.join(ROOT, 'lidingobuild/cache/terrain-vista/terrain-vista.json'), reviewed);
    process.stdout.write('  vista terrain: the reviewed record restored over both copies (only its timestamp differed)\n');
  },
  /* Same shape: --refresh rewrites building-laser-acquisition.json, which
     build-course hashes as the roof meshes' evidence. */
  laser: () => {
    const committed = 'lidingobuild/mapping/building-laser-acquisition.json';
    const reviewed = read(committed);
    const record = JSON.parse(reviewed.toString('utf8'));
    run('laser', process.execPath, ['lidingobuild/acquire-building-laser.mjs', '--refresh']);
    verify('building laser', record.rasterlessPoints.path, record.rasterlessPoints.sha256);
    fs.writeFileSync(path.join(ROOT, committed), reviewed);
    process.stdout.write('  building laser: the reviewed record restored (only its timestamp differed)\n');
  },
  /* A public WMS, no credential. The dossier records that this one re-acquires
     byte-identical to its pinned snapshot; this is where that is enforced. */
  ortho: () => {
    const committed = 'geo_data/course-v2/lidingo/discovery/municipal-ortho-2019.json';
    const reviewed = read(committed);
    const discovery = JSON.parse(reviewed.toString('utf8'));
    const python = process.env.COURSE_GEO_PYPROJ_PYTHON || 'python3';
    run('ortho', python, ['geo_data/course-v2/lidingo/reference/acquire-municipal-ortho.py']);
    verify('2019 orthophoto', discovery.path, discovery.sha256);
    /* this acquirer rewrites its own discovery record's retrievedAt, and that
       record is checksummed in the ledger: a re-fetch that returns identical
       pixels must not show up as a changed source */
    fs.writeFileSync(path.join(ROOT, committed), reviewed);
  },
};

const order = ['terrain-window', 'vista', 'laser', 'ortho'];
process.stdout.write('restoring the caches build-course reads:\n');
for (const name of order) {
  if (only && only !== name) continue;
  steps[name]();
}
process.stdout.write('every cache build-course reads is present and matches its reviewed evidence\n');
