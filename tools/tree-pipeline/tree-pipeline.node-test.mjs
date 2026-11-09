import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, chmGrid, configTemplate, createContext, haloWindow, loadGroundConfig, readGroundConfig, validateGroundConfig } from './config.mjs';
import { HELD_OUT_GATE, assertHeldOutUnseen, evaluateGate, ownerExceptionFor, publicationVerdict, staleExceptions } from './gate.mjs';
import { STAGES, STAGE_NAMES, firstIncompleteStage, missingPrerequisites, nextStage, stageIndex } from './stages.mjs';
import { forbiddenSource, laserPolicyProblems, orthoPolicyProblems, safeOrthoUrl } from './source-policy.mjs';
import { photoEvidenceKey, photoLabel, shadowEvidenceKey } from './crown-evidence.mjs';
import { poleLike } from './candidates.mjs';
import { leafOffClass, strataWarnings, stratumOf } from './detect.mjs';
import { terrainVerdict } from './canopy.mjs';
import { mergeChecklist, openItems } from './review.mjs';
import { publicationBlockers } from './publish.mjs';
import { parseArgs } from '../tree-pipeline.mjs';
import { sha256File } from './receipts.mjs';

const johannesberg = () => JSON.parse(JSON.stringify(readGroundConfig(ROOT, 'johannesberg')));
const without = (problems, pattern) => problems.filter(p => !pattern.test(p));

/* ---------------- config ---------------- */

test('Johannesberg config validates and gives the published review frame', () => {
  const config = johannesberg();
  assert.deepEqual(validateGroundConfig(config, { groundId: 'johannesberg' }), []);
  const ctx = loadGroundConfig(ROOT, 'johannesberg');
  assert.equal(ctx.round.id, 'r6');
  assert.equal(ctx.round.detector, 'fused');
  assert.equal(ctx.round.publishes, undefined);
  assert.equal(ctx.roundOf('r3').detector, 'refined');
  assert.equal(ctx.roundOf('r2').detector, 'typed');
  assert.equal(ctx.leafOff.date, '2021-04-18');
  assert.equal(ctx.presence.date, '2025-06-14');
  assert.deepEqual(haloWindow(config), { minEasting: 678343.5, minNorthing: 6624216.5, maxEasting: 680511.5, maxNorthing: 6626384.5 });
  assert.deepEqual({ ...chmGrid(config) }, { minEasting: 678343.5, maxNorthing: 6626384.5, width: 4336, height: 4336, sampleSpacingMetres: 0.5 });
  assert.equal(ctx.sampleFile('benchmark'), 'benchmark-r6.json');
  assert.equal(ctx.sampleFile('benchmark', 'json', 'r2'), 'benchmark-r2.json');
  assert.equal(ctx.sampleFile('detector-lock', 'json', 'r1'), 'detector-lock.json');
  assert.equal(ctx.sampleFile('reference', 'geojson', 'r2'), 'reference-r2.geojson');
  assert.equal(ctx.rel(ctx.paths.rasters), 'johannesbergbuild/cache/trees-2026-11-08/rasters');
  assert.equal(ctx.reviewDate, '2026-11-08');
});

test('overrides read one cache and write another', () => {
  const ctx = createContext(ROOT, johannesberg(), { raw: '../elsewhere/cache', cache: 'output/tree-proof/cache', reviewDir: 'output/tree-proof/review', round: 'r1' });
  assert.equal(ctx.rel(ctx.paths.copc), '../elsewhere/cache/copc');
  assert.equal(ctx.rel(ctx.paths.ortho), '../elsewhere/cache/ortho');
  assert.equal(ctx.rel(ctx.paths.rasters), 'output/tree-proof/cache/rasters');
  assert.equal(ctx.rel(ctx.paths.reviewDir), 'output/tree-proof/review');
  assert.equal(ctx.round.id, 'r1');
  assert.throws(() => createContext(ROOT, johannesberg(), { round: 'r9' }), /round r9 is not declared/);
});

test('the template fails until every TODO is filled in', () => {
  const problems = validateGroundConfig(configTemplate('new-ground'), { groundId: 'new-ground' });
  assert.ok(problems.some(p => /placeholder/.test(p)));
  assert.ok(problems.length > 10);
});

test('validation refuses unknown keys, other providers, a lowered gate and the live root as staging', () => {
  const unknown = { ...johannesberg(), gate: { precision: 0.8, recall: 0.8 } };
  assert.ok(validateGroundConfig(unknown).some(p => /config\.gate is not a known setting/.test(p)));
  const provider = { ...johannesberg(), provider: 'skogsstyrelsen' };
  assert.ok(validateGroundConfig(provider).some(p => /lantmateriet/.test(p)));
  const live = johannesberg();
  live.publication.stagingRoot = 'apps/golf/public';
  assert.ok(validateGroundConfig(live).some(p => /never the live public root/.test(p)));
  const leafOn = johannesberg();
  leafOn.orthophotos.leafOff = '2025';
  assert.ok(validateGroundConfig(leafOn).some(p => /leafOff must be a leaf-off campaign/.test(p)));
  const notOrtho = johannesberg();
  notOrtho.orthophotos.campaigns[0].collection = 'ythojdmodell-flygbild';
  assert.ok(validateGroundConfig(notOrtho).some(p => /orto-/.test(p)));
  const share = johannesberg();
  share.typeRule.broadleafMaximumAprilShare = 1.2;
  assert.ok(validateGroundConfig(share).some(p => /broadleafMaximumAprilShare/.test(p)));
  const wrongGround = johannesberg();
  assert.ok(validateGroundConfig(wrongGround, { groundId: 'visby' }).some(p => /does not match/.test(p)));
});

test('owner exceptions must be the owner\'s, pin a benchmark and state the decision', () => {
  const agent = johannesberg();
  agent.ownerExceptions[0].decidedBy = 'agent';
  assert.ok(validateGroundConfig(agent).some(p => /decidedBy must be "owner"/.test(p)));
  const unpinned = johannesberg();
  delete unpinned.ownerExceptions[0].benchmark.sha256;
  assert.ok(validateGroundConfig(unpinned).some(p => /pin the scored benchmark/.test(p)));
  const terse = johannesberg();
  terse.ownerExceptions[0].decision = 'ok';
  assert.ok(validateGroundConfig(terse).some(p => /decision must state/.test(p)));
});

test('rounds: unique suffixes, a typed round starts from an earlier v2 round', () => {
  const bad = johannesberg();
  bad.rounds[1].startFrom = 'r2';
  assert.ok(validateGroundConfig(bad).some(p => /startFrom must name an earlier round/.test(p)));
  const dup = johannesberg();
  dup.rounds[1].sampleSuffix = '';
  assert.ok(validateGroundConfig(dup).some(p => /sampleSuffix/.test(p)));
  const noHeldOut = johannesberg();
  noHeldOut.rounds[0].evaluationRole = 'calibration';
  assert.ok(validateGroundConfig(noHeldOut).some(p => /held-out role/.test(p)));
});

