/* Finest-terrain source windows use the COG's actual pixel-edge extent.
   Coastal products may contain only part of their nominal 10 km item. */
const EPSILON = 1e-6;
const integer = value => Number.isFinite(value) && Math.abs(value - Math.round(value)) < EPSILON;

export function terrainWindowIntersection(spec, item, level) {
  if (spec.sampleSpacingMetres !== 1 || level.factor !== 1 ||
      level.pixelScaleX !== 1 || level.pixelScaleY !== 1 || !level.isFloat) {
    throw new Error(`${item.id} requires full-resolution 1 m Float32 terrain`);
  }
  if (![spec.width, spec.height, level.width, level.height].every(value => Number.isInteger(value) && value > 0) ||
      ![spec.originEasting, spec.originNorthing, level.originX, level.originY].every(Number.isFinite)) {
    throw new Error(`${item.id} has an invalid source or destination lattice`);
  }
  if (!Number.isFinite(level.noData)) throw new Error(`${item.id} must declare a finite nodata value`);
  const sourceExtent = {
    west: level.originX, north: level.originY,
    east: level.originX + level.width, south: level.originY - level.height,
  };
  if (sourceExtent.west < item.minEasting - EPSILON || sourceExtent.east > item.maxEasting + EPSILON ||
      sourceExtent.south < item.minNorthing - EPSILON || sourceExtent.north > item.maxNorthing + EPSILON) {
    throw new Error(`${item.id} source extent leaves its nominal 10 km item`);
  }
  const sourceColumnAtOrigin = spec.originEasting - level.originX - 0.5;
  const sourceRowAtOrigin = level.originY - spec.originNorthing - 0.5;
  if (!integer(sourceColumnAtOrigin) || !integer(sourceRowAtOrigin)) {
    throw new Error(`${item.id} source pixel centres do not align with the requested lattice`);
  }
  const columnOffset = Math.round(sourceColumnAtOrigin);
  const rowOffset = Math.round(sourceRowAtOrigin);
  const column0 = Math.max(0, -columnOffset);
  const row0 = Math.max(0, -rowOffset);
  const lastColumn = Math.min(spec.width - 1, level.width - 1 - columnOffset);
  const lastRow = Math.min(spec.height - 1, level.height - 1 - rowOffset);
  if (lastColumn < column0 || lastRow < row0) return null;
  const columns = lastColumn - column0 + 1, rows = lastRow - row0 + 1;
  return {
    sourceExtent,
    windowPixels: { column0: columnOffset + column0, row0: rowOffset + row0, columns, rows },
    latticeWindow: { column0, row0, columns, rows },
  };
}

export function copyTerrainWindow(destination, width, intersection, samples, noData) {
  const { column0, row0, columns, rows } = intersection.latticeWindow;
  if (samples.length !== columns * rows) throw new Error('terrain source window has the wrong sample count');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const value = samples[r * columns + c];
      if (!Number.isFinite(value) || value === noData) throw new Error(`terrain source contains nodata at window pixel ${c},${r}`);
      const index = (row0 + r) * width + column0 + c;
      if (Number.isFinite(destination[index])) throw new Error('terrain source windows overlap on the requested lattice');
      destination[index] = value;
    }
  }
}

export function summarizeTerrainWindow(values, band) {
  let finite = 0, minimum = Infinity, maximum = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    finite++;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  if (finite !== values.length) throw new Error(`${values.length - finite} of ${values.length} window samples are nodata or unread`);
  if (minimum < band.minimum || maximum > band.maximum) {
    throw new Error(`window RH 2000 range ${minimum}-${maximum} m leaves the reviewed band ${band.minimum}-${band.maximum}`);
  }
  return { finite, minimum, maximum };
}
