import { CustomToneMapping } from 'three/webgpu';
import { Fn, acesFilmicToneMapping, interleavedGradientNoise, screenCoordinate } from 'three/tsl';

/* ACES, then a static dither of half an 8-bit step before the output quantizes.
   Every canvas the app draws to is 8-bit, and the smooth gradients of the
   painted sky, the haze and the water banded into visible steps -- worst in
   blue hour, where the sky sits in ACES's dark toe. The noise goes in where the
   sRGB encode will quantize (a square root is close to its curve), so it is half
   a step at every brightness, and it is interleaved-gradient noise fixed to the
   pixel grid: det=1 captures stay identical frame to frame and the moving
   picture does not crawl. It lives in the one output function both qualities
   call -- the high-quality pipeline's final quad and the low-quality renderer's
   own output -- so phones and desktops dither alike. */
export const DITHER_STEP = 1 / 255;

export const ditheredAcesToneMapping = Fn(([colour, exposure]) => {
  const encoded = acesFilmicToneMapping(colour, exposure).sqrt()
    .add(interleavedGradientNoise(screenCoordinate.xy).sub(0.5).mul(DITHER_STEP)).max(0);
  return encoded.mul(encoded);
});

/** Make the renderer's output tone mapping ACES + dither (CustomToneMapping). */
export function installOutputDither(renderer) {
  renderer.library.addToneMapping(ditheredAcesToneMapping, CustomToneMapping);
  renderer.toneMapping = CustomToneMapping;
  return renderer.toneMapping;
}
