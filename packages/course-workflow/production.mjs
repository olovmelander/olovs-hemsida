#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { loadProduction, inspectInputs, stageInputFiles } from './production-inputs.mjs';
import { compileMapping } from './production-mapping.mjs';
import { executeProductionStage, capturePlan } from './production-stages.mjs';
import { safePath, writeJson, readJson, inventory, digest } from './io.mjs';
import { STAGES, assertWorkflow } from './standard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function verifyCaptureCandidate(ctx, built) {
  assert(built.startsWith(`output/course-production/${ctx.groundId}/`), 'prepared player must be isolated in this ground’s review output directory');
  assert(fs.statSync(safePath(ctx.root, `${built}/index.html`)).isFile(), 'build the supported player first');
  const validation = readJson(ctx.root, `${ctx.stageRoot}/validate/validation.json`);
  assert.equal(validation.groundId, ctx.groundId);
  assert.equal(validation.structuralMappingErrors.length, 0);
  const candidate = inventory(ctx.root, [ctx.workflow.publicRoot]);
  assert.deepEqual(candidate, validation.candidateFiles, 'candidate changed since validation');
  const files = Object.keys(candidate);
  const hashes = {};
  for (const file of files) {
    if (file.endsWith('/')) continue;
    const relative = file.slice(ctx.workflow.publicRoot.length + 1);
    const actual = digest(fs.readFileSync(safePath(ctx.root, `${built}/${relative}`)));
    assert.equal(actual, digest(fs.readFileSync(safePath(ctx.root, file))), `served candidate differs: ${relative}`);
    hashes[relative] = actual;
  }
  return hashes;
}
export function configuredWorkflow(ctx) {
  const w = structuredClone(ctx.workflow), base = ctx.stageRoot;
  w.watch = [...new Set([...w.watch, ctx.configPath, 'geobuild/mapping', 'geobuild/lib.mjs',
    'tools/build-startup-packs.mjs', 'packages/course-geo/toolchain/pixi.lock'])];
  const inputs = stageInputFiles(ctx);
  for (const [i, stage] of STAGES.entries()) {
    const previous = i ? STAGES[i - 1] : null;
    w.stages[stage] = {
      command: ['node', 'packages/course-workflow/production.mjs', '--ground', ctx.groundId, '--stage', stage],
      inputs: stage === 'sources' ? inputs : [ctx.configPath,
        ...(stage === 'terrain' ? inputs.filter(p => p.includes('-ground-rings/') || p.includes('/grounds/')) : []),
        ...(stage === 'mapping' ? inputs.filter(p => ctx.config.courses.some(c => p.startsWith(`${c.player.build}/`)) || p === ctx.workflow.sourceManifest) : []),
        ...(stage === 'vegetation' ? inputs.filter(p => p.includes('-vegetation/') || p.includes('/objects/')) : []),
        `${base}/sources`,
        ...(previous && previous !== 'sources' ? [previous === 'assemble' ? w.publicRoot : `${base}/${previous}`] : []),
        ...(['vegetation', 'assemble'].includes(stage) ? [`${base}/terrain`] : []),
        ...(stage === 'assemble' || stage === 'validate' ? [`${base}/mapping`] : [])],
      outputs: [stage === 'assemble' ? w.publicRoot : `${base}/${stage}`],
    };
    w.stages[stage].inputs = [...new Set(w.stages[stage].inputs)].sort();
  }
  return assertWorkflow(w);
}

