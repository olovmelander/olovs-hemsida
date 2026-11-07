import { describe, expect, it } from 'vitest';
import { laserPlateLevel, WATER_PLATE, PLATE_DISPLAY_CLEARANCE_METRES } from './water-plate-level.mjs';
import { MEASURED_WATER_CLEARANCE_METRES } from './water-render-policy.mjs';

it('stands the same clearance over the laser as the other measured water', () => {
  expect(PLATE_DISPLAY_CLEARANCE_METRES).toBe(MEASURED_WATER_CLEARANCE_METRES);
});

const square = half => [[-half, -half], [half, -half], [half, half], [-half, half]];

describe("a lake's level read off its laser surface", () => {
  it('is the flat surface inside the ring, the banks it encloses left out', () => {
    /* the surface at 62.73 with 2 cm of noise, and a loose ring whose last 8 m are bank */
    const ground = (x, z) => {
      const edge = 100 - Math.max(Math.abs(x), Math.abs(z));
      return edge < 8 ? 62.73 + (8 - edge) * 0.15 : 62.73 + 0.02 * Math.sin(x * 1.7) * Math.cos(z * 1.3);
    };
    const plate = laserPlateLevel(square(100), ground);
    expect(plate.method).toBe('laser-plate-median');
    expect(Math.abs(plate.surfaceMetres - 62.73)).toBeLessThan(0.01);
    expect(plate.level).toBeCloseTo(Math.round((plate.surfaceMetres + MEASURED_WATER_CLEARANCE_METRES) * 100) / 100, 9);
    expect(plate.plateFraction).toBeGreaterThan(0.9);
    /* the old rule's 30th percentile of the ring's own points would have read the bank */
    expect(ground(-100, -100)).toBeGreaterThan(63.8);
  });

  it('refuses a field that is smooth but not level, and a ring too small to read', () => {
    expect(laserPlateLevel(square(100), (x, z) => 40 + x * 0.01)).toBeNull();
    expect(laserPlateLevel(square(10), () => 40)).toBeNull();
    expect(laserPlateLevel(square(100), () => Number.NaN)).toBeNull();
  });

  it('reads an { height } probe and keeps to its budget', () => {
    let calls = 0;
    const plate = laserPlateLevel(square(2000), () => { calls++; return { height: 12.5 }; });
    expect(plate.surfaceMetres).toBe(12.5);
    expect(calls).toBeLessThanOrEqual(WATER_PLATE.maximumSamples * 4);
  });
});
