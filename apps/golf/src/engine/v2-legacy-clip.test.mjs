import { describe, expect, it } from 'vitest';
import { BufferGeometry, BufferAttribute, InterleavedBuffer, InterleavedBufferAttribute } from 'three';
import { clipLegacyTerrainGeometry } from './v2-legacy-clip.mjs';

const identity = { toGrid: (x, z) => [x, z] };
function geometry(points, indices) {
  const result = new BufferGeometry();
  result.setAttribute('position', new BufferAttribute(new Float32Array(points.flatMap(([x, z]) => [x, 3 * x - z, z])), 3));
  result.setIndex(indices);
  result.computeVertexNormals();
  return result;
}
function grid() {
  const points = [], indices = [];
  for (let z = -4; z <= 4; z++) for (let x = -4; x <= 4; x++) points.push([x, z]);
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
    const a = z * 9 + x, b = a + 1, c = a + 9, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  return geometry(points, indices);
}
function triangles(mesh, bridge = identity) {
  const position = mesh.getAttribute('position'), indices = mesh.getIndex().array, result = [];
  for (let offset = 0; offset < indices.length; offset += 3) {
    result.push([...indices.slice(offset, offset + 3)].map(index => bridge.toGrid(position.getX(index), position.getZ(index))));
  }
  return result;
}
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const area = faces => faces.reduce((sum, [a, b, c]) => sum + Math.abs(cross(a, b, c)) / 2, 0);
const covers = (faces, point) => faces.some(([a, b, c]) => {
  const signs = [cross(a, b, point), cross(b, c, point), cross(c, a, point)];
  return signs.every(value => value >= -1e-7) || signs.every(value => value <= 1e-7);
});

