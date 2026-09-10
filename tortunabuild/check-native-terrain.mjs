/* Encoding consistency through the runtime's verified asset loader and CPU
 * sampler. This is not an independent horizontal/vertical accuracy survey. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CourseV2AssetLoader } from '../packages/course-v2/runtime/asset-loader.mjs';
import { MemoryByteCache } from '../packages/course-v2/runtime/cache.mjs';
import { verifyChunkAssetWeb } from '../packages/course-v2/runtime/decode-web.mjs';
import { createTerrainRenderResource, sampleTerrainRenderResource } from '../packages/course-v2/runtime/terrain-render-data.mjs';
import { TORTUNA_GROUND_GRAPH_CONFIG as CONFIG, assertTortunaAcquisition } from '../packages/course-v2/tortuna-ground-graph.mjs';
import { createTerrainSampler } from './build-course.mjs';
import { projected } from './frame.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async file => JSON.parse(await readFile(file, 'utf8'));

export async function checkNativeTerrain({ root = ROOT, publicDirectory = 'apps/golf/public' } = {}) {
  const output = path.resolve(root, publicDirectory);
  const index = await json(path.join(output, 'courses/v2-index.json'));
  const entry = index.courses.find(course => course.slug === 'tortuna');
  if (!entry) throw new Error('Tortuna has no published ground to validate');
  const course = await json(path.join(output, entry.manifest.url));
  const ground = await json(path.join(output, course.groundManifest.url));
  const model = await json(path.join(root, 'tortunabuild/course-model.json'));
  const bytes = await readFile(path.join(root, 'tortunabuild/cache/terrain/terrain-1m.f32'));
  assertTortunaAcquisition(await json(path.join(root, 'geo_data/course-v2/tortuna/acquisition/terrain-window.json')), createHash('sha256').update(bytes).digest('hex'));
  const fine = new Float32Array(CONFIG.width * CONFIG.height);
  for (let i = 0; i < fine.length; i++) fine[i] = bytes.readFloatLE(i * 4);
  const nativeHeight = createTerrainSampler(fine);
  const loader = new CourseV2AssetLoader({ baseUrl: 'https://tortuna-validation.invalid/', immutableCache: new MemoryByteCache(), rootCache: new MemoryByteCache(),
    workerClient: { decode: (reference, data) => verifyChunkAssetWeb(reference, data) },
    fetchImpl: async url => {
      const resolved = new URL(url), file = path.resolve(output, `.${resolved.pathname}`), relative = path.relative(output, file);
      if (resolved.origin !== 'https://tortuna-validation.invalid' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Validation asset leaves its published directory');
      return new Response(await readFile(file), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });
    } });
  const retained = new Map(), controls = [];
  try {
    for (const hole of model.holes) for (const [kind, point] of [['tee', hole.tees.marks[Math.min(1, hole.tees.marks.length - 1)].c], ['green', hole.pin]]) {
      const [e, n] = projected(point);
      const tile = ground.tiles.find(tile => tile.lod === 0 && e >= tile.bounds.minEasting && e <= tile.bounds.maxEasting && n >= tile.bounds.minNorthing && n <= tile.bounds.maxNorthing);
      if (!tile) throw new Error(`Tortuna hole ${hole.n} ${kind} leaves finest terrain`);
      let resource = retained.get(tile.id);
      if (!resource) {
        const decoded = await loader.request(tile.layers.terrain, { scope: 'tortuna-native-validation' });
        resource = createTerrainRenderResource({ tileId: tile.id, decoded, frame: ground.frame, lazyRenderData: true });
        retained.set(tile.id, resource);
      }
      const publishedHeight = sampleTerrainRenderResource(resource, ...point) + ground.frame.origin.heightRH2000;
      const sourceHeight = nativeHeight(...point), differenceMetres = Math.abs(publishedHeight - sourceHeight);
      if (!Number.isFinite(differenceMetres) || differenceMetres > 0.005000001) throw new Error(`Tortuna hole ${hole.n} ${kind} exceeds 1 cm encoding half-step: ${differenceMetres}`);
      controls.push({ hole: hole.n, kind, coordinateEpsg3006: [e, n], tileId: tile.id, sourceHeightRH2000: sourceHeight, publishedHeightRH2000: publishedHeight, differenceMetres });
    }
  } finally { loader.dispose(); }
  if (controls.length !== 36) throw new Error('Tortuna native validation requires 36 tee/green controls');
  const report = { schemaVersion: 1, groundId: 'tortuna', state: 'passed', method: 'runtime-verified-asset-loader-and-render-resource-sampler-versus-native-DTM-bilinear-controls', sourceSha256: CONFIG.sourceFloat32Sha256,
    frameFingerprint: ground.frame.fingerprint, groundManifest: course.groundManifest, controlCount: controls.length, loadedTiles: retained.size,
    maximumDifferenceMetres: Math.max(...controls.map(control => control.differenceMetres)), toleranceMetres: 0.005000001,
    interpretation: 'Encoding consistency only; source-derived references are not independent positional accuracy controls.', controls };
  await writeFile(path.join(root, 'tortunabuild/mapping/native-terrain-validation.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkNativeTerrain().then(report => console.log(JSON.stringify({ controls: report.controlCount, maximumDifferenceMetres: report.maximumDifferenceMetres, state: report.state }))).catch(error => { console.error(error); process.exitCode = 1; });
