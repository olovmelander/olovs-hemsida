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
import { V2_PUBLISHED_GRAPH_SLUGS } from '../../apps/golf/src/engine/v2-terrain-select.mjs';
import { canonicalJson } from './canonical-json.mjs';
import { verifyChunkAsset } from './chunk-node.mjs';
import { verifyAssetGraph } from './graph-node.mjs';
import { V2_SUPPORTED_FEATURES } from './schema.mjs';
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
  /^v2-graph-source-[A-Za-z0-9_-]+\.js$/,
  /* the summariser and its driver are separate chunks, so the first pattern
     must not also match the second's name */
  /^v2-stream-probe-(?!run-)[A-Za-z0-9_-]+\.js$/,
  /^v2-stream-probe-run-[A-Za-z0-9_-]+\.js$/,
  /^surface-grid-[A-Za-z0-9_-]+\.js$/,
  /^decode-web-[A-Za-z0-9_-]+\.js$/,
];
/* One substantive chunk per module, but a second dynamic-import site makes the
   bundler emit a tiny re-export facade beside it. That is not duplication —
   the code still exists once — so the gate asserts what actually matters: a
   single chunk carrying the module, and every other match being a facade that
   re-exports precisely that chunk. Two real copies still fail. */
const FACADE_MAX_BYTES = 512;
const chunks = expected.map(pattern => {
  const matches = assets.filter(file => pattern.test(file));
  if (!matches.length) throw new Error(`expected an isolated ${pattern} chunk, found none`);
  const sized = matches.map(file => ({ file, bytes: fs.statSync(path.join(ASSETS, file)).size }));
  const substantive = sized.filter(entry => entry.bytes > FACADE_MAX_BYTES);
  if (substantive.length !== 1) {
    throw new Error(`expected one substantive ${pattern} chunk, found ${substantive.length}: ${
      sized.map(entry => `${entry.file} (${entry.bytes} B)`).join(', ')}`);
  }
  for (const facade of sized.filter(entry => entry !== substantive[0])) {
    const body = fs.readFileSync(path.join(ASSETS, facade.file), 'utf8');
    if (!body.includes(substantive[0].file)) {
      throw new Error(`${facade.file} is not a re-export facade for ${substantive[0].file}`);
    }
  }
  return substantive[0].file;
});
for (const chunk of chunks) {
  const bytes = fs.statSync(path.join(ASSETS, chunk)).size;
  if (bytes > 64 * 1024) throw new Error(`${chunk} is ${bytes} bytes; budget is 65536`);
}

/* The v2 decode Worker must be BUNDLED, not copied. A bundler that fails to
   recognise the worker construction emits the ~90-byte entry verbatim — or
   inlines it as a base64 data URL — and its own relative import then resolves
   to a file that was never emitted. The worker dies on load and every decode
   job hangs forever with nothing thrown, which no unit test sees because they
   all inject a loader. Assert the emitted worker is real and self-contained. */
