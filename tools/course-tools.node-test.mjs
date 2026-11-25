/* The pipeline's own tools: the steps that were scripts outside the repository at Bro Hof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pinnedFiles, pinProduction } from '../packages/course-workflow/pin-production.mjs';
import { prunePlan, prune } from '../packages/course-workflow/promote.mjs';
import { decisionErrors, loadDecisionFiles, traceConfigs } from '../packages/course-geo/mapping/check-decisions.mjs';
import { rebuildPlan } from './course-rebuild.mjs';
import { buildingFrame, measureBuilding, roofLevels } from './facility-pipeline/measure-building.mjs';
import { reviewMeta, reviewPage } from './course-review-page.mjs';
import { examine, grounds, privateData } from './course-doctor.mjs';
import { WATER_LINE, waterOffTheLine } from './water-line.mjs';
import { EVIDENCE, roundsCoverage, roundsEvidence } from './rounds-evidence.mjs';
import { applyOwnerReview, ownerReviewErrors, ownerReviewSummary, reviewDocument } from '../packages/course-workflow/owner-review.mjs';
import { draftAcceptance } from '../packages/course-workflow/acceptance.mjs';
import { reviewErrors as releaseReviewErrors } from '../packages/course-workflow/release.mjs';
import { reviewTemplate } from '../packages/course-workflow/standard.mjs';
import { fileDigest } from '../packages/course-workflow/io.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = text => createHash('sha256').update(text).digest('hex');
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'course-tools-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const put = (root, file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };

test('pinning moves only the checksums of files that changed, and names a file that is gone', t => {
  const root = temporary(t);
  put(root, 'a/model.json', 'one');
  put(root, 'a/card.json', 'card');
  const profile = { groundId: 'demo', courses: [{ slug: 'x', model: { path: 'a/model.json', sha256: sha('zero') }, card: { path: 'a/card.json', sha256: sha('card') } }],
    evidence: [{ path: 'a/gone.bin', sha256: sha('gone') }], note: 'kept' };
  assert.deepEqual(pinnedFiles(profile).map(p => p.at), ['courses.0.model', 'courses.0.card', 'evidence.0']);
  const { profile: next, moved, missing } = pinProduction(profile, { root });
  assert.deepEqual(moved.map(m => m.path), ['a/model.json']);
  assert.deepEqual(missing.map(m => m.path), ['a/gone.bin']);
  assert.equal(next.courses[0].model.sha256, sha('one'));
  assert.equal(next.courses[0].card.sha256, sha('card'));
  assert.equal(next.note, 'kept');
  assert.equal(profile.courses[0].model.sha256, sha('zero'), 'the profile handed in is not changed');
  assert.deepEqual(pinProduction(next, { root }).moved, []);
});

test('pruning removes only built files that no published generation names, and keeps a rollback whole', t => {
  const root = temporary(t), P = 'public', hash = n => String(n).repeat(64);
  const ground = (id, chunk) => put(root, `${P}/grounds/demo/ground-v2-${id}.json`, JSON.stringify({ tiles: [{ layers: { terrain: { url: `grounds/demo/terrain/${chunk}.bvch` } } }] }));
  const course = (id, groundId) => put(root, `${P}/courses/demo-main/course-v2-${id}.json`, JSON.stringify({ groundManifest: { url: `grounds/demo/ground-v2-${groundId}.json` }, routing: { url: `courses/demo-main/routing/${id}.bvch` } }));
  ground(hash(1), hash('a')); ground(hash(2), hash('b'));                                  // the generation before, and the one published
  course(hash(3), hash(1)); course(hash(4), hash(2)); course(hash(5), hash(9));            // the last one belongs to a generation that is gone
  for (const chunk of ['a', 'b', 'c']) put(root, `${P}/grounds/demo/terrain/${hash(chunk)}.bvch`, chunk);
  for (const id of [3, 4, 5]) put(root, `${P}/courses/demo-main/routing/${hash(id)}.bvch`, 'r');
  put(root, `${P}/courses/demo-main/prepared/tint-${hash(6)}.bin`, 'now');
  put(root, `${P}/courses/demo-main/prepared/tint-${hash(7)}.bin`, 'an older bake');
  put(root, `${P}/courses/demo-main/measured-water-${hash(8)}.geojson`, 'named in code');  // not a built family: never touched
  put(root, `${P}/courses/demo-main/hero-1.webp`, 'poster');
  put(root, `${P}/courses/demo-main/pack.bin`, 'pack');
  put(root, `${P}/grounds/demo/notes/${hash('d')}.json`, '{}');                              // a folder no generation uses
  put(root, `${P}/courses/v2-index.json`, JSON.stringify({ courses: [{ slug: 'demo-main', groundId: 'demo', manifest: { url: `courses/demo-main/course-v2-${hash(4)}.json` } }] }));
  put(root, `${P}/courses/index.json`, JSON.stringify({ courses: [{ slug: 'demo-main', packUrl: 'courses/demo-main/pack.bin', preparedTint: { 'painted-hi': { url: `courses/demo-main/prepared/tint-${hash(6)}.bin` } } }] }));
  const plan = prunePlan(root, 'demo', { publicRoot: P });
  assert.deepEqual(plan.orphans, [`courses/demo-main/course-v2-${hash(5)}.json`, `courses/demo-main/prepared/tint-${hash(7)}.bin`, `courses/demo-main/routing/${hash(5)}.bvch`,
    `grounds/demo/terrain/${hash('c')}.bvch`]);
  assert.equal(plan.generations, 2);
  assert.equal(prune(root, 'demo', { publicRoot: P }).applied, false);
  assert.ok(fs.existsSync(path.join(root, P, plan.orphans[0])), 'listing removes nothing');
  prune(root, 'demo', { publicRoot: P, apply: true });
  assert.deepEqual(prunePlan(root, 'demo', { publicRoot: P }).orphans, []);
  for (const kept of [`grounds/demo/terrain/${hash('a')}.bvch`, `courses/demo-main/course-v2-${hash(3)}.json`, `courses/demo-main/measured-water-${hash(8)}.geojson`, 'courses/demo-main/hero-1.webp',
    `grounds/demo/notes/${hash('d')}.json`]) assert.ok(fs.existsSync(path.join(root, P, kept)), kept);
  assert.throws(() => prunePlan(root, 'other', { publicRoot: P }), /no published routing/);
});

test('every published ground\'s decision files can be traced, and a broken one says where', () => {
  const configs = traceConfigs();
  assert.ok(configs.length >= 1);
  for (const file of configs) { const { config, files } = loadDecisionFiles(file); assert.deepEqual(decisionErrors(config, files), [], file); }
  const { config, files } = loadDecisionFiles(configs[0]), course = config.courses[0];
  const broken = change => { const copy = structuredClone(files); change(copy[course.decisions], copy); return decisionErrors(config, copy).join('\n'); };
  const firstTee = files[course.card].tees[0].id;
  assert.match(broken(d => { d.holes['3'].pads = d.holes['3'].pads.filter(p => !p.tees.includes(firstTee)); }), new RegExp(`hole 3: no deck for the card's "${firstTee}" tee`));
  assert.match(broken(d => { d.holes['3'].pads[0].tees.push('orange'); }), /"orange" is not a tee of the card/);
  assert.match(broken(d => { d.holes['4'].pads.push({ src: 'osm', id: 'w1', tees: [] }); }), /w1 is not in the OSM extract/);
  assert.match(broken(d => { d.holes['5'].pads.push({ ...d.holes['5'].pads[0] }); }), /is already on deck/);
  assert.match(broken(d => { d.holes['6'].pads.push({ src: 'ring', ring: [[17.6, 59.5], [17.61, 59.5], [17.61, 59.51]], tees: [] }); }), /leaves the ground's box/);
  assert.match(broken(d => { delete d.holes['7']; }), /hole 7 of the card has no decisions/);
  assert.match(broken(d => { d.holes['8'].green = {}; }), /the green needs a ring/);
  assert.match(broken((d, all) => { all[config.sandDecisions].keep[0].course = 'elsewhere'; }), /is not a routing of this ground/);
});

test('a rebuild runs the ground\'s own steps in the one order, with the ring review as a gate before the layers', () => {
  const ids = plan => plan.map(step => step.id);
  const full = rebuildPlan('bro-hof');
  assert.deepEqual(ids(full), ['card', 'decisions', 'trace', 'decks', 'sand', 'sheets', 'review', 'layers', 'compile', 'tests', 'inventory', 'pin', 'configure', 'stages', 'promote', 'prune', 'quality', 'map-land', 'walkthrough']);
  assert.ok(full.find(step => step.id === 'review').gate);
  assert.deepEqual(full.find(step => step.id === 'sheets').commands.map(command => command.includes('--blind')), [false, true], 'the blind sheets for a second reviewer are drawn together with the scored ones');
  assert.equal(full.find(step => step.id === 'compile').commands.length, 2, 'one compile a routing');
  assert.ok(!full.find(step => step.id === 'prune').commands[0].includes('--apply'), 'a rebuild never removes files by itself');
  assert.ok(!full.some(step => step.commands.flat().some(part => /gpu-pass|bake-(water|ground-tints|vista)|make-posters|git/.test(part))), 'no GPU work, no bake, no push');
  assert.deepEqual(ids(rebuildPlan('bro-hof', { from: 'compile', to: 'pin' })), ['compile', 'tests', 'inventory', 'pin']);
  assert.throws(() => rebuildPlan('bro-hof', { from: 'promote', to: 'compile' }), /comes before/);
  assert.throws(() => rebuildPlan('bro-hof', { from: 'paint' }), /has no step paint/);
  const older = ids(rebuildPlan('johannesberg'));  // built before the shared tracer: no trace, no ring sheets, its own model inventory
  assert.equal(older[0], 'card', 'every ground has a card, and a rebuild checks it first');
  assert.ok(!older.includes('trace') && !older.includes('decks') && !older.includes('sand') && !older.includes('inventory') && older.includes('stages') && older.includes('walkthrough'));
});

test('a building is measured along its own axes', () => {
  const turn = (x, y, degrees) => { const a = degrees * Math.PI / 180; return [1000 + x * Math.cos(a) - y * Math.sin(a), 2000 + x * Math.sin(a) + y * Math.cos(a)]; };
  const ring = [[-15, -5], [15, -5], [15, 5], [-15, 5]].map(([x, y]) => turn(x, y, -25));
  const frame = buildingFrame([...ring, ring[0]]);
  assert.deepEqual([frame.length, frame.width], [30, 10]);
  assert.ok(Math.abs(frame.origin[0] - 1000) < 0.01 && Math.abs(frame.origin[1] - 2000) < 0.01);
  assert.ok(frame.u[0] > 0 && Math.abs(Math.atan2(frame.u[1], frame.u[0]) * 180 / Math.PI + 25) < 0.01, 'u runs along the long side, eastwards');
  const points = [];
  for (let x = -22; x <= 22; x += 0.5) for (let y = -12; y <= 12; y += 0.5) {
    const onRoof = Math.abs(x) < 15 && Math.abs(y) < 5;
    const z = onRoof ? (Math.abs(x) < 5 ? 31 - Math.abs(y) * 0.4 : 24 + (5 - Math.abs(y)) * 0.6) : 12 + x * 0.01;
    points.push([...turn(x, y, -25), z, onRoof ? 6 : 2, 100]);
  }
  const report = measureBuilding(points, ring, { cell: 2 });
  assert.ok(Math.abs(report.groundRh2000.median - 12) < 0.2);
  assert.ok(report.roofRh2000.top > 30.5 && report.roofRh2000.top <= 31);
  assert.ok(report.roofRh2000.eavesAbout < 25.5);
  assert.equal(report.cells.highestReturn.length, Math.ceil((10 + 6) / 2));
  assert.deepEqual(roofLevels([20, 20, 20.1, 20.1, 20.2, 28, 28, 28.1, 28.1, 28.1, 28.1, 35], { share: 0.2 }).map(level => level.height), [20, 28]);
});

/* ------------------------------------------------------------ the owner's look, and the acceptance record */

