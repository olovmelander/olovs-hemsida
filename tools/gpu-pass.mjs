#!/usr/bin/env node
/* Everything a release needs from the GPU, in one sitting.

   node tools/gpu-pass.mjs [--only slug,slug] [--steps build,water,...] [--from tints] [--port 8641] [--dry-run]
   (PowerShell: $env:BANVY_GPU=1; node tools/gpu-pass.mjs)

   Bakes every course's prepared data on this checkout's source revision, with the app rebuilt between bakes
   (each bake changes the catalogue the next one boots from), then runs the checks that read the result:

     build   water   build   tints   build   vista   build   prepared   boot-hi   boot-lo   gallery   map

   One process at a time, at below-normal priority. A failed bake stops the run; a failed check is reported and
   the rest go on. Logs and summary.json land in output/gpu-pass/<time>. Posters are not here: choosing one is
   a judgement (tools/make-posters.mjs --candidates, then --write). Refuses to start without BANVY_GPU=1.

   ONE PORT A CHECKOUT (27 November). Several sessions bake at once in their own worktrees, and the server
   check asked only whether something answered on 8641: a second pass started while another was running
   found the first one's server, its own failed to bind in silence, and it baked and booted the OTHER
   checkout's build. A pass now takes the first free port from 8641 up by itself and says which; a port
   named with --port (or BANVY_GPU_PASS_PORT) is used as named, and refused if something already answers
   on it. A step's server must still be running when the step starts. */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PORT = 8641;

/** The ordered steps; `only` narrows the bakes and the checks to some courses. */
export function gpuPassPlan({ only = [], steps = [], from = null, port = DEFAULT_PORT } = {}) {
  const BASE = `http://127.0.0.1:${port}`;
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

const answers = async base => { try { return (await fetch(`${base}/courses/index.json`)).ok; } catch { return false; } };

const binds = port => new Promise(resolve => {
  const probe = net.createServer();
  probe.once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});
// free means that it can be bound here and that nothing answers there (a server bound to every address may let a second bind through)
const unheld = async port => (await binds(port)) && !(await answers(`http://127.0.0.1:${port}`));
/** The first port from `from` up that nothing holds: another session's pass keeps its own. */
export async function freePort(from = DEFAULT_PORT, tries = 40, isFree = unheld) {
  for (let port = from; port < from + tries; port++) if (await isFree(port)) return port;
  throw new Error(`no free port from ${from} to ${from + tries - 1}`);
}

async function serve(port) {
  const base = `http://127.0.0.1:${port}`;
  if (await answers(base)) throw new Error(`port ${port} is already served by another process (another checkout's pass?): use --port`);
  const child = spawn(process.execPath, ['tools/serve.mjs', 'apps/golf/dist', String(port)], { cwd: ROOT, stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  for (let i = 0; i < 50; i++) {
    if (exited) throw new Error(`this checkout's server on ${port} exited (the port is taken?)`);
    if (await answers(base)) return child;
    await new Promise(r => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('the server did not start');
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (k, d = null) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
  const list = k => (flag(k) ?? '').split(',').filter(Boolean);
  const named = flag('port') ?? process.env.BANVY_GPU_PASS_PORT ?? null, dry = args.includes('--dry-run');
  const port = named === null ? (dry ? DEFAULT_PORT : await freePort()) : Number(named);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`--port ${port} is not a port`);
  const plan = gpuPassPlan({ only: list('only'), steps: list('steps'), from: flag('from'), port });
  if (dry) { for (const s of plan) console.log(s.id.padEnd(15), s.command.slice(1).join(' ')); return; }
  if (process.env.BANVY_GPU !== '1') throw new Error('set BANVY_GPU=1: these steps need the real GPU (SwiftShader draws full courses black)');
  console.log(`serving this checkout on port ${port}${named === null && port !== DEFAULT_PORT ? ` (${DEFAULT_PORT} is taken, by another session's pass?)` : ''}`);
  const dir = path.join(ROOT, 'output/gpu-pass', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const results = [];
  for (const [i, step] of plan.entries()) {
    const log = path.join(dir, `${String(i + 1).padStart(2, '0')}-${step.id}.log`), started = Date.now();
    process.stdout.write(`${step.id} ... `);
    const server = step.serves ? await serve(port) : null;
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