const workerChunks = assets.filter(file => /^chunk-worker-entry-[A-Za-z0-9_-]+\.(?:m?js)$/.test(file));
if (workerChunks.length !== 1) {
  throw new Error(`expected exactly one bundled v2 decode worker chunk, found ${workerChunks.length}`);
}
const workerSource = fs.readFileSync(path.join(ASSETS, workerChunks[0]), 'utf8');
if (workerSource.length < 4096) {
  throw new Error(`v2 decode worker ${workerChunks[0]} is ${workerSource.length} bytes; it was copied, not bundled`);
}
for (const [, specifier] of workerSource.matchAll(/(?:^|[\s;])(?:import|export)[^'"]*?from\s*["']([^"']+)["']/g)) {
  if (!specifier.startsWith('http')) {
    throw new Error(`v2 decode worker still imports ${specifier}; a copied entry cannot resolve it at runtime`);
  }
}
for (const otherChunk of assets.filter(file => /^v2-stream-probe-run-/.test(file))) {
  if (fs.readFileSync(path.join(ASSETS, otherChunk), 'utf8').includes('data:text/javascript;base64')) {
    throw new Error(`${otherChunk} inlines a worker as a base64 data URL; its relative imports cannot resolve`);
  }
}

const serviceWorker = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
if (chunks.some(chunk => serviceWorker.includes(chunk)) ||
    serviceWorker.includes('v2-terrain-preview-loader-') ||
    serviceWorker.includes('v2-terrain-batch-') ||
    serviceWorker.includes('v2-surface-preview-loader-') ||
    serviceWorker.includes('v2-surface-preview-atlas-') ||
    serviceWorker.includes('v2-graph-source-') ||
    serviceWorker.includes('v2-stream-probe-') ||
    serviceWorker.includes('chunk-worker-') ||
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

/* The generic selection registry and the published root must agree in both
   directions, so a committed graph cannot go unselected and the selector can
   never probe for a root that is not there. When a real graph is registered,
   the complete offline verification below runs against the built output: byte
   and SHA identity for every manifest and chunk, cross-manifest identity, and
   the exact live GPK1 fallback per course. */
const rootPath = path.join(DIST, 'courses/v2-index.json');
const rootExists = fs.existsSync(rootPath);
if (V2_PUBLISHED_GRAPH_SLUGS.length === 0) {
  if (rootExists) {
    throw new Error('courses/v2-index.json is published but V2_PUBLISHED_GRAPH_SLUGS is empty; register the graph or remove the root');
  }
} else {
  if (!rootExists) {
    throw new Error(`V2_PUBLISHED_GRAPH_SLUGS lists ${V2_PUBLISHED_GRAPH_SLUGS.join(', ')} but dist has no courses/v2-index.json`);
  }
  /* The runtime rejects any manifest whose fetched text is not byte-exact
     canonical JSON — it re-serialises what it parsed and compares. A
     structurally valid graph whose root carries so much as a trailing newline
     is therefore unloadable in the browser while passing every other check
     here, which is exactly how it once shipped. */
  const rootText = fs.readFileSync(rootPath, 'utf8');
  const root = JSON.parse(rootText);
  if (canonicalJson(root) !== rootText) {
    throw new Error('published courses/v2-index.json is not byte-exact canonical JSON; the runtime root store will refuse it');
  }
  const rootSlugs = (root.courses || []).map(course => course?.slug).sort();
  const registered = [...V2_PUBLISHED_GRAPH_SLUGS].sort();
  if (JSON.stringify(rootSlugs) !== JSON.stringify(registered)) {
    throw new Error(`published v2 root lists ${rootSlugs.join(', ')} but the app registers ${registered.join(', ')}`);
  }
  const resources = new Map();
  const loadResource = (url, label) => {
    if (typeof url !== 'string' || !url) throw new Error(`published v2 graph has no URL for ${label}`);
    if (resources.has(url)) return url;
    const file = path.resolve(DIST, url);
    if (!file.startsWith(`${DIST}${path.sep}`)) throw new Error(`${label} escapes dist: ${url}`);
    if (!fs.existsSync(file)) throw new Error(`published v2 graph is missing ${label}: ${url}`);
    resources.set(url, fs.readFileSync(file));
    return url;
  };
  const assertCanonical = (url, bytes) => {
    const text = bytes.toString('utf8');
    if (canonicalJson(JSON.parse(text)) !== text) {
      throw new Error(`published ${url} is not byte-exact canonical JSON; the runtime manifest store will refuse it`);
    }
    return JSON.parse(text);
  };
  for (const entry of root.courses) {
    const slug = entry?.slug || 'unknown-course';
    const courseUrl = loadResource(entry?.manifest?.url, `course ${slug} manifest`);
    const course = assertCanonical(courseUrl, resources.get(courseUrl));
    loadResource(course?.routing?.url, `course ${slug} routing`);
    const groundUrl = loadResource(course?.groundManifest?.url, `course ${slug} ground manifest`);
    const ground = assertCanonical(groundUrl, resources.get(groundUrl));
    loadResource(ground?.shell?.url, `ground ${ground?.groundId || slug} shell`);
    for (const tile of ground?.tiles || []) {
      for (const kind of ['terrain', 'surface', 'objects']) {
        if (kind !== 'terrain' && (tile?.layers?.[kind] === null || tile?.layers?.[kind] === undefined)) continue;
        loadResource(tile?.layers?.[kind]?.url, `ground tile ${tile?.id || '?'} ${kind}`);
      }
    }
  }
  verifyAssetGraph({ root, resources, supportedFeatures: V2_SUPPORTED_FEATURES });
  for (const entry of root.courses) {
    const live = courseIndex.courses?.find(course => course.slug === entry.slug);
    const livePackUrl = String(live?.packUrl || '').replace(/^\//, '');
    if (!live || entry.fallbackV1.sha256 !== live.sha256 || entry.fallbackV1.bytes !== live.bytes ||
        entry.fallbackV1.packUrl.replace(/^\//, '') !== livePackUrl) {
      throw new Error(`published v2 graph fallback for ${entry.slug} does not match the live GPK1 manifest`);
    }
  }
  /* Route exposure is verified by its generated shape, not a filename grep: a
     dedicated NetworkFirst strategy bound to the banvy-v2-index cache. A
     cache-first root would let a stale graph outlive the no-cache GPK1 index. */
  if (!/NetworkFirst\(\{[^{}]*"banvy-v2-index"/.test(serviceWorker.replace(/\s+/g, ''))) {
    throw new Error('a published v2 graph requires service-worker exposure: add a NetworkFirst runtime rule for courses/v2-index.json with cacheName banvy-v2-index before registering it');
  }
}

console.log(`course-v2 app isolation passed: ${chunks.join(', ')}, surface classes ${surfaceClassIds.join('/')}, surface/terrain previews verified and not precached, published graphs: ${V2_PUBLISHED_GRAPH_SLUGS.length ? V2_PUBLISHED_GRAPH_SLUGS.join(', ') : 'none'}`);
