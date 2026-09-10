#!/usr/bin/env node
/* Compile measured 4m stand fields for the Lidingö terrain lattice.
   Does not create individual objects or publish a runtime root.

   node packages/course-v2/vegetation/compile-lidingo-stands.mjs
   Requires lidingobuild/mapping/playing-surfaces.geojson (EPSG:3006). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readChunk } from '../chunk-node.mjs';
import { voidMask } from './canopy-fields.mjs';
import { compileStandChunks, readRawRaster } from './compile-vegetation.mjs';
import { lidingoExclusionFeatures, lidingoExclusionMask, excludeInvalidLidingoCanopy } from './lidingo-stand-exclusions.mjs';
import { LIDINGO_CANOPY_CONFIG as CONFIG } from '../../course-geo/copc-reader/lidingo-canopy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'lidingobuild/cache/vegetation/stands-stage');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = relative => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
const input = relative => ({ path: relative, sha256: sha256(fs.readFileSync(path.join(ROOT, relative))) });

export function assertLidingoStandSourceHashes(index, readSource) {
  const expected = new Set(['lidingobuild/mapping/playing-surfaces.geojson',
    'lidingobuild/mapping/facilities.geojson',
    'lidingobuild/mapping/infrastructure.geojson',
    'geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson',
    'geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson',
    'geo_data/course-v2/lidingo/mapping/water-breakgeometry-epsg3006.geojson']);
  if (index.inputs?.length !== expected.size || new Set(index.inputs.map(source => source.path)).size !== expected.size ||
      index.inputs.some(source => !expected.has(source.path))) throw new Error('Lidingö stand exclusion source inventory is incomplete');
  for (const source of index.inputs) {
    if (sha256(readSource(source.path)) !== source.sha256) {
      throw new Error(`Lidingö stand exclusions changed at ${source.path}; explicitly rebuild compile-lidingo-stands.mjs`);
    }
  }
  for (const source of [index.canopySource, index.groundSource]) {
    if (!source || sha256(readSource(source.data)) !== source.sha256) throw new Error('Lidingö canopy/ground source changed after stand compilation');
  }
}

/** Attach an already compiled generation; source changes require an explicit
    stand rebuild, never silent adoption inside the ground graph compiler. */
export async function attachLidingoStands(compilation, frame) {
  const indexPath = path.join(OUT, 'layer-index.json');
  if (!fs.existsSync(indexPath)) throw new Error('Lidingö stand stage is missing; run compile-lidingo-stands.mjs first');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  if (compilation.groundId !== CONFIG.groundId || index.groundId !== CONFIG.groundId ||
      index.frameFingerprint !== frame.fingerprint || index.campaignId !== CONFIG.campaignId ||
      index.state !== 'provisional-measured-stand-fields') throw new Error('Lidingö stand stage identity or frame differs');
  assertLidingoStandSourceHashes(index, sourcePath => fs.readFileSync(path.join(ROOT, sourcePath)));
  const expectedTiles = new Set(compilation.tiles.filter(tile => tile.lod === 0).map(tile => tile.id));
  const actualTiles = Object.keys(index.standLayers);
  if (actualTiles.length !== expectedTiles.size || actualTiles.some(id => !expectedTiles.has(id))) {
    throw new Error('Lidingö stand stage does not cover exactly the finest terrain tile set');
  }
  const resources = new Map(compilation.resources);
  for (const [tileId, reference] of Object.entries(index.standLayers)) {
    const file = path.resolve(ROOT, index.resourceRoot, reference.url);
    if (!file.startsWith(`${path.resolve(OUT)}${path.sep}`)) throw new Error('Stand resource path leaves the retained stage');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== reference.bytes || sha256(bytes) !== reference.sha256) throw new Error(`Stand resource identity differs at ${tileId}`);
    const chunk = readChunk(bytes);
    if (chunk.header.id !== tileId || chunk.header.kind !== 'stands' || chunk.header.owner.id !== CONFIG.groundId) {
      throw new Error(`Stand resource ownership differs at ${tileId}`);
    }
    const tile = compilation.tiles.find(entry => entry.id === tileId);
    if (JSON.stringify(chunk.header.bounds) !== JSON.stringify(tile.bounds)) {
      for (const [field, value] of Object.entries(tile.bounds)) {
        if (chunk.header.bounds[field] !== value) throw new Error(`Stand bounds differ at ${tileId}.${field}`);
      }
    }
    const existing = resources.get(reference.url);
    if (existing && !Buffer.from(existing).equals(bytes)) throw new Error('Stand resource collides with an existing terrain resource');
    resources.set(reference.url, bytes);
  }
  return Object.freeze({ ...compilation, resources, tiles: Object.freeze(compilation.tiles.map(tile =>
    Object.freeze({ ...tile, layers: Object.freeze({ ...tile.layers, stands: index.standLayers[tile.id] ?? null }) }))) });
}

