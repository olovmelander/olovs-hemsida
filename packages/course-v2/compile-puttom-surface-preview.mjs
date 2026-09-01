#!/usr/bin/env node
/* Build the retained Puttom surface preview from the currently verified GPK1
   vectors. This is intentionally a migration compiler, not an importer for
   surveyed surfaces: the descriptor remains provisional and binds itself to
   the exact GPK1 pack hash it derived from. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGroundSurfaceFeatures } from '../../apps/golf/src/engine/surface-features.mjs';
import { PUTTOM_PREVIEW_CONFIG } from '../../apps/golf/src/engine/v2-puttom-preview.mjs';
import { inflateStream, readPack, sha256 } from '../course-pack/lib.mjs';
import { verifyChunkAsset } from './chunk-node.mjs';
import {
  compileSurfacePreviewAssets,
  writeSurfacePreviewBundle,
} from './surface-compiler-node.mjs';
import { assertTerrainPreview } from './terrain-preview.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const APP_PUBLIC = join(ROOT, 'apps/golf/public');
const PREVIEW_ROOT = join(APP_PUBLIC, 'grounds/puttom');
const PACK_PATH = join(APP_PUBLIC, 'courses/puttom/pack.bin');
const COURSE_INDEX_PATH = join(APP_PUBLIC, 'courses/index.json');

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function terrainTiles(preview, root) {
  return preview.tiles.map(tile => {
    const file = resolve(root, tile.reference.url);
    if (!file.startsWith(`${root}/`)) throw new Error(`terrain tile escapes preview root: ${tile.id}`);
    return { tile, file };
  });
}

export async function compilePuttomSurfacePreview({
  previewRoot = PREVIEW_ROOT,
  packPath = PACK_PATH,
  courseIndexPath = COURSE_INDEX_PATH,
} = {}) {
  const root = resolve(previewRoot);
  const descriptorBytes = await readFile(join(root, 'preview.json'));
  const descriptorSha256 = hash(descriptorBytes);
  if (descriptorSha256 !== PUTTOM_PREVIEW_CONFIG.descriptorSha256) {
    throw new Error(`Puttom terrain descriptor is ${descriptorSha256}; expected ${PUTTOM_PREVIEW_CONFIG.descriptorSha256}`);
  }
  const terrain = assertTerrainPreview(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(descriptorBytes)));
  if (terrain.frame.fingerprint !== PUTTOM_PREVIEW_CONFIG.frameFingerprint ||
      terrain.tiles.length !== PUTTOM_PREVIEW_CONFIG.expectedTileCount) {
    throw new Error('Puttom terrain preview no longer matches its reviewed frame/frontier');
  }
  /* The surface frontier is a rectangular SUBSET of the terrain frontier: the
     course does not fill the 2048 m window, and painting rough at 1 m over the
     three fifths that carry nothing would cost more than the active budget
     allows. See surfaceWindowEpsg3006 in the preview config. */
  const window = PUTTOM_PREVIEW_CONFIG.surfaceWindowEpsg3006;
  const inWindow = tile => {
    const b = tile.bounds;
    return b.minEasting >= window.minEasting - 1e-6 && b.maxEasting <= window.maxEasting + 1e-6 &&
      b.minNorthing >= window.minNorthing - 1e-6 && b.maxNorthing <= window.maxNorthing + 1e-6;
  };
  const tileMetadata = await Promise.all(terrainTiles(terrain, root).map(async ({ tile, file }) => {
    const decoded = verifyChunkAsset(tile.reference, await readFile(file));
    if (decoded.header.id !== tile.id || decoded.header.kind !== 'terrain') {
      throw new Error(`Puttom terrain tile ${tile.id} has an unexpected decoded identity`);
    }
    return Object.freeze({
      id: tile.id,
      bounds: decoded.header.bounds,
      sampleSpacingMetres: decoded.header.grid.sampleSpacingMetres,
    });
  }));

  const surfaceTiles = tileMetadata.filter(inWindow);
  if (surfaceTiles.length !== PUTTOM_PREVIEW_CONFIG.expectedSurfaceTileCount) {
    throw new Error(
      `the surface window covers ${surfaceTiles.length} terrain tiles; the reviewed count is ${PUTTOM_PREVIEW_CONFIG.expectedSurfaceTileCount}`,
    );
  }

  const packBytes = await readFile(packPath);
  const courseIndex = JSON.parse(await readFile(courseIndexPath, 'utf8'));
  const packEntry = courseIndex.courses?.find(entry => entry.slug === 'puttom');
  const packSha256 = sha256(packBytes);
  if (!packEntry?.sha256 || packEntry.sha256 !== packSha256) {
    throw new Error('Puttom GPK1 pack does not match courses/index.json');
  }
  const pack = readPack(packBytes);
  if (pack.header.slug !== 'puttom') throw new Error('Puttom migration pack has the wrong slug');
  const model = JSON.parse(inflateStream(pack.sv).toString('utf8'));
  const features = buildGroundSurfaceFeatures({ holes: model.holes, model });
  const bridge = {
    translateX: terrain.frame.origin.easting - PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006.easting,
    translateZ: PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006.northing - terrain.frame.origin.northing,
  };
  const compilation = compileSurfacePreviewAssets({
    groundId: 'puttom',
    frame: terrain.frame,
    legacyBridge: bridge,
    terrainTiles: surfaceTiles,
    holes: model.holes,
    features,
    assetDirectory: 'surface',
  });
  const bundle = await writeSurfacePreviewBundle(root, compilation, {
    label: 'Puttom · migrerade ytor (ej inmätta)',
    terrainDescriptorSha256: descriptorSha256,
    packSha256,
    fileName: 'surface-preview.json',
  });
  return Object.freeze({
    terrainDescriptorSha256: descriptorSha256,
    packSha256,
    descriptor: bundle.descriptor,
    descriptorPath: bundle.descriptorPath,
    stats: compilation.stats,
  });
}

async function main() {
  const result = await compilePuttomSurfacePreview();
  console.log(JSON.stringify({
    ready: true,
    provisional: result.descriptor.provisional,
    descriptorPath: result.descriptorPath,
    terrainDescriptorSha256: result.terrainDescriptorSha256,
    sourcePackSha256: result.packSha256,
    ...result.stats,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`Puttom surface preview compile failed: ${error.message}`);
    process.exitCode = 1;
  });
}
