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
   afterwards (production.mjs --bake-promoted). Nothing is deployed or pushed. */
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--ground');
  assert(i > 0 && process.argv[i + 1], 'usage: promote.mjs --ground <id> [--dry-run]');
  const result = promote(ROOT, process.argv[i + 1], { dryRun: process.argv.includes('--dry-run') });
  if (result.dryRun) console.log(JSON.stringify({ ...result, add: result.add.length, same: result.same.length }, null, 1));
  else console.log(JSON.stringify(result, null, 1));
}
