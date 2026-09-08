import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BAG, MAX_BAG_CLUBS, gpsToLocal, nearestHole, normalizeBag, parseBag,
  pointAlongLine, playableLine, recommendClub, strategyForHole,
} from './caddie.js';

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

  it('matches independent PROJ controls across Lidingö instead of rotating GPS into the legacy frame', () => {
    const projected = { origin: { lat:59.378715385375614, lon:18.12816746741512 }, mPerLon:56702.08,
      frame:'local metres from EPSG:3006; east +x, north -z; origin E677700.5 N6586399.5; heights RH 2000' };
    // EPSG:3006 -> EPSG:4326, PROJ/pyproj always_xy, offline database.
    // The controls are fixed projected locations, not this implementation's inverse.
    for (const [latitude,longitude,e,n] of [
      [59.378715385375614,18.12816746741512,677700.5,6586399.5],
      [59.37298170859494,18.116360534826395,677060,6585730],
      [59.3847644331165,18.138404685012777,678250,6587100],
      [59.38435276735087,18.118109417201236,677100,6587000],
      [59.373128933026656,18.13644843160652,678200,6585800],
    ]) {
      const [x,z] = gpsToLocal({latitude,longitude},projected);
      expect(Math.hypot(x-(e-677700.5),z-(6586399.5-n))).toBeLessThan(.005);
    }
    expect(() => gpsToLocal({latitude:59.38,longitude:18.13},{...projected,frame:'local metres from EPSG:3006; missing origin'})).toThrow(/origo/);
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
    tees: { marks: [{ c: [0, 0] }, { c: [0, -30] }] },
  };

  it('samples a polyline by walked distance', () => {
    expect(pointAlongLine(hole.line, 250)).toEqual([35.35533905932737, -235.35533905932738]);
  });

  it('respects a stated maximum and starts at the selected tee', () => {
    const strategy = strategyForHole(hole, 1, DEFAULT_BAG);
    expect(strategy.origin).toEqual([0, -30]);
    expect(strategy.primaryDistance).toBe(200);
    expect(strategy.maxCarry).toBe(200);
    expect(strategy.arcs).toContain(150);
  });

  it('targets the green on a par three', () => {
    const par3 = { ...hole, par: 3, note: '', line: [[0, 0], [0, -145]], tees: { marks: [{ c: [0, 0] }] } };
    const strategy = strategyForHole(par3);
    expect(strategy.zones[0].kind).toBe('green');
    expect(strategy.zones[0].distance).toBe(145);
  });

  it('plays directly from the chosen par-three tee to the visible target', () => {
    const h = { par: 3, pin: [5, -152], line: [[0, 0], [0, -160]], tees: { marks: [{ c: [18, -25] }] } };
    const before = structuredClone(h);
    const strategy = strategyForHole(h);
    expect(strategy.line).toEqual([[18, -25], [5, -152]]);
    expect(strategy.primary).toEqual(h.pin);
    expect(strategy.total).toBeCloseTo(Math.hypot(13, 127));
    expect(h).toEqual(before);
  });

  it('keeps forward doglegs without a sideways shot or a stale green endpoint', () => {
    const h = { ...hole, pin: [105, -310], tees: { marks: [{ c: [18, -25] }] } };
    expect(playableLine(h).line).toEqual([[18, -25], [0, -200], [105, -310]]);
  });
});
