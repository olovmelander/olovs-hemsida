import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalJson } from './canonical-json.mjs';
import { verifyChunkAsset } from './chunk-node.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import { compileTerrainAssets } from './terrain-compiler-node.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';
import { TerrainPyramidSampler } from './terrain-pyramid.mjs';

const ORIGIN_EASTING = 650000.5;
const ORIGIN_NORTHING = 6640008.5;

function fixtureCompilation() {
  const size = 9;
  const heights = new Float32Array(size * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    heights[row * size + column] = 40 + column * 0.25 + row * 0.5;
  }
  return compileTerrainAssets({
    groundId: 'fixture-ground',
    courseSlugs: ['fixture-course'],
    heights,
    width: size,
    height: size,
    originEasting: ORIGIN_EASTING,
    originNorthing: ORIGIN_NORTHING,
    tileSegments: 4,
    codec: 'raw',
  });
}

function fixtureInput(compilation, overrides = {}) {
  const sampler = new TerrainPyramidSampler(compilation.pyramid);
  return {
    compilation,
    frame: createProvisionalFrame(compilation.bounds),
    sourceManifestSha256: 'a'.repeat(64),
    course: {
      slug: 'fixture-course',
      name: 'Fixture GK',
      holes: [
        {
          number: 1, par: 4, strokeIndex: 3, strokeIndexStatus: 'verified',
          line: [[ORIGIN_EASTING + 1, ORIGIN_NORTHING - 1], [ORIGIN_EASTING + 2.9, ORIGIN_NORTHING - 2.9]],
        },
        {
          number: 2, par: 3, strokeIndex: null, strokeIndexStatus: 'unverified',
          line: [[ORIGIN_EASTING + 6, ORIGIN_NORTHING - 6], [ORIGIN_EASTING + 7.5, ORIGIN_NORTHING - 7.5]],
        },
      ],
    },
    fallbackV1: { format: 1, packUrl: 'courses/fixture-course/pack.bin', bytes: 4096, sha256: 'b'.repeat(64) },
    heightAt: (easting, northing) => sampler.sample(easting, northing)?.heightRH2000 ?? Number.NaN,
    holeTileBufferMetres: 1,
    ...overrides,
  };
}

test('emitGroundGraph assembles a verified, content-addressed graph', () => {
  const compilation = fixtureCompilation();
  const graph = emitGroundGraph(fixtureInput(compilation));
  assert.equal(graph.report.groundId, 'fixture-ground');
  assert.equal(graph.report.tiles, 5);
  assert.equal(graph.report.finestTiles, 4);
  assert.equal(graph.report.holes, 2);
  assert.equal(graph.report.chunks, 7);
  assert.equal(graph.root.courses[0].slug, 'fixture-course');
  assert.equal(graph.root.courses[0].manifest.url.includes(graph.report.courseManifestSha256), true);

  const course = JSON.parse(Buffer.from(graph.resources.get(graph.references.course.url)).toString('utf8'));
  assert.equal(course.groundManifest.sha256, graph.report.groundManifestSha256);
  assert.deepEqual(course.holes[0].tileIds, ['l0/0/0']);
  assert.deepEqual(course.holes[1].tileIds, ['l0/1/1']);
  assert.equal(course.holes[0].accuracyTier, 'unrated');

  const routing = verifyChunkAsset(
    graph.references.routing,
    graph.resources.get(graph.references.routing.url),
  );
  assert.equal(routing.content.courseSlug, 'fixture-course');
  const [easting, northing, heightRH2000] = routing.content.holes[0].line[0];
  assert.equal(easting, ORIGIN_EASTING + 1);
  assert.equal(northing, ORIGIN_NORTHING - 1);
  assert.ok(Math.abs(heightRH2000 - 40.75) < 0.011, `routing height ${heightRH2000}`);
});

test('a wider buffer assigns more finest tiles per hole without inventing ids', () => {
  const compilation = fixtureCompilation();
  const graph = emitGroundGraph(fixtureInput(compilation, { holeTileBufferMetres: 10 }));
  const course = JSON.parse(Buffer.from(graph.resources.get(graph.references.course.url)).toString('utf8'));
  assert.deepEqual(course.holes[0].tileIds, ['l0/0/0', 'l0/0/1', 'l0/1/0', 'l0/1/1']);
});

test('emitGroundGraph fails closed on dishonest input', () => {
  const compilation = fixtureCompilation();
  const outside = fixtureInput(compilation);
  outside.course = {
    ...outside.course,
    holes: [{
      number: 1, par: 4, strokeIndex: 1, strokeIndexStatus: 'verified',
      line: [[ORIGIN_EASTING + 200, ORIGIN_NORTHING - 200], [ORIGIN_EASTING + 220, ORIGIN_NORTHING - 220]],
    }],
  };
  assert.throws(() => emitGroundGraph(outside), /has no compiled terrain height/);

  assert.throws(() => emitGroundGraph(fixtureInput(compilation, {
    fallbackV1: { format: 1, packUrl: 'courses/x/pack.bin', bytes: 4096, sha256: 'nope' },
  })), /exact live GPK1 manifest entry/);

  assert.throws(() => emitGroundGraph(fixtureInput(compilation, {
    sourceManifestSha256: 'short',
  })), /source-manifest SHA-256/);

  const wrongSlug = fixtureInput(compilation);
  wrongSlug.course = { ...wrongSlug.course, slug: 'other-course' };
  assert.throws(() => emitGroundGraph(wrongSlug), /does not declare course other-course/);
});

test('writeGroundGraphFiles persists byte-exact immutable resources plus the root', async () => {
  const compilation = fixtureCompilation();
  const graph = emitGroundGraph(fixtureInput(compilation));
  const directory = await mkdtemp(join(tmpdir(), 'ground-graph-'));
  try {
    const written = await writeGroundGraphFiles(directory, graph);
    assert.equal(written.length, graph.resources.size + 1);
    for (const [relativeUrl, bytes] of graph.resources) {
      const onDisk = await readFile(join(directory, relativeUrl));
      assert.equal(onDisk.equals(Buffer.from(bytes)), true, relativeUrl);
    }
    const root = await readFile(join(directory, 'courses/v2-index.json'));
    assert.equal(root.toString('utf8'), `${canonicalJson(graph.root)}\n`);
    /* The reported root hash must digest the bytes a client actually fetches:
       hashing the canonical JSON without its trailing newline would name a
       file that does not exist anywhere. */
    assert.equal(createHash('sha256').update(root).digest('hex'), graph.report.rootSha256);
    assert.equal(root.byteLength, graph.report.rootBytes);
    await writeGroundGraphFiles(directory, graph);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
