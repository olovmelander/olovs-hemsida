#!/usr/bin/env node
/* Merge one validated candidate into apps/golf/public without rebuilding it.

   node packages/course-workflow/promote.mjs --ground <id> [--dry-run]

   - The candidate must be exactly the one the `validate` stage inventoried.
   - Content-addressed files are added, never replaced: a file already published
     under the same name must hold the same bytes.
   - The v2 catalogue gains (or moves) only this ground's entries; every other
     ground's entry is kept byte for byte. The player catalogue's rows come from
     emit-manifest, with the candidate's own startup record.
   - The previous generation stays on disk for rollback.

   Prepared tints, water, vista and posters are not part of a candidate: bake them
   afterwards (tools/gpu-pass.mjs). Nothing is deployed or pushed.

   node packages/course-workflow/promote.mjs --ground <id> --prune [--apply]

   A ground that is promoted more than once leaves files no published generation names. --prune lists them, and
   with --apply removes them. It only ever touches files named by their own checksum, under this ground's and
   its routings' folders, that neither catalogue, no course manifest and no ground manifest still on disk refers
   to. Every generation whose ground manifest is still there is kept whole, so a rollback stays possible: remove
   an old ground manifest first to let its files go. Posters, packs and anything not named by a checksum are
   never touched. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadProduction } from './production-inputs.mjs';
import { digest, inventory, readJson, safePath } from './io.mjs';
import { canonicalJson } from '../course-v2/canonical-json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CATALOGUES = new Set(['courses/index.json', 'courses/v2-index.json', 'assembly-report.json']);

/** The published v2 catalogue with this ground's entries replaced; every other entry is untouched. */
export function mergeRoot(published, candidate, groundId) {
  assert.equal(published.schemaVersion, candidate.schemaVersion);
  assert(candidate.courses.length && candidate.courses.every(c => c.groundId === groundId), 'the candidate carries another ground');
  const own = new Set(candidate.courses.map(c => c.slug));
  for (const c of published.courses) assert(c.groundId === groundId || !own.has(c.slug), `${c.slug} belongs to ${c.groundId}`);
  const dropped = published.courses.filter(c => c.groundId === groundId && !own.has(c.slug));
  assert.equal(dropped.length, 0, `the candidate leaves out published routings: ${dropped.map(c => c.slug).join(', ')}`);
  const courses = [...published.courses.filter(c => c.groundId !== groundId), ...candidate.courses]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { ...published, courses };
}

export function promotionPlan(root, candidateRoot, publicRoot) {
  const plan = { add: [], same: [], replace: [] };
  for (const file of Object.keys(inventory(root, [candidateRoot]))) {
    const relative = file.slice(candidateRoot.length + 1);
    if (!relative || CATALOGUES.has(relative)) continue;
    const bytes = fs.readFileSync(safePath(root, file));
    const target = path.join(root, publicRoot, relative);
    if (!fs.existsSync(target)) { plan.add.push(relative); continue; }
    const same = digest(fs.readFileSync(target)) === digest(bytes);
    if (same) plan.same.push(relative);
    else {
      assert(!/[a-f0-9]{64}\.[a-z0-9]+$/.test(relative), `${relative}: a content-addressed file holds different bytes`);
      plan.replace.push(relative);
    }
  }
  return plan;
}

