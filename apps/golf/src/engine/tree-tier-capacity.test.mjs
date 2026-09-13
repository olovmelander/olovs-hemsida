import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { initialTreeTierCapacity, reserveTreeTier, treeTierAllocation } from './tree-tier-capacity.mjs';

const attribute = (capacity, size) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
function meshTier(capacity) {
  const geometry = new THREE.BoxGeometry();
  geometry.setAttribute('aFade', attribute(capacity, 2));
  geometry.setAttribute('aTint', attribute(capacity, 4));
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicNodeMaterial(), capacity);
  mesh.count = 2;
  return { parts: [mesh], slots: new Int32Array(capacity), count: 2,
    fade: [geometry.getAttribute('aFade')], tint: [geometry.getAttribute('aTint')], dirtyM: [1], dirtyF: [1] };
}

describe('resident tree tier capacity', () => {
  it('bounds initial allocations without limiting the logical population', () => {
    expect(initialTreeTierCapacity(500000)).toBe(2048);
    expect(initialTreeTierCapacity(500000, false)).toBe(500000);
    expect(initialTreeTierCapacity(19)).toBe(19);
    expect(initialTreeTierCapacity(0)).toBe(0);
  });

  it('preserves incoming/outgoing slots, matrices, tints and fade clocks through repeated growth', () => {
    const tier = meshTier(2048), object = tier.parts[0], material = object.material;
    tier.slots.set([41, 7]);
    tier.fade[0].array.set([127.25, 1, 127.25, 4]);
    tier.tint[0].array.set([.5, .75, 1, .125]);
    object.instanceMatrix.array[12] = -4321.125;
    let geometriesDisposed = 0, objectsDisposed = 0;
    object.addEventListener('dispose', () => objectsDisposed++);
    for (const required of [2049, 4097]) {
      object.geometry.addEventListener('dispose', () => geometriesDisposed++);
      expect(reserveTreeTier(tier, required, 6000)).toBe(true);
      expect(tier.parts[0]).toBe(object);
      expect(object.material).toBe(material);
      expect(object.count).toBe(2);
      expect(tier.count).toBe(2);
      expect(Array.from(tier.slots.subarray(0, 2))).toEqual([41, 7]);
      expect(Array.from(tier.fade[0].array.subarray(0, 4))).toEqual([127.25, 1, 127.25, 4]);
      expect(Array.from(tier.tint[0].array.subarray(0, 4))).toEqual([.5, .75, 1, .125]);
      expect(object.instanceMatrix.array[12]).toBe(-4321.125);
      expect(object.instanceMatrix.count).toBe(tier.slots.length);
      expect(tier.dirtyM).toEqual([1]);
    }
    expect(tier.slots.length).toBe(6000);
    expect(geometriesDisposed).toBe(2);
    expect(objectsDisposed).toBe(2);
    expect(reserveTreeTier(tier, 6000, 6000)).toBe(false);
    expect(() => reserveTreeTier(tier, 6001, 6000)).toThrow(/population/);
    expect(treeTierAllocation([{ t: [null, tier] }])).toEqual({
      drawableBytes: 6000 * (16 + 2 + 4) * 4, slotBytes: 6000 * 4, capacity: 6000, used: 2, resizes: 2,
    });
  });

  it('grows every impostor attribute and keeps its drawn count', () => {
    const geometry = new THREE.InstancedBufferGeometry();
    for (const [name, size] of [['aImpostorPos', 3], ['aImpostorParam', 4], ['aFade', 2], ['aTint', 4]]) {
      geometry.setAttribute(name, attribute(2048, size));
    }
    geometry.instanceCount = 2048;
    geometry.getAttribute('aImpostorPos').array[6143] = -9.125;
    const tier = { mesh: new THREE.Mesh(geometry), geo: geometry, slots: new Int32Array(2048), count: 2048 };
    reserveTreeTier(tier, 2049, 10000);
    expect(tier.geo).toBe(tier.mesh.geometry);
    expect(tier.geo.instanceCount).toBe(2048);
    expect(tier.pos.array[6143]).toBe(-9.125);
    for (const attr of [tier.pos, tier.par, ...tier.fade, ...tier.tint]) expect(attr.count).toBe(4096);
  });
});
