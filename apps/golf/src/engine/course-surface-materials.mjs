import {
  DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping,
} from 'three/webgpu';
import { Fn, cameraViewMatrix, dFdx, dFdy, float, int, max, mix, normalize, oneMinus,
  select, smoothstep, texture, vec2, vec3, vec4 } from 'three/tsl';
import { SURFACE } from './surface.js';
import { fetchPlayingHeightArt } from './playing-height-art-cache.mjs';

const SIZE = 256;
const LAYERS = 8;
// Array layer, swatch width in metres, share of mowing direction, normal strength.
export const COURSE_SWATCHES = Object.freeze({
  [SURFACE.GREEN]: [0, .36, 1, .13],
  [SURFACE.FRINGE]: [1, .50, 1, .19],
  [SURFACE.TEE]: [2, .58, 1, .19],
  [SURFACE.FAIRWAY]: [3, .72, 1, .22],
  [SURFACE.SEMI]: [4, .85, .80, .26],
  [SURFACE.ROUGH]: [5, 1.05, 0, .32],
  [SURFACE.HEATH]: [6, 1.35, 0, .33],
  [SURFACE.SAND]: [7, .32, 0, .24],
});

// Each image stacks eight swatches. Array layers retain independent,
// repeatable mip chains on WebGPU and WebGL2, including anisotropic views.
async function readLayers(url, count = LAYERS) {
  const response = await fetchPlayingHeightArt(url);
  if (!response.ok) throw new Error('Course surface material unavailable (' + response.status + ')');
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    if (bitmap.width !== SIZE || bitmap.height !== SIZE * count) throw new Error('Invalid course material swatch dimensions');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  } finally { bitmap.close(); }
}

export async function loadCourseSurfaceMaterials() {
  const layers = await Promise.all([
    readLayers(new URL('./assets/turf/pigment.webp', import.meta.url)),
    readLayers(new URL('./assets/turf/normal-roughness.webp', import.meta.url)),
    readLayers(new URL('./assets/turf/canopy.webp', import.meta.url), 1),
  ]);
  const bytes = new Uint8Array(SIZE * SIZE * 4 * (LAYERS * 2 + 1));
  layers.forEach((pixels, index) => bytes.set(pixels, index * layers[0].length));
  const map = new DataArrayTexture(bytes, SIZE, SIZE, LAYERS * 2 + 1);
  map.name = 'Course surface swatches';
  map.colorSpace = NoColorSpace;
  map.wrapS = map.wrapT = RepeatWrapping;
  map.minFilter = LinearMipmapLinearFilter;
  map.magFilter = LinearFilter;
  map.anisotropy = 4;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

/** De-lit pigment, tangent slope and roughness on the existing class weights.
 * The strongest cut owns only its high-frequency grain. At a tie the grain
 * fades continuously through the exact blend of the two base materials.
 */
export function courseSurfaceFinish({ classes, weights, wp, dir, map, normal }) {
  const entries = classes.flatMap((sid, i) => COURSE_SWATCHES[sid] ? [{ spec: COURSE_SWATCHES[sid], weight: weights[i] }] : []);
  if (!entries.length) return null;
  const style = Fn(() => {
    const strongest = float(-1).toVar();
    const props = vec4(0, 1, 0, 0).toVar();
    for (const { spec, weight } of entries) {
      const winning = weight.greaterThan(strongest);
      props.assign(select(winning, vec4(spec[0], 1 / spec[1], spec[2], spec[3]), props));
      strongest.assign(max(strongest, weight));
    }
    return props;
  })();
  const shareOfMaterials = entries.reduce((sum, entry) => sum.add(entry.weight), float(0)).clamp(0, 1);
  const dominant = entries.reduce((best, { weight }) => max(best, weight), float(0));
  const coverage = smoothstep(.50, .98, dominant);
  const wildBearing = vec2(.8, .6);
  // Choose the two coordinate frames themselves. Blending antiparallel unit
  // bearings can vanish, so a semi-rough pass uses its mapped bearing intact.
  const bearing = dir ? select(style.z.greaterThan(.5), dir, wildBearing) : wildBearing;
  const across = vec2(bearing.y.negate(), bearing.x);
  const project = point => vec2(point.dot(bearing), point.dot(across)).mul(style.y);
  // Smoothly vary the origin of the tiny cut swatches across the ground.
  // This leaves a mower pass's direction intact. Its vein pattern never
  // lines up multiple swatches in a row, even when photographed at grazing.
  const waviness = vec2(wp.dot(vec2(.73, .37)), wp.dot(vec2(-.31, .61))).sin()
    .add(vec2(wp.dot(vec2(-.19, .42)), wp.dot(vec2(.51, .23))).sin().mul(.53));
  const phase = waviness.mul(.49);
  const uv = project(wp).add(phase);
  const dx = project(dFdx(wp)).add(dFdx(phase)), dy = project(dFdy(wp)).add(dFdy(phase));
  const sample = layer => texture(map, uv).depth(int(layer)).grad(dx, dy);
  const pigment = sample(style.x).rgb;
  const finish = sample(style.x.add(LAYERS)).rgb;
  const footprint = max(dx.length(), dy.length());
  // Variance disappears with the mip chain. Limit shading tilt again when
  // the rendered footprint covers multiple stems, avoiding specular crawl.
  const resolved = oneMinus(smoothstep(.024, .15, footprint));
  const tilt = finish.xy.mul(2).sub(1).mul(style.w).mul(coverage).mul(resolved);
  const slope = bearing.mul(tilt.x).add(across.mul(tilt.y));
  const viewTilt = cameraViewMatrix.mul(vec4(slope.x, 0, slope.y, 0)).xyz;
  const baseNormal = normalize(normal);
  const shadingNormal = normalize(baseNormal.add(viewTilt.sub(baseNormal.mul(baseNormal.dot(viewTilt)))));
  const grain = mix(vec3(1), pigment.mul(2).clamp(.54, 1.58), coverage);
  const share = sid => {
    const i = classes.indexOf(sid);
    return i < 0 ? float(0) : weights[i];
  };
  // Mown varieties carry fine cool living crowns and a little dry stubble.
  // On deep grass the patchier thatch persists beyond individual leaf pixels.
  const wild = share(SURFACE.ROUGH).add(share(SURFACE.HEATH));
  const sand = share(SURFACE.SAND);
  const fieldUV = vec2(wp.dot(vec2(.911, .412)), wp.dot(vec2(-.412, .911))).div(4.8)
    .add(waviness.mul(.105));
  const field = texture(map, fieldUV).depth(int(LAYERS * 2)).rgb.sub(.5);
  const mown = oneMinus(wild.max(sand));
  const patch = vec3(1).add(vec3(.36, .27, .18).mul(field.r).mul(mown))
    .add(vec3(.48, .20, -.025).mul(field.g).mul(wild))
    .add(vec3(.17, .18, .19).mul(field.b).mul(sand));
  return { pigment: grain.mul(patch), normal: shadingNormal, roughness: finish.b.clamp(.35,.99), coverage, share: shareOfMaterials };
}