const demoFacts = { groundId: 'demo', club: 'Demo GK', generation: 'f'.repeat(64), routings: [{ slug: 'demo-main', label: 'Main', build: 'no-such-build',
  holes: [1, 2].map(n => ({ n, name: `Hole ${n}`, par: 4, index: n, back: 380, decks: 4, bunkers: 2, water: n === 1 ? ['water'] : [], card: 1.2, flags: n === 2 ? ['gul tee +9 m against the card'] : [] })) }] };
const ASKED = ['tees', 'greens', 'fairways', 'bunkers', 'water', 'vegetation', 'infrastructure'];

/** The review page's own script, run against a stand-in for the browser. Returns the page's parts and what it saved. */
function openPage(html, stored = {}) {
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const element = tag => ({ tag, children: [], attrs: {}, value: '', disabled: false, set textContent(text) { this.text = text; this.children = []; }, get textContent() { return this.text; },
    appendChild(child) { this.children.push(child); return child; }, setAttribute(key, value) { this.attrs[key] = value; }, remove() {}, click() {} });
  const byId = {}, saved = [], get = id => (byId[id] ??= element(id));
  const scope = { document: { getElementById: get, createElement: element, createTextNode: text => ({ text }), body: element('body'), addEventListener() {} },
    localStorage: { getItem: key => stored[key] ?? null, setItem: (key, value) => { stored[key] = value; } }, window: { scrollTo() {} },
    URL: { createObjectURL: blob => { saved.push(JSON.parse(blob.text)); return 'blob:saved'; } }, Blob: class { constructor(parts) { this.text = parts.join(''); } } };
  new Function(...Object.keys(scope), script)(...Object.values(scope));
  const rows = () => get('hole').children.filter(child => child.attrs.class === 'cat'), row = category => rows()[ASKED.indexOf(category)];
  return { get, saved, stored, rows, title: () => get('hole').children[0].text, restIsRight: () => get('hole').children.find(child => child.attrs.class === 'go').children[1].onclick(),
    choose: (category, verdict) => row(category).children[2].children.find(button => button.attrs.class === verdict).onclick(),
    say: (category, text) => { const input = row(category).children[3]; input.value = text; input.oninput(); },
    name: text => { get('reviewer').value = text; get('reviewer').oninput(); } };
}