/* ---------------- stage ordering ---------------- */

test('the stages run in the declared order', () => {
  assert.deepEqual(STAGE_NAMES, ['acquire', 'canopy', 'detect', 'verify', 'reference', 'photo-detect', 'benchmark', 'candidates', 'review', 'publish']);
  assert.equal(stageIndex('acquire'), 0);
  assert.equal(nextStage('candidates').name, 'review');
  assert.equal(nextStage('publish'), null);
  assert.throws(() => stageIndex('deploy'), /unknown stage/);
});

test('every stage needs only what an earlier stage (or a person) makes', () => {
  const ctx = loadGroundConfig(ROOT, 'johannesberg');
  STAGES.forEach((stage, index) => {
    for (const file of stage.needs(ctx)) {
      const maker = STAGES.findIndex(s => s.produces(ctx).includes(file));
      if (maker >= 0) assert.ok(maker < index, `${stage.name} needs ${ctx.rel(file)}, made by the later stage ${STAGES[maker].name}`);
    }
  });
});

test('a stage waits for missing products and names their maker', () => {
  const ctx = loadGroundConfig(ROOT, 'johannesberg');
  const nothing = () => false;
  const missing = missingPrerequisites(ctx, 'detect', nothing);
  assert.ok(missing.some(m => m.madeBy === 'canopy'));
  assert.ok(missing.some(m => m.madeBy === 'acquire'));
  assert.equal(firstIncompleteStage(ctx, nothing).name, 'acquire');
  assert.equal(firstIncompleteStage(ctx, () => true), null);
  const all = new Set(STAGES.slice(0, 4).flatMap(s => s.produces(ctx)));
  assert.equal(firstIncompleteStage(ctx, file => all.has(file)).name, 'reference');
  assert.deepEqual(missingPrerequisites(ctx, 'reference', file => all.has(file)), []);
});

test('the CLI parses flags and values strictly', () => {
  assert.deepEqual(parseArgs(['--ground', 'johannesberg', '--stage', 'benchmark', '--score']), { ground: 'johannesberg', stage: 'benchmark', score: true });
  assert.throws(() => parseArgs(['--ground']), /needs a value/);
  assert.throws(() => parseArgs(['johannesberg']), /unexpected argument/);
});

/* ---------------- the held-out gate ---------------- */

const round = { id: 'r1', methodName: 'r1-detector', evaluationRole: 'evaluation' };
const benchmarkWith = (score, gate = { precision: 0.9, recall: 0.9 }) => ({ gate, results: { 'r1-detector': { evaluation: score } } });

test('the gate passes only at 90% precision and recall on at least 30 held-out crowns', () => {
  const pass = evaluateGate(benchmarkWith({ tp: 38, missed: 2, extra: 3, precision: 0.927, recall: 0.95, f1: 0.938 }), round);
  assert.equal(pass.status, 'PASS');
  const lowRecall = evaluateGate(benchmarkWith({ tp: 41, missed: 11, extra: 2, precision: 0.953, recall: 0.788, f1: 0.863 }), round);
  assert.equal(lowRecall.status, 'FAIL');
  assert.ok(lowRecall.reasons.some(r => /recall 0.788 is below 0.9/.test(r)));
  const small = evaluateGate(benchmarkWith({ tp: 25, missed: 0, extra: 0, precision: 1, recall: 1, f1: 1 }), round);
  assert.equal(small.status, 'FAIL');
  assert.ok(small.reasons.some(r => /only 25 scored/.test(r)));
  const missing = evaluateGate({ results: {} }, round);
  assert.equal(missing.status, 'FAIL');
});

test('a benchmark file cannot lower the gate', () => {
  const lowered = evaluateGate(benchmarkWith({ tp: 40, missed: 6, extra: 4, precision: 0.909, recall: 0.87, f1: 0.889 }, { precision: 0.8, recall: 0.8 }), round);
  assert.equal(lowered.status, 'FAIL');
  assert.ok(lowered.reasons.some(r => /lowered recall gate/.test(r)));
  assert.equal(HELD_OUT_GATE.precision, 0.9);
  assert.equal(HELD_OUT_GATE.recall, 0.9);
  assert.ok(Object.isFrozen(HELD_OUT_GATE));
});

test('an owner exception covers only the benchmark it pinned', () => {
  const gate = evaluateGate(benchmarkWith({ tp: 41, missed: 11, extra: 2, precision: 0.953, recall: 0.788, f1: 0.863 }), round);
  const config = { ownerExceptions: [{ gate: HELD_OUT_GATE.id, round: 'r1', decidedOn: '2026-11-08', decidedBy: 'owner', benchmark: { path: 'b.json', sha256: 'a'.repeat(64) }, measured: { precision: 0.953, recall: 0.788 }, decision: 'x'.repeat(50), record: 'README.md' }] };
  assert.ok(ownerExceptionFor(config, gate, 'a'.repeat(64)));
  assert.equal(ownerExceptionFor(config, gate, 'b'.repeat(64)), null);
  assert.match(staleExceptions(config, gate, 'b'.repeat(64))[0].why, /another benchmark file/);
  const restated = { ownerExceptions: [{ ...config.ownerExceptions[0], measured: { precision: 0.953, recall: 0.81 } }] };
  assert.equal(ownerExceptionFor(restated, gate, 'a'.repeat(64)), null);
  const agent = { ownerExceptions: [{ ...config.ownerExceptions[0], decidedBy: 'agent' }] };
  assert.equal(ownerExceptionFor(agent, gate, 'a'.repeat(64)), null);
  const allowed = publicationVerdict(gate, ownerExceptionFor(config, gate, 'a'.repeat(64)));
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.gate, 'FAIL');
  const blocked = publicationVerdict(gate, null);
  assert.equal(blocked.allowed, false);
  assert.match(blocked.note, /Stop and ask the owner/);
});

test('a scored held-out sample is never tuned on, nor rescored with another lock', () => {
  const existing = { scoredAt: '2026-11-08T17:00:00Z', detectorLockSha256: 'c'.repeat(64) };
  assert.throws(() => assertHeldOutUnseen({ action: 'tune', existing, roundId: 'r1' }), /new round/);
  assert.throws(() => assertHeldOutUnseen({ action: 'score', existing, lockSha256: 'd'.repeat(64), roundId: 'r1' }), /new round/);
  assert.doesNotThrow(() => assertHeldOutUnseen({ action: 'score', existing, lockSha256: 'c'.repeat(64), roundId: 'r1' }));
  assert.doesNotThrow(() => assertHeldOutUnseen({ action: 'tune', existing: null, roundId: 'r1' }));
});

