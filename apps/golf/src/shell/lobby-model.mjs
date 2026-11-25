/* The start menu's clubs (home.js). While the catalogue is small the lobby lists
   every club by name. Past that a list of every club would push the ways to play,
   Statistik and Inställningar ten screens down a phone, so the lobby lists the
   golfer's own instead -- a game under way, then the clubs launched or played
   lately, then the nearest -- and leaves the rest to its search and to the full
   list (docs/start-menu.md, "A hundred clubs"). Pure, so a catalogue of a hundred
   made-up clubs can be reasoned about without a browser. */
import { clubIdFor, layoutLabel } from './course-clubs.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { courseSearchKey, layoutMatches, parseQuery, searchText } from './club-search.mjs';
import { sortClubs } from './club-sort.mjs';

/* Every club stands in the lobby up to here: about a screen and a half of rows on
   a phone. Today's eleven clubs are under it, so the lobby lists them all. */
export const LOBBY_ALL_CLUBS = 12;
/* The rows the lobby shows past it, of the golfer's own or of a search's hits: three
   lines of a computer's grid, and on a phone five, so the ways to play stay near. */
export const LOBBY_SHORT_LIST = 8;
export const LOBBY_SHORT_LIST_PHONE = 5;
/* A club further than this is not "near" anyone: a day's drive for a round. */
export const NEAR_CLUBS_METRES = 200_000;

export const catalogueIsLarge = clubs => clubs.length > LOBBY_ALL_CLUBS;

/* What the golfer has been doing, newest first. The last course launched leads: a
   device from before the recent list (RECENT_COURSES_KEY) has only that, without a
   time. Rounds the map kept carry when they ended. */
export function recentCourses({ lastSlug = null, launches = [], rounds = [] } = {}) {
  const entries = [
    ...(lastSlug ? [{ slug: lastSlug, at: Infinity, kind: 'opened' }] : []),
    ...launches.map(({ slug, at }) => ({ slug, at, kind: 'opened' })),
    ...rounds.map(round => ({ slug: round?.course, at: Number(round?.endedAt) || 0, kind: 'played' })),
  ].filter(entry => typeof entry.slug === 'string');
  /* the sort is stable, so the last course keeps its lead over its own launch */
  return entries.sort((a, b) => b.at - a.at);
}

/* The lobby's rows. `whole` is every club by name; otherwise the short list, each
   row saying why it is there (`why`: live, opened, played or near). A club already
   on a card above the list (a game under way, Nära dig, the last course) is
   `exclude`d from the short list, never from the whole one. */
export function lobbyClubs(clubs, { sessions = [], recent = [], coords = null, exclude = [], limit = LOBBY_SHORT_LIST } = {}) {
  if (!catalogueIsLarge(clubs)) {
    return { whole: true, rows: sortClubs(clubs, 'name').map(({ club }) => ({ club, why: 'all' })) };
  }
  const byId = new Map(clubs.map(club => [club.id, club]));
  const rows = [], seen = new Set(exclude);
  const add = (club, row) => {
    if (!club || seen.has(club.id) || rows.length >= limit) return;
    seen.add(club.id);
    rows.push({ club, ...row });
  };
  for (const session of sessions) add(byId.get(clubIdFor(session.course.slug)), { why: 'live', session });
  for (const entry of recent) {
    /* a club's opening (the last course, without a time) is newer than its rounds */
    add(byId.get(clubIdFor(entry.slug)), { why: entry.kind, at: entry.at, slug: entry.slug });
  }
  if (coords) {
    for (const { club, metres } of sortClubs(clubs, 'distance', { coords })) {
      if (metres === null || metres > NEAR_CLUBS_METRES) break;
      add(club, { why: 'near', metres });
    }
  }
  return { whole: false, rows };
}

const keys = new WeakMap();
const keyOf = course => {
  if (!keys.has(course)) keys.set(course, courseSearchKey(course));
  return keys.get(course);
};
const words = text => searchText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/* "Testklubb 2" before "Testklubb 10" */
const swedish = new Intl.Collator('sv', { numeric: true });

/* How well a club answers the words typed: its name begun with them, then every
   word starting a word of its name, then of its layouts or town, then anywhere in
   what the list searches (region words, the course's own line). */
function rank(club, terms) {
  if (!terms.length) return 3;
  const name = searchText(club.name);
  if (name.startsWith(terms.join(' '))) return 0;
  const own = words(club.name);
  if (terms.every(term => own.some(word => word.startsWith(term)))) return 1;
  const near = [...own, ...club.courses.flatMap(course => words(`${layoutLabel(course)} ${COURSE_LOCATIONS[course.slug]?.city ?? ''}`))];
  if (terms.every(term => near.some(word => word.startsWith(term)))) return 2;
  return 3;
}

/* The clubs a search finds, best answers first, with the full count for the list.
   Null when nothing is typed. The words match as they do in the list (rail.js):
   every word on one layout, a hole count or par read off the scorecard. */
export function searchClubs(clubs, text, { limit = LOBBY_SHORT_LIST } = {}) {
  const query = parseQuery(text);
  if (!query.query) return null;
  const hits = clubs
    .filter(club => club.courses.some(course => layoutMatches(course, keyOf(course), query)))
    .map(club => ({ club, rank: rank(club, query.terms) }))
    .sort((a, b) => a.rank - b.rank || swedish.compare(a.club.name, b.club.name));
  return { total: hits.length, rows: hits.slice(0, limit).map(({ club }) => ({ club, why: 'hit' })) };
}

/* "i dag", "i går" or the date, for a row's note. */
export function dayText(at, now = Date.now()) {
  if (!Number.isFinite(at)) return '';
  const day = time => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return 'i dag';
  if (days === 1) return 'i går';
  return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', ...(days > 300 ? { year: 'numeric' } : {}) })
    .format(at).replace(/\.(?=\s|$)/g, '');
}
