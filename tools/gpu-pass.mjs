#!/usr/bin/env node
/* Everything a release needs from the GPU, in one sitting.

   node tools/gpu-pass.mjs [--only slug,slug] [--steps build,water,...] [--from tints] [--dry-run]
   (PowerShell: $env:BANVY_GPU=1; node tools/gpu-pass.mjs)

   Bakes every course's prepared data on this checkout's source revision, with the app rebuilt between bakes
   (each bake changes the catalogue the next one boots from), then runs the checks that read the result:

     build   water   build   tints   build   vista   build   prepared   boot-hi   boot-lo   gallery   map

   One process at a time, at below-normal priority. A failed bake stops the run; a failed check is reported and
   the rest go on. Logs and summary.json land in output/gpu-pass/<time>. Posters are not here: choosing one is
   a judgement (tools/make-posters.mjs --candidates, then --write). Refuses to start without BANVY_GPU=1. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8641, BASE = `http://127.0.0.1:${PORT}`;

/** The ordered steps; `only` narrows the bakes and the checks to some courses. */
export function gpuPassPlan({ only = [], steps = [], from = null } = {}) {
  const list = only.join(','), onlyArg = list ? ['--only', list] : [], courseArg = list ? ['--course', list] : [];
  const node = (id, ...args) => ({ id, command: [process.execPath, ...args] });
  const build = { id: 'build', command: ['corepack', 'pnpm', '--filter', '@banvy/golf', 'build'], bake: true };
  const bake = (id, tool) => ({ ...node(id, `tools/${tool}.mjs`, BASE, ...onlyArg), bake: true, serves: true });
  const check = (id, ...args) => ({ ...node(id, ...args), serves: true });
  const plan = [
    build, bake('water', 'bake-water'), build, bake('tints', 'bake-ground-tints'), build, bake('vista', 'bake-vista'), build,
    node('prepared', 'tools/check-prepared-startup.mjs'),
    check('prepared-water', 'tools/check-prepared-water.mjs', BASE, ...onlyArg),
    ...['hi', 'lo'].map(q => check(`boot-${q}`, 'tools/check-gpu-clean-boot.mjs', '--base', BASE, '--quality', q,
      '--out', `output/gpu-pass/boot-${q}.json`, ...courseArg)),
    check('gallery', 'tools/gfx-gallery.mjs', '--base', BASE, '--label', 'gpu-pass'),
    check('map', 'tools/map-gallery.mjs', '--url', `${BASE}/`, '--label', 'gpu-pass'),
  ];
  const start = from ? plan.findIndex(s => s.id === from) : 0;
  if (start < 0) throw new Error(`no step ${from}`);
  // a run that starts late still needs the build it boots from
  const tail = start > 0 && plan[start].id !== 'build' ? [build, ...plan.slice(start)] : plan.slice(start);
  return steps.length ? tail.filter(s => steps.includes(s.id)) : tail;
}

const run = (command, log) => new Promise(resolve => {
  const out = fs.createWriteStream(log);
  const child = spawn(command[0], command.slice(1), { cwd: ROOT, env: process.env, shell: process.platform === 'win32' && command[0] === 'corepack' });
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* the priority is a courtesy */ }
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  child.on('close', code => resolve(code ?? 1));
  child.on('error', () => resolve(1));
});

async function serve() {
  const child = spawn(process.execPath, ['tools/serve.mjs', 'apps/golf/dist', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/courses/index.json`)).ok) return child; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('the server did not start');
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (k, d = null) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
  const list = k => (flag(k) ?? '').split(',').filter(Boolean);
  const plan = gpuPassPlan({ only: list('only'), steps: list('steps'), from: flag('from') });
  if (args.includes('--dry-run')) { for (const s of plan) console.log(s.id.padEnd(15), s.command.slice(1).join(' ')); return; }
  if (process.env.BANVY_GPU !== '1') throw new Error('set BANVY_GPU=1: these steps need the real GPU (SwiftShader draws full courses black)');
  const dir = path.join(ROOT, 'output/gpu-pass', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const [i, step] of plan.entries()) {
    const log = path.join(dir, `${String(i + 1).padStart(2, '0')}-${step.id}.log`), started = Date.now();
    process.stdout.write(`${step.id} ... `);
    const server = step.serves ? await serve() : null;
    const code = await run(step.command, log);
    server?.kill();
    const seconds = Math.round((Date.now() - started) / 1000);
    results.push({ id: step.id, ok: code === 0, seconds, log: path.relative(ROOT, log) });
    console.log(code === 0 ? `ok (${seconds} s)` : `FAILED (${seconds} s), see ${path.relative(ROOT, log)}`);
    fs.writeFileSync(path.join(dir, 'summary.json'), `${JSON.stringify(results, null, 1)}\n`);
    if (code !== 0 && step.bake) throw new Error(`${step.id} failed; nothing after it was run`);
  }
  const failed = results.filter(r => !r.ok);
  console.log(failed.length ? `${failed.length} check(s) failed: ${failed.map(f => f.id).join(', ')}` : 'all steps passed');
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
