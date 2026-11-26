import * as THREE from 'three/webgpu';
import {
  color, float, mix, normalGeometry, oneMinus, positionGeometry, sign,
  smoothstep, texture, uv, vec2,
} from 'three/tsl';

export function flagstickFinish(authored) {
  const material = new THREE.MeshStandardNodeMaterial({
    color: authored ? 0xffffff : 0xf2f4f2, vertexColors: authored, roughness: 0.36,
  });
  // Exposed metal at the cup and at both ends of the rotating sleeve. The
  // painted shaft remains dielectric so it holds its white in the shade.
  const height = positionGeometry.y;
  const collars = oneMinus(smoothstep(0.004, 0.006, height.sub(0.719).abs()))
    .max(oneMinus(smoothstep(0.004, 0.007, height.sub(1.242).abs())));
  const metal = collars.max(oneMinus(smoothstep(-1.296, -1.291, height)));
  material.metalnessNode = metal.mul(0.76);
  material.roughnessNode = mix(float(0.36), float(0.27), metal);
  return material;
}

export function distancePlateFinish(metres, paint, authored) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#' + paint.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = metres === 100 ? '#fff6e8' : '#26302c';
  ctx.font = 'bold 96px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(metres), 128, 95);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const front = normalGeometry.z;
  const coords = vec2(positionGeometry.x.mul(sign(front)).div(0.4).add(0.5),
    positionGeometry.y.sub(0.48).div(0.28));
  const face = smoothstep(0.76, 0.96, front.abs());
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: authored, roughness: 0.45 });
  material.colorNode = mix(color(paint), texture(map, coords).rgb, face);
  return material;
}

// A marker has a 26 cm diameter and a post a 7 cm diameter. Their contact
// falls below a directional shadow texel and close to the ground GTAO's cut
// distance. Batch the small occlusion footprints in one draw per object group.
export function addFootContacts(group, entries, radius, heightAt, depthSign) {
  if (!entries.length) return;
  const positions = [], coordinates = [], indices = [];
  for (const { x, z } of entries) {
    const first = positions.length / 3;
    for (const [u, v] of [[-1, -1], [-1, 1], [1, 1], [1, -1]]) {
      const px = x + u * radius, pz = z + v * radius;
      positions.push(px, heightAt(px, pz) + 0.003, pz);
      coordinates.push(u, v);
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicNodeMaterial({
    color: 0x11190f, fog: false, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: depthSign, polygonOffsetUnits: depthSign * 2,
  });
  material.opacityNode = oneMinus(smoothstep(0.12, 1, uv().length())).mul(0.29);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Furniture contact shadows';
  group.add(mesh);
}
