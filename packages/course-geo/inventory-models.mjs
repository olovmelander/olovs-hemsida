#!/usr/bin/env node
/* Inventory a grid-authored ground's compiled models, after the last mapping change and before the production run.

   node packages/course-geo/inventory-models.mjs --ground <id> [--check]
   (inside the locked Pixi toolchain: the migration verifies PROJ first)

   1. Each routing's course-model.json becomes a checksummed `legacy-*` artifact of the source manifest.
   2. migrate-legacy.mjs writes the same models back in EPSG:3006 (an exact translation) and their residual report,
      which become artifacts too.
   3. The per-hole source controls learn each routing's migrated model and hash (hole-source-controls.mjs).

   The ground graph pins the source manifest, so this comes before `production.mjs --configure`. --check writes
   nothing and fails when any of the three is out of step with the models. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONTROLS = 'packages/course-geo/acquisition/hole-source-controls.mjs';
const sha = file => createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const key = slug => (/^[a-z]+$/.test(slug) ? slug : `'${slug}'`);

/** The manifest's artifact ids and the migration's output names, as migration-inputs.mjs derives them. */
export function modelArtifacts(groundId, courses) {
  const used = new Set();
  return courses.map((course, i) => {
    const id = i === 0 ? 'legacy-course-model' : `legacy-${course.slug.startsWith(`${groundId}-`) ? course.slug.slice(groundId.length + 1) : course.slug}-model`;
    let output = 'course-model.epsg3006.json';
    if (used.has(output)) output = `${id.replace(/^legacy-/, '')}.epsg3006.json`;
    assert(!used.has(output), `colliding migration output ${output}`);
    used.add(output);
    return { slug: course.slug, id, path: course.model, output: `geo_data/course-v2/${groundId}/migration/${output}`,
      outputId: `migration-${id.replace(/^legacy-/, '')}-epsg3006` };
  });
}

/** hole-source-controls.mjs with each routing's path and hash set (added after the opening brace when new). */
export function registerModels(text, models) {
  let out = text;
  const set = (table, slug, value) => {
    const line = new RegExp(`(\\n  (?:'${slug}'|${slug.replace(/-/g, '\\-')}): )'[^']*'`);
    const start = out.indexOf(`export const ${table} = Object.freeze({`), end = out.indexOf('\n});', start);
    assert(start >= 0 && end > start, `${table} not found`);
    let body = out.slice(start, end);
    body = line.test(body) ? body.replace(line, `$1'${value}'`) : body.replace('Object.freeze({', `Object.freeze({\n  ${key(slug)}: '${value}',`);
    out = out.slice(0, start) + body + out.slice(end);
  };
  for (const m of [...models].reverse()) {
    set('COURSE_MODEL_PATHS', m.slug, m.output);
    set('COURSE_MODEL_SHA256', m.slug, m.outputSha256);
  }
  return out;
}

function artifact(manifest, entry) {
  const i = manifest.artifacts.findIndex(a => a.id === entry.id);
  if (i < 0) manifest.artifacts.push(entry);
  else manifest.artifacts[i] = { ...manifest.artifacts[i], ...entry };
}

export function inventoryModels(groundId, { check = false } = {}) {
  const manifestPath = `geo_data/course-v2/${groundId}/source-manifest.json`;
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, manifestPath), 'utf8'));
  assert(manifest.legacyFrame?.projectedOriginEpsg3006, `${groundId} is not grid-authored; migrate it as a legacy ground`);
  const production = JSON.parse(fs.readFileSync(path.join(ROOT, `course-workflows/${groundId}/production.json`), 'utf8'));
  const models = modelArtifacts(groundId, production.courses.map(c => ({ slug: c.slug, model: c.model.path })));
  const derivedFrom = manifest.sources.filter(s => ['acquired', 'approved'].includes(s.lifecycle)).map(s => s.id);
  const report = `geo_data/course-v2/${groundId}/migration/residual-report.json`;
  const migrate = mode => {
    const run = spawnSync(process.execPath, ['packages/course-geo/migrate-legacy.mjs', mode, '--ground', groundId], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr || run.stdout);
  };
  if (!check) {
    for (const m of models) artifact(manifest, { id: m.id, kind: 'composite', path: m.path, sha256: sha(m.path), derivedFrom, use: 'migration-only',
      notes: 'Compiled from EPSG:3006 layers by compile-grid-course.mjs: exact projected local metres and RH 2000 heights. Survey gates remain open.' });
    fs.writeFileSync(path.join(ROOT, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
    migrate('--write');
    for (const m of models) artifact(manifest, { id: m.outputId, kind: 'composite', path: m.output, sha256: sha(m.output), derivedFrom, use: 'migration-only',
      notes: 'Exact translation back to EPSG:3006, preserving source coordinates and RH 2000 heights.' });
    artifact(manifest, { id: 'migration-residual-report', kind: 'control', path: report, sha256: sha(report), derivedFrom, use: 'migration-only',
      notes: 'Deterministic frame translation audit, not independent survey controls.' });
    fs.writeFileSync(path.join(ROOT, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const m of models) m.outputSha256 = sha(m.output);
    const controls = path.join(ROOT, CONTROLS);
    fs.writeFileSync(controls, registerModels(fs.readFileSync(controls, 'utf8'), models));
  } else {
    migrate('--check');
    const controls = fs.readFileSync(path.join(ROOT, CONTROLS), 'utf8');
    for (const m of models) {
      m.outputSha256 = sha(m.output);
      for (const [id, file] of [[m.id, m.path], [m.outputId, m.output]]) {
        const a = manifest.artifacts.find(entry => entry.id === id);
        assert(a && a.path === file && a.sha256 === sha(file), `${groundId}: ${id} is out of step with ${file}`);
      }
    }
    assert.equal(registerModels(controls, models), controls, `${CONTROLS} is out of step with ${groundId}'s migrated models`);
  }
  return { groundId, check, models: models.map(m => ({ slug: m.slug, model: m.path, migrated: m.output, sha256: m.outputSha256 })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--ground');
  assert(i > 0 && process.argv[i + 1], 'usage: inventory-models.mjs --ground <id> [--check]');
  console.log(JSON.stringify(inventoryModels(process.argv[i + 1], { check: process.argv.includes('--check') }), null, 1));
}
