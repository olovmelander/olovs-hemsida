const DEFAULT_THRESHOLDS_METRES = Object.freeze([0.011, 0.05, 0.1, 0.25, 0.5, 1, 2]);

export function summarizeTerrainDifference({ level, read, tiles, thresholdsMetres = DEFAULT_THRESHOLDS_METRES }) {
  const thresholds = [...thresholdsMetres];
  if (thresholds.some((value, index) => !Number.isFinite(value) || value < 0 ||
      (index && value <= thresholds[index - 1]))) {
    throw new Error('terrain difference thresholds must be finite, non-negative and increasing');
  }
  let samples = 0, withinQuantum = 0, maximumDifference = 0;
  let absoluteTotal = 0, squaredTotal = 0, worstSample = null;
  const exceedances = Object.fromEntries(thresholds.map(value => [String(value), 0]));
  for (const tile of tiles) {
    const quantum = tile.grid.heightScaleMetres / 2 + 1e-6;
    for (let row = 0; row < tile.grid.height; row++) {
      const northing = tile.bounds.maxNorthing - row * tile.grid.sampleSpacingMetres;
      const levelRow = Math.round((read.extent.maxNorthing - northing) / level.sampleSpacingMetres);
      for (let column = 0; column < tile.grid.width; column++) {
        const easting = tile.bounds.minEasting + column * tile.grid.sampleSpacingMetres;
        const levelColumn = Math.round((easting - read.extent.minEasting) / level.sampleSpacingMetres);
        const baselineHeightRH2000 = tile.heights[row * tile.grid.width + column];
        const candidateHeightRH2000 = read.values[levelRow * read.size + levelColumn];
        if (!Number.isFinite(baselineHeightRH2000) || !Number.isFinite(candidateHeightRH2000)) continue;
        samples++;
        const difference = Math.abs(baselineHeightRH2000 - candidateHeightRH2000);
        absoluteTotal += difference;
        squaredTotal += difference * difference;
        if (difference <= quantum) withinQuantum++;
        for (const threshold of thresholds) if (difference > threshold) exceedances[String(threshold)]++;
        if (difference > maximumDifference) {
          maximumDifference = difference;
          worstSample = { tileId: tile.id, row, column, easting, northing,
            baselineHeightRH2000, candidateHeightRH2000, differenceMetres: difference };
        }
      }
    }
  }
  return {
    tiles: tiles.length,
    samples,
    withinQuantum,
    outsideQuantum: samples - withinQuantum,
    outsideQuantumFraction: samples ? (samples - withinQuantum) / samples : 0,
    meanAbsoluteDifferenceMetres: samples ? absoluteTotal / samples : 0,
    rootMeanSquareDifferenceMetres: samples ? Math.sqrt(squaredTotal / samples) : 0,
    maximumDifferenceMetres: maximumDifference,
    thresholdExceedances: exceedances,
    worstSample,
  };
}

export { DEFAULT_THRESHOLDS_METRES };
