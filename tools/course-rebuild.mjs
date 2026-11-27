#!/usr/bin/env node
/* A ground's build, in its one right order, from any step to any step.

   node tools/course-rebuild.mjs --ground <id> --dry-run                    the steps and their commands
   node tools/course-rebuild.mjs --ground <id> --from compile --to quality  run a part of it
   node tools/course-rebuild.mjs --ground <id> [--compare <older-photo.tif> --compare-captured <YYYY-MM-DD>]

   card  decisions  trace  decks  sand  sheets  review  layers  compile  tests  inventory  pin  configure  stages  promote
   prune  roofs  quality  map-land  map-buildings  walkthrough

   Changing one tee deck means re-running most of this, and each step reads what the one before it wrote. At Bro
   Hof the order lived in a shell script outside the repository, and was run six times. Here it is derived from
   the ground's own files (its card, its trace configuration and, once it has one, its production profile), runs
   one process at a time at low priority, writes a log a step, and stops at the first step that fails. A ground
   has the steps it has files for: a new one traces from its card alone, long before it has a profile
   (--to review), and an older one with its own builder has the looks and what follows a republished pack.

   `review` is a gate, not a job: it fails when a ring is new or has moved since it was looked at, or when a
   second reviewer's doubt is unanswered. `sheets` draws those rings and no others: a look holds for a ring until
   the ring moves (ring-review.mjs). Look at the sheets the step before it drew and at the decks
   `decks` named, record the look (packages/course-geo/mapping/ring-review.mjs --record), give the blind sheets
   to a second reviewer, and continue with --from layers. `prune` only lists what could go. Nothing here uses the GPU or a browser,
   bakes prepared data or pushes: the first pictures and tools/gpu-pass.mjs come after. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PIXI } from '../packages/course-geo/toolchain/mapping-environment.mjs';
import { looksOwed } from '../packages/course-geo/mapping/ring-review.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOLCHAIN = ['run', '--manifest-path', 'packages/course-geo/toolchain/pixi.toml', '--frozen'];

/** A ground's routings and their build folders: from its production profile, and before it has one from its card. */
export function groundRoutings(groundId, root = ROOT) {
  const read = file => (fs.existsSync(path.join(root, file)) ? JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) : null);
  const profile = read(`course-workflows/${groundId}/production.json`), card = read(`course-workflows/${groundId}/ground.json`);
  if (!profile && !card) throw new Error(`${groundId} has neither a card (course-workflows/${groundId}/ground.json) nor a production profile: write the card first`);
  const routings = profile ? profile.courses.map(c => ({ slug: c.slug, build: path.posix.dirname(c.model.path) })) : card.routings.map(r => ({ slug: r.slug, build: r.build }));
  return { routings, hasProfile: Boolean(profile), hasCard: Boolean(card),
    published: (read('apps/golf/public/courses/v2-index.json')?.courses ?? []).some(c => c.groundId === groundId) };
}

/** The ordered steps for one ground. Steps a ground has no files for are left out: a ground that is new has its
 * card and its decisions before it has a production profile, and its outlines are where most of the work is, so
 * the steps up to the model run from the card alone (at Tjusta they could not, and the tracer was run by hand 35
 * times); an older ground with its own builder has the looks and the steps that follow a republished pack. */
