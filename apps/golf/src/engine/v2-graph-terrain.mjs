/* The whole world from one source: the manifest-driven streaming runtime,
   placed in the legacy frame, as the ONLY terrain.
 *
 * The fixed-frontier pilot replaced the legacy CORE with 64 one-metre tiles
 * and left the 12 m and 36 m Terrarium rings around it; where the two met,
 * heights disagreed by metres and the seam showed as a dark band, a gap and
 * a lit skirt. A ring-compiled ground graph (packages/course-v2/terrain-rings.mjs)
 * carries the same 64 course tiles inside nested rings of 2, 4, 8 m and
 * coarser Lantmäteriet data to a 16 km root, so every seam is a same-source
 * level-of-detail seam, sealed by the batch's own geomorph and skirts. This
 * adapter drives the streaming runtime over that graph in the pilot's own
 * bridge, keeps a CPU sampler of every ring resident for construction, and
 * exposes the narrow height/tick/snapshot boundary main.js already speaks.
 *
 * The retained pilot source is still used for what it is good at: its 1 m
 * sampler over the course and the surface atlas that paints it.               */
import * as THREE from 'three/webgpu';
import { verifyChunkAssetWeb } from '../../../../packages/course-v2/runtime/decode-web.mjs';
import { resolveV2AssetUrl } from '../../../../packages/course-v2/runtime/http.mjs';
import { detectFlatWater, rasterFromRingTiles } from './v2-flat-water.mjs';
import { buildWaterBedField, carveTerrainTile } from './v2-water-bed.mjs';

const EPSILON = 1e-6;
const UINT16_NO_DATA_DEFAULT = 65535;

function errorText(error) {
  return String(error?.message || error).slice(0, 300);
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

/** True when a published graph reaches beyond the pilot's course window: a ring graph. */
export function graphCoversHorizon(ground, previewBounds) {
  if (!ground?.bounds || !previewBounds) return false;
  const groundSpan = Math.min(ground.bounds.maxEasting - ground.bounds.minEasting, ground.bounds.maxNorthing - ground.bounds.minNorthing);
  const previewSpan = Math.min(previewBounds.maxEasting - previewBounds.minEasting, previewBounds.maxNorthing - previewBounds.minNorthing);
  return groundSpan >= previewSpan * 2 - EPSILON && ground.tiles.some(tile => tile.parentId !== undefined);
}

/**
 * A frustum test that a large terrain tile cannot fool. Testing an axis
 * box against the six planes only asks whether the box lies wholly outside
 * ONE plane; an 8 km tile beside a narrow downward pyramid is outside no
 * single plane and passes, while its 4 km children fail -- so the planner
 * kept 32 m ground next to the 1 m course. This adds the other half: the
 * frustum's twelve edges are clipped to the tile's own height slab and the
 * footprint of that section must overlap the tile's footprint. The eight
 * corners come from unprojecting clip space, so the test follows whatever
 * projection and clip convention the camera uses.
 */
export function createTileFrustumTester(localToClip, { coordinateSystem = 2001, reversedDepth = false } = {}) {
  const frustum = new THREE.Frustum();
  /* the camera's depth direction decides which of the six planes is near and which far;
     with a reversed depth buffer and the default here, every tile failed the test and the
     world was sky */
  frustum.setFromProjectionMatrix(localToClip, coordinateSystem, reversedDepth);
  const inverse = new THREE.Matrix4().copy(localToClip).invert();
  const nearZ = coordinateSystem === 2000 ? -1 : 0; /* WebGL clips z to [-1,1], WebGPU to [0,1] */
  const corners = [];
  for (const z of [nearZ, 1]) for (const y of [-1, 1]) for (const x of [-1, 1]) {
    corners.push(new THREE.Vector3(x, y, z).applyMatrix4(inverse));
  }
  /* near quad 0..3, far quad 4..7: four lateral edges, and the two quads */
  const edges = [[0, 4], [1, 5], [2, 6], [3, 7], [0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4]];
  const box = new THREE.Box3();
  return function intersects(min, max) {
    box.set(min, max);
    if (!frustum.intersectsBox(box)) return false;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const take = (x, z) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    };
    for (const corner of corners) if (corner.y >= min.y && corner.y <= max.y) take(corner.x, corner.z);
    for (const [a, b] of edges) {
      const p = corners[a], q = corners[b];
      const dy = q.y - p.y;
      if (Math.abs(dy) < 1e-9) continue;
      for (const yPlane of [min.y, max.y]) {
        const t = (yPlane - p.y) / dy;
        if (t >= 0 && t <= 1) take(p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t);
      }
    }
    if (minX === Infinity) return false; /* the frustum never reaches the tile's heights */
    return maxX >= min.x && minX <= max.x && maxZ >= min.z && minZ <= max.z;
  };
}