test('Johannesberg: the round-2 gate fails and the owner exception of 2026-11-08 covers that benchmark', () => {
  const ctx = loadGroundConfig(ROOT, 'johannesberg', { round: 'r2' });
  const file = ctx.reviewFile(ctx.sampleFile('benchmark'));
  const gate = evaluateGate(JSON.parse(fs.readFileSync(file, 'utf8')), ctx.round);
  assert.equal(gate.status, 'FAIL');
  assert.equal(gate.measured.precision, 0.953);
  assert.equal(gate.measured.recall, 0.788);
  assert.equal(gate.measured.scored, 52);
  const exception = ownerExceptionFor(ctx.config, gate, sha256File(file));
  assert.equal(exception?.decidedOn, '2026-11-08');
  assert.ok(fs.existsSync(path.join(ROOT, exception.record)));
});

test('Johannesberg: the round-3 gate fails and the owner accepted round 3 on 2026-11-08, pinned to its benchmark', () => {
  const ctx = loadGroundConfig(ROOT, 'johannesberg', { round: 'r3' });
  assert.equal(ctx.round.id, 'r3');
  const file = ctx.reviewFile(ctx.sampleFile('benchmark'));
  const gate = evaluateGate(JSON.parse(fs.readFileSync(file, 'utf8')), ctx.round);
  assert.equal(gate.status, 'FAIL');
  assert.equal(gate.measured.precision, 0.984);
  assert.equal(gate.measured.recall, 0.685);
  assert.equal(gate.measured.scored, 89);
  const exception = ownerExceptionFor(ctx.config, gate, sha256File(file));
  assert.equal(exception?.decidedBy, 'owner');
  assert.match(exception.decision, /Accept round 3 below the 90% target, as you did for round 2/);
  assert.equal(publicationVerdict(gate, exception).allowed, true);
  assert.equal(publicationVerdict(gate, exception).gate, 'FAIL', 'a FAIL is never relabelled');
});

/* ---------------- sources ---------------- */

test('sources: Lantmäteriet COPC and orthophotos only', () => {
  const ctx = loadGroundConfig(ROOT, 'johannesberg');
  const campaigns = JSON.parse(fs.readFileSync(path.join(ROOT, ctx.config.laser.campaigns), 'utf8'));
  assert.deepEqual(laserPolicyProblems(campaigns, ctx.config.laser.items), []);
  assert.deepEqual(orthoPolicyProblems(ctx.config.orthophotos.campaigns), []);
  const item = JSON.parse(JSON.stringify(campaigns.items.find(i => i.id === ctx.config.laser.items[0])));
  const raster = { ...campaigns, items: [{ ...item, assets: { data: { ...item.assets.data, href: 'https://dl1.lantmateriet.se/hojd/data/ytmodell/dsm.tif', type: 'image/tiff' } } }] };
  assert.ok(laserPolicyProblems(raster, [item.id]).some(p => /not a COPC point cloud|forbidden/.test(p)));
  const elsewhere = { ...campaigns, items: [{ ...item, assets: { data: { ...item.assets.data, href: 'https://example.org/a.copc.laz' } } }] };
  assert.ok(laserPolicyProblems(elsewhere, [item.id]).some(p => /not served by dl1.lantmateriet.se/.test(p)));
  assert.ok(forbiddenSource('Ythöjdmodell från flygbilder'));
  assert.ok(forbiddenSource('skogsstyrelsen-laser'));
  assert.ok(!forbiddenSource('dsm-skoglig-copc'));
  assert.ok(!forbiddenSource('orto-o2-2025'));
  assert.throws(() => safeOrthoUrl('https://example.org/bild/data/orto/x.tif'), /not a Lantmäteriet orthophoto/);
  assert.equal(safeOrthoUrl('https://dl1.lantmateriet.se/bild/data/orto/o2/x.tif').hostname, 'dl1.lantmateriet.se');
});

/* ---------------- stage rules ---------------- */

test('photo evidence is keyed by the photo month and year', () => {
  assert.equal(photoLabel({ date: '2021-04-18' }), 'April 2021');
  assert.equal(photoEvidenceKey({ date: '2025-06-14' }), 'june2025');
  assert.equal(shadowEvidenceKey({ date: '2021-04-18' }, { date: '2025-06-14' }), 'shadow2021');
  assert.equal(shadowEvidenceKey({ date: '2023-05-02' }, { date: '2023-07-20' }), 'shadowmay2023');
});

test('the pole-like hold: narrow and tall, only when switched on', () => {
  const rule = { maximumRadiusMetres: 1, minimumHeightMetres: 5 };
  assert.equal(poleLike({ radiusMetres: 0.75, heightMetres: 9 }, rule), true);
  assert.equal(poleLike({ radiusMetres: 1.2, heightMetres: 9 }, rule), false);
  assert.equal(poleLike({ radiusMetres: 0.75, heightMetres: 4 }, rule), false);
  assert.equal(poleLike({ radiusMetres: 0.75, heightMetres: 9 }, null), false);
});

test('strata and the closed-stand warning', () => {
  assert.equal(stratumOf(0.1), 'isolated');
  assert.equal(stratumOf(0.3), 'group');
  assert.equal(stratumOf(0.6), 'edge');
  assert.equal(stratumOf(0.95), 'closed');
  assert.equal(leafOffClass(0.7), 'conifer-like');
  assert.equal(leafOffClass(0.1), 'leafless');
  assert.equal(leafOffClass(0.35), 'mixed');
  assert.equal(leafOffClass(Number.NaN), 'unknown');
  assert.ok(strataWarnings({ closedShare: 0.5, firstReturnsPerSquareMetre: 1.78, leafOffDaysFromLaser: 1, laserLeafState: 'leaf-off' }).some(w => /closed/.test(w)));
  assert.deepEqual(strataWarnings({ closedShare: 0.2, firstReturnsPerSquareMetre: 1.78, leafOffDaysFromLaser: 1, laserLeafState: 'leaf-off' }), []);
});

test('a terrain disagreement stops the canopy stage', () => {
  assert.equal(terrainVerdict({ samples: 3345873, medianMetres: 0, absoluteP95Metres: 0.1 }).stop, false);
  assert.equal(terrainVerdict({ samples: 100, medianMetres: 0.3, absoluteP95Metres: 0.4 }).stop, true);
  assert.equal(terrainVerdict({ samples: 100, medianMetres: 0.02, absoluteP95Metres: 0.6 }).stop, true);
  assert.equal(terrainVerdict({ samples: 0, medianMetres: null, absoluteP95Metres: null }).stop, true);
});

