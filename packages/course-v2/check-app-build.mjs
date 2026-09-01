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

const previewRoot = path.join(DIST, path.dirname(PUTTOM_PREVIEW_CONFIG.descriptorPath));
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
/* The pilot now SHARES its directory with the published ground graph, whose
   chunks it lists: the terrain folder legitimately holds the graph's coarser
   pyramid levels as well as the 64 the preview names. So the invariant is not
   "nothing unreferenced" any more -- it is that every byte there is referenced
   by the preview OR by the graph beside it, and nothing else has been shipped. */
const terrainDirectory = path.join(previewRoot, path.dirname(preview.tiles[0].reference.url));
const graphName = fs.readdirSync(previewRoot).find(file => /^ground-v2-[0-9a-f]{64}\.json$/.test(file));
if (!graphName) throw new Error('built Puttom preview has no published ground graph beside it');
const graph = JSON.parse(fs.readFileSync(path.join(previewRoot, graphName), 'utf8'));
const referencedByGraph = new Set([
  ...(graph.tiles || []).map(tile => tile.layers?.terrain?.url),
  /* the graph's shell, its coarsest single tile, is referenced outside `tiles` */
  graph.shell?.url,
].filter(Boolean).map(url => path.basename(url)));
for (const url of referencedTerrain) referencedByGraph.add(path.basename(url));
const retained = fs.readdirSync(terrainDirectory).filter(file => file.endsWith('.bvch'));
if (retained.some(file => !referencedByGraph.has(file))) {
  throw new Error('built Puttom terrain directory contains unreferenced BVCH files');
}
for (const url of referencedTerrain) {
  if (!retained.includes(path.basename(url))) {
    throw new Error(`built Puttom preview references a missing BVCH file ${url}`);
  }
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
    /* The surface frontier is a rectangular SUBSET of the terrain frontier --
       1 m rough over the whole 2048 m window costs more than the compiler's
       active budget allows -- so it is checked as a subset at its own reviewed
       count, never as an equal list. */
    surface.tiles.length !== PUTTOM_PREVIEW_CONFIG.expectedSurfaceTileCount ||
    surface.tiles.some(tile => !preview.tiles.some(terrain => terrain.id === tile.id))) {
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
    translateY: preview.frame.origin.heightRH2000 +
      PUTTOM_PREVIEW_CONFIG.legacyFrame.verticalDatumOffsetMetres,
    translateZ: PUTTOM_PREVIEW_CONFIG.legacyOriginEpsg3006.northing - preview.frame.origin.northing,
  },
});
assertPuttomSurfaceCoverage(surfaceAtlas.data.classCounts);
surfaceAtlas.dispose();
const surfaceRelative = path.dirname(surface.tiles[0].reference.url);
const surfaceDirectory = path.join(previewRoot, surfaceRelative);
const retainedSurface = fs.readdirSync(surfaceDirectory)
  .filter(file => file.endsWith('.bvch'))
  .map(file => path.join(surfaceRelative, file));
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
  /* The summariser has one importer — its own driver — so the bundler folds it
     in and there is no separate chunk to require. Which chunk it lands in is
     the bundler's decision; that it never lands in the entry graph is the
     invariant, and the marker sweep below is what asserts it. */
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

/* What a flagless visit actually downloads: a root module plus the transitive
   closure of its STATIC imports. A dynamic import() is not in it — that is the
   whole point of the split. The set is computed rather than assumed because
   the regression it exists to catch looked like nothing at all in the source:
   main.js imported one tiny flag helper from the probe module, so every course
   visitor pulled a v2 chunk while each per-chunk assertion above still passed.
   Only the browser's no-request proof saw it, twenty minutes into CI. */
