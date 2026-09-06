import * as THREE from 'three/webgpu';
import { bumpMap, color, float, texture, uv, vec2 } from 'three/tsl';

/** Measure the red height channel after ImageData has quantized it to bytes.
 * Call once while the generator still owns its pixels, avoiding a canvas readback.
 */
export function averageBarkSample(rgbaPixels) {
  if (!(rgbaPixels instanceof Uint8Array || rgbaPixels instanceof Uint8ClampedArray)
      || rgbaPixels.length === 0 || rgbaPixels.length % 4 !== 0) {
    throw new TypeError('Bark mean needs nonempty RGBA byte pixels');
  }
  let sum = 0;
  for (let i = 0; i < rgbaPixels.length; i += 4) sum += rgbaPixels[i];
  return sum / (rgbaPixels.length / 4) / 255;
}

/** The existing hero trunk material, with coherent colour/relief in the preview.
 * A supplied measured mean can align average albedo with the plain trunk tiers;
 * omitting it retains the established colour gain. Neither path adds a texture.
 * The caller still owns the tree's wind and geographic-tier fade nodes.
 */
export function createBarkMaterial({ barkTexture, hex, graphicsPolish = false, meanSample } = {}) {
  if (!barkTexture?.isTexture) throw new TypeError('Bark material needs its existing texture');
  if (meanSample !== undefined && (!Number.isFinite(meanSample) || meanSample < 0 || meanSample > 1)) {
    throw new RangeError('Bark mean must be a measured sample in [0, 1]');
  }
  const material = new THREE.MeshStandardNodeMaterial({
    color: new THREE.Color(hex), roughness: 0.95, metalness: 0,
  });
  const barkUV = uv().mul(vec2(3, 1.5));
  const bark = texture(barkTexture, barkUV).r;
  const offset = graphicsPolish && meanSample !== undefined ? 1 - 0.6 * meanSample : 0.62;
  material.colorNode = color(hex).mul(bark.mul(0.6).add(offset));
  if (graphicsPolish) {
    // Match the colour UVs, but keep a separate TextureNode for relief. In r185,
    // sharing the colour's cached sample makes BumpMapNode's offset contexts
    // reuse that sample and subtract it from itself, silently flattening relief.
    // This remains the same texture resource and the same sampling budget as
    // the conventional bump map, whose default UVs did not match the colour.
    material.normalNode = bumpMap(texture(barkTexture, barkUV).r, float(0.05));
  } else {
    material.bumpMap = barkTexture;
    material.bumpScale = 0.05;
  }
  return material;
}
