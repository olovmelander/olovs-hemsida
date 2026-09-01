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

  const requested = orderedBounds(previewBounds, 'previewBounds');
  /* The pilot used to be smaller than the grid it cut into, and anything larger
     was a mistake worth refusing. The wide frontier is deliberately larger --
     it contains the whole CORE -- so the hole is the INTERSECTION, and the
     planner says which it planned rather than silently accepting either. A
     frontier that misses the grid entirely is still an error. */
  const verified = {
    x0: Math.max(requested.x0, core.x0), x1: Math.min(requested.x1, core.x1),
    z0: Math.max(requested.z0, core.z0), z1: Math.min(requested.z1, core.z1),
  };
  if (!(verified.x1 > verified.x0 && verified.z1 > verified.z0)) {
    throw new RangeError('previewBounds do not overlap the legacy grid');
  }
  const clampedToGrid = verified.x0 !== requested.x0 || verified.x1 !== requested.x1 ||
    verified.z0 !== requested.z0 || verified.z1 !== requested.z1;

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
    clampedToGrid,
    guardCells,
    guardMetres,
    nx,
    nz,
    totalBasePoints,
    skippedBasePoints,
  });
}

/**
 * Bind a planned cutout to the separately reviewed legacy grid. Planner versus
 * builder equality proves internal consistency; this additional check proves
 * that both still operate on the approved spatial footprint. Expected values
 * therefore remain explicit instead of being derived from the runtime plan.
 */
export function assertV2LegacyCutoutContract({ grid, plan, contract } = {}) {
  const expected = contract?.expectedCoreGrid;
  if (!expected || typeof expected !== 'object') {
    throw new TypeError('v2 legacy cutout requires a reviewed expectedCoreGrid');
  }
  if (!grid || typeof grid !== 'object' || !plan || typeof plan !== 'object') {
    throw new TypeError('v2 legacy cutout contract requires the runtime grid and plan');
  }

  const actualValues = [
    grid.dx, grid.x0, grid.x1, grid.z0, grid.z1, plan.nx, plan.nz,
    plan.skippedBasePoints, plan.totalBasePoints,
  ];
  const expectedValues = [
    expected.dx, expected.x0, expected.x1, expected.z0, expected.z1,
    expected.nx, expected.nz,
    contract.expectedSkippedBasePoints, contract.expectedTotalBasePoints,
  ];
  const exact = actualValues.every((value, index) =>
    Number.isFinite(value) && value === expectedValues[index]);
  if (!exact) {
    throw new Error(
      `v2 legacy CORE contract expected ${expected.nx}x${expected.nz} ` +
      `${contract.expectedSkippedBasePoints}/${contract.expectedTotalBasePoints} skipped/total ` +
      `at [${expected.x0},${expected.x1}]x[${expected.z0},${expected.z1}] @${expected.dx}; got ` +
      `${plan.nx}x${plan.nz} ${plan.skippedBasePoints}/${plan.totalBasePoints} ` +
      `at [${grid.x0},${grid.x1}]x[${grid.z0},${grid.z1}] @${grid.dx}`,
    );
  }
  return plan;
}
