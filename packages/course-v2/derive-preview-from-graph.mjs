#!/usr/bin/env node
/* The pilot as a VIEW of the published graph, not a second extraction.
 *
 * The 16-tile preview was compiled separately over its own 1024 m window, and
 * that window is 183 played vertices short of the course however it is placed:
 * three greens, four bunkers and five tee pads fall outside it. The graph that
 * ships beside it already covers 2048 x 2048 m as 64 finest tiles plus a full
 * pyramid, derived from the CORE contract and gated on every run -- and its
 * `layers.terrain` is byte for byte the shape a preview `reference` takes.
 *
 * So the wide pilot needs no new bytes and no new authenticated read. It is
 * the same chunks, listed as a preview. This tool does that listing, and it is
 * deterministic: the same graph in, the same descriptor out, canonical JSON.
 *
 * The descriptor is written NEXT TO the graph rather than under v2/, because
 * resolveTerrainPreviewAssetUrl refuses an asset outside the descriptor's own
 * directory -- correctly. A pilot that pointed at ../../grounds would be a
 * path traversal wearing a relative URL.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './canonical-json.mjs';
import {
  MAX_TERRAIN_PREVIEW_TILES,
  TERRAIN_PREVIEW_KIND,
  TERRAIN_PREVIEW_PROVISIONAL_REASON,
  assertTerrainPreview,
} from './terrain-preview.mjs';
import { createProvisionalFrame } from './terrain-preview-node.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/* the terrain grid's own uint16 step, which is what a tile's stated bounds are
   rounded to */
const HEIGHT_QUANTUM_METRES = 0.01;

export function finestFrontier(graph) {
  if (!Array.isArray(graph?.tiles) || !graph.tiles.length) {
    throw new TypeError('a published ground graph with tiles is required');
  }
  const level = id => {
    const match = /^l(\d+)\//.exec(id || '');
    if (!match) throw new Error(`ground graph tile id ${id} is not a level path`);
    return Number(match[1]);
  };
  const finest = Math.min(...graph.tiles.map(tile => level(tile.id)));
  const tiles = graph.tiles
    .filter(tile => level(tile.id) === finest)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!tiles.length) throw new Error('ground graph has no finest-level tiles');
  if (tiles.length > MAX_TERRAIN_PREVIEW_TILES) {
    throw new RangeError(
      `the finest frontier is ${tiles.length} tiles; the preview format allows ${MAX_TERRAIN_PREVIEW_TILES}`,
    );
  }
  for (const tile of tiles) {
    if (!tile.layers?.terrain?.sha256) throw new Error(`ground graph tile ${tile.id} carries no terrain layer`);
  }
  return Object.freeze({ finest, tiles: Object.freeze(tiles) });
}

/* The graph states its own bounds; the preview restates them because a preview
   is read on its own, by a loader that never sees the graph. They must agree,
   and the agreement is asserted rather than assumed. */
function frontierBounds(tiles, declared, previous = null) {
  const bounds = {
    minEasting: Infinity, minNorthing: Infinity, minHeightRH2000: Infinity,
    maxEasting: -Infinity, maxNorthing: -Infinity, maxHeightRH2000: -Infinity,
  };
  for (const tile of tiles) {
    const b = tile.bounds;
    if (!b) throw new Error(`ground graph tile ${tile.id} has no bounds`);
    bounds.minEasting = Math.min(bounds.minEasting, b.minEasting);
    bounds.minNorthing = Math.min(bounds.minNorthing, b.minNorthing);
    bounds.minHeightRH2000 = Math.min(bounds.minHeightRH2000, b.minHeightRH2000);
    bounds.maxEasting = Math.max(bounds.maxEasting, b.maxEasting);
    bounds.maxNorthing = Math.max(bounds.maxNorthing, b.maxNorthing);
    bounds.maxHeightRH2000 = Math.max(bounds.maxHeightRH2000, b.maxHeightRH2000);
  }
  /* A ring-compiled graph reaches past its finest frontier on purpose: the
     course tiles sit inside coarser rings to a 16 km root. Then the graph
     must CONTAIN the frontier, and the preview describes the frontier by its
     own tiles, whose stated heights are the u16-rounded ones. */
  const contains = ['minEasting', 'minNorthing'].every(axis => declared[axis] <= bounds[axis] + 1e-6) &&
    ['maxEasting', 'maxNorthing'].every(axis => declared[axis] >= bounds[axis] - 1e-6);
  const equal = ['minEasting', 'maxEasting', 'minNorthing', 'maxNorthing'].every(axis => Math.abs(bounds[axis] - declared[axis]) <= 1e-6);
  if (!contains) throw new Error(`the finest frontier leaves the graph's declared bounds`);
  if (!equal) {
    /* The tiles know the frontier's heights only to their quantum. A preview
       already committed states them from the compile that made those tiles;
       it keeps its statement while the tiles agree with it to the quantum,
       so a ring recompile around an unchanged course does not move the
       descriptor -- and everything bound to its hash -- by a rounding. */
    const stable = axis => (previous && Number.isFinite(previous[axis]) &&
      Math.abs(previous[axis] - bounds[axis]) <= HEIGHT_QUANTUM_METRES ? previous[axis] : bounds[axis]);
    return {
      minEasting: bounds.minEasting, maxEasting: bounds.maxEasting,
      minNorthing: bounds.minNorthing, maxNorthing: bounds.maxNorthing,
      minHeightRH2000: stable('minHeightRH2000'), maxHeightRH2000: stable('maxHeightRH2000'),
    };
  }
  /* The tiles state their heights at the u16 quantum they were encoded at, so
     they round away from the graph's raw float by up to one step. Agreement is
     checked at that resolution, and the graph's own numbers are what the
     preview then repeats: two descriptors of one piece of ground must not
     disagree about how high it is, even in the last decimal. */
  for (const axis of ['minHeightRH2000', 'maxHeightRH2000']) {
    if (Math.abs(bounds[axis] - declared[axis]) > HEIGHT_QUANTUM_METRES) {
      throw new Error(`the finest frontier's ${axis} is ${bounds[axis]}; the graph declares ${declared[axis]}`);
    }
  }
  return {
    minEasting: declared.minEasting, maxEasting: declared.maxEasting,
    minNorthing: declared.minNorthing, maxNorthing: declared.maxNorthing,
    minHeightRH2000: declared.minHeightRH2000, maxHeightRH2000: declared.maxHeightRH2000,
  };
}