test('the checklist keeps person and owner marks, and publication needs them all closed', () => {
  const auto = { 'reference-frozen': { status: 'done' }, 'held-out-gate': { status: 'excepted', by: 'owner', on: '2026-11-08' }, 'felling-screen-reviewed': { status: 'done' }, 'pole-like-reviewed': { status: 'not-applicable' }, 'holds-reviewed': { status: 'done' }, 'species-mix-flags': { status: 'done' } };
  const first = { items: mergeChecklist(null, auto) };
  assert.deepEqual(openItems(first).map(i => i.id), ['felled-list-confirmed', 'species-spot-check-photos', 'species-mix-screenshots', 'runtime-cost-measured']);
  const marked = { items: first.items.map(i => (i.who === 'auto' ? i : { ...i, status: 'done', by: i.who === 'owner' ? 'owner' : 'agent', on: '2026-11-09' })) };
  const merged = { items: mergeChecklist(marked, { ...auto, 'felling-screen-reviewed': { status: 'open' } }) };
  assert.deepEqual(openItems(merged).map(i => i.id), ['felling-screen-reviewed']);
  const unsigned = { items: marked.items.map(i => (i.id === 'species-mix-screenshots' ? { ...i, by: null } : i)) };
  assert.deepEqual(openItems(unsigned).map(i => i.id), ['species-mix-screenshots']);
});

test('publication is blocked by a failed gate, an open checklist or a hand-edited output', () => {
  const ctx = loadGroundConfig(ROOT, 'johannesberg');
  const gate = { gate: { status: 'FAIL' }, verdict: { allowed: false, note: 'held-out gate FAILED' } };
  const blockers = publicationBlockers(ctx, { gate, checklist: null, candidatesReceipt: null, changed: [{ path: 'candidates.csv', why: 'changed after the stage wrote it' }] });
  assert.ok(blockers.some(b => /FAILED/.test(b)));
  assert.ok(blockers.some(b => /no review checklist/.test(b)));
  assert.ok(blockers.some(b => /no candidates receipt/.test(b)));
  assert.ok(blockers.some(b => /changed after the stage wrote it/.test(b)));
  const clean = publicationBlockers(ctx, { gate: { gate: { status: 'PASS' }, verdict: { allowed: true } }, checklist: { items: [] }, candidatesReceipt: { result: { round: ctx.round.id } }, changed: [] });
  assert.deepEqual(clean, []);
});

test('every module the receipts hash exists', async () => {
  const { PIPELINE_CODE } = await import('./receipts.mjs');
  for (const file of PIPELINE_CODE) assert.ok(fs.existsSync(path.join(ROOT, file)), file);
  assert.deepEqual(without([], /x/), []);
});

/* ---------------- round 3: relief displacement, recovery, pending owner, pine/spruce ---------------- */

test('relief displacement: a synthetic photo drawn k x h away is found again', async () => {
  const { estimateDisplacement, fieldAt, photoValley } = await import('./relief.mjs');
  const s = 0.5, width = 80, height = 80;
  const grid = { minEasting: 1000, maxNorthing: 2040, width, height, sampleSpacingMetres: s };
  const chm = new Float32Array(width * height);
  const cones = [];
  /* an irregular stand (a lattice would alias the shift by one spacing) */
  let seed = 7; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 22; i++) cones.push([1003 + 34 * rand(), 2003 + 34 * rand(), 9 + 8 * rand()]);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const e = grid.minEasting + (c + 0.5) * s, n = grid.maxNorthing - (r + 0.5) * s;
    let h = 0; for (const [ce, cn, ch] of cones) h = Math.max(h, ch - 1.5 * Math.hypot(e - ce, n - cn));
    chm[r * width + c] = h;
  }
  /* the photo: brightness of the sunlit flank of each cone, drawn at (E + k h, N + k h) */
  const k = { kx: -0.4, ky: 0.1 };
  const p = 0.16, pw = 400, ph = 400;
  const photo = { minEasting: 990, maxNorthing: 2050, pixelMetres: p, width: pw, height: ph, data: new Uint8Array(pw * ph * 4) };
  const sun = { azimuthDegrees: 135, elevationDegrees: 35 };
  for (let r = 0; r < ph; r++) for (let c = 0; c < pw; c++) {
    const e = photo.minEasting + (c + 0.5) * p, n = photo.maxNorthing - (r + 0.5) * p;
    let best = 0, light = 0;
    for (const [ce, cn, ch] of cones) {
      /* the surface point (x, y) of height z is drawn at (x + kx z, y + ky z): solve z = cone(e - kx z, n - ky z) */
      let z = ch;
      for (let it = 0; it < 30; it++) z = Math.max(0, ch - 1.5 * Math.hypot(e - k.kx * z - ce, n - k.ky * z - cn));
      if (z > best) { best = z; light = ((e - k.kx * z - ce) * Math.sin(Math.PI * 0.75) + (n - k.ky * z - cn) * Math.cos(Math.PI * 0.75)) > 0 ? 200 : 60; }
    }
    const o = (r * pw + c) * 4;
    const v = best > 3 ? light : 100;
    photo.data[o] = v / 2; photo.data[o + 1] = v / 2; photo.data[o + 2] = v / 2; photo.data[o + 3] = v;
  }
  const found = estimateDisplacement(grid, chm, photo, sun, { minimumCells: 100 });
  assert.ok(Math.abs(found.kx - k.kx) <= 0.06 && Math.abs(found.ky - k.ky) <= 0.06, JSON.stringify(found));
  assert.ok(found.correlation > found.zeroCorrelation + 0.1);
  const field = { bbox: [990, 1990, 1050, 2050], blockMetres: 60, columns: 1, rows: 1, blocks: [{ kx: found.kx, ky: found.ky }] };
  assert.deepEqual(fieldAt(field, 1000, 2000), { kx: found.kx, ky: found.ky });
  assert.equal(fieldAt(field, 900, 2000), null);
  assert.equal(photoValley({ ...field, blocks: [{ kx: null, ky: null }] }, () => 1, { easting: 1000, northing: 2000, height: 10 }, { easting: 1003, northing: 2000, height: 12 }, 0.75), null);
});

