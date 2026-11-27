#!/usr/bin/env node
/* WHERE DOES A GROUND STAND, AND WHAT IS THE NEXT THING TO DO?

   node tools/course-doctor.mjs --ground <id>        every record of one ground, read once, with what is open
   node tools/course-doctor.mjs                      every ground, one line each
   node tools/course-doctor.mjs --machine            whether this machine can run the pipeline today
   node tools/course-doctor.mjs --private            the private data every ground depends on, which only this machine holds
   node tools/course-doctor.mjs --ground <id> --check   as the first, and fails when something is broken

   The pipeline keeps a record for every step (the card, the decisions, the ring review and its second look, the
   deck and sand measurements, the quality gate, the walkthrough, the pins, the release). Each has its own tool and
   its own test, and after a week nobody remembers which to run. This reads them all and sorts what it finds:

     broken   a gate fails: fix it before anything else
     todo     work that needs no owner: a step to run, a record that is missing
     owner    only the owner can move it: a decision, the GPU, a look with their own eyes
     known    a fault that is written down and kept on purpose
     ok       holds

   It starts no browser and no heavy job, and changes nothing. It is the place to begin a sitting. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PIXI, MAPPING_ENVIRONMENT } from '../packages/course-geo/toolchain/mapping-environment.mjs';
import { groundFacts, blocks, merge } from './course-walkthrough.mjs';
import { groundCardErrors, groundCardPath, registration } from '../packages/course-workflow/ground-card.mjs';
import { decisionErrors, loadDecisionFiles } from '../packages/course-geo/mapping/check-decisions.mjs';
import { reviewErrors as ringReviewErrors } from '../packages/course-geo/mapping/ring-review.mjs';
import { deckGroundErrors } from '../packages/course-geo/mapping/deck-ground.mjs';
import { sandAuditOf } from '../packages/course-geo/mapping/sand-audit.mjs';
import { exportErrors, isExported } from '../packages/course-geo/mapping/export-model-surfaces.mjs';
import { pinProduction, pinnedFiles } from '../packages/course-workflow/pin-production.mjs';
import { prunePlan } from '../packages/course-workflow/promote.mjs';
import { waterOffTheLine } from './water-line.mjs';
import { hasModelledBuildings } from './bake-map-buildings.mjs';
import { MAP_GROUND_FRAMES } from '../apps/golf/src/map/map-frames.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = file => fs.existsSync(path.join(ROOT, file));
const json = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const LEVELS = ['broken', 'todo', 'owner', 'known', 'ok'];
const megabytes = bytes => `${(bytes / 1048576).toFixed(1)} MB`;

/** Every published ground id, in the catalogue's order. */
export function grounds() {
  return [...new Set(json('apps/golf/public/courses/v2-index.json').courses.map(course => course.groundId))];
}

