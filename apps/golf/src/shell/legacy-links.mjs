/* Published bookmarks all enter the supported player. Root HTML sources remain
   historical inputs to the course-pack validators, not deployment artifacts. */
export const LEGACY_PAGES = Object.freeze({
  'veckefjarden3d.html': 'veckefjarden',
  'norrfallsviken3d.html': 'norrfallsviken',
  'puttom3d.html': 'puttom',
  'angso3d.html': 'angso',
  'upsala3d.html': 'upsala',
  'johannesberg3d.html': 'johannesberg',
  'veckefjardensgc.html': 'veckefjarden',
});

export const VIEW_KEYS = Object.freeze([
  'hal', 'vy', 'ljus', 'tee', 'skylt', 'ren', 'kiosk', 'q', 'gl', 'hero', 'det',
]);

/* Keep this function self-contained: the build embeds it, with the same mapping
   and keys, into tiny redirect documents that need no engine or network import. */
export function mapLegacyLocation(pathname, search, base, pages, keys) {
  const file = pathname.split('/').pop();
  if (!Object.prototype.hasOwnProperty.call(pages, file)) return null;
  const from = new URLSearchParams(search);
  const to = new URLSearchParams({ bana: pages[file] });
  for (const key of keys) if (from.has(key)) to.set(key, from.get(key));
  return base + '?' + to.toString();
}
