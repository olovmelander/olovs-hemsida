const TILE_ID = /^l([0-9]+)\/([0-9]+)\/([0-9]+)$/;

const PROFILE_DATA = {
  webgpu: {
    desktop: { targetErrorPixels: 1, maximumSelectedTiles: 48 },
    mobile: { targetErrorPixels: 1.75, maximumSelectedTiles: 24 },
  },
  webgl2: {
    desktop: { targetErrorPixels: 1.5, maximumSelectedTiles: 32 },
    mobile: { targetErrorPixels: 2.5, maximumSelectedTiles: 16 },
  },
};

export const TERRAIN_TILE_QUALITY_PROFILES = Object.freeze(Object.fromEntries(
  Object.entries(PROFILE_DATA).map(([backend, variants]) => [backend, Object.freeze(Object.fromEntries(
    Object.entries(variants).map(([device, profile]) => [device, Object.freeze(profile)]),
  ))]),
));

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function positiveInteger(value, label, maximum = 4096) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function parseTile(tile) {
  const match = TILE_ID.exec(tile?.id || '');
  if (!match) throw new Error(`terrain tile ${JSON.stringify(tile?.id)} does not use l<lod>/<column>/<row>`);
  const lod = Number(match[1]);
  const column = Number(match[2]);
  const row = Number(match[3]);
  if (tile.lod !== lod) throw new Error(`terrain tile ${tile.id} has inconsistent LOD metadata`);
  if (!tile.bounds || !tile.layers?.terrain || !Number.isFinite(tile.geometricErrorMetres) ||
      tile.geometricErrorMetres < 0) {
    throw new Error(`terrain tile ${tile.id} is missing verified bounds, error or terrain data`);
  }
  return Object.freeze({ ...tile, lod, column, row });
}

function containsHorizontal(parent, child) {
  const epsilon = 1e-6;
  return child.bounds.minEasting >= parent.bounds.minEasting - epsilon &&
    child.bounds.maxEasting <= parent.bounds.maxEasting + epsilon &&
    child.bounds.minNorthing >= parent.bounds.minNorthing - epsilon &&
    child.bounds.maxNorthing <= parent.bounds.maxNorthing + epsilon;
}

function distanceToBounds(camera, bounds, minimumDistanceMetres) {
  const easting = Math.max(bounds.minEasting, Math.min(bounds.maxEasting, camera.easting));
  const northing = Math.max(bounds.minNorthing, Math.min(bounds.maxNorthing, camera.northing));
  const height = Math.max(bounds.minHeightRH2000, Math.min(bounds.maxHeightRH2000, camera.heightRH2000));
  return Math.max(minimumDistanceMetres, Math.hypot(
    camera.easting - easting,
    camera.northing - northing,
    camera.heightRH2000 - height,
  ));
}

function projectedError(tile, camera, projectionScale, minimumDistanceMetres) {
  return tile.geometricErrorMetres * projectionScale /
    distanceToBounds(camera, tile.bounds, minimumDistanceMetres);
}

function candidateOrder(left, right) {
  return Number(right.forced) - Number(left.forced) ||
    right.errorPixels - left.errorPixels ||
    left.tile.id.localeCompare(right.tile.id);
}

function idOrder(left, right) {
  return left.localeCompare(right, 'en');
}

export function terrainTileQualityProfile({ backend, mobile = false } = {}) {
  const variants = TERRAIN_TILE_QUALITY_PROFILES[backend];
  if (!variants) throw new Error('backend must be webgpu or webgl2');
  if (typeof mobile !== 'boolean') throw new TypeError('mobile must be boolean');
  return variants[mobile ? 'mobile' : 'desktop'];
}

/**
 * Backend-neutral quadtree planner. It chooses the same terrain truth for
 * WebGPU and WebGL2; only the supplied quality budget differs.
 */
