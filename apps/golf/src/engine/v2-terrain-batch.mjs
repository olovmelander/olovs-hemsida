import * as THREE from 'three/webgpu';
import {
  Fn, abs, attribute, float, int, ivec2, max, mix, normalize,
  positionLocal, round, textureLoad, transformNormalToView, vec3, varyingProperty,
} from 'three/tsl';
import { createTerrainGridTopology } from '../../../../packages/course-v2/runtime/terrain-grid-topology.mjs';

const UINT16_MAX = 65_535;

function positiveInteger(value, label, maximum = 512) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer from 1 to ${maximum}`);
  }
  return value;
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function nowMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function topologyGeometry(topology) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(topology.positions, 3));
  geometry.setAttribute('normal', new THREE.Int8BufferAttribute(topology.normals, 3, true));
  geometry.setIndex(new THREE.BufferAttribute(topology.indices, 1));
  return geometry;
}

function heightTexture(width, height, capacity) {
  const textureWidth = width * 2;
  const data = new Uint8Array(textureWidth * height * capacity * 4);
  const texture = new THREE.DataArrayTexture(data, textureWidth, height, capacity);
  texture.name = `banvy-v2-terrain-${textureWidth}x${height}x${capacity}-rgba8`;
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

/* Two packed instance buffers keep the complete terrain path at five vertex
   buffers including Three's identity instance matrix. r185's WebGPU backend
   permits eight; adding one buffer per scalar silently crosses that limit. */
function installInstanceAttributes(geometry, capacity) {
  const frame = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const params = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  frame.setUsage(THREE.DynamicDrawUsage);
  params.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aTerrainFrame', frame);
  geometry.setAttribute('aTerrainParams', params);
  return { frame, params };
}

function terrainMaterial(texture, decorateMaterial) {
  const material = new THREE.MeshStandardNodeMaterial({
    color: 0x496b3d,
    metalness: 0,
    roughness: 0.94,
  });
  const terrainNormalView = varyingProperty('vec3', 'vTerrainNormalView');
  material.positionNode = Fn(() => {
    const frame = attribute('aTerrainFrame', 'vec4');
    const params = attribute('aTerrainParams', 'vec4');
    const coordinate = ivec2(int(positionLocal.x).mul(2), int(positionLocal.z));
    const heightBytes = round(textureLoad(texture, coordinate).depth(int(params.w)).mul(255));
    const normalBytes = round(textureLoad(
      texture, coordinate.add(ivec2(1, 0)),
    ).depth(int(params.w)).mul(255));
    const fine = heightBytes.r.add(heightBytes.g.mul(256));
    const parent = heightBytes.b.add(heightBytes.a.mul(256));
    const quantized = mix(fine, parent, params.z);
    const oct = vec3(
      normalBytes.r.add(normalBytes.g.mul(256)),
      float(0),
      normalBytes.b.add(normalBytes.a.mul(256)),
    ).xz.div(UINT16_MAX).mul(2).sub(1);
    const normalWorld = normalize(vec3(
      oct.x,
      max(float(1e-6), float(1).sub(abs(oct.x).add(abs(oct.y)))),
      oct.y,
    ));
    terrainNormalView.assign(transformNormalToView(normalWorld));
    return vec3(
      frame.x.add(positionLocal.x.mul(frame.w)),
      frame.z.add(quantized.mul(params.x)).add(positionLocal.y.mul(params.y)),
      frame.y.add(positionLocal.z.mul(frame.w)),
    );
  })();
  material.normalNode = terrainNormalView;
  if (decorateMaterial !== undefined) {
    if (typeof decorateMaterial !== 'function') throw new TypeError('decorateMaterial must be a function');
    decorateMaterial(material, Object.freeze({ THREE, terrainNormalView }));
  }
  return material;
}

function smoothMorph(startedAt, now, duration) {
  if (startedAt === null || duration === 0) return 0;
  const elapsed = Math.max(0, now - startedAt);
  if (elapsed >= duration) return 0;
  const t = elapsed / duration;
  const eased = t * t * (3 - 2 * t);
  return 1 - eased;
}

export class TerrainTextureBatch {
  constructor({
    width,
    height,
    capacity,
    morphDurationMilliseconds = 240,
    minimumSkirtDepthMetres = 1.5,
    maximumSkirtDepthMetres = 12,
    decorateMaterial,
    tag = 'v2-terrain',
  } = {}) {
    positiveInteger(capacity, 'capacity');
    finite(morphDurationMilliseconds, 'morphDurationMilliseconds');
    finite(minimumSkirtDepthMetres, 'minimumSkirtDepthMetres');
    finite(maximumSkirtDepthMetres, 'maximumSkirtDepthMetres');
    if (morphDurationMilliseconds < 0 || morphDurationMilliseconds > 10_000) {
      throw new RangeError('morphDurationMilliseconds must be from 0 to 10000');
    }
    if (minimumSkirtDepthMetres <= 0 || maximumSkirtDepthMetres < minimumSkirtDepthMetres) {
      throw new RangeError('terrain skirt depth range is invalid');
    }
    this.width = width;
    this.height = height;
    this.capacity = capacity;
    this.morphDurationMilliseconds = morphDurationMilliseconds;
    this.minimumSkirtDepthMetres = minimumSkirtDepthMetres;
    this.maximumSkirtDepthMetres = maximumSkirtDepthMetres;
    this.topology = createTerrainGridTopology({ width, height, skirts: true });
    this.texture = heightTexture(width, height, capacity);
    this.geometry = topologyGeometry(this.topology);
    this.attributes = installInstanceAttributes(this.geometry, capacity);
    this.material = terrainMaterial(this.texture, decorateMaterial);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.name = tag;
    this.mesh.userData.tag = tag;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.layersByTile = new Map();
    this.tilesByLayer = new Array(capacity).fill(null);
    this.identityByTile = new Map();
    this.morphStartByTile = new Map();
    this.current = [];
    this.textureUploads = 0;
    this.disposed = false;
  }

  #checkResource(resource) {
    if (!resource || typeof resource.tileId !== 'string') throw new TypeError('terrain resource is required');
    if (resource.width !== this.width || resource.height !== this.height) {
      throw new Error(`terrain tile ${resource.tileId} does not match batch dimensions`);
    }
    if (resource.layout !== 'rgba8x2-height-parent-octnormal-v1' ||
        !(resource.textureData instanceof Uint8Array) ||
        resource.textureData.length !== this.width * this.height * 8) {
      throw new Error(`terrain tile ${resource.tileId} has an unsupported GPU layout`);
    }
    for (const field of [
      'worldOriginX', 'worldOriginZ', 'heightOffsetWorld', 'sampleSpacingMetres',
      'heightScaleMetres', 'geometricErrorMetres',
    ]) finite(resource[field], `${resource.tileId}.${field}`);
  }

  #allocateLayer(tileId) {
    const existing = this.layersByTile.get(tileId);
    if (existing !== undefined) return existing;
    const layer = this.tilesByLayer.indexOf(null);
    if (layer < 0) throw new Error(`terrain texture batch capacity ${this.capacity} exceeded`);
    this.layersByTile.set(tileId, layer);
    this.tilesByLayer[layer] = tileId;
    return layer;
  }

  #releaseMissing(active) {
    for (const [tileId, layer] of [...this.layersByTile]) {
      if (active.has(tileId)) continue;
      this.layersByTile.delete(tileId);
      this.tilesByLayer[layer] = null;
      this.identityByTile.delete(tileId);
      this.morphStartByTile.delete(tileId);
    }
  }

  sync(resources, { now = nowMilliseconds() } = {}) {
    if (this.disposed) throw new Error('terrain texture batch is disposed');
    if (!Array.isArray(resources)) throw new TypeError('resources must be an array');
    if (resources.length > this.capacity) throw new Error(`terrain batch received ${resources.length} resources; capacity is ${this.capacity}`);
    finite(now, 'now');
    const seen = new Set();
    for (const resource of resources) {
      this.#checkResource(resource);
      if (seen.has(resource.tileId)) throw new Error(`duplicate rendered terrain tile ${resource.tileId}`);
      seen.add(resource.tileId);
    }
    this.#releaseMissing(seen);
    let textureChanged = false;
    for (const resource of resources) {
      const isNew = !this.layersByTile.has(resource.tileId);
      const layer = this.#allocateLayer(resource.tileId);
      const identity = `${resource.decodedSha256}:${resource.layout}`;
      if (this.identityByTile.get(resource.tileId) !== identity) {
        this.texture.image.data.set(resource.textureData, layer * resource.textureData.length);
        this.texture.addLayerUpdate(layer);
        this.identityByTile.set(resource.tileId, identity);
        this.textureUploads++;
        textureChanged = true;
      }
      if (isNew) {
        this.morphStartByTile.set(resource.tileId, resource.tileId === 'shell' ? null : now);
      }
    }
    if (textureChanged) this.texture.needsUpdate = true;
    this.current = [...resources];
    return this.tick(now);
  }

  tick(now = nowMilliseconds()) {
    if (this.disposed) throw new Error('terrain texture batch is disposed');
    finite(now, 'now');
    const frame = this.attributes.frame.array;
    const params = this.attributes.params.array;
    let morphing = false;
    for (let index = 0; index < this.current.length; index++) {
      const resource = this.current[index];
      const layer = this.layersByTile.get(resource.tileId);
      const morph = smoothMorph(
        this.morphStartByTile.get(resource.tileId) ?? null,
        now,
        this.morphDurationMilliseconds,
      );
      if (morph > 0) morphing = true;
      const skirtDepth = Math.min(this.maximumSkirtDepthMetres, Math.max(
        this.minimumSkirtDepthMetres,
        resource.geometricErrorMetres * 2,
        resource.maximumMorphDeltaMetres * 1.5,
      ));
      frame.set([
        resource.worldOriginX,
        resource.worldOriginZ,
        resource.heightOffsetWorld,
        resource.sampleSpacingMetres,
      ], index * 4);
      params.set([
        resource.heightScaleMetres,
        skirtDepth,
        morph,
        layer,
      ], index * 4);
    }
    this.mesh.count = this.current.length;
    this.mesh.visible = this.mesh.count > 0;
    this.attributes.frame.needsUpdate = this.mesh.count > 0;
    this.attributes.params.needsUpdate = this.mesh.count > 0;
    return Object.freeze({ count: this.mesh.count, morphing });
  }

  stats() {
    return Object.freeze({
      width: this.width,
      height: this.height,
      capacity: this.capacity,
      renderedTiles: this.mesh.count,
      residentLayers: this.layersByTile.size,
      textureUploads: this.textureUploads,
      textureCapacityBytes: this.texture.image.data.byteLength,
      topologyBytes: this.topology.cpuBytes,
      triangles: this.mesh.count * this.topology.triangleCount,
      drawCalls: this.mesh.count ? 1 : 0,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.layersByTile.clear();
    this.identityByTile.clear();
    this.morphStartByTile.clear();
    this.current.length = 0;
  }
}

/** At most one regular 257-grid batch plus a one-layer shell batch is live. */
export class TerrainTileBatchSet {
  constructor({
    maximumTiles,
    morphDurationMilliseconds = 240,
    decorateMaterial,
  } = {}) {
    positiveInteger(maximumTiles, 'maximumTiles');
    this.maximumTiles = maximumTiles;
    this.options = { morphDurationMilliseconds, decorateMaterial };
    this.group = new THREE.Group();
    this.group.name = 'banvy-v2-terrain';
    this.group.userData.tag = 'v2-terrain-root';
    this.batches = new Map();
    this.disposed = false;
  }

  #key(resource) {
    const kind = resource.tileId === 'shell' ? 'shell' : 'regular';
    return `${kind}:${resource.width}x${resource.height}`;
  }

  #batch(key, resource) {
    let batch = this.batches.get(key);
    if (batch) return batch;
    const shell = resource.tileId === 'shell';
    batch = new TerrainTextureBatch({
      width: resource.width,
      height: resource.height,
      capacity: shell ? 1 : this.maximumTiles,
      ...this.options,
      tag: shell ? 'v2-terrain-shell' : 'v2-terrain-tiles',
    });
    this.batches.set(key, batch);
    this.group.add(batch.mesh);
    return batch;
  }

  sync(renderResources, { now = nowMilliseconds() } = {}) {
    if (this.disposed) throw new Error('terrain tile batch set is disposed');
    if (!Array.isArray(renderResources)) throw new TypeError('renderResources must be an array');
    const grouped = new Map();
    for (const entry of renderResources) {
      const resource = entry?.value ?? entry;
      const key = this.#key(resource);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(resource);
    }
    const regularKeys = [...grouped.keys()].filter(key => key.startsWith('regular:'));
    if (regularKeys.length > 1) {
      throw new Error('one render frontier may not mix regular terrain grid dimensions');
    }
    let morphing = false;
    for (const [key, batch] of this.batches) {
      if (grouped.has(key)) continue;
      batch.sync([], { now });
    }
    for (const [key, resources] of grouped) {
      const state = this.#batch(key, resources[0]).sync(resources, { now });
      morphing ||= state.morphing;
    }
    this.group.visible = renderResources.length > 0;
    return Object.freeze({ renderedTiles: renderResources.length, morphing });
  }

  tick(now = nowMilliseconds()) {
    let morphing = false;
    for (const batch of this.batches.values()) morphing ||= batch.tick(now).morphing;
    return Object.freeze({ morphing });
  }

  stats() {
    const batches = [...this.batches.values()].map(batch => batch.stats());
    return Object.freeze({
      batches: Object.freeze(batches),
      renderedTiles: batches.reduce((sum, batch) => sum + batch.renderedTiles, 0),
      residentLayers: batches.reduce((sum, batch) => sum + batch.residentLayers, 0),
      drawCalls: batches.reduce((sum, batch) => sum + batch.drawCalls, 0),
      triangles: batches.reduce((sum, batch) => sum + batch.triangles, 0),
      textureCapacityBytes: batches.reduce((sum, batch) => sum + batch.textureCapacityBytes, 0),
      textureUploads: batches.reduce((sum, batch) => sum + batch.textureUploads, 0),
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const batch of this.batches.values()) batch.dispose();
    this.batches.clear();
    this.group.removeFromParent();
  }
}