export function rebuildPlan(groundId, { from = null, to = null, compare = [], compareCaptured = null, root = ROOT } = {}) {
  const has = file => fs.existsSync(path.join(root, file));
  const { routings, hasProfile, hasCard, published } = groundRoutings(groundId, root);
  const builds = [...new Set(routings.map(r => r.build))];
  const config = builds.map(b => `${b}/mapping/trace-config.json`).find(has) ?? null;
  // an older ground's configuration points the looks at its exported outlines; it has no decisions to trace
  const traced = config !== null && JSON.parse(fs.readFileSync(path.join(root, config), 'utf8')).courses.some(course => course.decisions);
  // one layer builder for every ground: what a ground brings is its layer decisions, beside its trace configuration
  const layers = config !== null && has(`${path.posix.dirname(config)}/layer-decisions.json`);
  const node = (...args) => [process.execPath, ...args], python = (...args) => [PIXI, ...TOOLCHAIN.slice(0, 3), '-e', 'mapping', '--frozen', 'python', ...args];
  const toolchainNode = (...args) => [PIXI, ...TOOLCHAIN, 'node', ...args];
  const step = (id, what, commands, extra = {}) => ({ id, what, commands, ...extra });
  const when = (condition, commands) => (condition ? commands : []);
  const plan = [
    // a ground that is not published yet is in few tables, and is not failed for it: its card has to be whole,
    // and the tables it is missing from are listed (ground-card.mjs --apply adds its rows at stage 5)
    step('card', published ? 'every table that names the ground agrees with its card' : 'the card is whole; the tables it is not in yet are listed',
      when(hasCard, [node('packages/course-workflow/ground-card.mjs', '--ground', groundId, ...(published ? ['--check'] : []))])),
    ...(config ? [
      step('decisions', 'the decision files can be traced', when(traced, [node('packages/course-geo/mapping/check-decisions.mjs', '--config', config)])),
      step('trace', 'greens, tees, fairways, bunkers and waste areas from the photo', when(traced, [python('packages/course-geo/mapping/trace-course-surfaces.py', '--config', config, '--cache', `${path.posix.dirname(path.posix.dirname(config))}/cache/mapping`)])),
      step('decks', 'every tee deck against the terrain under it', [node('packages/course-geo/mapping/deck-ground.mjs', '--config', config, '--record')]),
      step('sand', 'the sand on the photo against the model, both ways', [python('packages/course-geo/mapping/audit-sand.py', '--config', config, ...(compare.length ? ['--compare', ...compare] : []), ...(compare.length && compareCaptured ? ['--compare-captured', compareCaptured] : []))]),
      // which rings are drawn is known only once the trace before it has run, so this step's commands are asked for late
      step('sheets', 'the rings that are new or moved since they were looked at, on the photo, and again blind for a second reviewer',
        () => sheetCommands(builds.filter(b => has(`${b}/mapping/playing-surfaces.geojson`)).map(looksOwed),
          (blind, only) => python('packages/course-geo/mapping/render-ring-sheets.py', '--config', config, ...(compare.length ? ['--compare', ...compare] : []), ...(blind ? ['--blind'] : []), ...(only ? ['--only', only.join(',')] : [])))),
      step('review', 'the look at every ring is recorded for these outlines', [...builds.filter(b => has(`${b}/mapping/trace-report.json`) || config).map(b => node('packages/course-geo/mapping/ring-review.mjs', '--build', b)),
        node('packages/course-geo/mapping/sand-audit.mjs', '--build', config.split('/')[0])],
        { gate: 'Look at the sheets the step before drew (only the rings that are new or moved are on them) and at the decks it named, record the look '
          + '(ring-review.mjs --build <build> --record --reviewer "<who, on what>"), give the blind sheets to a second reviewer '
          + '(.claude/agents/ring-reviewer.md; ring-review.mjs --second: answers already given to its doubts on rings that did not move are kept), '
          + 'say what each thing the sand audit named is (sand-audit.mjs --verdict or --fault), then continue with --from layers.' }),
    ] : []),
    ...(layers ? [step('layers', 'water, facilities and infrastructure', [python('packages/course-geo/mapping/build-layers.py', '--config', config)])] : []),
    step('compile', 'each routing\'s course model', builds.filter(b => has(`${b}/mapping/course-input.json`)).map(b => node('packages/course-geo/mapping/compile-grid-course.mjs', '--config', `${b}/mapping/course-input.json`))),
    step('tests', 'the builds\' own tests', builds.filter(b => has(`${b}/course.node-test.mjs`)).map(b => node('--test', '--test-concurrency=1', `${b}/course.node-test.mjs`))),
    // only a ground compiled here from EPSG:3006 layers has models to inventory this way
    step('inventory', 'the models in the source records', builds.some(b => has(`${b}/mapping/course-input.json`)) ? [toolchainNode('packages/course-geo/inventory-models.mjs', '--ground', groundId)] : []),
    step('pin', 'the production profile\'s checksums', when(hasProfile, [node('packages/course-workflow/pin-production.mjs', '--ground', groundId)])),
    step('configure', 'the workflow\'s stage inputs', when(hasProfile, [node('packages/course-workflow/production.mjs', '--ground', groundId, '--configure')])),
    step('stages', 'the six production stages', when(hasProfile, [toolchainNode('packages/course-workflow/cli.mjs', 'run', '--ground', groundId, '--through', 'validate')])),
    step('promote', 'the validated candidate into the published tree', when(hasProfile, [node('packages/course-workflow/promote.mjs', '--ground', groundId)])),
    step('prune', 'files no published generation names (listed, not removed)', when(hasProfile, [node('packages/course-workflow/promote.mjs', '--ground', groundId, '--prune')])),
    // What follows needs a published ground. A republished pack moves the pin of the measured roof colours; the
    // step refuses when a footprint changed, and the roofs are then measured again (roof-colours.py).
    step('roofs', 'the measured roof colours, pinned to the republished pack', when((hasProfile || published) && has(`apps/golf/src/engine/scenery/${groundId}-roof-colours.json`),
      [node('tools/rebind-roof-colours.mjs', '--ground', groundId, '--slug', routings[0].slug, '--write')])),
    step('quality', 'the quality gate', when(hasProfile || published, [node('tools/check-course-quality.mjs', '--ground', groundId)])),
    step('map-land', 'the phone map\'s water and forest', when(hasProfile || published, [node('tools/bake-map-land.mjs')])),
    step('map-buildings', 'the phone map\'s copy of the club\'s own buildings', when(hasProfile || published, [node('tools/bake-map-buildings.mjs')])),
    step('walkthrough', 'the walkthrough\'s generated parts', when(hasProfile || published, [node('tools/course-walkthrough.mjs', '--ground', groundId), node('tools/course-walkthrough.mjs', '--catalogue')])),
  ].filter(s => typeof s.commands === 'function' || s.commands.length);
  const index = (id, fallback) => { if (!id) return fallback; const i = plan.findIndex(s => s.id === id); if (i < 0) throw new Error(`${groundId} has no step ${id} (it has: ${plan.map(s => s.id).join(', ')})`); return i; };
  const first = index(from, 0), last = index(to, plan.length - 1);
  if (last < first) throw new Error(`--to ${to} comes before --from ${from}`);
  return plan.slice(first, last + 1);
}