export class TerrainTileManager {
  constructor({ ground, courseSlug } = {}) {
    if (!ground?.shell?.url || !Array.isArray(ground.tiles) || !ground.tiles.length) {
      throw new TypeError('a verified ground manifest with shell and terrain tiles is required');
    }
    if (typeof courseSlug !== 'string' || !courseSlug) throw new TypeError('courseSlug is required');
    this.ground = ground;
    this.courseSlug = courseSlug;
    this.tiles = new Map();
    for (const source of ground.tiles) {
      if (!source.courses?.includes(courseSlug)) continue;
      const tile = parseTile(source);
      if (this.tiles.has(tile.id)) throw new Error(`duplicate terrain tile ${tile.id}`);
      this.tiles.set(tile.id, tile);
    }
    if (!this.tiles.size) throw new Error(`ground has no terrain tiles for course ${courseSlug}`);

    this.parentById = new Map();
    this.childrenById = new Map([...this.tiles.keys()].map(tileId => [tileId, []]));
    for (const tile of this.tiles.values()) {
      /* a ring-compiled graph names parents explicitly, because its levels do
         not share one index lattice; a pyramid graph leaves them to index
         arithmetic, as before */
      const explicit = tile.parentId !== undefined;
      const parentId = explicit
        ? tile.parentId
        : `l${tile.lod + 1}/${Math.floor(tile.column / 2)}/${Math.floor(tile.row / 2)}`;
      if (parentId === null) continue;
      const parent = this.tiles.get(parentId);
      if (!parent) {
        if (explicit) throw new Error(`terrain tile ${tile.id} names parent ${parentId}, which this course does not carry`);
        continue;
      }
      if (explicit && parent.lod !== tile.lod + 1) {
        throw new Error(`terrain parent ${parentId} of ${tile.id} is not one level coarser`);
      }
      if (!containsHorizontal(parent, tile)) {
        throw new Error(`terrain parent ${parentId} does not contain child ${tile.id}`);
      }
      this.parentById.set(tile.id, parentId);
      this.childrenById.get(parentId).push(tile.id);
    }
    for (const [parentId, children] of this.childrenById) {
      children.sort(idOrder);
      /* a refined tile is replaced by its children and nothing else draws its
         ground, so a parent with some but not all four is a hole waiting to
         open; the compiler refuses such rings and the runtime does too */
      if (children.length !== 0 && children.length !== 4) {
        throw new Error(`terrain tile ${parentId} has ${children.length} children; a quadtree parent has four or none`);
      }
    }
    this.roots = Object.freeze([...this.tiles.values()]
      .filter(tile => !this.parentById.has(tile.id))
      .sort((left, right) => right.lod - left.lod || idOrder(left.id, right.id)));
    this.maximumLod = Math.max(...[...this.tiles.values()].map(tile => tile.lod));
    this.refined = new Set();
  }

  resetHysteresis() {
    this.refined.clear();
  }

