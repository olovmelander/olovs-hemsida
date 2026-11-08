#!/usr/bin/env node
/* The tree placement pipeline: one ground at a time, one named stage at a time.

   usage: node tools/tree-pipeline.mjs --list
          node tools/tree-pipeline.mjs --help
          node tools/tree-pipeline.mjs --init --ground <id>
          node tools/tree-pipeline.mjs --ground <id> --status
          node tools/tree-pipeline.mjs --ground <id> --stage <stage> [stage options]

   Stages, in order: acquire, canopy, detect, verify, reference, benchmark,
   candidates, review, publish (--list says what each does). Everything
   ground-specific comes from course-workflows/<ground>/trees.json.

   Common options:
     --round <id>        a reference round other than the config's activeRound
     --cache <dir>       derived rasters, panels and candidates (default: the config's cacheDir)
     --raw <dir>         the acquired laser and orthophoto cache to READ (default: --cache)
     --review-dir <dir>  the review directory to write (default: the config's reviewDir)

   Stage options:
     acquire    --fetch [--only laser|ortho] [--campaigns k1,k2]   (network; run through node --env-file=<.env>)
     verify     --decide-only | --pairs a@b,... | --relief (the canopy's relief displacement per photo)
     reference  --prepare [--only w1,w2] [--mpp 0.12] [--native] | --freeze [--note text] [--interpreter text]
     benchmark  --tune | --types | --subtypes | --score | --gate   (none: whatever is missing, then the gate)
     review     --only spots|types|screens|mix
     publish    --execute (compile into the staging root; never the live public root)
                [--pending-owner] (stage a round whose remaining blockers are the owner's own decisions, covered by a
                pendingOwnerApprovals record: labelled pending everywhere, never an exception)

   Exit codes: 0 done, 1 error, 2 usage, 3 stopped for a person (review or an
   owner decision), 4 held-out gate failed with no owner exception.

   Credentials: only `acquire --fetch` reads Lantmäteriet credentials, from the
   environment that node --env-file=<repository .env> loads. Nothing prints,
   logs or writes them. No stage uses the GPU, a browser or a deep-learning
   model; heavy stages are single-threaded -- run them one at a time. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, configPath, configTemplate, loadGroundConfig } from './tree-pipeline/config.mjs';
import { STAGES, STAGE_NAMES, firstIncompleteStage, missingPrerequisites, nextStage } from './tree-pipeline/stages.mjs';

const EXIT = Object.freeze({ done: 0, error: 1, usage: 2, stop: 3, 'gate-fail': 4 });
const BOOLEAN = new Set(['list', 'help', 'init', 'status', 'fetch', 'decide-only', 'prepare', 'freeze', 'tune', 'types', 'subtypes', 'score', 'gate', 'execute', 'force', 'native', 'relief', 'pending-owner']);

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const name = arg.slice(2);
    if (BOOLEAN.has(name)) { options[name] = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`);
    options[name] = value;
    i++;
  }
  return options;
}

function help() {
  const text = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  return text.slice(text.indexOf('/*') + 2, text.indexOf('*/')).replace(/^ {3}/gm, '').trim();
}

function list() {
  return STAGES.map((s, i) => `${String(i + 1).padStart(2)}. ${s.name.padEnd(11)} [${s.kind}${s.network ? `, network ${s.network}` : ''}] ${s.summary}`).join('\n');
}

function status(ctx) {
  const lines = [`ground ${ctx.groundId}, review ${ctx.config.reviewId}, round ${ctx.round.id} (${ctx.round.detector}), review dir ${ctx.rel(ctx.paths.reviewDir)}, cache ${ctx.rel(ctx.paths.cacheDir)}`];
  for (const s of STAGES) {
    const products = s.produces(ctx);
    const present = products.filter(file => fs.existsSync(file)).length;
    const missing = missingPrerequisites(ctx, s.name);
    lines.push(`${s.name.padEnd(11)} ${present === products.length ? 'products present' : `${present}/${products.length} products`}${missing.length ? `; waiting for ${missing.map(m => `${ctx.rel(m.file)} (${m.madeBy})`).join(', ')}` : ''}`);
  }
  const next = firstIncompleteStage(ctx);
  lines.push(next ? `next: --stage ${next.name}` : 'every stage has its products; publish verifies them before staging');
  return lines.join('\n');
}

async function main(argv) {
  let options;
  try { options = parseArgs(argv); } catch (error) { console.error(`${error.message}\n\n${help()}`); return EXIT.usage; }
  if (options.help || !Object.keys(options).length) { console.log(help()); return EXIT.done; }
  if (options.list) { console.log(list()); return EXIT.done; }
  if (!options.ground) { console.error('--ground <id> is required'); return EXIT.usage; }
  if (options.init) {
    const file = path.join(ROOT, configPath(options.ground));
    if (fs.existsSync(file)) { console.error(`${configPath(options.ground)} exists; edit it instead`); return EXIT.usage; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(configTemplate(options.ground), null, 2) + '\n', { flag: 'wx' });
    console.log(`wrote ${configPath(options.ground)}: replace every TODO, then --status`);
    return EXIT.done;
  }
  let ctx;
  try {
    ctx = loadGroundConfig(ROOT, options.ground, { cache: options.cache, raw: options.raw, reviewDir: options['review-dir'], round: options.round });
  } catch (error) { console.error(error.message); return EXIT.usage; }
  if (options.status) { console.log(status(ctx)); return EXIT.done; }
  if (!options.stage) { console.error(`--stage <${STAGE_NAMES.join('|')}> is required (or --status)`); return EXIT.usage; }
  if (!STAGE_NAMES.includes(options.stage)) { console.error(`unknown stage ${options.stage}; stages: ${STAGE_NAMES.join(', ')}`); return EXIT.usage; }
  const missing = missingPrerequisites(ctx, options.stage);
  if (missing.length && !(options.stage === 'acquire' && options.fetch)) {
    console.error(`stage ${options.stage} cannot run yet:\n${missing.map(m => `  - ${ctx.rel(m.file)} (made by ${m.madeBy})`).join('\n')}`);
    return EXIT.stop;
  }
  const module = await import(`./tree-pipeline/${options.stage}.mjs`);
  const started = performance.now();
  console.log(`== ${ctx.groundId} / ${options.stage} (round ${ctx.round.id}) ==`);
  const result = await module.run(ctx, options);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`\n[${options.stage}] ${result.status.toUpperCase()} in ${seconds} s\n${result.message}`);
  if (result.status === 'done') {
    const next = nextStage(options.stage);
    if (next) console.log(`next: node tools/tree-pipeline.mjs --ground ${ctx.groundId} --stage ${next.name}`);
  }
  return EXIT[result.status] ?? EXIT.error;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error.stack || error.message); process.exitCode = EXIT.error; });
}