/** A ground being built (a workflow, not yet in the catalogue): where it stands in the stages, from its own records. */
export function buildingFindings(groundId) {
  const out = [], say = (level, about, text, run) => out.push({ level, about, text, ...(run ? { run } : {}) });
  const workflow = `course-workflows/${groundId}/workflow.json`;
  if (!exists(workflow)) return [{ level: 'broken', about: 'workflow', text: `no ${workflow}: start with packages/course-workflow/cli.mjs init` }];
  const card = exists(groundCardPath(groundId)) ? json(groundCardPath(groundId)) : null;
  const cardErrors = card ? groundCardErrors(card) : ['no card'];
  say(cardErrors.length ? 'todo' : 'ok', 'card', cardErrors.length ? cardErrors.join('; ') : `whole, ${card.routings.length} routing(s); the tables are filled at stage 5`,
    `node packages/course-workflow/ground-card.mjs --ground ${groundId} --rows`);
  const manifest = `geo_data/course-v2/${groundId}/source-manifest.json`;
  if (!exists(manifest)) say('todo', 'sources', `no ${manifest}`);
  else {
    const sources = json(manifest).sources;
    const planned = sources.filter(s => s.lifecycle === 'planned').map(s => s.id);
    say(planned.length ? 'todo' : 'ok', 'sources', planned.length ? `planned, not acquired: ${planned.join(', ')}` : `${sources.length} sources acquired, dated and checksummed`,
      'node packages/course-geo/check-manifests.mjs');
  }
  const builds = card ? card.routings.map(r => r.build) : [];
  const config = builds.map(b => `${b}/mapping/trace-config.json`).find(exists);
  if (!config) { say('todo', 'outlines', 'no trace-config.json yet (stage 3)'); return out; }
  if (!builds.some(isExported)) try {
    const { config: cfg, files } = loadDecisionFiles(config);
    const errors = decisionErrors(cfg, files);
    say(errors.length ? 'broken' : 'ok', 'decisions', errors.length ? errors.join('; ') : 'can be traced', `node packages/course-geo/mapping/check-decisions.mjs --config ${config}`);
  } catch (error) { say('broken', 'decisions', error.message); }
  for (const build of [...new Set(builds)]) {
    if (!exists(`${build}/mapping/playing-surfaces.geojson`)) { say('todo', 'trace', `${build}: not traced`); continue; }
    for (const [about, errors, run] of [
      ['ring review', ringReviewErrors(build), `node packages/course-geo/mapping/ring-review.mjs --build ${build}`],
      ['decks', deckGroundErrors(build), `node packages/course-geo/mapping/deck-ground.mjs --config ${config} --record`],
      ['sand', sandAuditOf(build).errors, `node packages/course-geo/mapping/sand-audit.mjs --build ${build}`],
    ]) say(errors.length ? 'todo' : 'ok', about, errors.length ? errors.join('; ') : `${build}: holds`, run);
    say(exists(`${build}/course-model.json`) ? 'ok' : 'todo', 'model', exists(`${build}/course-model.json`) ? `${build}: compiled` : `${build}: not compiled (stage 4)`,
      `node packages/course-geo/mapping/compile-grid-course.mjs --config ${build}/mapping/course-input.json`);
  }
  if (!exists(`course-workflows/${groundId}/production.json`)) say('todo', 'production', 'no production.json yet: stage 5 starts here (pin, the six stages, promote, register)');
  say('owner', 'release', 'not in the catalogue: stages 5 to 9 are still to come (docs/pipeline-v2.md)');
  return out;
}

/** The ground's water bodies near play that stand unlike every accepted pond (two seconds a routing, on the CPU). */
export function waterFindings(facts) {
  const file = path.join(os.tmpdir(), `course-doctor-water-${process.pid}.json`);
  const run = spawnSync(process.execPath, ['tools/audit-water-levels.mjs', '--course', facts.routings.map(x => x.slug).join(','), '--json', file], { cwd: ROOT, encoding: 'utf8' });
  if (run.status !== 0 || !fs.existsSync(file)) return [{ level: 'known', about: 'water', text: `not measured: ${(run.stderr || '').split('\n')[0].slice(0, 120)}` }];
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.rmSync(file, { force: true });
  const off = waterOffTheLine(report), bodies = new Set(report.flatMap(course => course.bodies.filter(body => !body.sea).map(body => body.index))).size;
  return off.length
    ? off.map(body => ({ level: 'todo', about: 'water', text: `water ${body.index} (${body.areaM2} m2, ${body.metresFromHole} m from ${body.slug} hole ${body.hole}) ${body.why}`,
      run: `node tools/audit-water-levels.mjs --course ${body.slug}   (then look at it on the photo and in the app)` }))
    : [{ level: 'ok', about: 'water', text: `${bodies} lakes and ponds measured; those near play stand as the accepted ponds do` }];
}

/** One ground's findings: [{ level, about, text, run? }]. Reading only; `facts` is groundFacts(groundId). `water` also
 * measures the water levels, which the one-line-a-ground list leaves out to stay quick. */
