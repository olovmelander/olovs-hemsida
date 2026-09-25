/* THE GLOW AT A LOW SUN (docs/visual-glow-2026-09-25.md). The bloom (three's
   BloomNode, main.js) keeps what passes a luminance threshold in the scene's
   linear colour -- before exposure and tone mapping -- through a knee, blurs it
   and adds it back at the preset's strength. At one threshold of 0.86 for every
   light, golden hour's glow went to the greens' sheen toward the sun and to
   sunlit white alone. Its clear sky peaks at 0.52, its clouds at 0.67 whether
   beside the sun or not, and the sun's road on the water at 0.47 (measured on
   the player's own materials): nothing where the light comes from glowed. Now:
   - each low-sun preset has its own threshold (painted-world-palette.mjs
     bloomThreshold), just above the broad paint that must not glow: its clouds,
     its sky and the haze its horizon and far ground fade into;
   - toward the sun the clouds' lit centres shine past their paint, in the sun
     glow's colour (painted-sky.mjs, skyCloudGlow), so they are what crosses it
     and stay warm: a plain brightening went white under ACES.
   Noon, blue hour, storm and mist keep 0.86: none has a low sun, and the dusk
   lamps were tuned to it. Autumn keeps it too, its clouds being nearly as white
   as noon's. High quality only: low quality has no bloom, and without it the
   clouds keep their paint (main.js skyPreset), so phones see the sky they did. */
import { Color } from 'three/webgpu';
import { hazeGlowStrength } from './aerial-perspective.mjs';

export const GLOW = Object.freeze({
  /* the pipeline's bloom as main.js builds it: threshold, knee (smoothWidth), radius */
  threshold: 0.86, knee: 0.3, radius: 0.3,
  /* how far above a preset's broad sky paint its own threshold must sit */
  margin: 0.02,
});
/* the clouds' shine, over the cloud field's own threshold: from where the soft edge ends to the thick centre */
export const CLOUD_GLOW = Object.freeze({ centre: [0.105, 0.3] });

/** The preset's glow threshold. */
export const glowThresholdOf = p => p.bloomThreshold ?? GLOW.threshold;
/** How far the clouds' centres shine past their paint at the sun, per channel:
    the sky's sun glow colour at its brightest channel, times skyCloudGlow. */
export function cloudGlowOf(p, out = new Color()) {
  out.setHex(p.skySunGlow ?? 0xffffff);
  return out.multiplyScalar((p.skyCloudGlow ?? 0) / Math.max(out.r, out.g, out.b, 1e-3));
}

export const luminanceOf = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** The brightest broad paint of a preset's sky, as the painted sky and the haze
    draw it (linear luminance): its clouds' lit paint and its clear sky's colours
    and sun glow, at the sky's exposure, and the haze -- warmed toward the sun --
    its horizon and far ground fade into. `fogColour` is the fog as setPreset
    leaves it. */
export function skyPaintCeiling(p, fogColour) {
  const exposure = p.paintedSkyExposure ?? 1;
  const colour = (hex, fallback) => new Color(hex ?? fallback);
  const horizon = colour(p.skyHorizon, 0xccddee);
  /* the sun glow, at its strength, over the horizon it is strongest above (painted-sky.mjs) */
  const glow = horizon.clone().lerp(colour(p.skySunGlow, 0xffffff), Math.min(1, p.skySunGlowStrength ?? 0));
  const sky = [colour(p.skyCloudLit, 0xfff5df), colour(p.skyZenith, 0x6688bb), horizon, glow];
  const fog = new Color(fogColour);
  const warmed = fog.clone().lerp(colour(p.skySunGlow, 0xffffff), Math.min(1, hazeGlowStrength(p)));
  return Math.max(...sky.map(c => luminanceOf(c) * exposure), luminanceOf(fog), luminanceOf(warmed));
}

/** A cloud's lit centre at the sun, shining (linear luminance): what crosses the
    threshold. It covers the clear sky there -- the horizon in the sun glow -- as
    thickly as the preset's clouds are dense (painted-sky.mjs), so thin clouds,
    the midnight sun's, must shine the more for it. */
export function shiningCloudAtSun(p) {
  const lit = new Color(p.skyCloudLit ?? 0xfff5df), glow = cloudGlowOf(p);
  const shining = new Color(lit.r * (1 + glow.r), lit.g * (1 + glow.g), lit.b * (1 + glow.b));
  const clear = new Color(p.skyHorizon ?? 0xccddee).lerp(new Color(p.skySunGlow ?? 0xffffff), Math.min(1, p.skySunGlowStrength ?? 0));
  return luminanceOf(clear.lerp(shining, Math.min(1, (p.cloudDensity ?? 1) * 1.5))) * (p.paintedSkyExposure ?? 1);
}
