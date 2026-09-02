/* Stage 5 of the vegetation plan: where a tree candidate cannot be.

   The course geometry the model already knows -- greens, tees, fairways,
   bunkers, paths and roads, water and its shore band, buildings, the
   railway, power corridors, farmland -- is rasterised onto the canopy grid
   as one exclusion mask with a reason per cell. Every rejection the compiler
   makes therefore has a machine-readable cause, and the buffers are stated
   here, once, as numbers. Exclusions remove FALSE candidates; the plan sends
   a real reviewed tree that a provisional polygon overlaps to review rather
   than erasing it, which is why the mask is applied to candidates before
   review and never to approved records.                                       */
import { assertRaster, distanceToCells } from './canopy-fields.mjs';

/* reason codes in priority order: the lowest code wins where classes overlap */
export const EXCLUSION_REASONS = Object.freeze([
  { code: 1, kind: 'building', bufferMetres: 6 },
  { code: 2, kind: 'water', bufferMetres: 3 },
  { code: 3, kind: 'green', bufferMetres: 2 },
  { code: 4, kind: 'tee', bufferMetres: 2 },
  { code: 5, kind: 'bunker', bufferMetres: 2 },
  { code: 6, kind: 'fairway', bufferMetres: 1 },
  { code: 7, kind: 'practice', bufferMetres: 1 },
  { code: 8, kind: 'road', bufferMetres: 5 },
  { code: 9, kind: 'railway', bufferMetres: 8 },
  { code: 10, kind: 'path', bufferMetres: 3 },
  { code: 11, kind: 'stream', bufferMetres: 0 },
  { code: 12, kind: 'power-corridor', bufferMetres: 14 },
  { code: 13, kind: 'farmland', bufferMetres: 0 },
  { code: 14, kind: 'override', bufferMetres: 0 },
]);

const REASON_BY_KIND = new Map(EXCLUSION_REASONS.map(reason => [reason.kind, reason]));

export function reasonForKind(kind) {
  const reason = REASON_BY_KIND.get(kind);
  if (!reason) throw new Error(`unknown exclusion kind ${JSON.stringify(kind)}`);
  return reason;
}

/** Even-odd scanline fill of a ring (EPSG:3006 [easting, northing] pairs) into `target` (1 = inside). */
export function rasterizeRing(raster, ring, target) {
  assertRaster(raster);
  const { width, height, sampleSpacingMetres, originEasting, originNorthing } = raster;
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const xs = ring.map(point => (point[0] - originEasting) / sampleSpacingMetres);
  const ys = ring.map(point => (originNorthing - point[1]) / sampleSpacingMetres);
  const minRow = Math.max(0, Math.floor(Math.min(...ys)));
  const maxRow = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  let filled = 0;
  for (let row = minRow; row <= maxRow; row++) {
    const y = row + 0.5;
    const crossings = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ys[i];
      const yj = ys[j];
      if ((yi > y) === (yj > y)) continue;
      crossings.push(xs[i] + ((y - yi) * (xs[j] - xs[i])) / (yj - yi));
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
      const to = Math.min(width - 1, Math.floor(crossings[k + 1] - 0.5));
      for (let column = from; column <= to; column++) {
        const index = row * width + column;
        if (!target[index]) { target[index] = 1; filled++; }
      }
    }
  }
  return filled;
}

/** Mark every cell a polyline passes through (sampled at half-cell steps). */
export function rasterizeLine(raster, line, target) {
  assertRaster(raster);
  const { width, height, sampleSpacingMetres, originEasting, originNorthing } = raster;
  let marked = 0;
  const mark = (x, y) => {
    const column = Math.floor(x);
    const row = Math.floor(y);
    if (column < 0 || row < 0 || column >= width || row >= height) return;
    const index = row * width + column;
    if (!target[index]) { target[index] = 1; marked++; }
  };
  for (let i = 0; i + 1 < line.length; i++) {
    const x0 = (line[i][0] - originEasting) / sampleSpacingMetres;
    const y0 = (originNorthing - line[i][1]) / sampleSpacingMetres;
    const x1 = (line[i + 1][0] - originEasting) / sampleSpacingMetres;
    const y1 = (originNorthing - line[i + 1][1]) / sampleSpacingMetres;
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      mark(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    }
  }
  return marked;
}

/**
 * Build the exclusion mask. `features` is [{ kind, rings?, lines?,
 * bufferMetres? (overrides the class default), lineWidthMetres? }]. All
 * features of a class are rasterised together and dilated once by the class
 * buffer through the exact distance transform, so a thousand bunkers cost
 * one transform, not a thousand.
 */