export function compileLidingoStands() {
  const evidence = json('geo_data/course-v2/lidingo/vegetation/canopy-evidence.json');
  const campaign = evidence.campaigns.find(entry => entry.campaignId === CONFIG.campaignId);
  if (evidence.state !== 'canopy-rasters-built' || campaign?.tiles !== 64) throw new Error('Complete Lidingö canopy evidence is required');
  const source = campaign.files.chm;
  if (sha256(fs.readFileSync(path.join(ROOT, source.data))) !== source.sha256) throw new Error('CHM differs from canopy evidence');
  const sidecar = json(source.sidecar);
  if (sidecar.width !== CONFIG.width || sidecar.height !== CONFIG.height ||
      sidecar.originEasting !== CONFIG.originEasting || sidecar.originNorthing !== CONFIG.originNorthing ||
      sidecar.sampleSpacingMetres !== 1 || sidecar.campaignId !== CONFIG.campaignId) throw new Error('Lidingö canopy lattice or campaign drifted');
  const raster = readRawRaster(path.join(ROOT, source.data), path.join(ROOT, source.sidecar));
  const groundSource = campaign.files.ground;
  if (sha256(fs.readFileSync(path.join(ROOT, groundSource.data))) !== groundSource.sha256) throw new Error('Cloud ground differs from canopy evidence');
  const cloudGround = readRawRaster(path.join(ROOT, groundSource.data), path.join(ROOT, groundSource.sidecar));
  if (cloudGround.width !== raster.width || cloudGround.height !== raster.height ||
      cloudGround.originEasting !== raster.originEasting || cloudGround.originNorthing !== raster.originNorthing ||
      cloudGround.sampleSpacingMetres !== raster.sampleSpacingMetres) throw new Error('Cloud ground and canopy lattices differ');
  const previewReport = json('geo_data/course-v2/lidingo/acquisition/terrain-compile.json');
  const previewPath = previewReport.preview.path;
  const previewBytes = fs.readFileSync(path.join(ROOT, previewPath));
  if (sha256(previewBytes) !== previewReport.preview.sha256) throw new Error('Terrain preview identity drifted');
  const preview = JSON.parse(previewBytes);
  if (preview.frame.fingerprint !== sidecar.frameFingerprint || preview.frame.fingerprint !== evidence.frameFingerprint) throw new Error('Lidingö terrain and canopy frames differ');
  const resourceRoot = path.dirname(path.join(ROOT, previewPath));
  const tiles = preview.tiles.map(tile => {
    const bytes = fs.readFileSync(path.join(resourceRoot, tile.reference.url));
    if (sha256(bytes) !== tile.reference.sha256) throw new Error(`Terrain tile identity drifted at ${tile.id}`);
    const decoded = readChunk(bytes);
    return { id: tile.id, lod: 0, bounds: decoded.header.bounds };
  });
  if (tiles.length !== 64) throw new Error('All64finest terrain tiles are required');
  const paths = ['lidingobuild/mapping/playing-surfaces.geojson',
    'lidingobuild/mapping/facilities.geojson',
    'lidingobuild/mapping/infrastructure.geojson',
    'geo_data/course-v2/lidingo/reference/osm-golf-epsg3006.geojson',
    'geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson',
    'geo_data/course-v2/lidingo/mapping/water-breakgeometry-epsg3006.geojson'];
  const features = lidingoExclusionFeatures(paths.map(json));
  const exclusions = lidingoExclusionMask(raster, features);
  const validity = excludeInvalidLidingoCanopy(exclusions.mask, raster.values, cloudGround.values);
  exclusions.excludedCells += validity.excludedAdditionalCells;
  exclusions.excludedFraction = exclusions.excludedCells / raster.values.length;
  const compiled = compileStandChunks({ groundId: CONFIG.groundId, tiles,
    campaignFields: [{ campaignId: CONFIG.campaignId, extent: CONFIG.sourceBounds, raster,
      voids: voidMask(raster), excludeMask: exclusions.mask, north: 0 }], cellMetres: 4, canopyThresholdMetres: 2 });
  const assets = [];
  for (const chunk of compiled.chunks) {
    readChunk(chunk.bytes);
    const output = path.join(OUT, chunk.reference.url);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    if (fs.existsSync(output) && !fs.readFileSync(output).equals(Buffer.from(chunk.bytes))) throw new Error('Refusing a stand content-address collision');
    fs.writeFileSync(output, chunk.bytes);
    assets.push({ tileId: chunk.tileId, reference: chunk.reference, inspection: chunk.inspection });
  }
  const layerIndex = { schemaVersion: 1, groundId: CONFIG.groundId, frameFingerprint: preview.frame.fingerprint,
    state: 'provisional-measured-stand-fields', campaignId: CONFIG.campaignId, capturedAt: '2021-03-23',
    resourceRoot: path.relative(ROOT, OUT).split(path.sep).join('/'),
    standLayers: Object.fromEntries(compiled.layers), objectLayers: {}, inputs: paths.map(input),
    canopySource: { ...source }, groundSource: { ...groundSource }, assets };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'layer-index.json'), `${JSON.stringify(layerIndex, null, 2)}\n`);
  const totals = assets.reduce((sum, asset) => ({ tiles: sum.tiles + 1,
    encodedBytes: sum.encodedBytes + asset.reference.bytes,
    measuredCells: sum.measuredCells + asset.inspection.measuredCells,
    closedCanopyCells: sum.closedCanopyCells + asset.inspection.closedCanopyCells,
    excludedCells: sum.excludedCells + asset.inspection.excludedCells }),
  { tiles: 0, encodedBytes: 0, measuredCells: 0, closedCanopyCells: 0, excludedCells: 0 });
  const report = { schemaVersion: 1, groundId: CONFIG.groundId, state: layerIndex.state,
    observedOn: new Date().toISOString().slice(0, 10), frameFingerprint: preview.frame.fingerprint,
    campaignId: CONFIG.campaignId, capturedAt: layerIndex.capturedAt, sourceEvidence: 'geo_data/course-v2/lidingo/vegetation/canopy-evidence.json',
    canopySource: source, inputs: layerIndex.inputs, cellMetres: 4, canopyThresholdMetres: 2,
    stands: totals, individualObjectRecords: 0,
    exclusions: { features: features.length, cells: exclusions.excludedCells,
      fraction: exclusions.excludedFraction, byKind: exclusions.counts, buffers: exclusions.defaultBuffers, sourceValidity: validity },
    uncertainty: { treeStemPositions: 'not-measured-no-individual-records', captureDate: '2021-03-23',
      currentPresence: 'stand edges not fully reviewed; tee exclusions include the 2025 orthophoto review', canopyHorizontalAccuracyMetres: null,
      canopyVerticalAccuracyMetres: null, sourcePulseDensityPerSquareMetre: campaign.totals.pulseDensityPerSquareMetre,
      measuredAreaRepresentation: 'canopy fraction and height statistics in4m cells; representative rendering only',
      negativeGroundPolicy: 'Negative RH2000 elevations can be valid terrain; this vegetation generation conservatively excludes such cells, as well as unknown ground, from planting.' },
    layerIndex: input(path.relative(ROOT, path.join(OUT, 'layer-index.json')).split(path.sep).join('/')),
    limitations: ['Stand cells encode measured canopy fraction and heights; rendered representatives are not individually positioned surveyed trees.',
      'The 2021 scan uses mixed 2019 municipal, reviewed 2025 tee and supplementary OSM exclusions; other current surface and stand edges still need review.',
      'No individual crown records or procedural large-object claims were added.',
      'Polygon holes are preserved before applying documented exclusion buffer bands.'],
  };
  fs.writeFileSync(path.join(ROOT, 'geo_data/course-v2/lidingo/vegetation/stand-evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...totals, individualObjectRecords: 0, excludedCells1m: exclusions.excludedCells,
    layerIndex: report.layerIndex.path, evidence: 'geo_data/course-v2/lidingo/vegetation/stand-evidence.json' }, null, 2));
  return layerIndex;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { compileLidingoStands(); } catch (error) { console.error(`Lidingö stand compilation failed: ${error.message}`); process.exitCode = 1; }
}
