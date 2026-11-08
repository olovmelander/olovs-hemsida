/* Where the app is, and how it got there.

   Two rules, and the second is the one that matters:

   1. ?bana=<slug> selects the course. A bare visit opens the lightweight chooser
      without loading the 3D engine.

   2. EVERY historical URL still resolves to the same view. The seven historical
      pages have been shared, bookmarked and linked with the full grammar --
      hal, vy, ljus, tee, skylt, ren, kiosk, q and gl -- and a link that used to
      show someone the 14th at dusk has to keep showing them the 14th at dusk.
      That is not a nicety: those links are the only distribution this project
      has ever had. The page name carries the course, the query carries the
      view, and gl=1 and q=lo are in the list because an audit found them
      missing from a plan that claimed the grammar was preserved verbatim.   */

/* Where the app is mounted. import.meta.env is absent when these pure functions
   are exercised by the unit tests outside a bundle, so it falls back to a root
   mount -- which is also the right answer for the Cloudflare deployment. */
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';

import { LEGACY_PAGES, VIEW_KEYS, mapLegacyLocation } from './legacy-links.mjs';
import { readSettings, withSettings } from './settings-store.mjs';
export { LEGACY_PAGES, VIEW_KEYS } from './legacy-links.mjs';

/* The mount belongs to this build, so a GitHub Pages bookmark never escapes
   its repository path. Both the app and generated pages use the same mapping. */
export function legacyTarget(pathname, search, base = BASE) {
  return mapLegacyLocation(pathname, search, base, LEGACY_PAGES, VIEW_KEYS);
}

export function currentSlug(search = location.search) {
  return new URLSearchParams(search).get('bana');
}

/* Switching courses is navigation: the engine still boots per course.
   The view keys are dropped on purpose: hole 14 of one course means
   nothing on another, and carrying a stale hole number across would open the
   new course on a hole the visitor never asked for.
   Backend, quality and diagnostic settings persist across courses. Retired
   visual-mode flags are dropped; every course uses v2 + Ghibli. */
export function courseUrl(slug, search = (typeof location !== 'undefined' ? location.search : '')) {
  const from = new URLSearchParams(search);
  const to = new URLSearchParams();
  to.set('bana', slug);
  for (const k of ['hero', 'gl', 'q', 'det', 'karta']) {
    if (from.has(k)) to.set(k, from.get(k));
  }
  return '?' + to.toString();
}

/* The light 3D map for a real round, beside the detailed course. */
export function mapUrl(slug) {
  return `?bana=${encodeURIComponent(slug)}&karta=1`;
}

/* The detailed course, on a device that would open the map by default. */
export function detailedUrl(slug) {
  return `?bana=${encodeURIComponent(slug)}&karta=0`;
}

/* Spela: the detailed course as a game (apps/golf/src/play) */
export function playUrl(slug) {
  return `${detailedUrl(slug)}&spela=1`;
}

/* Återupplev: a round the map kept, replayed on the detailed course */
export function reliveUrl(slug, roundId) {
  return `${detailedUrl(slug)}&aterupplev=${encodeURIComponent(roundId)}`;
}

/* The start menu's settings ride along where the running link says nothing:
   the next course opens in the light and view the player chose there. */
export function goToCourse(slug) {
  let storage = null;
  try { storage = localStorage; } catch { /* the plain link is still right */ }
  location.search = withSettings(courseUrl(slug, location.search), readSettings(storage));
}

/* The start menu, and the mode or settings page inside it, from anywhere. */
export function hubUrl(route = '') {
  return `${BASE}${route ? `#${route}` : ''}`;
}
