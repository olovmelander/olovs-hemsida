import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { FRAME, local } from './build-course.mjs';
import { decodeHF } from '../geobuild/lib.mjs';
import { readPack, inflateStream } from '../packages/course-pack/lib.mjs';
import { LIDINGO_V2_CONFIG } from '../apps/golf/src/engine/v2-lidingo-config.mjs';
import { assertV2LegacyCutoutContract } from '../apps/golf/src/engine/v2-legacy-cutout.mjs';
import { buildGroundSurfaceFeatures } from '../apps/golf/src/engine/surface-features.mjs';
import { rasterizeGroundAtlas } from '../apps/golf/src/engine/atlas.js';
import { SURFACE } from '../apps/golf/src/engine/surface.js';
import { centroid } from '../geobuild/lib.mjs';
const bytes = p => fs.readFileSync(new URL(p, import.meta.url));
const json = p => JSON.parse(bytes(p));
const sha = b => createHash('sha256').update(b).digest('hex');

test('named facility surfaces retain the courtyard turf island and do not duplicate source practice greens', () => {
  const m = json('./course-model.json');
  const facilitySource = json('./mapping/facilities.geojson').features;
  const courtyard = m.scenery.mappedFeatures.find(f => f.id === 'lidingo-courtyard-hardstanding-2019');
  const green = m.scenery.mappedFeatures.find(f => f.id === 'lidingo-courtyard-putting-green-2019');
  assert.equal(courtyard.rings.length, 2, 'paving must preserve its green island');
  for (const f of facilitySource.filter(f => f.properties.sourceFeatureId)) {
    const ring = f.geometry.coordinates[0].map(local);
    assert.equal(m.scenery.greens.filter(r => JSON.stringify(r) === JSON.stringify(ring)).length, 0);
    assert.equal(m.scenery.mappedFeatures.filter(r => JSON.stringify(r.rings[0]) === JSON.stringify(ring)).length, 1);
  }
  const [cx, cz] = centroid(green.rings[0]);
  const core = { x0: cx - 25, z0: cz - 25, x1: cx + 25, z1: cz + 25 };
  const features = buildGroundSurfaceFeatures({ holes: m.holes, model: { ...m, veg: m.vegetation } });
  const raster = rasterizeGroundAtlas({ CORE: core, features, res: 0.5, classesOnly: true });
  const sample = (x, z) => raster.classes[Math.floor((z-core.z0)/0.5)*raster.bounds.w+Math.floor((x-core.x0)/0.5)];
  assert.equal(sample(cx, cz), SURFACE.GREEN, 'courtyard green cannot become paving');
  const pathFeature = features.find(f => f.sourceId === courtyard.id);
  assert.equal(pathFeature.surface, SURFACE.GRAVEL, 'unknown material must not become asserted asphalt');
  assert.equal(m.scenery.rangeFacilities, null, 'observed platforms do not establish equally spaced bays');
});

test('all source golf paths survive the reference-layer split without duplicate runtime ways', () => {
  const m = json('./course-model.json');
  const routes = json('../geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson').features.filter(f => f.properties.tags.golf === 'path');
  const ways = [...m.infra.paths, ...m.infra.tracks, ...m.infra.roads];
  assert.equal(new Set(ways.map(f => f.id)).size, ways.length);
  for (const source of routes) {
    assert.deepEqual(ways.find(f => f.id === source.id)?.line, source.geometry.coordinates.map(local));
  }
});

test('facility roofs preserve source RH2000 vertices and partial support through model and pack conversion', () => {
  const m = json('./course-model.json');
  const pack = readPack(bytes('../apps/golf/public/courses/lidingo/pack.bin'));
  const packed = JSON.parse(inflateStream(pack.sv));
  const source = json('./mapping/building-roof-meshes.json');
  for (const roof of source.buildings) {
    const b = m.infra.buildings.find(f => f.id === roof.sourceFootprintId);
    assert.equal(b.h, undefined, 'roof elevation must not be reused as an eave height');
    assert.equal(b.roofSurface.state, roof.state);
    assert.deepEqual(b.roofSurface.vertices, roof.mesh.verticesEpsg3006RH2000.map(([e,n,h]) => ({ c: local([e,n]), heightRH2000:h })));
    assert.deepEqual(b.roofSurface.triangleIndices, roof.mesh.triangleIndices);
    assert.equal(b.roofSurface.boundaryWallSegments.length, roof.mesh.boundaryWallSegmentsEpsg3006RH2000.length);
    assert.deepEqual(packed.infra.buildings.find(f => f.id === b.id).roofSurface, b.roofSurface);
  }
  assert.equal(m.infra.buildings.filter(b => b.roofSurface).length, 5);
  assert.equal(m.infra.parking.length, 29, '26 source polygons plus three observed club parking fragments');
  assert.ok(m.infra.parking.every(p => p.cars === false));
});

