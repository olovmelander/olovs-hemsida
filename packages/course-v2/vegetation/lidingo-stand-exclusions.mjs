/* Convert Lidingö's geographic intake to the vegetation exclusion grid.
   Polygon holes remain holes; roads stay linear exclusion bands. Buffers
   are compiler defaults and are not claims about physical object widths. */
import { assertRaster, distanceToCells } from './canopy-fields.mjs';
import { EXCLUSION_REASONS, rasterizeLine, rasterizeRing, reasonForKind } from './semantic-exclusions.mjs';

const SURFACE_KINDS = new Set(['green', 'tee', 'fairway', 'bunker']);
const NON_VEGETATION_ROADS = new Set(['footway', 'path', 'track', 'steps', 'cycleway', 'bridleway']);

export function excludeInvalidLidingoCanopy(mask, heights, ground, { minimumVegetationGroundRH2000 = 0 } = {}) {
  if (!(mask instanceof Uint8Array) || !(heights instanceof Float32Array) ||
      !(ground instanceof Float32Array) || mask.length !== heights.length || heights.length !== ground.length) {
    throw new Error('Lidingö validity masks must match canopy and ground raster dimensions');
  }
  const counts = { invalidCanopyCells: 0, unknownGroundCells: 0,
    belowVegetationElevationThresholdCells: 0, minimumVegetationGroundRH2000, excludedAdditionalCells: 0 };
  for (let index = 0; index < mask.length; index++) {
    const canopyInvalid = !Number.isFinite(heights[index]) || heights[index] < 0;
    const groundUnknown = !Number.isFinite(ground[index]);
    const belowThreshold = !groundUnknown && ground[index] < minimumVegetationGroundRH2000;
    if (canopyInvalid) counts.invalidCanopyCells++;
    if (groundUnknown) counts.unknownGroundCells++;
    if (belowThreshold) counts.belowVegetationElevationThresholdCells++;
    if (canopyInvalid || groundUnknown || belowThreshold) {
      if (!mask[index]) counts.excludedAdditionalCells++;
      mask[index] = 1;
    }
  }
  return counts;
}

export function lidingoExclusionFeatures(collections) {
  const features = [];
  for (const collection of collections) {
    if (collection?.type !== 'FeatureCollection' || collection.crs?.properties?.name !== 'EPSG:3006') {
      throw new Error('Lidingö stand exclusions require explicit EPSG:3006 GeoJSON');
    }
    for (const feature of collection.features) {
      const properties = feature.properties || {};
      const tags = properties.tags || {};
      let kind = SURFACE_KINDS.has(properties.kind) ? properties.kind : null;
      if (!kind && ['practice_green', 'range_field', 'range_tee_pad'].includes(properties.kind)) kind = 'practice';
      if (!kind && properties.kind === 'paved_path') kind = 'path';
      if (!kind && properties.kind === 'path') kind = 'path';
      if (!kind && properties.kind === 'parking') kind = 'road';
      if (!kind && properties.kind === 'flattened-water-surface') kind = 'water';
      /* an explicit exclusion polygon with no class of its own: a clear-fell read off newer imagery
         than the laser (Tortuna's mapping/canopy-changes-2026.geojson); reason code 14, no buffer */
      if (!kind && properties.kind === 'override') kind = 'override';
      if (!kind && tags.building && tags.building !== 'no') kind = 'building';
      if (!kind && tags.natural === 'water') kind = 'water';
      if (!kind && SURFACE_KINDS.has(tags.golf)) kind = tags.golf;
      if (!kind && ['driving_range', 'driving_range_tee'].includes(tags.golf)) kind = 'practice';
      if (!kind && (tags.golf === 'path' || NON_VEGETATION_ROADS.has(tags.highway))) kind = 'path';
      if (!kind && (tags.highway || tags.amenity === 'parking')) kind = 'road';
      if (!kind && tags.railway === 'rail') kind = 'railway';
      if (!kind && tags.waterway) kind = 'stream';
      if (!kind) continue;
      const geometry = feature.geometry;
      const record = { id: String(feature.id ?? properties.id ?? properties.osmId ?? features.length), kind,
        sourceId: properties.sourceId ?? null, polygons: [], lines: [] };
      if (geometry?.type === 'Polygon') record.polygons = [geometry.coordinates];
      else if (geometry?.type === 'MultiPolygon') record.polygons = geometry.coordinates;
      else if (geometry?.type === 'LineString') record.lines = [geometry.coordinates];
      else if (geometry?.type === 'MultiLineString') record.lines = geometry.coordinates;
      else throw new Error(`Unsupported ${kind} exclusion geometry ${geometry?.type}`);
      const xy = point => {
        if (!Array.isArray(point) || ![2, 3].includes(point.length) || !point.every(Number.isFinite)) {
          throw new Error(`Invalid projected exclusion coordinate ${record.id}`);
        }
        return [point[0], point[1]];
      };
      record.polygons = record.polygons.map(rings => rings.map(ring => ring.map(xy)));
      record.lines = record.lines.map(line => line.map(xy));
      features.push(record);
    }
  }
  return features;
}

function insideRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function lidingoExclusionMask(raster, features) {
  assertRaster(raster);
  const byKind = new Map();
  for (const feature of features) {
    const reason = reasonForKind(feature.kind);
    if (!byKind.has(feature.kind)) byKind.set(feature.kind, { reason, features: [] });
    byKind.get(feature.kind).features.push(feature);
  }
  const mask = new Uint8Array(raster.values.length);
  const counts = {};
  for (const [kind, group] of [...byKind].sort((a, b) => a[1].reason.code - b[1].reason.code)) {
    const cells = new Uint8Array(mask.length);
    for (const feature of group.features) {
      for (const rings of feature.polygons) {
        if (!rings.length || rings.some(ring => ring.length < 4 ||
          ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1] || ring.some(point =>
          !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)))) {
          throw new Error(`Invalid exclusion polygon ${feature.id}`);
        }
        const holes = rings.slice(1);
        rasterizeRing(raster, rings[0], cells, holes.length ? (_index, column, row) => {
          const x = raster.originEasting + (column + 0.5) * raster.sampleSpacingMetres;
          const y = raster.originNorthing - (row + 0.5) * raster.sampleSpacingMetres;
          return !holes.some(hole => insideRing(x, y, hole));
        } : null);
      }
      for (const line of feature.lines) {
        if (line.length < 2 || line.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite))) {
          throw new Error(`Invalid exclusion line ${feature.id}`);
        }
        rasterizeLine(raster, line, cells);
      }
    }
    const radius = group.reason.bufferMetres / raster.sampleSpacingMetres;
    const distances = radius > 0 ? distanceToCells(raster.width, raster.height, i => cells[i] === 1) : null;
    let count = 0;
    for (let index = 0; index < mask.length; index++) {
      if (distances ? distances[index] <= radius : cells[index]) { mask[index] = 1; count++; }
    }
    counts[kind] = { features: group.features.length, excludedCells: count, bufferMetres: group.reason.bufferMetres };
  }
  const excludedCells = mask.reduce((sum, value) => sum + value, 0);
  return { mask, counts, excludedCells, excludedFraction: excludedCells / mask.length,
    defaultBuffers: EXCLUSION_REASONS.filter(reason => byKind.has(reason.kind)) };
}
