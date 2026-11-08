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
  assert.equal(ctx.round.id, 'r2');
  assert.equal(ctx.round.detector, 'typed');
  assert.equal(ctx.leafOff.date, '2021-04-18');
  assert.equal(ctx.presence.date, '2025-06-14');
  assert.deepEqual(haloWindow(config), { minEasting: 678343.5, minNorthing: 6624216.5, maxEasting: 680511.5, maxNorthing: 6626384.5 });
  assert.deepEqual({ ...chmGrid(config) }, { minEasting: 678343.5, maxNorthing: 6626384.5, width: 4336, height: 4336, sampleSpacingMetres: 0.5 });
  assert.equal(ctx.sampleFile('benchmark'), 'benchmark-r2.json');
  assert.equal(ctx.sampleFile('detector-lock', 'json', 'r1'), 'detector-lock.json');
  assert.equal(ctx.sampleFile('reference', 'geojson'), 'reference-r2.geojson');
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
  assert.deepEqual(STAGE_NAMES, ['acquire', 'canopy', 'detect', 'verify', 'reference', 'benchmark', 'candidates', 'review', 'publish']);
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
  const ctx = loadGroundConfig(ROOT, 'johannesberg');
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
  const auto = { 'reference-frozen': { status: 'done' }, 'held-out-gate': { status: 'excepted', by: 'owner', on: '2026-11-08' }, 'felling-screen-reviewed': { status: 'done' }, 'pole-like-reviewed': { status: 'not-applicable' }, 'species-mix-flags': { status: 'done' } };
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
  const clean = publicationBlockers(ctx, { gate: { gate: { status: 'PASS' }, verdict: { allowed: true } }, checklist: { items: [] }, candidatesReceipt: { result: { round: 'r2' } }, changed: [] });
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
  const config = johannesberg();
  const pending = config.pendingOwnerApprovals.find(x => x.round === 'r3');
  assert.equal(pending.status, 'pending-owner-approval');
  const gate = { gate: 'held-out-precision-recall', status: 'FAIL', round: 'r3', reasons: ['recall 0.685 is below 0.9'], measured: { precision: 0.984, recall: 0.685 } };
  assert.equal(ownerExceptionFor(config, gate, pending.benchmark.sha256), null, 'a pending record is not an exception');
  assert.equal(publicationVerdict(gate, null).allowed, false);
  assert.equal(pendingApprovalFor(config, gate, pending.benchmark.sha256), pending);
  assert.equal(pendingApprovalFor(config, gate, '0'.repeat(64)), null, 'it pins the benchmark it describes');
  assert.ok(validateGroundConfig({ ...config, pendingOwnerApprovals: [{ ...pending, recordedBy: 'owner' }] }).some(p => /not the owner/.test(p)));
  assert.ok(validateGroundConfig({ ...config, pendingOwnerApprovals: [{ ...pending, status: 'approved' }] }).some(p => /pending-owner-approval/.test(p)));
  const ctx = loadGroundConfig(ROOT, 'johannesberg', { round: 'r3' });
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
