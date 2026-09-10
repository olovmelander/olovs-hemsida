/* Measure object heights in the retained 2026 orthophoto from shadow length.
 *
 * The capture instant comes from the source item's own STAC record and the sun
 * from NOAA's algorithm, so the scale factor is independent of everything
 * measured with it. Calibration first: the range service barn's ridge is a
 * laser-measured RH2000 height over a recorded ground anchor, so its shadow
 * tests the rule before the rule is applied to the net posts. */
import { sampleWindow, luminance, toWorld, toPixel, TILE } from './ortho-sample.mjs';
import { solarPosition, shadowBearingDeg, heightFromShadow, shadowFromHeight } from './solar.mjs';

const SITE = { lat: 59.66075504228196, lon: 16.728689063923202 };
/* o66150_5975_25_mr26 covers the net and the barn; captureStart..End 15 s apart. */
export const CAPTURE = '2026-05-02T13:09:09Z';
export const SUN = solarPosition(CAPTURE, SITE.lat, SITE.lon);
const BEARING = shadowBearingDeg(SUN);
/* Shadow direction in PIXELS: +x east, +y south. */
const dirPixel = [Math.sin(BEARING * Math.PI / 180), -Math.cos(BEARING * Math.PI / 180)];

export function backgroundResidual(s, radius = 14) {
  const integral = new Float64Array((s.w + 1) * (s.h + 1));
  for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++)
    integral[(j + 1) * (s.w + 1) + i + 1] = luminance(s, i, j) + integral[j * (s.w + 1) + i + 1]
      + integral[(j + 1) * (s.w + 1) + i] - integral[j * (s.w + 1) + i];
  return (i, j) => {
    const x0 = Math.max(0, i - radius), x1 = Math.min(s.w - 1, i + radius);
    const y0 = Math.max(0, j - radius), y1 = Math.min(s.h - 1, j + radius);
    const sum = integral[(y1 + 1) * (s.w + 1) + x1 + 1] - integral[y0 * (s.w + 1) + x1 + 1]
      - integral[(y1 + 1) * (s.w + 1) + x0] + integral[y0 * (s.w + 1) + x0];
    return sum / ((x1 - x0 + 1) * (y1 - y0 + 1)) - luminance(s, i, j);
  };
}

/** Walk from a start point along the shadow bearing until the ground recovers. */
export function shadowRun(s, residual, startPixel, { threshold, maxMetres = 40 }) {
  const steps = Math.round(maxMetres / TILE.metresPerPixel);
  let last = 0;
  for (let t = 0; t <= steps; t++) {
    const i = Math.round(startPixel[0] + dirPixel[0] * t), j = Math.round(startPixel[1] + dirPixel[1] * t);
    if (i < 1 || j < 1 || i >= s.w - 1 || j >= s.h - 1) break;
    /* one pixel either side, so a shadow a little off the exact bearing still counts */
    let best = -Infinity;
    for (let o = -1; o <= 1; o++) best = Math.max(best, residual(i - Math.round(dirPixel[1] * o), j + Math.round(dirPixel[0] * o)));
    if (best >= threshold) last = t;
    else if (t - last > 6) break;                       /* two metres of clear ground ends it */
  }
  return last * TILE.metresPerPixel;
}

export { BEARING, dirPixel, heightFromShadow, shadowFromHeight, sampleWindow, toWorld, toPixel };
