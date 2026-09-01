/* Canopy from Laserdata Skog, which is the one authoritative source this
   account can actually read for what stands ON the ground rather than what the
   ground is. The bare-earth DTM was measured and cannot resolve golf surfaces;
   the orthophoto is refused; Skogsstyrelsen's tree-height raster answers 401.
   The point cloud is authorized, complete over the AOI, and carries its own
   ground returns -- so a canopy height model can be derived from it without
   ever differencing two separately georeferenced products. */

const CANOPY_GROUND_CLASSIFICATION = 2;
export const CANOPY_RESOLUTION_METRES = 2;
/* Ångermanland's tallest stands are well under 40 m. A ceiling here removes
   birds and atmospheric noise without touching a real crown; it is a sanity
   bound, not a model of the forest. */
export const CANOPY_MAXIMUM_HEIGHT_METRES = 60;
/* The conventional line between canopy and ground vegetation, declared BEFORE
   the measurement so the headline number cannot be chosen to flatter it. */
export const CANOPY_THRESHOLD_METRES = 2;

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be a positive finite number`);
  return value;
}

/**
 * A bounded PDAL pipeline that rasterises canopy height directly from one COPC
 * window.
 *
 * `filters.hag_nn` measures every return against the ground returns in the SAME
 * cloud, so the result is a height above ground rather than a difference
 * between two products that were georeferenced independently. That matters:
 * a DTM-subtracted CHM inherits both products' registration error, and here
 * there is none to inherit.
 *
 * There is deliberately no `filters.head` cap. Truncating a point stream is
 * harmless for statistics and quietly punches holes in a raster, so a window
 * whose advertised point count would exceed the plan's cap is REFUSED instead.
 */
export function canopyHeightPipeline(plan, credentials, {
  resolutionMetres = CANOPY_RESOLUTION_METRES,
  outputPath,
  authorizationHeaders,
} = {}) {
  if (!credentials) throw new Error('Lantmäteriet credentials are required for Laserdata Skog');
  if (typeof authorizationHeaders !== 'function') {
    throw new TypeError('authorizationHeaders builder is required');
  }
  if (typeof outputPath !== 'string' || !outputPath) throw new TypeError('outputPath is required');
  finitePositive(resolutionMetres, 'resolutionMetres');
  const [minX, minY, maxX, maxY] = plan.boundsEpsg3006;
  const density = plan.source?.pointDensityPerSquareMetre;
  if (Number.isFinite(density)) {
    const expected = Math.ceil(density * plan.areaSquareMetres);
    if (expected > plan.maximumPoints) {
      throw new Error(`this ${plan.spanMetres} m window holds about ${expected} points, past the ${plan.maximumPoints} cap; narrow the span rather than truncating a raster`);
    }
  }
  return Object.freeze([
    Object.freeze({
      type: 'readers.copc',
      filename: Object.freeze({
        path: plan.source.sourceUrl,
        headers: authorizationHeaders(credentials),
      }),
      bounds: `([${minX},${maxX}],[${minY},${maxY}])`,
      requests: 4,
    }),
    Object.freeze({
      type: 'filters.hag_nn',
      count: 1,
      allow_extrapolation: false,
    }),
    Object.freeze({
      type: 'filters.range',
      limits: `HeightAboveGround[0:${CANOPY_MAXIMUM_HEIGHT_METRES}]`,
    }),
    Object.freeze({
      type: 'writers.gdal',
      filename: outputPath,
      gdaldriver: 'GTiff',
      dimension: 'HeightAboveGround',
      output_type: 'max',
      resolution: resolutionMetres,
      nodata: -9999,
      /* One cell radius: a cell with no return stays nodata rather than
         borrowing its neighbour's crown. An invented tree is worse than a
         recorded gap. */
      radius: resolutionMetres,
    }),
  ]);
}

export const CANOPY_GROUND_CLASS = CANOPY_GROUND_CLASSIFICATION;

/**
 * Decode the committed satellite tree-cover raster and sample it in the
 * build's own legacy world frame.
 *
 * The packing and the sampling are copied verbatim from the canonical reader in
 * `geobuild/check-treecover.mjs` -- two cells' bits per shift, four per byte,
 * least significant first, `k = j * nx + i`. Reimplementing it from the
 * writer's `bitorder="little"` would be one transposition away from silently
 * mirroring the raster, and a mirrored control set agrees with nothing while
 * looking exactly like a real disagreement.
 */
export function treeCoverIndex(raster) {
  for (const key of ['cell', 'x0', 'z0', 'nx', 'nz', 'b64']) {
    if (raster?.[key] === undefined) throw new TypeError(`tree-cover raster is missing ${key}`);
  }
  const raw = Buffer.from(raster.b64, 'base64');
  const cells = raster.nx * raster.nz;
  if (raw.length < Math.ceil(cells / 4)) {
    throw new Error(`tree-cover raster declares ${cells} cells but carries only ${raw.length} bytes`);
  }
  const classAt = (worldX, worldZ) => {
    const i = Math.floor((worldX - raster.x0) / raster.cell);
    const j = Math.floor((worldZ - raster.z0) / raster.cell);
    if (i < 0 || i >= raster.nx || j < 0 || j >= raster.nz) return 0;
    const k = j * raster.nx + i;
    return (raw[k >> 2] >> ((k & 3) * 2)) & 3;
  };
  return Object.freeze({
    cellMetres: raster.cell,
    nx: raster.nx,
    nz: raster.nz,
    classAt,
    /* A probe is only usable where the raster is confident AND its whole
       neighbourhood agrees: a cell on a stand's edge is the one place the
       satellite and the LiDAR may legitimately disagree by metres. */
    uniformClassAt(worldX, worldZ, radiusMetres) {
      const first = classAt(worldX, worldZ);
      if (first === 0) return 0;
      for (let dz = -radiusMetres; dz <= radiusMetres; dz += raster.cell) {
        for (let dx = -radiusMetres; dx <= radiusMetres; dx += raster.cell) {
          if (classAt(worldX + dx, worldZ + dz) !== first) return 0;
        }
      }
      return first;
    },
  });
}

/** The probe grid for one window, in EPSG:3006. */
export function probeLattice({ centreEpsg3006, spanMetres, lattice }) {
  const [centreEasting, centreNorthing] = centreEpsg3006;
  const half = spanMetres / 2;
  const probes = [];
  for (let row = 0; row < lattice; row++) {
    for (let column = 0; column < lattice; column++) {
      probes.push({
        easting: centreEasting - half + (column + 0.5) * spanMetres / lattice,
        northing: centreNorthing - half + (row + 0.5) * spanMetres / lattice,
      });
    }
  }
  return probes;
}

/** Split a probe grid into confident tree and open probes by the legacy
    raster, discarding everything on a stand edge or outside the raster. */
export function classifyProbes({ probes, cover, toWorld, uniformRadiusMetres }) {
  const trees = [];
  const open = [];
  let unusable = 0;
  for (const probe of probes) {
    const [worldX, worldZ] = toWorld(probe.easting, probe.northing);
    const label = cover.uniformClassAt(worldX, worldZ, uniformRadiusMetres);
    if (label === 3) trees.push(probe);
    else if (label === 2) open.push(probe);
    else unusable++;
  }
  return { trees, open, unusable };
}

/**
 * Where to put the one window, decided from the LEGACY RASTER ALONE.
 *
 * A window centred on the course centre is 90% mown ground -- 122 tree probes
 * against 1166 open -- which measures the open side beautifully and the forest
 * barely at all. So the centre is swept over a stated grid and scored by the
 * SMALLER of the two probe counts, which is sample adequacy, not the answer.
 *
 * This cannot bias the comparison, and the reason is worth stating: at
 * selection time not one LiDAR byte has been read, so the score is computed
 * from a record that knows nothing about the values being compared. If
 * anything it makes the test harder — a balanced window is one with a clean
 * forest/open boundary running through it, which is exactly where a frame
 * error between the two records would show.
 */
export function chooseBalancedWindow({
  centreEpsg3006,
  cover,
  toWorld,
  spanMetres,
  lattice,
  uniformRadiusMetres,
  searchRadiusMetres = 600,
  searchStepMetres = 50,
}) {
  finitePositive(searchStepMetres, 'searchStepMetres');
  let best = null;
  for (let dy = -searchRadiusMetres; dy <= searchRadiusMetres; dy += searchStepMetres) {
    for (let dx = -searchRadiusMetres; dx <= searchRadiusMetres; dx += searchStepMetres) {
      const focus = [centreEpsg3006[0] + dx, centreEpsg3006[1] + dy];
      const split = classifyProbes({
        probes: probeLattice({ centreEpsg3006: focus, spanMetres, lattice }),
        cover, toWorld, uniformRadiusMetres,
      });
      const score = Math.min(split.trees.length, split.open.length);
      const offset = Math.hypot(dx, dy);
      /* Deterministic: a strictly better score wins, and an equal score only
         wins if it sits closer to the course centre. */
      if (!best || score > best.score || (score === best.score && offset < best.offsetMetres)) {
        best = {
          focusEpsg3006: focus,
          offsetMetres: offset,
          score,
          treeProbes: split.trees.length,
          openProbes: split.open.length,
          unusableProbes: split.unusable,
        };
      }
    }
  }
  if (!best || best.score < 1) throw new Error('no candidate window contains both tree and open probes');
  /* A best that sits on the edge of its own search is not an optimum, it is
     "as far as we were allowed to go" -- the same trap the routing sweep hit
     when it asked for 80 m corridors shifted 34 m. Report it rather than let
     the rule read as converged. */
  const searchConverged = Math.max(
    Math.abs(best.focusEpsg3006[0] - centreEpsg3006[0]),
    Math.abs(best.focusEpsg3006[1] - centreEpsg3006[1]),
  ) <= searchRadiusMetres - searchStepMetres;
  return Object.freeze({
    ...best,
    offsetMetres: +best.offsetMetres.toFixed(1),
    searchRadiusMetres,
    searchStepMetres,
    searchConverged,
    rule: `centre swept +/-${searchRadiusMetres} m in ${searchStepMetres} m steps about the course centre, scored by the smaller of the tree and open probe counts in the legacy raster, before any point cloud is read`,
  });
}

function fraction(count, total) {
  return total ? +(count / total).toFixed(4) : 0;
}

/**
 * How well does a canopy-height threshold reproduce the satellite's own
 * classes? Reported at the pre-declared threshold, and separately at the
 * threshold that happens to score best -- the second is labelled `fitted`
 * because a number chosen after seeing the data is not the same kind of
 * evidence as one chosen before.
 */
export function canopyAgreement({ treeHeights, openHeights, thresholdMetres = CANOPY_THRESHOLD_METRES }) {
  const trees = [...treeHeights].filter(Number.isFinite);
  const open = [...openHeights].filter(Number.isFinite);
  if (!trees.length || !open.length) throw new Error('canopy agreement needs finite samples on both sides');
  const score = threshold => {
    const treeRecall = fraction(trees.filter(value => value >= threshold).length, trees.length);
    const openSpecificity = fraction(open.filter(value => value < threshold).length, open.length);
    return {
      thresholdMetres: +threshold.toFixed(2),
      treeRecall,
      openSpecificity,
      balancedAgreement: +((treeRecall + openSpecificity) / 2).toFixed(4),
    };
  };
  let best = null;
  for (let threshold = 0.5; threshold <= 12.001; threshold += 0.5) {
    const candidate = score(threshold);
    if (!best || candidate.balancedAgreement > best.balancedAgreement) best = candidate;
  }
  return Object.freeze({
    counts: Object.freeze({ trees: trees.length, open: open.length }),
    declared: Object.freeze(score(thresholdMetres)),
    fitted: Object.freeze({ ...best, note: 'chosen after seeing these samples; weaker evidence than the declared threshold' }),
  });
}
