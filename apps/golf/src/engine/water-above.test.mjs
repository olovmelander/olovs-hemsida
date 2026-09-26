/* The water from above: the body keeps in a cloud's shade the share of its light
   level open ground keeps there, the shade crossing the shoreline; the calm and
   gusty patches show from above as glassy and ruffled water; and main.js draws
   both, each behind its before. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';
import { cloudShadowOf } from './cloud-shadow.mjs';
import { NORDIC_WATER, waterPatchMean } from './nordic-water.mjs';
import { WATER_ROAD } from './water-road.mjs';
import { WATER_ABOVE, groundCloudShadeFor } from './water-above.mjs';

const painted = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);
const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/* the body's light in a preset's densest cloud shade: mix(share, 1, the sun the cloud leaves) */
const deepest = name => {
  const k = groundCloudShadeFor(painted(name)), s = 1 - cloudShadowOf(painted(name)).opacity;
  return { r: k.r + (1 - k.r) * s, g: k.g + (1 - k.g) * s, b: k.b + (1 - k.b) * s };
};
const SUNNY = ['golden', 'noon', 'dawn', 'midnight', 'host'];

describe('the water from above', () => {
  it('keeps in a cloud\'s shade the share of its light level ground keeps: the sky\'s, bluer than the sun\'s', () => {
    for (const name of SUNNY) {
      const k = groundCloudShadeFor(painted(name));
      for (const c of ['r', 'g', 'b']) { expect(k[c]).toBeGreaterThan(0); expect(k[c]).toBeLessThan(1); }
      /* the shade keeps the sky's light, so it is cooler than the sun it loses */
      expect(k.b).toBeGreaterThan(k.g);
      expect(k.g).toBeGreaterThan(k.r);
    }
    /* deepest under a high sun, lightest where a low sun lights level ground little
       (the lights audit lowered noon's sun and lifted golden hour's shade: 0.673 and 0.852 before) */
    expect(lum(deepest('noon'))).toBeCloseTo(0.683, 2);
    expect(lum(deepest('golden'))).toBeCloseTo(0.849, 2);
    expect(lum(deepest('host'))).toBeCloseTo(0.903, 2);
    expect(lum(deepest('dawn'))).toBeGreaterThan(0.95);
    expect(lum(deepest('midnight'))).toBeGreaterThan(0.95);
  });

  it('reckons the share from the lights as three lights level ground', () => {
    /* no sun above the horizon: nothing for a cloud to take */
    expect(groundCloudShadeFor({ ...painted('noon'), dir: [0, -1, 0] }).toArray()).toEqual([1, 1, 1]);
    /* no sky-lit share and no fill: a cloud's full shade takes it all */
    const bare = { ...painted('noon'), hemiI: 0, shadowSky: 0, environment: { ground: 0, horizon: 0, zenith: 0 } };
    for (const v of groundCloudShadeFor(bare).toArray()) expect(v).toBeCloseTo(0, 9);
    /* the environment's light on level ground: its sky, mix(horizon, zenith, sqrt(up)), cosine-weighted */
    let zenith = 0;
    for (let i = 0, n = 100000; i < n; i++) { const u = (i + 0.5) / n; zenith += 2 * u * Math.sqrt(u) / n; }
    expect(WATER_ABOVE.overhead.zenith).toBeCloseTo(zenith, 4);
    expect(WATER_ABOVE.overhead.horizon).toBeCloseTo(1 - zenith, 4);
    /* the player's baseline environment (graphics=0) is its own palette */
    expect(groundCloudShadeFor(painted('golden'), { environment: false }).toArray()).not.toEqual(groundCloudShadeFor(painted('golden')).toArray());
  });

  it('shows the patches from above as glassy and ruffled water, a little darker and lighter', () => {
    const mean = waterPatchMean(), calm = NORDIC_WATER.patches.calm / mean, gusty = NORDIC_WATER.patches.gusty / mean;
    /* the relief as the square of the chop: 1.8 times in a gusty patch, and half in a calm one, whose square
       (a quarter) left it dead flat seen from 60 m */
    expect(gusty * gusty).toBeCloseTo(1.79, 1);
    expect(calm * calm).toBeLessThan(WATER_ABOVE.lanes.glassy);
    expect(WATER_ABOVE.lanes.glassy).toBe(0.5);
    /* the brightness: at most 3% lighter and 4% darker at the reference wind */
    expect((gusty - 1) * WATER_ABOVE.lanes.gain).toBeLessThan(0.03);
    expect((calm - 1) * WATER_ABOVE.lanes.gain).toBeGreaterThan(-0.041);
    /* from above: from 25 degrees down, in full from 45 */
    const deg = d => Math.sin(d * Math.PI / 180);
    expect(WATER_ABOVE.above).toEqual([deg(25), deg(45)]);
    /* all of any Ovan frame (top-view.mjs, 48 degrees tall): a desktop's 16:9 corners are seen from the water 48 degrees up */
    const corner = Math.atan(Math.hypot(Math.tan(24 * Math.PI / 180), 16 / 9 * Math.tan(24 * Math.PI / 180)));
    expect(Math.cos(corner)).toBeGreaterThan(WATER_ABOVE.above[1]);
    /* and none of the owner's view over Visby's sea: 180 m up, the water from 450 m out, 22 degrees down at most */
    expect(180 / Math.hypot(180, 450)).toBeLessThan(WATER_ABOVE.above[0]);
  });

  it('is drawn by the water\'s shading: the body in the shade, the relief as rough as the patch', () => {
    const above = fs.readFileSync(new URL('./water-above.mjs', import.meta.url), 'utf8');
    /* under a low sun only as the eye looks down; under a high one everywhere, as the road is cut (water-road.mjs) */
    expect(above).toMatch(/const \[low, high\] = WATER_ROAD\.cloudSun;\n\s+return mix\(float\(1\), sunlit, max\(fromAbove\(V\), smoothstep\(low, high, sunUp\)\)\);/);
    expect(WATER_ROAD.cloudSun[0]).toBeCloseTo(Math.sin(15 * Math.PI / 180), 9);
    expect(above).toMatch(/export const bodyCloudShade = share => mix\(waterCloudShade, vec3\(1\), share\);/);
    expect(above).toMatch(/export const waterRoughness = \(\{ chop, V \}\) => mix\(float\(1\), chop\.mul\(chop\)\.max\(WATER_ABOVE\.lanes\.glassy\), fromAbove\(V\)\);/);
    const road = fs.readFileSync(new URL('./water-road.mjs', import.meta.url), 'utf8');
    /* the roughness scales the tilt inside the relief's cap */
    expect(road).toMatch(/return \(rough \? tilt\.mul\(rough\) : tilt\)\.mul\(gain\)\.clamp\(-cap, cap\)\.mul\(sunlit \? waterReliefSun\.mul\(sunlit\) : waterReliefSun\)\.add\(1\);/);
    const shading = fs.readFileSync(new URL('./water-shading.mjs', import.meta.url), 'utf8');
    expect(shading).toMatch(/const bodySun = cloudShade && sunlit \? bodySunlit\(\{ sunlit, V, sunUp: uSun\.y \}\) : null;/);
    expect(shading).toMatch(/const rough = lanes && patchChop \? waterRoughness\(\{ chop: patchChop, V \}\) : null;/);
    expect(shading).toMatch(/if \(relief\) body = body\.mul\(bodyRelief\(\{ N, sun: uSun, sunlit: bodySun, rough \}\)\);/);
    expect(shading).toMatch(/if \(shade\) body = body\.mul\(shade\);\n\s+if \(rough\) body = body\.mul\(waterLanes\(\{ chop: patchChop, V \}\)\);/);
    /* the wash takes the shade; the reflection, mixed in after, does not */
    expect(shading).toMatch(/c = mix\(c, shade \? color\(0xdfeeee\)\.mul\(shade\) : color\(0xdfeeee\), foam/);
    expect(shading.indexOf('if (shade) body = body.mul(shade);')).toBeLessThan(shading.indexOf('let c = mix(body, skyC,'));
  });

  it('is wired in main.js, each part behind its before', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const WATER_CLOUD_ON = new URLSearchParams\(location\.search\)\.get\('watercloud'\) !== '0';/);
    expect(main).toMatch(/const WATER_LANES_ON = new URLSearchParams\(location\.search\)\.get\('waterlanes'\) !== '0';/);
    expect(main).toMatch(/sea: sea && OPEN_SEA_ON,\n\s+cloudShade: WATER_CLOUD_ON, lanes: WATER_LANES_ON \}\);/);
    /* the shade's share follows the preset, as the player's environment lights the ground */
    expect(main).toMatch(/setWaterRoadPreset\(p\);\n[^\n]*\n\s+setWaterAbovePreset\(p, \{ environment: GRAPHICS_POLISH \}\);/);
    expect(main).toMatch(/const lightingEnvironment = createLightingEnvironment\(renderer, scene, \{\n\s+enabled: GRAPHICS_POLISH,/);
  });
});
