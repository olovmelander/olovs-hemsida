/* Measured 2021 canopy fields, with explicit 2026 playing/facility exclusions
 * and the 2026 clear-fells taken out (mapping/canopy-changes-2026.geojson: the
 * orthophoto is five years newer than the laser, and removal needs only the
 * newer picture; nothing is added from it).
 * A stand cell is a representative canopy field, never a surveyed tree stem. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readChunk } from '../../../../packages/course-v2/chunk-node.mjs';
import { compileStandChunks, readRawRaster } from '../../../../packages/course-v2/vegetation/compile-vegetation.mjs';
import { createRaster, voidMask, distanceToCells } from '../../../../packages/course-v2/vegetation/canopy-fields.mjs';
import { lidingoExclusionFeatures, lidingoExclusionMask, excludeInvalidLidingoCanopy } from '../../../../packages/course-v2/vegetation/lidingo-stand-exclusions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT = 'tortunabuild/cache/vegetation/stands-stage';
const TERRAIN_STAGE = 'tortunabuild/cache/terrain-stage/terrain-compilation.json';
const EXPANDED_EVIDENCE = 'geo_data/course-v2/tortuna/vegetation/expanded-canopy-evidence.json';
const SOURCE_FILES = ['geo_data/course-v2/tortuna/vegetation/canopy-evidence.json',
  'tortunabuild/cache/canopy/chm.f32', 'tortunabuild/cache/canopy/chm.json',
  'tortunabuild/cache/canopy/ground.f32', 'tortunabuild/cache/canopy/ground.json', EXPANDED_EVIDENCE,
  'tortunabuild/cache/expanded-canopy/chm.f32', 'tortunabuild/cache/expanded-canopy/chm.json',
  'tortunabuild/cache/expanded-canopy/ground.f32', 'tortunabuild/cache/expanded-canopy/ground.json'];
const SOURCE_HASHES = Object.freeze({
  chm: 'f7648dd78beb6f34afc9a76702c64f6e72c5d444975f1677801bcb61c3d33e76',
  ground: 'c2b6e8626b87c12f2d4be314e6739ac82536351fa23c673eea2426eb6687fb05',
});
const EXPANDED_HASHES = Object.freeze({
  chm: '3384f3b455ae638ceebc76fb492ca113b3d7f364440f1aa0c468dce135a33033',
  ground: 'e0b9b263110c370e0014fee3182b3fed1ced9df5bad979c8ad9c5b60ad3b84ff',
});
const EXPANDED_EXTENT = Object.freeze([596120.5, 6613363.5, 598680.5, 6616435.5]);
const STAND_TILES = 120;
const INPUTS = ['tortunabuild/mapping/playing-surfaces.geojson', 'tortunabuild/mapping/facilities.geojson',
  'geo_data/course-v2/tortuna/reference/osm-context-epsg3006.geojson', 'geo_data/course-v2/tortuna/mapping/water-runtime-epsg3006.geojson',
  'tortunabuild/mapping/environment.geojson', 'tortunabuild/mapping/building-roof-envelopes.geojson',
  'tortunabuild/mapping/environment-context-extra.geojson',
  /* 2026: canopy the 2021 laser measured and the 2026-05-02 orthophoto shows felled (trace-canopy-changes.mjs) */
  'tortunabuild/mapping/canopy-changes-2026.geojson'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = p => fs.readFileSync(path.join(ROOT, p));
const json = p => JSON.parse(bytes(p));
const identity = p => ({ path: p, sha256: hash(bytes(p)) });
const write = (p, value) => { const file = path.join(ROOT, p); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };

