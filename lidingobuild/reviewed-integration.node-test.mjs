import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { REVIEW_PATH, APPROACH_PATH, BUNKER_PATH, validateReviewSources, adoptReviewedSource,
  applyReviewedSurfaces, preservedModel, preservedSource, preservedGround } from './apply-reviewed-surfaces.mjs';
import { openPublishedGround, createPublishedGroundLookup } from '../packages/course-v2/published-ground-lookup.mjs';
import { parseChunkEnvelope } from '../packages/course-v2/chunk.mjs';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';
import { runtimeScenery } from '../packages/course-pack/runtime-scenery.mjs';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { rasterizeGroundAtlas } from '../apps/golf/src/engine/atlas.js';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { centroid, pointInPoly } from '../geobuild/lib.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const bytes = p => fs.readFileSync(path.join(ROOT, p));
const json = p => JSON.parse(bytes(p));
const sha = b => createHash('sha256').update(b).digest('hex');
const review = json(REVIEW_PATH), approaches = json(APPROACH_PATH), bunkers = json(BUNKER_PATH);
const receipt = json('lidingobuild/mapping/alignment-integration-2026-09-10.json');
const model = json('lidingobuild/course-model.json'), source = json('lidingobuild/mapping/playing-surfaces.geojson');

test('completed review reprojects its recorded source pixels and rejects later conflicting outlines', () => {
  validateReviewSources(review, approaches, bunkers);
  for (const [p, hash] of Object.entries(receipt.sources)) assert.equal(sha(bytes(p)), hash);
  assert.deepEqual(adoptReviewedSource(source, review, bunkers), source, 'source adoption is idempotent');
  const changed = structuredClone(source);
  changed.features.find(f => f.id === review.features[0].id).geometry.coordinates[0][0][0] += 1;
  assert.throws(() => adoptReviewedSource(changed, review, bunkers), /source boundary changed/);
  const opened = openPublishedGround(fs, path, path.join(ROOT, 'apps/golf/public'), 'lidingo');
  const lookup = createPublishedGroundLookup(opened.ground, opened.readAsset);
  const heightAt = (x, z) => lookup.heightAt(677700.5 + x, 6586399.5 - z);
  assert.deepEqual(applyReviewedSurfaces(model, source, review, approaches, bunkers, heightAt), model, 'model adoption is idempotent');
  const changedModel = structuredClone(model);
  changedModel.holes[0].green.ring[0][0] += 1;
  assert.throws(() => applyReviewedSurfaces(changedModel, source, review, approaches, bunkers, heightAt), /model boundary changed/);
});

