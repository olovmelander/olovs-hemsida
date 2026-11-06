/* The sun against the almanac, and the lights against the simulator's. */
import { describe, expect, it } from 'vitest';
import { ATMOSPHERE_PRESETS } from '../engine/atmosphere-presets.mjs';
import { AUTUMN_FOLIAGE } from '../engine/painted-world-palette.mjs';
import {
  AUTUMN_RAMPS, blendLights, compassName, DEFAULT_LIGHT, lightByKey, lightNow, MAP_LIGHTS, seasonAt, SIMULATOR_LIGHTS, solarPosition, sunDirection,
} from './map-light.mjs';

const DEGREES = Math.PI / 180;
const STOCKHOLM = [59.33, 18.07];
const at = text => new Date(text);
const elevation = (date, [lat, lon]) => solarPosition(date, lat, lon).elevation / DEGREES;
const azimuth = (date, [lat, lon]) => solarPosition(date, lat, lon).azimuth / DEGREES;

describe('the sun', () => {
  /* At solar noon the height is 90 - latitude + declination. */
  it('stands where the almanac has it at noon, through the year', () => {
    expect(elevation(at('2026-06-21T10:50:00Z'), STOCKHOLM)).toBeCloseTo(54.1, 0);
    expect(elevation(at('2026-12-21T10:48:00Z'), STOCKHOLM)).toBeCloseTo(7.2, 0);
    expect(elevation(at('2026-03-20T10:55:00Z'), STOCKHOLM)).toBeCloseTo(30.6, 0);
  });

  it('is due south at solar noon, east in the morning and west in the evening', () => {
    expect(Math.abs(azimuth(at('2026-06-21T10:50:00Z'), STOCKHOLM) - 180)).toBeLessThan(3);
    expect(azimuth(at('2026-06-21T05:00:00Z'), STOCKHOLM)).toBeLessThan(120);
    expect(azimuth(at('2026-06-21T17:00:00Z'), STOCKHOLM)).toBeGreaterThan(240);
  });

  it('sets, and at midsummer far north barely does', () => {
    expect(elevation(at('2026-12-21T20:00:00Z'), STOCKHOLM)).toBeLessThan(-30);
    expect(elevation(at('2026-06-21T22:50:00Z'), [63.28, 18.67])).toBeGreaterThan(-6);
  });

  it('points the map\'s world at it: east +x, south +z', () => {
    const south = sunDirection({ elevation: 0, azimuth: Math.PI });
    expect(south[0]).toBeCloseTo(0);
    expect(south[2]).toBeCloseTo(1);
    const east = sunDirection({ elevation: 0, azimuth: Math.PI / 2 });
    expect(east[0]).toBeCloseTo(1);
    expect(sunDirection({ elevation: Math.PI / 2, azimuth: 1 })[1]).toBeCloseTo(1);
  });

  it('names its compass point', () => {
    expect(compassName(Math.PI)).toBe('söder');
    expect(compassName(Math.PI * 1.25)).toBe('sydväst');
    expect(compassName(Math.PI * 1.97)).toBe('norr');
  });
});

describe('the seasons', () => {
  it('turns the leaves in autumn, and only then', () => {
    expect(seasonAt(at('2026-07-01T12:00:00Z')).autumn).toBe(0);
    expect(seasonAt(at('2026-10-05T12:00:00Z')).autumn).toBe(1);
    expect(seasonAt(at('2026-01-15T12:00:00Z')).autumn).toBe(0);
  });

  it('brings the leaves down by November and back by May', () => {
    expect(seasonAt(at('2026-11-20T12:00:00Z')).bare).toBe(1);
    expect(seasonAt(at('2026-02-01T12:00:00Z')).bare).toBe(1);
    expect(seasonAt(at('2026-06-01T12:00:00Z')).bare).toBe(0);
    expect(seasonAt(at('2026-11-20T12:00:00Z')).autumn).toBe(0);
  });

  it('lays snow in midwinter, longer the further north', () => {
    expect(seasonAt(at('2026-01-15T12:00:00Z'), 63).snow).toBe(1);
    expect(seasonAt(at('2026-07-01T12:00:00Z'), 63).snow).toBe(0);
    expect(seasonAt(at('2026-10-05T12:00:00Z'), 63).snow).toBe(0);
    const march = at('2026-03-22T12:00:00Z');
    expect(seasonAt(march, 63.3).snow).toBeGreaterThan(seasonAt(march, 57.4).snow);
  });

  it('lays the grass pale from late autumn until spring', () => {
    expect(seasonAt(at('2026-07-01T12:00:00Z')).dormant).toBe(0);
    expect(seasonAt(at('2026-02-01T12:00:00Z')).dormant).toBe(1);
    expect(seasonAt(at('2026-12-01T12:00:00Z')).dormant).toBe(1);
    expect(seasonAt(at('2026-06-01T12:00:00Z')).dormant).toBe(0);
  });
});

