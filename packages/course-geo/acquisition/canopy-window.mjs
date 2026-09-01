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
 * Pass one: stream the bounded window out of the COPC to a local file.
 *
 * This exists because of a measurement. Reading the window and deriving canopy
 * in ONE non-streaming pipeline returned 358 points over 512 x 512 m — 0.08%
 * of the advertised 1.7 pts/m² — while the sibling statistics pipeline, whose
 * reader is configured identically, reads the same product densely enough to
 * pass a 10%-of-advertised density gate. The one structural difference was
 * `--stream`, which that pipeline uses and this one could not, because
 * `filters.hag_nn` has to see the window's ground returns before it can
 * measure anything above them.
 *
 * So the read is streamed exactly the way the working path streams it, and the
 * height derivation happens afterwards against a local file. It also means the
 * second pass carries no credentials at all.
 */
export function canopyWindowStreamPipeline(plan, credentials, { outputPath, authorizationHeaders } = {}) {
  if (!credentials) throw new Error('Lantmäteriet credentials are required for Laserdata Skog');
  if (typeof authorizationHeaders !== 'function') {
    throw new TypeError('authorizationHeaders builder is required');
  }
  if (typeof outputPath !== 'string' || !outputPath) throw new TypeError('outputPath is required');
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
      type: 'writers.las',
      filename: outputPath,
      compression: true,
      /* Keep the source's own point format: rewriting it would be a second
         chance to lose the classification hag_nn needs. */
      forward: 'all',
    }),
  ]);
}

/**
 * Pass two: canopy height from the local window, with no credentials in sight.
 *
 * `filters.hag_nn` measures every return against the ground returns in the
 * SAME cloud, so the result is a height above ground rather than a difference
 * between two products that were georeferenced independently. That matters:
 * a DTM-subtracted CHM inherits both products' registration error, and here
 * there is none to inherit.
 *
 * Points are counted on BOTH sides of hag_nn. One count could not say whether
 * a thin raster meant the points never arrived or were eaten on the way, and
 * that question cost a CI round to answer.
 *
 * There is deliberately no `filters.head` cap anywhere. Truncating a point
 * stream is harmless for statistics and quietly punches holes in a raster, so
 * an over-dense window is REFUSED in pass one instead.
 */
export function canopyHeightPipeline(localPath, {
  resolutionMetres = CANOPY_RESOLUTION_METRES,
  outputPath,
} = {}) {
  if (typeof localPath !== 'string' || !localPath) throw new TypeError('localPath is required');
  if (typeof outputPath !== 'string' || !outputPath) throw new TypeError('outputPath is required');
  finitePositive(resolutionMetres, 'resolutionMetres');
  return Object.freeze([
    Object.freeze({ type: 'readers.las', filename: localPath }),
    Object.freeze({
      type: 'filters.stats',
      tag: 'afterReader',
      dimensions: 'X,Y,Z,Classification',
      count: 'Classification',
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
      type: 'filters.stats',
      tag: 'beforeWriter',
      dimensions: 'X,Y,Z,HeightAboveGround,Classification',
      count: 'Classification',
    }),
    Object.freeze({
      type: 'writers.gdal',
      filename: outputPath,
      gdaldriver: 'GTiff',
      dimension: 'HeightAboveGround',
      output_type: 'max',
      resolution: resolutionMetres,
      nodata: -9999,
      /* PDAL's own default, resolution*sqrt(2) -- the circle that just covers
         a cell's diagonal. Narrower than this leaves corners unreachable and
         starts punching nodata into ground that was actually surveyed; wider
         starts letting a neighbouring crown fill an empty cell, and an
         invented tree is worse than a recorded gap. */
      radius: +(resolutionMetres * Math.SQRT2).toFixed(4),
    }),
  ]);
}

/* Ground returns only: a crown's reflectance says nothing about the turf under
   it, and 0.5 m keeps mown grass while dropping scrub and branches. */
export const SURFACE_INTENSITY_MAX_HAG_METRES = 0.5;
export const SURFACE_INTENSITY_RESOLUTION_METRES = 2;

/**
 * Surface reflectance from the point cloud we can already read.
 *
 * This exists because every other route to surface outlines is closed without
 * a club relationship: the 1 m height model resolves no surface class, Esri is
 * RGB and separates nothing, and the orthophoto needs an order. But a LiDAR
 * return carries INTENSITY, and Laserdata Skog is flown at 1064 nm — the near
 * infrared the orthophoto's NDVI would have used. Healthy turf reflects far
 * more there than dry sand, so intensity is a pseudo-NIR band on a source this
 * account is already entitled to.
 *
 * Two honest limits, stated in the report rather than buried: intensity is not
 * radiometrically calibrated between flight lines, so only relative
 * comparisons inside one window mean anything; and this is a FOREST product,
 * so its intensity handling is tuned for canopy, not turf.
 */
