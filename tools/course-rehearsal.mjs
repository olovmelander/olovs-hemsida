#!/usr/bin/env node
/* THE REHEARSAL: what the pipelines on GitHub run, run first, in a clean worktree of the commit to be pushed.

   node tools/course-rehearsal.mjs [--ground <id>] [--ref HEAD] [--base origin/main] [--only step,step] [--keep] [--dry-run]

   This machine holds private caches and built files that CI does not, so a check that passes in the working
   checkout can fail there (Bro Hof's first pull request did: a tool read a private cache). The rehearsal is the
   gate of stage 8, and until 27 November 2026 every session put it together by hand and met the same four things
   again. They are in here now:
   - a worktree of its own under .claude/worktrees, named by the time, since Windows keeps files of a removed one
     locked and the same name cannot be used twice;
   - the offline COPC reader's own dependencies (`npm ci --prefix packages/course-geo/copc-reader`), which the
     suite imports and the workspace does not install;
   - the first checkout's Pixi environment, used from inside the worktree (an environment cannot be moved or
     linked), with each Pixi task run as the command it stands for: the tasks' own self-test of PROJ cannot
     start on this machine;
   - the PROJ grid, which CI fetches and a worktree does not have: copied from the main checkout.

   The steps are the two pipelines a pull request runs (course-geo.yml and course-workflow.yml), the prepared-data
   check cloudflare.yml makes of the build (GitHub Pages builds no app since it was retired, 27 November), and the
   ground's walkthrough. A test holds this list to
   those files: a command added to a workflow fails it until it is rehearsed here or named in NOT_REHEARSED with
   the reason. One process at a time; a log a step under output/course-rehearsal; it stops at the first failure
   and keeps the worktree then, to be looked at. Uncommitted changes are not in the rehearsal: commit first. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PIXI } from '../packages/course-geo/toolchain/mapping-environment.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLCHAIN = 'packages/course-geo/toolchain';

/* What CI runs that is not run here, each with why. */
export const NOT_REHEARSED = {
  'python -m pip install -r packages/course-workflow/requirements-review.txt': 'CI installs its own Python for the overlay test; this machine\'s is the Pixi mapping environment',
  'python packages/course-workflow/source-overlays_test.py': 'the same: the overlay test runs in CI\'s Python',
  'bash tools/check-release-journeys.sh': 'the Cloudflare journeys need a local Worker and a browser; run them against the build before a pull request that changes the start menu, the map or a club',
};

