import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSyntheticAssetGraph } from '../synthetic-fixture.mjs';
import { readChunk } from '../chunk-node.mjs';
import { validateObjectRegistry } from '../object-registry.mjs';
import { createRaster } from './canopy-fields.mjs';
import { createGroundSampler } from './ground-sampler.mjs';
import {
  candidateKey,
  clipRasterToExtent,
  compileVegetation,
  provisionalZone,
  readActivePublishedGround,
  readRawRaster,
  writeCompilation,
} from './compile-vegetation.mjs';

test('active ground selection follows the root instead of a retained manifest filename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-ground-'));
  try {
    fs.mkdirSync(path.join(dir, 'courses/live'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'grounds/test-ground'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'courses/v2-index.json'), JSON.stringify({
      courses: [{ slug: 'live', groundId: 'test-ground', manifest: { url: 'courses/live/course-v2-live.json' } }],
    }));
    fs.writeFileSync(path.join(dir, 'courses/live/course-v2-live.json'), JSON.stringify({
      slug: 'live', groundId: 'test-ground', groundManifest: { url: 'grounds/test-ground/ground-v2-z-live.json' },
    }));
    fs.writeFileSync(path.join(dir, 'grounds/test-ground/ground-v2-a-stale.json'), JSON.stringify({
      groundId: 'test-ground', generation: 'stale',
    }));
    fs.writeFileSync(path.join(dir, 'grounds/test-ground/ground-v2-z-live.json'), JSON.stringify({
      groundId: 'test-ground', generation: 'active',
    }));
    const selected = readActivePublishedGround(dir, 'test-ground');
    assert.equal(selected.ground.generation, 'active');
    assert.equal(selected.courseManifest.slug, 'live');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* the synthetic ground: 256 x 256 m at E 650000, N 6640000..6640256 */
const graph = createSyntheticAssetGraph();
const groundUrl = graph.root.courses.find(course => course.slug === 'synthetic-main').groundUrl
  || [...graph.resources.keys()].find(url => /grounds\/synthetic-ground\/ground-v2-/.test(url));
const ground = JSON.parse(Buffer.from(graph.resources.get(groundUrl)).toString('utf8'));
const readAsset = async url => graph.resources.get(url);

/* all on the southern half, N 6640000..6640128, which is where the synthetic
   ground's two finest tiles are: a tree with no published tile under it gets
   no base height and therefore no record, by design */
const TREES = [
  { easting: 650030.5, northing: 6640100.5, height: 18, radius: 3.5 },
  { easting: 650070.5, northing: 6640030.5, height: 12, radius: 2.5 },
  { easting: 650180.5, northing: 6640060.5, height: 22, radius: 4 },
  { easting: 650210.5, northing: 6640110.5, height: 9, radius: 2 },
  { easting: 650120.5, northing: 6640090.5, height: 15, radius: 3 },
];

function canopy() {
  const width = 256;
  const height = 256;
  const raster = createRaster({ width, height, sampleSpacingMetres: 1, originEasting: 650000, originNorthing: 6640256, fill: 0 });
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const e = 650000 + column + 0.5;
      const n = 6640256 - row - 0.5;
      let best = 0;
      for (const tree of TREES) {
        const d2 = (e - tree.easting) ** 2 + (n - tree.northing) ** 2;
        const sigma2 = (tree.radius ** 2) / (2 * Math.log(5));
        best = Math.max(best, tree.height * Math.exp(-d2 / (2 * sigma2)));
      }
      raster.values[row * width + column] = best;
    }
  }
  return raster;
}

const CAMPAIGNS = {
  groundId: 'synthetic-ground',
  activeItemIds: ['24f001-650_66'],
  supersededItemIds: ['20f001-650_66'],
  seams: [{ id: 'seam-northing-6640064', axis: 'northing', value: 6640064, from: 650000, to: 650256, items: ['24f001-650_66', 'x'] }],
  terms: { attribution: 'Laserdata Nedladdning, skog, © Lantmäteriet, bearbetad, CC BY 4.0' },
  items: [
    { id: '24f001-650_66', role: 'active', projBbox: [650000, 6640000, 650256, 6640256], captureStart: '2024-06-01T00:00:00Z', captureEnd: '2024-06-03T00:00:00Z' },
    { id: '20f001-650_66', role: 'superseded', projBbox: [650000, 6640000, 650256, 6640256], captureStart: '2020-06-01T00:00:00Z', captureEnd: '2020-06-03T00:00:00Z' },
  ],
};

