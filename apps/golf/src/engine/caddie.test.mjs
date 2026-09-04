import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BAG, MAX_BAG_CLUBS, gpsToLocal, nearestHole, normalizeBag, parseBag,
  pointAlongLine, recommendClub, strategyForHole,
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
});