export function surfaceIntensityPipeline(localPath, {
  resolutionMetres = SURFACE_INTENSITY_RESOLUTION_METRES,
  outputPath,
} = {}) {
  if (typeof localPath !== 'string' || !localPath) throw new TypeError('localPath is required');
  if (typeof outputPath !== 'string' || !outputPath) throw new TypeError('outputPath is required');
  finitePositive(resolutionMetres, 'resolutionMetres');
  return Object.freeze([
    Object.freeze({ type: 'readers.las', filename: localPath }),
    Object.freeze({ type: 'filters.hag_nn', count: 1, allow_extrapolation: false }),
    /* Ground-level returns only. Without this the raster measures whatever
       stands on the ground rather than the ground itself. */
    Object.freeze({
      type: 'filters.range',
      limits: `HeightAboveGround[0:${SURFACE_INTENSITY_MAX_HAG_METRES}]`,
    }),
    Object.freeze({
      type: 'filters.stats',
      tag: 'beforeWriter',
      dimensions: 'X,Y,Z,Intensity,HeightAboveGround,Classification',
      count: 'Classification',
    }),
    Object.freeze({
      type: 'writers.gdal',
      filename: outputPath,
      gdaldriver: 'GTiff',
      dimension: 'Intensity',
      /* Mean, not max: a single specular return would otherwise decide a cell,
         and reflectance is the average property of the surface. */
      output_type: 'mean',
      resolution: resolutionMetres,
      nodata: -9999,
      radius: +(resolutionMetres * Math.SQRT2).toFixed(4),
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

/* ------------------------------------------------- is it sparse, or truncated?

   Both the canopy pipeline and the older statistics pipeline read about 0.07%
   of the advertised point density from this delivery: 358 points over 512 m,
   52 over 256 m. Identical reader configuration, so it is not the canopy
   pipeline's doing -- and 0.0014 pts/m² over a whole tile is roughly what a
   COPC octree ROOT NODE holds. Two readings tell those apart, and neither
   retains a byte of the cloud.

   The header says how many points the file claims in total, and over what
   extent. Sparse data has a small header count; a truncated read has a large
   one and returns almost none of it. */
export function copcHeaderPipeline(plan, credentials, { authorizationHeaders } = {}) {
  if (!credentials) throw new Error('Lantmäteriet credentials are required for Laserdata Skog');
  if (typeof authorizationHeaders !== 'function') {
    throw new TypeError('authorizationHeaders builder is required');
  }
  if (!plan?.source?.sourceUrl) throw new TypeError('a laser window plan with a source URL is required');
  return Object.freeze([
    Object.freeze({
      type: 'readers.copc',
      filename: Object.freeze({
        path: plan.source.sourceUrl,
        headers: authorizationHeaders(credentials),
      }),
      /* No `bounds`: the question is what the FILE declares, not what a window
         of it contains. */
      requests: 1,
    }),
    /* One point is enough to make PDAL open the file and publish its header;
       everything reported comes from that header, not from the point. */
    Object.freeze({ type: 'filters.head', count: 1 }),
    Object.freeze({ type: 'writers.null' }),
  ]);
}

/** Read the declared totals out of a `pdal pipeline --metadata` document. */
export function copcHeaderSummary(metadata) {
  const stack = [metadata];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) { stack.push(...node); continue; }
    const looksLikeReader = typeof node.count === 'number'
      && ['minx', 'maxx', 'miny', 'maxy'].every(key => Number.isFinite(node[key]));
    if (looksLikeReader) {
      const area = Math.max(1, (node.maxx - node.minx) * (node.maxy - node.miny));
      return Object.freeze({
        available: true,
        declaredPointCount: node.count,
        boundsEpsg3006: Object.freeze([node.minx, node.miny, node.maxx, node.maxy]),
        declaredDensityPerSquareMetre: +(node.count / area).toFixed(4),
        softwareId: typeof node.software_id === 'string' ? node.software_id : null,
      });
    }
    stack.push(...Object.values(node));
  }
  return Object.freeze({ available: false, note: 'PDAL published no reader header metadata' });
}

/**
 * Does the delivery honour HTTP Range at all? A COPC reader that cannot make
 * partial requests can only ever see the root page, whatever it asks for.
 *
 * Returns status and range headers only -- never a byte of the body, and never
 * anything derived from the credentials.
 */
export async function probeRangeSupport(url, credentials, {
  authorizationHeaders,
  fetchImpl = globalThis.fetch,
  timeoutMilliseconds = 20_000,
} = {}) {
  if (typeof authorizationHeaders !== 'function') {
    throw new TypeError('authorizationHeaders builder is required');
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetchImpl(url, {
      headers: { ...authorizationHeaders(credentials), Range: 'bytes=0-1' },
      redirect: 'follow',
      signal: controller.signal,
    });
    await response.body?.cancel?.('only the headers are wanted');
    const header = name => response.headers?.get?.(name) ?? null;
    return Object.freeze({
      available: true,
      status: response.status,
      /* 206 means partial reads work; 200 means the server ignored the range
         and would hand PDAL the whole file for every request it makes. */
      partialContent: response.status === 206,
      acceptRanges: header('accept-ranges'),
      contentRange: header('content-range'),
      contentLength: header('content-length'),
    });
  } catch (error) {
    return Object.freeze({
      available: false,
      error: error?.name === 'AbortError' ? 'range probe timed out' : 'range probe failed',
    });
  } finally {
    clearTimeout(timer);
  }
}