test('the owner\'s review page runs, keeps its place, and saves a review the tools accept', () => {
  const meta = reviewMeta(demoFacts, { site: 'http://127.0.0.1:8641' });
  assert.equal(meta.routings[0].holes[0].links.map, 'http://127.0.0.1:8641/?bana=demo-main&hal=1&karta=1');
  assert.equal(meta.routings[0].holes[0].picture, null, 'no overlay folder: the page says so and still works');
  const html = reviewPage(meta);
  assert.ok(!/<script[^>]+src=|<link[^>]+href=/.test(html), 'a local page: nothing fetched');
  const page = openPage(html);
  assert.equal(page.title(), 'Main · hole 1 · Hole 1');
  assert.deepEqual(page.rows().map(row => row.children[2].children.length), [2, 2, 3, 3, 3, 3, 3], 'a hole has tees and a green: "none here" is not offered for them');
  assert.equal(page.get('save').disabled, true, 'no name, no save');
  page.choose('bunkers', 'wrong');
  page.say('bunkers', 'the left greenside bunker is missing');
  page.choose('water', 'absent');
  page.restIsRight();
  assert.equal(page.title(), 'Main · hole 2 · Hole 2');
  assert.equal(page.get('progress').text, '1 of 2 holes');
  page.name('Test Owner');
  page.get('save').onclick();
  assert.deepEqual(ownerReviewSummary(page.saved[0]), { holes: 2, decided: 1, complete: false, wrong: [{ slug: 'demo-main', hole: 1, category: 'bunkers', note: 'the left greenside bunker is missing' }] });

  const again = openPage(html, page.stored); // the browser is closed and opened: the verdicts are still there
  assert.equal(again.get('reviewer').value, 'Test Owner');
  again.restIsRight();
  again.restIsRight();
  again.get('save').onclick();
  const doc = again.saved[0], expect = { groundId: 'demo', groundManifestSha256: 'f'.repeat(64), routings: [{ slug: 'demo-main', holes: 2 }], surfaces: meta.surfaces };
  assert.deepEqual(doc, reviewDocument(meta, JSON.parse(Object.values(again.stored)[0]), doc.savedAt), 'the page saves what the shared function gives');
  assert.deepEqual(ownerReviewErrors(doc, expect), []);
  assert.deepEqual([doc.holes[0].categories.bunkers.status, doc.holes[0].categories.water.status, doc.holes[1].categories.tees.status], ['wrong', 'absent', 'right']);
  assert.equal(ownerReviewSummary(doc).complete, true);

  const broken = change => { const copy = structuredClone(doc); change(copy); return ownerReviewErrors(copy, expect).join('\n'); };
  assert.match(ownerReviewErrors(doc, { ...expect, groundManifestSha256: 'e'.repeat(64) }).join('\n'), /another generation/);
  assert.match(ownerReviewErrors(doc, { ...expect, surfaces: { 'demo-main': 'd'.repeat(64) } }).join('\n'), /outlines changed since the page was made/);
  assert.match(broken(d => { d.reviewer = ''; }), /does not say who looked/);
  assert.match(broken(d => { d.holes[1].categories.greens.status = 'absent'; }), /a hole has greens/);
  assert.match(broken(d => { d.holes[0].categories.bunkers.note = ''; }), /marked wrong without saying what is wrong/);
  assert.match(broken(d => { d.holes.pop(); }), /demo-main\/2: missing from the review/);
  assert.match(broken(d => { d.holes[1].hole = 1; }), /not a hole of this ground, or twice/);
  assert.match(broken(d => { d.holes[1].categories.tees.status = 'fine'; }), /no verdict the page offers/);
  assert.deepEqual(ownerReviewErrors({ ...doc, groundId: 'elsewhere' }, expect), ['this is not an owner review of this ground']);
});