/** The sheets a ground's looks still owe, as commands: for the first look the rings that are new or moved, and
 * blind for the second reviewer the rings they have not seen (after this trace, that is those too). A ground
 * looked at for the first time gets every sheet; one whose rings all stand as they were looked at gets none.
 * `owed` is ring-review.mjs looksOwed, a build each; `render(blind, ids or null for every ring)` gives a command. */
export function sheetCommands(owed, render) {
  const every = owed.reduce((sum, o) => sum + o.ids.length, 0);
  const first = owed.flatMap(o => o.first);
  const blind = owed.flatMap(o => (o.second === null ? (o.first.length ? o.ids : []) : [...new Set([...o.second, ...o.first])]));
  return [[false, first], [true, blind]].filter(([, ids]) => ids.length).map(([isBlind, ids]) => render(isBlind, ids.length < every ? ids : null));
}

/** A step's commands: most are known when the plan is made, a few only when the step is reached. */
export const commandsOf = step => (typeof step.commands === 'function' ? step.commands() : step.commands);

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
  if (!groundId) throw new Error('usage: course-rebuild.mjs --ground <id> [--from <step>] [--to <step>] [--compare <older-photo.tif> --compare-captured <YYYY-MM-DD>] [--dry-run]');
  const plan = rebuildPlan(groundId, { from: flag('from'), to: flag('to'), compare: flag('compare') ? [flag('compare')] : [], compareCaptured: flag('compare-captured') });
  const { hasProfile, published } = groundRoutings(groundId);
  const without = hasProfile ? null : published
    ? `${groundId} is built by its own older builder: its steps (see its walkthrough) come between \`review\` and \`roofs\`, and are not run here.`
    : `${groundId} has no production profile yet (course-workflows/${groundId}/production.json, stage 5): with it come pin, the six stages, promote and what follows.`;
  if (argv.includes('--dry-run')) {
    if (without) console.log(`${without}\n`);
    for (const step of plan) console.log(`${step.id.padEnd(14)}${step.what}\n${commandsOf(step).map(c => `              ${shown(c)}`).join('\n') || '              (nothing to draw as the ground stands; after a trace, the rings it moved)'}`);
    return;
  }
  const dir = path.join(ROOT, 'output/course-rebuild', `${groundId}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [i, step] of plan.entries()) {
    const log = path.join(dir, `${String(i + 1).padStart(2, '0')}-${step.id}.log`), started = Date.now();
    process.stdout.write(`${step.id.padEnd(14)}`);
    let code = 0;
    for (const command of commandsOf(step)) { code = await run(command, log); if (code) break; }
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
  if (without) console.log(without);
  if (plan.at(-1).id === 'walkthrough') console.log(`Nothing here used the GPU. Next: the first pictures (node tools/course-walkthrough.mjs --ground ${groundId} --pictures), then the bake (BANVY_GPU=1 node tools/gpu-pass.mjs --only <slugs>; every course if engine code changed).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
