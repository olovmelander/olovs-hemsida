/* Where the app is, and how it got there.

   Two rules, and the second is the one that matters:

   1. ?bana=<slug> selects the course. Absent, the manifest's first entry boots
      and the rail opens over it, so a bare visit is a choice rather than an
      arbitrary course pretending to be the product.

   2. EVERY historical URL still resolves to the same view. The six standalone
      pages have been shared, bookmarked and linked with the full grammar --
      hal, vy, ljus, tee, skylt, ren, kiosk, q and gl -- and a link that used to
      show someone the 14th at dusk has to keep showing them the 14th at dusk.
      That is not a nicety: those links are the only distribution this project
      has ever had. The page name carries the course, the query carries the
      view, and gl=1 and q=lo are in the list because an audit found them
      missing from a plan that claimed the grammar was preserved verbatim.   */

export const LEGACY_PAGES = {
  'veckefjarden3d.html': 'veckefjarden',
  'norrfallsviken3d.html': 'norrfallsviken',
  'puttom3d.html': 'puttom',
  'angso3d.html': 'angso',
  'upsala3d.html': 'upsala',
  'johannesberg3d.html': 'johannesberg',
};

/* the whole grammar, and nothing invented: these are the keys the pages read */
export const VIEW_KEYS = ['hal', 'vy', 'ljus', 'tee', 'skylt', 'ren', 'kiosk', 'q', 'gl'];

/* Given a legacy location, the app URL that shows the same thing. Returns null
   when the path is not one of the six pages, so a caller can tell "not a legacy
   link" from "a legacy link that maps to nothing". */
export function legacyTarget(pathname, search) {
  const file = pathname.split('/').pop();
  const slug = LEGACY_PAGES[file];
  if (!slug) return null;
  const from = new URLSearchParams(search);
  const to = new URLSearchParams();
  to.set('bana', slug);
  for (const k of VIEW_KEYS) if (from.has(k)) to.set(k, from.get(k));
  return '/?' + to.toString();
}

export function currentSlug(search = location.search) {
  return new URLSearchParams(search).get('bana');
}

/* Switching is navigation in v1 -- the engine's boot is a straight line and
   tearing it down in place is the persistent-renderer phase's work, not this
   one. The view keys are dropped on purpose: hole 14 of one course means
   nothing on another, and carrying a stale hole number across would open the
   new course on a hole the visitor never asked for. */
export function goToCourse(slug) {
  location.search = '?bana=' + encodeURIComponent(slug);
}
