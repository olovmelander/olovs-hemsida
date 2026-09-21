import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyRepository, buildCandidateFixture } from './test-fixture.mjs';
import { setupWorkflow } from './setup.mjs';
import { STAGES, workflowTemplate, validateWorkflow } from './standard.mjs';
import { safePath, writeJson, readJson, fileDigest } from './io.mjs';
import { plan, runThrough, runStage } from './runner.mjs';
import { candidate, inspectGround, terrainErrors } from './audit.mjs';
import { reviewErrors, releaseCheck } from './release.mjs';
import { checkNewCourses } from './check-new.mjs';
import { main } from './cli.mjs';

function repo(t) { const r = emptyRepository(); t.after(() => fs.rmSync(r, { recursive: true, force: true })); return r; }
const init = { groundId: 'new-ground', name: 'New course', courses: [{ slug: 'new-main', holes: 18 }, { slug: 'new-nine', holes: 9 }], bbox: [16, 59, 16.1, 59.1] };

test('adoption preserves real Ribbingsfors, Lidingö and shared Johannesberg manifests and pending reviews', t => {
  const root = repo(t), real = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const index = readJson(real, 'apps/golf/public/courses/v2-index.json');
  const ids = ['ribbingsfors', 'lidingo', 'johannesberg'];
  index.courses = index.courses.filter(c => ids.includes(c.groundId));
  writeJson(root, 'apps/golf/public/courses/v2-index.json', index);
  const player = readJson(real, 'apps/golf/public/courses/index.json');
  player.courses = player.courses.filter(c => index.courses.some(e => e.slug === c.slug));
  writeJson(root, 'apps/golf/public/courses/index.json', player);
  const copy = p => { const dest = safePath(root, p); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(safePath(real, p), dest); };
  for (const entry of index.courses) {
    copy(`apps/golf/public/${entry.manifest.url}`);
    const c = readJson(real, `apps/golf/public/${entry.manifest.url}`);
    copy(`apps/golf/public/${c.groundManifest.url}`);
    copy(`geo_data/course-v2/${entry.groundId}/source-manifest.json`);
  }
  const before = fileDigest(root, 'apps/golf/public/courses/v2-index.json');
  for (const groundId of ids) {
    const w = setupWorkflow(root, { groundId, adopt: true });
    assert.equal(w.releasePolicy, 'advisory');
    assert.equal(w.courses.length, groundId === 'johannesberg' ? 2 : 1);
    assert.ok(Object.values(readJson(root, w.reviewFile).gates).every(g => g.status === 'pending'));
    assert.deepEqual(inspectGround(root, groundId).errors, []);
  }
  assert.equal(fileDigest(root, 'apps/golf/public/courses/v2-index.json'), before);
});