export async function examine(groundId, facts = groundFacts(groundId), { water = false } = {}) {
  const out = [], say = (level, about, text, run) => out.push({ level, about, text, ...(run ? { run } : {}) });
  const builds = facts.routings.map(x => x.build), home = builds.find(build => exists(`${build}/mapping/trace-config.json`)) ?? null;

  // the card and the tables
  if (!exists(groundCardPath(groundId))) say('todo', 'card', 'no ground card: its facts live only in the tables', `write ${groundCardPath(groundId)} (copy bro-hof's), then node packages/course-workflow/ground-card.mjs --ground ${groundId}`);
  else {
    const card = json(groundCardPath(groundId)), errors = groundCardErrors(card);
    if (errors.length) say('broken', 'card', errors.join('; '));
    else {
      const off = (await registration(card)).filter(row => row.state !== 'agrees');
      if (off.length) say('broken', 'card', `${off.length} tables do not agree with the card: ${off.slice(0, 4).map(row => `${row.slug} ${row.file} (${row.state})`).join('; ')}`, `node packages/course-workflow/ground-card.mjs --ground ${groundId} --rows`);
      else say('ok', 'card', 'every table that names the ground agrees with its card');
    }
  }

  // outlines: decisions, the looks, the measurements
  if (!home) say('known', 'outlines', 'built with its own older builder: no decision files, no ring sheets, no deck or sand measurement');
  else {
    // An older ground's outlines exported for the looks (export-model-surfaces.mjs) are its own builder's, not decisions.
    if (isExported(home)) {
      const stale = exportErrors(home);
      say(stale.length ? 'broken' : 'known', 'outlines', stale.length ? stale.join('; ')
        : 'built with its own older builder; its published outlines are exported for the looks (ring sheets, decks, sand)',
      stale.length ? `node packages/course-geo/mapping/export-model-surfaces.mjs --build ${home} --migration <its migration record> --slug <slug>` : undefined);
    } else {
      const { config, files } = loadDecisionFiles(`${home}/mapping/trace-config.json`), errors = decisionErrors(config, files);
      say(errors.length ? 'broken' : 'ok', 'decisions', errors.length ? errors.slice(0, 3).join('; ') : 'the decision files can be traced');
    }
    for (const x of facts.routings) {
      const ring = ringReviewErrors(x.build);
      if (ring.length) say('broken', 'ring review', ring.slice(0, 3).join('; '), `node packages/course-geo/mapping/ring-review.mjs --build ${x.build}`);
      else say('ok', 'ring review', `${x.slug}: every ring looked at on ${x.review.reviewedOn}`);
      if (!x.second) say('todo', 'second look', `${x.slug}: nobody but the tracer has looked at its rings`, 'render-ring-sheets.py --blind, the ring-reviewer agent, ring-review.mjs --second');
      else {
        if (x.second.unseen.length) say('todo', 'second look', `${x.slug}: ${x.second.unseen.length} rings moved since the second reviewer looked (${x.second.unseen.slice(0, 6).join(', ')}${x.second.unseen.length > 6 ? ', ...' : ''})`, `node packages/course-geo/mapping/ring-review.mjs --build ${x.build} prints the command that draws them blind`);
        for (const fault of x.second.faults) say('known', 'second look', `${fault.id}: ${fault.fault}`);
      }
      const decks = deckGroundErrors(x.build);
      if (decks.length) say('broken', 'tee decks', decks.join('; '), `node packages/course-geo/mapping/deck-ground.mjs --config ${home}/mapping/trace-config.json --record`);
      else if (x.deckGround.off.length) say('known', 'tee decks', `${x.slug}: ${x.deckGround.off.length} of ${x.deckGround.measured} decks are not on level ground in the terrain (${x.deckGround.off.slice(0, 6).map(d => d.id).join(', ')}${x.deckGround.off.length > 6 ? ', ...' : ''})`);
      else say('ok', 'tee decks', `${x.slug}: all ${x.deckGround.measured} measured decks are on level ground`);
      const flat = x.deckGround?.bunkers?.flat ?? [], changed = (facts.sand?.before?.changed ?? []).filter(bunker => bunker.slug === x.slug);
      if (flat.length || changed.length) say('known', 'ground age', `${x.slug}: ${changed.length} bunkers built or reshaped since the ${facts.sand?.before?.captured ?? 'older'} photo, ${flat.length} without a bowl in the terrain: the terrain under them is older than the course`);
    }
    const sand = sandAuditOf(home);
    if (sand.errors.length) say('broken', 'sand', sand.errors.slice(0, 3).join('; '), `audit-sand.py --config ${home}/mapping/trace-config.json, then node packages/course-geo/mapping/sand-audit.mjs --build ${home}`);
    else {
      say('ok', 'sand', `${facts.sand.modelled} bunkers and waste areas measured against the photo; ${facts.sand.areas} bright areas outside the model, each explained`);
      for (const fault of facts.sand.faults) say('known', 'sand', `${fault.id}: ${fault.fault}`);
    }
  }

  if (water) out.push(...waterFindings(facts));

  // the model against its own checks
  if (facts.quality.errors) say('broken', 'quality gate', `${facts.quality.errors} errors`, `node tools/check-course-quality.mjs --ground ${groundId}`);
  else say('ok', 'quality gate', `no errors, ${facts.quality.warnings} warnings`);
  for (const x of facts.routings) {
    if (x.card && x.card.marks - x.card.within) say('known', 'card', `${x.slug}: ${x.card.marks - x.card.within} of ${x.card.marks} tee marks are more than 5 m from their card length (worst ${Math.abs(x.card.worst.metres)} m, hole ${x.card.worst.hole})`);
    if (x.prepared < x.preparedOf) say('owner', 'prepared data', `${x.slug}: ${x.prepared} of ${x.preparedOf} baked records; the bake is a GPU sitting`, 'BANVY_GPU=1 node tools/gpu-pass.mjs --only ' + x.slug);
    if (!x.posters) say('owner', 'posters', `${x.slug}: no posters; they are taken on the GPU`, 'node tools/make-posters.mjs');
    const tests = `${x.build}/course.node-test.mjs`;
    if (exists(tests) && !json('package.json').scripts.test.includes(tests)) say('broken', 'tests', `${tests} is not in the suite`, 'add it to package.json scripts.test');
  }
  if (facts.trees?.gate === false) say('owner', 'trees', `placed one by one, but below the gate (precision ${facts.trees.score.precision.toFixed(3)}, recall ${facts.trees.score.recall.toFixed(3)}); a new round needs a new unseen sample and the owner at its gates`);
  else if (!facts.trees) say('todo', 'trees', 'automatic trees; the tree pipeline has not been run here', 'see docs/tree-placement-workflow.md (its own sitting)');
  else say('ok', 'trees', `${facts.trees.placed ?? ''} placed one by one, gate met`.trim());

  // the walkthrough
  const page = `docs/courses/${groundId}-walkthrough.md`;
  if (!exists(page)) say('todo', 'walkthrough', 'none: nothing says what is known not to be right here', `node tools/course-walkthrough.mjs --ground ${groundId}, then write its hand parts`);
  else {
    const text = fs.readFileSync(path.join(ROOT, page), 'utf8');
    if (merge(text, blocks(facts)) !== text) say('broken', 'walkthrough', 'its generated parts are behind the records', `node tools/course-walkthrough.mjs --ground ${groundId}`);
    else say('ok', 'walkthrough', 'current');
  }

  // production: pins, old files, release
  const production = `course-workflows/${groundId}/production.json`;
  if (exists(production)) {
    const { moved, missing } = pinProduction(json(production), { root: ROOT });
    if (moved.length) say('todo', 'production', `${moved.length} pinned inputs changed since they were pinned (${moved.slice(0, 3).map(m => m.path).join(', ')})`, `node packages/course-workflow/pin-production.mjs --ground ${groundId}, then the six stages`);
    else say('ok', 'production', 'every pinned input is as pinned');
    if (missing.length) say('known', 'production', `${missing.length} pinned inputs are not on this machine (private caches stay where they were fetched)`);
  }
  try {
    const plan = prunePlan(ROOT, groundId, { publicRoot: 'apps/golf/public' });
    if (plan.orphans.length) say('owner', 'old files', `${plan.orphans.length} built files (${megabytes(plan.bytes ?? 0)}) are named by no published generation`, `node packages/course-workflow/promote.mjs --ground ${groundId} --prune   (lists; --apply removes)`);
  } catch (error) { say('known', 'old files', `not checked: ${error.message}`); }
  const a = facts.release.acceptance;
  if (a) say('owner', 'release', `on the owner's acceptance of ${a.acceptedOn}, with ${Object.keys(a.open).length} items open (${Object.keys(a.open).join(', ')})`);
  else say('owner', 'release', `policy ${facts.release.policy ?? 'none'}, frame ${facts.release.frame}${facts.release.blockers.length ? `; open: ${facts.release.blockers.map(b => b.id).join(', ')}` : ''}`);
  const review = `course-workflows/${groundId}/review.json`;
  if (exists(review)) {
    const rows = json(review).holes.flatMap(hole => Object.values(hole.categories)), looked = rows.filter(row => row.status !== 'unknown').length;
    if (looked < rows.length) say('owner', 'the owner\'s look', `${looked} of ${rows.length} hole-by-hole verdicts given`, home ? `node tools/course-review-page.mjs --ground ${groundId} --overlays <dir>   (a local page to click through)` : undefined);
  }
  out.push(...mapFindings(groundId));
  return out.sort((p, q) => LEVELS.indexOf(p.level) - LEVELS.indexOf(q.level));
}