test('recovery: with no extra seeds the refined detector is the typed detector, and the referee needs cone, apex and photo', async () => {
  const { detectTreesTyped, TYPED_DEFAULTS, TYPE_CONIFER } = await import('../../packages/course-v2/vegetation/tree-detect-v2.mjs');
  const { detectTreesTypedWithSeeds, recoverTops, REFINE_DEFAULTS } = await import('./tree-refine.mjs');
  const s = 0.5, width = 60, height = 60;
  const grid = { minEasting: 0, maxNorthing: 30, width, height, sampleSpacingMetres: s };
  const chm = new Float32Array(width * height), type = new Uint8Array(width * height).fill(TYPE_CONIFER);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    const e = (c + 0.5) * s, n = 30 - (r + 0.5) * s;
    chm[r * width + c] = Math.max(0, 18 - 2.5 * Math.hypot(e - 12, n - 15), 15 - 2.5 * Math.hypot(e - 15, n - 15));
  }
  const plain = detectTreesTyped(grid, chm, type, TYPED_DEFAULTS);
  const same = detectTreesTypedWithSeeds(grid, chm, type, TYPED_DEFAULTS);
  assert.deepEqual(same.crowns.map(c => [c.id, c.heightMetres, c.areaSquareMetres]), plain.crowns.map(c => [c.id, c.heightMetres, c.areaSquareMetres]));
  const index = Math.floor((30 - 15) / s) * width + Math.floor(15 / s);
  const seeded = detectTreesTypedWithSeeds(grid, chm, type, TYPED_DEFAULTS, { extraMaxima: [{ index, row: Math.floor(index / width), column: index % width }] });
  assert.equal(seeded.crowns.length, plain.crowns.length + 1);
  assert.ok(seeded.crowns.some(c => c.recovered));
  const taller = { easting: 12, northing: 15, height: 18 };
  const top = (over = {}) => ({ easting: 15, northing: 15, height: 15, type: 'conifer', minimumDipMetres: 2, nearestTallerMetres: 3, nearestTaller: taller, ...over });
  const referee = (apex, valley) => ({ apexReturns: () => apex, photoValley: () => valley });
  const verdicts = list => { const trace = []; recoverTops(list, referee(5, 0.2), REFINE_DEFAULTS, trace); return trace.map(t => t.verdict); };
  assert.deepEqual(verdicts([top()]), ['recovered']);
  assert.deepEqual(verdicts([top({ minimumDipMetres: 0.2 })]), ['kept-out:dip']);
  assert.deepEqual(verdicts([top({ nearestTallerMetres: 1 })]), ['kept-out:separation']);
  assert.deepEqual(verdicts([top({ nearestTaller: null, nearestTallerMetres: Infinity })]), ['kept-out:alone']);
  assert.equal(recoverTops([top()], referee(0, 0.2)).length, 0, 'no laser apex, no tree');
  assert.equal(recoverTops([top()], referee(5, 0.01)).length, 0, 'no gap in the photo, no tree');
  assert.equal(recoverTops([top()], referee(5, null)).length, 0, 'a photo that cannot judge never recovers');
});

test('a pending owner approval stages a failed round only on request, labelled, and is never an exception', async () => {
  const { pendingApprovalFor } = await import('./gate.mjs');
  const decided = johannesberg();
  const exception = decided.ownerExceptions.find(x => x.round === 'r3');
  assert.equal(exception.decidedBy, 'owner', 'round 3 was accepted by the owner on 2026-11-08');
  assert.deepEqual(decided.pendingOwnerApprovals, []);
  /* the record as it stood before his decision */
  const pending = { gate: exception.gate, round: 'r3', status: 'pending-owner-approval', recordedOn: '2026-11-08', recordedBy: 'agent (test)', benchmark: exception.benchmark, measured: exception.measured, statement: 'pending owner approval of round 3 (a test of the record before the decision)', record: exception.record };
  const config = { ...decided, ownerExceptions: decided.ownerExceptions.filter(x => x.round !== 'r3'), pendingOwnerApprovals: [pending] };
  const gate = { gate: 'held-out-precision-recall', status: 'FAIL', round: 'r3', reasons: ['recall 0.685 is below 0.9'], measured: { precision: 0.984, recall: 0.685 } };
  assert.equal(ownerExceptionFor(config, gate, pending.benchmark.sha256), null, 'a pending record is not an exception');
  assert.equal(publicationVerdict(gate, null).allowed, false);
  assert.equal(pendingApprovalFor(config, gate, pending.benchmark.sha256), pending);
  assert.ok(ownerExceptionFor(decided, gate, exception.benchmark.sha256), 'after the decision the same benchmark is covered by his exception');
  assert.equal(pendingApprovalFor(config, gate, '0'.repeat(64)), null, 'it pins the benchmark it describes');
  assert.ok(validateGroundConfig({ ...config, pendingOwnerApprovals: [{ ...pending, recordedBy: 'owner' }] }).some(p => /not the owner/.test(p)));
  assert.ok(validateGroundConfig({ ...config, pendingOwnerApprovals: [{ ...pending, status: 'approved' }] }).some(p => /pending-owner-approval/.test(p)));
  const ctx = createContext(ROOT, config, { round: 'r3' });
  const report = { gate: { status: 'FAIL' }, verdict: { allowed: false, note: 'held-out gate FAILED' }, pending };
  const checklist = { items: [{ id: 'held-out-gate', who: 'auto', status: 'open' }, { id: 'species-mix-screenshots', who: 'owner', status: 'open' }, { id: 'species-spot-check-photos', who: 'person', status: 'open' }] };
  const strict = publicationBlockers(ctx, { gate: report, checklist, candidatesReceipt: { result: {} }, changed: [] });
  assert.ok(strict.some(b => /FAILED/.test(b)), 'without --pending-owner it still refuses');
  const staged = publicationBlockers(ctx, { gate: report, checklist, candidatesReceipt: { result: {} }, changed: [] }, { pendingOwner: true });
  assert.deepEqual(staged.blockers, ['checklist species-spot-check-photos [person] is open'], 'a person item still blocks');
  assert.equal(staged.pending.length, 3);
  assert.ok(staged.pending[0].includes('PENDING OWNER APPROVAL'));
});

test('pine/spruce: a rule is published only when held-out conifers agree, and calls nothing otherwise', async () => {
  const { searchSubtypeRule, confidentSubtypeModel, subtypeCall, fitLogistic, logisticProbability } = await import('./subtype.mjs');
  const example = (role, subtype, a, b) => ({ role, subtype, features: { a, b } });
  const examples = [];
  for (let i = 0; i < 40; i++) {
    const role = i < 20 ? 'calibration' : 'evaluation';
    examples.push(example(role, 'pine', 1 + (i % 5) * 0.1, i % 3), example(role, 'spruce', -1 - (i % 5) * 0.1, i % 3));
  }
  const good = searchSubtypeRule(examples, { heldOutRoles: ['evaluation'] });
  assert.equal(good.publish, true);
  assert.equal(subtypeCall({ ...good, publish: true, publishedBy: 'threshold rule' }, { a: 2, b: 0 }), 'pine');
  assert.equal(subtypeCall({ ...good, publish: true, publishedBy: 'threshold rule' }, { a: -2, b: 0 }), 'spruce');
  assert.equal(subtypeCall({ ...good, publish: false }, { a: 2, b: 0 }), null, 'an unpublished rule calls nothing');
  /* a held-out sample that disagrees keeps the rule unpublished */
  const flipped = examples.map(e => (e.role === 'evaluation' ? { ...e, subtype: e.subtype === 'pine' ? 'spruce' : 'pine' } : e));
  assert.equal(searchSubtypeRule(flipped, { heldOutRoles: ['evaluation'] }).publish, false);
  assert.equal(confidentSubtypeModel(flipped, { heldOutRoles: ['evaluation'] }).publish, false);
  const model = fitLogistic(examples.filter(e => e.role === 'calibration').map(e => ({ x: e.features, y: e.subtype === 'pine' ? 1 : 0 })), ['a']);
  assert.ok(logisticProbability(model, { a: 1.2 }) > 0.9 && logisticProbability(model, { a: -1.2 }) < 0.1);
  assert.equal(logisticProbability(model, { a: null }), null);
});

