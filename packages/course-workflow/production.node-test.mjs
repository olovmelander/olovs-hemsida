import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { compilePack } from '../course-pack/compile-pack.mjs';
import { writePack } from '../course-pack/lib.mjs';
import { loadProduction, pinned, readPinned, stageOutput, writeBytes, validateCanopySidecar } from './production-inputs.mjs';
import { configuredWorkflow, verifyCaptureCandidate } from './production.mjs';
import { mappingReview, writeReview } from './production-mapping.mjs';
import { readRingLevels, executeProductionStage } from './production-stages.mjs';
import { emptyRepository, buildCandidateFixture } from './test-fixture.mjs';
import { digest, readJson, writeJson, fileDigest } from './io.mjs';

const REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'production-unit-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function pinJson(root, name, value) {
  writeJson(root, name, value); return { path: name, sha256: fileDigest(root, name) };
}

test('both real profiles wire six stages and include every sibling and campaign', () => {
  for (const ground of ['puttom', 'johannesberg']) {
    const ctx = loadProduction(REAL, ground), w = configuredWorkflow(ctx);
    assert.deepEqual(w, ctx.workflow);
    assert.equal(Object.keys(w.stages).length, 6);
    assert(Object.values(w.stages).every(s => s.command.includes('packages/course-workflow/production.mjs')));
    for (const c of ctx.config.courses) assert(w.stages.sources.inputs.includes(c.model.path));
    assert.equal(w.stages.sources.inputs.filter(p => /chm-.*\.f32$/.test(p)).length, 2);
    assert(w.stages.vegetation.inputs.includes(`${ctx.stageRoot}/mapping`));
    assert(w.stages.assemble.inputs.includes(`${ctx.stageRoot}/terrain`));
    assert.equal(w.publicRoot.startsWith('output/'), true);
  }
});

test('fresh compilation of all three retained layout inputs matches published pack bytes by hash', () => {
  const published = readJson(REAL, 'apps/golf/public/courses/index.json');
  for (const ground of ['puttom', 'johannesberg']) {
    const ctx = loadProduction(REAL, ground);
    for (const c of ctx.config.courses) {
      const inputs = { model: readPinned(REAL, c.model), heightfields: readPinned(REAL, c.heightfields),
        cover: c.cover ? readPinned(REAL, c.cover) : null, slug: c.slug };
      const bytes = compilePack(inputs);
      assert.equal(digest(bytes), published.courses.find(e => e.slug === c.slug).sha256);
      assert.deepEqual(compilePack(inputs), bytes);
      const changed = structuredClone(inputs); changed.model.holes[0].line[0][0] += 1;
      assert.notEqual(digest(compilePack(changed)), digest(bytes));
    }
  }
});

test('changed pinned source requires an explicit source revision', t => {
  const root = temporary(t), ref = pinJson(root, 'input.json', { source: 'unit fixture' });
  pinned(root, ref);
  fs.appendFileSync(path.join(root, ref.path), '\n');
  assert.throws(() => pinned(root, ref), /pinned input changed/);
});

test('production profile rejects misspelled settings and empty capture coverage', t => {
  const root = temporary(t), real = loadProduction(REAL, 'puttom');
  writeJson(root, 'course-workflows/puttom/workflow.json', real.workflow);
  for (const mutate of [c => c.vegetation.reviewMod = 'machine-v1', c => c.review.captureBackend = [],
    c => c.terrain.maximumBaselineDifferenceMetres = 'Infinity', c => c.courses[0].sidecars.unknown = {}]) {
    const config = structuredClone(real.config); mutate(config);
    writeJson(root, real.configPath, config);
    assert.throws(() => loadProduction(root, 'puttom'));
  }
});

test('staging preserves the last complete generation on failure and removes obsolete files on success', async t => {
  const root = temporary(t), ctx = { root, stageRoot: 'output/stages', workflow: { publicRoot: 'output/public' } };
  writeBytes(root, 'output/stages/mapping/old.json', 'previous');
  await assert.rejects(stageOutput(ctx, 'mapping', async out => {
    writeBytes(root, `${out}/partial.json`, 'incomplete'); throw new Error('missing measured data');
  }), /missing measured data/);
  assert.equal(fs.readFileSync(path.join(root, 'output/stages/mapping/old.json'), 'utf8'), 'previous');
  assert.deepEqual(fs.readdirSync(path.join(root, 'output/stages')), ['mapping']);
  await stageOutput(ctx, 'mapping', async out => writeBytes(root, `${out}/new.json`, 'complete'));
  assert.deepEqual(fs.readdirSync(path.join(root, 'output/stages/mapping')), ['new.json']);
});

