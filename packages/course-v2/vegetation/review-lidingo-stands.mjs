#!/usr/bin/env node
/* Check emitted stand cell centres against independently evaluated source
   building footprints and street centre lines; retain sparse visual inputs.
   This verifies exclusions against source geometry, not current site accuracy. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readChunk } from '../chunk-node.mjs';
import { decodeStandField, STAND_FLAG_MEASURED, STAND_FLAG_EXCLUDED } from '../stand-field.mjs';
import { assertLidingoStandSourceHashes } from './compile-lidingo-stands.mjs';
import { lidingoExclusionFeatures } from './lidingo-stand-exclusions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STAGE = 'lidingobuild/cache/vegetation/stands-stage';
const read = relative => fs.readFileSync(path.join(ROOT, relative));
const json = relative => JSON.parse(read(relative));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const index = json(`${STAGE}/layer-index.json`);
assertLidingoStandSourceHashes(index, read);
const features = lidingoExclusionFeatures(index.inputs.map(source => json(source.path)));
const protectedFeatures = features.filter(feature => ['building', 'road', 'path'].includes(feature.kind));
const flattened = protectedFeatures.map(feature => {
  const points = [...feature.polygons.flat(2), ...feature.lines.flat()];
  return { ...feature, bbox: [Math.min(...points.map(p => p[0])) - 1, Math.min(...points.map(p => p[1])) - 1,
    Math.max(...points.map(p => p[0])) + 1, Math.max(...points.map(p => p[1])) + 1] };
});
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function distanceToLine(x, y, line) {
  let nearest = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i], [bx, by] = line[i + 1];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return nearest;
}
const counts = { eligibleCanopyCells: 0, buildingFootprintHits: 0, roadCentreLineHits: 0, pathCentreLineHits: 0 };
const hits = [];
const samples = [];
for (const [tileId, reference] of Object.entries(index.standLayers)) {
  const bytes = read(`${STAGE}/${reference.url}`);
  if (sha256(bytes) !== reference.sha256) throw new Error(`Changed stand chunk ${tileId}`);
  const chunk = readChunk(bytes);
  const field = decodeStandField(chunk.payload, chunk.header.standField);
  for (let row = 0; row < field.height; row++) {
    for (let column = 0; column < field.width; column++) {
      const i = row * field.width + column;
      if (!(field.flags[i] & STAND_FLAG_MEASURED) || (field.flags[i] & STAND_FLAG_EXCLUDED) || field.fraction[i] <= 0) continue;
      const x = chunk.header.bounds.minEasting + (column + 0.5) * field.cellMetres;
      const y = chunk.header.bounds.maxNorthing - (row + 0.5) * field.cellMetres;
      counts.eligibleCanopyCells++;
      if (x > 677050 && x < 678250 && y > 6585700 && y < 6587100) samples.push([x, y, field.fraction[i], field.p95Height[i]]);
      for (const feature of flattened) {
        if (x < feature.bbox[0] || y < feature.bbox[1] || x > feature.bbox[2] || y > feature.bbox[3]) continue;
        const inside = feature.polygons.some(rings => inRing(x, y, rings[0]) && !rings.slice(1).some(ring => inRing(x, y, ring)));
        const near = feature.lines.some(line => distanceToLine(x, y, line) <= (feature.kind === 'path' ? 0.5 : 1));
        if (inside || near) {
          const key = feature.kind === 'building' ? 'buildingFootprintHits' : feature.kind === 'road' ? 'roadCentreLineHits' : 'pathCentreLineHits';
          counts[key]++;
          if (hits.length < 50) hits.push({ tileId, column, row, easting: x, northing: y, kind: feature.kind, sourceId: feature.id });
        }
      }
    }
  }
}
const reviewDir = path.join(ROOT, 'lidingobuild/cache/vegetation/review');
fs.mkdirSync(reviewDir, { recursive: true });
fs.writeFileSync(path.join(reviewDir, 'stand-samples.json'), `${JSON.stringify(samples)}\n`);
const report = { schemaVersion: 1, groundId: 'lidingo', observedOn: new Date().toISOString().slice(0, 10),
  state: hits.length ? 'source-exclusion-review-failed' : 'source-exclusion-check-passed',
  sourceLayerIndex: { path: `${STAGE}/layer-index.json`, sha256: sha256(read(`${STAGE}/layer-index.json`)) },
  counts, protectedSourceFeatures: protectedFeatures.length, hits,
  method: 'Every eligible emitted4m cell centre checked independently against source building/road polygons and1m road /0.5m path centre-line corridors. Buffered exclusion implementation uses scanline rasterization; this check uses point-in-ring and point-to-segment evaluation.',
  limitations: ['This checks current staged exclusions against retained source geometry; it cannot prove current real-world building or tree positions.',
    '2021 laser and2019 municipal orthophoto are different vintages; newer2025 imagery access is pending.',
    'Representative stand placements are not individual observed tree locations; no individual objects are emitted.'],
};
fs.writeFileSync(path.join(ROOT, 'geo_data/course-v2/lidingo/vegetation/stand-source-review.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (hits.length) process.exitCode = 1;