describe('the named lights', () => {
  it('are the simulator\'s nine, with its sun and its sky', () => {
    /* the simulator's winter is not among them: the map keeps its own Vinter (map-light.mjs WINTER) */
    expect(SIMULATOR_LIGHTS.length).toBe(Object.keys(ATMOSPHERE_PRESETS).filter(name => name !== 'winter').length);
    const direction = lightByKey('sommar').sun;
    const authored = ATMOSPHERE_PRESETS.summer.dir, length = Math.hypot(...authored);
    direction.forEach((n, i) => expect(n).toBeCloseTo(authored[i] / length));
  });

  it('leave the summer day exactly as painted, so sand stays sand', () => {
    const summer = lightByKey(DEFAULT_LIGHT);
    expect(summer.key).toBe('sommar');
    summer.grade.forEach(n => expect(n).toBeCloseTo(1));
  });

  it('never tint the ground far enough to lose its colours', () => {
    for (const light of MAP_LIGHTS) {
      const [r, g, b] = light.grade;
      expect(r / g, light.key).toBeLessThan(1.3);
      expect(b / g, light.key).toBeGreaterThan(0.72);
    }
  });

  it('keep the sun above the ground, and long shadows within reason', () => {
    for (const light of MAP_LIGHTS) {
      expect(light.sun[1], light.key).toBeGreaterThan(0.09);
      expect(light.shadowSun[1], light.key).toBeGreaterThanOrEqual(0.35);
      expect(Math.hypot(...light.shadowSun), light.key).toBeCloseTo(1);
    }
  });

  it('take shade away with the sun: a storm casts almost none', () => {
    expect(lightByKey('ovader').shadow[0]).toBeGreaterThan(0.85);
    expect(lightByKey('sommar').shadow[0]).toBeLessThan(0.55);
  });

  it('turn the leaves only under Höst', () => {
    expect(MAP_LIGHTS.filter(light => light.autumn > 0).map(light => light.key)).toEqual(['host']);
  });

  it('have one winter of their own, bare and under snow', () => {
    expect(MAP_LIGHTS.filter(light => light.snow > 0).map(light => light.key)).toEqual(['vinter']);
    expect(lightByKey('vinter')).toMatchObject({ bare: 1, snow: 1, autumn: 0 });
  });

  it('do not know a light they were never given', () => {
    expect(lightByKey('nothing')).toBeNull();
  });
});

describe('Nu', () => {
  const VECKEFJARDEN = [63.2845, 18.6735];
  const now = text => lightNow(at(text), ...VECKEFJARDEN);

  it('carries the real sun at the course', () => {
    const light = now('2026-06-21T10:30:00Z');
    expect(light.key).toBe('nu');
    expect(light.elevationDegrees).toBeCloseTo(50.1, 0);
    expect(light.sun[2]).toBeGreaterThan(0.5);
  });

  it('is a clear summer day at midsummer noon', () => {
    const light = now('2026-06-21T10:30:00Z');
    expect(light.autumn).toBe(0);
    expect(light.dormant).toBe(0);
    light.grade.forEach((n, i) => expect(n).toBeCloseTo(lightByKey('sommar').grade[i]));
  });

  it('is gold and low on an October afternoon', () => {
    const light = now('2026-10-05T13:30:00Z');
    expect(light.autumn).toBe(1);
    expect(light.elevationDegrees).toBeLessThan(20);
    expect(light.grade[0]).toBeGreaterThan(light.grade[2]);
  });

  it('dims to the blue hour, still legible, once the sun has set', () => {
    const light = now('2026-11-04T15:00:00Z');
    expect(light.elevationDegrees).toBeLessThan(0);
    expect(light.grade[1]).toBeGreaterThan(0.5);
    expect(light.sun[1]).toBeGreaterThan(0.09);
  });

  it('is winter in January, with the birches bare', () => {
    const light = now('2026-01-15T10:00:00Z');
    expect(light.snow).toBe(1);
    expect(light.bare).toBe(1);
  });

  it('holds through a whole night, in every hour of the year', () => {
    for (let day = 0; day < 365; day += 11) for (let hour = 0; hour < 24; hour += 3) {
      const light = lightNow(new Date(Date.UTC(2026, 0, 1 + day, hour)), ...VECKEFJARDEN);
      for (const value of [...light.sun, ...light.grade, ...light.haze, ...light.shadow]) expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('blending', () => {
  it('runs between two lights', () => {
    const a = lightByKey('sommar'), b = lightByKey('bla');
    expect(blendLights(a, b, 0).haze).toEqual(a.haze);
    expect(blendLights(a, b, 1).haze).toEqual(b.haze);
    expect(blendLights(a, b, 0.5).sunShare).toBeCloseTo((a.sunShare + b.sunShare) / 2);
  });
});

describe('the autumn ramps', () => {
  it('are the simulator\'s, in the order the tree shader reads them', () => {
    expect(AUTUMN_RAMPS.colours.length).toBe(27 * 3);
    expect(AUTUMN_RAMPS.breaks.length).toBe(3 * 2);
    expect(AUTUMN_RAMPS.breaks[0]).toBeCloseTo(AUTUMN_FOLIAGE.bjork.breaks[0]);
    expect(AUTUMN_RAMPS.colours[0]).toBeCloseTo((AUTUMN_FOLIAGE.bjork.ramps[0][0] >> 16 & 255) / 255);
  });
});