/** The rehearsal's steps. `main` is the checkout whose Pixi environment is used, `baseSha` what the branch is compared with. */
export function rehearsalPlan({ groundId = null, main = ROOT, baseSha = '<the base commit>' } = {}) {
  const node = (...args) => ({ run: 'node', args });
  const pnpm = (...args) => ({ run: 'pnpm', args });
  const pixi = (...args) => ({ run: 'pixi', args: ['run', '--manifest-path', path.join(main, TOOLCHAIN, 'pixi.toml'), '--frozen', 'node', ...args] });
  const step = (id, what, ...commands) => ({ id, what, commands });
  return [
    step('install', 'the locked dependencies', pnpm('install', '--frozen-lockfile')),
    step('copc', 'the offline COPC reader\'s own dependencies', { run: 'npm', args: ['ci', '--prefix', 'packages/course-geo/copc-reader', '--ignore-scripts', '--no-audit', '--no-fund'] }),
    step('manifests', 'the source manifests', node('packages/course-geo/check-manifests.mjs')),
    step('controls', 'coordinate and datum controls', pixi('--test', 'packages/course-geo/proj-controls.node-test.mjs')),
    step('acquisition', 'the acquisition tests', pixi('--test', 'packages/course-geo/acquisition/acquisition.node-test.mjs')),
    step('hole-controls', 'every course\'s per-hole source controls', pixi('packages/course-geo/acquisition/plan-hole-source-controls.mjs')),
    step('synthetic', 'the synthetic v2 graph', node('packages/course-v2/check-synthetic.mjs')),
    { ...step('suite', 'the whole suite: vitest and every node test file', pnpm('test')), retry: true },
    step('renderer', 'the isolated renderer proof', node('packages/course-v2/check-renderer-build.mjs')),
    step('build', 'the player, and its isolated v2 debug chunk', pnpm('--filter', '@banvy/golf', 'build'), node('packages/course-v2/check-app-build.mjs')),
    step('prepared', 'the prepared data against the build', node('tools/check-prepared-startup.mjs', '--public', 'apps/golf/dist')),
    step('migration', 'the generated migration artifacts', pixi('packages/course-geo/migrate-legacy.mjs', '--check')),
    step('discovery', 'the source-discovery evidence', node('packages/course-geo/acquisition/check-discovery.mjs')),
    step('workflow', 'the production workflows: their stage lists, every configuration, every published ground',
      node('packages/course-workflow/production.mjs', '--ground', 'puttom', '--check-config'), node('packages/course-workflow/production.mjs', '--ground', 'johannesberg', '--check-config'),
      node('packages/course-workflow/cli.mjs', 'check'),
      node('packages/course-workflow/cli.mjs', 'audit', '--check', '--out', 'output/course-production/audit.json', '--markdown', 'output/course-production/audit.md')),
    step('check-new', 'a new ground\'s release review or acceptance', node('packages/course-workflow/cli.mjs', 'check-new', '--base-ref', baseSha)),
    step('walkthrough', 'the walkthrough and the catalogue table are current',
      ...(groundId ? [node('tools/course-walkthrough.mjs', '--ground', groundId, '--check')] : []), node('tools/course-walkthrough.mjs', '--catalogue', '--check')),
  ];
}

/** A step's command as it is typed, for the plan and the logs. */
export const shown = command => `${command.run === 'pixi' ? 'pixi run node' : command.run} ${(command.run === 'pixi' ? command.args.slice(5) : command.args).join(' ')}`;

function execute(command, cwd, log) {
  return new Promise(resolve => {
    const out = fs.createWriteStream(log, { flags: 'a' });
    out.write(`$ ${shown(command)}\n`);
    // pnpm and npm are command files on Windows: they start through the shell, as tools/gpu-pass.mjs starts pnpm
    const [program, args, shell] = command.run === 'node' ? [process.execPath, command.args, false]
      : command.run === 'pixi' ? [PIXI, command.args, false]
        : command.run === 'pnpm' ? ['corepack', ['pnpm', ...command.args], process.platform === 'win32']
          : [command.run, command.args, process.platform === 'win32'];
    const child = spawn(program, args, { cwd, env: process.env, shell });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on('close', code => { out.end(); resolve(code ?? 1); });
    child.on('error', error => { out.end(`${error.message}\n`); resolve(1); });
  });
}