/** Lätt 3D, the phone map, draws what the detailed course draws, from the same records, for a phone (the owner,
 * 27 November 2026: one source, each mode drawn for its device). Its frame of the ground, its pictures of water and
 * forest and its copy of the club's own buildings are each baked from records the pipeline republishes, so each can
 * fall behind them: the rebuild's map-land and map-buildings steps bake them again. */
export function mapFindings(groundId, root = ROOT) {
  const out = [], say = (level, about, text, run) => out.push({ level, about, text, ...(run ? { run } : {}) });
  const read = file => JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/public', file), 'utf8'));
  const entry = read('courses/v2-index.json').courses.find(course => course.groundId === groundId);
  if (!entry) { say('todo', 'phone map', 'the ground is not published yet: the map reads the published ground'); return out; }
  const groundManifest = read(entry.manifest.url).groundManifest, fingerprint = read(groundManifest.url).frame.fingerprint;
  const frame = MAP_GROUND_FRAMES[groundId];
  if (!frame) say('broken', 'phone map', 'no map frame for this ground: Lätt 3D cannot open it', 'add the ground to MAP_GROUND_FRAMES in apps/golf/src/map/map-frames.mjs');
  else if (frame.frameFingerprint !== fingerprint) say('broken', 'phone map', 'its map frame was reviewed against another frame of the ground', 'review the ground in MAP_GROUND_FRAMES (apps/golf/src/map/map-frames.mjs)');
  const land = read('models/map-land.json').grounds?.[groundId];
  if (!land) say('todo', 'map pictures', 'none: the map\'s water and forest stop at the outlines', 'node tools/bake-map-land.mjs');
  else if (land.ground !== fingerprint || land.terrain !== groundManifest.sha256) say('broken', 'map pictures', 'baked from terrain that is no longer the published one', 'node tools/bake-map-land.mjs');
  else say('ok', 'map pictures', 'water and forest from the published terrain');
  const club = read('models/map-buildings.json').grounds?.[groundId];
  if (!club) {
    if (hasModelledBuildings(groundId, root)) say('todo', 'map buildings', 'the club\'s own buildings have no Lätt 3D copy: the map draws their plain footprints', 'node tools/bake-map-buildings.mjs');
    return out;
  }
  const sha = file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
  const moved = club.sources.filter(source => !fs.existsSync(path.join(root, source.path)) || sha(source.path) !== source.sha256).map(source => source.path);
  if (moved.length) say('broken', 'map buildings', `the copy is behind ${moved.length} republished source${moved.length === 1 ? '' : 's'} (${moved.slice(0, 2).join(', ')})`, 'node tools/bake-map-buildings.mjs');
  else if (read(club.file).frame !== fingerprint) say('broken', 'map buildings', 'baked against another frame of the ground', 'node tools/bake-map-buildings.mjs');
  else say('ok', 'map buildings', `${club.buildings} of the club's own buildings, from their current models`);
  return out;
}

