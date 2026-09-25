/* The water road pass: the sun's road sparkles to the horizon and brightens
   toward grazing without ever dimming, the clouds cut it only under a high sun,
   the water mirrors more of a low sun's glowing sky, the open sea mirrors no far
   shore; and main.js draws all of it, each behind its before. */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_PRESETS } from './atmosphere-presets.mjs';
import { paintedAtmosphere } from './painted-world-palette.mjs';
import { WATER_ROAD, schlick, roadGrazing, roadCloudShare, reliefSunOf } from './water-road.mjs';

const painted = name => paintedAtmosphere(name, ATMOSPHERE_PRESETS[name]);
const cosd = d => Math.cos(d * Math.PI / 180);
const sunHeight = name => { const [x, y, z] = painted(name).dir; return y / Math.hypot(x, y, z); };

describe('the water road pass', () => {
  it('brightens the road toward grazing as water\'s reflectance rises, and never dims it', () => {
    expect(schlick(1)).toBeCloseTo(0.02, 9);
    expect(schlick(0)).toBeCloseTo(1, 9);
    /* the dabs' own brightness wherever the sun meets the water at 70 degrees or more steeply */
    for (const degrees of [0, 20, 45, 60, 70]) expect(roadGrazing(cosd(degrees))).toBe(1);
    /* rising past it, to the cap by 79 degrees */
    let last = 1;
    for (const degrees of [72, 74, 76, 78]) {
      const g = roadGrazing(cosd(degrees));
      expect(g).toBeGreaterThan(last);
      last = g;
    }
    for (const degrees of [79, 83, 89]) expect(roadGrazing(cosd(degrees))).toBe(WATER_ROAD.grazing.cap);
    expect(WATER_ROAD.grazing.cap).toBe(2.5);
  });

  it('lets the clouds cut the road only under a high sun', () => {
    for (const name of ['golden', 'dawn', 'midnight', 'host']) expect(roadCloudShare(sunHeight(name))).toBe(0);
    expect(roadCloudShare(sunHeight('noon'))).toBe(1);
    const between = roadCloudShare(Math.sin(25 * Math.PI / 180));
    expect(between).toBeGreaterThan(0.3);
    expect(between).toBeLessThan(0.7);
  });

  it('mirrors more of a low sun\'s glowing sky, and only there', () => {
    expect(WATER_ROAD.mirror).toEqual({ share: 0.42, glow: 0.7 });
    expect(WATER_ROAD.dabs).toEqual([0.985, 0.996]);
  });

  it('shows the waves\' relief from above as the sun is direct: in full under a sun, faint under an overcast, none after sunset', () => {
    for (const name of ['golden', 'noon', 'host', 'dawn', 'midnight']) expect(reliefSunOf(painted(name))).toBe(1);
    expect(reliefSunOf(painted('storm'))).toBeCloseTo(0.38 / 1.5, 6);
    expect(reliefSunOf(painted('mist'))).toBeCloseTo(0.3 / 1.5, 6);
    expect(reliefSunOf(painted('bluehour'))).toBeLessThan(0.05);
    expect(WATER_ROAD.relief).toEqual({ gain: 2, cap: 0.12, fullSun: 1.5 });
  });

  it('is drawn by the water\'s shading: the dabs to the horizon, the mirror in the glow, no far shore on the sea', () => {
    const shading = fs.readFileSync(new URL('./water-shading.mjs', import.meta.url), 'utf8');
    /* the road is the dabs brightened and clouded (water-road.mjs); the water batch's expectation only without it */
    expect(shading).toMatch(/const sunlit = cloud \? cloud\.sunlightAt\(positionWorld\) : null;/);
    expect(shading).toMatch(/const sparkle = road\n\s+\? waterSun\.mul\(sunRoad\(\{ nh: N\.dot\(H\), vh: V\.dot\(H\), sunUp: uSun\.y, sunlight: sunlit \}\)\)/);
    expect(shading).toMatch(/const sigma = nordic && !road \?/);
    /* the road takes the clouds inside sunRoad, so not a second time */
    expect(shading).toMatch(/c = c\.add\(sunlit && !road \? sparkle\.mul\(sunlit\) : sparkle\);/);
    expect(shading).toMatch(/let c = mix\(body, skyC, mirror && glowShare \? mirrorShare\(\{ fres, glow: glowShare \}\) : fres\.mul\(0\.42\)\);/);
    expect(shading).toMatch(/if \(!ocean && !sea\) \{/);
    /* the relief takes the water from above's cloud shade and patches only with them (water-above.mjs) */
    expect(shading).toMatch(/if \(relief\) body = body\.mul\(bodyRelief\(\{ N, sun: uSun, sunlit: bodySun, rough \}\)\);/);
  });

  it('is wired in main.js, each part behind its before, the open sea on every sheet of it', () => {
    const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    expect(main).toMatch(/const WATER_ROAD_ON = new URLSearchParams\(location\.search\)\.get\('waterroad'\) !== '0';/);
    expect(main).toMatch(/const WATER_MIRROR_ON = new URLSearchParams\(location\.search\)\.get\('watermirror'\) !== '0';/);
    expect(main).toMatch(/const OPEN_SEA_ON = new URLSearchParams\(location\.search\)\.get\('opensea'\) !== '0';/);
    expect(main).toMatch(/const WATER_RELIEF_ON = new URLSearchParams\(location\.search\)\.get\('waterrelief'\) !== '0';/);
    expect(main).toMatch(/road: WATER_ROAD_ON, mirror: WATER_MIRROR_ON, relief: WATER_RELIEF_ON, sea: sea && OPEN_SEA_ON,\n/);
    expect(main).toMatch(/setNordicWaterPreset\(p, [^\n]*\n[^\n]*\n\s+setWaterRoadPreset\(p\);/);
    expect(main).toMatch(/const openSeaMat = OPEN_SEA_ON && HAS_SEA \? makeWater\(\{ showBed: M\.infra\.terrainPlacement !== 'measured-only', sea: true \}\) : waterMat;/);
    /* the sea's rings, the Lidingö sea without its coverage, the coastal extension and the horizon sheet */
    expect(main).toMatch(/new THREE\.Mesh\(g, seaSheetFor\(w\.level, w\.isSea\)\)/);
    expect(main).toMatch(/: isSea \? openSeaMat : waterMat;/);
    expect(main).toMatch(/new THREE\.Mesh\(g, seaSheetMat \?\? openSeaMat\)/);
    expect(main).toMatch(/const oceanMat = CONTINUOUS_OCEAN \? makeWater\(\{showBed:false,ocean:true\}\) : openSeaMat;/);
    expect(main).toMatch(/const m = new THREE\.Mesh\(g, openSeaMat\);\n\s+m\.renderOrder = 5;/);
  });
});
