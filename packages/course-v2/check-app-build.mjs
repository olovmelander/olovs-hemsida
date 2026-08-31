#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPuttomSurfaceCoverage,
  PUTTOM_PREVIEW_CONFIG,
  verifiedSurfaceClassIds,
} from '../../apps/golf/src/engine/v2-puttom-preview.mjs';
import { createSurfacePreviewAtlas } from '../../apps/golf/src/engine/v2-surface-preview-atlas.mjs';
import { verifyChunkAsset } from './chunk-node.mjs';
import { assertSurfacePreview } from './surface-preview.mjs';
import { assertTerrainPreview } from './terrain-preview.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST = path.join(ROOT, 'apps/golf/dist');
const ASSETS = path.join(DIST, 'assets');

if (!fs.existsSync(path.join(DIST, 'sw.js'))) {
  throw new Error('golf production build is missing; run the Vite build first');
}

const previewRoot = path.join(DIST, 'v2/puttom');
const descriptorBytes = fs.readFileSync(path.join(previewRoot, 'preview.json'));
const descriptorSha256 = createHash('sha256').update(descriptorBytes).digest('hex');
if (descriptorSha256 !== PUTTOM_PREVIEW_CONFIG.descriptorSha256) {
  throw new Error(`built Puttom descriptor is ${descriptorSha256}; expected ${PUTTOM_PREVIEW_CONFIG.descriptorSha256}`);
}
const preview = assertTerrainPreview(JSON.parse(descriptorBytes));
if (preview.tiles.length !== PUTTOM_PREVIEW_CONFIG.expectedTileCount ||
    preview.frame.fingerprint !== PUTTOM_PREVIEW_CONFIG.frameFingerprint) {
  throw new Error('built Puttom preview does not match its reviewed tile/frame contract');
}
const referencedTerrain = new Set();
for (const tile of preview.tiles) {
  const file = path.resolve(previewRoot, tile.reference.url);
  if (!file.startsWith(`${previewRoot}${path.sep}`)) throw new Error('built Puttom preview asset escaped its root');
  verifyChunkAsset(tile.reference, fs.readFileSync(file));
  referencedTerrain.add(path.relative(previewRoot, file));
}
const terrainDirectory = path.join(previewRoot, 'grounds/puttom/terrain');
const retained = fs.readdirSync(terrainDirectory)
  .filter(file => file.endsWith('.bvch'))
  .map(file => path.join('grounds/puttom/terrain', file));
if (retained.length !== referencedTerrain.size || retained.some(file => !referencedTerrain.has(file))) {
  throw new Error('built Puttom preview contains missing or unreferenced BVCH files');
}

const surfaceDescriptorPath = path.join(previewRoot, 'surface-preview.json');
const surfaceDescriptorBytes = fs.readFileSync(surfaceDescriptorPath);
const surfaceDescriptorSha256 = createHash('sha256').update(surfaceDescriptorBytes).digest('hex');
if (surfaceDescriptorSha256 !== PUTTOM_PREVIEW_CONFIG.surfaceDescriptorSha256) {
  throw new Error(`built Puttom surface descriptor is ${surfaceDescriptorSha256}; expected ${PUTTOM_PREVIEW_CONFIG.surfaceDescriptorSha256}`);
}
const surface = assertSurfacePreview(JSON.parse(surfaceDescriptorBytes));
const courseIndex = JSON.parse(fs.readFileSync(path.join(DIST, 'courses/index.json')));
const puttomPack = courseIndex.courses?.find(course => course.slug === 'puttom');
if (surface.label !== PUTTOM_PREVIEW_CONFIG.surfaceLabel ||
    surface.provisionalReason !== PUTTOM_PREVIEW_CONFIG.surfaceProvisionalReason ||
    surface.terrainDescriptorSha256 !== descriptorSha256 ||
    surface.frameFingerprint !== preview.frame.fingerprint ||
    surface.source.packSha256 !== puttomPack?.sha256 ||
    surface.tiles.length !== preview.tiles.length ||
    surface.tiles.some((tile, index) => tile.id !== preview.tiles[index]?.id)) {
  throw new Error('built Puttom surface preview is not bound to its terrain frame and verified GPK1 source');
}
const referencedSurface = new Set();
const verifiedSurfaceResources = [];
for (const tile of surface.tiles) {
  const file = path.resolve(previewRoot, tile.reference.url);
  if (!file.startsWith(`${previewRoot}${path.sep}`)) throw new Error('built Puttom surface asset escaped its root');
  verifiedSurfaceResources.push({
    tileId: tile.id,
    ...verifyChunkAsset(tile.reference, fs.readFileSync(file)),
  });
  referencedSurface.add(path.relative(previewRoot, file));
}
const surfaceClassIds = verifiedSurfaceClassIds(verifiedSurfaceResources);
const surfaceAtlas = createSurfacePreviewAtlas({
  resources: verifiedSurfaceResources,
  frame: preview.frame,
  bridge: {
    translateX: preview.frame.origin.easting - PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006.easting,
    translateY: preview.frame.origin.heightRH2000,
    translateZ: PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006.northing - preview.frame.origin.northing,
  },
});
assertPuttomSurfaceCoverage(surfaceAtlas.data.classCounts);
surfaceAtlas.dispose();
const surfaceDirectory = path.join(previewRoot, 'grounds/puttom/surface');
const retainedSurface = fs.readdirSync(surfaceDirectory)
  .filter(file => file.endsWith('.bvch'))
  .map(file => path.join('grounds/puttom/surface', file));