/** The private data a ground was built from: raw photos, laser and club material in the caches git ignores. They are
 * on the machine that fetched them and nowhere else, so this is the list to back up. `pinned` counts the inputs
 * whose checksum the production profile records: those can be proven whole after a restore; the rest cannot. */
export function privateData(groundId, root = ROOT) {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/public/courses/index.json'), 'utf8')).courses;
  const slugs = JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/public/courses/v2-index.json'), 'utf8')).courses.filter(course => course.groundId === groundId).map(course => course.slug);
  const builds = [...new Set(index.filter(course => slugs.includes(course.slug)).map(course => course.build))];
  const acquisition = 'packages/course-geo/toolchain/.cache/acquisition';
  const directories = [...builds.map(build => `${build}/cache`),
    ...(fs.existsSync(path.join(root, acquisition)) ? fs.readdirSync(path.join(root, acquisition)).filter(name => name === groundId || name.startsWith(`${groundId}-`)).map(name => `${acquisition}/${name}`) : [])]
    .filter(directory => fs.existsSync(path.join(root, directory)));
  const measure = directory => {
    let files = 0, bytes = 0;
    const walk = at => { for (const entry of fs.readdirSync(at, { withFileTypes: true })) { const next = path.join(at, entry.name); if (entry.isDirectory()) walk(next); else { files += 1; bytes += fs.statSync(next).size; } } };
    walk(path.join(root, directory));
    return { directory, files, bytes };
  };
  const found = directories.map(measure);
  const production = path.join(root, `course-workflows/${groundId}/production.json`);
  const pins = fs.existsSync(production) ? pinnedFiles(JSON.parse(fs.readFileSync(production, 'utf8'))).map(pin => pin.ref).filter(pin => directories.some(directory => pin.path.startsWith(`${directory}/`))) : [];
  return { groundId, directories: found, files: found.reduce((sum, d) => sum + d.files, 0), bytes: found.reduce((sum, d) => sum + d.bytes, 0),
    pinned: pins.length, pinnedHere: pins.filter(pin => fs.existsSync(path.join(root, pin.path))).length };
}