/* one hole line running north-south through the middle, and a green under tree 5 */
const GEOMETRY = {
  holes: [{ n: 1, line: [[650128, 6640010], [650128, 6640120]], green: { ring: [[650110, 6640100], [650130, 6640100], [650130, 6640080], [650110, 6640080]] }, fairway: { rings: [] }, tees: { pads: [] }, bunkers: [] }],
  water: [], streams: [], scenery: {}, infra: {},
};

test('the ground sampler reads base heights from the published terrain tiles', async () => {
  const sampler = await createGroundSampler(ground, readAsset);
  assert.equal(sampler.frameFingerprint, ground.frame.fingerprint);
  const inside = await sampler.sample(650064, 6640064);
  assert.equal(inside.nodata, false);
  assert.ok(inside.heightRH2000 >= 20 && inside.heightRH2000 <= 23, `height ${inside.heightRH2000} inside the tile's range`);
  assert.equal(inside.tileId, 'l0/0/0');
  assert.equal(inside.sha256, ground.tiles.find(tile => tile.id === 'l0/0/0').layers.terrain.sha256);
  assert.equal(await sampler.sample(640000, 6640064), null);
});

test('provisional zoning and extent clipping', () => {
  assert.equal(provisionalZone(650128, 6640100, GEOMETRY.holes).zone, 'A');
  assert.equal(provisionalZone(650128 + 150, 6640100, GEOMETRY.holes).zone, 'B');
  assert.equal(provisionalZone(650128 + 400, 6640100, GEOMETRY.holes).zone, 'C');
  const raster = canopy();
  const { raster: clipped, clipped: count } = clipRasterToExtent(raster, [650000, 6640128, 650256, 6640256]);
  assert.equal(count, 256 * 128);
  assert.ok(Number.isNaN(clipped.values[255 * 256]));
  assert.ok(!Number.isNaN(clipped.values[0]));
});