  plan({
    camera,
    viewportHeightPixels,
    fieldOfViewYRadians,
    targetErrorPixels,
    maximumSelectedTiles,
    residentTileIds = [],
    activeTileIds = [],
    visible = () => true,
    hysteresisRatio = 0.15,
    minimumDistanceMetres = 0.5,
  } = {}) {
    if (!camera) throw new TypeError('camera is required');
    const cameraPosition = Object.freeze({
      easting: finite(camera.easting, 'camera.easting'),
      northing: finite(camera.northing, 'camera.northing'),
      heightRH2000: finite(camera.heightRH2000, 'camera.heightRH2000'),
    });
    positiveInteger(viewportHeightPixels, 'viewportHeightPixels', 32768);
    finite(fieldOfViewYRadians, 'fieldOfViewYRadians');
    if (fieldOfViewYRadians <= 0.05 || fieldOfViewYRadians >= Math.PI - 0.05) {
      throw new RangeError('fieldOfViewYRadians lies outside the supported perspective range');
    }
    finite(targetErrorPixels, 'targetErrorPixels');
    if (targetErrorPixels <= 0 || targetErrorPixels > 64) {
      throw new RangeError('targetErrorPixels must be above zero and at most 64');
    }
    positiveInteger(maximumSelectedTiles, 'maximumSelectedTiles', 4096);
    finite(hysteresisRatio, 'hysteresisRatio');
    if (hysteresisRatio < 0 || hysteresisRatio >= 0.5) {
      throw new RangeError('hysteresisRatio must be from zero up to but excluding 0.5');
    }
    finite(minimumDistanceMetres, 'minimumDistanceMetres');
    if (minimumDistanceMetres <= 0) throw new RangeError('minimumDistanceMetres must be positive');
    if (typeof visible !== 'function') throw new TypeError('visible must be a function');

    const resident = residentTileIds instanceof Set ? residentTileIds : new Set(residentTileIds);
    const active = activeTileIds instanceof Set ? activeTileIds : new Set(activeTileIds);
    for (const tileId of active) {
      if (!this.tiles.has(tileId)) throw new Error(`active terrain tile ${tileId} is not in this course`);
    }
    const forcedPath = new Set();
    for (const tileId of active) {
      let cursor = tileId;
      while (cursor) {
        forcedPath.add(cursor);
        cursor = this.parentById.get(cursor);
      }
    }

    const visibility = new Map();
    const isVisible = tile => {
      if (!visibility.has(tile.id)) visibility.set(tile.id, forcedPath.has(tile.id) || Boolean(visible(tile)));
      return visibility.get(tile.id);
    };
    const projectionScale = viewportHeightPixels / (2 * Math.tan(fieldOfViewYRadians / 2));
    const errors = new Map();
    const errorPixels = tile => {
      if (!errors.has(tile.id)) {
        errors.set(tile.id, projectedError(tile, cameraPosition, projectionScale, minimumDistanceMetres));
      }
      return errors.get(tile.id);
    };
    const enterThreshold = targetErrorPixels * (1 + hysteresisRatio);
    const exitThreshold = targetErrorPixels * (1 - hysteresisRatio);
    const shouldRefine = tile => {
      if (!this.childrenById.get(tile.id)?.length) return false;
      if (forcedPath.has(tile.id)) return true;
      return errorPixels(tile) > (this.refined.has(tile.id) ? exitThreshold : enterThreshold);
    };

    const frontier = new Map();
    const candidates = [];
    const enqueue = tile => {
      if (!isVisible(tile)) return;
      frontier.set(tile.id, tile);
      if (shouldRefine(tile)) {
        candidates.push({ tile, forced: forcedPath.has(tile.id), errorPixels: errorPixels(tile) });
        candidates.sort(candidateOrder);
      }
    };
    for (const root of this.roots) enqueue(root);

    const refined = new Set();
    let budgetExceededByActive = false;
    while (candidates.length) {
      const candidate = candidates.shift();
      if (!frontier.has(candidate.tile.id)) continue;
      const children = this.childrenById.get(candidate.tile.id)
        .map(tileId => this.tiles.get(tileId))
        .filter(isVisible);
      if (!children.length) continue;
      const nextSize = frontier.size - 1 + children.length;
      if (nextSize > maximumSelectedTiles && !candidate.forced) continue;
      if (nextSize > maximumSelectedTiles) budgetExceededByActive = true;
      frontier.delete(candidate.tile.id);
      refined.add(candidate.tile.id);
      for (const child of children) enqueue(child);
    }
    this.refined = refined;

    const desired = [...frontier.values()].sort((left, right) => idOrder(left.id, right.id));
    const fallbackIds = new Set();
    let missingRegularCoverage = false;
    for (const tile of desired) {
      let cursor = tile.id;
      while (cursor && !resident.has(cursor)) cursor = this.parentById.get(cursor);
      if (cursor) fallbackIds.add(cursor);
      else missingRegularCoverage = true;
    }
    const renderIds = missingRegularCoverage
      ? (resident.has('shell') ? ['shell'] : [])
      : [...fallbackIds].filter(tileId => {
        let parentId = this.parentById.get(tileId);
        while (parentId) {
          if (fallbackIds.has(parentId)) return false;
          parentId = this.parentById.get(parentId);
        }
        return true;
      }).sort(idOrder);

    const requests = new Map();
    const request = (tileId, reference, priority, pixels, activePath) => {
      if (resident.has(tileId)) return;
      const prior = requests.get(tileId);
      if (!prior || priority < prior.priority) {
        requests.set(tileId, Object.freeze({
          tileId,
          reference,
          priority,
          errorPixels: pixels,
          activePath,
        }));
      }
    };
    request('shell', this.ground.shell, -1_000_000, Number.POSITIVE_INFINITY, true);
    for (const tile of desired) {
      const path = [];
      let cursor = tile;
      while (cursor) {
        path.push(cursor);
        cursor = this.tiles.get(this.parentById.get(cursor.id));
      }
      path.reverse();
      for (const pathTile of path) {
        const activePath = forcedPath.has(pathTile.id);
        const priority = (activePath ? -100_000 : 0) +
          (this.maximumLod - pathTile.lod) * 1_000 -
          Math.min(999, errorPixels(pathTile));
        request(pathTile.id, pathTile.layers.terrain, priority, errorPixels(pathTile), activePath);
      }
    }

    /* Every ancestor of a desired tile stays wanted while it is resident: it
       is the fallback that covers the ground until the children arrive and
       the parent the children geomorph from. Dropping it once the children
       rendered made the next plan request it again, and a pool that still
       held it answered at once -- a promise chain that never let a timer
       fire and froze the boot. */
    const retain = new Set();
    for (const tile of desired) {
      let cursor = tile.id;
      while (cursor) { retain.add(cursor); cursor = this.parentById.get(cursor); }
    }
    return Object.freeze({
      desiredTileIds: Object.freeze(desired.map(tile => tile.id)),
      retainTileIds: Object.freeze([...retain].sort(idOrder)),
      renderTileIds: Object.freeze(renderIds),
      requests: Object.freeze([...requests.values()].sort((left, right) =>
        left.priority - right.priority || idOrder(left.tileId, right.tileId))),
      refinedTileIds: Object.freeze([...refined].sort(idOrder)),
      shellRequired: missingRegularCoverage,
      coverageComplete: !missingRegularCoverage || resident.has('shell'),
      budgetExceededByActive,
      selectedTiles: desired.length,
      targetErrorPixels,
    });
  }
}
