import { DoubleSide, MeshStandardNodeMaterial, RepeatWrapping, TextureLoader } from 'three/webgpu';
import {
  attribute, color, float, fract, fwidth, mix, normalView, oneMinus, positionView,
  positionWorld, smoothstep, step, texture, vec2,
} from 'three/tsl';

// Resolve relief from the same mip-filtered height used by the colour. The
// derivative is in metres, so grit never changes the surveyed road profile.
function reliefNormal(height) {
  const dx = positionView.dFdx(), dy = positionView.dFdy();
  const r1 = dy.cross(normalView), r2 = normalView.cross(dx);
  const det = dx.dot(r1);
  const grad = r1.mul(height.dFdx()).add(r2.mul(height.dFdy())).mul(det.sign());
  return normalView.mul(det.abs().max(1e-12)).sub(grad).normalize();
}

function roadAggregate(detail, pebbles, scale) {
  const wp = positionWorld.xz;
  const base = texture(detail, wp.mul(0.13)).g.sub(0.5);
  const grain = pebbles ? texture(pebbles,
    vec2(wp.x.mul(0.8).sub(wp.y.mul(0.6)), wp.x.mul(0.6).add(wp.y.mul(0.8))).div(scale)).b.sub(0.5)
    : base;
  return { base, grain };
}

export function createRoadAsphalt(detail, { paintOnly = false, pebbles } = {}) {
  // The source geometry already carries the road colour in linear space.
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
    const { base, grain } = roadAggregate(detail, pebbles, 0.58);
    const albedo = attribute('color', 'vec3').mul(base.mul(0.13).add(grain.mul(0.25)).add(1));
    material.colorNode = mix(albedo, color(0xcfd2d4), markings);
    material.roughnessNode = float(0.88).sub(grain.mul(0.10)).sub(markings.mul(0.08));
    if (pebbles) material.normalNode = reliefNormal(grain.mul(0.0025));
  }
  return material;
}

export function createRoadGravel(detail, { pebbles, earth = false } = {}) {
  const material = new MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0 });
  material.name = earth ? 'road-earth' : 'road-gravel';
  const { base, grain } = roadAggregate(detail, pebbles, earth ? 0.85 : 1.5);
  material.colorNode = attribute('color', 'vec3')
    .mul(base.mul(0.12).add(grain.mul(earth ? 0.19 : 0.35)).add(1));
  material.roughnessNode = float(0.94).sub(grain.mul(0.10));
  if (pebbles) material.normalNode = reliefNormal(grain.mul(earth ? 0.003 : 0.006));
  return material;
}

export async function loadBridgeRelief() {
  const url = new URL('./assets/bridge-relief.png', import.meta.url).href;
  const map = await new TextureLoader().loadAsync(url);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.anisotropy = 4;
  return map;
}

export async function loadBankGranite() {
  const { fetchPlayingHeightArt } = await import('./playing-height-art-cache.mjs');
  const response = await fetchPlayingHeightArt(new URL('./assets/bank-granite.webp', import.meta.url));
  if (!response.ok) throw new Error('Granite material unavailable (' + response.status + ')');
  const blobUrl = URL.createObjectURL(await response.blob());
  try {
    const map = await new TextureLoader().loadAsync(blobUrl);
    map.wrapS = map.wrapT = RepeatWrapping;
    map.anisotropy = 8;
    return map;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

export function createRetainingWallFinish(granite) {
  const material = new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true, side: DoubleSide });
  if (!granite) return material;
  const coords = attribute('wallSurface', 'vec3');
  const swatch = texture(granite, coords.xy.div(1.9));
  // R holds reflectance measured relative to mid-grey, G roughness and B the
  // shallow chisel/stone-joint relief. Only mapped masonry has a nonzero mask.
  material.colorNode = mix(float(1), float(2).pow(swatch.r.sub(.5).mul(3)), coords.z);
  material.roughnessNode = mix(float(.92), swatch.g.clamp(.55,1), coords.z);
  material.normalNode = reliefNormal(swatch.b.mul(.032).mul(coords.z));
  return material;
}

export function createBridgeFinish(detail, baked) {
  const material = new MeshStandardNodeMaterial({ vertexColors: true, side: DoubleSide, roughness: 0.86 });
  const coords = attribute('deckCoord', 'vec2'), timber = attribute('timber', 'float');
  const sample = texture(baked ?? detail, mix(coords.mul(1.55), coords.mul(vec2(1.8, 0.41)), timber));
  const grain = (baked ? sample.r : sample.g).sub(0.5);
  const mineral = (baked ? sample.g : sample.r).sub(0.5);
  const board = coords.x.div(0.145);
  const footprint = fwidth(board).max(0.003);
  const seamDistance = fract(board.add(0.5)).sub(0.5).abs();
  const seam = oneMinus(smoothstep(0.003, footprint.add(0.013), seamDistance))
    .mul(oneMinus(smoothstep(0.12, 0.45, footprint))).mul(timber);
  const variation = mix(mineral.mul(0.18).add(grain.mul(0.12)), grain.mul(0.40), timber);
  material.colorNode = float(1).add(variation).sub(seam.mul(0.24));
  material.roughnessNode = float(0.85).add(sample.b.sub(0.5).mul(0.14)).add(seam.mul(0.06));
  const height = mix(mineral.mul(0.002), grain.mul(0.003), timber).sub(seam.mul(0.0018));
  material.normalNode = reliefNormal(height);
  return material;
}
