/* Shared by the course chooser and the mobile map. Checking a download must
   work before starting a round or loading the map renderer. */
export const MAP_OFFLINE_CACHE = 'banvy-map-offline-v1';
export const receiptKey = slug => `banvy-map-offline:${slug}`;
export const receiptUrl = (slug, base) => new URL(`courses/${encodeURIComponent(slug)}/map-offline-receipt.json`, base).href;
export const cacheKey = file => file.precache ? `${file.href}?__WB_REVISION__=${file.precache}` : file.href;
export const isPrecached = file => Object.hasOwn(file, 'precache');

export async function shellCache(base) {
  // Workbox's navigation route reads the scope root under its exact revision.
  const names = await caches.keys();
  const name = names.find(n => n.startsWith('workbox-precache-') && n.endsWith(base.href));
  return caches.open(name ?? `workbox-precache-v2-${base.href}`);
}

export const packIdentity = entry => [entry.sha256, ...[entry.landcover, entry.mownSurface, entry.surroundings]
  .filter(Boolean).map(file => file.sha256)].join('/');

export async function validIndex(response, file, slug) {
  if (!response?.ok) return false;
  try {
    const entry = (await response.clone().json()).courses?.find(c => c.slug === slug);
    if (!entry) return false;
    const identity = file.index === 'graph' ? entry.manifest?.sha256 : packIdentity(entry);
    return identity === file.identity;
  } catch { return false; }
}

export async function savedCourseStatus(slug, { catalogue, identity } = {}) {
  try {
    if (!globalThis.caches || !navigator.serviceWorker) return 'unavailable';
    const marker = localStorage.getItem(receiptKey(slug));
    if (!marker) return 'unsaved';
    const base = new URL(import.meta.env.BASE_URL, location.href);
    if (navigator.serviceWorker.controller?.scriptURL !== new URL('sw.js', base).href) return 'repair';
    // Reopen by name: an old Cache handle survives deletion of the bucket.
    const cache = await caches.open(MAP_OFFLINE_CACHE);
    const receipt = await cache.match(receiptUrl(slug, base));
    if (!receipt) return 'repair';
    const record = await receipt.json();
    const entry = document.querySelector('script[type="module"][src]')?.src;
    if (record.version !== 1 || record.identity !== marker || (identity && record.identity !== identity) ||
        (catalogue && record.roots?.find(root => root.index === 'pack')?.identity !== packIdentity(catalogue)) || record.entry !== entry) return 'repair';
    const shell = await shellCache(base);
    const [files, shellFiles] = await Promise.all([cache.keys(), shell.keys()]);
    const saved = new Set(files.map(request => request.url));
    const precached = new Set(shellFiles.map(request => request.url));
    if (record.files.some(href => !saved.has(href)) || record.shell.some(key => !precached.has(key))) return 'repair';
    // A second tab can have saved a newer publication of the same layout.
    for (const root of record.roots) {
      if (!await validIndex(await cache.match(root.href), root, slug)) return 'repair';
    }
    return 'ready';
  } catch { return 'unavailable'; }
}