/* ---------------- round 4: the photo crown detector and the confirm fusion ---------------- */

test('photo-detect: optional per ground, required by a fused round, its settings checked', async () => {
  const { photoDetectProblems } = await import('./photo-detect.mjs');
  const config = johannesberg();
  assert.deepEqual(photoDetectProblems(config), []);
  const ctx = loadGroundConfig(ROOT, 'johannesberg', { round: 'r4' });
  assert.equal(ctx.round.detector, 'fused');
  const stage = STAGES.find(s => s.name === 'photo-detect');
  assert.equal(stage.produces(ctx).length, 1);
  assert.ok(STAGES.find(s => s.name === 'benchmark').needs(ctx).some(f => /photo-detect-r4\.json$/.test(f)));
  /* an earlier round and a ground without the detector skip it */
  assert.deepEqual(stage.produces(loadGroundConfig(ROOT, 'johannesberg', { round: 'r3' })), []);
  const without = johannesberg();
  delete without.photoDetect;
  assert.ok(validateGroundConfig(without).some(p => /round r4 is fused: photoDetect.rounds must name it/.test(p)));
  without.rounds = without.rounds.filter(r => r.detector !== 'fused');
  without.activeRound = 'r3';
  without.ownerExceptions = without.ownerExceptions.filter(x => without.rounds.some(r => r.id === x.round));
  assert.deepEqual(validateGroundConfig(without, { groundId: 'johannesberg' }), []);
  const bad = johannesberg();
  bad.photoDetect.python = 'C:/Python/python.exe';
  bad.photoDetect.sources[0].weights = 'magic';
  bad.photoDetect.extra = 1;
  const problems = photoDetectProblems(bad);
  assert.ok(problems.some(p => /python/.test(p)));
  assert.ok(problems.some(p => /weights must be pretrained or finetuned/.test(p)));
  assert.ok(problems.some(p => /photoDetect.extra/.test(p)));
});

test('confirm fusion: a photo crown takes back only a suppressed laser top with its own crown, never a seed of its own', async () => {
  const { confirmTops } = await import('./photo-fusion.mjs');
  /* a flat 20 m canopy with two tops 3 m apart and a 1.5 m saddle between them */
  const grid = { minEasting: 0, maxNorthing: 20, width: 40, height: 40, sampleSpacingMetres: 0.5 };
  const smooth = new Float32Array(grid.width * grid.height).fill(18);
  const at = (e, n) => Math.floor((grid.maxNorthing - n) / 0.5) * grid.width + Math.floor(e / 0.5);
  for (let i = 0; i < smooth.length; i++) {
    const e = (i % grid.width) * 0.5 + 0.25, n = grid.maxNorthing - Math.floor(i / grid.width) * 0.5 - 0.25;
    smooth[i] = Math.max(18, 20 - 1.3 * Math.hypot(e - 8, n - 10), 19.5 - 1.3 * Math.hypot(e - 11, n - 10));
  }
  const kept = [{ easting: 8, northing: 10, height: 20 }];
  const suppressed = [{ index: at(11, 10), easting: 11, northing: 10, height: 19.5, type: 'conifer' }];
  /* the photo draws a top of height h at k x h: k = (0.5, 0) everywhere */
  const field = { bbox: [-100, -100, 100, 100], blockMetres: 200, columns: 1, rows: 1, blocks: [{ kx: 0.5, ky: 0 }] };
  const f = 0.8;
  const drawn = t => ({ easting: t.easting + f * 0.5 * t.height, northing: t.northing, score: 0.6 });
  const fuse = { projectionFraction: f, matchRadiusMetres: 1.5, minimumScore: 0.3, minimumSeparationMetres: 2, minimumDipMetres: 0.5, types: ['conifer', 'broadleaf'] };
  /* a box where the photo draws each top: the suppressed one is confirmed */
  let got = confirmTops(kept, suppressed, [drawn(kept[0]), drawn(suppressed[0])], field, smooth, grid, fuse);
  assert.equal(got.length, 1);
  assert.equal(got[0].easting, 11);
  /* only the kept top's box: it claims it, nothing new */
  got = confirmTops(kept, suppressed, [drawn(kept[0])], field, smooth, grid, fuse);
  assert.equal(got.length, 0);
  /* a box over no laser top places nothing */
  got = confirmTops(kept, suppressed, [drawn(kept[0]), { easting: 40, northing: 3, score: 0.9 }], field, smooth, grid, fuse);
  assert.equal(got.length, 0);
  /* a weak box, a too-close top, or no dip refuse it */
  assert.equal(confirmTops(kept, suppressed, [drawn(kept[0]), { ...drawn(suppressed[0]), score: 0.2 }], field, smooth, grid, fuse).length, 0);
  assert.equal(confirmTops(kept, suppressed, [drawn(kept[0]), drawn(suppressed[0])], field, smooth, grid, { ...fuse, minimumSeparationMetres: 3.5 }).length, 0);
  assert.equal(confirmTops(kept, suppressed, [drawn(kept[0]), drawn(suppressed[0])], field, smooth, grid, { ...fuse, minimumDipMetres: 3 }).length, 0);
  /* round 4b: its own apex in the points */
  assert.equal(confirmTops(kept, [{ ...suppressed[0], apexCount: 2 }], [drawn(kept[0]), drawn(suppressed[0])], field, smooth, grid, { ...fuse, minimumApexReturns: 3 }).length, 0);
  assert.equal(confirmTops(kept, [{ ...suppressed[0], apexCount: 3 }], [drawn(kept[0]), drawn(suppressed[0])], field, smooth, grid, { ...fuse, minimumApexReturns: 3 }).length, 1);
  /* the type gate */
  assert.equal(confirmTops(kept, suppressed, [drawn(kept[0]), drawn(suppressed[0])], field, smooth, grid, { ...fuse, types: ['broadleaf'] }).length, 0);
});

test('Johannesberg: round 4b publishes the round-4 lock, gated on X1-X5 under the owner exception pinned to benchmark-r4b', async () => {
  const { gateReport } = await import('./benchmark.mjs');
  const ctx = loadGroundConfig(ROOT, 'johannesberg', { round: 'r4b' });
  const report = gateReport(ctx);
  assert.equal(report.gate.status, 'FAIL');
  assert.equal(report.gate.method, 'round4-detector', 'the published detector is the round-4 lock');
  assert.equal(report.gate.measured.scored, 126);
  assert.equal(report.verdict.allowed, true);
  assert.equal(report.verdict.gate, 'FAIL', 'a FAIL is never relabelled');
  assert.match(report.verdict.ownerException.record, /README\.md$/);
  const exception = ctx.config.ownerExceptions.find(x => x.round === 'r4b');
  assert.match(exception.decision, /The best round go!/);
  assert.equal(exception.benchmark.sha256, report.benchmark.sha256);
  /* round 4 on its own sample missed the owner's precision floor and is not covered there */
  const r4 = loadGroundConfig(ROOT, 'johannesberg', { round: 'r4' });
  assert.equal(gateReport(r4).verdict.allowed, false);
});

