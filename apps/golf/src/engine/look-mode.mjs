/* The player has one supported presentation: v2 terrain with Ghibli styling.
   A literal lets the production bundler discard inactive style branches.
   Old bookmarks and saved look preferences must not restore retired modes. */
export const GHIBLI_LOOK = true;

const RETIRED_VISUAL_KEYS = ['v2', 'ghibli', 'look', 'ground', 'trees'];

/** Preserve course/view, backend and quality settings in historical links. */
export function supportedVisualSearch(search = '') {
  const params = new URLSearchParams(search);
  for (const key of RETIRED_VISUAL_KEYS) params.delete(key);
  const query = params.toString();
  return query ? `?${query}` : '';
}