test('per-hole review keeps shared context separate, flags absent polygons and never infers approval', async t => {
  const root = temporary(t);
  const config = { groundId: 'unit-fixture', courses: [{ slug: 'unit-nine', model: {}, card: {} }],
    mappingEvidence: [], review: { acquisition: { path: 'source.json', sha256: 'a'.repeat(64) }, sourceDirectory: 'cache/raw' } };
  const model = { holes: [{ n: 1, line: [[0, 0], [10, 20]], green: { ring: [[5, 15], [15, 15], [10, 25]] } }],
    water: [{ id: 'shared-pond', ring: [[20, 0], [25, 0], [25, 5], [20, 5]] }] };
  const report = mappingReview(config, { 'unit-nine': { geometry: model } }, { blockers: [{ id: 'unknown-datum', severity: 'release-blocking', description: 'Unit fixture only' }] });
  assert.equal(report.coverage.length, 1);
  const c = report.coverage[0].categories;
  assert.equal(c.greens.ownedFeatures, 1); assert.equal(c.water.ownedFeatures, 0); assert.equal(c.water.nearbySharedFeatures, 1);
  assert(Object.values(c).every(x => x.status === 'unknown' && !x.evidence.length));
  assert.equal(report.discrepancies.filter(x => x.kind === 'category-gap').length, 3);
  assert.equal(report.geographicApproval, false);
  const ctx = { root, config, groundId: config.groundId, stageRoot: 'output/stages', workflow: { publicRoot: 'output/public' } };
  await stageOutput(ctx, 'mapping', async out => writeReview(ctx, `${out}/review`, report));
  const plan = readJson(root, 'output/stages/mapping/review/source-overlay-plan.json');
  const reviewFile = plan.command[plan.command.indexOf('--review') + 1];
  assert.equal(reviewFile, 'output/stages/mapping/review/review.json');
  assert(fs.existsSync(path.join(root, reviewFile)));
  assert.equal(plan.status, 'not-run');
});

test('raw terrain reader verifies dimensions, georeferencing, sample validity and hashes', t => {
  // Tiny synthetic codec fixture, never a course build or geographic evidence.
  const root = temporary(t), data = Buffer.alloc(16);
  [10, 11, 12, 13].forEach((v, i) => data.writeFloatLE(v, 4*i));
  writeBytes(root, 'cache/rings/l0.f32', data);
  const ctx = { root, groundId: 'unit-fixture', spec: { tileSegments: 1,
    levels: [{ lod: 0, tilesPerSide: 1, sampleSpacingMetres: 1, originEasting: 100, originNorthing: 200 }],
    coverageGate: { minimumHeightRH2000: 0, maximumHeightRH2000: 100 } },
    config: { frame: { fingerprint: 'unit-frame' }, terrain: { directory: 'cache/rings' }, vegetation: {} } };
  ctx.config.vegetation.campaigns = pinJson(root, 'campaigns.json', { activeItemIds: [] });
  ctx.config.vegetation.evidence = pinJson(root, 'canopy.json', { groundId: ctx.groundId, frameFingerprint: 'unit-frame',
    campaignsSha256: ctx.config.vegetation.campaigns.sha256, campaigns: [] });
  const evidence = { groundId: ctx.groundId, levels: [{ lod: 0, sampleSpacingMetres: 1, finite: 4,
    rasterSha256: digest(data), extent: { minEasting: 100, maxEasting: 101, minNorthing: 199, maxNorthing: 200, size: 2 } }] };
  ctx.config.terrain.evidence = pinJson(root, 'terrain.json', evidence);
  assert.deepEqual([...readRingLevels(ctx)[0].heights], [10, 11, 12, 13]);
  data.writeFloatLE(NaN, 0); writeBytes(root, 'cache/rings/l0.f32', data);
  assert.throws(() => readRingLevels(ctx), /pinned input changed/);
  evidence.levels[0].rasterSha256 = digest(data);
  ctx.config.terrain.evidence = pinJson(root, 'terrain.json', evidence);
  assert.throws(() => readRingLevels(ctx), /nodata/);
  evidence.levels[0].extent.maxEasting = 102;
  ctx.config.terrain.evidence = pinJson(root, 'terrain.json', evidence);
  assert.throws(() => readRingLevels(ctx));
});

test('canopy sidecars cannot shift the grid while keeping the same sample count', t => {
  const root = temporary(t), ref = { path: 'cache/unit.f32', campaignId: 'fixture',
    evidence: { perTile: [{ interiorBboxEpsg3006: [100, 100, 200, 200] }] } };
  writeBytes(root, ref.path, ''); fs.truncateSync(path.join(root, ref.path), 4096*4096*4);
  const ctx = { root, groundId: 'unit-fixture', spec: { levels: [{ originEasting: 0, originNorthing: 4096 }] },
    config: { frame: { fingerprint: 'unit-frame' }, baselineGround: pinJson(root, 'baseline.json', {
      bounds: { minEasting: -4096, maxEasting: 12288, minNorthing: -4096, maxNorthing: 12288 } }) } };
  const sidecar = { groundId: ctx.groundId, campaignId: 'fixture', frameFingerprint: 'unit-frame', layer: 'chm',
    sampleSpacingMetres: 1, noData: null, width: 4096, height: 4096, originEasting: 0, originNorthing: 4096 };
  validateCanopySidecar(ctx, ref, sidecar);
  assert.throws(() => validateCanopySidecar(ctx, ref, { ...sidecar, originEasting: 1 }), /canopy grid/);
  assert.throws(() => validateCanopySidecar(ctx, ref, { ...sidecar, frameFingerprint: 'different' }));
});

