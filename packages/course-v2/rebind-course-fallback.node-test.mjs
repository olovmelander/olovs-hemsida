import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { prepareCourseFallbackRebind } from './rebind-course-fallback.mjs';
import { compileTerrainAssets } from './terrain-compiler-node.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';
import { readChunk } from './chunk-node.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));

async function fixture(t) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'course-addition-'));
  t.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
  const publicDir = path.join(repoRoot, 'public');
  const write = (relative, bytes) => {
    const target = path.join(repoRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  };
  const groundId = 'fixture-ground', addSlug = 'fixture-nine';
  const compilation = compileTerrainAssets({
    groundId, courseSlugs: [groundId], width: 17, height: 17,
    heights: Float32Array.from({ length: 289 }, (_, i) => 40 + i * 0.03),
    originEasting: 679420, originNorthing: 6625308,
    sampleSpacingMetres: 1, tileSegments: 4,
  });
  const sampler = new TerrainPyramidSampler(compilation.pyramid);
  const live = [];
  for (const [slug, file, line] of [
    [groundId, 'course-model.epsg3006.json', [[679422, 6625306], [679426, 6625302]]],
    [addSlug, 'nine-course-model.epsg3006.json', [[679427, 6625305], [679431, 6625299]]],
  ]) {
    const source = JSON.stringify({ holes: [{ n: 1, par: 4, idx: 1, line }] });
    write(`${slug}/course-model.json`, source);
    write(`geo_data/course-v2/${groundId}/migration/${file}`, JSON.stringify({
      groundId, source: { path: `${slug}/course-model.json`, sha256: sha(source) },
      geometry: { holes: [{ n: 1, par: 4, idx: 1, line }] },
    }));
    const bytes = Buffer.from(`fixture pack ${slug}`), packUrl = `courses/${slug}/pack.bin`;
    write(`public/${packUrl}`, bytes);
    live.push({ slug, name: slug, holes: 1, par: 4, packUrl, bytes: bytes.length, sha256: sha(bytes) });
  }
  const { packUrl, bytes, sha256 } = live[0];
  const graph = emitGroundGraph({
    compilation, frame: createProvisionalFrame(compilation.bounds),
    sourceManifestSha256: 'a'.repeat(64),
    course: { slug: groundId, name: groundId, holes: [{
      number: 1, par: 4, strokeIndex: 1, strokeIndexStatus: 'unverified', accuracyTier: 'D',
      line: [[679422, 6625306], [679426, 6625302]],
    }] },
    fallbackV1: { format: 1, packUrl, bytes, sha256 },
    heightAt: (easting, northing) => sampler.sample(easting, northing).heightRH2000,
  });
  await writeGroundGraphFiles(publicDir, graph);
  write('public/courses/index.json', JSON.stringify({ courses: live }));
  return {
    repoRoot, publicDir, graph, write,
    options: { repoRoot, publicDir, groundId, addSlug,
      added: { migration: 'nine-course-model.epsg3006.json', strokeIndexStatus: 'unverified', accuracyTier: 'D' } },
  };
}

test('adding a course shares untouched terrain and preserves the existing course routing and metadata', async t => {
  const F = await fixture(t);
  const rootBefore = fs.readFileSync(path.join(F.publicDir, 'courses/v2-index.json'));
  const { graphs, reports } = prepareCourseFallbackRebind(F.options);
  assert.equal(graphs.length, 2);
  assert.equal(new Set(reports.map(report => report.groundManifestSha256)).size, 1);
  const previousCourse = jsonBytes(F.graph.resources.get(F.graph.references.course.url));
  const updatedCourse = jsonBytes(graphs[0].resources.get(graphs[0].references.course.url));
  assert.deepEqual(updatedCourse.holes, previousCourse.holes);
  assert.deepEqual(updatedCourse.routing, previousCourse.routing);
  const previousGround = jsonBytes(F.graph.resources.get(F.graph.references.ground.url));
  const nextGround = jsonBytes(graphs[0].resources.get(graphs[0].references.ground.url));
  const withoutCourses = ground => ({ ...ground, tiles: ground.tiles.map(({ courses, ...tile }) => tile) });
  assert.deepEqual(withoutCourses(nextGround), withoutCourses(previousGround));
  assert.ok(nextGround.tiles.every(tile => tile.courses.includes('fixture-nine')));
  const nine = jsonBytes(graphs[1].resources.get(graphs[1].references.course.url));
  assert.equal(nine.holes[0].strokeIndexStatus, 'unverified');
  assert.equal(nine.holes[0].accuracyTier, 'D');
  const routing = readChunk(graphs[1].resources.get(nine.routing.url)).content;
  assert.deepEqual(routing.holes[0].line.map(point => point.slice(0, 2)), [[679427, 6625305], [679431, 6625299]]);
  assert.deepEqual(fs.readFileSync(path.join(F.publicDir, 'courses/v2-index.json')), rootBefore);

  const output = path.join(F.repoRoot, 'staged');
  for (const graph of graphs) await writeGroundGraphFiles(output, graph);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'courses/v2-index.json'))).courses.length, 2);
  assert.deepEqual(fs.readFileSync(path.join(F.publicDir, 'courses/v2-index.json')), rootBefore);
});

test('stale model, stale pack and missing addition metadata reject before any root change', async t => {
  const F = await fixture(t);
  const rootBefore = fs.readFileSync(path.join(F.publicDir, 'courses/v2-index.json'));
  assert.throws(() => prepareCourseFallbackRebind({ ...F.options, added: null }), /metadata are required/);
  assert.throws(() => prepareCourseFallbackRebind({ ...F.options, added: { ...F.options.added, accuracyTier: null } }), /accuracy-tier/);
  assert.throws(() => prepareCourseFallbackRebind({ ...F.options, addSlug: 'fixture-ground' }), /already published/);
  const modelPath = path.join(F.repoRoot, 'fixture-nine/course-model.json');
  const source = fs.readFileSync(modelPath);
  fs.appendFileSync(modelPath, '\n');
  assert.throws(() => prepareCourseFallbackRebind(F.options), /migration model .* is stale/);
  fs.writeFileSync(modelPath, source);
  fs.appendFileSync(path.join(F.publicDir, 'courses/fixture-nine/pack.bin'), 'changed');
  assert.throws(() => prepareCourseFallbackRebind(F.options), /GPK1 entry is stale or corrupt/);
  assert.deepEqual(fs.readFileSync(path.join(F.publicDir, 'courses/v2-index.json')), rootBefore);
});
