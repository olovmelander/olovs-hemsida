import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyCrownDepth } from './crown-depth.mjs';

const fingerprint = attribute => createHash('sha256').update(new Uint8Array(
  attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength,
)).digest('hex');
const rgb = (geometry, i = 0) => {
  const c = geometry.getAttribute('color');
  return [c.getX(i), c.getY(i), c.getZ(i)];
};
const samples = points => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(([y]) => [0, y, 0]), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(points.flatMap(([, ny]) => [0, ny, 0]), 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(points.flatMap(() => [1, 1, 1]), 3));
  return geometry;
};

describe('baked crown depth', () => {
  it('retains the exact topology, normals, bounds and attribute allocations', () => {
    const geometry = new THREE.ConeGeometry(3.5, 12, 24, 3);
    geometry.translate(0, 7, 0);
    const colours = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colours.length; i++) colours[i] = 0.9 + (i % 7) * 0.03;
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const attributes = { ...geometry.attributes };
    const hashes = Object.fromEntries(Object.entries(attributes).map(([name, a]) => [name, fingerprint(a)]));
    const arrays = Object.values(attributes).map(a => a.array);
    const versions = Object.fromEntries(Object.entries(attributes).map(([name, a]) => [name, a.version]));
    const index = geometry.index, indexHash = fingerprint(index);
    const bounds = geometry.boundingBox, sphere = geometry.boundingSphere;
    const boundsBefore = bounds.clone(), sphereBefore = sphere.clone();
    const groupsBefore = structuredClone(geometry.groups), drawBefore = { ...geometry.drawRange };

    expect(applyCrownDepth(geometry, { minY: bounds.min.y, maxY: bounds.max.y })).toBe(geometry);

    expect(Object.keys(geometry.attributes)).toEqual(Object.keys(attributes));
    Object.entries(attributes).forEach(([name, attribute], i) => {
      expect(geometry.getAttribute(name)).toBe(attribute);
      expect(attribute.array).toBe(arrays[i]);
      if (name !== 'color') {
        expect(fingerprint(attribute)).toBe(hashes[name]);
        expect(attribute.version).toBe(versions[name]);
      }
    });
    expect(fingerprint(attributes.color)).not.toBe(hashes.color);
    expect(attributes.color.version).toBe(versions.color + 1);
    expect(geometry.index).toBe(index);
    expect(fingerprint(index)).toBe(indexHash);
    expect(geometry.boundingBox).toBe(bounds);
    expect(geometry.boundingSphere).toBe(sphere);
    expect(bounds.equals(boundsBefore)).toBe(true);
    expect(sphere.equals(sphereBefore)).toBe(true);
    expect(geometry.groups).toEqual(groupsBefore);
    expect(geometry.drawRange).toEqual(drawBefore);
    geometry.dispose();
  });

  it('gives matching local samples the same tint across different detail-tier envelopes', () => {
    const full = samples([[2, 0], [7, -0.4], [12, 1]]);
    const hero = samples([[0, -1], [7, -0.4], [15, 1], [16, 0]]);
    const decimated = samples([[7, -0.4], [9, 1]]);
    for (const geometry of [full, hero, decimated]) {
      applyCrownDepth(geometry, { minY: 2, maxY: 12 });
    }
    expect(rgb(full, 1)).toEqual(rgb(hero, 1));
    expect(rgb(full, 1)).toEqual(rgb(decimated, 0));
  });

  it('keeps lower foliage neutral, warms tips, and darkens sheltered undersides', () => {
    const geometry = samples([[2, 0], [12, 0], [12, -1], [12, 1], [2, -1]]);
    applyCrownDepth(geometry, { minY: 2, maxY: 12 });
    const bottom = rgb(geometry, 0), top = rgb(geometry, 1), underside = rgb(geometry, 2);
    expect(bottom[0]).toBeCloseTo(0.94, 6);
    expect(bottom[0]).toBe(bottom[1]);
    expect(bottom[1]).toBe(bottom[2]);
    expect(top[0]).toBeGreaterThan(top[1]);
    expect(top[1]).toBeGreaterThan(top[2]);
    top.forEach((value, i) => {
      expect(value).toBeGreaterThan(bottom[i]);
      expect(underside[i]).toBeLessThan(value);
    });
    // No sun direction is baked: upward and sideways exposed tips agree.
    expect(rgb(geometry, 3)).toEqual(top);
    expect(rgb(geometry, 4)[0]).toBeCloseTo(0.885, 6);
  });

  it('bounds tint factors even where a coarse template extends outside the full crown', () => {
    const points = [];
    for (let y = -10; y <= 25; y += 0.25) {
      for (const ny of [-2, -1, -0.5, 0, 0.5, 1, 2]) points.push([y, ny]);
    }
    const geometry = samples(points);
    applyCrownDepth(geometry, { minY: 2, maxY: 12 });
    for (const value of geometry.getAttribute('color').array) {
      expect(value).toBeGreaterThanOrEqual(0.8849999);
      expect(value).toBeLessThanOrEqual(1.058721);
    }
    const edge = samples([[-20, 0], [2, 0], [12, 0], [25, 0]]);
    applyCrownDepth(edge, { minY: 2, maxY: 12 });
    expect(rgb(edge, 0)).toEqual(rgb(edge, 1));
    expect(rgb(edge, 2)).toEqual(rgb(edge, 3));
  });

  it('multiplies the existing colour variation without replacing its buffer', () => {
    const geometry = samples([[7, 0], [7, 0]]);
    const colour = geometry.getAttribute('color');
    colour.setXYZ(1, 0.8, 1.2, 1.1);
    applyCrownDepth(geometry, { minY: 2, maxY: 12 });
    const neutral = rgb(geometry, 0), varied = rgb(geometry, 1);
    expect(varied[0] / neutral[0]).toBeCloseTo(0.8, 6);
    expect(varied[1] / neutral[1]).toBeCloseTo(1.2, 6);
    expect(varied[2] / neutral[2]).toBeCloseTo(1.1, 6);
  });

  it('rejects an invalid envelope or missing attribute before changing colour', () => {
    const geometry = samples([[7, 0]]);
    for (const envelope of [{ minY: 2, maxY: 2 }, { minY: 12, maxY: 2 }, { minY: 2, maxY: Infinity }]) {
      expect(() => applyCrownDepth(geometry, envelope)).toThrow(RangeError);
    }
    expect(rgb(geometry)).toEqual([1, 1, 1]);
    geometry.deleteAttribute('normal');
    expect(() => applyCrownDepth(geometry, { minY: 2, maxY: 12 })).toThrow(TypeError);
    expect(rgb(geometry)).toEqual([1, 1, 1]);
  });
});
