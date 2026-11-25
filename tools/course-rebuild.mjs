#!/usr/bin/env node
/* A ground's build, in its one right order, from any step to any step.

   node tools/course-rebuild.mjs --ground <id> --dry-run                    the steps and their commands
   node tools/course-rebuild.mjs --ground <id> --from compile --to quality  run a part of it
   node tools/course-rebuild.mjs --ground <id> [--compare <older-photo.tif> --compare-captured <YYYY-MM-DD>]

   card  decisions  trace  decks  sand  sheets  review  layers  compile  tests  inventory  pin  configure  stages  promote
   prune  quality  map-land  walkthrough

   Changing one tee deck means re-running most of this, and each step reads what the one before it wrote. At Bro
   Hof the order lived in a shell script outside the repository, and was run six times. Here it is derived from
   the ground's own files (its production profile and trace configuration), runs one process at a time at low
   priority, writes a log a step, and stops at the first step that fails.

   `review` is a gate, not a job: it fails when the outlines changed since the recorded look at every ring, or
   when a second reviewer's doubt is unanswered. Look at the sheets the step before it drew and at the decks
   `decks` named, record the look (packages/course-geo/mapping/ring-review.mjs --record), give the blind sheets
   to a second reviewer, and continue with --from layers. `prune` only lists what could go. Nothing here uses the GPU or a browser,
   bakes prepared data or pushes: the first pictures and tools/gpu-pass.mjs come after, when the owner says so. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PIXI } from '../packages/course-geo/toolchain/mapping-environment.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLCHAIN = ['run', '--manifest-path', 'packages/course-geo/toolchain/pixi.toml', '--frozen'];
const exists = file => fs.existsSync(path.join(ROOT, file));

/** The ordered steps for one ground. Steps a ground has no files for (no tracer, no layer builder) are left out. */
export function rebuildPlan(groundId, { from = null, to = null, compare = [], compareCaptured = null, root = ROOT } = {}) {
  const has = file => fs.existsSync(path.join(root, file));
  const profile = JSON.parse(fs.readFileSync(path.join(root, `course-workflows/${groundId}/production.json`), 'utf8'));
  const builds = profile.courses.map(c => path.posix.dirname(c.model.path));
  const config = builds.map(b => `${b}/mapping/trace-config.json`).find(has) ?? null;
  const layers = builds.map(b => `${b}/mapping/build-layers.py`).find(has) ?? null;
  const node = (...args) => [process.execPath, ...args], python = (...args) => [PIXI, ...TOOLCHAIN.slice(0, 3), '-e', 'mapping', '--frozen', 'python', ...args];
  const toolchainNode = (...args) => [PIXI, ...TOOLCHAIN, 'node', ...args];
  const step = (id, what, commands, extra = {}) => ({ id, what, commands, ...extra });
  const plan = [
    ...(has(`course-workflows/${groundId}/ground.json`) ? [step('card', 'every table that names the ground agrees with its card', [node('packages/course-workflow/ground-card.mjs', '--ground', groundId, '--check')])] : []),
    ...(config ? [
      step('decisions', 'the decision files can be traced', [node('packages/course-geo/mapping/check-decisions.mjs', '--config', config)]),
      step('trace', 'greens, tees, fairways, bunkers and waste areas from the photo', [python('packages/course-geo/mapping/trace-course-surfaces.py', '--config', config, '--cache', `${path.posix.dirname(path.posix.dirname(config))}/cache/mapping`)]),
      step('decks', 'every tee deck against the terrain under it', [node('packages/course-geo/mapping/deck-ground.mjs', '--config', config, '--record')]),
      step('sand', 'the sand on the photo against the model, both ways', [python('packages/course-geo/mapping/audit-sand.py', '--config', config, ...(compare.length ? ['--compare', ...compare] : []), ...(compare.length && compareCaptured ? ['--compare-captured', compareCaptured] : []))]),
      step('sheets', 'every ring on the photo, worst score first, and again blind for a second reviewer', [false, true].map(blind =>
        python('packages/course-geo/mapping/render-ring-sheets.py', '--config', config, ...(compare.length ? ['--compare', ...compare] : []), ...(blind ? ['--blind'] : [])))),
      step('review', 'the look at every ring is recorded for these outlines', [...builds.filter(b => has(`${b}/mapping/trace-report.json`) || config).map(b => node('packages/course-geo/mapping/ring-review.mjs', '--build', b)),
        node('packages/course-geo/mapping/sand-audit.mjs', '--build', config.split('/')[0])],
        { gate: 'Look at the sheets and at the decks the step before named, record the look (ring-review.mjs --build <build> --record --reviewer "<who, on what>"), '
          + 'give the blind sheets to a second reviewer (.claude/agents/ring-reviewer.md; ring-review.mjs --second), '
          + 'say what each thing the sand audit named is (sand-audit.mjs --verdict or --fault), then continue with --from layers.' }),
    ] : []),
    ...(layers ? [step('layers', 'water, context and infrastructure', [python(layers)])] : []),
    step('compile', 'each routing\'s course model', builds.filter(b => has(`${b}/mapping/course-input.json`)).map(b => node('packages/course-geo/mapping/compile-grid-course.mjs', '--config', `${b}/mapping/course-input.json`))),
    step('tests', 'the builds\' own tests', builds.filter(b => has(`${b}/course.node-test.mjs`)).map(b => node('--test', '--test-concurrency=1', `${b}/course.node-test.mjs`))),
    // only a ground compiled here from EPSG:3006 layers has models to inventory this way
    step('inventory', 'the models in the source records', builds.some(b => has(`${b}/mapping/course-input.json`)) ? [toolchainNode('packages/course-geo/inventory-models.mjs', '--ground', groundId)] : []),
    step('pin', 'the production profile\'s checksums', [node('packages/course-workflow/pin-production.mjs', '--ground', groundId)]),
    step('configure', 'the workflow\'s stage inputs', [node('packages/course-workflow/production.mjs', '--ground', groundId, '--configure')]),
    step('stages', 'the six production stages', [toolchainNode('packages/course-workflow/cli.mjs', 'run', '--ground', groundId, '--through', 'validate')]),
    step('promote', 'the validated candidate into the published tree', [node('packages/course-workflow/promote.mjs', '--ground', groundId)]),
    step('prune', 'files no published generation names (listed, not removed)', [node('packages/course-workflow/promote.mjs', '--ground', groundId, '--prune')]),
    step('quality', 'the quality gate', [node('tools/check-course-quality.mjs', '--ground', groundId)]),
    step('map-land', 'the phone map\'s water and forest', [node('tools/bake-map-land.mjs')]),
    step('walkthrough', 'the walkthrough\'s generated parts', [node('tools/course-walkthrough.mjs', '--ground', groundId), node('tools/course-walkthrough.mjs', '--catalogue')]),
  ].filter(s => s.commands.length);
  const index = (id, fallback) => { if (!id) return fallback; const i = plan.findIndex(s => s.id === id); if (i < 0) throw new Error(`${groundId} has no step ${id} (it has: ${plan.map(s => s.id).join(', ')})`); return i; };
  const first = index(from, 0), last = index(to, plan.length - 1);
  if (last < first) throw new Error(`--to ${to} comes before --from ${from}`);
  return plan.slice(first, last + 1);
}

