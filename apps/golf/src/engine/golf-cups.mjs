import * as THREE from 'three/webgpu';
import { positionWorld, texture, vec2 } from 'three/tsl';

// Metres. Keep the existing 108 mm opening; the liner sits below the turf.
export const CUP = Object.freeze({ radius: 0.054, linerInset: 0.027, depth: 0.13, segments: 64 });

/* A sparse spatial lookup: one nearest-filtered texel identifies the exact
   centre of a cup, not a rasterised hole. The shader cuts a true circle even
   on a coarse terrain triangle. Register every cell touched by the opening;
   refine if two cups share a cell. Cost is one sample regardless of hole count,
   with no camera-dependent switching and no changes to course height data. */
export function buildCupField(pins) {
  const unique = [];
  for (const p of pins) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) throw new TypeError('Invalid cup position');
    if (!unique.some(q => q[0] === p[0] && q[1] === p[1])) unique.push(p);
  }
  for (let i = 0; i < unique.length; i++) for (let j = 0; j < i; j++) {
    if (Math.hypot(unique[i][0] - unique[j][0], unique[i][1] - unique[j][1]) < CUP.radius * 2) {
      throw new RangeError('Golf cup openings overlap');
    }
  }
  if (!unique.length) return { data: new Float32Array(4), width: 1, height: 1, x0: 0, z0: 0, spacing: 16 };
  for (let spacing = 16; spacing >= CUP.radius / 2; spacing /= 2) {
    const x0 = Math.floor((Math.min(...unique.map(p => p[0])) - CUP.radius) / spacing) * spacing;
    const z0 = Math.floor((Math.min(...unique.map(p => p[1])) - CUP.radius) / spacing) * spacing;
    const width = Math.floor((Math.max(...unique.map(p => p[0])) + CUP.radius - x0) / spacing) + 1;
    const height = Math.floor((Math.max(...unique.map(p => p[1])) + CUP.radius - z0) / spacing) + 1;
    const occupied = new Map();
    let collision = false;
    unique.forEach(([x, z], i) => {
      for (let iz = Math.floor((z - CUP.radius - z0) / spacing); iz <= Math.floor((z + CUP.radius - z0) / spacing); iz++) {
        for (let ix = Math.floor((x - CUP.radius - x0) / spacing); ix <= Math.floor((x + CUP.radius - x0) / spacing); ix++) {
          const key = iz * width + ix;
          if (occupied.has(key) && occupied.get(key) !== i) collision = true;
          occupied.set(key, i);
        }
      }
    });
    if (collision) continue;
    if (width > 4096 || height > 4096 || width * height > 4_194_304) throw new RangeError('Cup field exceeds texture budget');
    const data = new Float32Array(width * height * 4);
    for (const [cell, i] of occupied) {
      // Relative coordinates retain sub-millimetre precision across the course.
      data.set([unique[i][0] - x0, unique[i][1] - z0, 1, 0], cell * 4);
    }
    return { data, width, height, x0, z0, spacing };
  }
  throw new RangeError('Cup positions cannot be separated');
}

export function createGolfCupMask(pins) {
  const field = buildCupField(pins);
  const { data, width, height, x0, z0, spacing } = field;
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  map.minFilter = map.magFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  map.needsUpdate = true;
  const local = positionWorld.xz.sub(vec2(x0, z0));
  const uv = local.div(vec2(width * spacing, height * spacing));
  const centre = texture(map, uv);
  const delta = local.sub(centre.rg);
  const inside = uv.x.greaterThanEqual(0).and(uv.x.lessThan(1))
    .and(uv.y.greaterThanEqual(0)).and(uv.y.lessThan(1));
  const keep = inside.and(centre.b.greaterThan(0.5))
    .and(delta.dot(delta).lessThan(CUP.radius ** 2)).not();
  const applied = new WeakSet();
  const apply = material => {
    if (!applied.has(material)) {
      material.maskNode = material.maskNode ? material.maskNode.and(keep) : keep;
      applied.add(material);
    }
    return material;
  };
  return { field, map, apply,
    wrap(decorator) {
      const wrapped = (material, context) => apply(decorator(material, context) || material);
      // Terrain preflight still sees the decorator's geographic authority.
      const authority = Object.getOwnPropertyDescriptor(decorator, 'v2SurfaceAuthority');
      if (authority) Object.defineProperty(wrapped, 'v2SurfaceAuthority', authority);
      return wrapped;
    },
  };
}

