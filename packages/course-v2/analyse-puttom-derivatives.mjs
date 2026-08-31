#!/usr/bin/env node
/* Measure what the 1 m height model alone can say about Puttom's golf
   surfaces, using only bytes already published and verified in this repo:
   the committed LOD0 terrain chunks. It is fully offline and reproducible —
   no credentials, no network — which is the point. The bunker candidates it
   finds are scored against the migrated OSM bunker rings, a source that never
   entered the height model, so the agreement is a real cross-check rather
   than a restatement. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyChunkAsset } from './chunk-node.mjs';
import {
  detectBunkerCandidates,
  matchCandidatesToReference,
  reliefSeparability,
  ruggednessGrid,
  slopeGrid,
  summarizeRaster,
} from './terrain-derivatives.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'apps/golf/public');

function publishedGround() {
  const root = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'courses/v2-index.json'), 'utf8'));
  const entry = root.courses.find(course => course.slug === 'puttom');
  if (!entry) throw new Error('the published v2 root has no puttom course');
  const course = JSON.parse(fs.readFileSync(path.join(PUBLIC, entry.manifest.url), 'utf8'));
  const ground = JSON.parse(fs.readFileSync(path.join(PUBLIC, course.groundManifest.url), 'utf8'));
  return { entry, course, ground };
}

/** Assemble the finest published level into one decoded master grid. */
function masterGrid(ground) {
  const finest = ground.tiles.filter(tile => tile.lod === 0);
  if (!finest.length) throw new Error('the published ground has no LOD0 tiles');
  let segments = null;
  const decoded = new Map();
  let originEasting = Infinity;
  let originNorthing = -Infinity;
  let maxColumn = 0;
  let maxRow = 0;
  for (const tile of finest) {
    const match = /^l0\/(\d+)\/(\d+)$/.exec(tile.id);
    if (!match) throw new Error(`unexpected LOD0 tile id ${tile.id}`);
    const column = Number(match[1]);
    const row = Number(match[2]);
    const chunk = verifyChunkAsset(
      tile.layers.terrain,
      fs.readFileSync(path.join(PUBLIC, tile.layers.terrain.url)),
    );
    const grid = chunk.header.grid;
    if (segments === null) segments = grid.width - 1;
    else if (grid.width - 1 !== segments) throw new Error('published LOD0 tiles disagree on size');
    decoded.set(`${column}/${row}`, { grid, values: decodeTerrainGrid(chunk.payload, grid) });
    originEasting = Math.min(originEasting, chunk.header.bounds.minEasting);
    originNorthing = Math.max(originNorthing, chunk.header.bounds.maxNorthing);
    maxColumn = Math.max(maxColumn, column);
    maxRow = Math.max(maxRow, row);
  }
  const spacing = finest[0] && decoded.values().next().value.grid.sampleSpacingMetres;
  const width = (maxColumn + 1) * segments + 1;
  const height = (maxRow + 1) * segments + 1;
  const heights = new Float64Array(width * height).fill(Number.NaN);
  for (const [key, tile] of decoded) {
    const [column, row] = key.split('/').map(Number);
    for (let y = 0; y < tile.grid.height; y++) {
      const target = (row * segments + y) * width + column * segments;
      heights.set(tile.values.subarray(y * tile.grid.width, (y + 1) * tile.grid.width), target);
    }
  }
  return {
    width, height, heights,
    sampleSpacingMetres: spacing,
    originEasting,
    originNorthing,
    tiles: finest.length,
  };
}

function ringCentroid(ring) {
  let easting = 0;
  let northing = 0;
  for (const [x, y] of ring) { easting += x; northing += y; }
  return { easting: easting / ring.length, northing: northing / ring.length };
}

function referenceBunkers() {
  const model = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json'), 'utf8',
  ));
  const bunkers = [];
  for (const hole of model.geometry.holes) {
    for (const bunker of hole.bunkers || []) {
      const ring = bunker.ring || bunker;
      if (!Array.isArray(ring) || ring.length < 3) continue;
      bunkers.push({ hole: hole.n, provenance: bunker.prov ?? null, ...ringCentroid(ring) });
    }
  }
  return bunkers;
}

