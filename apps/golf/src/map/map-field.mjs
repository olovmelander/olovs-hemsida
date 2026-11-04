/* What the map needs to stand up to a real round: the phone's position, a
   screen that stays on, and a course that keeps working with no signal. */
import { MAP_OFFLINE_CACHE } from './map-tiles.mjs';

/* GPS is opt-in per visit and never starts from stored state, as in the player. */
export function createGps({ onFix, onFailure }) {
  let watch = null;
  return {
    get active() { return watch !== null; },
    start() {
      if (!navigator.geolocation) { onFailure('Den här webbläsaren saknar platsåtkomst'); return; }
      if (watch !== null) return;
      watch = navigator.geolocation.watchPosition(position => onFix(position.coords), error => {
        if (error.code === 1) {
          navigator.geolocation.clearWatch(watch);
          watch = null;
          onFailure('Platsåtkomst nekades · tillåt plats i webbläsaren');
        } else onFailure(error.code === 2 ? 'Ingen GPS-position ännu' : 'GPS svarar inte ännu');
      }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    },
    stop() {
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      watch = null;
    },
  };
}

/* A phone that sleeps between shots loses the map and the GPS fix with it. The
   browser drops the lock whenever the page is hidden, so it is taken again on
   return. Unsupported browsers simply keep their normal timeout. */
export function createScreenLock() {
  let wanted = false, lock = null;
  const take = async () => {
    if (!wanted || lock || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch { lock = null; }
  };
  document.addEventListener('visibilitychange', take);
  return {
    hold() { wanted = true; take(); },
    release() { wanted = false; lock?.release(); lock = null; },
  };
}

/* The tiles a course needs with no signal: all of its 1 m tiles, every tile above
   them, and the broad levels around them for the overview. */
export function offlineTiles(store, course) {
  const wanted = new Set();
  for (const hole of course.holes) {
    for (const id of hole.tileIds) {
      for (let node = store.nodes.get(id); node; node = node.parent) wanted.add(node);
    }
  }
  for (const node of store.nodes.values()) if (node.lod >= 3) wanted.add(node);
  return [...wanted];
}

/* Every published file those tiles need, heights and vegetation. */
export const offlineFiles = tiles => tiles.flatMap(node => [node.layers.terrain, node.layers.stands, node.layers.objects].filter(Boolean));
export const offlineBytes = (tiles, extras = []) => [...offlineFiles(tiles), ...extras].reduce((sum, file) => sum + file.bytes, 0);

/* Into the map's own cache rather than the shared one: the player's streaming
   can push 256 entries out of that, and a course downloaded in the car park has
   to still be there on the 14th tee. Tiles are content-addressed, so a stored
   tile is either the right bytes or unused. */
export async function downloadCourse(store, course, { onProgress, extras = [] } = {}) {
  const tiles = offlineTiles(store, course);
  const files = [...offlineFiles(tiles), ...extras];
  const cache = await caches.open(MAP_OFFLINE_CACHE);
  const total = offlineBytes(tiles, extras);
  let done = 0, next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      const url = file.href ?? store.fileUrl(file);
      if (!(await cache.match(url))) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`terrängdata saknas (${response.status})`);
        await cache.put(url, response);
      }
      done += file.bytes;
      onProgress?.(done / total);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  localStorage.setItem(`banvy-map-offline:${course.slug}`, course.ground.sourceManifestSha256 ?? '1');
  return { files: files.length, bytes: total };
}

export function isDownloaded(course) {
  try { return localStorage.getItem(`banvy-map-offline:${course.slug}`) === (course.ground.sourceManifestSha256 ?? '1'); }
  catch { return false; }
}
