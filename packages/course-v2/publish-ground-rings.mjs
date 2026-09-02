#!/usr/bin/env node
/* Publish the nested resolution rings as the ground graph: the course tiles
   and every layer on them stay byte for byte, the coarser levels are
   replaced by the rings, the course manifest and root move, and the previous
   generation stays on disk for rollback.

   node packages/course-v2/publish-ground-rings.mjs --ground puttom [--slug puttom] [--public apps/golf/public]

   Needs the ring rasters build-ground-rings.mjs left in the cache. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readChunk } from './chunk-node.mjs';
import { emitGroundGraph, writeGroundGraphFiles } from './emit-ground-graph-node.mjs';
import { decodeTerrainGrid } from './terrain-grid.mjs';
import { compileTerrainRings, createRingSampler } from './terrain-rings.mjs';
import { PUTTOM_GROUND_RINGS } from './puttom-ground-rings.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RINGS = { puttom: PUTTOM_GROUND_RINGS };

function flag(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

function migratedCourse(groundId) {
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, `geo_data/course-v2/${groundId}/migration/course-model.epsg3006.json`), 'utf8'));
  if (model.groundId !== groundId || !Array.isArray(model.geometry?.holes)) throw new Error('migration model is missing its hole geometry');
  const holes = [...model.geometry.holes].sort((left, right) => left.n - right.n).map((hole, index) => {
    if (hole.n !== index + 1) throw new Error(`migrated holes are not numbered 1.. at ${hole.n}`);
    return {
      number: hole.n, par: hole.par, strokeIndex: hole.idx, strokeIndexStatus: 'verified', accuracyTier: 'unrated',
      line: hole.line.map(([easting, northing]) => [easting, northing]),
    };
  });
  return holes;
}

function registerArtifact(manifestPath, artifact) {
  const text = fs.readFileSync(manifestPath, 'utf8').replace(/\r\n/g, '\n');
  const manifest = JSON.parse(text);
  const index = manifest.artifacts.findIndex(entry => entry.id === artifact.id);
  if (index >= 0) manifest.artifacts[index] = artifact; else manifest.artifacts.push(artifact);
  const out = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(manifestPath, out);
  return createHash('sha256').update(out).digest('hex');
}

async function main() {
  const groundId = flag('ground', 'puttom');
  const slug = flag('slug', groundId);
  const publicDir = path.resolve(ROOT, flag('public', 'apps/golf/public'));
  const spec = RINGS[groundId];
  if (!spec) throw new Error(`no ring specification for ground ${groundId}`);
  const cacheDir = path.resolve(ROOT, 'packages/course-geo/toolchain/.cache/acquisition', `${groundId}-ground-rings`);
  const evidencePath = path.resolve(ROOT, `geo_data/course-v2/${groundId}/acquisition/ground-rings.json`);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

  /* the published graph, whose course tiles and layers are carried over */
  const read = url => fs.readFileSync(path.join(publicDir, url));
  const root = JSON.parse(read('courses/v2-index.json').toString('utf8'));
  const rootEntry = root.courses.find(course => course.slug === slug);
  if (!rootEntry) throw new Error(`root index has no course ${slug}`);
  const courseManifest = JSON.parse(read(rootEntry.manifest.url).toString('utf8'));
  const groundManifest = JSON.parse(read(courseManifest.groundManifest.url).toString('utf8'));
  if (groundManifest.groundId !== groundId) throw new Error(`course ${slug} is on ground ${groundManifest.groundId}`);
  const publishedFinest = new Map(groundManifest.tiles.filter(tile => tile.lod === 0).map(tile => {
    const bytes = read(tile.layers.terrain.url);
    const chunk = readChunk(bytes);
    return [tile.id, { tile, chunk: bytes, reference: tile.layers.terrain, grid: chunk.header.grid, heights: decodeTerrainGrid(chunk.payload, chunk.header.grid) }];
  }));

  /* the rings */
  const levels = spec.levels.map(level => {
    const sidecar = JSON.parse(fs.readFileSync(path.join(cacheDir, `l${level.lod}.json`), 'utf8'));
    const bytes = fs.readFileSync(path.join(cacheDir, `l${level.lod}.f32`));
    const recorded = evidence.levels.find(entry => entry.lod === level.lod);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (!recorded || recorded.rasterSha256 !== sha256) throw new Error(`ring raster l${level.lod} is not the one the evidence recorded`);
    for (const key of ['sampleSpacingMetres', 'tilesPerSide', 'originEasting', 'originNorthing', 'heightScaleMetres']) {
      if (sidecar[key] !== level[key]) throw new Error(`ring raster l${level.lod} ${key} differs from the specification`);
    }
    return {
      lod: level.lod, sampleSpacingMetres: level.sampleSpacingMetres, originEasting: level.originEasting,
      originNorthing: level.originNorthing, tilesPerSide: level.tilesPerSide, heightScaleMetres: level.heightScaleMetres,
      heights: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    };
  });
  const compiled = compileTerrainRings({
    groundId, courseSlugs: spec.courseSlugs, levels, tileSegments: spec.tileSegments,
    reuse: (lod, column, row) => (lod === 0 ? publishedFinest.get(`l0/${column}/${row}`) ?? null : null),
  });
  if (compiled.stats.reusedTiles !== publishedFinest.size) {
    throw new Error(`reused ${compiled.stats.reusedTiles} course tiles; the published graph has ${publishedFinest.size}`);
  }

  /* carry every layer on the course tiles, and their bytes, into the graph */
  const resources = new Map(compiled.resources);
  const tiles = compiled.tiles.map(tile => {
    if (tile.lod !== 0) return tile;
    const published = publishedFinest.get(tile.id)?.tile;
    if (!published) throw new Error(`course tile ${tile.id} has no published counterpart`);
    if (published.layers.terrain.sha256 !== tile.layers.terrain.sha256) throw new Error(`course tile ${tile.id} terrain changed`);
    const layers = { terrain: tile.layers.terrain, surface: published.layers.surface ?? null, objects: published.layers.objects ?? null };
    if (published.layers.stands !== undefined) layers.stands = published.layers.stands;
    for (const kind of ['surface', 'objects', 'stands']) if (layers[kind]) resources.set(layers[kind].url, read(layers[kind].url));
    return { ...tile, layers: Object.freeze(layers) };
  });

  const manifestPath = path.join(ROOT, 'geo_data/course-v2', groundId, 'source-manifest.json');
  const sourceManifestSha256 = registerArtifact(manifestPath, {
    id: 'ground-rings',
    kind: 'acquisition',
    path: path.relative(ROOT, evidencePath).replaceAll('\\', '/'),
    sha256: createHash('sha256').update(fs.readFileSync(evidencePath, 'utf8').replace(/\r\n/g, '\n')).digest('hex'),
    derivedFrom: ['terrain-lm-1m'],
    /* the manifest schema knows two uses; this is evidence of what was read,
       the terrain product itself stays `planned` until its origin is approved */
    use: 'discovery-evidence',
    notes: 'Nested resolution rings read from the Markhöjdmodell dtm-cog items over authenticated range requests: 1 m over the course (asserted against the published tiles), 2 m subsampled to 1.5 km, and the averaged overviews at 4, 8, 16 and 32 m to a 16 km root. Item identities (ETag, size, date) and the transfer are recorded; no credential material is.',
  });

  const graph = emitGroundGraph({
    compilation: { groundId, courseSlugs: compiled.courseSlugs, bounds: compiled.bounds, shell: compiled.shell, tiles, resources },
    frame: groundManifest.frame,
    sourceManifestSha256,
    course: { slug, name: rootEntry.name, holes: migratedCourse(groundId) },
    /* the exact LIVE GPK1 manifest entry, never the previous root's copy: a
       course whose pack changed (new traces, a new card) re-binds here, and the
       runtime refuses a graph whose fallback is not the pack it can fetch */
    fallbackV1: liveFallback(read, slug, rootEntry.fallbackV1),
    heightAt: createRingSampler(levels),
  });
  const written = await writeGroundGraphFiles(publicDir, graph);
  const report = {
    ...graph.report,
    levels: compiled.stats.levels,
    reusedCourseTiles: compiled.stats.reusedTiles,
    reuseTies: compiled.stats.reuseTies,
    encodedBytes: compiled.stats.encodedBytes,
    previousGroundManifest: courseManifest.groundManifest.url,
    previousCourseManifest: rootEntry.manifest.url,
    filesWritten: written.length,
  };
  evidence.publish = { observedOn: new Date().toISOString().slice(0, 10), ...report };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  /* the artifact entry hashes the evidence file, so re-register after adding the publish block */
  registerArtifact(manifestPath, {
    ...JSON.parse(fs.readFileSync(manifestPath, 'utf8')).artifacts.find(entry => entry.id === 'ground-rings'),
    sha256: createHash('sha256').update(fs.readFileSync(evidencePath, 'utf8').replace(/\r\n/g, '\n')).digest('hex'),
  });
  console.log(JSON.stringify(report, null, 2));
}

await main();

/* The GPK1 entry the app will actually fetch, from the live course manifest. */
function liveFallback(read, slug, previous) {
  let manifest;
  try { manifest = JSON.parse(read('courses/index.json').toString('utf8')); } catch { return previous; }
  const entry = (manifest.courses || []).find(course => course.slug === slug);
  if (!entry?.sha256 || !Number.isSafeInteger(entry.bytes) || typeof entry.packUrl !== 'string') return previous;
  return { bytes: entry.bytes, format: 1, packUrl: entry.packUrl, sha256: entry.sha256 };
}
