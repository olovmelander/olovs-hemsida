import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { groupCourses } from './course-clubs.mjs';
import { LOBBY_ALL_CLUBS, LOBBY_SHORT_LIST, NEAR_CLUBS_METRES, catalogueIsLarge, dayText, lobbyClubs, recentCourses, searchClubs } from './lobby-model.mjs';

const real = JSON.parse(fs.readFileSync(new URL('../../public/courses/index.json', import.meta.url), 'utf8')).courses
  .filter(course => course.status !== 'mapping');
/* a hundred and ten clubs nobody has heard of, beside the real ones */
const madeUp = Array.from({ length: 110 }, (_, i) => ({
  slug: `testklubb-${i + 1}`, name: `Testklubb ${i + 1}`, club: `Testklubb ${i + 1} GK`, holes: i % 4 ? 18 : 9, par: i % 4 ? 72 : 33,
}));
const today = groupCourses(real);
const large = groupCourses([...real, ...madeUp]);
const VASTERAS = { latitude: 59.6099, longitude: 16.5448 };
const names = rows => rows.map(row => row.club.name);

describe('the lobby\'s clubs', () => {
  it('lists every club by Swedish name while the catalogue is small, as today', () => {
    expect(today.length).toBeLessThanOrEqual(LOBBY_ALL_CLUBS);
    const { whole, rows } = lobbyClubs(today, { coords: VASTERAS, recent: [{ slug: 'visby', at: 1, kind: 'opened' }] });
    expect(whole).toBe(true);
    expect(rows).toHaveLength(today.length);
    expect(names(rows)).toEqual([...names(rows)].sort(new Intl.Collator('sv').compare));
    expect(names(rows).at(-1)).toMatch(/^Örnsköldsvik/);
  });

  it('lists the golfer\'s own past that, and nothing for a first visit', () => {
    expect(catalogueIsLarge(large)).toBe(true);
    expect(lobbyClubs(large)).toEqual({ whole: false, rows: [] });
  });

  it('puts a game under way first, then the clubs opened and played lately, each club once, at most eight', () => {
    const castle = real.find(course => course.slug === 'bro-hof-castle');
    const recent = recentCourses({
      lastSlug: 'testklubb-3',
      launches: [{ slug: 'bro-hof-stadium', at: 500 }, { slug: 'testklubb-3', at: 400 }, ...Array.from({ length: 9 }, (_, i) => ({ slug: `testklubb-${20 + i}`, at: 300 - i }))],
      rounds: [{ course: 'visby', endedAt: 450 }],
    });
    const { whole, rows } = lobbyClubs(large, { sessions: [{ mode: 'map', course: castle }], recent });
    expect(whole).toBe(false);
    expect(rows).toHaveLength(LOBBY_SHORT_LIST);
    expect(rows.map(row => [row.club.id, row.why])).toEqual([
      ['bro-hof', 'live'], ['testklubb-3', 'opened'], ['visby', 'played'],
      ['testklubb-20', 'opened'], ['testklubb-21', 'opened'], ['testklubb-22', 'opened'], ['testklubb-23', 'opened'], ['testklubb-24', 'opened'],
    ]);
  });

  it('adds the nearest clubs within a day\'s drive, with their distance, after the golfer\'s own', () => {
    const { rows } = lobbyClubs(large, { coords: VASTERAS, recent: recentCourses({ launches: [{ slug: 'visby', at: 9 }] }) });
    expect(rows[0]).toMatchObject({ why: 'opened' });
    expect(rows[0].club.id).toBe('visby');
    const near = rows.filter(row => row.why === 'near');
    expect(near.slice(0, 2).map(row => row.club.id).sort()).toEqual(['angso', 'tortuna']);
    expect(near.every(row => row.metres <= NEAR_CLUBS_METRES)).toBe(true);
    expect(near.map(row => row.metres)).toEqual([...near.map(row => row.metres)].sort((a, b) => a - b));
    /* Visby is across the sea and Höga Kusten far north: neither is near Västerås */
    expect(near.some(row => ['puttom', 'veckefjarden', 'norrfallsviken'].includes(row.club.id))).toBe(false);
  });

  it('leaves out a club already on a card above the list, but never from the whole list', () => {
    const recent = recentCourses({ lastSlug: 'bro-hof-castle', launches: [{ slug: 'visby', at: 3 }] });
    expect(lobbyClubs(large, { recent, exclude: ['bro-hof'] }).rows.map(row => row.club.id)).toEqual(['visby']);
    expect(lobbyClubs(today, { recent, exclude: ['bro-hof'] }).rows).toHaveLength(today.length);
  });

  it('skips a course the catalogue no longer has', () => {
    const { rows } = lobbyClubs(large, { recent: recentCourses({ lastSlug: 'gone', launches: [{ slug: 'angso', at: 2 }] }) });
    expect(rows.map(row => row.club.id)).toEqual(['angso']);
  });
});

describe('the lobby\'s search', () => {
  it('waits for a word', () => {
    expect(searchClubs(large, '')).toBeNull();
    expect(searchClubs(large, '   ')).toBeNull();
  });

  it('finds a club by its name first, by a layout and by its town, with accents or without', () => {
    expect(names(searchClubs(large, 'bro').rows)[0]).toBe('Bro Hof Slott Golf Club');
    expect(names(searchClubs(large, 'castle').rows)).toEqual(['Bro Hof Slott Golf Club']);
    expect(searchClubs(large, 'västerås').rows.map(row => row.club.id).sort()).toEqual(['angso', 'tortuna']);
    expect(searchClubs(large, 'angso').rows[0].club.id).toBe('angso');
  });

  it('counts every hit for the list and shows the first eight, best answers first', () => {
    const result = searchClubs(large, 'testklubb');
    expect(result.total).toBe(110);
    expect(result.rows).toHaveLength(LOBBY_SHORT_LIST);
    /* a club is named by its courses' club, and numbers count: 7, then 70 */
    expect(names(searchClubs(large, 'testklubb 7').rows).slice(0, 2)).toEqual(['Testklubb 7 GK', 'Testklubb 70 GK']);
    expect(names(result.rows).slice(0, 3)).toEqual(['Testklubb 1 GK', 'Testklubb 2 GK', 'Testklubb 3 GK']);
  });

  it('reads a hole count and a par off the scorecard, as the list does', () => {
    const nine = searchClubs(large, 'testklubb 9 hål', { limit: 200 });
    expect(nine.total).toBe(28);
    const par = searchClubs(large, 'par 70', { limit: 200 });
    expect(par.rows.every(row => row.club.courses.some(course => course.par === 70))).toBe(true);
  });
});

describe('a row\'s day', () => {
  const noon = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  it('says today, yesterday or the date', () => {
    const now = noon(2026, 11, 25);
    expect(dayText(noon(2026, 11, 25) - 3_600_000, now)).toBe('i dag');
    expect(dayText(noon(2026, 11, 24), now)).toBe('i går');
    expect(dayText(noon(2026, 11, 12), now)).toBe('12 nov');
    expect(dayText(noon(2025, 6, 1), now)).toBe('1 juni 2025');
    expect(dayText(Infinity, now)).toBe('');
  });
});

describe('the recent courses', () => {
  it('lead with the last course, then launches and rounds by time', () => {
    const recent = recentCourses({ lastSlug: 'a', launches: [{ slug: 'b', at: 5 }, { slug: 'a', at: 9 }], rounds: [{ course: 'c', endedAt: 7 }, { course: null }] });
    expect(recent.map(entry => `${entry.slug}:${entry.kind}`)).toEqual(['a:opened', 'a:opened', 'c:played', 'b:opened']);
  });
});