export function assertTortunaCanopyEvidence(evidence, expanded = false) {
  const source = evidence?.source, asset = source?.assets?.data;
  const grid = expanded
    ? { minEasting: 596120.5, maxNorthing: 6616435.5, width: 2560, height: 3072, sampleSpacingMetres: 1 }
    : { minEasting: 596632.5, maxNorthing: 6616179.5, width: 1536, height: 2560, sampleSpacingMetres: 1 };
  if (evidence?.groundId !== 'tortuna' || evidence.state !== 'canopy-rasters-built' || evidence.tiles !== (expanded ? STAND_TILES : 60) ||
      source?.id !== '21c035-661_59' || source.projCode !== 'EPSG:5845' || source.capturedAt !== '2021-04-05T12:00:00Z' ||
      source.captureStart !== '2021-04-01T00:00:00Z' || source.captureEnd !== '2021-04-10T00:00:00Z' ||
      asset?.sha256 !== '4354289e6e6e5c0e42188f62bda0400997e121704dc85a98d88e68b231508b45' || asset.bytes !== 930359431 ||
      asset.href !== 'https://dl1.lantmateriet.se/hojd/data/pointcloud/sls/21c035/m21c035-661_59.copc.laz' ||
      Object.entries(grid).some(([key, value]) => evidence.grid?.[key] !== value)) throw new Error('Pinned Tortuna canopy source evidence changed');
}

export function sourceRaster(source, expanded = false) {
  const sourceBytes = bytes(source.data);
  if (hash(sourceBytes) !== source.sha256) throw new Error('Tortuna canopy source bytes changed');
  const sidecar = json(source.sidecar);
  const layer = sidecar.layer;
  const pinned = expanded ? EXPANDED_HASHES : SOURCE_HASHES;
  if (!pinned[layer] || source.sha256 !== pinned[layer] || sidecar.format !== 'float32-le' || sidecar.noData !== null ||
      sidecar.measure !== (layer === 'chm' ? 'height-above-cloud-ground-metres' : 'RH2000-metres')) throw new Error('Pinned Tortuna canopy layer identity changed');
  if (sidecar.groundId !== 'tortuna' || sidecar.campaignId !== '21c035-661_59' ||
      sidecar.width !== (expanded ? 2560 : 1536) || sidecar.height !== (expanded ? 3072 : 2560) || sidecar.sampleSpacingMetres !== 1 ||
      sidecar.originEasting !== (expanded ? 596121 : 596633) || sidecar.originNorthing !== (expanded ? 6616435 : 6616179) ||
      !sidecar.coordinateMeaning?.startsWith('cell centres')) throw new Error('Tortuna canopy lattice changed');
  const raster = readRawRaster(path.join(ROOT, source.data), path.join(ROOT, source.sidecar));
  // The retained sidecar describes the first sample CENTRE. The shared canopy
  // compiler explicitly expects cell EDGES; normalize once, without resampling.
  return { ...createRaster({ ...raster, originEasting: raster.originEasting - .5, originNorthing: raster.originNorthing + .5 }), sourceBytes };
}

export function assertRetainedCanopy(original, expanded) {
  const spacing = original.sampleSpacingMetres;
  const column = (original.originEasting - expanded.originEasting) / spacing;
  const row = (expanded.originNorthing - original.originNorthing) / spacing;
  if (spacing !== expanded.sampleSpacingMetres || ![row, column].every(Number.isInteger) ||
      row < 0 || column < 0 || row + original.height > expanded.height || column + original.width > expanded.width) {
    throw new Error('Expanded canopy does not preserve the original lattice');
  }
  const oldBytes = original.sourceBytes ?? Buffer.from(original.values.buffer, original.values.byteOffset, original.values.byteLength);
  const newBytes = expanded.sourceBytes ?? Buffer.from(expanded.values.buffer, expanded.values.byteOffset, expanded.values.byteLength);
  if (oldBytes.length !== original.width * original.height * 4 || newBytes.length !== expanded.width * expanded.height * 4) {
    throw new Error('Canopy source byte length differs from lattice');
  }
  for (let r = 0; r < original.height; r++) {
    const oldOffset = r * original.width * 4;
    const newOffset = ((row + r) * expanded.width + column) * 4;
    if (!oldBytes.subarray(oldOffset, oldOffset + original.width * 4).equals(newBytes.subarray(newOffset, newOffset + original.width * 4))) {
      throw new Error(`Expanded canopy changed retained source bytes in row ${r}`);
    }
  }
  return { columnOffset: column, rowOffset: row, retainedSamples: original.values.length, exactBytes: true };
}

