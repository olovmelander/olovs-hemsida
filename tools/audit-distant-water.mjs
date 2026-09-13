import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readChunk } from '../packages/course-v2/chunk-node.mjs';
import { waterRingTiles, rasterFromRingTiles, detectFlatWater } from '../apps/golf/src/engine/v2-flat-water.mjs';

const base = path.resolve('apps/golf/public');
const read = url => JSON.parse(fs.readFileSync(path.join(base, url), 'utf8'));
const root = read('courses/v2-index.json');
const reports = [];
const byGround = new Map();
for (const course of root.courses) {
  const manifest = read(course.manifest.url);
  if (byGround.has(manifest.groundManifest.url)) {
    byGround.get(manifest.groundManifest.url).courses.push(course.slug);
    continue;
  }
  const ground = read(manifest.groundManifest.url);
  // The metadata suffices to choose a ring; decode only the selected level.
  const rings = new Map();
  for (const tile of ground.tiles.filter(t => t.lod >= 1 && t.courses.includes(course.slug))) {
    if (!rings.has(tile.lod)) rings.set(tile.lod, []);
    rings.get(tile.lod).push({ ...tile, grid: { sampleSpacingMetres: 2 ** tile.lod } });
  }
  const selected = waterRingTiles(rings).map(tile => {
    const chunk = readChunk(fs.readFileSync(path.join(base, tile.layers.terrain.url)));
    return { ...tile, grid: chunk.header.grid, payload: chunk.payload };
  });
  const raster = rasterFromRingTiles(selected, { legacyOrigin: ground.frame.origin, verticalDatumOffsetMetres: 0 });
  const b = ground.bounds;
  assert.equal(raster.x0 + ground.frame.origin.easting, b.minEasting);
  assert.equal(raster.x0 + (raster.width - 1) * raster.spacing + ground.frame.origin.easting, b.maxEasting);
  assert.equal(ground.frame.origin.northing - raster.z0, b.maxNorthing);
  assert.equal(ground.frame.origin.northing - raster.z0 - (raster.height - 1) * raster.spacing, b.minNorthing);
  assert(raster.width <= 2049 && raster.height <= 2049, 'Detection must stay within the existing raster allocation budget');
  assert(raster.heights.every(Number.isFinite), 'Published water coverage must have no missing tiles');
  const water = detectFlatWater({ raster });
  if (course.slug === 'veckefjarden') {
    // Sjalevadsfjarden, on both sides of the former LOD 2 western edge.
    for (const x of [-4500, -4200, -4100, -4096, -4092, -4000, -3500]) {
      assert(water.isWaterAt(x, -300), `Missing lake at ${x}, -300`);
    }
    assert(water.isWaterAt(-6000, -1000));
    assert(water.isWaterAt(-5000, -800));
    assert(!water.isWaterAt(-5000, 1500), 'Dry land south of the lake must remain dry');
  }
  const report = { ground: ground.groundId, courses: [course.slug], lod: selected[0].lod,
    spacing: raster.spacing, dimensions: [raster.width, raster.height],
    extent: [(raster.width - 1) * raster.spacing, (raster.height - 1) * raster.spacing],
    lakes: water.components.length, hectares: Math.round(water.components.reduce((sum, c) => sum + c.hectares, 0)) };
  byGround.set(manifest.groundManifest.url, report);
  reports.push(report);
  console.log(JSON.stringify(report));
}
const output = path.resolve(process.argv[2] || 'output/distant-water-data.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ courses: root.courses.length, grounds: reports.length, reports }, null, 2) + '\n');