function previewCamera(bounds, origin) {
  const span = Math.max(bounds.maxEasting - bounds.minEasting, bounds.maxNorthing - bounds.minNorthing);
  const centreHeight = (bounds.minHeightRH2000 + bounds.maxHeightRH2000) / 2 - origin.heightRH2000;
  const relief = bounds.maxHeightRH2000 - bounds.minHeightRH2000;
  return {
    position: [span * 0.58, Math.max(span * 0.32, relief * 5 + 60), span * 0.62],
    target: [0, centreHeight, 0],
    fovDegrees: 43,
    nearMetres: Math.max(0.5, span / 4000),
    farMetres: Math.max(2000, span * 4),
  };
}

export function derivePreviewFromGraph(graph, { label, assetPrefix = 'terrain/', previousBounds = null } = {}) {
  if (typeof label !== 'string' || !label) throw new TypeError('a label is required');
  const { tiles } = finestFrontier(graph);
  const bounds = frontierBounds(tiles, graph.bounds, previousBounds);
  const frame = createProvisionalFrame(bounds);
  /* The graph and the preview describe the same ground, so they must agree on
     where its origin is; a silent disagreement would move every tile. */
  if (graph.frame?.fingerprint && graph.frame.fingerprint !== frame.fingerprint) {
    throw new Error(
      `the derived frame ${frame.fingerprint.slice(0, 12)} does not match the graph's ${graph.frame.fingerprint.slice(0, 12)}`,
    );
  }
  return assertTerrainPreview({
    schemaVersion: 1,
    kind: TERRAIN_PREVIEW_KIND,
    provisional: true,
    provisionalReason: TERRAIN_PREVIEW_PROVISIONAL_REASON,
    label,
    frame,
    bounds,
    camera: previewCamera(bounds, frame.origin),
    tiles: tiles.map(tile => ({
      id: tile.id,
      reference: { ...tile.layers.terrain, url: `${assetPrefix}${tile.layers.terrain.sha256}.bvch` },
    })),
  });
}

async function main() {
  const groundId = process.argv.includes('--ground')
    ? process.argv[process.argv.indexOf('--ground') + 1] : 'puttom';
  const label = process.argv.includes('--label')
    ? process.argv[process.argv.indexOf('--label') + 1] : 'Puttom · Lantmäteriet 1 m terräng';
  const directory = join(ROOT, 'apps/golf/public/grounds', groundId);
  /* the generation the root serves, not whichever manifest lists first:
     retained generations sit beside it for rollback */
  const publicDir = join(ROOT, 'apps/golf/public');
  const root = JSON.parse(await readFile(join(publicDir, 'courses/v2-index.json'), 'utf8'));
  const entry = root.courses?.find(course => course.groundId === groundId);
  if (!entry) throw new Error(`the root index serves no course on ground ${groundId}`);
  const course = JSON.parse(await readFile(join(publicDir, entry.manifest.url), 'utf8'));
  const name = course.groundManifest.url.split('/').pop();
  if (!(await readdir(directory)).includes(name)) throw new Error(`no published ground graph ${name} in ${directory}`);
  const graph = JSON.parse(await readFile(join(directory, name), 'utf8'));
  const target = join(directory, 'preview.json');
  let previousBounds = null;
  try { previousBounds = JSON.parse(await readFile(target, 'utf8')).bounds ?? null; } catch { previousBounds = null; }
  const descriptor = derivePreviewFromGraph(graph, { label, previousBounds });
  const bytes = `${canonicalJson(descriptor)}\n`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  const { createHash } = await import('node:crypto');
  console.log(JSON.stringify({
    ground: groundId,
    graph: name,
    descriptorPath: target.slice(ROOT.length + 1),
    descriptorSha256: createHash('sha256').update(bytes).digest('hex'),
    tiles: descriptor.tiles.length,
    bounds: descriptor.bounds,
    frameFingerprint: descriptor.frame.fingerprint,
    encodedBytes: descriptor.tiles.reduce((sum, tile) => sum + tile.reference.bytes, 0),
    decodedBytes: descriptor.tiles.reduce((sum, tile) => sum + tile.reference.decodedBytes, 0),
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`preview derivation failed: ${error.message}`); process.exitCode = 1; });
}