function insideGrid(grid, point, marginMetres = 0) {
  const maxEasting = grid.originEasting + (grid.width - 1) * grid.sampleSpacingMetres;
  const minNorthing = grid.originNorthing - (grid.height - 1) * grid.sampleSpacingMetres;
  return point.easting >= grid.originEasting + marginMetres &&
    point.easting <= maxEasting - marginMetres &&
    point.northing >= minNorthing + marginMetres &&
    point.northing <= grid.originNorthing - marginMetres;
}

function main() {
  const started = Date.now();
  const { entry, ground } = publishedGround();
  const grid = masterGrid(ground);
  const reference = referenceBunkers();
  /* Only reference bunkers inside the published window can possibly be found;
     scoring against ones outside it would understate recall for a reason that
     has nothing to do with the detector. */
  const inWindow = reference.filter(bunker => insideGrid(grid, bunker));
  const detection = detectBunkerCandidates(grid);
  const score = matchCandidatesToReference({
    candidates: detection.candidates,
    reference: inWindow,
    toleranceMetres: 12,
  });

  /* Control points on the played ground itself, on a deterministic lattice so
     the comparison is reproducible. Without them the relief at bunkers is a
     number with nothing to be compared against. */
  const control = [];
  const spanEasting = Math.max(...inWindow.map(item => item.easting)) -
    Math.min(...inWindow.map(item => item.easting));
  const spanNorthing = Math.max(...inWindow.map(item => item.northing)) -
    Math.min(...inWindow.map(item => item.northing));
  const baseEasting = Math.min(...inWindow.map(item => item.easting));
  const baseNorthing = Math.min(...inWindow.map(item => item.northing));
  for (let row = 0; row < 16; row++) {
    for (let column = 0; column < 16; column++) {
      control.push({
        easting: baseEasting + (column + 0.5) * spanEasting / 16,
        northing: baseNorthing + (row + 0.5) * spanNorthing / 16,
      });
    }
  }
  const separability = reliefSeparability({ grid, reference: inWindow, control });

  const report = {
    schemaVersion: 1,
    kind: 'puttom-terrain-derivatives',
    /* Geometry alone cannot say "sand", and a mowing boundary is not a shape:
       these are tier-C geometric candidates pending an independent source. */
    accuracyTier: 'C',
    claim: 'geometric candidates from the published 1 m height model; not surveyed sand outlines',
    /* Filled in from the measurement below rather than asserted here. */
    verdict: null,
    source: {
      groundManifestSha256: createHash('sha256')
        .update(fs.readFileSync(path.join(PUBLIC, entry.manifest.url))).digest('hex'),
      lod0Tiles: grid.tiles,
      width: grid.width,
      height: grid.height,
      sampleSpacingMetres: grid.sampleSpacingMetres,
      originEasting: grid.originEasting,
      originNorthing: grid.originNorthing,
    },
    derivatives: {
      slopeRise: summarizeRaster(slopeGrid(grid)),
      ruggednessMetres: summarizeRaster(ruggednessGrid(grid)),
    },
    bunkerCandidates: {
      settings: detection.settings,
      closedDepressions: detection.depressions,
      candidates: detection.candidates.length,
      strongest: detection.candidates.slice(0, 10),
    },
    separability: {
      question: 'is a bunker distinguishable from ordinary course ground by local relief alone?',
      referenceReliefMetres: separability.reference,
      controlReliefMetres: separability.control,
      medianExcessMetres: separability.medianExcessMetres,
      separable: separability.separable,
      controlPoints: control.length,
    },
    crossCheck: {
      referenceSource: 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json (OSM-derived, never entered the height model)',
      referenceBunkers: reference.length,
      referenceInsideWindow: inWindow.length,
      ...score,
    },
    elapsedMilliseconds: Date.now() - started,
  };
  report.verdict = separability.separable && score.recall >= 0.5
    ? 'the height model resolves these bunkers; candidates may be reviewed as tier-C geometry'
    : 'the height model does NOT resolve these bunkers: their local relief overlaps ordinary course ground, so no depth threshold can isolate them. Surface boundaries need a source that measures reflectance, not shape.';

  const outIndex = process.argv.indexOf('--out');
  if (outIndex !== -1) {
    const target = process.argv[outIndex + 1];
    if (!target) throw new Error('--out needs a path');
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(path.resolve(target), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}

main();