/** Whether this machine can run each part of the pipeline: [{ level, about, text }]. Starts nothing heavy. */
export function machine() {
  const out = [], say = (level, about, text) => out.push({ level, about, text });
  const major = Number(process.versions.node.split('.')[0]);
  say(major >= 22 ? 'ok' : 'broken', 'node', `${process.version}${major >= 22 ? '' : ': 22 or later is needed'}`);
  if (!MAPPING_ENVIRONMENT) say('todo', 'python', 'the Pixi mapping environment is not installed: no tracing, no photo tools');
  else {
    const probe = 'import importlib, json\nout = {}\nfor name in ["numpy", "rasterio", "shapely", "PIL", "scipy.ndimage", "pyproj"]:\n    try:\n        importlib.import_module(name); out[name] = "ok"\n    except Exception as error:\n        out[name] = str(error).splitlines()[0][:120]\nprint(json.dumps(out))';
    const run = spawnSync(PIXI, ['run', '--manifest-path', 'packages/course-geo/toolchain/pixi.toml', '-e', 'mapping', '--frozen', 'python', '-c', probe], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    let loaded = null;
    try { loaded = JSON.parse(run.stdout.trim().split('\n').at(-1)); } catch { /* the environment did not start */ }
    if (!loaded) say('broken', 'python', `the mapping environment does not start: ${(run.stderr || run.error?.message || '').split('\n')[0].slice(0, 160)}`);
    else {
      const looking = ['numpy', 'rasterio', 'shapely', 'PIL'].filter(name => loaded[name] !== 'ok'), tracing = ['scipy.ndimage', 'pyproj'].filter(name => loaded[name] !== 'ok');
      say(looking.length ? 'broken' : 'ok', 'python: looking', looking.length ? `cannot load ${looking.join(', ')}: no ring sheets, photo windows or sand audit` : 'ring sheets, photo windows and the sand audit can run');
      say(tracing.length ? 'owner' : 'ok', 'python: tracing', tracing.length
        ? `cannot load ${tracing.join(', ')} (${loaded[tracing[0]]}): no tracing, no layers, no photo acquisition on this machine. If the reason is the machine's security policy, it is the owner's to settle; do not work round it.`
        : 'the tracer, the layers and the acquisition can run');
    }
  }
  const blender = [process.env.BLENDER, ...(process.platform === 'win32' && fs.existsSync('C:/Program Files/Blender Foundation')
    ? fs.readdirSync('C:/Program Files/Blender Foundation').sort().reverse().map(dir => `C:/Program Files/Blender Foundation/${dir}/blender.exe`) : []), 'blender'].filter(Boolean)
    .find(candidate => candidate === 'blender' ? spawnSync('blender', ['--version'], { encoding: 'utf8', timeout: 20000 }).status === 0 : fs.existsSync(candidate));
  say(blender ? 'ok' : 'todo', 'blender', blender ? `found (${blender}): campus models and props can be built` : 'not found (set BLENDER): no campus models, no previews');
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const dirty = git('status', '--porcelain').split('\n').filter(Boolean).length;
  say('ok', 'git', `on ${git('rev-parse', '--abbrev-ref', 'HEAD')}, ${dirty} files changed or new${git('config', 'core.autocrlf') === 'false' ? '' : '; core.autocrlf is not false, so checksums of text files will not hold'}`);
  return out;
}

function print(title, findings) {
  console.log(`\n${title}`);
  for (const finding of findings) console.log(`  ${finding.level.padEnd(7)} ${finding.about.padEnd(18)} ${finding.text}${finding.run ? `\n${' '.repeat(29)}> ${finding.run}` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const groundId = flag('ground');
  if (argv.includes('--private')) {
    const all = (groundId ? [groundId] : grounds()).map(id => privateData(id));
    console.log('Private data each ground was built from. It is in the caches git ignores, on this machine only: back these directories up.\n');
    for (const ground of all) {
      console.log(`${ground.groundId.padEnd(16)} ${megabytes(ground.bytes).padStart(10)}  ${String(ground.files).padStart(6)} files${ground.pinned ? `  ${ground.pinnedHere} of ${ground.pinned} checksummed inputs here` : ''}`);
      for (const d of ground.directories) console.log(`${' '.repeat(17)}${megabytes(d.bytes).padStart(10)}  ${d.directory}`);
    }
    const bytes = all.reduce((sum, ground) => sum + ground.bytes, 0);
    console.log(`\n${megabytes(bytes)} in all. A ground with nothing listed keeps no private data here: it cannot be rebuilt from its sources on this machine.`);
  } else if (argv.includes('--machine')) print('This machine', machine());
  else if (groundId) {
    const findings = grounds().includes(groundId) ? await examine(groundId, undefined, { water: true }) : buildingFindings(groundId);
    print(`${groundId}`, findings);
    const count = level => findings.filter(finding => finding.level === level).length;
    console.log(`\n${count('broken')} broken, ${count('todo')} to do, ${count('owner')} for the owner, ${count('known')} known faults, ${count('ok')} hold.`);
    const next = findings.find(finding => finding.level === 'broken' || finding.level === 'todo');
    if (next) console.log(`Next: ${next.about}: ${next.text}${next.run ? `\n      > ${next.run}` : ''}`);
    if (argv.includes('--check') && count('broken')) process.exitCode = 1;
  } else {
    console.log('ground           broken  todo  owner  known  first thing open');
    for (const id of grounds()) {
      const findings = await examine(id), count = level => String(findings.filter(finding => finding.level === level).length);
      const first = findings.find(finding => finding.level === 'broken' || finding.level === 'todo');
      console.log(`${id.padEnd(16)} ${count('broken').padStart(6)} ${count('todo').padStart(5)} ${count('owner').padStart(6)} ${count('known').padStart(6)}  ${first ? `${first.about}: ${first.text}`.slice(0, 110) : 'nothing that needs no owner'}`);
    }
  }
}