export function promote(root, groundId, { dryRun = false, publicRoot = 'apps/golf/public', emit = true } = {}) {
  const ctx = loadProduction(root, groundId);
  const validation = readJson(root, `${ctx.stageRoot}/validate/validation.json`);
  assert.equal(validation.groundId, groundId);
  assert.equal(validation.structuralMappingErrors.length, 0);
  assert.deepEqual(inventory(root, [ctx.workflow.publicRoot]), validation.candidateFiles, 'the candidate changed since it was validated');
  const plan = promotionPlan(root, ctx.workflow.publicRoot, publicRoot);
  const rootFile = path.join(root, publicRoot, 'courses/v2-index.json');
  const published = JSON.parse(fs.readFileSync(rootFile, 'utf8'));
  const merged = mergeRoot(published, readJson(root, `${ctx.workflow.publicRoot}/courses/v2-index.json`), groundId);
  if (dryRun) return { groundId, dryRun: true, ...plan, courses: merged.courses.length };
  for (const relative of [...plan.add, ...plan.replace]) {
    const target = path.join(root, publicRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(safePath(root, `${ctx.workflow.publicRoot}/${relative}`), target);
  }
  fs.writeFileSync(rootFile, canonicalJson(merged)); // the published catalogue is canonical JSON, no newline
  const staged = readJson(root, `${ctx.workflow.publicRoot}/courses/index.json`);
  if (emit) {
    for (const course of ctx.config.courses) {
      const run = spawnSync(process.execPath, ['packages/course-pack/emit-manifest.mjs', `--only=${course.slug}`], { cwd: root, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
    }
    const indexFile = path.join(root, publicRoot, 'courses/index.json');
    const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    for (const course of ctx.config.courses) {
      const row = index.courses.find(c => c.slug === course.slug), from = staged.courses.find(c => c.slug === course.slug);
      assert.equal(row.sha256, from.sha256, `${course.slug}: the published pack is not the candidate's`);
      if (from.startup) row.startup = from.startup;
    }
    fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 1)}\n`);
  }
  return { groundId, added: plan.add.length, same: plan.same.length, replaced: plan.replace, courses: merged.courses.length };
}

const HASH_NAMED = /(?:^|[-.])[a-f0-9]{64}\.[a-z0-9]+$/;

/** Checksum-named files of one ground that nothing published refers to any more. */
export function prunePlan(root, groundId, { publicRoot = 'apps/golf/public' } = {}) {
  const read = relative => JSON.parse(fs.readFileSync(path.join(root, publicRoot, relative), 'utf8'));
  const player = read('courses/index.json').courses, v2 = read('courses/v2-index.json').courses.filter(c => c.groundId === groundId);
  assert(v2.length, `${groundId}: no published routing`);
  const slugs = v2.map(c => c.slug), folders = [`grounds/${groundId}`, ...slugs.map(slug => `courses/${slug}`)];
  const refs = new Set();
  const walk = value => {
    if (typeof value === 'string') { if (folders.some(folder => value.startsWith(`${folder}/`))) refs.add(value); }
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(player.filter(c => slugs.includes(c.slug)));
  walk(v2);
  const all = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
  const files = folders.flatMap(folder => all(path.join(root, publicRoot, folder))).map(file => path.relative(path.join(root, publicRoot), file).split(path.sep).join('/'));
  for (const file of files) if (/^grounds\/[^/]+\/ground-v2-[a-f0-9]{64}\.json$/.test(file)) refs.add(file); // every generation still on disk is kept
  for (const file of files) { // and so is each routing's manifest of such a generation
    if (!/^courses\/[^/]+\/course-v2-[a-f0-9]{64}\.json$/.test(file)) continue;
    const ground = JSON.parse(fs.readFileSync(path.join(root, publicRoot, file), 'utf8')).groundManifest?.url;
    if (ground && refs.has(ground)) refs.add(file);
  }
  const seen = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const ref of [...refs]) {
      if (seen.has(ref) || !ref.endsWith('.json')) continue;
      seen.add(ref);
      const file = path.join(root, publicRoot, ref);
      if (!fs.existsSync(file)) continue;
      const before = refs.size;
      walk(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (refs.size > before) grew = true;
    }
  }
  /* Only what the build and the bakes write. A ground folder is managed where a kept generation has files (terrain,
     objects, stands, startup); a routing's folder holds its manifests, its routing chunks, its scorecard and its
     baked records. Anything else named by a checksum may be loaded by name from code (Lidingö's measured water is),
     so it is left alone. */
  const managed = new Set([...refs].filter(ref => ref.startsWith('grounds/')).map(ref => path.posix.dirname(ref)));
  const built = file => (file.startsWith('grounds/') ? managed.has(path.posix.dirname(file)) && !/\/ground-v2-[a-f0-9]{64}\.json$/.test(file)
    : /^courses\/[^/]+\/(?:(?:course-v2|scorecard)-[a-f0-9]{64}\.json$|(?:prepared|routing)\/)/.test(file));
  const orphans = files.filter(file => HASH_NAMED.test(path.basename(file)) && built(file) && !refs.has(file)).sort();
  return { groundId, generations: files.filter(file => /ground-v2-[a-f0-9]{64}\.json$/.test(file)).length, kept: files.length - orphans.length, orphans,
    bytes: orphans.reduce((n, file) => n + fs.statSync(path.join(root, publicRoot, file)).size, 0) };
}

export function prune(root, groundId, { publicRoot = 'apps/golf/public', apply = false } = {}) {
  const plan = prunePlan(root, groundId, { publicRoot });
  if (apply) for (const file of plan.orphans) fs.unlinkSync(path.join(root, publicRoot, file));
  return { ...plan, applied: apply };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--ground');
  assert(i > 0 && process.argv[i + 1], 'usage: promote.mjs --ground <id> [--dry-run] | --prune [--apply]');
  if (process.argv.includes('--prune')) {
    const done = prune(ROOT, process.argv[i + 1], { apply: process.argv.includes('--apply') });
    console.log(JSON.stringify({ ...done, orphans: done.orphans.length > 12 ? [...done.orphans.slice(0, 12), `and ${done.orphans.length - 12} more`] : done.orphans }, null, 1));
    process.exit(0);
  }
  const result = promote(ROOT, process.argv[i + 1], { dryRun: process.argv.includes('--dry-run') });
  if (result.dryRun) console.log(JSON.stringify({ ...result, add: result.add.length, same: result.same.length }, null, 1));
  else console.log(JSON.stringify(result, null, 1));
}
