import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BAG, MAX_BAG_CLUBS, gpsToLocal, nearestHole, normalizeBag, parseBag,
  pointAlongLine, recommendClub, strategyForHole,
} from './caddie.js';
import { VISBY_V2_CONFIG } from './v2-visby-config.mjs';
import { LIDINGO_V2_CONFIG } from './v2-lidingo-config.mjs';
import { RIBBINGSFORS_V2_CONFIG } from './v2-ribbingsfors-config.mjs';

describe('bag', () => {
  it('starts with a complete carry set and accepts up to fourteen clubs', () => {
    expect(DEFAULT_BAG.length).toBeGreaterThan(9);
    const expanded = normalizeBag(Array.from({ length: 20 }, (_, index) => ({
      id: 'club', name: `Klubba ${index + 1}`, carry: 300 - index * 10,
    })));
    expect(expanded).toHaveLength(MAX_BAG_CLUBS);
    expect(new Set(expanded.map(club => club.id)).size).toBe(MAX_BAG_CLUBS);
  });

  it('recovers safely from corrupt or implausible stored values', () => {
    expect(parseBag('{nope').length).toBe(DEFAULT_BAG.length);
    expect(normalizeBag([{ name: 'Driver', carry: 900 }]).length).toBe(DEFAULT_BAG.length);
  });

  it('prefers the safer short club when two carries bracket the target', () => {
    const advice = recommendClub(150, [
      { id: 'a', name: 'Lång', carry: 160 },
      { id: 'b', name: 'Kort', carry: 140 },
    ]);
    expect(advice.club.name).toBe('Kort');
    expect(advice.delta).toBe(10);
  });

  it('marks a shot that is beyond the longest club', () => {
    expect(recommendClub(250, DEFAULT_BAG).beyondBag).toBe(true);
  });
});

describe('GPS frame', () => {
  const geo = { origin: { lat: 63.3, lon: 18.9 }, mPerLon: 50000 };

  it('maps east to +x and north to -z in the course frame', () => {
    const [x, z] = gpsToLocal({ latitude: 63.301, longitude: 18.902 }, geo);
    expect(x).toBeCloseTo(100);
    expect(z).toBeCloseTo(-111.32);
  });

  const projectedGeo = config => ({ frame: config.packFrame,
    origin: { lat: config.packOriginWgs84.latitude, lon: config.packOriginWgs84.longitude },
    mPerLon: config.packMetresPerLongitude });

  it('places Visby GPS fixes in the native grid against independent PROJ controls', () => {
    // PROJ 9.8.1 / pyproj 3.8.0, EPSG:3006 -> EPSG:4326, always_xy.
    // These synthetic origin/corner controls measure conversion error, not GPS accuracy.
    const controls = [
      { local: [0, 0], wgs84: [18.12847826436399, 57.44236399463288] },
      { local: [-650, -1050], wgs84: [18.118467660619093, 57.45205012630819] },
      { local: [650, -1050], wgs84: [18.1400984521626, 57.451512773274224] },
      { local: [650, 450], wgs84: [18.1389448076941, 57.43805873583014] },
      { local: [-650, 450], wgs84: [18.117321931606615, 57.43859581227263] },
    ];
    for (const control of controls) {
      const actual = gpsToLocal({ longitude: control.wgs84[0], latitude: control.wgs84[1] }, projectedGeo(VISBY_V2_CONFIG));
      expect(Math.hypot(actual[0] - control.local[0], actual[1] - control.local[1])).toBeLessThan(0.01);
    }
  });

  it.each([
    [LIDINGO_V2_CONFIG, 18.130706144130983, 59.38275231674589],
    [RIBBINGSFORS_V2_CONFIG, 14.114905826273638, 58.96489989471448],
  ])('uses the same declared grid convention for $slug', (config, longitude, latitude) => {
    // The same independent PROJ inverse at local x=123, z=-456.
    const actual = gpsToLocal({ longitude, latitude }, projectedGeo(config));
    expect(Math.hypot(actual[0] - 123, actual[1] + 456)).toBeLessThan(0.01);
  });

  it('rejects a known projected frame with a different pack origin or scale', () => {
    const visby = projectedGeo(VISBY_V2_CONFIG);
    const fix = { latitude: visby.origin.lat, longitude: visby.origin.lon };
    expect(() => gpsToLocal(fix, { ...visby, origin: { ...visby.origin, lat: visby.origin.lat + 0.001 } })).toThrow(/koordinatram/);
    expect(() => gpsToLocal(fix, { ...visby, mPerLon: visby.mPerLon + 1 })).toThrow(/koordinatram/);
  });

  it('retains the established conversion for an unregistered legacy frame', () => {
    const actual = gpsToLocal({ latitude: 63.301, longitude: 18.902 }, { ...geo, frame: 'local legacy metres' });
    expect(actual[0]).toBeCloseTo(100);
    expect(actual[1]).toBeCloseTo(-111.32);
  });

  it('selects the nearest hole but keeps the current one inside the hysteresis', () => {
    const holes = [
      { n: 1, line: [[0, 0], [0, -100]] },
      { n: 2, line: [[20, 0], [20, -100]] },
    ];
    expect(nearestHole([12, -50], holes).hole).toBe(2);
    expect(nearestHole([12, -50], holes, 1, 5).hole).toBe(1);
  });
});

