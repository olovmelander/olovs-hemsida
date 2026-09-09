import { DataTexture, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter } from 'three/webgpu';
import { fillGroundDetailPixels } from './ground-detail-texture.mjs';

/** A is a glint mask, not opacity. Canvas premultiplication destroys RGB
 * precision at low A (and clears RGB at A=0), so packed data must bypass it. */
export function createPackedGroundDetailTexture({ seamless = true } = {}) {
  const pixels = new Uint8ClampedArray(512 * 512 * 4);
  fillGroundDetailPixels(pixels, 512, { seamless });
  const texture = new DataTexture(new Uint8Array(pixels.buffer), 512, 512);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  // Match CanvasTexture's row orientation without its alpha conversion.
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}
