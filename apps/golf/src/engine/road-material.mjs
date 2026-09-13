import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, texture, positionWorld, float, color, mix, smoothstep, oneMinus, step, fract } from 'three/tsl';

export function createRoadAsphalt(detail, { paintOnly = false } = {}) {
  // colorNode reads vertex colour explicitly. Enabling vertexColors as well
  // multiplies that colour a second time in NodeMaterial, making grey black.
  const material = new MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0,
    transparent: paintOnly, depthWrite: !paintOnly });
  material.name = paintOnly ? 'road-markings' : 'road-asphalt';
  const am = attribute('aMow', 'vec2'), paint = attribute('aStr', 'float'), across = am.y.abs();
  const edge = oneMinus(smoothstep(0.025, 0.06, across.sub(0.90).abs())).mul(step(0.5, paint));
  const dash = oneMinus(smoothstep(0.02, 0.05, across)).mul(step(1.5, paint))
    .mul(oneMinus(smoothstep(0.22, 0.27, fract(am.x.div(12)))));
  const markings = edge.add(dash).min(1).mul(0.8);
  if (paintOnly) {
    material.colorNode = color(0xcfd2d4);
    material.opacityNode = markings;
    material.alphaTest = 0.01;
  } else {
    const grain = texture(detail, positionWorld.xz.mul(0.13)).g.sub(0.5);
    const base = attribute('color', 'vec3').mul(grain.mul(0.16).add(1));
    material.colorNode = mix(base, color(0xcfd2d4), markings);
  }
  material.roughnessNode = float(0.9);
  return material;
}

export function createRoadGravel(detail) {
  const material = new MeshStandardNodeMaterial({ roughness: 0.97, metalness: 0 });
  material.name = 'road-gravel';
  const grain = texture(detail, positionWorld.xz.mul(0.31)).g.sub(0.5);
  material.colorNode = attribute('color', 'vec3').mul(grain.mul(0.12).add(1));
  return material;
}