const git = (args, cwd = ROOT) => { const run = spawnSync('git', args, { cwd, encoding: 'utf8' }); if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.trim()}`); return run.stdout.trim(); };

async function main() {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const groundId = flag('ground'), ref = flag('ref') ?? 'HEAD', base = flag('base') ?? 'origin/main', only = (flag('only') ?? '').split(',').filter(Boolean);
  const commit = git(['rev-parse', ref]), baseSha = git(['rev-parse', base]);
  // The repository's first checkout holds the Pixi environment and the PROJ grid; a worktree, where most sittings
  // work, has neither. The rehearsal is run from either, and its own worktree lies beside the others.
  const home = path.dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
  if (!fs.existsSync(path.join(home, TOOLCHAIN, '.pixi/envs'))) throw new Error(`no Pixi environment in ${home}: install it there (packages/course-geo/toolchain/README.md)`);
  let plan = rehearsalPlan({ groundId, baseSha, main: home });
  for (const id of only) if (!plan.some(step => step.id === id)) throw new Error(`no step ${id} (there are: ${plan.map(step => step.id).join(', ')})`);
  // a step asked for alone still needs what it runs on
  if (only.length) plan = plan.filter(step => only.includes(step.id) || step.id === 'install' || (step.id === 'copc' && only.includes('suite')) || (step.id === 'build' && only.includes('prepared')));
  if (argv.includes('--dry-run')) {
    console.log(`${commit.slice(0, 8)} against ${base} (${baseSha.slice(0, 8)}), in a worktree of its own\n`);
    for (const step of plan) console.log(`${step.id.padEnd(14)}${step.what}\n${step.commands.map(c => `              ${shown(c)}`).join('\n')}`);
    console.log(`\nnot rehearsed:\n${Object.entries(NOT_REHEARSED).map(([command, why]) => `  ${command}\n      ${why}`).join('\n')}`);
    return;
  }
  const dirty = git(['status', '--porcelain', '--untracked-files=no']);
  if (dirty) console.log(`Note: ${dirty.split('\n').length} tracked files have uncommitted changes. They are not in the rehearsal, which is of ${commit.slice(0, 8)}.\n`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // a short name: the installed packages lie deep, and Windows stops a path at 260 characters
  const worktree = path.join(home, '.claude/worktrees', `rh-${stamp.slice(5, 19).replaceAll('-', '')}`), logs = path.join(ROOT, 'output/course-rehearsal', stamp);
  fs.mkdirSync(logs, { recursive: true });
  git(['worktree', 'add', '--detach', worktree, commit]);
  // the PROJ grid is fetched data, not a private cache: CI fetches it, a worktree is given the main checkout's
  const grid = path.join(home, TOOLCHAIN, '.cache/proj');
  if (fs.existsSync(grid)) fs.cpSync(grid, path.join(worktree, TOOLCHAIN, '.cache/proj'), { recursive: true });
  console.log(`rehearsing ${commit.slice(0, 8)} in ${worktree}`);
  let failed = null;
  for (const [i, step] of plan.entries()) {
    const log = path.join(logs, `${String(i + 1).padStart(2, '0')}-${step.id}.log`), started = Date.now();
    process.stdout.write(`${step.id.padEnd(14)}`);
    const attempt = async () => { let code = 0; for (const command of step.commands) { code = await execute(command, worktree, log); if (code) break; } return code; };
    let code = await attempt(), again = false;
    // The suite is some 3,200 tests in a checkout that has never run them: one may time out cold, and on Windows a
    // temporary folder may still be held when a test tidies up. A second run says which it was, and both are told.
    if (code && step.retry) { again = true; fs.appendFileSync(log, '\n--- the step failed; run once more ---\n'); code = await attempt(); }
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(code ? `FAILED${again ? ' twice' : ''} (${seconds} s)` : again ? `ok on its second run (${seconds} s): the first failed, see ${path.relative(ROOT, log)}` : `ok (${seconds} s)`);
    if (code) { failed = { step, log }; break; }
  }
  if (failed) {
    console.log(`\n${fs.readFileSync(failed.log, 'utf8').trim().split('\n').slice(-25).join('\n')}\n\nlog: ${path.relative(ROOT, failed.log)}`);
    console.log(`The worktree is kept for a look: ${worktree} (remove the folder when done, then git worktree prune).`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nEvery step passed for ${commit.slice(0, 8)}. Not rehearsed: ${Object.keys(NOT_REHEARSED).length} commands (--dry-run lists them and why).`);
  if (argv.includes('--keep')) { console.log(`kept: ${worktree}`); return; }
  // git gives up on the installed packages' long paths on Windows ("Filename too long") and leaves the folder:
  // Node removes it, trying again while a file is still held, and git is then told that it is gone
  spawnSync('git', ['worktree', 'remove', '--force', worktree], { cwd: ROOT, encoding: 'utf8' });
  try { fs.rmSync(worktree, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch { /* said below */ }
  spawnSync('git', ['worktree', 'prune'], { cwd: ROOT });
  if (fs.existsSync(worktree)) console.log(`The worktree could not be removed yet (a file in it is still held): ${worktree}. Remove the folder later, then git worktree prune.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
