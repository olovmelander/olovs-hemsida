/* The courses nearest a phone. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COURSE_LOCATIONS, HOST_CLUB } from './course-places.mjs';
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

  it('locates every playable catalogue layout, including layouts that share a clubhouse', () => {
    const { courses } = JSON.parse(readFileSync(new URL('../../public/courses/index.json', import.meta.url)));
    for (const { slug } of courses.filter(course => course.status !== 'mapping')) {
      expect(COURSE_LOCATIONS[slug]).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
    }
    for (const [layout, club] of Object.entries(HOST_CLUB)) {
      const { lat, lng } = COURSE_LOCATIONS[club];
      const nearest = coursesByDistance({ latitude: lat, longitude: lng }, COURSE_LOCATIONS);
      expect(nearest.filter(c => c.metres === 0).map(c => c.slug)).toEqual(expect.arrayContaining([club, layout]));
    }
  });

  it('says a distance the way a sign does', () => {
    expect(distanceText(84)).toBe('80 m');
    expect(distanceText(1234)).toBe('1,2 km');
    expect(distanceText(23456)).toBe('23 km');
  });
});