test('latest tees, OB, source routes, buildings, water and terrain survive the branch integration exactly', () => {
  assert.equal(sha(JSON.stringify(preservedModel(model, review))), receipt.preservedModelSha256);
  assert.equal(sha(JSON.stringify(preservedSource(source, review))), receipt.preservedSourceSha256);
  const opened = openPublishedGround(fs, path, path.join(ROOT, 'apps/golf/public'), 'lidingo');
  const before = json(`apps/golf/public/${receipt.baselineGroundManifest.url}`);
  assert.equal(sha(bytes(`apps/golf/public/${receipt.baselineGroundManifest.url}`)), receipt.baselineGroundManifest.sha256);
  /* The baseline was the 277-tile ring graph with an eight-wide 1 m level; the
     standard ring publish (2026-09-11) widened level zero to sixteen tiles and
     re-addressed the baseline's 64 course tiles onto its lattice, so the two
     manifests are compared where the integration is claimed to have preserved
     the ground: the frame, and every baseline level-zero tile matched by
     POSITION -- same bounds, same decoded terrain payload (the chunk header's
     digest, which a re-address keeps), the same surface and object layers'
     presence. Stands are the layer the integration replaces, as before. */
  const current = preservedGround(opened.ground), baseline = preservedGround(before);
  assert.deepEqual(current.frame, baseline.frame);
  const key = t => `${t.bounds.minEasting}|${t.bounds.maxNorthing}`;
  const nowAt = new Map(current.tiles.filter(t => t.lod === 0).map(t => [key(t), t]));
  const headerOf = ref => parseChunkEnvelope(bytes(`apps/golf/public/${ref.url}`)).header;
  for (const tile of baseline.tiles.filter(t => t.lod === 0)) {
    const now = nowAt.get(key(tile));
    assert.ok(now, `baseline tile ${tile.id} has a tile at its position`);
    assert.deepEqual(now.bounds, tile.bounds);
    assert.equal(now.geometricErrorMetres, tile.geometricErrorMetres);
    for (const kind of ['terrain', 'surface', 'objects']) {
      assert.equal((now.layers[kind] ?? null) === null, (tile.layers[kind] ?? null) === null, `${kind} presence at ${now.id}`);
      if (now.layers[kind]) assert.equal(headerOf(now.layers[kind]).decodedSha256, headerOf(tile.layers[kind]).decodedSha256, `${kind} payload at ${now.id}`);
    }
  }
  for (const ref of [opened.courseManifest.groundManifest, opened.ground.shell,
    ...opened.ground.tiles.flatMap(t => Object.values(t.layers).filter(Boolean))]) {
    const data = bytes(`apps/golf/public/${ref.url}`);
    assert.equal(data.length, ref.bytes);
    assert.equal(sha(data), ref.sha256);
  }
  assert.equal(opened.ground.tiles.length, 469); /* the standard ring graph */
  assert.equal(opened.ground.tiles.filter(t => t.layers.stands).length, 64);
  assert.equal(opened.ground.tiles.filter(t => t.layers.objects).length, 0);
});

test('the served pack includes every reviewed feature and its canopy appearance raster', () => {
  const pack = readPack(bytes('apps/golf/public/courses/lidingo/pack.bin'));
  const vectors = JSON.parse(inflateStream(pack.sv));
  assert.equal(vectors.holes.length, model.holes.length);
  for (const [index, hole] of model.holes.entries()) {
    const packed = vectors.holes[index];
    for (const key of ['n', 'par', 'idx', 't', 'line', 'pin', 'elev', 'note']) assert.deepEqual(packed[key], hole[key]);
    assert.deepEqual(packed.green.ring, hole.green.ring);
    assert.deepEqual(packed.green.c, hole.green.c);
    assert.deepEqual(packed.bunkers.map(b => b.ring), hole.bunkers.map(b => b.ring));
    assert.deepEqual(packed.tees.pads.map(t => t.ring), hole.tees.pads.map(t => t.ring));
    assert.deepEqual(packed.tees.marks.map(t => t.c), hole.tees.marks.map(t => t.c));
  }
  assert.deepEqual(vectors.scenery, runtimeScenery(model));
  assert.deepEqual(vectors.cover, json('lidingobuild/tree-cover.json'));
  const features = buildGroundSurfaceFeatures({ holes: model.holes, model: { ...model, veg: model.vegetation } });
  for (const sourceApproach of approaches.features) {
    const feature = model.scenery.mappedFeatures.find(f => f.id === sourceApproach.id);
    assert.equal(features.find(f => f.sourceId === feature.id)?.surface, SURFACE.SEMI);
    const [x, z] = centroid(feature.rings[0]);
    const CORE = { x0: x - 60, z0: z - 60, x1: x + 60, z1: z + 60 };
    const atlas = rasterizeGroundAtlas({ CORE, features, res: 1, classesOnly: true, canopyFloor: vectors.cover });
    let mownCells = 0;
    for (let i = 0; i < atlas.classes.length; i++) {
      const px = CORE.x0 + i % atlas.bounds.w + .5, pz = CORE.z0 + Math.floor(i / atlas.bounds.w) + .5;
      if (atlas.classes[i] === SURFACE.SEMI && pointInPoly(px, pz, feature.rings[0])) mownCells++;
    }
    assert.ok(mownCells > 30, `${feature.id} is visible as mown approach (${mownCells} cells)`);
  }
  assert.equal(model.holes[12].bunkers.filter(b => b.sourceFeatureId === bunkers.features[0].id).length, 1);
});
