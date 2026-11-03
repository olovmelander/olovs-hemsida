/* THE GROUND COVER'S SHAPES (2 November). The stones were a flat-shaded
   dodecahedron and the bushes a flat-shaded icosahedron: twelve and twenty
   facets, so a field of them read as cut gems -- gold nuggets under the autumn
   sun. Now painted forms of the same size and footprint (the seating's rims and
   the prepared scatter's places are unchanged):
   - a bush is a puffy mass, its outline gently lumpy, its normals leaned toward
     its own centre and up, so it lights as one soft clump, as the crowns do;
   - a stone is a rounded boulder, a few broad planes softened.
   Both are an icosahedron of detail 1 (80 triangles), displaced by a smooth
   field of their own position, the shared corners welded so the shading is soft. */
import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const field = (x, y, z, seed) =>
  Math.sin(x * 4.1 + seed) * Math.sin(y * 3.7 + seed * 1.7) * Math.sin(z * 4.3 + seed * 0.6)
  + 0.5 * Math.sin(x * 7.9 - z * 6.1 + seed * 2.3);

function soften(geometry, { lump, seed, lean = 0, up = 0 }) {
  const g = mergeVertices(geometry.deleteAttribute('normal').deleteAttribute('uv'));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, y, z) || 1;
    const k = 1 + lump * field(x / r, y / r, z / r, seed);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  if (lean > 0 || up > 0) {
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, y, z) || 1;
      let nx = n.getX(i) * (1 - lean) + (x / r) * lean, ny = n.getY(i) * (1 - lean) + (y / r) * lean + up, nz = n.getZ(i) * (1 - lean) + (z / r) * lean;
      const l = Math.hypot(nx, ny, nz) || 1;
      n.setXYZ(i, nx / l, ny / l, nz / l);
    }
  }
  return g;
}

/** A puffy bush, 1.24 m across and 0.77 m tall, standing on y = 0 (the old one's extent). */
export function puffyBushGeometry() {
  const g = soften(new THREE.IcosahedronGeometry(0.62, 1), { lump: 0.1, seed: 1.3, lean: 0.55, up: 0.18 });
  g.scale(1, 0.62, 1); g.translate(0, 0.34, 0);
  return g;
}

/** A rounded boulder, about 1 x 0.55 x 0.85 m, its base a little into the ground (the old one's extent). */
export function roundedStoneGeometry() {
  const g = soften(new THREE.IcosahedronGeometry(0.5, 1), { lump: 0.13, seed: 4.7, lean: 0.2 });
  g.scale(1, 0.55, 0.85); g.translate(0, 0.16, 0);
  return g;
}
