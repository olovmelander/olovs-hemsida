const GEOMETRY_KEYS = new Set([
  'ring', 'rings', 'line', 'c', 'pin', 'pts', 'boundary',
  'forest', 'rock', 'scrub', 'wetland', 'wood', 'sand',
  'range', 'greens', 'fairways', 'tees', 'bunkers', 'grass',
  'poles', 'towers', 'yard', 'hayfields', 'shallows', 'clearfells',
  'beaches', 'chains', 'pois',
  /* the range tee line (mat centres) and the safety net (a polyline), traced
     off the tiles for Puttom -- world points like every key above */
  'bays', 'nets',
]);

const finitePair = value => Array.isArray(value)
  && value.length === 2
  && value.every(Number.isFinite);

function normalizedPath(path) {
  return path.map(part => Number.isInteger(part) ? '[]' : part).join('.');
}

function pairRole(path) {
  const keys = path.filter(part => typeof part === 'string');
  if (keys[0] === 'card') return 'metadata';
  if (keys[0] === 'holes' && keys.at(-1) === 't') return 'metadata';
  if (keys.some(key => GEOMETRY_KEYS.has(key))) return 'coordinate';
  return 'unknown';
}

/**
 * Return mutable references to every explicit 2D coordinate in a legacy model.
 * New unclassified numeric pairs fail closed so card/rating metadata cannot be
 * silently projected as geometry when the legacy schema evolves.
 */
export function collectCoordinatePairs(root) {
  const coordinates = [];
  const ignored = [];
  const unknown = [];

  function visit(value, path) {
    if (finitePair(value)) {
      const role = pairRole(path);
      const entry = { pair: value, path: normalizedPath(path) };
      if (role === 'coordinate') coordinates.push(entry);
      else if (role === 'metadata') ignored.push(entry);
      else unknown.push(entry);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, [...path, index]));
      return;
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, child]) => visit(child, [...path, key]));
    }
  }

  visit(root, []);
  if (unknown.length) {
    const paths = [...new Set(unknown.map(entry => entry.path))].sort();
    throw new Error(`Unclassified numeric pairs must be reviewed: ${paths.join(', ')}`);
  }
  return { coordinates, ignored };
}

export function localToLatLon([x, z], frame) {
  const { latitude, longitude } = frame.originWgs84;
  return {
    latitude: latitude - z / frame.metresPerLatitude,
    longitude: longitude + x / frame.metresPerLongitude,
  };
}

export function canonicalLocal(projected, origin) {
  return {
    x: projected.easting - origin.easting,
    z: origin.northing - projected.northing,
  };
}

export function fitSimilarity(samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new Error('At least two samples are required for a similarity fit');
  }
  const mean = samples.reduce((sum, sample) => ({
    x: sum.x + sample.localX,
    z: sum.z + sample.localZ,
    targetX: sum.targetX + sample.targetX,
    targetZ: sum.targetZ + sample.targetZ,
  }), { x: 0, z: 0, targetX: 0, targetZ: 0 });
  for (const key of Object.keys(mean)) mean[key] /= samples.length;

  let denominator = 0;
  let real = 0;
  let imaginary = 0;
  for (const sample of samples) {
    const x = sample.localX - mean.x;
    const z = sample.localZ - mean.z;
    const targetX = sample.targetX - mean.targetX;
    const targetZ = sample.targetZ - mean.targetZ;
    denominator += x * x + z * z;
    real += x * targetX + z * targetZ;
    imaginary += x * targetZ - z * targetX;
  }
  if (denominator === 0) throw new Error('Similarity fit samples have no spatial extent');

  const a = real / denominator;
  const b = imaginary / denominator;
  const translateX = mean.targetX - a * mean.x + b * mean.z;
  const translateZ = mean.targetZ - b * mean.x - a * mean.z;
  return {
    a,
    b,
    scale: Math.hypot(a, b),
    rotationDegrees: Math.atan2(b, a) * 180 / Math.PI,
    translateX,
    translateZ,
  };
}

export function applySimilarity(sample, fit) {
  return {
    x: fit.translateX + fit.a * sample.localX - fit.b * sample.localZ,
    z: fit.translateZ + fit.b * sample.localX + fit.a * sample.localZ,
  };
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

const round = (value, decimals = 6) => value === null
  ? null
  : Number(value.toFixed(decimals));

export function residualSummary(residuals) {
  if (!residuals.length) throw new Error('Cannot summarize an empty residual set');
  const distances = residuals.map(({ dx, dz }) => Math.hypot(dx, dz)).sort((a, b) => a - b);
  const biasX = residuals.reduce((sum, value) => sum + value.dx, 0) / residuals.length;
  const biasZ = residuals.reduce((sum, value) => sum + value.dz, 0) / residuals.length;
  const rmse = Math.sqrt(residuals.reduce((sum, value) => sum + value.dx ** 2 + value.dz ** 2, 0) / residuals.length);
  return {
    count: residuals.length,
    biasMetres: { x: round(biasX), z: round(biasZ) },
    rmseMetres: round(rmse),
    p50Metres: round(percentile(distances, 0.5)),
    p95Metres: round(percentile(distances, 0.95)),
    p99Metres: round(percentile(distances, 0.99)),
    maxMetres: round(distances.at(-1)),
  };
}

export function migrationResiduals(localPairs, projected, origin) {
  if (localPairs.length !== projected.length) {
    throw new Error('Local/projected coordinate counts differ');
  }
  const samples = localPairs.map(([localX, localZ], index) => {
    const target = canonicalLocal(projected[index], origin);
    return { localX, localZ, targetX: target.x, targetZ: target.z };
  });
  const direct = samples.map(sample => ({
    dx: sample.targetX - sample.localX,
    dz: sample.targetZ - sample.localZ,
  }));
  const fit = fitSimilarity(samples);
  const fitted = samples.map(sample => {
    const value = applySimilarity(sample, fit);
    return { dx: sample.targetX - value.x, dz: sample.targetZ - value.z };
  });
  return {
    direct: residualSummary(direct),
    bestFitSimilarity: {
      scale: round(fit.scale, 9),
      rotationDegrees: round(fit.rotationDegrees, 9),
      translationMetres: {
        x: round(fit.translateX),
        z: round(fit.translateZ),
      },
      residuals: residualSummary(fitted),
    },
    samples,
  };
}

export function coordinatePathCounts(entries) {
  const counts = new Map();
  for (const { path } of entries) counts.set(path, (counts.get(path) || 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

export function roundedCoordinate(value) {
  return round(value, 3);
}
