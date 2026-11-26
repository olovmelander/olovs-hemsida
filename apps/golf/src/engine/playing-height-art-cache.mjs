// Workbox cannot observe a request which starts before the first worker
// controls the document. Use its same cache and URL for that first response.
function firstVisitCache(input, response, controlledAtRequest) {
  if (controlledAtRequest || !globalThis.navigator?.serviceWorker || !globalThis.caches ||
      response.status !== 200 || response.redirected || response.type === 'opaque' ||
      response.headers.get('content-type')?.includes('text/html')) return null;
  if (input instanceof Request && input.method !== 'GET') return null;
  const url = new URL(input instanceof Request ? input.url : input, globalThis.location.href);
  if (url.origin !== globalThis.location.origin || url.search || url.hash) return null;
  if (/\/assets\/(?:(?:pigment|normal-roughness|canopy|bank-granite)-[\w-]{8}\.webp|bank-(?:bro-hof-stadium|norrfallsviken)-[\w-]{8}\.bin)$/.test(url.pathname))
    return { url, name: 'banvy-playing-height-art' };
  if (/\/models\/trees\/realistic-v2\/[a-f0-9]{64}\.(glb|png)$/.test(url.pathname))
    return { url, name: 'banvy-ghibli-foliage-assets' };
  return null;
}

/** Verified loaders call this after checking the bytes, with a fresh Response. */
export async function retainPlayingHeightArt(input, response, controlledAtRequest) {
  try {
    const slot = firstVisitCache(input, response, controlledAtRequest);
    if (!slot) return;
    const cache = await globalThis.caches.open(slot.name);
    await cache.put(slot.url.href, response.clone());
  } catch { /* Storage may be disabled or full. The renderer still gets the art. */ }
}

/** Fetch-compatible path for the pilot's Vite-fingerprinted image assets. */
export async function fetchPlayingHeightArt(input, init) {
  const controlledAtRequest = Boolean(globalThis.navigator?.serviceWorker?.controller);
  const response = await fetch(input, init);
  if (!init?.method || init.method.toUpperCase() === 'GET')
    await retainPlayingHeightArt(input, response, controlledAtRequest);
  return response;
}