describe('exact legacy terrain frontier subtraction', () => {
  it('keeps every exterior wedge around a rotated square and removes the whole interior', () => {
    const mesh = grid();
    const angle = 2.76 * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const bridge = { toGrid: (x, z) => [x * cos + z * sin, -x * sin + z * cos] };
    const bounds = { x0: -2.2, x1: 2.2, z0: -2.2, z1: 2.2 };
    const originalPosition = mesh.getAttribute('position').array.slice();
    const metadata = mesh.userData.legacyBaseGrid = { skippedBasePoints: 123 };
    const report = clipLegacyTerrainGeometry(mesh, bounds, bridge);
    const faces = triangles(mesh, bridge);
    expect(area(faces)).toBeCloseTo(64 - 4.4 ** 2, 5);
    expect(faces.every(([a, b, c]) => cross(a, b, c) < -1e-12)).toBe(true);
    for (const face of faces) {
      expect(face.every(([x]) => x <= bounds.x0 + 1e-6) || face.every(([x]) => x >= bounds.x1 - 1e-6) ||
        face.every(([, z]) => z <= bounds.z0 + 1e-6) || face.every(([, z]) => z >= bounds.z1 - 1e-6)).toBe(true);
    }
    for (let step = 0; step <= 100; step++) {
      const along = -2.199 + step * 4.398 / 100;
      for (const point of [[-2.201, along], [2.201, along], [along, -2.201], [along, 2.201]]) expect(covers(faces, point)).toBe(true);
      for (const point of [[-2.199, along], [2.199, along], [along, -2.199], [along, 2.199]]) expect(covers(faces, point)).toBe(false);
    }
    expect(report.retainedTriangles).toBe(report.originalTriangles + report.triangleDelta);
    expect(report.addedTriangles - report.removedTriangles).toBe(report.triangleDelta);
    expect(report.clippedTriangles).toBeGreaterThan(0);
    expect(report.fullyRemovedTriangles).toBeGreaterThan(0);
    expect(mesh.userData.legacyBaseGrid).toBe(metadata);
    expect(mesh.getAttribute('position').array.slice(0, originalPosition.length)).toEqual(originalPosition);
  });

  it('preserves all material channels and their interleaved GPU buffer grouping', () => {
    const mesh = grid(), count = mesh.getAttribute('position').count;
    const packed = new Float32Array(count * 7);
    for (let index = 0; index < count; index++) {
      const position = mesh.getAttribute('position');
      for (let component = 0; component < 7; component++) packed[index * 7 + component] = component + position.getX(index) * 2 + position.getZ(index) * 3;
    }
    const data = new InterleavedBuffer(packed, 7);
    for (let component = 0; component < 5; component++) mesh.setAttribute(`channel${component}`, new InterleavedBufferAttribute(data, 1, component));
    mesh.setAttribute('mow', new InterleavedBufferAttribute(data, 2, 5));
    mesh.addGroup(0, 192, 0); mesh.addGroup(192, 192, 1);
    clipLegacyTerrainGeometry(mesh, { x0: -1.7, x1: 2.3, z0: -2.1, z1: 1.9 }, identity);
    const position = mesh.getAttribute('position');
    expect(mesh.getAttribute('channel0').data).toBe(mesh.getAttribute('mow').data);
    expect(mesh.getAttribute('mow').data.stride).toBe(7);
    expect(new Set(Object.values(mesh.attributes).map(attribute => attribute.data || attribute)).size).toBe(3);
    for (let index = count; index < position.count; index++) {
      for (let component = 0; component < 5; component++) {
        expect(mesh.getAttribute(`channel${component}`).getX(index)).toBeCloseTo(component + position.getX(index) * 2 + position.getZ(index) * 3, 5);
      }
      expect(position.getY(index)).toBeCloseTo(3 * position.getX(index) - position.getZ(index), 5);
    }
    expect(mesh.groups.reduce((sum, group) => sum + group.count, 0)).toBe(mesh.index.count);
    expect(mesh.groups[1].start).toBe(mesh.groups[0].count);
  });

  it('samples the native boundary lattice and retains its varying heights in real triangles', () => {
    const mesh = geometry([[-2, 0], [-2, 4], [2, 0]], [0, 1, 2]);
    const report = clipLegacyTerrainGeometry(mesh, { x0: 0, x1: 1, z0: 0, z1: 4 }, identity, {
      boundarySpacing: 1,
      heightAt: (x, z) => 10 * Math.sin(z * Math.PI / 2) + x,
    });
    const position = mesh.getAttribute('position');
    let midpoint = -1;
    for (let index = 3; index < position.count; index++) if (position.getX(index) === 0 && position.getZ(index) === 1) midpoint = index;
    expect(midpoint).toBeGreaterThan(-1);
    expect(position.getY(midpoint)).toBeCloseTo(10, 6);
    expect([...mesh.index.array].includes(midpoint)).toBe(true);
    expect(area(triangles(mesh))).toBeCloseTo(6.5, 6);
    expect(triangles(mesh).every(([a, b, c]) => cross(a, b, c) < 0)).toBe(true);
    expect(report.addedVertices).toBeGreaterThan(3);
  });

  it('keeps native samples when a clipped edge extends past a rectangle corner', () => {
    const mesh = geometry([[-2, -2], [2, 4], [2, -2]], [0, 1, 2]);
    clipLegacyTerrainGeometry(mesh, { x0: -1, x1: 1, z0: 0, z1: 4 }, identity, {
      boundarySpacing: 1,
      heightAt: (x, z) => x + z * z,
    });
    const position = mesh.getAttribute('position'), used = new Set(mesh.index.array);
    const samples = [...used].filter(index => Math.abs(position.getX(index) - 1) < 1e-7);
    expect(samples.some(index => Math.abs(position.getZ(index)) < 1e-7)).toBe(true);
    expect(samples.some(index => Math.abs(position.getZ(index) - 1) < 1e-7)).toBe(true);
    expect(samples.some(index => Math.abs(position.getZ(index) - 2) < 1e-7)).toBe(true);
    for (const index of samples) expect(position.getY(index)).toBeCloseTo(1 + position.getZ(index) ** 2, 5);
  });

  it('keeps exact contacts and outside triangles while deleting wholly covered faces', () => {
    const mesh = geometry([[-2, 0], [0, 0], [0, 2], [0.1, 0.1], [0.1, 0.9], [0.9, 0.1]], [0, 2, 1, 3, 4, 5]);
    const report = clipLegacyTerrainGeometry(mesh, { x0: 0, x1: 1, z0: 0, z1: 1 }, identity);
    expect([...mesh.index.array]).toEqual([0, 2, 1]);
    expect(report.fullyRemovedTriangles).toBe(1);
    expect(report.addedVertices).toBe(0);
  });

  it('handles a rectangle inside one large triangle, including all four corners', () => {
    const mesh = geometry([[-10, -10], [0, 20], [10, -10]], [0, 1, 2]);
    clipLegacyTerrainGeometry(mesh, { x0: -1, x1: 1, z0: -1, z1: 1 }, identity);
    expect(area(triangles(mesh))).toBeCloseTo(300 - 4, 6);
    expect(covers(triangles(mesh), [0, 0])).toBe(false);
    expect(covers(triangles(mesh), [1.001, 0])).toBe(true);
  });

  it('leaves the geometry untouched if boundary height sampling fails', () => {
    const mesh = grid(), position = mesh.getAttribute('position'), index = mesh.getIndex();
    expect(() => clipLegacyTerrainGeometry(mesh, { x0: -1.5, x1: 1.5, z0: -1.5, z1: 1.5 }, identity, {
      heightAt: () => { throw new Error('source missing'); },
    })).toThrow('source missing');
    expect(mesh.getAttribute('position')).toBe(position);
    expect(mesh.getIndex()).toBe(index);
  });

  it('upgrades an index buffer when clipping adds vertices past its 16-bit limit', () => {
    const mesh = new BufferGeometry();
    const values = new Float32Array(65_535 * 3);
    values.set([-2, 0, 0, -2, 0, 4, 2, 0, 0]);
    mesh.setAttribute('position', new BufferAttribute(values, 3));
    mesh.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2]), 1));
    clipLegacyTerrainGeometry(mesh, { x0: 0, x1: 1, z0: 0, z1: 4 }, identity, { boundarySpacing: 1 });
    expect(mesh.index.array).toBeInstanceOf(Uint32Array);
    expect(Math.max(...mesh.index.array)).toBeGreaterThan(65_535);
    expect(area(triangles(mesh))).toBeCloseTo(6.5, 6);
  });
});
