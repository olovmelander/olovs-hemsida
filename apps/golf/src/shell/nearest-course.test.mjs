/* The courses nearest a phone. */
import { describe, expect, it } from 'vitest';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { coursesByDistance, distanceText, metresBetween } from './nearest-course.mjs';

describe('the nearest course', () => {
  it('measures along the ground', () => {
    expect(metresBetween({ lat: 59, lng: 18 }, { lat: 60, lng: 18 })).toBeCloseTo(111195, -2);
    expect(metresBetween({ lat: 59, lng: 18 }, { lat: 59, lng: 18 })).toBe(0);
  });

  it('puts the course a player stands on first', () => {
    const { lat, lng } = COURSE_LOCATIONS.visby;
    const [first, second] = coursesByDistance({ latitude: lat + 0.001, longitude: lng }, COURSE_LOCATIONS);
    expect(first.slug).toBe('visby');
    expect(first.metres).toBeLessThan(200);
    expect(second.metres).toBeGreaterThan(first.metres);
  });

  it('says a distance the way a sign does', () => {
    expect(distanceText(84)).toBe('80 m');
    expect(distanceText(1234)).toBe('1,2 km');
    expect(distanceText(23456)).toBe('23 km');
  });
});