/* Compose scale-after-rotation about the legacy origin, which a Group's own
   T*R*S cannot express when the scale is anisotropic (see main.js). */
export function applyBridgeTransform(group, bridge) {
  if (!Number.isFinite(bridge?.rotationRadians) || !Number.isFinite(bridge?.scaleX) || !Number.isFinite(bridge?.scaleZ)) {
    throw new TypeError('the v2 terrain group needs the legacy grid bridge');
  }
  const cos = Math.cos(bridge.rotationRadians), sin = Math.sin(bridge.rotationRadians);
  group.matrix.set(
    bridge.scaleX * cos, 0, -bridge.scaleX * sin, 0,
    0, 1, 0, 0,
    bridge.scaleZ * sin, 0, bridge.scaleZ * cos, 0,
    0, 0, 0, 1,
  );
  group.matrixAutoUpdate = false;
  group.updateMatrixWorld(true);
  return group;
}

/**
 * A CPU height sampler over decoded ring tiles in bridged grid space
 * (x = easting - legacy origin easting, z = legacy origin northing - northing,
 * heights on the legacy datum). Finest level first.
 */
export function createRingHeightSampler({ levels, legacyOrigin, verticalDatumOffsetMetres }) {
  finite(legacyOrigin?.easting, 'legacyOrigin.easting');
  finite(legacyOrigin?.northing, 'legacyOrigin.northing');
  finite(verticalDatumOffsetMetres, 'verticalDatumOffsetMetres');
  const prepared = [...levels].sort((left, right) => left.lod - right.lod).map(level => {
    if (!level.tiles.length) throw new Error(`ring level ${level.lod} has no tiles`);
    const first = level.tiles[0];
    const span = first.bounds.maxEasting - first.bounds.minEasting;
    let minX = Infinity, minZ = Infinity;
    for (const tile of level.tiles) {
      minX = Math.min(minX, tile.bounds.minEasting - legacyOrigin.easting);
      minZ = Math.min(minZ, legacyOrigin.northing - tile.bounds.maxNorthing);
    }
    const byCell = new Map();
    for (const tile of level.tiles) {
      const { grid, payload } = tile;
      if (payload.byteLength !== grid.width * grid.height * 2) throw new Error(`tile ${tile.id} payload does not match its grid`);
      const x0 = tile.bounds.minEasting - legacyOrigin.easting;
      const z0 = legacyOrigin.northing - tile.bounds.maxNorthing;
      const column = Math.round((x0 - minX) / span), row = Math.round((z0 - minZ) / span);
      byCell.set(`${column},${row}`, {
        id: tile.id, x0, z0, span,
        width: grid.width, height: grid.height,
        spacing: grid.sampleSpacingMetres,
        offset: grid.heightOffsetMetres + verticalDatumOffsetMetres,
        scale: grid.heightScaleMetres,
        noData: grid.noDataValue ?? UINT16_NO_DATA_DEFAULT,
        payload,
      });
    }
    return { lod: level.lod, minX, minZ, span, byCell };
  });
  const quantized = (tile, column, row) => {
    const offset = (row * tile.width + column) * 2;
    return tile.payload[offset] | tile.payload[offset + 1] << 8;
  };
  const sampleTile = (tile, x, z) => {
    const fx = (x - tile.x0) / tile.spacing, fz = (z - tile.z0) / tile.spacing;
    if (fx < -EPSILON || fz < -EPSILON || fx > tile.width - 1 + EPSILON || fz > tile.height - 1 + EPSILON) return Number.NaN;
    const cx = Math.min(tile.width - 1, Math.max(0, fx)), cz = Math.min(tile.height - 1, Math.max(0, fz));
    const west = Math.floor(cx), north = Math.floor(cz);
    const east = Math.min(tile.width - 1, west + 1), south = Math.min(tile.height - 1, north + 1);
    const a = quantized(tile, west, north), b = quantized(tile, east, north);
    const c = quantized(tile, west, south), d = quantized(tile, east, south);
    if (a === tile.noData || b === tile.noData || c === tile.noData || d === tile.noData) return Number.NaN;
    const tx = cx - west, tz = cz - north;
    const top = a + (b - a) * tx, bottom = c + (d - c) * tx;
    return tile.offset + (top + (bottom - top) * tz) * tile.scale;
  };
  return Object.freeze({
    levels: prepared.map(level => level.lod),
    sample(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return Number.NaN;
      for (const level of prepared) {
        const column = Math.floor((x - level.minX) / level.span), row = Math.floor((z - level.minZ) / level.span);
        const tile = level.byCell.get(`${column},${row}`);
        if (!tile) continue;
        const height = sampleTile(tile, x, z);
        if (Number.isFinite(height)) return height;
      }
      return Number.NaN;
    },
    inspect(x, z) {
      for (const level of prepared) {
        const column = Math.floor((x - level.minX) / level.span), row = Math.floor((z - level.minZ) / level.span);
        const tile = level.byCell.get(`${column},${row}`);
        if (!tile) continue;
        const height = sampleTile(tile, x, z);
        if (Number.isFinite(height)) return Object.freeze({ height, tileId: tile.id, sampleSpacingMetres: tile.spacing });
      }
      return null;
    },
  });
}