export function assertTortunaStandInputs(index, readSource = bytes) {
  if (index.inputs?.length !== INPUTS.length || new Set(index.inputs.map(s => s.path)).size !== INPUTS.length ||
      index.inputs.some(s => !INPUTS.includes(s.path))) throw new Error('Tortuna stand exclusion inventory changed');
  if (index.terrainStage?.path !== TERRAIN_STAGE || index.sourceFiles?.length !== SOURCE_FILES.length ||
      new Set(index.sourceFiles.map(s => s.path)).size !== SOURCE_FILES.length ||
      index.sourceFiles.some(s => !SOURCE_FILES.includes(s.path))) throw new Error('Tortuna stand source inventory changed');
  for (const source of [...index.inputs, index.terrainStage, ...index.sourceFiles]) {
    if (hash(readSource(source.path)) !== source.sha256) throw new Error(`Tortuna stand source changed: ${source.path}; rebuild stands explicitly`);
  }
}

export function compileTortunaStands() {
  const evidence = json('geo_data/course-v2/tortuna/vegetation/canopy-evidence.json');
  const expanded = json(EXPANDED_EVIDENCE);
  assertTortunaCanopyEvidence(evidence);
  assertTortunaCanopyEvidence(expanded, true);
  const raster = sourceRaster(expanded.files.chm, true), ground = sourceRaster(expanded.files.ground, true);
  const overlap = { chm: assertRetainedCanopy(sourceRaster(evidence.files.chm), raster),
    ground: assertRetainedCanopy(sourceRaster(evidence.files.ground), ground) };
  const stage = json(TERRAIN_STAGE);
  if (stage.groundId !== 'tortuna' || stage.sourceSha256 !== '86f30a75f398cfa2da8c32b833b859c575a9056910b237ac2539fdbba3c02ef1') throw new Error('Tortuna terrain stage changed');
  const tiles = stage.tiles.filter(t => t.lod === 0);
  const features = tortunaExclusionFeatures(INPUTS.map(json));
  const exclusions = lidingoExclusionMask(raster, features);
  const distances = distanceToCells(raster.width, raster.height, i => exclusions.mask[i] === 1);
  let guardCells = 0;
  for (let i = 0; i < distances.length; i++) if (distances[i] <= 4 && !exclusions.mask[i]) { exclusions.mask[i] = 1; guardCells++; }
  const validity = excludeInvalidLidingoCanopy(exclusions.mask, raster.values, ground.values);
  const extent = EXPANDED_EXTENT;
  const compiled = compileStandChunks({ groundId: 'tortuna', tiles, cellMetres: 4, canopyThresholdMetres: 2,
    campaignFields: [{ campaignId: evidence.source.id, extent, raster, voids: voidMask(raster), excludeMask: exclusions.mask, north: 0 }] });
  if (compiled.chunks.length !== STAND_TILES) throw new Error(`Expected exactly ${STAND_TILES} measured Tortuna stand tiles; got ${compiled.chunks.length}`);
  for (const chunk of compiled.chunks) {
    const file = path.join(ROOT, OUT, chunk.reference.url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && !fs.readFileSync(file).equals(Buffer.from(chunk.bytes))) throw new Error('Stand hash collision');
    fs.writeFileSync(file, chunk.bytes);
  }
  const sourceFiles = SOURCE_FILES.map(identity);
  const index = { schemaVersion: 1, groundId: 'tortuna', state: 'provisional-measured-stand-fields',
    frameFingerprint: stage.frame.fingerprint, campaignId: evidence.source.id, resourceRoot: OUT,
    inputs: INPUTS.map(identity), terrainStage: identity(TERRAIN_STAGE), sourceFiles,
    standLayers: Object.fromEntries(compiled.layers), assets: compiled.chunks.map(c => ({ tileId: c.tileId, reference: c.reference, inspection: c.inspection })) };
  assertTortunaStandInputs(index);
  write(`${OUT}/layer-index.json`, index);
  const report = { schemaVersion: 1, groundId: 'tortuna', state: index.state, frameFingerprint: stage.frame.fingerprint,
    campaignId: index.campaignId, observedOn: '2026-09-09', sourceCapture: evidence.source.capturedAt,
    fullSourceSha256Verified: false,
    inputs: index.inputs, sourceFiles, originalCanopyOverlap: overlap,
    sourceGrid: { width: 2560, height: 3072, sampleSpacingMetres: 1, extent,
      normalization: 'source centres shifted half a cell to compiler edge convention; values unchanged' },
    stands: { tiles: compiled.chunks.length, cellMetres: 4, encodedBytes: compiled.chunks.reduce((s,c) => s+c.reference.bytes, 0), individualStemRecords: 0 },
    exclusions: { byKind: exclusions.counts, runtimeJitterGuardMetres: 4, guardCells, validity },
    layerIndex: identity(`${OUT}/layer-index.json`),
    limitations: ['April 2021 canopy; present-day clearing and tree changes require further evidence.',
      'Representative stand positions/species are display choices, not individual stems or botanical observations.',
      'Unknown canopy cells remain unknown; no procedural forest fills missing source coverage.',
      '2026 mapped playing/facility footprints and national water exclude old canopy; source completeness remains provisional.',
      'All rendered stand bases use the same published terrain sampler as the course.'] };
  write('geo_data/course-v2/tortuna/vegetation/stand-evidence.json', report);
  console.log(JSON.stringify(report.stands));
  return index;
}