export async function main(argv = process.argv.slice(2), root = ROOT) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('node packages/course-workflow/production.mjs --ground ID (--inspect | --prepare-review [--out PATH] | --configure | --check-config | --capture --built PATH --job ID)\nBuild stages through: pnpm course run --ground ID --through validate\nSee docs/course-production-integration.md for pinned inputs, acquisition and review commands.');
    return 0;
  }
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    assert(['--ground', '--stage', '--out', '--inspect', '--prepare-review', '--configure', '--check-config', '--capture', '--built', '--job'].includes(name), `unknown option ${name}`);
    assert(!Object.hasOwn(options, name), `duplicate option ${name}`);
    if (['--ground', '--stage', '--out', '--built', '--job'].includes(name)) { assert(argv[i+1] && !argv[i+1].startsWith('--'), `${name} needs a value`); options[name] = argv[++i]; }
    else options[name] = true;
  }
  const ctx = loadProduction(root, options['--ground']);
  const actions = ['--inspect', '--prepare-review', '--configure', '--check-config', '--stage', '--capture'].filter(k => options[k]);
  assert.equal(actions.length, 1, 'choose exactly one action: --inspect, --prepare-review, --configure, --check-config or --stage');
  if (options['--out']) assert(options['--out'].startsWith(`output/course-production/${ctx.groundId}/`), '--out must be in this ground’s review output directory');
  if (options['--built'] || options['--job']) assert(options['--capture'], '--built and --job require --capture');
  let result;
  if (options['--configure'] || options['--check-config']) {
    const w = configuredWorkflow(ctx);
    if (options['--check-config']) assert.deepEqual(ctx.workflow, w, 'workflow dependency lists are stale; run --configure and review the diff');
    else writeJson(root, `course-workflows/${ctx.groundId}/workflow.json`, w);
    result = { groundId: ctx.groundId, stages: STAGES.length, action: options['--configure'] ? 'configured' : 'checked' };
  } else if (options['--inspect']) {
    result = inspectInputs(ctx);
    const out = options['--out'] || `output/course-production/${ctx.groundId}/input-preflight.json`;
    writeJson(root, out, result);
    console.log(JSON.stringify({ report: out, readyToBuild: result.readyToBuild, missingOrInvalidInputs: result.errors.length,
      errors: result.errors.slice(0, 12), geographicApproval: false }, null, 2));
    return result.readyToBuild ? 0 : 1;
  } else if (options['--prepare-review']) {
    const out = options['--out'] || `output/course-production/${ctx.groundId}/mapping-review`;
    assert(!fs.existsSync(safePath(root, out)), `${out} exists; use a fresh --out to retain prior evidence`);
    result = compileMapping(ctx, out);
    writeJson(root, `${out}/capture-plan.json`, capturePlan(ctx));
    result = { ...result, out, buildReceipt: 'not-created', scope: 'mapping-only; does not complete any production stage' };
  } else if (options['--capture']) {
    assert(options['--built'] && options['--job'], '--capture requires --built and --job');
    const job = capturePlan(ctx).jobs.find(j => j.id === options['--job']);
    assert(job, 'unknown capture job; read capture-plan.json');
    const hashes = verifyCaptureCandidate(ctx, options['--built']);
    const out = options['--out'] || `output/course-production/${ctx.groundId}/captures/${job.id}`;
    assert(!fs.existsSync(safePath(root, out)), 'capture output exists; use a fresh --out');
    const command = [...job.command]; command[command.indexOf('--out') + 1] = out;
    command.push('--root', options['--built']);
    const child = spawnSync(command[0], command.slice(1), { cwd: root, stdio: 'inherit' });
    let identityError = null;
    try { assert.deepEqual(verifyCaptureCandidate(ctx, options['--built']), hashes, 'candidate changed during capture'); }
    catch (e) { identityError = e.message; }
    result = { job: job.id, command, candidateFiles: hashes, status: child.status === 0 ? 'captured-awaiting-review' : 'failed',
      geographicApproval: false, hardwareAcceptance: false, error: child.error?.message || identityError };
    if (result.error) result.status = 'failed';
    // An interrupted or unsuccessful browser run is evidence of failure, not a passing gate.
    writeJson(root, `${out}/candidate-binding.json`, result);
    if (result.status === 'failed') return 1;
  } else {
    assert.equal(process.env.BANVY_WORKFLOW_GROUND, ctx.groundId, 'run stages through pnpm course run so prerequisites and receipts are enforced');
    assert.equal(process.env.BANVY_WORKFLOW_PUBLIC_ROOT, safePath(root, ctx.workflow.publicRoot));
    assert.deepEqual(ctx.workflow, configuredWorkflow(ctx), 'workflow dependency lists are stale');
    result = await executeProductionStage(ctx, options['--stage']);
  }
  console.log(JSON.stringify(result, null, 2)); return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
