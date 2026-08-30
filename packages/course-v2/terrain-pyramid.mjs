import { encodeTerrainGrid } from './terrain-grid.mjs';

const DEFAULT_TILE_SEGMENTS = 256;
const DEFAULT_HEIGHT_SCALE_METRES = 0.01;

function positiveInteger(value, label, minimum = 1, maximum = 16385) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function positiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite`);
  return value;
}

function sourceHeights(value, count) {
  if (!value || value.length !== count) throw new RangeError(`heights must contain ${count} samples`);
  const result = new Float64Array(count);
  let finiteCount = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < count; index++) {
    const height = value[index];
    if (Number.isNaN(height)) {
      result[index] = Number.NaN;
      continue;
    }
    if (!Number.isFinite(height)) throw new TypeError('height samples must be finite or NaN nodata');
    result[index] = height;
    finiteCount++;
    minimum = Math.min(minimum, height);
    maximum = Math.max(maximum, height);
  }
  if (!finiteCount) throw new Error('terrain source contains no finite height samples');
  return { values: result, finiteCount, minimum, maximum };
}

function downsampleByTwo(level) {
  if (level.width % 2 !== 1 || level.height % 2 !== 1) {
    throw new Error('terrain level dimensions must be odd before downsampling');
  }
  const width = (level.width + 1) / 2;
  const height = (level.height + 1) / 2;
  const values = new Float64Array(width * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      values[row * width + column] = level.values[(row * 2) * level.width + column * 2];
    }
  }
  return { width, height, values };
}

function sampleLevel(level, sourceColumn, sourceRow, factor) {
  const column = sourceColumn / factor;
  const row = sourceRow / factor;
  const left = Math.floor(column);
  const top = Math.floor(row);
  const right = Math.min(level.width - 1, left + 1);
  const bottom = Math.min(level.height - 1, top + 1);
  const x = column - left;
  const y = row - top;
  const northWest = level.values[top * level.width + left];
  const northEast = level.values[top * level.width + right];
  const southWest = level.values[bottom * level.width + left];
  const southEast = level.values[bottom * level.width + right];
  if ([northWest, northEast, southWest, southEast].some(Number.isNaN)) return Number.NaN;
  const north = northWest + (northEast - northWest) * x;
  const south = southWest + (southEast - southWest) * x;
  return north + (south - north) * y;
}

function tileGeometricError(master, level, factor, tileColumn, tileRow, tileSegments) {
  const startColumn = tileColumn * tileSegments * factor;
  const startRow = tileRow * tileSegments * factor;
  const endColumn = startColumn + tileSegments * factor;
  const endRow = startRow + tileSegments * factor;
  let maximum = 0;
  for (let row = startRow; row <= endRow; row++) {
    for (let column = startColumn; column <= endColumn; column++) {
      const source = master.values[row * master.width + column];
      if (Number.isNaN(source)) continue;
      const reconstructed = sampleLevel(level, column, row, factor);
      if (Number.isNaN(reconstructed)) {
        throw new Error(`LOD reconstruction loses finite terrain at source sample ${column},${row}`);
      }
      maximum = Math.max(maximum, Math.abs(source - reconstructed));
    }
  }
  return maximum;
}

function levelGeometricError(master, level, factor) {
  let maximum = 0;
  for (let row = 0; row < master.height; row++) {
    for (let column = 0; column < master.width; column++) {
      const source = master.values[row * master.width + column];
      if (Number.isNaN(source)) continue;
      const reconstructed = sampleLevel(level, column, row, factor);
      if (Number.isNaN(reconstructed)) {
        throw new Error(`shell reconstruction loses finite terrain at source sample ${column},${row}`);
      }
      maximum = Math.max(maximum, Math.abs(source - reconstructed));
    }
  }
  return maximum;
}

function extractTile(level, tileColumn, tileRow, tileSegments) {
  const size = tileSegments + 1;
  const values = new Float64Array(size * size);
  const startColumn = tileColumn * tileSegments;
  const startRow = tileRow * tileSegments;
  for (let row = 0; row < size; row++) {
    const sourceStart = (startRow + row) * level.width + startColumn;
    values.set(level.values.subarray(sourceStart, sourceStart + size), row * size);
  }
  return values;
}

function quantizedAt(tile, column, row) {
  const view = new DataView(tile.payload.buffer, tile.payload.byteOffset, tile.payload.byteLength);
  return view.getUint16((row * tile.grid.width + column) * 2, true);
}

function assertLevelSeams(level) {
  const size = level.tileSegments + 1;
  const byCoordinate = new Map(level.tiles.map(tile => [`${tile.column}/${tile.row}`, tile]));
  for (const tile of level.tiles) {
    const east = byCoordinate.get(`${tile.column + 1}/${tile.row}`);
    if (east) {
      for (let row = 0; row < size; row++) {
        if (quantizedAt(tile, size - 1, row) !== quantizedAt(east, 0, row)) {
          throw new Error(`terrain seam mismatch between ${tile.id} and ${east.id}`);
        }
      }
    }
    const south = byCoordinate.get(`${tile.column}/${tile.row + 1}`);
    if (south) {
      for (let column = 0; column < size; column++) {
        if (quantizedAt(tile, column, size - 1) !== quantizedAt(south, column, 0)) {
          throw new Error(`terrain seam mismatch between ${tile.id} and ${south.id}`);
        }
      }
    }
  }
}

function availableLods(width, height, tileSegments) {
  let tilesX = (width - 1) / tileSegments;
  let tilesY = (height - 1) / tileSegments;
  if (!Number.isSafeInteger(tilesX) || !Number.isSafeInteger(tilesY) || tilesX < 1 || tilesY < 1) {
    throw new RangeError('source dimensions must equal tileSegments * tileCount + 1');
  }
  let maximum = 0;
  while (tilesX % 2 === 0 && tilesY % 2 === 0) {
    tilesX /= 2;
    tilesY /= 2;
    maximum++;
  }
  return maximum;
}

function compileShell({
  master,
  originEasting,
  originNorthing,
  sampleSpacingMetres,
  tileSegments,
  heightOffsetMetres,
  heightScaleMetres,
}) {
  let level = master;
  let factor = 1;
  while (level.width > tileSegments + 1 || level.height > tileSegments + 1) {
    level = downsampleByTwo(level);
    factor *= 2;
  }
  const encoded = encodeTerrainGrid({
    heights: level.values,
    width: level.width,
    height: level.height,
    heightOffsetMetres,
    heightScaleMetres,
  });
  const spacing = sampleSpacingMetres * factor;
  return Object.freeze({
    id: 'shell',
    lod: Math.log2(factor),
    column: 0,
    row: 0,
    parentId: null,
    bounds: Object.freeze({
      minEasting: originEasting,
      minNorthing: originNorthing - (master.height - 1) * sampleSpacingMetres,
      minHeightRH2000: encoded.minHeightRH2000,
      maxEasting: originEasting + (master.width - 1) * sampleSpacingMetres,
      maxNorthing: originNorthing,
      maxHeightRH2000: encoded.maxHeightRH2000,
    }),
    grid: Object.freeze({
      ...encoded.grid,
      sampleSpacingMetres: spacing,
      geometricErrorMetres: levelGeometricError(master, level, factor) + heightScaleMetres / 2,
    }),
    payload: encoded.payload,
    finiteCount: encoded.finiteCount,
    maximumQuantizationErrorMetres: encoded.maximumQuantizationErrorMetres,
  });
}

export function compileTerrainPyramid({
  heights,
  width,
  height,
  originEasting,
  originNorthing,
  sampleSpacingMetres = 1,
  tileSegments = DEFAULT_TILE_SEGMENTS,
  heightScaleMetres = DEFAULT_HEIGHT_SCALE_METRES,
  maximumLod,
} = {}) {
  positiveInteger(width, 'width', 2);
  positiveInteger(height, 'height', 2);
  positiveInteger(tileSegments, 'tileSegments', 2, 1024);
  if ((tileSegments & (tileSegments - 1)) !== 0) throw new RangeError('tileSegments must be a power of two');
  positiveFinite(sampleSpacingMetres, 'sampleSpacingMetres');
  positiveFinite(heightScaleMetres, 'heightScaleMetres');
  if (!Number.isFinite(originEasting) || !Number.isFinite(originNorthing)) {
    throw new TypeError('originEasting and originNorthing must be finite');
  }
  const source = sourceHeights(heights, width * height);
  const availableMaximumLod = availableLods(width, height, tileSegments);
  const resolvedMaximumLod = maximumLod === undefined ? availableMaximumLod : maximumLod;
  positiveInteger(resolvedMaximumLod, 'maximumLod', 0, availableMaximumLod);

  const commonHeightOffsetMetres = Math.floor(source.minimum / heightScaleMetres) * heightScaleMetres;
  if (Math.round((source.maximum - commonHeightOffsetMetres) / heightScaleMetres) >= 65535) {
    throw new RangeError('terrain source height range exceeds the shared uint16 quantization profile');
  }

  const master = { width, height, values: source.values };
  const sourceLevels = [master];
  for (let lod = 1; lod <= resolvedMaximumLod; lod++) {
    sourceLevels.push(downsampleByTwo(sourceLevels[lod - 1]));
  }

  const levels = sourceLevels.map((level, lod) => {
    const factor = 2 ** lod;
    const tilesX = (level.width - 1) / tileSegments;
    const tilesY = (level.height - 1) / tileSegments;
    const spacing = sampleSpacingMetres * factor;
    const tiles = [];
    for (let row = 0; row < tilesY; row++) {
      for (let column = 0; column < tilesX; column++) {
        const tileHeights = extractTile(level, column, row, tileSegments);
        const residual = tileGeometricError(master, level, factor, column, row, tileSegments);
        const geometricErrorMetres = residual + heightScaleMetres / 2;
        const encoded = encodeTerrainGrid({
          heights: tileHeights,
          width: tileSegments + 1,
          height: tileSegments + 1,
          heightOffsetMetres: commonHeightOffsetMetres,
          heightScaleMetres,
        });
        const minEasting = originEasting + column * tileSegments * spacing;
        const maxNorthing = originNorthing - row * tileSegments * spacing;
        const id = `l${lod}/${column}/${row}`;
        tiles.push(Object.freeze({
          id,
          lod,
          column,
          row,
          parentId: lod < resolvedMaximumLod
            ? `l${lod + 1}/${Math.floor(column / 2)}/${Math.floor(row / 2)}`
            : null,
          bounds: Object.freeze({
            minEasting,
            minNorthing: maxNorthing - tileSegments * spacing,
            minHeightRH2000: encoded.minHeightRH2000,
            maxEasting: minEasting + tileSegments * spacing,
            maxNorthing,
            maxHeightRH2000: encoded.maxHeightRH2000,
          }),
          grid: Object.freeze({
            ...encoded.grid,
            sampleSpacingMetres: spacing,
            geometricErrorMetres,
          }),
          payload: encoded.payload,
          finiteCount: encoded.finiteCount,
          maximumQuantizationErrorMetres: encoded.maximumQuantizationErrorMetres,
        }));
      }
    }
    const result = {
      lod,
      factor,
      sampleSpacingMetres: spacing,
      tileSegments,
      tilesX,
      tilesY,
      tiles: Object.freeze(tiles),
    };
    assertLevelSeams(result);
    return Object.freeze(result);
  });

  const coarsest = levels.at(-1);
  const shell = coarsest.tiles.length === 1
    ? coarsest.tiles[0]
    : compileShell({
      master,
      originEasting,
      originNorthing,
      sampleSpacingMetres,
      tileSegments,
      heightOffsetMetres: commonHeightOffsetMetres,
      heightScaleMetres,
    });
  return Object.freeze({
    width,
    height,
    originEasting,
    originNorthing,
    sampleSpacingMetres,
    tileSegments,
    commonHeightOffsetMetres,
    heightScaleMetres,
    maximumLod: resolvedMaximumLod,
    finiteCount: source.finiteCount,
    sourceMinimumHeightRH2000: source.minimum,
    sourceMaximumHeightRH2000: source.maximum,
    levels: Object.freeze(levels),
    shell,
    seamsVerified: true,
    morphMethod: 'bilinear-even-samples-v1',
  });
}

function decodedHeight(tile, column, row) {
  const quantized = quantizedAt(tile, column, row);
  return quantized === tile.grid.noDataValue
    ? Number.NaN
    : tile.grid.heightOffsetMetres + quantized * tile.grid.heightScaleMetres;
}

export function sampleTerrainTile(tile, easting, northing) {
  if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
    throw new TypeError('sample coordinates must be finite');
  }
  const spacing = tile.grid.sampleSpacingMetres;
  const column = (easting - tile.bounds.minEasting) / spacing;
  const row = (tile.bounds.maxNorthing - northing) / spacing;
  const epsilon = 1e-9;
  if (column < -epsilon || row < -epsilon ||
      column > tile.grid.width - 1 + epsilon || row > tile.grid.height - 1 + epsilon) return Number.NaN;
  const clampedColumn = Math.max(0, Math.min(tile.grid.width - 1, column));
  const clampedRow = Math.max(0, Math.min(tile.grid.height - 1, row));
  const left = Math.floor(clampedColumn);
  const top = Math.floor(clampedRow);
  const right = Math.min(tile.grid.width - 1, left + 1);
  const bottom = Math.min(tile.grid.height - 1, top + 1);
  const x = clampedColumn - left;
  const y = clampedRow - top;
  const northWest = decodedHeight(tile, left, top);
  const northEast = decodedHeight(tile, right, top);
  const southWest = decodedHeight(tile, left, bottom);
  const southEast = decodedHeight(tile, right, bottom);
  if ([northWest, northEast, southWest, southEast].some(Number.isNaN)) return Number.NaN;
  const north = northWest + (northEast - northWest) * x;
  const south = southWest + (southEast - southWest) * x;
  return north + (south - north) * y;
}

export class TerrainPyramidSampler {
  constructor(pyramid) {
    if (!pyramid?.levels?.length) throw new TypeError('a compiled terrain pyramid is required');
    this.pyramid = pyramid;
    this.tiles = pyramid.levels.map(level => new Map(level.tiles.map(tile => [tile.id, tile])));
  }

  sample(easting, northing, { preferredLod = 0, availableTileIds = null } = {}) {
    if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
      throw new TypeError('sample coordinates must be finite');
    }
    positiveInteger(preferredLod, 'preferredLod', 0, this.pyramid.maximumLod);
    const availability = availableTileIds === null
      ? null
      : availableTileIds instanceof Set ? availableTileIds : new Set(availableTileIds);
    for (let lod = preferredLod; lod <= this.pyramid.maximumLod; lod++) {
      const level = this.pyramid.levels[lod];
      const span = level.tileSegments * level.sampleSpacingMetres;
      let column = Math.floor((easting - this.pyramid.originEasting) / span);
      let row = Math.floor((this.pyramid.originNorthing - northing) / span);
      if (column === level.tilesX && Math.abs(easting - (this.pyramid.originEasting + level.tilesX * span)) < 1e-9) {
        column--;
      }
      if (row === level.tilesY && Math.abs(northing - (this.pyramid.originNorthing - level.tilesY * span)) < 1e-9) {
        row--;
      }
      if (column < 0 || row < 0 || column >= level.tilesX || row >= level.tilesY) continue;
      const id = `l${lod}/${column}/${row}`;
      if (availability && !availability.has(id)) continue;
      const tile = this.tiles[lod].get(id);
      const heightRH2000 = sampleTerrainTile(tile, easting, northing);
      if (!Number.isNaN(heightRH2000)) return Object.freeze({ heightRH2000, tileId: id, lod });
    }
    const shell = this.pyramid.shell;
    if (shell && (!availability || availability.has(shell.id))) {
      const heightRH2000 = sampleTerrainTile(shell, easting, northing);
      if (!Number.isNaN(heightRH2000)) {
        return Object.freeze({ heightRH2000, tileId: shell.id, lod: shell.lod });
      }
    }
    return null;
  }
}
