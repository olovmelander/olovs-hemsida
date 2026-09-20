import * as THREE from 'three/webgpu';
import { attribute, texture, vec2, float, normalize, cameraPosition, positionWorld, normalWorld, saturate, pow } from 'three/tsl';
import { flagClothIndex } from './flag-cloth.mjs';

export const FLAG_GRID = { nx: 17, nz: 11, width: 0.78, height: 0.5, hoistX: 0.024, top: 2.53 };
export const FLAG_SLEEVE_RADIUS = 0.026;
// LatheGeometry takes radii. The pole's intended diameters are 4.5 -> 3.5 cm.
export const FLAG_POLE_PROFILE = [[0.0001, -1.3], [0.0225, -1.3], [0.0193, 0.705],
  [FLAG_SLEEVE_RADIUS, 0.715], [FLAG_SLEEVE_RADIUS, 1.245], [0.018, 1.255], [0.0175, 1.3], [0.0001, 1.3]];

/* One atlas and one material for the course. Each cell has an inset border to
   keep neighbouring numbers out of the mipmaps. No invented club crests. */
export function createFlagAtlas(holeNumbers) {
  const cols = 4, rows = Math.max(1, Math.ceil(holeNumbers.length / cols));
  const cellW = 256, cellH = 160, pad = 8;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW; canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f2d24b'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  holeNumbers.forEach((number, index) => {
    const x = index % cols * cellW + pad, y = Math.floor(index / cols) * cellH + pad;
    const w = cellW - 2 * pad, h = cellH - 2 * pad;
    ctx.save(); ctx.translate(x, y); ctx.scale(w / 0.78, h / 0.5);
    // A reinforced hoist, turned hems and two restrained rows of stitching.
    ctx.fillStyle = '#e6c53e'; ctx.fillRect(0, 0, 0.022, 0.5);
    ctx.strokeStyle = 'rgba(123,99,32,0.24)'; ctx.lineWidth = 0.004;
    ctx.strokeRect(0.012, 0.012, 0.756, 0.476);
    ctx.setLineDash([0.007, 0.006]); ctx.lineWidth = 0.0017;
    ctx.strokeStyle = 'rgba(255,244,184,0.8)';
    ctx.strokeRect(0.021, 0.021, 0.738, 0.458);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(35,63,46,0.65)'; ctx.lineWidth = 0.003;
    ctx.beginPath(); ctx.arc(0.43, 0.25, 0.13, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#284932'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '600 0.18px sans-serif'; ctx.fillText(String(number), 0.43, 0.256);
    ctx.restore();
  });
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return { map, cols, rows, cellW, cellH, pad };
}

function createWeaveTexture() {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const warp = Math.cos(x / size * Math.PI * 2), weft = Math.cos(y / size * Math.PI * 2);
    const shade = Math.round(128 + 45 * warp + 45 * weft);
    const k = (y * size + x) * 4;
    data[k] = data[k + 1] = data[k + 2] = shade; data[k + 3] = 255;
  }
  const map = new THREE.DataTexture(data, size, size);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true; map.needsUpdate = true; map.anisotropy = 4;
  return map;
}

export function createFlagMaterial(atlas, sunDirection, throughSun) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, side: THREE.DoubleSide });
  const clothUV = attribute('flagUv', 'vec2');
  const weave = texture(createWeaveTexture(), clothUV.mul(vec2(260, 167))).r;
  const ink = texture(atlas.map).rgb;
  material.colorNode = ink.mul(weave.mul(0.035).add(0.9825));
  material.roughnessNode = float(0.92).sub(weave.mul(0.07));
  // Fold-aware transmission: grazing folds dim, and printed ink stays dark.
  // Lighting uniforms already follow the app's time of day and atmosphere.
  const view = normalize(cameraPosition.sub(positionWorld));
  const backlit = pow(saturate(view.dot(sunDirection.negate())), 2);
  const incidence = normalWorld.dot(sunDirection).abs();
  material.emissiveNode = ink.mul(throughSun).mul(backlit).mul(incidence).mul(0.3);
  return material;
}

export function createFlagGeometry(grid, atlas, index) {
  const { nx, nz } = grid;
  const count = nx * nz, clothUV = new Float32Array(count * 2), mapUV = new Float32Array(count * 2);
  const x = index % atlas.cols * atlas.cellW + atlas.pad;
  const y = Math.floor(index / atlas.cols) * atlas.cellH + atlas.pad;
  const width = atlas.cols * atlas.cellW, height = atlas.rows * atlas.cellH;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = (j * nx + i) * 2, u = i / (nx - 1), v = j / (nz - 1);
    clothUV[k] = u; clothUV[k + 1] = 1 - v;
    mapUV[k] = (x + u * (atlas.cellW - 2 * atlas.pad)) / width;
    mapUV[k + 1] = 1 - (y + v * (atlas.cellH - 2 * atlas.pad)) / height;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(mapUV, 2));
  geometry.setAttribute('flagUv', new THREE.BufferAttribute(clothUV, 2));
  geometry.setIndex(new THREE.BufferAttribute(flagClothIndex(nx, nz), 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.4, 2.05, 0), 1.05);
  return geometry;
}

/* The bake straightened each band around the pole axis, so its pinned edge
   has a different x/z in each band. Translate the whole posed mesh by that
   edge (including during blends), preserving every fold and cloth dimension. */
export function anchorFlagHoist(pose, position) {
  position.x = FLAG_GRID.hoistX - pose[0];
  position.z = -pose[2];
  return position;
}