test('width split: only a crown too wide for one tree of its height gives back its own suppressed laser top', async () => {
  const { splitWideCrowns, typicalCrownRadius, SPLIT_DEFAULTS } = await import('./photo-fusion.mjs');
  /* typical(h) is a least-squares line through the reference crowns */
  const typical = typicalCrownRadius([{ heightMetres: 10, segment: { equivalentRadiusMetres: 2 } }, { heightMetres: 20, segment: { equivalentRadiusMetres: 3 } }, { heightMetres: 2, segment: { equivalentRadiusMetres: 9 } }]);
  assert.deepEqual(typical, { a: 1, b: 0.1, crowns: 2 }, 'crowns under 3 m are left out');
  /* one 10 m crown (label 0) holding a second top 4 m away with a 2 m saddle */
  const grid = { minEasting: 0, maxNorthing: 20, width: 40, height: 40, sampleSpacingMetres: 0.5 };
  const smooth = new Float32Array(grid.width * grid.height);
  const labels = new Int32Array(grid.width * grid.height).fill(0);
  const at = (e, n) => Math.floor((grid.maxNorthing - n) / 0.5) * grid.width + Math.floor(e / 0.5);
  for (let i = 0; i < smooth.length; i++) {
    const e = (i % grid.width) * 0.5 + 0.25, n = grid.maxNorthing - Math.floor(i / grid.width) * 0.5 - 0.25;
    smooth[i] = Math.max(0, 10 - 1.2 * Math.hypot(e - 8, n - 10), 9.5 - 1.2 * Math.hypot(e - 12, n - 10));
  }
  const top = { index: at(12, 10), easting: 12, northing: 10, height: 9.5, type: 'broadleaf' };
  const seeds = [{ easting: 8, northing: 10, height: 10 }];
  const crown = r => ({ detection: { labels, crowns: [{ id: 0, heightMetres: 10, equivalentRadiusMetres: r, areaSquareMetres: Math.PI * r * r }] } });
  const split = { ...SPLIT_DEFAULTS, widthFactor: 1.4, minimumSeparationMetres: 3, minimumDipMetres: 1, heightShare: 0.4 };
  /* typical(10) = 2 m: a 4 m crown is too wide, a 2.5 m crown is not */
  assert.equal(splitWideCrowns(grid, crown(4).detection, [top], seeds, smooth, new Map(), typical, split).length, 1);
  assert.equal(splitWideCrowns(grid, crown(2.5).detection, [top], seeds, smooth, new Map(), typical, split).length, 0);
  /* its own cone, its separation, its type and (when asked) a paired photo box decide */
  assert.equal(splitWideCrowns(grid, crown(4).detection, [top], seeds, smooth, new Map(), typical, { ...split, minimumDipMetres: 6 }).length, 0);
  assert.equal(splitWideCrowns(grid, crown(4).detection, [top], seeds, smooth, new Map(), typical, { ...split, minimumSeparationMetres: 4.5 }).length, 0);
  assert.equal(splitWideCrowns(grid, crown(4).detection, [top], seeds, smooth, new Map(), typical, { ...split, types: ['conifer'] }).length, 0);
  assert.equal(splitWideCrowns(grid, crown(4).detection, [top], seeds, smooth, new Map(), typical, { ...split, photoScore: 0.2 }).length, 0);
  assert.equal(splitWideCrowns(grid, crown(4).detection, [top], seeds, smooth, new Map([[top.index, 0.3]]), typical, { ...split, photoScore: 0.2 }).length, 1);
  /* every accepted seed is the laser top itself, protected from the shallow-crown merge */
  const [seed] = splitWideCrowns(grid, crown(4).detection, [top], seeds, smooth, new Map(), typical, split);
  assert.equal(seed.index, top.index);
  assert.equal(seed.protect, true);
});

test('Johannesberg: round 5 is scored once on Y1-Y8 and did not replace round 4 (precision under the declared 0.95)', () => {
  const dir = 'geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/';
  const benchmark = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'benchmark-r5.json'), 'utf8'));
  const windows = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'reference-windows-r5.json'), 'utf8'));
  assert.match(windows.declaredBeforeScoring.rule, /precision at least 0\.95/);
  const r5 = benchmark.results['round5-detector'].evaluation, r4 = benchmark.results['round4-detector'].evaluation;
  assert.equal(r5.tp + r5.missed, 120);
  assert.ok(r5.f1 > r4.f1 && r5.recall > r4.recall, 'round 5 beats round 4 on F1 and recall');
  assert.ok(r5.precision < 0.95, 'but misses the precision floor');
  /* round 5 was never published: round 6 replaced round 4 under the owner's exception */
  assert.equal(loadGroundConfig(ROOT, 'johannesberg').config.ownerExceptions.some(x => x.round === 'r5'), false);
});

test('the bank rule: valid settings only, never buildings; the hold review matches within 0.5 m', async () => {
  const { heldVerdict } = await import('./candidates.mjs');
  const config = johannesberg();
  assert.deepEqual(validateGroundConfig(config, { groundId: 'johannesberg' }), []);
  assert.ok(config.holds.bank.surfaces.includes('water'));
  const bad = johannesberg();
  bad.holds.bank.surfaces = ['water', 'building'];
  assert.ok(validateGroundConfig(bad).some(p => /never building/.test(p)));
  bad.holds.bank = { ...johannesberg().holds.bank, reachMetres: 5 };
  assert.ok(validateGroundConfig(bad).some(p => /reachMetres/.test(p)));
  bad.holds.bank = { ...johannesberg().holds.bank, groundReturnsForLand: 1.5 };
  assert.ok(validateGroundConfig(bad).some(p => /groundReturnsForLand/.test(p)));
  const review = { decisions: { '100.0_200.0': { verdict: 'bank', easting: 100.04, northing: 200.01 } } };
  assert.equal(heldVerdict(review, { easting: 100.04, northing: 200.01 })?.verdict, 'bank');
  assert.equal(heldVerdict(review, { easting: 100.4, northing: 200.2 })?.verdict, 'bank');
  assert.equal(heldVerdict(review, { easting: 101, northing: 200 }), null, 'a neighbour 1 m away is another crown');
});