const shown = command => command.map((part, i) => (i === 0 ? path.basename(part).replace(/\.exe$/, '') : part)).join(' ');

function run(command, log) {
  return new Promise(resolve => {
    const out = fs.createWriteStream(log, { flags: 'a' });
    out.write(`$ ${shown(command)}\n`);
    const child = spawn(command[0], command.slice(1), { cwd: ROOT, env: process.env });
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* the priority is a courtesy */ }
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on('close', code => { out.end(); resolve(code ?? 1); });
    child.on('error', error => { out.end(`${error.message}\n`); resolve(1); });
  });
}

async function main() {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const groundId = flag('ground');
  if (!groundId || !exists(`course-workflows/${groundId}/production.json`)) throw new Error('usage: course-rebuild.mjs --ground <id> [--from <step>] [--to <step>] [--compare <older-photo.tif> --compare-captured <YYYY-MM-DD>] [--dry-run]');
  const plan = rebuildPlan(groundId, { from: flag('from'), to: flag('to'), compare: flag('compare') ? [flag('compare')] : [], compareCaptured: flag('compare-captured') });
  if (argv.includes('--dry-run')) {
    for (const step of plan) console.log(`${step.id.padEnd(12)}${step.what}\n${step.commands.map(c => `            ${shown(c)}`).join('\n')}`);
    return;
  }
  const dir = path.join(ROOT, 'output/course-rebuild', `${groundId}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [i, step] of plan.entries()) {
    const log = path.join(dir, `${String(i + 1).padStart(2, '0')}-${step.id}.log`), started = Date.now();
    process.stdout.write(`${step.id.padEnd(12)}`);
    let code = 0;
    for (const command of step.commands) { code = await run(command, log); if (code) break; }
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(code ? `FAILED (${seconds} s)` : `ok (${seconds} s)`);
    if (code) {
      console.log(fs.readFileSync(log, 'utf8').trim().split('\n').slice(-14).join('\n'));
      if (step.gate) console.log(`\n${step.gate}`);
      console.log(`\nlog: ${path.relative(ROOT, log)}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`done: ${plan.map(s => s.id).join(', ')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
