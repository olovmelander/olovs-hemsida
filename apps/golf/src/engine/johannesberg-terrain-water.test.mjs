import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readChunk } from '../../../../packages/course-v2/chunk-node.mjs';
import { rasterFromRingTiles, waterRingTiles, detectFlatWater } from './v2-flat-water.mjs';
import { legacyGridBridge } from './geodetic-frame.mjs';
import { JOHANNESBERG_V2_CONFIG as config, JOHANNESBERG_9_V2_CONFIG as nine } from './v2-johannesberg-config.mjs';
import { inRingIndexed } from './ring-index.mjs';
import { buildGroundSurfaceFeatures } from './surface-features.mjs';
import { rasterizeGroundAtlas } from './atlas.js';
import { SURFACE } from './surface.js';
import { buildWaterBedField } from './v2-water-bed.mjs';
import { V2GraphTerrainAdapter } from './v2-graph-terrain.mjs';

const publicRoot = new URL('../../public/', import.meta.url);
const read = url => JSON.parse(fs.readFileSync(url, 'utf8'));
const index = read(new URL('courses/v2-index.json', publicRoot));
const course = read(new URL(index.courses.find(c => c.slug === 'johannesberg').manifest.url, publicRoot));
const ground = read(new URL(course.groundManifest.url, publicRoot));
const model = read(new URL('../../../../johannesbergbuild/course-model.json', import.meta.url));
const bridge = legacyGridBridge(config.legacyFrame);
const rings = new Map();
for (const tile of ground.tiles.filter(t => t.lod >= 1)) {
  if (!rings.has(tile.lod)) rings.set(tile.lod, []);
  rings.get(tile.lod).push({ ...tile, grid: { sampleSpacingMetres: 2 ** tile.lod } });
}
const tiles = waterRingTiles(rings).map(tile => {
  const chunk = readChunk(fs.readFileSync(new URL(tile.layers.terrain.url, publicRoot)));
  return { ...tile, grid: chunk.header.grid, payload: chunk.payload };
});
const raster = rasterFromRingTiles(tiles, { legacyOrigin: config.legacyOriginEpsg3006,
  verticalDatumOffsetMetres: config.legacyFrame.verticalDatumOffsetMetres });
const options = { raster, knownBodies: model.water, toLegacy: bridge.toLegacy };
const before = detectFlatWater(options);
const adapter = { ringTiles: new Map([[3, tiles]]), legacyOrigin: config.legacyOriginEpsg3006,
  bridge: { ...bridge, verticalDatumOffsetMetres: config.legacyFrame.verticalDatumOffsetMetres } };
const after = V2GraphTerrainAdapter.prototype.detectFlatWater.call(adapter, model.water,
  { quantizationAware: config.flatWaterQuantizationAware });

// The same published 8 m ring that produced the screenshots. This finite
// window includes the fields west of holes 1-4 and both courses' surroundings.
function nearCells(water) {
  let count = 0;
  for (let row = 0; row < raster.height; row++) for (let col = 0; col < raster.width; col++) {
    if (!water.mask[row * raster.width + col]) continue;
    const [x, z] = bridge.toLegacy(raster.x0 + (col + .5) * raster.spacing,
      raster.z0 + (row + .5) * raster.spacing);
    if (Math.abs(x) <= 1100 && Math.abs(z) <= 1200) count++;
  }
  return count;
}

describe('Johannesberg published terrain regression', () => {
  it('removes the quantized false lakes without increasing raster resolution or allocation', () => {
    expect(config.flatWaterQuantizationAware).toBe(true);
    expect(nine.flatWaterQuantizationAware).toBe(true);
    expect(raster.heightScaleMetres).toBe(0.08);
    expect(nearCells(before)).toBeGreaterThan(2500);
    expect(nearCells(after)).toBe(0);
    expect(after.mask.byteLength).toBe(before.mask.byteLength);
    expect([after.width, after.height, after.spacing]).toEqual([2049, 2049, 8]);
  });

  it.each(['Uttran', 'Hävsjön'])('retains terrain-detected water inside %s', name => {
    const body = model.water.find(w => w.name === name);
    let retained = 0;
    for (let row = 0; row < raster.height; row++) for (let col = 0; col < raster.width; col++) {
      const gx = raster.x0 + (col + .5) * raster.spacing, gz = raster.z0 + (row + .5) * raster.spacing;
      if (!after.isFlatAt(gx, gz)) continue;
      if (inRingIndexed(...bridge.toLegacy(gx, gz), body.ring)) retained++;
    }
    expect(retained).toBeGreaterThan(50);
  });

  it('still carves the mapped course ponds but leaves the former field lakes dry', () => {
    const bed = buildWaterBedField({ flatWater: after, knownBodies: model.water,
      toLegacy: bridge.toLegacy, toGrid: bridge.toGrid });
    // All mapped bodies remain authoritative, including Rotsjön, whose
    // surface need not qualify as an independently inferred flat component.
    for (const body of model.water) {
      const samples = [];
      const x0 = Math.min(...body.ring.map(p => p[0])), x1 = Math.max(...body.ring.map(p => p[0]));
      const z0 = Math.min(...body.ring.map(p => p[1])), z1 = Math.max(...body.ring.map(p => p[1]));
      for (let z = z0 + 4; z < z1; z += 8) for (let x = x0 + 4; x < x1; x += 8) {
        if (inRingIndexed(x, z, body.ring)) samples.push(bed.inWater(...bridge.toGrid(x, z)));
      }
      expect(samples.some(Boolean), body.id).toBe(true);
    }
    for (let i = 0; i < before.mask.length; i++) {
      if (!before.mask[i]) continue;
      const gx = raster.x0 + (i % raster.width + .5) * raster.spacing;
      const gz = raster.z0 + (Math.floor(i / raster.width) + .5) * raster.spacing;
      const [x, z] = bridge.toLegacy(gx, gz);
      if (Math.abs(x) > 1100 || Math.abs(z) > 1200) continue;
      // Source pond geometry wins independently of an inferred flat's label.
      if (model.water.some(body => inRingIndexed(x, z, body.ring))) continue;
      expect(bed.inWater(gx, gz)).toBe(false);
    }
  });

  it('classifies the existing service yard at one metre and retains the grass in its concave edge', () => {
    const features = buildGroundSurfaceFeatures({ holes: model.holes, model });
    const CORE = { x0: 20, z0: -830, x1: 200, z1: -640 };
    const atlas = rasterizeGroundAtlas({ CORE, features, res: 1, classesOnly: true });
    const prior = rasterizeGroundAtlas({ CORE, features: features.filter(f => !f.rings?.includes(model.surround.yard)),
      res: 1, classesOnly: true });
    const at = (x, z) => atlas.classes[(z - CORE.z0) * atlas.bounds.w + x - CORE.x0];
    expect(at(80, -760)).toBe(SURFACE.GRAVEL);
    expect(at(160, -730)).toBe(SURFACE.GRAVEL);
    expect(at(80, -680)).not.toBe(SURFACE.GRAVEL);
    // The west edge also has a mapped gravel road: preserve its real class.
    for (let z = CORE.z0; z < CORE.z1; z++) for (let x = CORE.x0; x < CORE.x1; x++) {
      if (inRingIndexed(x + .5, z + .5, model.surround.yard)) continue;
      const i = (z - CORE.z0) * atlas.bounds.w + x - CORE.x0;
      expect(atlas.classes[i]).toBe(prior.classes[i]);
    }
    expect(features.find(f => f.rings?.includes(model.surround.yard)).rings[0]).toEqual(model.surround.yard);
  });
});
