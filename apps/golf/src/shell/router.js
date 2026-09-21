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
  for (const k of ['hero', 'gl', 'q', 'det']) {
    if (from.has(k)) to.set(k, from.get(k));
  }
  return '?' + to.toString();
}

export function goToCourse(slug) {
  location.search = courseUrl(slug, location.search);
}