test('round 6: the width split never takes a top on a mapped building, and is published under the owner exception pinned to benchmark-r6', async () => {
  const { buildingMask } = await import('./geometry.mjs');
  const { splitWideCrowns, SPLIT_DEFAULTS } = await import('./photo-fusion.mjs');
  const { gateReport } = await import('./benchmark.mjs');
  /* the mask: a 4 m square footprint with a 0.5 m buffer, on 0.5 m cells */
  const grid = { minEasting: 0, maxNorthing: 20, width: 40, height: 40, sampleSpacingMetres: 0.5 };
  const mask = buildingMask(grid, [[[10, 8], [14, 8], [14, 12], [10, 12]]], 0.5);
  const at = (e, n) => Math.floor((grid.maxNorthing - n) / 0.5) * grid.width + Math.floor(e / 0.5);
  assert.equal(mask[at(12, 10)], 1, 'inside');
  assert.equal(mask[at(14.3, 10)], 1, 'in the buffer');
  assert.equal(mask[at(16, 10)], 0, 'outside');
  /* a wide crown on a roof: round 5 split it; with excludeBuildings the split needs the mask and refuses the top */
  const smooth = new Float32Array(grid.width * grid.height).fill(6);
  const labels = new Int32Array(grid.width * grid.height).fill(0);
  const detection = { labels, crowns: [{ id: 0, heightMetres: 6, equivalentRadiusMetres: 6, areaSquareMetres: Math.PI * 36 }] };
  const top = { index: at(12, 10), easting: 12.25, northing: 9.75, height: 6, type: 'broadleaf' };
  const split = { ...SPLIT_DEFAULTS, minimumDipMetres: 0, minimumSeparationMetres: 2 };
  const typical = { a: 1, b: 0.1 };
  const seeds = [{ easting: 4, northing: 4, height: 7 }];
  assert.equal(splitWideCrowns(grid, detection, [top], seeds, smooth, new Map(), typical, split).length, 1);
  assert.throws(() => splitWideCrowns(grid, detection, [top], seeds, smooth, new Map(), typical, { ...split, excludeBuildings: true }), /mask/);
  assert.equal(splitWideCrowns(grid, detection, [top], seeds, smooth, new Map(), typical, { ...split, excludeBuildings: true }, { buildings: mask }).length, 0);
  /* Johannesberg: round 6 is active, its lock keeps buildings out, the gate fails and the owner's exception covers it */
  const ctx = loadGroundConfig(ROOT, 'johannesberg');
  assert.equal(ctx.round.id, 'r6');
  const lock = JSON.parse(fs.readFileSync(ctx.reviewFile('detector-lock-r6.json'), 'utf8'));
  assert.equal(lock.selected.split.excludeBuildings, true);
  assert.equal(lock.extendsLock.round, 'r4');
  const report = gateReport(ctx);
  assert.equal(report.gate.status, 'FAIL');
  assert.equal(report.gate.method, 'round6-detector');
  assert.equal(report.gate.measured.scored, 105);
  assert.equal(report.verdict.allowed, true);
  const exception = ctx.config.ownerExceptions.find(x => x.round === 'r6');
  assert.match(exception.decision, /Yes, publish round 6 \(Recommended\)/);
  assert.equal(exception.benchmark.sha256, report.benchmark.sha256);
});

test('registration: a direct laser pair below 30 patches counts only where the owner accepted that pair at that count', async () => {
  const { decideShifts } = await import('./verify.mjs');
  const pair = (campaign, patches, dE, dN, reference = { source: 'laser' }) => ({ moving: { campaign, band: 'nir' }, reference, patchesAccepted: patches, medianShift: { dE, dN }, residualAboutMedian: { median: 0.2, p90: 0.9 } });
  const result = { pairs: { '2024:nir@laser': pair('2024', 19, 0.139, -0.274), '2020:nir@laser': pair('2020', 11, -0.219, -0.444) } };
  assert.deepEqual(decideShifts(result).decisions, {}, 'below 30 patches and no owner decision: unregistered');
  const owner = { 2024: { pair: '2024:nir@laser', patches: 19, decidedOn: '2026-11-09', ownerWords: 'Apply measured shifts (Recommended)' } };
  const decided = decideShifts(result, owner);
  assert.deepEqual(Object.keys(decided.decisions), ['2024']);
  assert.match(decided.decisions['2024'].via, /accepted by the owner on 2026-11-09/);
  assert.deepEqual(decided.applied['2024'], { dE: 0.139, dN: -0.274 });
  /* a re-measurement with another count is not what the owner saw */
  assert.deepEqual(decideShifts({ pairs: { '2024:nir@laser': pair('2024', 18, 0.1, -0.3) } }, owner).decisions, {});
  /* Johannesberg's recorded decisions are unchanged */
  const jb = JSON.parse(fs.readFileSync(path.join(ROOT, 'geo_data/course-v2/johannesberg/vegetation/review-2026-11-08/registration.json'), 'utf8'));
  const again = decideShifts(JSON.parse(JSON.stringify(jb)));
  assert.deepEqual({ decisions: again.decisions, applied: again.applied, rule: again.rule }, { decisions: jb.decisions, applied: jb.applied, rule: jb.rule });
  /* the config pins the pair and quotes the owner */
  const config = johannesberg();
  config.registration.ownerAccepted = { 2021: { pair: '2021:nir@laser', patches: 12, decidedOn: '2026-11-09', ownerWords: 'yes' } };
  assert.deepEqual(validateGroundConfig(config), []);
  config.registration.ownerAccepted = { 2021: { pair: '2025:nir@laser', patches: 12, decidedOn: '2026-11-09', ownerWords: '' } };
  assert.equal(validateGroundConfig(config).filter(p => /ownerAccepted/.test(p)).length, 2);
  config.registration.ownerAccepted = undefined;
  config.registration.highPassMetres = 0;
  assert.ok(validateGroundConfig(config).some(p => /highPassMetres/.test(p)));
  /* Norrfällsviken: the owner's decision of 2026-11-09 registers both photos */
  const norr = loadGroundConfig(ROOT, 'norrfallsviken');
  assert.equal(norr.config.registration.highPassMetres, 6);
  assert.equal(norr.config.registration.ownerAccepted['2024'].patches, 19);
});

test('type rule: a broadleaf call may also need a crown in leaf in the presence photo; Norrfällsviken passes its gate', async () => {
  const config = johannesberg();
  config.typeRule.broadleafMinimumPresenceShare = 0.15;
  assert.deepEqual(validateGroundConfig(config), []);
  config.typeRule.broadleafMinimumPresenceShare = 1.5;
  assert.ok(validateGroundConfig(config).some(p => /broadleafMinimumPresenceShare/.test(p)));
  /* Norrfällsviken: round r4 scored all four locks once on H1-H6 and publishes the round-1 lock, which passes */
  const { gateReport } = await import('./benchmark.mjs');
  const ctx = loadGroundConfig(ROOT, 'norrfallsviken');
  assert.equal(ctx.round.id, 'r4');
  assert.equal(ctx.round.publishes, 'r1');
  assert.equal(ctx.config.typeRule.broadleafMinimumPresenceShare, 0.15);
  const report = gateReport(ctx);
  assert.equal(report.gate.status, 'PASS');
  assert.equal(report.gate.method, 'r1-typed');
  assert.equal(report.gate.measured.scored, 112);
  assert.ok(report.gate.measured.precision >= 0.9 && report.gate.measured.recall >= 0.9);
});
