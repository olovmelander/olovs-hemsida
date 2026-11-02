import { CustomToneMapping } from 'three/webgpu';
import { Fn, acesFilmicToneMapping, interleavedGradientNoise, screenCoordinate, float, max, mix, select, smoothstep, vec3 } from 'three/tsl';

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

/* A HUE-KEEPING CURVE (?tonecurve=filmic, after serenity-blocks' Grainfields
   gfFilmic): the identity below a knee on the brightest channel, a rational
   shoulder above it, every channel scaled by the one ratio so a sunlit
   yellow-green keeps its hue, and only peaks far past white go to white.
   ACES's hue shift turns lit greens toward one gold. An A/B, not the default:
   the nine lights were tuned under ACES. */
export const FILMIC_KNEE = 0.6;
const hueKeepingFilmic = Fn(([colourIn]) => {
  const c = max(colourIn, vec3(0));
  const peak = max(max(c.x, max(c.y, c.z)), 1e-5);
  const k = float(FILMIC_KNEE);
  const z = peak.sub(k).div(float(1).sub(k)).max(0);
  const mapped = select(peak.greaterThan(k), k.add(float(1).sub(k).mul(z.div(z.add(1)))), peak);
  const toned = c.mul(mapped.div(peak));
  return mix(toned, vec3(mapped), smoothstep(2.4, 9, peak).mul(0.9));
});
export const ditheredFilmicToneMapping = Fn(([colour, exposure]) => {
  /* three's ACES takes the exposure over 0.6; the same here, so the two meet at mid-grey's brightness */
  const encoded = hueKeepingFilmic(colour.mul(exposure).div(0.6)).sqrt()
    .add(interleavedGradientNoise(screenCoordinate.xy).sub(0.5).mul(DITHER_STEP)).max(0);
  return encoded.mul(encoded);
});

/** Make the renderer's output tone mapping ACES + dither (CustomToneMapping); `curve: 'filmic'` the hue-keeping curve. */
export function installOutputDither(renderer, { curve = 'aces' } = {}) {
  renderer.library.addToneMapping(curve === 'filmic' ? ditheredFilmicToneMapping : ditheredAcesToneMapping, CustomToneMapping);
  renderer.toneMapping = CustomToneMapping;
  return renderer.toneMapping;
}