test('real assembly and validation adapters emit one shared ground, verify bytes, and leave geography pending', async t => {
  // All terrain here is explicitly synthetic unit geography. No production receipt is made.
  const root = emptyRepository(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fixture = buildCandidateFixture(root), { w, graph } = fixture;
  const ground = JSON.parse(Buffer.from(graph.resources.get(graph.references.ground.url)).toString('utf8'));
  const slugs = ['fixture-main', 'fixture-nine'];
  w.courses = slugs.map(slug => ({ slug, holes: 2 }));
  const ctx = { root, groundId: ground.groundId, workflow: w, stageRoot: 'output/adapter-stages',
    config: { frame: ground.frame, courses: slugs.map(slug => ({ slug, holes: 2, strokeIndexStatus: 'unverified', accuracyTier: 'D' })),
      review: { captureBackend: ['webgpu', 'webgl2'], captureQuality: ['hi', 'lo'], capturePresets: ['noon'] } } };
  const terrainRefs = [ground.shell, ...ground.tiles.map(t => t.layers.terrain)];
  const compilation = { ...ground, courseSlugs: slugs, resourceUrls: [...new Set(terrainRefs.map(r => r.url))],
    tiles: ground.tiles.map(t => ({ ...t, courses: slugs })) };
  writeJson(root, `${ctx.stageRoot}/terrain/compilation.json`, compilation);
  for (const ref of terrainRefs) writeBytes(root, `${ctx.stageRoot}/terrain/${ref.url}`, graph.resources.get(ref.url));
  writeJson(root, `${ctx.stageRoot}/vegetation/layers.json`, {});
  writeJson(root, `${ctx.stageRoot}/vegetation/stand-layers.json`, {});
  const entries = [];
  for (const slug of slugs) {
    const holes = [1, 2].map(n => ({ n, par: 3, idx: n, line: [[600001+n, 6600001+n], [600051+n, 6600051+n]] }));
    const bytes = writePack({ slug, geo: {}, hf0: { nx: 2, nz: 2 }, hf1: { nx: 2, nz: 2 },
      streams: [deflateRawSync(Buffer.alloc(8)), deflateRawSync(Buffer.alloc(8)), deflateRawSync(Buffer.from(JSON.stringify({ holes })))] });
    const packUrl = `courses/${slug}/pack.bin`;
    writeBytes(root, `${ctx.stageRoot}/mapping/public/${packUrl}`, bytes);
    writeJson(root, `${ctx.stageRoot}/mapping/models/${slug}.epsg3006.json`, { geometry: { holes } });
    entries.push({ slug, name: 'Synthetic test', holes: 2, packUrl, bytes: bytes.length, sha256: digest(bytes) });
  }
  writeJson(root, `${ctx.stageRoot}/mapping/public/courses/index.json`, { fmt: 1, courses: entries });
  writeJson(root, `${ctx.stageRoot}/mapping/review/review.json`, { discrepancies: [] });
  const assembled = await executeProductionStage(ctx, 'assemble');
  assert.equal(assembled.courses, 2); assert.equal(assembled.startup.length, 1);
  const index = readJson(root, `${w.publicRoot}/courses/v2-index.json`);
  const grounds = index.courses.map(c => readJson(root, `${w.publicRoot}/${c.manifest.url}`).groundManifest.sha256);
  assert.equal(new Set(grounds).size, 1);
  const result = await executeProductionStage(ctx, 'validate');
  assert.equal(result.graphIntegrity, true); assert.equal(result.geographicApproval, false); assert.equal(result.releaseReady, false);
  const built = 'output/course-production/fixture-ground/player';
  fs.cpSync(path.join(root, w.publicRoot), path.join(root, built), { recursive: true });
  writeBytes(root, `${built}/index.html`, 'SYNTHETIC TEST SHELL ONLY');
  assert(Object.keys(verifyCaptureCandidate(ctx, built)).length > 469);
  fs.appendFileSync(path.join(root, built, 'courses/index.json'), ' ');
  assert.throws(() => verifyCaptureCandidate(ctx, built), /served candidate differs/);
  const ref = ground.tiles[0].layers.terrain;
  fs.appendFileSync(path.join(root, w.publicRoot, ref.url), 'corruption');
  assert.throws(() => verifyCaptureCandidate(ctx, built), /candidate changed since validation/);
  await assert.rejects(executeProductionStage(ctx, 'validate'));
});