/* Legacy greens are lifted, triangulated overlays. Find their local triangles
   once per cup, then sample just those faces around the rim. Raycasting the
   whole green batch for every rim vertex would multiply boot work. */
export function cupSurfaceHeightAt(x, z, groundHeightAt, overlays = []) {
  const triangles = [], point = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const radius = CUP.radius + 0.004;
  for (const mesh of overlays) {
    mesh.updateWorldMatrix(true, false);
    const pos = mesh.geometry.attributes.position, index = mesh.geometry.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      a.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
      if (Math.min(a.x, b.x, c.x) > x + radius || Math.max(a.x, b.x, c.x) < x - radius ||
          Math.min(a.z, b.z, c.z) > z + radius || Math.max(a.z, b.z, c.z) < z - radius) continue;
      triangles.push(new THREE.Triangle(a.clone(), b.clone(), c.clone()));
    }
  }
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  return (px, pz) => {
    let y = groundHeightAt(px, pz);
    ray.origin.set(px, y + 100, pz);
    for (const t of triangles) {
      if (ray.intersectTriangle(t.a, t.b, t.c, false, point)) y = Math.max(y, point.y);
    }
    return y;
  };
}

export function createGolfCupGeometry(x, z, heightAt) {
  const n = CUP.segments, y = heightAt(x, z), heights = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n * Math.PI * 2;
    heights.push(heightAt(x + Math.cos(t) * CUP.radius, z + Math.sin(t) * CUP.radius) - y);
  }
  const low = Math.min(...heights), linerTop = low - CUP.linerInset, bottom = low - CUP.depth;
  // Profile runs inward/downward, ending in a closed dark floor. Vertex colour
  // supplies cavity occlusion at this scale, below the scene shadow-map texel.
  const profile = [
    [CUP.radius + 0.002, i => heights[i] + 0.0003, '#344025'],
    [CUP.radius, i => heights[i] - 0.0005, '#30291a'],
    [CUP.radius, () => linerTop, '#211c13'],
    [CUP.radius - 0.003, () => linerTop, '#c4c8b9'],
    [CUP.radius - 0.003, () => linerTop - 0.018, '#858b7a'],
    [CUP.radius - 0.003, () => bottom + 0.012, '#292d22'],
    [CUP.radius - 0.007, () => bottom, '#14180f'],
    [0, () => bottom, '#10130c'],
  ];
  const positions = [], colours = [], indices = [];
  for (const [r, height, hex] of profile) {
    const colour = new THREE.Color(hex);
    for (let i = 0; i <= n; i++) {
      const t = i / n * Math.PI * 2;
      positions.push(Math.cos(t) * r, height(i), Math.sin(t) * r);
      colours.push(colour.r, colour.g, colour.b);
    }
  }
  for (let row = 0; row < profile.length - 1; row++) for (let i = 0; i < n; i++) {
    const a = row * (n + 1) + i, b = a + n + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Close the normal seam at the duplicate 0/360-degree vertices.
  const normals = geometry.attributes.normal;
  for (let row = 0; row < profile.length; row++) {
    const a = row * (n + 1), b = a + n;
    const normal = new THREE.Vector3().fromBufferAttribute(normals, a)
      .add(new THREE.Vector3().fromBufferAttribute(normals, b)).normalize();
    normals.setXYZ(a, normal.x, normal.y, normal.z); normals.setXYZ(b, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingSphere();
  return geometry;
}