test('every published green and physical tee is an observed source polygon, and routes stay unchanged', () => {
  const m = json('./course-model.json');
  const surfaces = json('./mapping/playing-surfaces.geojson').features;
  const routes = json('../geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson').features;
  for (const hole of m.holes) {
    assert.deepEqual(hole.line, routes.find(f => f.properties.tags.golf === 'hole' && +f.properties.tags.ref === hole.n).geometry.coordinates.map(local));
    const green = surfaces.find(f => f.id === hole.green.sourceFeatureId);
    assert.equal(green.properties.hole, hole.n);
    assert.equal(green.properties.notSurveyed, true);
    assert.deepEqual(hole.green.ring, green.geometry.coordinates[0].map(local));
    assert.ok(hole.tees.pads.length > 0);
    assert.equal(hole.tees.inferPads, false);
    for (const pad of hole.tees.pads) {
      const source = surfaces.find(f => f.id === pad.sourceFeatureId);
      assert.equal(source.properties.hole, hole.n);
      assert.deepEqual(pad.ring, source.geometry.coordinates[0].map(local));
      assert.equal(pad.preserveTerrain, true);
    }
  }
  assert.equal(m.infra.objectPlacement, 'mapped-only');
  assert.equal(m.infra.vegetationPlacement, 'measured-only');
  assert.equal(m.infra.terrainPlacement, 'measured-only');
  assert.equal(m.evidence.terrainModifiedForPlayingSurfaces, false);
});

test('published compatibility pack preserves the official 90 distances and physical platform policy', () => {
  const manifest = json('../apps/golf/public/courses/index.json').courses.find(c => c.slug === 'lidingo');
  const file = bytes('../apps/golf/public/courses/lidingo/pack.bin');
  assert.equal(sha(file), manifest.sha256);
  assert.equal(file.length, manifest.bytes);
  const pack = readPack(file), vec = JSON.parse(inflateStream(pack.sv));
  const card = json('./reference/club-scorecard.json');
  assert.deepEqual(vec.holes.map(h => [h.n, h.par, h.idx, ...h.t]), card.holes.map(h =>
    [h.number, h.par, h.index, ...card.tees.map(t => h.lengths[t.id])]));
  assert.equal(pack.header.GEO.frame, LIDINGO_V2_CONFIG.packFrame);
  assert.equal(pack.header.HF0.dx, 4);
  assert.equal(pack.header.HF1.dx, 32);
  assert.ok(vec.holes.every(h => !h.tees.inferPads && h.tees.pads.every(p => p.preserveTerrain)));
});

test('the fallback grid samples the actual retained 1 m RH 2000 terrain without green or tee flattening',
  { skip: !fs.existsSync(new URL('./cache/terrain-review/terrain-1m.f32', import.meta.url)) }, () => {
    const raw = bytes('./cache/terrain-review/terrain-1m.f32');
    const source = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const hf = json('./heightfields.json');
    assert.equal(sha(raw), hf.source.fineInputSha256);
    const fallback = decodeHF(hf.hf0);
    let maxError = 0;
    for (let r = 0; r < 513; r++) for (let c = 0; c < 513; c++) {
      maxError = Math.max(maxError, Math.abs(fallback[r * 513 + c] - source[r * 4 * 2049 + c * 4]));
    }
    assert.ok(maxError <= 0.05001, `fallback quantization error ${maxError}`);
  });

test('the live frame and cutout are pinned to the acquired extent, not a WGS84 approximation', () => {
  const contract = json('./mapping/runtime-contract.json');
  assert.equal(contract.frame.fingerprint, LIDINGO_V2_CONFIG.frameFingerprint);
  assert.equal(contract.frame.origin.easting, FRAME.easting);
  assert.equal(contract.frame.origin.northing, FRAME.northing);
  assertV2LegacyCutoutContract({ grid: contract.core, plan: contract.cutout, contract: LIDINGO_V2_CONFIG.legacyCoreCutout });
  const root = json('../apps/golf/public/courses/v2-index.json');
  const entry = root.courses.find(c => c.slug === 'lidingo');
  const course = json(`../apps/golf/public/${entry.manifest.url}`);
  const ground = json(`../apps/golf/public/${course.groundManifest.url}`);
  assert.equal(ground.frame.fingerprint, LIDINGO_V2_CONFIG.frameFingerprint);
  assert.equal(ground.tiles.filter(t => t.lod === 0 && t.layers.terrain).length, 64);
  assert.equal(ground.tiles.filter(t => t.layers.stands).length, 64);
  /* Objects are the measured individuals a vegetation publish attaches, and how
     many there are is what the compile finds -- so this asserts the INVARIANT
     and not a frozen count. It used to assert zero, which was true only while
     this ground had no generation: the publish step runs before these gates, so
     the run that first attached object registries failed on a guard that its
     own success necessarily breaks. What must stay true is that vegetation
     never reaches the coarse rings, whose samples are averaged ground. */
  for (const tile of ground.tiles.filter(t => t.lod > 0)) {
    assert.equal(tile.layers.objects ?? null, null, 'objects live on the finest tiles only');
    assert.equal(tile.layers.stands ?? null, null, 'stand fields live on the finest tiles only');
  }
  assert.ok(ground.tiles.filter(t => t.layers.objects).length <= 64, 'object registries stay within the 64 finest tiles');
  assert.equal(ground.tiles.filter(t => t.parentId).length, ground.tiles.length - 1,
    'every tile but the root keeps its explicit parent link');
});