test('end to end: rasters in, candidates, evidence, records and chunks out, with stable ids on a rebuild', async () => {
  const raster = canopy();
  const first = await compileVegetation({
    groundId: 'synthetic-ground',
    observedOn: '2026-09-02',
    campaigns: CAMPAIGNS,
    rasters: [{ campaignId: '24f001-650_66', raster }],
    geometry: GEOMETRY,
    ground,
    readAsset,
    approveAllIndividuals: true,
  });
  assert.equal(first.candidates.length, TREES.length, 'every planted tree is a candidate');
  const excluded = first.candidates.filter(candidate => candidate.representation === 'excluded');
  assert.equal(excluded.length, 1, 'the tree on the green is excluded');
  assert.equal(excluded[0].exclusionReason, 'green');
  assert.ok(first.candidates.every(candidate => candidate.key === candidateKey(candidate.campaignId, candidate)));
  assert.ok(first.candidates.every(candidate => ['A', 'B', 'C'].includes(candidate.truthZone)));
  assert.equal(first.records.length, 4);
  assert.ok(first.records.every(record => record.placementMethod === 'derived-lidar' && record.reviewStatus === 'approved'));
  assert.ok(first.records.every(record => record.horizontalAccuracyMetres >= 1.5 && record.verticalAccuracyMetres >= 1.5));
  assert.ok(first.records.every(record => record.heightRH2000 >= 20 && record.heightRH2000 <= 23), 'bases come from the published tiles');
  assert.ok(first.records.every(record => record.sourceId === 'laser-lm-skog-24f001-650-66'));
  assert.ok(first.records.every(record => record.capturedAt === '2024-06-03'));
  assert.equal(first.evidence.review.startsWith('HARNESS AUTO-APPROVAL'), true);
  assert.equal(first.evidence.attribution, CAMPAIGNS.terms.attribution);
  assert.equal(first.evidence.candidates.byRepresentation.excluded, 1);
  assert.equal(first.evidence.records.records, 4);
  assert.ok(first.compiled.chunks.length >= 1);
  for (const chunk of first.compiled.chunks) {
    const decoded = readChunk(chunk.bytes);
    assert.equal(decoded.header.kind, 'objects');
    assert.deepEqual(validateObjectRegistry(decoded.content, decoded.header), []);
  }
  assert.equal(first.diff.added.length, 4);

  /* the seam confidence term: the tree 3.5 m from the seam scores lower on boundaries than one 36 m away */
  const nearSeam = first.candidates.find(candidate => Math.abs(candidate.centroid.northing - 6640060.5) < 2);
  const farFromSeam = first.candidates.find(candidate => Math.abs(candidate.centroid.northing - 6640100.5) < 2);
  assert.ok(nearSeam.confidenceTerms.boundaries < farFromSeam.confidenceTerms.boundaries);

  /* rebuild with a 0.4 m shift: ids survive, nothing is added or missing */
  const shifted = createRaster({ ...raster, originEasting: raster.originEasting + 0.4 });
  const second = await compileVegetation({
    groundId: 'synthetic-ground',
    observedOn: '2026-09-02',
    campaigns: CAMPAIGNS,
    rasters: [{ campaignId: '24f001-650_66', raster: shifted }],
    geometry: GEOMETRY,
    ground,
    readAsset,
    previousRecords: first.records,
    approveAllIndividuals: true,
  });
  assert.deepEqual(second.records.map(record => record.id), first.records.map(record => record.id));
  assert.equal(second.identity.missing.length, 0);
  assert.equal(second.identity.added.length, 0);
  assert.equal(second.diff.removed.length, 0);

  /* no approvals means no records, and a superseded campaign is refused */
  const unreviewed = await compileVegetation({ groundId: 'synthetic-ground', observedOn: '2026-09-02', campaigns: CAMPAIGNS, rasters: [{ campaignId: '24f001-650_66', raster }], geometry: GEOMETRY, ground, readAsset });
  assert.equal(unreviewed.records.length, 0);
  assert.equal(unreviewed.candidates.length, TREES.length);
  await assert.rejects(compileVegetation({ groundId: 'synthetic-ground', observedOn: '2026-09-02', campaigns: CAMPAIGNS, rasters: [{ campaignId: '20f001-650_66', raster }], geometry: GEOMETRY, ground, readAsset }), /superseded/);

  /* an approvals file selects records by key */
  const approvals = first.candidates.filter(candidate => candidate.representation === 'individual').slice(0, 2).map(candidate => candidate.key);
  const partial = await compileVegetation({ groundId: 'synthetic-ground', observedOn: '2026-09-02', campaigns: CAMPAIGNS, rasters: [{ campaignId: '24f001-650_66', raster }], geometry: GEOMETRY, ground, readAsset, approvals });
  assert.equal(partial.records.length, 2);

  /* the output directory round-trips */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vegetation-'));
  writeCompilation(dir, first);
  const layers = JSON.parse(fs.readFileSync(path.join(dir, 'layers.json'), 'utf8'));
  for (const reference of Object.values(layers)) {
    assert.ok(fs.existsSync(path.join(dir, 'objects', `${reference.sha256}.bvch`)));
  }
  assert.ok(fs.existsSync(path.join(dir, 'candidates.json')));
  assert.ok(fs.existsSync(path.join(dir, 'stand-fields.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('raw Float32 rasters with a sidecar read back with nodata as NaN', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'raster-'));
  const data = new Float32Array([1, -9999, 3, 4]);
  fs.writeFileSync(path.join(dir, 'chm.f32'), Buffer.from(data.buffer));
  fs.writeFileSync(path.join(dir, 'chm.json'), JSON.stringify({ width: 2, height: 2, sampleSpacingMetres: 1, originEasting: 1, originNorthing: 2, noData: -9999 }));
  const raster = readRawRaster(path.join(dir, 'chm.f32'), path.join(dir, 'chm.json'));
  assert.equal(raster.values[0], 1);
  assert.ok(Number.isNaN(raster.values[1]));
  fs.writeFileSync(path.join(dir, 'chm.json'), JSON.stringify({ width: 3, height: 2, sampleSpacingMetres: 1, originEasting: 1, originNorthing: 2 }));
  assert.throws(() => readRawRaster(path.join(dir, 'chm.f32'), path.join(dir, 'chm.json')), /sidecar declares/);
  fs.rmSync(dir, { recursive: true, force: true });
});
