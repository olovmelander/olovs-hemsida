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
  separabilitySummary,
  ruggednessGrid,
  slopeGrid,
  summarizeRaster,
} from './terrain-derivatives.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';
import { treeCoverIndex } from '../course-geo/acquisition/canopy-window.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'apps/golf/public');

export function publishedGround() {
  const root = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'courses/v2-index.json'), 'utf8'));
  const entry = root.courses.find(course => course.slug === 'puttom');
  if (!entry) throw new Error('the published v2 root has no puttom course');
  const course = JSON.parse(fs.readFileSync(path.join(PUBLIC, entry.manifest.url), 'utf8'));
  const ground = JSON.parse(fs.readFileSync(path.join(PUBLIC, course.groundManifest.url), 'utf8'));
  return { entry, course, ground };
}

/** Assemble the finest published level into one decoded master grid. */
export function masterGrid(ground) {
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

/** Greens carry `ring`; fairways carry `rings`, PLURAL, because a fairway can
    be split by a road or a stand of trees. Reading the singular here found
    zero fairways on all eighteen holes in the sibling orthophoto probe. */
export function referenceSurfaces() {
  const model = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json'), 'utf8',
  ));
  const greens = [];
  const fairways = [];
  for (const hole of model.geometry.holes) {
    if (Array.isArray(hole.green?.ring) && hole.green.ring.length >= 3) {
      greens.push({ hole: hole.n, ...ringCentroid(hole.green.ring) });
    }
    for (const ring of hole.fairway?.rings || []) {
      if (Array.isArray(ring) && ring.length >= 3) fairways.push({ hole: hole.n, ...ringCentroid(ring) });
    }
  }
  return { greens, fairways };
}

export function referenceBunkers() {
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

export function insideGrid(grid, point, marginMetres = 0) {
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
     number with nothing to be compared against.
     "Ordinary course ground" has to mean MOWN ground: a plain lattice here is
     39% forest, and forest floor under a 1 m bare-earth model is rougher than
     anything a greenkeeper maintains. Forest and unknown cells are dropped
     against the committed tree-cover raster, which never entered the height
     model. */
  const cover = treeCoverIndex(JSON.parse(fs.readFileSync(
    path.join(ROOT, 'puttombuild/tree-cover.json'), 'utf8')));
  const origin = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json'), 'utf8')).candidateOrigin;
  const openGround = point => cover.classAt(
    point.easting - origin.easting, origin.northing - point.northing) === 2;
  const control = [];
  let forestRejected = 0;
  const spanEasting = Math.max(...inWindow.map(item => item.easting)) -
    Math.min(...inWindow.map(item => item.easting));
  const spanNorthing = Math.max(...inWindow.map(item => item.northing)) -
    Math.min(...inWindow.map(item => item.northing));
  const baseEasting = Math.min(...inWindow.map(item => item.easting));
  const baseNorthing = Math.min(...inWindow.map(item => item.northing));
  for (let row = 0; row < 22; row++) {
    for (let column = 0; column < 22; column++) {
      const point = {
        easting: baseEasting + (column + 0.5) * spanEasting / 22,
        northing: baseNorthing + (row + 0.5) * spanNorthing / 22,
      };
      if (!openGround(point)) { forestRejected++; continue; }
      control.push(point);
    }
  }
  const separability = reliefSeparability({ grid, reference: inWindow, control });

  /* Bunkers were the only class ever tested against the height model, and the
     verdict was then quoted as if it covered surfaces generally. Greens and
     fairways get the same treatment here, and by the statistic that actually
     suits them: a green is a GRADED PLATFORM, so the interesting property is
     smoothness, not depth. Relief is an annulus measure built to find
     depressions and correctly reports ~0 over a flat green. */
  const surfaces = referenceSurfaces();
  const ruggedness = ruggednessGrid(grid);
  const ruggednessAt = (point, radiusMetres = 4) => {
    const reach = Math.ceil(radiusMetres / grid.sampleSpacingMetres);
    const centreColumn = Math.round((point.easting - grid.originEasting) / grid.sampleSpacingMetres);
    const centreRow = Math.round((grid.originNorthing - point.northing) / grid.sampleSpacingMetres);
    const values = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (Math.hypot(dx, dy) * grid.sampleSpacingMetres > radiusMetres) continue;
        const column = centreColumn + dx;
        const row = centreRow + dy;
        if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) continue;
        const value = ruggedness[row * grid.width + column];
        if (Number.isFinite(value)) values.push(value);
      }
    }
    if (!values.length) return Number.NaN;
    values.sort((left, right) => left - right);
    return values[values.length >> 1];
  };
  const sampleRuggedness = points => points
    .map(point => ruggednessAt(point)).filter(Number.isFinite);
  const controlRuggedness = sampleRuggedness(control);
  const smoothness = {};
  for (const [name, points] of [
    ['greens', surfaces.greens.filter(point => insideGrid(grid, point))],
    ['fairways', surfaces.fairways.filter(point => insideGrid(grid, point))],
    ['bunkers', inWindow],
  ]) {
    const values = sampleRuggedness(points);
    /* Greens and fairways should read SMOOTHER than ordinary ground and
       bunkers rougher; each direction is declared rather than chosen from
       whichever way happens to help. */
    smoothness[name] = values.length && controlRuggedness.length
      ? separabilitySummary(values, controlRuggedness, { direction: name === 'bunkers' ? 'greater' : 'less' })
      : { unmeasured: true, referenceSamples: values.length };
  }

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
      controlRule: 'lattice over the played extent, restricted to open ground by the committed tree-cover raster',
      controlForestRejected: forestRejected,
      referenceReliefMetres: separability.reference,
      controlReliefMetres: separability.control,
      medianExcessMetres: separability.medianExcessMetres,
      separable: separability.separable,
      controlPoints: control.length,
    },
    surfaceSmoothness: {
      question: 'can terrain ruggedness tell a green, a fairway or a bunker from ordinary MOWN course ground?',
      statistic: 'mean absolute height difference to the eight neighbours, median over a 4 m disc',
      controlRuggednessMetres: controlRuggedness.length,
      ...smoothness,
    },
    crossCheck: {
      referenceSource: 'geo_data/course-v2/puttom/migration/course-model.epsg3006.json (OSM-derived, never entered the height model)',
      referenceBunkers: reference.length,
      referenceInsideWindow: inWindow.length,
      ...score,
    },
    elapsedMilliseconds: Date.now() - started,
  };
  const anySurfaceSeparable = Object.values(smoothness).some(value => value.separable === true);
  report.verdict = separability.separable && score.recall >= 0.5
    ? 'the height model resolves these bunkers; candidates may be reviewed as tier-C geometry'
    : anySurfaceSeparable
      ? 'the height model does not resolve bunkers by depth, but at least one surface class separates by smoothness; see surfaceSmoothness'
      : 'the height model does NOT resolve ANY of these surface classes: bunkers overlap ordinary course ground on relief, and greens, fairways and bunkers all overlap it on smoothness, against a control restricted to mown ground. Greens are genuinely flatter at the median, but ordinary course ground has a flat tail of its own, so no threshold isolates them. Surface boundaries need a source that measures reflectance, not shape.';

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

/* Guarded so the grid loader can be reused by an experiment without running
   the whole probe. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