describe('strategy', () => {
  const hole = {
    n: 4, par: 4, note: 'Sikta höger och slå max 200 meter.',
    line: [[0, 0], [0, -200], [100, -300]],
    fairway: { rings: [[[-20, -40], [20, -40], [20, -190], [105, -275], [75, -305], [-20, -210]]] },
    green: { c: [100, -300], ring: [[85, -315], [115, -315], [115, -285], [85, -285]] },
    tees: { marks: [{ c: [0, 0] }, { c: [0, -30] }] },
  };

  it('samples a polyline by walked distance', () => {
    expect(pointAlongLine(hole.line, 250)).toEqual([35.35533905932737, -235.35533905932738]);
  });

  it('respects a stated maximum and starts at the selected tee', () => {
    const strategy = strategyForHole(hole, 1, DEFAULT_BAG);
    expect(strategy.origin).toEqual([0, -30]);
    expect(strategy.status).toBe('playable');
    expect(strategy.primaryDistance).toBeLessThanOrEqual(200);
    expect(strategy.maxCarry).toBe(200);
    expect(strategy.arcs).toContain(150);
  });

  it('targets the green on a par three', () => {
    const par3 = { ...hole, par: 3, note: '', line: [[0, 0], [0, -145]],
      green: { c: [0, -145], ring: [[-15, -160], [15, -160], [15, -130], [-15, -130]] },
      tees: { marks: [{ c: [0, 0] }] } };
    const strategy = strategyForHole(par3);
    expect(strategy.zones[0].kind).toBe('green');
    expect(strategy.zones[0].distance).toBe(145);
  });

  it('measures a lateral par-three tee directly to the green for both distance and club advice', () => {
    const par3 = { par: 3, line: [[0, 0], [0, -145]],
      green: { c: [0, -145], ring: [[-15, -160], [15, -160], [15, -130], [-15, -130]] },
      tees: { marks: [{ c: [0, 0] }, { c: [60, -65] }] } };
    const strategy = strategyForHole(par3, 1);
    // 60/80/100 triangle: joining the old centreline would incorrectly say 140 m.
    expect(strategy.line).toEqual([[60, -65], [0, -145]]);
    expect(strategy.primary).toEqual([0, -145]);
    expect(strategy.total).toBe(100);
    expect(strategy.zones[0].distance).toBe(100);
    expect(strategy.primaryAdvice.distance).toBe(100);
    expect(strategy.primaryAdvice.club.id).toBe('pw');
  });
});
