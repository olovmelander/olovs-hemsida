import * as THREE from 'three/webgpu';
import { CourseV2AssetLoader } from '../../../../packages/course-v2/runtime/asset-loader.mjs';
import { ChunkWorkerClient } from '../../../../packages/course-v2/runtime/worker-client.mjs';
import {
  createTerrainRenderResource,
  sampleTerrainRenderResource,
} from '../../../../packages/course-v2/runtime/terrain-render-data.mjs';
import { TerrainStreamController } from '../../../../packages/course-v2/runtime/terrain-stream-controller.mjs';
import {
  TerrainTileManager,
  terrainTileQualityProfile,
} from '../../../../packages/course-v2/runtime/terrain-tile-manager.mjs';
import { TerrainTileBatchSet } from './v2-terrain-batch.mjs';

function callback(value, label) {
  if (typeof value !== 'function') throw new TypeError(`${label} must be a function`);
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function frameOrigin(frame) {
  if (!frame?.origin) throw new TypeError('verified ground frame is required');
  return {
    easting: finite(frame.origin.easting, 'frame origin easting'),
    northing: finite(frame.origin.northing, 'frame origin northing'),
    heightRH2000: finite(frame.origin.heightRH2000, 'frame origin height'),
  };
}

export function worldToCanonicalCamera(position, frame) {
  const origin = frameOrigin(frame);
  return Object.freeze({
    easting: origin.easting + finite(position?.x, 'camera.position.x'),
    northing: origin.northing - finite(position?.z, 'camera.position.z'),
    heightRH2000: origin.heightRH2000 + finite(position?.y, 'camera.position.y'),
  });
}

export function activeHoleTerrainTileIds(course, holeNumber) {
  if (!Number.isSafeInteger(holeNumber) || holeNumber < 1) return Object.freeze([]);
  const hole = course?.holes?.find(candidate => candidate.number === holeNumber);
  return Object.freeze([...(hole?.tileIds || [])]);
}

function tileWorldBox(tile, frame, target) {
  const origin = frameOrigin(frame);
  return target.set(
    new THREE.Vector3(
      tile.bounds.minEasting - origin.easting,
      tile.bounds.minHeightRH2000 - origin.heightRH2000,
      origin.northing - tile.bounds.maxNorthing,
    ),
    new THREE.Vector3(
      tile.bounds.maxEasting - origin.easting,
      tile.bounds.maxHeightRH2000 - origin.heightRH2000,
      origin.northing - tile.bounds.minNorthing,
    ),
  );
}

function createWorkerClient(workerFactory) {
  if (workerFactory) return new ChunkWorkerClient(workerFactory());
  if (typeof globalThis.Worker !== 'function') {
    throw new Error('Web Worker is unavailable for v2 terrain decoding');
  }
  /* The LITERAL `new Worker(new URL(..., import.meta.url), {type:'module'})`
     is the only shape a bundler statically detects and bundles. Constructing
     through an alias -- `const WorkerImpl = globalThis.Worker`, which reads
     like harmless indirection for testability -- leaves the bundler seeing
     just an asset reference: it copies the entry VERBATIM, the entry's own
     relative import resolves to a file that was never emitted, the worker
     dies on load, and every decode job then hangs forever with nothing
     thrown anywhere. Measured: 0 of 18 tiles resident after 180 s, two jobs
     "running" that never complete. Injection for tests stays above, before
     this line, so the literal survives. */
  const worker = new Worker(
    new URL('../../../../packages/course-v2/runtime/chunk-worker-entry.mjs', import.meta.url),
    { type: 'module', name: 'banvy-course-v2' },
  );
  return new ChunkWorkerClient(worker);
}

/**
 * Manifest-driven end-to-end D4 runtime. The live app now owns a common
 * height/tick/snapshot adapter boundary, but this streaming implementation is
 * not selected until a real public course/ground graph supplies its required
 * shell, hierarchy and routing manifests.
 */
export class CourseV2TerrainRuntime {
  constructor({
    ground,
    course,
    scene,
    backend,
    mobile = false,
    baseUrl,
    assetLoader = null,
    workerFactory,
    fetchImpl = globalThis.fetch,
    cacheStorage = globalThis.caches,
    clock = () => globalThis.performance?.now?.() ?? Date.now(),
    onInvalidate = () => {},
    decorateMaterial,
    maximumCachedResources,
  } = {}) {
    if (!ground?.frame || !ground?.shell || !Array.isArray(ground.tiles)) {
      throw new TypeError('verified v2 ground is required');
    }
    if (!course?.slug || course.groundId !== ground.groundId || !Array.isArray(course.holes)) {
      throw new TypeError('verified v2 course does not match its ground');
    }
    if (!scene?.add) throw new TypeError('Three.js scene is required');
    if (!['webgpu', 'webgl2'].includes(backend)) throw new Error('backend must be webgpu or webgl2');
    if (typeof mobile !== 'boolean') throw new TypeError('mobile must be boolean');
    this.ground = ground;
    this.course = course;
    this.scene = scene;
    this.backend = backend;
    this.mobile = mobile;
    this.clock = callback(clock, 'clock');
    this.onInvalidate = callback(onInvalidate, 'onInvalidate');
    this.profile = terrainTileQualityProfile({ backend, mobile });
    this.manager = new TerrainTileManager({ ground, courseSlug: course.slug });
    this.layer = new TerrainTileBatchSet({
      maximumTiles: this.profile.maximumSelectedTiles,
      decorateMaterial,
    });
    scene.add(this.layer.group);
    this.resources = new Map();
    this.ownsAssetLoader = !assetLoader;
    this.workerClient = null;
    if (assetLoader) {
      if (!assetLoader.request) throw new TypeError('assetLoader must implement request');
      this.assetLoader = assetLoader;
    } else {
      if (!baseUrl) throw new Error('baseUrl is required when constructing the v2 asset loader');
      this.workerClient = createWorkerClient(workerFactory);
      this.assetLoader = new CourseV2AssetLoader({
        baseUrl,
        workerClient: this.workerClient,
        fetchImpl,
        cacheStorage,
        maxConcurrent: mobile ? 2 : 3,
      });
    }
    const cachedResources = maximumCachedResources ?? (mobile ? 20 : 40);
    this.controller = new TerrainStreamController({
      manager: this.manager,
      loader: this.assetLoader,
      maximumCachedResources: cachedResources,
      clock: this.clock,
      createResource: ({ tileId, decoded }) => {
        const resource = createTerrainRenderResource({
          tileId,
          decoded,
          frame: ground.frame,
        });
        this.resources.set(tileId, resource);
        return resource;
      },
      disposeResource: resource => {
        if (this.resources.get(resource.tileId) === resource) this.resources.delete(resource.tileId);
      },
      onChange: snapshot => {
        this.layer.sync(snapshot.renderResources, { now: this.clock() });
        this.onInvalidate(snapshot);
      },
      scope: `terrain-v2:${course.slug}`,
    });
    this.projection = new THREE.Matrix4();
    this.frustum = new THREE.Frustum();
    this.scratchBox = new THREE.Box3();
    this.lastUpdate = null;
    this.disposed = false;
  }

  #frustumVisibility(camera) {
    camera.updateMatrixWorld?.(true);
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    return tile => this.frustum.intersectsBox(tileWorldBox(tile, this.ground.frame, this.scratchBox));
  }

  update({
    camera,
    viewportHeightPixels,
    fieldOfViewYRadians,
    activeHoleNumber,
    visible,
  } = {}) {
    if (this.disposed) throw new Error('v2 terrain runtime is disposed');
    if (!camera?.position) throw new TypeError('camera with a position is required');
    if (!Number.isSafeInteger(viewportHeightPixels) || viewportHeightPixels < 1) {
      throw new RangeError('viewportHeightPixels must be a positive integer');
    }
    const fov = fieldOfViewYRadians ?? finite(camera.fov, 'camera.fov') * Math.PI / 180;
    const visibility = visible || this.#frustumVisibility(camera);
    if (typeof visibility !== 'function') throw new TypeError('visible must be a function');
    this.lastUpdate = {
      camera: worldToCanonicalCamera(camera.position, this.ground.frame),
      viewportHeightPixels,
      fieldOfViewYRadians: fov,
      targetErrorPixels: this.profile.targetErrorPixels,
      maximumSelectedTiles: this.profile.maximumSelectedTiles,
      activeTileIds: activeHoleTerrainTileIds(this.course, activeHoleNumber),
      visible: visibility,
    };
    return this.controller.update(this.lastUpdate);
  }

  tick(now = this.clock()) {
    if (this.disposed) return Object.freeze({ morphing: false });
    return this.layer.tick(now);
  }

  heightAt(worldX, worldZ) {
    finite(worldX, 'worldX');
    finite(worldZ, 'worldZ');
    const ready = new Set(this.controller.snapshot().readyTileIds);
    const candidates = [...this.resources.values()]
      .filter(resource => ready.has(resource.tileId))
      .sort((left, right) => left.sampleSpacingMetres - right.sampleSpacingMetres ||
        Number(left.tileId === 'shell') - Number(right.tileId === 'shell'));
    for (const resource of candidates) {
      const height = sampleTerrainRenderResource(resource, worldX, worldZ);
      if (!Number.isNaN(height)) return Object.freeze({
        height,
        tileId: resource.tileId,
        sampleSpacingMetres: resource.sampleSpacingMetres,
      });
    }
    return null;
  }

  snapshot() {
    return Object.freeze({
      backend: this.backend,
      mobile: this.mobile,
      profile: this.profile,
      stream: this.controller.snapshot(),
      renderer: this.layer.stats(),
      requests: this.assetLoader.stats?.() ?? null,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controller.dispose();
    this.layer.dispose();
    this.resources.clear();
    if (this.ownsAssetLoader) this.assetLoader.dispose?.({ disposeWorker: true });
  }
}