/**
 * The narrow live boundary main.js drives: requested / sourceReady / active /
 * preflightReady, constructionHeightAt / heightAt, prepare / activate / tick /
 * update / snapshot / fail / dispose. `kind` is 'graph'; the fixed-frontier
 * adapter reports 'fixed-frontier'.
 */
export class V2GraphTerrainAdapter {
  constructor({
    graph,
    source,
    courseSlug,
    backend,
    mobile = false,
    baseUrl,
    legacyOriginEpsg3006,
    profile,
    maximumCachedResources,
    fetchImpl,
    cacheStorage,
    clock = () => globalThis.performance?.now?.() ?? Date.now(),
  } = {}) {
    if (!graph?.ground?.tiles || !graph?.course?.holes) throw new TypeError('a resolved v2 graph with ground and course is required');
    if (!source?.ready || !source.bridge || typeof source.heightAt !== 'function') {
      throw new TypeError('the ready fixed-frontier source (its 1 m sampler, atlas and bridge) is required');
    }
    if (typeof courseSlug !== 'string' || !courseSlug) throw new TypeError('courseSlug is required');
    if (backend !== undefined && !['webgpu', 'webgl2'].includes(backend)) throw new Error('backend must be webgpu or webgl2');
    if (!baseUrl) throw new Error('baseUrl is required');
    finite(legacyOriginEpsg3006?.easting, 'legacyOriginEpsg3006.easting');
    finite(legacyOriginEpsg3006?.northing, 'legacyOriginEpsg3006.northing');
    this.kind = 'graph';
    this.graph = graph;
    this.source = source;
    this.courseSlug = courseSlug;
    this.backend = backend;
    this.mobile = mobile;
    this.baseUrl = baseUrl;
    this.legacyOrigin = legacyOriginEpsg3006;
    this.bridge = source.bridge;
    this.profile = profile ?? null;
    this.maximumCachedResources = maximumCachedResources ?? (mobile ? 64 : 192);
    this.fetchImpl = fetchImpl;
    this.cacheStorage = cacheStorage;
    this.clock = clock;
    this.group = new THREE.Group();
    this.group.name = 'banvy-v2-world';
    this.group.userData.tag = 'v2-terrain-world';
    this.runtime = null;
    this.rings = null;
    this.phase = 'pending';
    this.prepared = null;
    this.renderer = Object.freeze({ status: 'pending' });
    this.sourceDisposed = false;
    this.frustum = new THREE.Frustum();
    this.projection = new THREE.Matrix4();
    this.box = new THREE.Box3();
    this.min = new THREE.Vector3();
    this.max = new THREE.Vector3();
    this.lastPlan = null;
    this.knownBodies = [];
    this.waterBed = null;
    this.carvedGpuTiles = 0;
    this.tileById = new Map(this.graph.ground.tiles.map(tile => [tile.id, tile]));
  }

  get requested() { return true; }
  get sourceReady() { return this.source.ready === true; }
  get active() { return this.phase === 'ready'; }
  get preflightReady() { return this.phase === 'prepared' || this.phase === 'ready'; }
  get preparation() { return this.prepared; }
  get rendererState() { return this.renderer; }
  get frame() { return this.runtime?.ground.frame ?? null; }