function staticClosure(roots, label) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const onDisk = path.join(ASSETS, file);
    if (!fs.existsSync(onDisk)) throw new Error(`${label} references ${file}, which was not emitted`);
    seen.add(file);
    const body = fs.readFileSync(onDisk, 'utf8');
    /* Static edges only. Backticks and parens are excluded so a minified
       `import(`./x.js`)` sitting on the same line as a later `from"./y.js"`
       cannot be read as one static import of the wrong chunk. */
    for (const [, specifier] of body.matchAll(/(?:^|[\s;}])(?:import|export)[^;'"`()]*?from\s*["']\.\/([^"']+)["']/g)) {
      queue.push(specifier);
    }
    for (const [, specifier] of body.matchAll(/(?:^|[\s;}])import\s*["']\.\/([^"']+)["']/g)) queue.push(specifier);
  }
  return seen;
}
function dynamicTargets(files) {
  const targets = new Set();
  for (const file of files) {
    const body = fs.readFileSync(path.join(ASSETS, file), 'utf8');
    for (const [, specifier] of body.matchAll(/import\(\s*[`"']\.\/([^`"']+)[`"']/g)) targets.add(specifier);
  }
  return targets;
}
const indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const htmlRoots = [...indexHtml.matchAll(/(?:src|href)="[^"]*\/assets\/([^"/]+\.js)"/g)].map(match => match[1]);
if (!htmlRoots.length) throw new Error('built index.html references no entry module; the closure proof cannot run');
/* The entry boots the chooser or the player through two separate dynamic
   imports, so the HTML closure alone describes a visitor who never opened a
   course — and the flagless visit under test opens one. The entry's OWN
   dynamic imports are its routes, so take them as additional roots rather than
   naming chunks: with only the HTML roots the real regression walked straight
   through this proof. */
const routeRoots = [...dynamicTargets(staticClosure(htmlRoots, 'built index.html'))];
if (!routeRoots.some(file => /^main-[A-Za-z0-9_-]+\.js$/.test(file))) {
  throw new Error(`the built entry no longer routes to a player chunk (${routeRoots.join(', ') || 'no routes'}); without it this proof only measures the chooser`);
}
const flaglessClosure = staticClosure([...htmlRoots, ...routeRoots], 'the built app');
for (const file of flaglessClosure) {
  if (/^(?:v2-|chunk-worker-)/.test(file)) {
    throw new Error(`${file} is reachable by static import from ${htmlRoots.concat(routeRoots).join(' / ')}; every v2 module must stay behind a dynamic import so a flagless visit fetches none of them`);
  }
}
/* A chunk-name test cannot see a v2 module INLINED into that closure, which is
   the same failure wearing a different hat, so each dynamic-only module also
   carries a literal of its own. Leaking is reported before rot, because the
   two look alike from here — a leak moves the marker out of its home chunk —
   and only one of them is fixed by touching this table. */
for (const { marker, home } of [
  { marker: 'agreedFraction', home: /^v2-stream-probe-run-/ },
  { marker: 'v2-index.json', home: /^v2-graph-source-/ },
]) {
  const carriers = assets.filter(file => file.endsWith('.js') &&
    fs.readFileSync(path.join(ASSETS, file), 'utf8').includes(marker));
  const leaked = carriers.filter(file => flaglessClosure.has(file));
  if (leaked.length) {
    throw new Error(`${marker} reached the flagless closure (${leaked.join(', ')}); a visit without ?v2 must carry no v2 code`);
  }
  /* Absence only means something once the marker has been found where it
     belongs: one that has rotted away would pass this sweep by matching
     nothing at all. */
  if (!carriers.some(file => home.test(file))) {
    throw new Error(`marker ${marker} no longer appears in a ${home} chunk; re-anchor it before this sweep can mean anything`);
  }
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
/* The paths the pilot is ACTUALLY served from. These asserted /v2/* rules
   until the widening moved the pilot to /grounds/, at which point the gate was
   demanding rules for a tree nothing ships while the live descriptors had no
   rule at all -- a required-rule check is only worth its line if it names the
   URL the runtime fetches. */
for (const requiredRule of [
  '/grounds/*/preview.json\n  Cache-Control: no-cache',
  '/grounds/*/surface-preview.json\n  Cache-Control: no-cache',
  '/grounds/*/terrain/*.bvch\n  Cache-Control: public, max-age=31536000, immutable',
  '/grounds/*/surface/*.bvch\n  Cache-Control: public, max-age=31536000, immutable',
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