test('a saved review becomes rows the release review accepts, and what was marked wrong stays open with its note', t => {
  const root = temporary(t), w = { groundId: 'demo', courses: [{ slug: 'demo-main', holes: 2 }] }, digest = 'a'.repeat(64);
  const meta = reviewMeta(demoFacts), state = { reviewer: 'Test Owner', holes: {
    'demo-main/1': { cats: { tees: 'right', greens: 'right', fairways: 'right', bunkers: 'wrong', water: 'absent', vegetation: 'right', infrastructure: 'right' }, notes: { bunkers: 'one is missing' }, note: '' },
    'demo-main/2': { cats: { tees: 'right', greens: 'right', fairways: 'right', bunkers: 'right', water: 'right', vegetation: 'right' }, notes: {}, note: 'the path was moved' } } };
  const doc = reviewDocument(meta, state, '2026-11-25T18:00:00.000Z');
  put(root, 'evidence/owner-review.json', `${JSON.stringify(doc, null, 1)}\n`);
  const evidence = { path: 'evidence/owner-review.json', sha256: fileDigest(root, 'evidence/owner-review.json') };
  const before = reviewTemplate(w, digest), { review, reviewed, open } = applyOwnerReview(before, doc, evidence);
  assert.deepEqual([reviewed, open], [12, 1]);
  assert.equal(before.holes[0].categories.tees.status, 'unknown', 'the review handed in is not changed');
  assert.deepEqual(review.holes[0].categories.water, { status: 'not-applicable', notes: 'Test Owner: none on this hole.', evidence: [evidence] });
  assert.deepEqual(review.holes[0].categories.bunkers, { status: 'unknown', notes: 'Test Owner: wrong. one is missing', evidence: [evidence] });
  assert.equal(review.holes[1].categories.tees.notes, 'Test Owner: as on the photo. the path was moved.');
  assert.deepEqual(review.holes[1].categories.infrastructure, { status: 'unknown', notes: '', evidence: [] }, 'a category nobody judged is left as it was');
  const rows = releaseReviewErrors(root, w, review, digest).filter(line => line.startsWith('demo-main/'));
  assert.deepEqual(rows, ['demo-main/1.bunkers: unknown', 'demo-main/2.infrastructure: unknown', 'demo-main/2.infrastructure: findings or absence rationale required', 'demo-main/2.infrastructure: hashed evidence required']);
});

