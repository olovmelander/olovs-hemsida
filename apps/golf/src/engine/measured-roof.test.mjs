import { expect, it } from 'vitest';
import { measuredRoofGeometry } from './measured-roof.mjs';

const vertex = (x, z, heightRH2000) => ({ c: [x, z], heightRH2000 });
const a = vertex(0, 0, 31), b = vertex(4, 0, 32), c = vertex(0, 4, 31);
const surface = { verticalCrs: 'EPSG:5613', vertices: [a, b, c], triangleIndices: [0, 1, 2], boundaryWallSegments: [[a, b]] };

it('preserves absolute roof elevations and partial support while wall bottoms follow measured terrain', () => {
  const geometry = measuredRoofGeometry(surface, (x, z) => 20 + x / 2 + z / 4);
  expect(geometry.triangles).toHaveLength(1);
  expect(geometry.triangles[0].map(p => p[1]).sort()).toEqual([31, 31, 32]);
  expect(geometry.walls).toEqual([[[0, 20, 0], [4, 22, 0], [4, 32, 0], [0, 31, 0]]]);
  expect(geometry.walls).toHaveLength(1); // Missing perimeter segments must stay missing.
  const [p, q, r] = geometry.triangles[0];
  expect((q[2]-p[2])*(r[0]-p[0])-(q[0]-p[0])*(r[2]-p[2])).toBeGreaterThan(0);
  expect(surface.triangleIndices).toEqual([0, 1, 2]);
});

it('rejects wrong datum, invalid indices and walls penetrating the terrain', () => {
  expect(() => measuredRoofGeometry({ ...surface, verticalCrs: 'unknown' }, () => 20)).toThrow();
  expect(() => measuredRoofGeometry({ ...surface, triangleIndices: [0, 1, 3] }, () => 20)).toThrow(/indices/);
  expect(() => measuredRoofGeometry(surface, () => 40)).toThrow(/clearance/);
});