if (retainedSurface.length !== referencedSurface.size || retainedSurface.some(file => !referencedSurface.has(file))) {
  throw new Error('built Puttom surface preview contains missing or unreferenced BVCH files');
}
const assets = fs.readdirSync(ASSETS);
const expected = [
  /^v2-terrain-preview-loader-[A-Za-z0-9_-]+\.js$/,
  /^v2-terrain-batch-[A-Za-z0-9_-]+\.js$/,
  /^v2-surface-preview-loader-[A-Za-z0-9_-]+\.js$/,
  /^v2-surface-preview-atlas-[A-Za-z0-9_-]+\.js$/,
  /^surface-grid-[A-Za-z0-9_-]+\.js$/,
  /^decode-web-[A-Za-z0-9_-]+\.js$/,
];
const chunks = expected.map(pattern => {
  const matches = assets.filter(file => pattern.test(file));
  if (matches.length !== 1) throw new Error(`expected one isolated ${pattern} chunk, found ${matches.length}`);
  return matches[0];
});
for (const chunk of chunks) {
  const bytes = fs.statSync(path.join(ASSETS, chunk)).size;
  if (bytes > 64 * 1024) throw new Error(`${chunk} is ${bytes} bytes; budget is 65536`);
}

const serviceWorker = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
if (chunks.some(chunk => serviceWorker.includes(chunk)) ||
    serviceWorker.includes('v2-terrain-preview-loader-') ||
    serviceWorker.includes('v2-terrain-batch-') ||
    serviceWorker.includes('v2-surface-preview-loader-') ||
    serviceWorker.includes('v2-surface-preview-atlas-') ||
    serviceWorker.includes('terrain-render-data-') ||
    serviceWorker.includes('surface-grid-') ||
    serviceWorker.includes('decode-web-')) {
  throw new Error('v2 terrain/surface preview chunks leaked into the production PWA precache');
}
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
if (chunks.some(chunk => html.includes(chunk))) {
  throw new Error('v2 terrain preview chunks leaked into initial HTML');
}
const headers = fs.readFileSync(path.join(DIST, '_headers'), 'utf8');
for (const requiredRule of [
  '/v2/*/surface-preview.json\n  Cache-Control: no-cache',
  '/v2/*/grounds/*/surface/*.bvch\n  Cache-Control: public, max-age=31536000, immutable',
]) {
  if (!headers.includes(requiredRule)) throw new Error(`built cache headers are missing ${requiredRule.split('\n')[0]}`);
}
console.log(`course-v2 app isolation passed: ${chunks.join(', ')}, surface classes ${surfaceClassIds.join('/')}, surface/terrain previews verified and not precached`);