export function tortunaExclusionFeatures(collections) {
  return lidingoExclusionFeatures(collections.map(collection => ({ ...collection,
    features: collection.features.filter(feature => feature.properties?.canopyExclusion !== false).map(feature => {
      const properties = { ...feature.properties };
      if (properties.kind === 'range_target') properties.kind = 'practice_green';
      if (properties.kind === 'practice_bunker') properties.kind = 'bunker';
      if (properties.kind === 'range_mat') properties.kind = 'tee';
      if (properties.kind === 'range_shelter') properties.tags = { ...properties.tags, building: 'yes' };
      if (properties.kind === 'building_roof_envelope') properties.tags = { ...properties.tags, building: 'yes' };
      return { ...feature, properties };
    }) })));
}

export function attachTortunaStands(compilation, frame) {
  const index = json(`${OUT}/layer-index.json`);
  if (compilation.groundId !== 'tortuna' || index.groundId !== 'tortuna' || index.frameFingerprint !== frame.fingerprint ||
      index.state !== 'provisional-measured-stand-fields' || Object.keys(index.standLayers).length !== STAND_TILES) throw new Error('Tortuna stand identity differs');
  assertTortunaStandInputs(index);
  const resources = new Map(compilation.resources), tiles = new Map(compilation.tiles.map(t => [t.id, t]));
  for (const [id, reference] of Object.entries(index.standLayers)) {
    const tile = tiles.get(id);
    if (!tile || tile.lod !== 0) throw new Error('Stand has no finest terrain owner');
    const file = path.resolve(ROOT, OUT, reference.url);
    if (!file.startsWith(path.resolve(ROOT, OUT) + path.sep)) throw new Error('Stand reference leaves stage');
    const payload = fs.readFileSync(file), chunk = readChunk(payload);
    if (payload.length !== reference.bytes || hash(payload) !== reference.sha256 || chunk.header.id !== id ||
        chunk.header.kind !== 'stands' || chunk.header.owner.id !== 'tortuna') throw new Error('Tortuna stand bytes or ownership changed');
    for (const [key, value] of Object.entries(tile.bounds)) if (chunk.header.bounds[key] !== value) throw new Error('Tortuna stand terrain bounds differ');
    resources.set(reference.url, payload);
  }
  return { ...compilation, resources, tiles: compilation.tiles.map(t => ({ ...t, layers: { ...t.layers, stands: index.standLayers[t.id] ?? null } })) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) compileTortunaStands();
