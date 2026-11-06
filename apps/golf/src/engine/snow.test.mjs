import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { vec3, vec4, float } from 'three/tsl';
import { SNOW, isBroadleaf, snowOnGround, snowOnCrown, snowOnRoof, setSnowDrawn } from './snow.mjs';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';
import { setPaintedWorldLighting, paintedSnow, paintedSeason } from './painted-world-lighting.mjs';

describe('winter (snow.mjs)', () => {
  it('lies in the winter light alone among the ten', () => {
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) {
      const p = paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);
      setPaintedWorldLighting(p, name);
      expect(paintedSnow.value, name).toBe(name === 'winter' ? 1 : 0);
      expect(p.bare ?? 0, name).toBe(name === 'winter' ? 1 : 0);
    }
    /* winter's grass is under the snow, not autumn's ochre; Nu's pale grass is `straw` */
    setPaintedWorldLighting(paintedAtmosphere('winter', ATMOSPHERE_PRESETS.winter), 'winter');
    expect(paintedSeason.value).toBe(0);
    setPaintedWorldLighting({ ...paintedAtmosphere('noon', ATMOSPHERE_PRESETS.noon), straw: 1 }, 'noon');
    expect(paintedSeason.value).toBe(1);
    setPaintedWorldLighting(paintedAtmosphere('noon', ATMOSPHERE_PRESETS.noon), 'noon');
  });
  it('stands its January sun low in the south-south-west, its shade the bluest of the ten', () => {
    const { dir } = ATMOSPHERE_PRESETS.winter, elevation = Math.asin(dir[1] / Math.hypot(...dir)) * 180 / Math.PI;
    expect(elevation).toBeGreaterThan(12); expect(elevation).toBeLessThan(18);
    /* z is south, x east: south, a little west */
    expect(dir[2]).toBeGreaterThan(0); expect(dir[0]).toBeLessThan(0);
    const shade = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]).shadowSky ?? 0;
    for (const name of Object.keys(ATMOSPHERE_PRESETS)) if (name !== 'winter') expect(shade('winter')).toBeGreaterThan(shade(name));
  });
  it('takes the broadleaves\' leaves and leaves the conifers their needles', () => {
    for (const key of ['bjork', 'al', 'ek']) expect(isBroadleaf(key)).toBe(true);
    for (const key of ['tall', 'gran', 'martall']) expect(isBroadleaf(key)).toBe(false);
  });
  it('settles most on wild ground and least on mown turf, and sheds from steep faces', () => {
    expect(SNOW.settle.wild).toBeGreaterThan(SNOW.settle.bare);
    expect(SNOW.settle.bare).toBeGreaterThan(SNOW.settle.mown);
    /* a course still reads under it, as on the map */
    expect(SNOW.settle.mown).toBeLessThan(0.95);
    expect(SNOW.slope[0]).toBeLessThan(SNOW.slope[1]);
    /* the snow is the brightest thing on the ground, and still under white */
    expect(Math.max(...SNOW.albedo)).toBeLessThan(0.95);
    expect(SNOW.albedo[2]).toBeGreaterThan(SNOW.albedo[0]);
    /* a crown holds it on its tops alone */
    expect(SNOW.crown.facing[0]).toBeGreaterThanOrEqual(0.5);
  });
  it('draws nothing with ?snow=0: every colour passes through unchanged', () => {
    setSnowDrawn(false);
    try {
      const colour = vec3(0.2, 0.4, 0.1), rgba = vec4(0.5, 0.2, 0.2, 1), normal = vec3(0, 1, 0);
      expect(snowOnGround({ colour, normal })).toBe(colour);
      expect(snowOnCrown({ colour, normal, light: float(1), key: 'gran' })).toBe(colour);
      expect(snowOnRoof(rgba, normal)).toBe(rgba);
    } finally { setSnowDrawn(true); }
    /* and a broadleaf's crown takes none in any light: it is not drawn in winter */
    const colour = vec3(0.2, 0.4, 0.1);
    expect(snowOnCrown({ colour, normal: vec3(0, 1, 0), light: float(1), key: 'bjork' })).toBe(colour);
  });
  it('is wired in main.js: the light, the bare broadleaves after the boot, the lakes and what hides under it', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const SNOW_ON = new URLSearchParams\(location\.search\)\.get\('snow'\) !== '0';\nsetSnowDrawn\(SNOW_ON\);/);
    expect(main).toMatch(/vinter: 'winter', winter: 'winter',/);
    expect(main).toMatch(/setPaintedWorldLighting\(p, presetName\);\n\s+applyWinter\(p\);/);
    /* the impostors are baked again in the frame, never inside the boot's compiles */
    expect(main).toMatch(/if \(WINTER\.rebake && BOOT_PERF\.doneAtMs > 0\) applyBareTrees\(\);/);
    expect(main).toMatch(/bakeImpostorAtlas\(renderer, \{ \.\.\.args, into: atlas, bare \}\)/);
    expect(main).toMatch(/if \(name === 'crown' && isBroadleaf\(GHIBLI\.species\[s\]\.foliage\.key\)\) WINTER\.crowns\.push\(im\);/);
    /* the lakes freeze, the sea does not */
    expect(main).toMatch(/freezes = !ocean && !sea/);
    expect(main).toMatch(/if \(nearGrass && WINTER\.snow\) nearGrass\.mesh\.visible = false;/);
  });
});