test('the acceptance record is drafted from what is open now, and cannot say less', () => {
  const w = JSON.parse(fs.readFileSync(path.join(ROOT, 'course-workflows/bro-hof/workflow.json'), 'utf8'));
  const record = JSON.parse(fs.readFileSync(path.join(ROOT, 'course-workflows/bro-hof/owner-acceptance.json'), 'utf8'));
  const given = { acceptedOn: record.acceptedOn, basis: record.basis, reasons: record.open };
  assert.deepEqual(draftAcceptance(ROOT, w, given), record, 'Bro Hof\'s record is what the tool writes');
  const [first, ...rest] = Object.keys(record.open);
  assert.throws(() => draftAcceptance(ROOT, w, { ...given, reasons: Object.fromEntries(rest.map(id => [id, record.open[id]])) }), new RegExp(`no reason given for open item ${first}`));
  assert.throws(() => draftAcceptance(ROOT, w, { ...given, reasons: { ...record.open, 'tree-gate': 'not something the release check holds open' } }), /tree-gate is not open/);
  assert.throws(() => draftAcceptance(ROOT, w, { ...given, basis: 'the owner said yes' }), /what the owner was asked/);
  assert.throws(() => draftAcceptance(ROOT, w, { ...given, acceptedOn: 'yesterday' }), /the date the owner decided/);
});