  #sampleAny(worldX, worldZ) {
    /* inside water the course sampler still holds the laser's surface; the
       rings are carved, so they answer there */
    if (this.waterBed) {
      const [gx, gz] = this.bridge.toGrid(worldX, worldZ);
      if (this.waterBed.inWater(gx, gz)) {
        const carved = this.rings.sample(gx, gz);
        if (Number.isFinite(carved)) return carved;
      }
    }
    const fine = this.source.heightAt(worldX, worldZ);
    const fineHeight = Number.isFinite(fine) ? fine : fine?.height;
    if (Number.isFinite(fineHeight)) return fineHeight;
    if (!this.rings) return Number.NaN;
    const [gx, gz] = this.bridge.toGrid(worldX, worldZ);
    return this.rings.sample(gx, gz);
  }

  constructionHeightAt(worldX, worldZ) {
    if (!this.preflightReady) return Number.NaN;
    return this.#sampleAny(worldX, worldZ);
  }

  /** The world's height as soon as the rings are loaded, before any GPU work:
      what the water levels and everything measured at model time must read. */
  worldHeightAt(worldX, worldZ) {
    if (!this.rings || this.phase === 'failed' || this.phase === 'disposed') return Number.NaN;
    return this.#sampleAny(worldX, worldZ);
  }

  get ringsLoaded() { return this.rings !== null; }

  /** The backend-dependent settings, once the renderer exists. */
  configure({ backend, mobile, profile, maximumCachedResources } = {}) {
    if (backend !== undefined) {
      if (!['webgpu', 'webgl2'].includes(backend)) throw new Error('backend must be webgpu or webgl2');
      this.backend = backend;
    }
    if (mobile !== undefined) this.mobile = mobile;
    if (profile !== undefined) this.profile = profile;
    if (maximumCachedResources !== undefined) this.maximumCachedResources = maximumCachedResources;
    return this;
  }

  /**
   * Fetch and decode every ring tile on the main thread and build the CPU
   * sampler. Needs no renderer and no worker, so it can run right after the
   * graph is selected; the streaming runtime later re-reads the same bytes
   * from the browser cache for the GPU.
   */
  async loadRings({ signal } = {}) {
    if (this.rings) return this.rings.levels.length;
    const tiles = this.graph.ground.tiles.filter(tile => tile.lod >= 1 && tile.courses?.includes(this.courseSlug));
    const fetchImpl = this.fetchImpl ?? globalThis.fetch;
    const decoded = await Promise.all(tiles.map(async tile => {
      const url = resolveV2AssetUrl(tile.layers.terrain.url, this.baseUrl);
      const response = await fetchImpl(url, { signal });
      if (!response.ok) throw new Error(`ring tile ${tile.id} returned HTTP ${response.status}`);
      const chunk = await verifyChunkAssetWeb(tile.layers.terrain, new Uint8Array(await response.arrayBuffer()));
      if (chunk?.header?.kind !== 'terrain' || !chunk.payload) throw new Error(`ring tile ${tile.id} did not decode as terrain`);
      const payload = chunk.payload instanceof Uint8Array ? chunk.payload : new Uint8Array(chunk.payload);
      return { id: tile.id, lod: tile.lod, bounds: tile.bounds, grid: chunk.header.grid, payload };
    }));
    const byLod = new Map();
    for (const tile of decoded) {
      if (!byLod.has(tile.lod)) byLod.set(tile.lod, []);
      byLod.get(tile.lod).push(tile);
    }
    this.rings = createRingHeightSampler({
      levels: [...byLod].map(([lod, levelTiles]) => ({ lod, tiles: levelTiles })),
      legacyOrigin: this.legacyOrigin,
      verticalDatumOffsetMetres: this.bridge.verticalDatumOffsetMetres,
    });
    this.ringTiles = byLod;
    this.ringTileCount = decoded.length;
    return decoded.length;
  }

  /**
   * Flat water in the 4 m ring: the lakes the DTM shows that the model's
   * rings do not, or only up to the extract's bounding box. `knownBodies`
   * are the model's water rings in legacy world coordinates with their
   * levels; the result is in grid space and is also kept on the adapter.
   */
  detectFlatWater(knownBodies = [], { lod = 2 } = {}) {
    if (!this.ringTiles?.has(lod)) throw new Error(`ring level ${lod} is not loaded`);
    const raster = rasterFromRingTiles(this.ringTiles.get(lod), {
      legacyOrigin: this.legacyOrigin,
      verticalDatumOffsetMetres: this.bridge.verticalDatumOffsetMetres,
    });
    this.flatWater = detectFlatWater({
      raster,
      knownBodies,
      toLegacy: (x, z) => this.bridge.toLegacy(x, z),
    });
    this.knownBodies = knownBodies;
    return this.flatWater;
  }

  /**
   * Carve a bed under every lake the flat-water pass and the model know:
   * the laser's ground inside a lake is its surface. The CPU ring tiles are
   * rewritten in place now, and every tile the GPU decodes from here on is
   * carved by the same field, so the sampler and the picture agree.
   */
  carveWaterBeds(options = {}) {
    if (!this.flatWater) throw new Error('flat water must be detected before the beds are carved');
    if (this.waterBed) return this.waterBedSummary;
    const started = this.clock();
    const field = buildWaterBedField({
      flatWater: this.flatWater,
      knownBodies: this.knownBodies,
      toLegacy: (x, z) => this.bridge.toLegacy(x, z),
      toGrid: (x, z) => this.bridge.toGrid(x, z),
      ...options,
    });
    const fieldMilliseconds = Math.round(this.clock() - started);
    let carvedSamples = 0, carvedTiles = 0;
    for (const tiles of this.ringTiles.values()) {
      for (const tile of tiles) {
        const count = carveTerrainTile(tile, field, {
          legacyOrigin: this.legacyOrigin,
          verticalDatumOffsetMetres: this.bridge.verticalDatumOffsetMetres,
        });
        if (count) { carvedSamples += count; carvedTiles++; }
      }
    }
    const summary = Object.freeze({
      cells: field.cells,
      hectares: field.hectares,
      maximumDepthMetres: field.maximumDepthMetres,
      carvedSamples,
      carvedTiles,
      milliseconds: Math.round(this.clock() - started),
      fieldMilliseconds,
      fieldTimings: field.timings,
    });
    this.waterBed = field;
    this.waterBedSummary = summary;
    return summary;
  }

  #carveDecoded({ tileId, decoded }) {
    if (!this.waterBed || decoded?.header?.payloadFormat !== 'terrain-grid-u16-le-v1') return decoded;
    const tile = this.tileById.get(tileId);
    if (!tile) return decoded;
    const payload = decoded.payload instanceof Uint8Array ? decoded.payload : new Uint8Array(decoded.payload);
    const count = carveTerrainTile({ bounds: tile.bounds, grid: decoded.header.grid, payload }, this.waterBed, {
      legacyOrigin: this.legacyOrigin,
      verticalDatumOffsetMetres: this.bridge.verticalDatumOffsetMetres,
    });
    if (!count) return decoded;
    this.carvedGpuTiles++;
    return { ...decoded, payload, terrainRenderData: null };
  }

  /** Grid-space water test for a legacy world point, from the flat-water mask. */
  isFlatWaterAt(worldX, worldZ) {
    if (!this.flatWater) return false;
    const [gx, gz] = this.bridge.toGrid(worldX, worldZ);
    return this.flatWater.isWaterAt(gx, gz);
  }

  heightAt(worldX, worldZ) {
    if (!this.active) return Number.NaN;
    return this.#sampleAny(worldX, worldZ);
  }

  inspectAt(worldX, worldZ) {
    if (!this.preflightReady) return null;
    const fine = this.source.heightAt(worldX, worldZ);
    const fineHeight = Number.isFinite(fine) ? fine : fine?.height;
    if (Number.isFinite(fineHeight)) return Object.freeze({ height: fineHeight, tileId: 'course', sampleSpacingMetres: 1 });
    const [gx, gz] = this.bridge.toGrid(worldX, worldZ);
    return this.rings?.inspect(gx, gz) ?? null;
  }

  /* Wait for the stream. 'full': every tile the plan wants is resident and
     drawn. 'coverage': every wanted tile is drawable from itself or a
     resident ancestor and something is drawn -- the coarse pyramid first,
     which is what the request order already fetches first. The controller
     re-plans on every tile arrival, so the stream keeps filling in while
     the main thread builds the rest of the scene; `settle()` then waits
     for whatever is still missing, usually nothing. */
  async #settle(deadlineMilliseconds, mode = 'full') {
    const startedAt = this.clock();
    let lastReport = startedAt;
    for (;;) {
      const snapshot = this.runtime.snapshot();
      const plan = snapshot.stream.plan;
      const ready = new Set(snapshot.stream.readyTileIds);
      const desired = plan?.desiredTileIds || [];
      const failed = snapshot.stream.failedTileIds || [];
      if (failed.length) throw new Error(`v2 world tiles failed to load: ${failed.slice(0, 4).join(', ')}`);
      const settled = mode === 'coverage'
        ? desired.length && plan.coverageComplete && !plan.shellRequired && snapshot.renderer.renderedTiles >= 1
        : desired.length && desired.every(id => ready.has(id)) && snapshot.renderer.renderedTiles >= 1 &&
          snapshot.stream.loadingTileIds.length === 0;
      if (settled) return snapshot;
      const now = this.clock();
      if (now - lastReport > 2000) {
        lastReport = now;
        console.info(`v2 world settling: ${ready.size} ready, ${snapshot.stream.loadingTileIds.length} loading, ` +
          `${desired.length} wanted, ${snapshot.renderer.renderedTiles} drawn`);
      }
      if (now - startedAt > deadlineMilliseconds) {
        throw new Error(`v2 world did not settle in ${deadlineMilliseconds} ms (${ready.size} ready, ${snapshot.stream.loadingTileIds.length} loading)`);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /** Wait until every tile the current plan wants is resident and drawn. */
  async settle(deadlineMilliseconds = 60_000) {
    if (!this.runtime || !(this.phase === 'prepared' || this.phase === 'ready')) return null;
    const settled = await this.#settle(deadlineMilliseconds, 'full');
    this.prepared = Object.freeze({
      ...this.prepared,
      renderedTiles: settled.renderer.renderedTiles,
      drawCalls: settled.renderer.drawCalls,
      readyTiles: settled.stream.readyTileIds.length,
    });
    this.renderer = Object.freeze({ ...this.renderer, ...this.prepared });
    return this.prepared;
  }

  async prepare({ decorateMaterial, preflight, settleMilliseconds = 60_000, settle = 'full' } = {}) {
    if (this.phase !== 'pending') throw new Error(`v2 world adapter cannot prepare from ${this.phase}`);
    if (typeof preflight !== 'function') throw new TypeError('preflight must be a function');
    if (!this.backend) throw new Error('configure({ backend }) before prepare');
    try {
      const { CourseV2TerrainRuntime } = await import('./v2-terrain-runtime.mjs');
      const frame = {
        ...this.graph.ground.frame,
        origin: {
          easting: this.legacyOrigin.easting,
          northing: this.legacyOrigin.northing,
          /* tile height -> legacy datum, as the pilot's translateY does */
          heightRH2000: -this.bridge.verticalDatumOffsetMetres,
        },
      };
      this.runtime = new CourseV2TerrainRuntime({
        ground: { ...this.graph.ground, frame },
        course: this.graph.course,
        scene: this.group,
        backend: this.backend,
        mobile: this.mobile,
        baseUrl: this.baseUrl,
        fetchImpl: this.fetchImpl,
        cacheStorage: this.cacheStorage,
        clock: this.clock,
        decorateMaterial,
        maximumCachedResources: this.maximumCachedResources,
        profile: this.profile ?? undefined,
        onInvalidate: () => this.#afterSync(),
        transformDecoded: ({ tileId, decoded }) => this.#carveDecoded({ tileId, decoded }),
      });
      applyBridgeTransform(this.group, this.bridge);
      const preloadStarted = this.clock();
      const ringTiles = await this.loadRings();
      console.info(`v2 world: ${ringTiles} ring tiles resident for construction (${Math.round(this.clock() - preloadStarted)} ms in prepare)`);
      /* a first plan from above the course centre, everything visible, so the
         preflight draws real tiles and construction starts with the course
         and its rings resident */
      const centre = this.graph.ground.frame.origin;
      const relief = this.graph.ground.bounds.maxHeightRH2000 - this.graph.ground.bounds.minHeightRH2000;
      this.runtime.update({
        camera: { position: {
          x: centre.easting - this.legacyOrigin.easting,
          y: this.graph.ground.bounds.maxHeightRH2000 + this.bridge.verticalDatumOffsetMetres + Math.max(120, relief),
          z: this.legacyOrigin.northing - centre.northing,
        } },
        viewportHeightPixels: 1080,
        fieldOfViewYRadians: 50 * Math.PI / 180,
        activeHoleNumber: 1,
        visible: () => true,
      });
      const settled = await this.#settle(settleMilliseconds, settle);
      console.info(`v2 world: first frontier ${settle === 'coverage' ? 'covered' : 'settled'}, ${settled.renderer.renderedTiles} tiles in ${settled.renderer.drawCalls} draws` +
        (settle === 'coverage' ? ` (${settled.stream.loadingTileIds.length} still streaming)` : ''));
      await preflight({ group: this.group, stats: () => this.runtime.layer.stats() });
      console.info('v2 world: backend preflight passed');
      this.prepared = Object.freeze({
        ringTiles,
        renderedTiles: settled.renderer.renderedTiles,
        drawCalls: settled.renderer.drawCalls,
        readyTiles: settled.stream.readyTileIds.length,
      });
      this.phase = 'prepared';
      this.renderer = Object.freeze({ status: 'prepared', ...this.prepared });
      return Object.freeze({ ok: true, status: this.phase, prepared: this.prepared });
    } catch (error) {
      this.fail(error);
      return Object.freeze({ ok: false, status: this.phase, error: this.renderer.error });
    }
  }

  #afterSync() {
    /* the batches are created lazily on first sync; the legacy CORE cast
       shadows and the world must too */
    this.group.traverse(object => { if (object.isMesh && !object.castShadow) object.castShadow = true; });
  }

  activate() {
    if (this.phase !== 'prepared' || !this.runtime) throw new Error(`v2 world adapter cannot activate from ${this.phase}`);
    this.phase = 'ready';
    const levels = [...new Set(this.graph.ground.tiles.map(tile => tile.lod))].sort((a, b) => a - b);
    this.renderer = Object.freeze({
      status: 'ready',
      kind: 'graph',
      meshResolutionMetres: 1,
      levels,
      tiles: this.graph.ground.tiles.length,
      ringTiles: this.prepared.ringTiles,
      fallbackRebuilt: false,
      ...this.runtime.layer.stats(),
    });
    return this.renderer;
  }

  /** Per frame: plan against the real camera, in the bridged frame, with a frustum test in legacy world. */
  update({ camera, viewportHeightPixels, fieldOfViewYRadians, activeHoleNumber } = {}) {
    if (!this.runtime || this.phase === 'failed' || this.phase === 'disposed') return null;
    if (!camera?.position) return null;
    camera.updateMatrixWorld?.(true);
    /* The frustum is taken INTO the tile lattice's own space, where every
       tile is an axis-aligned box. Rotating the boxes out into the legacy
       frame instead inflates each one by its size times sin(3.5 degrees):
       half a kilometre on an 8 km tile, which then tested visible while its
       4 km children did not, so the planner never refined it -- a 32 m tile
       drawn beside the 1 m course, lit flat as a bright plate. */
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.group.matrixWorld);
    /* WebGPU clips z to [0, 1] and WebGL to [-1, 1]; the camera says which */
    const intersects = createTileFrustumTester(this.projection, { coordinateSystem: camera.coordinateSystem, reversedDepth: camera.reversedDepth ?? false });
    const [gx, gz] = this.bridge.toGrid(camera.position.x, camera.position.z);
    const frame = this.runtime.ground.frame;
    const visible = tile => {
      this.min.set(
        tile.bounds.minEasting - frame.origin.easting,
        tile.bounds.minHeightRH2000 - frame.origin.heightRH2000,
        frame.origin.northing - tile.bounds.maxNorthing,
      );
      this.max.set(
        tile.bounds.maxEasting - frame.origin.easting,
        tile.bounds.maxHeightRH2000 - frame.origin.heightRH2000,
        frame.origin.northing - tile.bounds.minNorthing,
      );
      return intersects(this.min, this.max);
    };
    this.lastVisible = visible;
    this.lastPlan = this.runtime.update({
      camera: { position: { x: gx, y: camera.position.y, z: gz } },
      viewportHeightPixels: Math.max(1, Math.round(viewportHeightPixels || 1080)),
      fieldOfViewYRadians: fieldOfViewYRadians ?? (camera.fov * Math.PI / 180),
      activeHoleNumber: Number.isSafeInteger(activeHoleNumber) ? activeHoleNumber : undefined,
      visible,
    });
    return this.lastPlan;
  }

  tick(now) {
    if (!this.runtime || this.phase === 'failed' || this.phase === 'disposed') return Object.freeze({ morphing: false });
    return this.runtime.tick(now);
  }

  /** Which tiles the frustum test passes for the last camera, for the harness. */
  visibleTileIds() {
    if (!this.runtime || !this.lastVisible) return Object.freeze([]);
    return Object.freeze(this.graph.ground.tiles.filter(tile => this.lastVisible(tile)).map(tile => tile.id));
  }

  /** Each coarse tile's visibility verdict for the last camera, for diagnosis. */
  frustumReport() {
    if (!this.runtime || !this.lastVisible) return null;
    const frame = this.runtime.ground.frame;
    return Object.freeze({
      camera: this.runtime.lastUpdate?.camera ?? null,
      tiles: this.graph.ground.tiles.filter(tile => tile.lod >= 4).map(tile => Object.freeze({
        id: tile.id,
        visible: this.lastVisible(tile),
        local: [
          +(tile.bounds.minEasting - frame.origin.easting).toFixed(1), +(tile.bounds.maxEasting - frame.origin.easting).toFixed(1),
          +(tile.bounds.minHeightRH2000 - frame.origin.heightRH2000).toFixed(1), +(tile.bounds.maxHeightRH2000 - frame.origin.heightRH2000).toFixed(1),
          +(frame.origin.northing - tile.bounds.maxNorthing).toFixed(1), +(frame.origin.northing - tile.bounds.minNorthing).toFixed(1),
        ],
      })),
    });
  }

  /** The planner's last decision, for the harness. */
  plan() {
    if (!this.runtime) return null;
    const snapshot = this.runtime.controller.snapshot();
    const plan = snapshot.plan;
    return Object.freeze({
      desiredTileIds: plan?.desiredTileIds ?? [],
      renderTileIds: plan?.renderTileIds ?? [],
      refinedTileIds: plan?.refinedTileIds ?? [],
      requests: (plan?.requests ?? []).map(request => request.tileId),
      readyTileIds: snapshot.readyTileIds,
      loadingTileIds: snapshot.loadingTileIds,
      failedTileIds: snapshot.failedTileIds,
      selectedTiles: plan?.selectedTiles ?? 0,
      budgetExceededByActive: plan?.budgetExceededByActive ?? false,
      shellRequired: plan?.shellRequired ?? false,
      lastCamera: this.runtime.lastUpdate?.camera ?? null,
    });
  }

  /** The drawn tiles with the bytes the GPU holds for each; for the harness, never per frame. */
  inventory() {
    if (!this.runtime) return Object.freeze([]);
    const byId = new Map(this.graph.ground.tiles.map(tile => [tile.id, tile]));
    return this.runtime.layer.inventory().map(entry => Object.freeze({
      ...entry,
      lod: byId.get(entry.tileId)?.lod ?? null,
      bounds: byId.get(entry.tileId)?.bounds ?? null,
    }));
  }

  fail(error) {
    if (this.phase === 'disposed') return this.renderer;
    this.phase = 'failed';
    try { this.runtime?.dispose(); } catch {}
    this.runtime = null;
    this.rings = null;
    this.prepared = null;
    this.#disposeSource();
    this.renderer = Object.freeze({ status: 'failed', kind: 'graph', fallbackRebuilt: false, error: errorText(error) });
    return this.renderer;
  }

  confirmFallbackRebuilt() {
    if (this.phase !== 'failed') throw new Error(`v2 world adapter cannot confirm fallback from ${this.phase}`);
    this.renderer = Object.freeze({ ...this.renderer, fallbackRebuilt: true });
    return this.renderer;
  }

  snapshot() {
    const runtime = this.runtime?.snapshot() ?? null;
    return Object.freeze({
      kind: 'graph',
      phase: this.phase,
      requested: true,
      sourceReady: this.sourceReady,
      preflightReady: this.preflightReady,
      active: this.active,
      renderer: this.renderer,
      ringLevels: this.rings?.levels ?? [],
      stream: runtime ? Object.freeze({
        readyTiles: runtime.stream.readyTileIds.length,
        loadingTiles: runtime.stream.loadingTileIds.length,
        failedTiles: runtime.stream.failedTileIds.length,
        renderedTiles: runtime.renderer.renderedTiles,
        drawCalls: runtime.renderer.drawCalls,
        triangles: runtime.renderer.triangles,
        selectedTiles: runtime.stream.plan?.selectedTiles ?? 0,
        requests: runtime.requests,
      }) : null,
    });
  }

  dispose() {
    if (this.phase === 'disposed') return;
    try { this.runtime?.dispose(); } catch {}
    this.runtime = null;
    this.rings = null;
    this.prepared = null;
    this.#disposeSource();
    this.group.removeFromParent();
    this.phase = 'disposed';
    this.renderer = Object.freeze({ status: 'disposed' });
  }

  #disposeSource() {
    if (this.sourceDisposed) return;
    this.sourceDisposed = true;
    try { this.source.surfaceAtlas?.dispose?.(); } catch {}
  }
}
