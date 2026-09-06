import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { test } from 'node:test';
import { prepareRoutingRebind, writeRoutingRebind } from './rebind-v2-routing.mjs';

const REPO = process.env.ROUTING_TEST_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = relative => import(pathToFileURL(path.join(REPO, relative)).href);
const [compiler, emitter, frameModule, sampling, chunks, pack, canonical, projection] = await Promise.all([
  load('packages/course-v2/terrain-compiler-node.mjs'), load('packages/course-v2/emit-ground-graph-node.mjs'),
  load('packages/course-v2/terrain-preview-node.mjs'), load('packages/course-v2/terrain-pyramid.mjs'),
  load('packages/course-v2/chunk-node.mjs'), load('packages/course-pack/lib.mjs'),
  load('packages/course-v2/canonical-json.mjs'), load('packages/course-geo/chmv2/projection.mjs'),
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const round = x => Math.round(x * 1000) / 1000;

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-rebind-'));
  fs.symlinkSync(path.join(REPO, 'packages'), path.join(dir, 'packages'), 'dir');
  const pub = path.join(dir, 'public');
  const write = (relative, bytes) => { const dest = path.join(dir, relative); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes); };
  const model = { origin: { lat: 59.839, lon: 17.4952 }, mPerLat: 111320, mPerLon: 55930.68, frame: 'local metres about ORIGIN; north -z, east +x', holes: [{ n: 1, par: 4, idx: 3, line: [[1, -1], [4, -4]], green: { c: [4, -4] } }] };
  const project = ([x, z]) => projection.latLonToSweref99Tm(model.origin.lat - z / model.mPerLat, model.origin.lon + x / model.mPerLon).map(round);
  const origin = projection.latLonToSweref99Tm(model.origin.lat, model.origin.lon);
  const e0 = Math.floor(origin[0]) - 2, n1 = Math.ceil(origin[1]) + 12;
  const size = 17, heights = Float32Array.from({ length: size * size }, (_, i) => 40 + (i % size) * 0.25 + Math.floor(i / size) * 0.5);
  const compilation = compiler.compileTerrainAssets({ groundId: 'fixture-ground', courseSlugs: ['fixture-course', 'other-course'], heights, width: size, height: size, originEasting: e0, originNorthing: n1, sampleSpacingMetres: 1, tileSegments: 4 });
  const sampler = new sampling.TerrainPyramidSampler(compilation.pyramid);
  const fallback = () => {
    const bytes = pack.writePack({ slug: 'fixture-course', geo: { origin: model.origin, mPerLon: model.mPerLon }, hf0: {}, hf1: {}, streams: [deflateRawSync(Buffer.alloc(0)), deflateRawSync(Buffer.alloc(0)), deflateRawSync(Buffer.from(JSON.stringify(model)))] });
    write('public/courses/fixture-course/pack.bin', bytes);
    const entry = { slug: 'fixture-course', name: 'Fixture', packUrl: 'courses/fixture-course/pack.bin', bytes: bytes.length, sha256: sha(bytes) };
    write('public/courses/index.json', canonical.canonicalJsonBytes({ courses: [entry] }));
    return { format: 1, packUrl: entry.packUrl, bytes: entry.bytes, sha256: entry.sha256 };
  };
  const saveSources = ({ updatePack = true } = {}) => {
    const bytes = Buffer.from(JSON.stringify(model));
    write('fixturebuild/course-model.json', bytes);
    write('migration.json', JSON.stringify({ groundId: 'fixture-ground', source: { path: 'fixturebuild/course-model.json', sha256: sha(bytes), localFrame: { originWgs84: { latitude: model.origin.lat, longitude: model.origin.lon }, metresPerLatitude: model.mPerLat, metresPerLongitude: model.mPerLon } }, target: { horizontalCrs: 'EPSG:3006', coordinateOrder: ['easting', 'northing'] }, geometry: { holes: model.holes.map(hole => ({ ...hole, line: hole.line.map(project) })) } }));
    if (updatePack) fallback();
  };
  const input = { compilation, frame: frameModule.createProvisionalFrame(compilation.bounds), sourceManifestSha256: 'a'.repeat(64), fallbackV1: fallback(), heightAt: (e, n) => sampler.sample(e, n)?.heightRH2000 ?? NaN, holeTileBufferMetres: 1 };
  const makeCourse = slug => emitter.emitGroundGraph({ ...input, course: { slug, name: slug, holes: [{ number: 1, par: 4, strokeIndex: 3, strokeIndexStatus: 'unverified', accuracyTier: 'D', line: model.holes[0].line.map(project) }] } });
  const graph = makeCourse('fixture-course'), other = makeCourse('other-course');
  const root = { ...graph.root, courses: [...graph.root.courses, ...other.root.courses] };
  for (const [url, bytes] of [...graph.resources, ...other.resources]) write(`public/${url}`, bytes);
  write('public/courses/v2-index.json', canonical.canonicalJsonBytes(root));
  saveSources();
  const options = { repoRoot: dir, publicDir: pub, slug: 'fixture-course', build: 'fixturebuild', migration: 'migration.json', holeTileBufferMetres: 1 };
  const move = point => { model.holes[0].line[1] = point; model.holes[0].green.c = [...point]; };
  return { dir, pub, graph, root, options, model, project, move, saveSources, sampler, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('unchanged routing and ground are byte-identical; dry preparation writes nothing', async () => {
  const F = fixture();
  try {
    const before = fs.readFileSync(path.join(F.pub, 'courses/v2-index.json'));
    const plan = await prepareRoutingRebind(F.options);
    assert.deepEqual(plan.report.changedHoles, []);
    assert.equal(plan.report.routingSha256, F.graph.references.routing.sha256);
    assert.equal(plan.report.groundManifestUnchanged, F.graph.references.ground.sha256);
    assert.equal(plan.report.sampledHeights, 0);
    assert.equal(plan.report.reusedHeights, 2);
    assert.deepEqual(fs.readFileSync(path.join(F.pub, 'courses/v2-index.json')), before);
  } finally { F.cleanup(); }
});

test('moved endpoint gets published terrain height; other course and ground remain identical', async () => {
  const F = fixture();
  try {
    F.move([8, -5]); F.saveSources();
    const plan = await prepareRoutingRebind(F.options);
    assert.deepEqual(plan.report.changedHoles, [1]);
    assert.equal(plan.report.sampledHeights, 1); assert.equal(plan.report.reusedHeights, 1);
    const routingBytes = [...plan.writes].find(([url]) => url.endsWith('.bvch'))[1];
    const routing = chunks.readChunk(routingBytes).content;
    const [e, n, h] = routing.holes[0].line[1];
    assert.deepEqual([e, n], F.project([8, -5]));
    assert.ok(Math.abs(h - F.sampler.sample(e, n).heightRH2000) < 1e-9);
    writeRoutingRebind(plan);
    const root = JSON.parse(fs.readFileSync(path.join(F.pub, 'courses/v2-index.json')));
    assert.deepEqual(root.courses.find(c => c.slug === 'other-course'), F.root.courses.find(c => c.slug === 'other-course'));
    assert.equal(sha(fs.readFileSync(path.join(F.pub, F.graph.references.ground.url))), F.graph.references.ground.sha256);
    const published = JSON.parse(fs.readFileSync(path.join(F.pub, root.courses[0].manifest.url)));
    assert.equal(published.holes[0].strokeIndexStatus, 'unverified');
    assert.equal(published.holes[0].accuracyTier, 'D');
    const repeat = await prepareRoutingRebind(F.options);
    assert.deepEqual(repeat.report.changedHoles, []);
    assert.equal(repeat.report.routingSha256, plan.report.routingSha256);
  } finally { F.cleanup(); }
});

test('stale migration and pack fail before writing; moved points outside published 1 m coverage fail', async () => {
  const F = fixture();
  try {
    fs.appendFileSync(path.join(F.dir, 'fixturebuild/course-model.json'), '\n');
    await assert.rejects(prepareRoutingRebind(F.options), /migration does not identify/);
    F.move([8, -5]); F.saveSources({ updatePack: false });
    await assert.rejects(prepareRoutingRebind(F.options), /live pack does not contain/);
    F.move([80, -50]); F.saveSources();
    await assert.rejects(prepareRoutingRebind(F.options), /no published terrain sample/);
  } finally { F.cleanup(); }
});

test('input changes after preparation prevent changing the root index', async () => {
  const F = fixture();
  try {
    F.move([8, -5]); F.saveSources();
    const plan = await prepareRoutingRebind(F.options), before = fs.readFileSync(path.join(F.pub, 'courses/v2-index.json'));
    fs.appendFileSync(path.join(F.dir, 'fixturebuild/course-model.json'), '\n');
    assert.throws(() => writeRoutingRebind(plan), /input changed during preparation/);
    assert.deepEqual(fs.readFileSync(path.join(F.pub, 'courses/v2-index.json')), before);
  } finally { F.cleanup(); }
});
