import { describe, expect, it } from 'vitest';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { groupCourses } from './course-clubs.mjs';
import { sortClubs, sortLayouts } from './club-sort.mjs';

const clubs = groupCourses([
  { slug: 'puttom', club: 'Örnsköldsviks Golfklubb' },
  { slug: 'angso', club: 'Ängsö Golfklubb' },
  { slug: 'missing', club: 'Ådalens Golfklubb' },
  { slug: 'bro-hof-castle', club: 'Bro Hof Slott Golf Club' },
  { slug: 'bro-hof-stadium', club: 'Bro Hof Slott Golf Club' },
  { slug: 'visby', club: 'Visby Golfklubb' },
]);
const byName = ['bro-hof', 'visby', 'missing', 'angso', 'puttom'];
const ids = rows => rows.map(({ club }) => club.id);
const visby = COURSE_LOCATIONS.visby;
const coords = { latitude: visby.lat, longitude: visby.lng };

describe('club sorting', () => {
  it('uses Swedish name order and preserves the catalogue and layout order', () => {
    const before = structuredClone(clubs);
    expect(ids(sortClubs(clubs, 'name', { recentSlug: 'puttom', coords }))).toEqual(byName);
    expect(clubs).toEqual(before);
    expect(sortClubs(clubs, 'name')[0].club.courses.map(c => c.slug)).toEqual(['bro-hof-castle', 'bro-hof-stadium']);
  });

  it('promotes the recent layout’s club, leaving the other clubs in name order', () => {
    expect(ids(sortClubs(clubs, 'recent', { recentSlug: 'puttom' }))).toEqual(['puttom', ...byName.slice(0, -1)]);
    const alternate = groupCourses([
      { slug: 'alby', club: 'Alby Golfklubb' },
      ...clubs.find(club => club.id === 'bro-hof').courses,
    ]);
    expect(ids(sortClubs(alternate, 'recent', { recentSlug: 'bro-hof-castle' }))).toEqual(['bro-hof', 'alby']);
    expect(ids(sortClubs(clubs, 'recent', { recentSlug: 'removed-layout' }))).toEqual(byName);
  });

  it('measures from the caller’s position to the club cover, with unlocated clubs last', () => {
    const rows = sortClubs(clubs, 'distance', { coords });
    expect(rows[0]).toEqual({ club: clubs.find(club => club.id === 'visby'), metres: 0 });
    expect(rows.at(-1)).toEqual({ club: clubs.find(club => club.id === 'missing'), metres: null });
    const distances = rows.slice(0, -1).map(row => row.metres);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('breaks equal distances by Swedish club name', () => {
    const a = { ...clubs[0], id: 'a', name: 'Ådalen' };
    const b = { ...clubs[0], id: 'b', name: 'Björken' };
    expect(ids(sortClubs([a, b], 'distance', { coords }))).toEqual(['b', 'a']);
  });

  it.each([undefined, {}, { latitude: NaN, longitude: 10 }, { latitude: 91, longitude: 10 }, { latitude: 59, longitude: 181 }])(
    'falls back to name order for a missing or invalid position', position => {
      const rows = sortClubs(clubs, 'distance', { coords: position });
      expect(ids(rows)).toEqual(byName);
      expect(rows.every(row => row.metres === null)).toBe(true);
    },
  );
});

describe('layouts within a club', () => {
  // The published name and player-facing label of a layout can sort differently.
  const stadium = { slug: 'bro-hof-stadium', name: 'A' };
  const castle = { slug: 'bro-hof-castle', name: 'Z' };
  const ang = { slug: 'ang', name: 'Ängen' };
  const o = { slug: 'o', name: 'Ön' };
  const layouts = Object.freeze([o, stadium, ang, castle]);

  it.each(['name', 'distance'])('uses Swedish layout labels for %s order', order => {
    const sorted = sortLayouts(layouts, order, stadium.slug);
    expect(sorted).toEqual([castle, stadium, ang, o]);
    expect(sorted[0]).toBe(castle);
    expect(sorted).not.toBe(layouts);
  });

  it('promotes only a member layout in recent order', () => {
    expect(sortLayouts(layouts, 'recent', stadium.slug)).toEqual([stadium, castle, ang, o]);
    expect(sortLayouts(layouts, 'recent', 'other-club')).toEqual([castle, stadium, ang, o]);
    expect(layouts).toEqual([o, stadium, ang, castle]);
  });
});
