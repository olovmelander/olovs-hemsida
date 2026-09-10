/* Publish compact display-only practice surface vectors from reviewed native
 * orthophoto traces. The shipping course pack and terrain remain unchanged. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ringSD } from '../../apps/golf/src/engine/geom.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INPUT = 'lidingobuild/facilities/practice-surface-layout.json';
const OUTPUT = 'apps/golf/src/engine/scenery/lidingo-practice-surfaces.json';
const REPORT = 'lidingobuild/facilities/practice-surface-validation.json';
const PACK = 'apps/golf/public/courses/lidingo/pack.bin';
const read = relative => fs.readFileSync(path.join(ROOT, relative));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = read(INPUT), source = JSON.parse(sourceBytes), packHash = hash(read(PACK));
assert.equal(source.schemaVersion, 1);
assert.equal(source.frame.horizontalCrs, 'EPSG:3006');
assert.deepEqual(source.frame.originEpsg3006, [677700.5, 6586399.5]);
const images = new Map(source.sources.map(image => [image.id, image]));
for (const image of images.values()) {
  assert.equal(hash(read(image.path)), image.sha256, `Changed orthophoto ${image.id}`);
  assert.equal(image.boundsEpsg3006.length, 4);
  assert.ok(image.resolutionMetres > 0 && image.resolutionMetres <= 1);
}
const ids = new Set(), featureReports = [];
const features = source.features.map(feature => {
  assert.ok(typeof feature.id === 'string' && !ids.has(feature.id)); ids.add(feature.id);
  assert.ok(['practice_green', 'practice_bunker'].includes(feature.kind));
  assert.equal(feature.geometry.type, 'Polygon');
  const image = images.get(feature.sourceImageId);
  assert.ok(image, `Missing image for ${feature.id}`);
  const rings = feature.geometry.coordinates;
  assert.equal(rings.length, feature.pixelRings.length);
  assert.ok(feature.uncertaintyMetres > 0 && Number.isFinite(feature.uncertaintyMetres));
  assert.equal(feature.status, 'machine-visual-trace-display-only');
  const [west, south, east, north] = image.boundsEpsg3006;
  const pixelOffset = image.pixelCoordinateConvention === 'pixel-centres' ? .5 : 0;
  let maximumPixelRoundTripMetres = 0;
  rings.forEach((ring, r) => {
    assert.ok(ring.length >= 4); assert.deepEqual(ring[0], ring.at(-1));
    assert.equal(ring.length, feature.pixelRings[r].length);
    ring.forEach(([e, n], i) => {
      assert.ok(Number.isFinite(e) && Number.isFinite(n));
      assert.ok(e >= west && e <= east && n >= south && n <= north, `Trace outside source ${feature.id}`);
      const [px, py] = feature.pixelRings[r][i];
      const expected = [west + (px + pixelOffset) * image.resolutionMetres, north - (py + pixelOffset) * image.resolutionMetres];
      maximumPixelRoundTripMetres = Math.max(maximumPixelRoundTripMetres, Math.hypot(e - expected[0], n - expected[1]));
    });
  });
  assert.ok(maximumPixelRoundTripMetres < .0001, `Native pixel transform mismatch for ${feature.id}: ${maximumPixelRoundTripMetres}`);
  const ringArea = ring => Math.abs(ring.reduce((a, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return a + (p[0] - west) * (q[1] - south) - (q[0] - west) * (p[1] - south);
  }, 0)) / 2;
  const areaM2 = ringArea(rings[0]) - rings.slice(1).reduce((n, r) => n + ringArea(r), 0);
  assert.ok(areaM2 > 1 && areaM2 < 10000, `Implausible practice surface area ${feature.id}`);
  const local = rings.map(ring => ring.map(([e, n]) => [e - 677700.5, 6586399.5 - n]));
  const bounds = { minX: Math.min(...local[0].map(p => p[0])), maxX: Math.max(...local[0].map(p => p[0])),
    minZ: Math.min(...local[0].map(p => p[1])), maxZ: Math.max(...local[0].map(p => p[1])) };
  let interiorProbeLocal = null, clearanceMetres = 0;
  for (let x = Math.floor(bounds.minX) + .5; x < bounds.maxX; x++) {
    for (let z = Math.floor(bounds.minZ) + .5; z < bounds.maxZ; z++) {
      const distance = Math.max(ringSD(x, z, local[0]), ...local.slice(1).map(ring => -ringSD(x, z, ring)));
      if (-distance > clearanceMetres) { clearanceMetres = -distance; interiorProbeLocal = [x, z]; }
    }
  }
  assert.ok(interiorProbeLocal && clearanceMetres > .75, `No stable interior raster sample ${feature.id}`);
  featureReports.push({ id: feature.id, kind: feature.kind, areaM2, rings: rings.length,
    vertices: rings.reduce((n, r) => n + r.length, 0), maximumPixelRoundTripMetres,
    sourceImageId: image.id, sourceSha256: image.sha256, interiorProbeLocal, clearanceMetres,
    expectedSurfaceId: feature.kind === 'practice_green' ? 4 : 6 });
  return { id: feature.id, kind: feature.kind, ringsEpsg3006: rings,
    sourceImageId: image.id, sourceSha256: image.sha256, sourceEpoch: feature.sourceEpoch,
    status: feature.status, uncertaintyMetres: feature.uncertaintyMetres, evidence: feature.evidence, interiorProbeLocal };
});
assert.ok(features.length >= 3);
const output = { schemaVersion: 1, groundId: 'lidingo',
  frame: { horizontalCrs: 'EPSG:3006', originEpsg3006: [677700.5, 6586399.5] },
  sourceLayout: { path: INPUT, sha256: hash(sourceBytes) },
  state: 'machine-visual-trace-display-only', features };
const outputBytes = Buffer.from(JSON.stringify(output, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, OUTPUT), outputBytes);
assert.equal(hash(read(PACK)), packHash, 'Course pack changed');
const report = { schemaVersion: 1, groundId: 'lidingo', status: 'passed',
  input: output.sourceLayout, output: { path: OUTPUT, sha256: hash(outputBytes), bytes: outputBytes.length },
  sourcePackSha256: packHash, sourcePackModified: false, featureCount: features.length,
  counts: Object.fromEntries(['practice_green', 'practice_bunker'].map(kind => [kind, features.filter(f => f.kind === kind).length])),
  features: featureReports,
  limitations: ['Appearance-only surface traces at the orthophoto epoch, with the recorded interpretation uncertainty.',
    'No inferred terrain shaping, bunker depth, current mowing line or source-pack geometry replacement.'] };
fs.writeFileSync(path.join(ROOT, REPORT), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ status: report.status, output: report.output, counts: report.counts }, null, 2));
