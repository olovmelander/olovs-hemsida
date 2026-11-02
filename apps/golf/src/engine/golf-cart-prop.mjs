/* THE GOLF CART, MODELLED (2 November). The cart parks drew each cart as five
   boxes, a quad windscreen and four bent-quad posts: "the shape a golf cart is
   from twenty metres". The Blender MCP built a painted one
   (tools/blender-props/golf_cart.py): a rounded tub, cowl and deck, a canopy
   on four posts, seat and backrest, windscreen, steering wheel, bag rack and
   wheels with hubs, every edge bevelled, 2,396 triangles in painted vertex
   colours. Its body is white and takes each cart's colour per instance (the
   fleet is white with one blue), so a park of ten is two instanced draws.
   The asset is content-addressed and checked like the authored buildings: its
   bytes, its sha256, and a GLB that may not reference anything outside itself. */
import * as THREE from 'three/webgpu';
import { inspectBuildingGlb } from './authored-buildings.mjs';

export const GOLF_CART_ASSET = Object.freeze({
  url: 'models/props/golf-cart-ba27a8f96c7235d227d08ccf0bf2c4178014f8370d714b986a22357fb46f02d1.glb',
  sha256: 'ba27a8f96c7235d227d08ccf0bf2c4178014f8370d714b986a22357fb46f02d1',
  bytes: 109992,
  meshes: Object.freeze(['cart_body', 'cart_trim']),
});

const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

/** The cart's two geometries ({ body, trim }), verified; positions in metres, the ground at y = 0. */
export async function loadGolfCart({ baseUrl = '/', fetchImpl = fetch, asset = GOLF_CART_ASSET } = {}) {
  const res = await fetchImpl(baseUrl + asset.url);
  if (!res.ok) throw new Error(`golf cart: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength !== asset.bytes) throw new Error(`golf cart: ${bytes.byteLength} bytes, the record says ${asset.bytes}`);
  if (await hex(bytes) !== asset.sha256) throw new Error('golf cart: sha256 does not match the record');
  inspectBuildingGlb(bytes);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const parts = {};
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(node => {
    if (!node.isMesh) return;
    if (!asset.meshes.includes(node.name)) throw new Error(`golf cart: unexpected mesh ${node.name}`);
    const g = node.geometry.clone().applyMatrix4(node.matrixWorld);
    if (!g.attributes.color || !g.attributes.normal) throw new Error(`golf cart: ${node.name} lacks colours or normals`);
    /* the colour may arrive as RGBA: the player's vertex colours are RGB */
    if (g.attributes.color.itemSize === 4) {
      const c = g.attributes.color, rgb = new Float32Array(c.count * 3);
      for (let i = 0; i < c.count; i++) { rgb[i * 3] = c.getX(i); rgb[i * 3 + 1] = c.getY(i); rgb[i * 3 + 2] = c.getZ(i); }
      g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    }
    parts[node.name === 'cart_body' ? 'body' : 'trim'] = g;
  });
  if (!parts.body || !parts.trim) throw new Error('golf cart: needs a body and trim');
  return parts;
}

/** Each cart's matrix: standing on `y`, its length along the unit vector (ax, az). */
export function cartMatrix(x, y, z, ax, az, out = new THREE.Matrix4()) {
  /* the model runs along +x; turn +x onto (ax, az) about y */
  const yaw = Math.atan2(-az, ax);
  return out.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
}

/** Two instanced meshes for a park: `carts` [{ x, y, z, ax, az, colour (THREE.Color, linear) }]. */
export function placeGolfCarts(parts, carts, { roughness = 0.6 } = {}) {
  const group = new THREE.Group();
  group.name = 'golf-carts';
  const matrix = new THREE.Matrix4();
  for (const [key, tinted] of [['body', true], ['trim', false]]) {
    const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(parts[key], material, carts.length);
    carts.forEach((c, i) => {
      mesh.setMatrixAt(i, cartMatrix(c.x, c.y, c.z, c.ax, c.az, matrix));
      if (tinted) mesh.setColorAt(i, c.colour);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = `golf-cart-${key}`; mesh.userData.tag = 'carts';
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
