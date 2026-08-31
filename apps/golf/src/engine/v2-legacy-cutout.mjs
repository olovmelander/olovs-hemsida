const STRICT_HOLE_EPSILON = 1e-6;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function orderedBounds(value, label) {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} are required`);
  const bounds = {
    x0: finite(value.x0, `${label}.x0`),
    x1: finite(value.x1, `${label}.x1`),
    z0: finite(value.z0, `${label}.z0`),
    z1: finite(value.z1, `${label}.z1`),
  };
  if (!(bounds.x1 > bounds.x0 && bounds.z1 > bounds.z0)) {
    throw new RangeError(`${label} must have positive x and z extents`);
  }
  return bounds;
}

function axisPointCount(start, end, spacing, label) {
  const steps = (end - start) / spacing;
  const roundedSteps = Math.round(steps);
  if (!Number.isSafeInteger(roundedSteps) || roundedSteps < 1 ||
      Math.abs(start + roundedSteps * spacing - end) > STRICT_HOLE_EPSILON) {
    throw new RangeError(`${label} extent must be an exact multiple of grid.dx`);
  }
  const count = roundedSteps + 1;
  if (!Number.isSafeInteger(count)) throw new RangeError(`${label} point count is unsafe`);
  return count;
}

/* Count the same coordinates that buildTerrain() excludes with:
   point > lower + 1e-6 && point < upper - 1e-6.
   The boundary corrections retain those exact IEEE comparisons while keeping
   planning independent of the two-dimensional grid size. */
function strictInteriorPointCount(start, spacing, count, lower, upper) {
  const inside = index => {
    const coordinate = start + index * spacing;
    return coordinate > lower + STRICT_HOLE_EPSILON &&
      coordinate < upper - STRICT_HOLE_EPSILON;
  };
  let first = Math.max(0, Math.min(count,
    Math.floor((lower + STRICT_HOLE_EPSILON - start) / spacing) + 1));
  while (first < count && !inside(first)) first++;
  while (first > 0 && inside(first - 1)) first--;
  if (first >= count || !inside(first)) return 0;

  let last = Math.max(first, Math.min(count - 1,
    Math.ceil((upper - STRICT_HOLE_EPSILON - start) / spacing) - 1));
  while (last >= first && !inside(last)) last--;
  while (last + 1 < count && inside(last + 1)) last++;
  return last >= first ? last - first + 1 : 0;
}

/**
 * Plan a construction-time hole in the legacy CORE grid. No cutout is planned
 * unless the caller explicitly enables it after the verified v2 preflight has
 * reached `ready`; every malformed or unsafe enabled request throws before the
 * legacy mesh can omit a point.
 */
export function planV2LegacyCutout({
  grid,
  previewBounds,
  enabled = false,
  preflightStatus,
  guardCells = 2,
} = {}) {
  if (enabled !== true) return null;
  if (preflightStatus !== 'ready') {
    throw new Error('v2 legacy cutout requires a ready verified preview preflight');
  }
  if (!Number.isSafeInteger(guardCells) || guardCells < 0) {
    throw new RangeError('guardCells must be a non-negative safe integer');
  }

  const core = orderedBounds(grid, 'grid');
  const dx = finite(grid.dx, 'grid.dx');
  if (!(dx > 0)) throw new RangeError('grid.dx must be positive');
  const nx = axisPointCount(core.x0, core.x1, dx, 'grid x');
  const nz = axisPointCount(core.z0, core.z1, dx, 'grid z');
  const totalBasePoints = nx * nz;
  if (!Number.isSafeInteger(totalBasePoints)) {
    throw new RangeError('grid base-point count is unsafe');
  }

  const verified = orderedBounds(previewBounds, 'previewBounds');
  if (verified.x0 < core.x0 - STRICT_HOLE_EPSILON ||
      verified.x1 > core.x1 + STRICT_HOLE_EPSILON ||
      verified.z0 < core.z0 - STRICT_HOLE_EPSILON ||
      verified.z1 > core.z1 + STRICT_HOLE_EPSILON) {
    throw new RangeError('previewBounds must lie inside the legacy grid');
  }

  const guardMetres = guardCells * dx;
  if (!Number.isFinite(guardMetres)) {
    throw new RangeError('cutout guard distance is unsafe');
  }
  const innerBounds = Object.freeze({
    x0: verified.x0 + guardMetres,
    x1: verified.x1 - guardMetres,
    z0: verified.z0 + guardMetres,
    z1: verified.z1 - guardMetres,
  });
  if (!(innerBounds.x1 > innerBounds.x0 && innerBounds.z1 > innerBounds.z0)) {
    throw new RangeError('previewBounds are too small for the requested cutout guard');
  }

  const skippedX = strictInteriorPointCount(core.x0, dx, nx, innerBounds.x0, innerBounds.x1);
  const skippedZ = strictInteriorPointCount(core.z0, dx, nz, innerBounds.z0, innerBounds.z1);
  const skippedBasePoints = skippedX * skippedZ;
  if (!Number.isSafeInteger(skippedBasePoints) || skippedBasePoints < 1) {
    throw new RangeError('guarded previewBounds contain no legacy grid points');
  }

  return Object.freeze({
    innerBounds,
    guardCells,
    guardMetres,
    nx,
    nz,
    totalBasePoints,
    skippedBasePoints,
  });
}