test('new ground scaffold is non-destructive, pending and complete for every routing', t => {
  const root = repo(t), before = fileDigest(root, 'apps/golf/public/courses/v2-index.json');
  const w = setupWorkflow(root, init);
  assert.equal(w.releasePolicy, 'required');
  assert.equal(readJson(root, w.sourceManifest).legacyFrame, null);
  const review = readJson(root, w.reviewFile);
  assert.equal(review.holes.length, 27);
  assert.ok(review.holes.every(h => Object.keys(h.categories).length === 7));
  assert.equal(review.candidateDigest, null);
  assert.equal(fileDigest(root, 'apps/golf/public/courses/v2-index.json'), before);
  assert.throws(() => setupWorkflow(root, init), /overwrite/);
  assert.throws(() => setupWorkflow(root, { ...init, groundId: 'invalid-ground', bbox: [17, 59, 16, 60] }), /bounds/);
  assert.equal(fs.existsSync(path.join(root, 'course-workflows/invalid-ground')), false);
});
test('configuration rejects misspelled fields, path escapes, duplicate layouts and invalid stage commands', () => {
  const w = workflowTemplate(init);
  for (const mutate of [x => x.standard = 'v0', x => x.courses.push(x.courses[0]),
    x => x.sourceManifest = '../outside.json', x => x.stages.terrain.command = ['bash', '-c', 'echo'],
    x => x.stages.terrain = { command: ['node', 'adapter.mjs'], inputs: ['adapter.mjs'], outputs: ['apps/golf/public/pack.bin'] },
    x => x.performence = {}, x => x.watch = [], x => x.performance.maxFrameP95Ms.mobile = 0]) {
    const broken = structuredClone(w); mutate(broken); assert.ok(validateWorkflow(broken).length);
  }
});
test('filesystem references reject traversal and symlinks', t => {
  const root = repo(t);
  for (const p of ['../escape', '/tmp/escape', 'C:/escape', 'x/../escape', '.git/config', 'x\\y']) assert.throws(() => safePath(root, p));
  fs.symlinkSync(root, path.join(root, 'link'));
  assert.throws(() => safePath(root, 'link/implementation/adapter.mjs'), /symlink/);
});
test('CLI rejects unknown options before mutating a new ground', t => {
  const root = repo(t);
  assert.throws(() => main(['init', '--ground', 'course', '--unsafe', 'yes'], root), /unknown/);
  assert.throws(() => main(['run', '--ground', 'course', '--stage', 'mapping', '--stage', 'terrain'], root), /duplicate/);
  assert.equal(fs.existsSync(path.join(root, 'course-workflows')), false);
});
test('runner executes all six stages, resumes unchanged work and invalidates downstream outputs', t => {
  const root = repo(t), w = setupWorkflow(root, init);
  w.watch = ['implementation'];
  for (const [i, stage] of STAGES.entries()) {
    const output = `output/${stage}.json`;
    const script = `implementation/${stage}.mjs`;
    fs.writeFileSync(safePath(root, script), `import fs from 'node:fs'; fs.mkdirSync('output',{recursive:true}); fs.writeFileSync('${output}', JSON.stringify({stage:'${stage}'}));\n`);
    w.stages[stage] = { command: ['node', script], inputs: [script, ...(i ? [`output/${STAGES[i - 1]}.json`] : [])], outputs: [output] };
  }
  assert.throws(() => runStage(root, w, 'mapping'), /prerequisite/);
  assert.equal(runThrough(root, w, 'validate').length, 6);
  assert.ok(plan(root, w).every(p => p.status === 'current'));
  assert.ok(runThrough(root, w, 'validate').every(p => p.status === 'skipped'));
  fs.writeFileSync(safePath(root, 'output/terrain.json'), 'changed');
  const result = plan(root, w);
  assert.equal(result[0].status, 'current'); assert.equal(result[1].status, 'stale'); assert.equal(result[2].status, 'blocked');
  runThrough(root, w, 'validate'); assert.ok(plan(root, w).every(p => p.status === 'current'));
  fs.appendFileSync(safePath(root, 'implementation/mapping.mjs'), '\n// changed algorithm');
  assert.equal(plan(root, w)[0].status, 'stale');
});
test('failed adapters and absent outputs never receive a successful receipt', t => {
  const root = repo(t), w = setupWorkflow(root, init); w.watch = ['implementation'];
  w.stages.sources = { command: ['node', 'implementation/adapter.mjs'], inputs: ['implementation/adapter.mjs'], outputs: ['output/expected.json'] };
  assert.throws(() => runStage(root, w, 'sources', { execute: () => ({ status: 7 }) }), /exit 7/);
  assert.equal(readJson(root, 'course-workflows/new-ground/build-records/sources.json').status, 'failed');
  assert.throws(() => runStage(root, w, 'sources', { execute: () => ({ status: 0 }) }), /ENOENT/);
  assert.equal(fs.existsSync(path.join(root, 'course-workflows/new-ground/.run-lock')), false);
  assert.throws(() => runStage(root, w, 'sources', { execute: () => {
    fs.appendFileSync(safePath(root, 'implementation/adapter.mjs'), '// changed input');
    writeJson(root, 'output/expected.json', {}); return { status: 0 };
  } }), /modified its own inputs/);
  fs.writeFileSync(safePath(root, 'course-workflows/new-ground/.run-lock'), '');
  assert.throws(() => runStage(root, w, 'sources'), /EEXIST/);
});
test('complete synthetic candidate passes release; stale reviews, corrupt bytes and regressions fail', t => {
  const root = repo(t), fixture = buildCandidateFixture(root), { w, review, candidateDigest } = fixture;
  assert.deepEqual(reviewErrors(root, w, review, candidateDigest), []);
  const passed = releaseCheck(root, w);
  assert.deepEqual(passed.errors, []); assert.equal(passed.ready, true); assert.ok(passed.byteVerification.chunks > 469);
  const metadataOnly = releaseCheck(root, w, { verifyBytes: false });
  assert.equal(metadataOnly.reviewReady, true); assert.equal(metadataOnly.ready, false);
  const unconfigured = structuredClone(w); unconfigured.stages.terrain.command = null;
  assert.ok(releaseCheck(root, unconfigured).errors.some(e => e.includes('build.terrain: unconfigured')));
  const cases = [
    r => r.candidateDigest = '0'.repeat(64),
    r => r.holes.pop(), r => r.holes.push(r.holes[0]),
    r => r.holes[0].categories.bunkers.status = 'unknown',
    r => r.holes[0].categories.tees.status = 'not-applicable',
    r => r.gates.webgpu.status = 'pending',
    r => r.gates.mobile.evidence = [],
    r => r.performance[0].runs.forEach(x => x.candidate.frameP95Ms = 15),
    r => r.performance[1].candidateDigest = '0'.repeat(64),
    r => r.performance[2].runs.pop(),
    r => r.performance[2].runs[0].candidate.frameP95Ms = null,
  ];
  for (const mutate of cases) { const r = structuredClone(review); mutate(r); assert.ok(reviewErrors(root, w, r, candidateDigest).length); }
  fs.appendFileSync(safePath(root, review.gates.sources.evidence[0].path), ' edited');
  assert.ok(reviewErrors(root, w, review, candidateDigest).some(e => e.includes('changed evidence')));
  fs.writeFileSync(safePath(root, review.gates.sources.evidence[0].path), 'SYNTHETIC TEST EVIDENCE ONLY');
  const graph = candidate(root, w);
  const tile = graph.ground.tiles[0].layers.terrain;
  const file = safePath(root, `${w.publicRoot}/${tile.url}`), bytes = fs.readFileSync(file);
  const broken = Buffer.from(bytes); broken[broken.length - 1] ^= 1; fs.writeFileSync(file, broken);
  assert.equal(releaseCheck(root, w).ready, false);
  fs.writeFileSync(file, bytes);
  const playerPath = `${w.publicRoot}/courses/index.json`, player = readJson(root, playerPath);
  player.courses[0].holes = 9; writeJson(root, playerPath, player);
  assert.ok(releaseCheck(root, w).errors.some(e => e.includes('player catalogue')));
  player.courses[0].holes = 2; writeJson(root, playerPath, player);
  const fallbackPath = safePath(root, `${w.publicRoot}/courses/fixture-main/pack.bin`), fallback = fs.readFileSync(fallbackPath);
  fs.writeFileSync(fallbackPath, Buffer.alloc(fallback.length));
  assert.equal(releaseCheck(root, w).ready, false);
  fs.writeFileSync(fallbackPath, fallback);
  const badGround = structuredClone(graph.ground); badGround.tiles[0].parentId = 'l1/7/7';
  assert.ok(terrainErrors(badGround).some(e => e.includes('parent')));
  const priorDigest = candidate(root, w).candidateDigest;
  fs.appendFileSync(safePath(root, 'implementation/adapter.mjs'), '// new renderer');
  assert.notEqual(candidate(root, w).candidateDigest, priorDigest);
  assert.ok(releaseCheck(root, w).errors.some(e => e.includes('stale')));
});
test('candidate identity and build receipts survive promotion without retaining staged assets', t => {
  const root = repo(t), { w } = buildCandidateFixture(root);
  fs.cpSync(safePath(root, w.publicRoot), safePath(root, 'apps/golf/public'), { recursive: true });
  assert.equal(candidate(root, w).candidateDigest, candidate(root, w, { publicRoot: 'apps/golf/public' }).candidateDigest);
  fs.rmSync(safePath(root, w.publicRoot), { recursive: true });
  assert.equal(releaseCheck(root, w, { publicRoot: 'apps/golf/public' }).ready, true);
  const audit = inspectGround(root, w.groundId, { sourceManifest: w.sourceManifest });
  assert.equal(audit.terrain.tiles, 469); assert.equal(audit.perHoleReview, 'unknown');
  const wrong = structuredClone(w); wrong.courses[0].holes = 9;
  assert.throws(() => candidate(root, wrong, { publicRoot: 'apps/golf/public' }), /every shared routing/);
  const source = readJson(root, w.sourceManifest); source.canonicalFrame.originStatus = 'pending-control-approval';
  source.canonicalFrame.origin = { easting: null, northing: null, heightRH2000: null };
  writeJson(root, w.sourceManifest, source);
  assert.ok(releaseCheck(root, w, { publicRoot: 'apps/golf/public' }).errors.some(e => e.includes('independent control')));
});
test('CI requires new-course reviews and preserves mandatory policy from the base commit', t => {
  const root = repo(t);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
  const index = { $schema: 'fixture', schemaVersion: 2, courses: [{ slug: 'old-course', groundId: 'old-ground' }] };
  writeJson(root, 'apps/golf/public/courses/v2-index.json', index);
  git(['add', 'apps/golf/public/courses']); git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture base']);
  const base = git(['rev-parse', 'HEAD']);
  assert.equal(checkNewCourses(root, base).ready, true);
  writeJson(root, 'apps/golf/public/courses/index.json', { fmt: 1, courses: [{ slug: 'legacy-only' }] });
  assert.ok(checkNewCourses(root, base).grounds.some(g => g.slug === 'legacy-only' && !g.ready));
  writeJson(root, 'apps/golf/public/courses/index.json', { fmt: 1, courses: [] });
  index.courses.push({ slug: 'new-main', groundId: 'new-ground' }); writeJson(root, 'apps/golf/public/courses/v2-index.json', index);
  assert.equal(checkNewCourses(root, base).ready, false);
  const w = workflowTemplate(init); writeJson(root, 'course-workflows/new-ground/workflow.json', w);
  const checker = () => ({ groundId: 'new-ground', ready: true, errors: [] });
  assert.equal(checkNewCourses(root, base, { checkRelease: checker }).ready, true);
  w.releasePolicy = 'advisory'; writeJson(root, 'course-workflows/new-ground/workflow.json', w);
  assert.equal(checkNewCourses(root, base, { checkRelease: checker }).ready, false);
  w.releasePolicy = 'required'; writeJson(root, 'course-workflows/new-ground/workflow.json', w);
  git(['add', 'apps/golf/public/courses/v2-index.json', 'course-workflows/new-ground/workflow.json']); git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'qualified fixture']);
  const qualified = git(['rev-parse', 'HEAD']);
  fs.unlinkSync(safePath(root, 'course-workflows/new-ground/workflow.json'));
  assert.equal(checkNewCourses(root, qualified, { checkRelease: checker }).ready, false);
  assert.throws(() => checkNewCourses(root, 'main'), /full commit/);
});