test('the mapping environment asks for the same libraries on Windows as everywhere else, and the lock gives the same versions', () => {
  const manifest = fs.readFileSync(path.join(ROOT, 'packages/course-geo/toolchain/pixi.toml'), 'utf8').replace(/\r\n/g, '\n');
  const section = name => { const start = manifest.indexOf(`[${name}]\n`); assert.ok(start >= 0, name); const body = manifest.slice(start + name.length + 3); return body.slice(0, body.search(/\n\[/)); };
  const wants = text => Object.fromEntries(text.split('\n').filter(line => /^[a-z]/.test(line)).map(line => line.split(' = ')).map(([name, range]) => [name, range]));
  const elsewhere = wants(section('feature.mapping.target.unix.dependencies')), windows = wants(section('feature.mapping.target.win-64.pypi-dependencies'));
  delete elsewhere.libblas; // conda-forge's choice of BLAS; the official builds carry their own
  assert.deepEqual(windows, elsewhere, 'change the two lists together');
  assert.deepEqual(Object.keys(windows).sort(), ['numpy', 'pillow', 'pyproj', 'rasterio', 'scipy', 'shapely']);
  const lock = fs.readFileSync(path.join(ROOT, 'packages/course-geo/toolchain/pixi.lock'), 'utf8');
  for (const name of Object.keys(windows)) {
    const official = new RegExp(`/${name}-(\\d[\\w.]*)-cp312-cp312-win_amd64\\.whl`).exec(lock)?.[1], conda = new RegExp(`/linux-64/${name}-(\\d[\\w.]*)-`).exec(lock)?.[1];
    assert.ok(official && conda, `${name} is locked for both`);
    assert.equal(official, conda, `${name}: Windows and Linux are locked to different versions; lock them together`);
  }
});

test('a pond that stands unlike every accepted pond is named once, by the routing nearest to it', () => {
  const body = (index, more) => ({ index, sea: false, areaM2: 800, nearHole: 4, holeM: 30, boot: 5.2, ringP50: 5.0, freeboard: 0.6, ...more });
  const report = [
    { slug: 'demo', ground: 'demo', bodies: [body(0), body(1, { boot: 4.6 }), body(2, { boot: 5.5 }), body(3, { freeboard: 0.0 }), body(4, { boot: 4.0, holeM: 400 }),
      body(5, { boot: 3.0, sea: true }), body(6, { boot: 4.95 }), body(7, { freeboard: 0.05 })] },
    { slug: 'demo-9', ground: 'demo', bodies: [body(1, { boot: 4.6, holeM: 12, nearHole: 2 }), body(0, { holeM: 80 })] },
  ];
  const off = waterOffTheLine(report);
  assert.deepEqual(off.map(found => [found.slug, found.index, found.hole]), [['demo-9', 1, 2], ['demo', 2, 4], ['demo', 3, 4]]);
  assert.match(off[0].why, /stands -0\.40 m from the ground along its own outline: the outline may miss its basin/);
  assert.match(off[1].why, /stands \+0\.50 m from the ground along its own outline: it would flood past it/);
  assert.match(off[2].why, /stands at the height of its bank \(0\.00 m below it\)/);
  assert.deepEqual([WATER_LINE.belowOutline, WATER_LINE.aboveOutline, WATER_LINE.freeboard, WATER_LINE.reachMetres], [-0.1, 0.35, 0.05, 100], 'the lines every accepted pond keeps; move them only with the audit of every layout in hand');
  assert.deepEqual(waterOffTheLine([{ slug: 'dry', ground: 'dry', bodies: [] }]), []);
});

test('the private data a ground was built from is listed with its size, and its checksummed inputs counted', t => {
  const root = temporary(t);
  put(root, 'apps/golf/public/courses/index.json', JSON.stringify({ courses: [{ slug: 'demo-main', build: 'demobuild' }, { slug: 'demo-9', build: 'demoninebuild' }, { slug: 'other', build: 'otherbuild' }] }));
  put(root, 'apps/golf/public/courses/v2-index.json', JSON.stringify({ courses: [{ slug: 'demo-main', groundId: 'demo' }, { slug: 'demo-9', groundId: 'demo' }, { slug: 'other', groundId: 'other' }] }));
  put(root, 'demobuild/cache/ortho/photo.tif', 'x'.repeat(1000));
  put(root, 'demobuild/cache/laser/points.laz', 'y'.repeat(500));
  put(root, 'demobuild/course-model.json', '{}');                                              // tracked, not private
  put(root, 'packages/course-geo/toolchain/.cache/acquisition/demo-ground-rings/l0.f32', 'z'.repeat(300));
  put(root, 'packages/course-geo/toolchain/.cache/acquisition/demolition/l0.f32', 'another ground whose name begins the same');
  put(root, 'course-workflows/demo/production.json', JSON.stringify({ inputs: [{ path: 'demobuild/cache/ortho/photo.tif', sha256: sha('x') }, { path: 'demobuild/cache/gone.tif', sha256: sha('g') },
    { path: 'demobuild/course-model.json', sha256: sha('{}') }] }));
  const found = privateData('demo', root);
  assert.deepEqual(found.directories.map(d => [d.directory, d.files, d.bytes]), [['demobuild/cache', 2, 1500], ['packages/course-geo/toolchain/.cache/acquisition/demo-ground-rings', 1, 300]]);
  assert.deepEqual([found.files, found.bytes, found.pinned, found.pinnedHere], [3, 1800, 2, 1], 'two inputs are checksummed in the private folders, and one of them is on this machine');
  assert.deepEqual(privateData('other', root), { groundId: 'other', directories: [], files: 0, bytes: 0, pinned: 0, pinnedHere: 0 }, 'a ground with no private data here says so');
});

test('real rounds name a place only where enough good shots agree, and say how little they had', () => {
  const square = (x, z, half) => [[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]];
  const model = { holes: [
    { n: 1, tees: { pads: [{ id: 'x-tee-01-1', ring: square(0, 0, 4) }, { ring: square(0, 30, 4) }] }, green: { ring: square(0, 300, 12) } },
    { n: 2, tees: { pads: [{ id: 'x-tee-02-1', ring: square(100, 0, 4) }] }, green: { ring: square(100, 150, 10) } },
  ] };
  const shot = (hole, kind, x, z, accuracy = 4) => ({ courseSlug: 'x', hole, kind, x, z, accuracy });
  const shots = [
    // hole 1: three golfers on the deck, five a dozen metres behind it where the model has none, one stray
    shot(1, 'tee', 1, -1), shot(1, 'tee', -2, 2), shot(1, 'tee', 0, 31),
    shot(1, 'tee', 1, -17), shot(1, 'tee', -1, -18), shot(1, 'tee', 2, -16), shot(1, 'tee', 0, -19), shot(1, 'tee', -2, -17),
    shot(1, 'tee', 60, 60),
    // a fix too poor to use, however many
    ...Array.from({ length: 6 }, () => shot(1, 'tee', 40, -40, 25)),
    // hole 1's green: nine putts on it; hole 2's green: most putts start beside the outline
    ...Array.from({ length: 9 }, (_, i) => shot(1, 'putt', i - 4, 300)),
    ...Array.from({ length: 3 }, (_, i) => shot(2, 'putt', 100 + i, 150)), ...Array.from({ length: 7 }, (_, i) => shot(2, 'putt', 118 + i, 150)),
    // hole 2: only three tee shots, all off the deck: too few to say
    shot(2, 'tee', 100, -20), shot(2, 'tee', 101, -21), shot(2, 'tee', 99, -19),
  ];
  const found = roundsEvidence(model, shots);
  assert.deepEqual(found.map(f => [f.hole, f.about, f.shots]), [[1, 'tee', 5], [2, 'green', 10]]);
  assert.match(found[0].text, /^5 of 9 tee shots start round \(0, -17\), 13 m from the nearest deck \(x-tee-01-1\)/);
  assert.match(found[1].text, /^7 of 10 putts start more than 3 m outside the green's outline/);
  assert.deepEqual(roundsCoverage(model, shots), [{ hole: 1, teeShots: 9, putts: 9 }, { hole: 2, teeShots: 3, putts: 10 }]);
  assert.deepEqual(roundsEvidence(model, []), [], 'no rounds, nothing said');
  assert.ok(EVIDENCE.fewestTeeShots >= 4 && EVIDENCE.accuracyMetres <= 10, 'one shot, or a poor fix, proves nothing');
  const tool = fs.readFileSync(path.join(ROOT, 'tools/rounds-evidence.mjs'), 'utf8');
  const query = tool.slice(tool.indexOf('SELECT course_slug'), tool.indexOf('No user, no round'));
  assert.ok(query.includes('PARTITION BY user_id'), 'the first shot of a hole is found a round at a time');
  const columns = query.slice(0, query.indexOf('FROM (')); // what the extract hands over; the inner query may read more to find a hole's first shot
  assert.ok(columns.length > 80 && !/user_id|round_id|played_date|club|\bat\b|record_json/i.test(columns), 'the extract names no player, round, time or club');
});

test('the doctor reads a ground\'s records once and sorts what it finds, worst first', async () => {
  assert.ok(grounds().length >= 11 && grounds().includes('bro-hof'));
  const levels = ['broken', 'todo', 'owner', 'known', 'ok'];
  const broHof = await examine('bro-hof');
  assert.deepEqual(broHof.filter(finding => finding.level === 'broken' || finding.level === 'todo').map(finding => `${finding.about}: ${finding.text}`), [],
    'Bro Hof is the ground built with every step: nothing in it may be broken or left to do without the owner');
  assert.deepEqual(broHof.map(finding => levels.indexOf(finding.level)), broHof.map(finding => levels.indexOf(finding.level)).sort((a, b) => a - b));
  for (const about of ['card', 'decisions', 'ring review', 'tee decks', 'sand', 'quality gate', 'walkthrough', 'production', 'release']) assert.ok(broHof.some(finding => finding.about === about), about);
  assert.ok(broHof.some(finding => finding.level === 'known' && finding.about === 'second look' && /castle-tee-11-1/.test(finding.text)), 'a fault kept on purpose is shown, not hidden');
  assert.ok(broHof.every(finding => !finding.run || !/BANVY_GPU|gpu-pass|make-posters/.test(finding.run) || finding.level === 'owner'), 'anything on the GPU is the owner\'s');
  const older = await examine('ribbingsfors'); // built before the shared tracer
  assert.ok(older.some(finding => finding.about === 'outlines' && finding.level === 'known' && /own older builder/.test(finding.text)));
  const written = fs.existsSync(path.join(ROOT, 'docs/courses/ribbingsfors-walkthrough.md'));
  assert.ok(older.some(finding => finding.about === 'walkthrough' && finding.level === (written ? 'ok' : 'todo')), 'a walkthrough that is there and current holds; one that is missing is work to do');
  assert.ok(!older.some(finding => finding.about === 'ring review' || finding.about === 'sand'), 'no record is asked of a ground that never had the step');
});
