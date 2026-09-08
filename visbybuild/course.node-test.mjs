import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';
import { decodeHF, pointInPoly } from '../geobuild/lib.mjs';
import { runtimeWater } from '../packages/course-pack/runtime-water.mjs';
import { assertVisbyCanonicalRouting, visbyRuntimeContract } from '../packages/course-v2/compile-visby-ground-graph.mjs';
import { VISBY_V2_CONFIG } from '../apps/golf/src/engine/v2-visby-config.mjs';
import { assertV2LegacyCutoutContract } from '../apps/golf/src/engine/v2-legacy-cutout.mjs';
import { loadPublishedGraphTerrainFrontier } from '../apps/golf/src/engine/v2-graph-frontier.mjs';
import { local } from './frame.mjs';

const bytes = relative => readFileSync(new URL(relative, import.meta.url));
const json = relative => JSON.parse(bytes(relative));

test('Visby published compatibility pack preserves canonical observed geometry and all official card values', () => {
  const model = json('./course-model.json'), geometry = json('./mapping/geometry.json');
  const pack = readPack(bytes('../apps/golf/public/courses/visby/pack.bin'));
  assert.equal(assertVisbyCanonicalRouting(geometry, model, pack).length, 18);
  const card = json('./reference/club-scorecard.json');
  assert.deepEqual(model.holes.map(hole => [hole.par, hole.idx, hole.t]), card.holes.map(hole => [hole.par, hole.index, card.tees.map(tee => hole.lengths[tee.id])]));
  for (const hole of model.holes) {
    const source = geometry.holes.find(candidate => candidate.n === hole.n);
    assert.deepEqual(hole.green.ring, source.green.ring.map(local));
    assert.deepEqual(hole.tees.pads.map(pad => pad.ring), source.tees.pads.map(pad => pad.ring.map(local)));
    assert.deepEqual(hole.fairway.rings, source.fairway.rings.map(ring => ring.map(local)));
    assert.equal(hole.tees.inferPads, false);
    assert.ok(hole.tees.pads.every(pad => pad.preserveTerrain));
    if (hole.tees.status === 'unresolved-physical-platform') {
      assert.equal(hole.n, 12);
      assert.deepEqual(hole.tees.pads, []);
      assert.deepEqual(hole.tees.sourceIds, source.tees.sourceIds);
      assert.ok(hole.tees.marks.every(mark => hole.fairway.rings.some(ring => pointInPoly(...mark.c, ring))));
    } else {
      assert.ok(hole.tees.pads.length > 0);
      assert.ok(hole.tees.marks.every(mark => hole.tees.pads.some(pad => pointInPoly(...mark.c, pad.ring))));
    }
    assert.ok(pointInPoly(...hole.pin, hole.green.ring));
  }
  assert.equal(model.infra.terrainPlacement, 'measured-only');
  assert.equal(model.infra.vegetationPlacement, 'measured-only');
  assert.equal(model.infra.objectPlacement, 'mapped-only');
  assert.equal(model.evidence.terrainModifiedForPlayingSurfaces, false);
  assert.equal(model.evidence.canonicalOriginApproval, 'pending-independent-control');
});

test('water render partitions preserve source topology, levels and physical shorelines without enabling a global ocean', () => {
  const model = json('./course-model.json');
  const simple = json('../geo_data/course-v2/visby/mapping/water-breakgeometry-simple-epsg3006.geojson');
  const canonical = json('../geo_data/course-v2/visby/mapping/water-breakgeometry-epsg3006.geojson');
  const pack = readPack(bytes('../apps/golf/public/courses/visby/pack.bin'));
  const vectors = JSON.parse(inflateStream(pack.sv));
  assert.equal(model.water.length, simple.features.length);
  assert.deepEqual(vectors.water, model.water.map(runtimeWater));
  simple.features.forEach((feature, index) => {
    const water = model.water[index], parent = canonical.features.find(candidate => candidate.id === feature.properties.parentWaterId);
    assert.deepEqual(water.ring, feature.geometry.coordinates[0].map(coordinate => local(coordinate.slice(0, 2))));
    assert.deepEqual(water.shoreline.lines, parent.properties.shoreline.lines.map(line => ({ line: line.map(coordinate => local(coordinate.slice(0, 2))) })));
    assert.equal(water.level, feature.properties.heightRH2000);
    assert.equal(water.isSea, false);
    assert.equal(water.sourceIsSea, feature.properties.isSea);
    assert.equal(water.bathymetry, null);
  });
  assert.equal(canonical.features.reduce((sum, feature) => sum + feature.geometry.coordinates.length - 1, 0), 10);
});