export function rasterizeExclusions(raster, features) {
  assertRaster(raster);
  const { width, height, sampleSpacingMetres } = raster;
  const size = width * height;
  const mask = new Uint8Array(size);
  const reason = new Uint8Array(size);
  const counts = {};
  const byClass = new Map();
  for (const feature of features) {
    const base = reasonForKind(feature.kind);
    const buffer = Number.isFinite(feature.bufferMetres) ? feature.bufferMetres : base.bufferMetres;
    const halfWidth = Number.isFinite(feature.lineWidthMetres) ? feature.lineWidthMetres / 2 : 0;
    const key = `${feature.kind}:${buffer + halfWidth}`;
    if (!byClass.has(key)) byClass.set(key, { code: base.code, kind: feature.kind, dilateMetres: buffer + halfWidth, cells: new Uint8Array(size), features: 0 });
    const entry = byClass.get(key);
    entry.features++;
    for (const ring of feature.rings || []) rasterizeRing(raster, ring, entry.cells);
    for (const line of feature.lines || []) rasterizeLine(raster, line, entry.cells);
  }
  /* lowest code first, so a higher-priority class keeps its reason */
  const classes = [...byClass.values()].sort((left, right) => left.code - right.code);
  for (const entry of classes) {
    let any = false;
    for (let i = 0; i < size; i++) if (entry.cells[i]) { any = true; break; }
    if (!any) { counts[entry.kind] = (counts[entry.kind] || 0); continue; }
    const radiusCells = entry.dilateMetres / sampleSpacingMetres;
    const distance = radiusCells > 0 ? distanceToCells(width, height, i => entry.cells[i] === 1) : null;
    let cells = 0;
    for (let i = 0; i < size; i++) {
      const inside = distance ? distance[i] <= radiusCells + 1e-9 : entry.cells[i] === 1;
      if (!inside) continue;
      cells++;
      if (!mask[i]) { mask[i] = 1; reason[i] = entry.code; }
    }
    counts[entry.kind] = (counts[entry.kind] || 0) + cells;
  }
  let excluded = 0;
  for (let i = 0; i < size; i++) excluded += mask[i];
  return Object.freeze({
    mask,
    reason,
    excludedCells: excluded,
    excludedFraction: Math.round((excluded / size) * 1e6) / 1e6,
    cellsByKind: counts,
    legend: Object.fromEntries(EXCLUSION_REASONS.map(entry => [entry.code, entry.kind])),
  });
}

/**
 * The Puttom model's collections mapped onto the exclusion classes. The
 * model is the committed EPSG:3006 migration model, so nothing here needs
 * PROJ. Half-widths for lines follow the planter's own numbers where it has
 * them (a stream is excluded to three times its width, a 130 kV corridor to
 * 14 m) and the class defaults elsewhere.
 */
export function courseExclusionFeatures(geometry) {
  const features = [];
  const rings = (kind, list, extra = {}) => {
    const valid = (list || []).filter(ring => Array.isArray(ring) && ring.length >= 3);
    if (valid.length) features.push({ kind, rings: valid, ...extra });
  };
  const lines = (kind, list, extra = {}) => {
    const valid = (list || []).filter(line => Array.isArray(line) && line.length >= 2);
    if (valid.length) features.push({ kind, lines: valid, ...extra });
  };
  const holes = geometry.holes || [];
  rings('green', holes.map(hole => hole.green?.ring));
  rings('fairway', holes.flatMap(hole => hole.fairway?.rings || []));
  rings('tee', holes.flatMap(hole => (hole.tees?.pads || []).map(pad => pad.ring)));
  rings('bunker', holes.flatMap(hole => (hole.bunkers || []).map(bunker => bunker.ring)));
  rings('practice', [...(geometry.scenery?.greens || []), ...(geometry.scenery?.fairways || []), ...(geometry.scenery?.tees || [])]);
  /* the range is a list of rings in the migrated model and a single ring in
     older ones; passing a list as a ring rasterised nothing and put trees on
     the driving range, which the first published generation showed */
  const range = geometry.scenery?.range;
  if (Array.isArray(range) && range.length) {
    const rangeRings = Array.isArray(range[0]?.[0]) ? range : [range];
    rings('practice', rangeRings, { bufferMetres: 0 });
  }
  rings('water', (geometry.water || []).map(body => body.ring));
  for (const stream of geometry.streams || []) {
    if (Array.isArray(stream.line) && stream.line.length >= 2) {
      features.push({ kind: 'stream', lines: [stream.line], lineWidthMetres: (stream.w || 1) * 6 });
    }
  }
  const infra = geometry.infra || {};
  rings('building', (infra.buildings || []).map(building => building.ring));
  lines('road', (infra.roads || []).map(road => road.line));
  lines('path', [...(infra.paths || []), ...(infra.tracks || [])].map(path => path.line));
  lines('railway', (infra.railway || []).map(rail => rail.line));
  lines('power-corridor', ((infra.power?.lines) || []).filter(line => (line.voltage || 0) >= 100000).map(line => line.line));
  rings('farmland', (infra.landuse || []).filter(area => area.kind === 'farmland' || area.kind === 'farmyard').map(area => area.ring));
  return features;
}
