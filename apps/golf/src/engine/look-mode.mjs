/* Retired style flags cannot change the fixed v2 + Ghibli presentation. */
const RETIRED_VISUAL_KEYS = ['v2', 'ghibli', 'look', 'ground', 'trees'];

/** Preserve course/view, backend and quality settings in historical links. */
export function supportedVisualSearch(search = '') {
  const params = new URLSearchParams(search);
  for (const key of RETIRED_VISUAL_KEYS) params.delete(key);
  const query = params.toString();
  return query ? `?${query}` : '';
}