test('compatibility terrain streams retain the declared acquired extent and static live frontier cutout', () => {
  const model = json('./course-model.json'), heights = json('./heightfields.json');
  const pack = readPack(bytes('../apps/golf/public/courses/visby/pack.bin'));
  assert.deepEqual(pack.s0, Buffer.from(heights.hf0.b64, 'base64'));
  assert.deepEqual(pack.s1, Buffer.from(heights.hf1.b64, 'base64'));
  for (const [name, dx] of [['hf0', 4], ['hf1', 16]]) {
    const field = heights[name], values = decodeHF(field);
    assert.equal(field.dx, dx);
    assert.equal(field.x0, -2048); assert.equal(field.z0, -2048);
    assert.equal((field.nx - 1) * field.dx, 4096);
    assert.equal((field.nz - 1) * field.dx, 4096);
    assert.ok(values.every(height => Number.isFinite(height) && height >= 0.09 && height <= 11.03));
  }
  const contract = visbyRuntimeContract(model, { origin: VISBY_V2_CONFIG.canonicalOrigin }, VISBY_V2_CONFIG.expectedBoundsEpsg5845);
  assert.equal(contract.expectedTileCount, VISBY_V2_CONFIG.expectedTileCount);
  assert.deepEqual(contract.frontierBounds, VISBY_V2_CONFIG.expectedFrontierBoundsEpsg5845);
  assertV2LegacyCutoutContract({ grid: contract.core, plan: contract.cutout, contract: VISBY_V2_CONFIG.legacyCoreCutout });
});

test('the real runtime decodes exactly the reviewed 64 native-metre tiles and aligns source RH2000 heights', async () => {
  const entry = json('../apps/golf/public/courses/v2-index.json').courses.find(course => course.slug === 'visby');
  const course = json(`../apps/golf/public/${entry.manifest.url}`);
  const ground = json(`../apps/golf/public/${course.groundManifest.url}`);
  const pack = readPack(bytes('../apps/golf/public/courses/visby/pack.bin'));
  const requested = [];
  const source = await loadPublishedGraphTerrainFrontier({
    graph: { slug: 'visby', groundId: 'visby', ground, summary: { surfaceTiles: 0 } },
    geo: pack.header.GEO, config: VISBY_V2_CONFIG, baseUrl: '/', locationHref: 'https://visby-test.invalid/',
    fetchImpl: async url => {
      const pathname = new URL(url).pathname;
      requested.push(pathname);
      return new Response(bytes(`../apps/golf/public${pathname}`));
    },
  });
  assert.equal(source.ready, true);
  assert.equal(requested.length, 64);
  assert.equal(source.resources.length, 64);
  assert.ok(source.resources.every(resource => resource.width === 257 && resource.height === 257 && resource.sampleSpacingMetres === 1));
  assert.deepEqual(source.bounds, { x0: -1024, x1: 1024, z0: -1280, z1: 768 });
  assert.equal(source.waterBed, null);
  for (const hole of json('./course-model.json').holes) {
    assert.ok(Math.abs(source.heightAt(...hole.pin) - hole.elev.green) <= 0.061, `hole ${hole.n} green source height must stay on RH2000`);
    assert.ok(Math.abs(source.heightAt(...hole.tees.marks[1].c) - hole.elev.tee) <= 0.061, `hole ${hole.n} camera source height must stay on RH2000`);
  }
});
