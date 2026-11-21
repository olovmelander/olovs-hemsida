/* What the map needs to stand up to a real round: the phone's position, a
   screen that stays on, and a course that keeps working with no signal. */
import { cacheKey, isPrecached, MAP_OFFLINE_CACHE, receiptKey, receiptUrl, savedCourseStatus, shellCache, validIndex } from './map-offline-status.mjs';

export const FRESH_FIX_MS = 10000, PLACING_ACCURACY_METRES = 20;

/* Keep the last reliable origin while the phone is under trees or asleep. Age
   comes from the sensor's sample time, since a callback can deliver a cached fix. */
export function createGuidanceFix() {
  let reliable = null, expiresAt = 0;
  return {
    get expiresAt() { return expiresAt; },
    receive(player, timestamp, now) {
      const age = now - timestamp;
      const usable = age >= 0 && age < FRESH_FIX_MS && Number.isFinite(player.accuracy)
        && player.accuracy >= 0 && player.accuracy <= PLACING_ACCURACY_METRES;
      if (usable) reliable = player.onCourse ? player.point : null;
      expiresAt = usable && reliable ? timestamp + FRESH_FIX_MS : 0;
      return usable;
    },
    interrupt() { expiresAt = 0; },
    clear() { reliable = null; expiresAt = 0; },
    origin(tee, isPlayingHole, now) {
      if (!reliable || !isPlayingHole) return { point: tee, source: 'tee' };
      return { point: reliable, source: now < expiresAt ? 'gps' : 'last-gps' };
    },
  };
}

export function createGps({ onFix, onFailure }) {
  let watch = null, generation = 0;
  const deliver = session => position => {
    if (session === generation) onFix(position.coords, position.timestamp);
  };
  function stop() {
    generation++;
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null;
  }
  return {
    get active() { return watch !== null; },
    start() {
      if (!navigator.geolocation) { onFailure('Den här webbläsaren saknar platsåtkomst'); return; }
      if (watch !== null) return;
      const session = ++generation;
      watch = navigator.geolocation.watchPosition(deliver(session), error => {
        if (session !== generation) return;
        if (error.code === 1) {
          stop();
          onFailure('Platsåtkomst nekades · tillåt plats för sidan i webbläsarens inställningar', { denied: true });
        } else onFailure(error.code === 2 ? 'Ingen GPS-position ännu' : 'GPS svarar inte ännu');
      }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    },
    stop,
    /* A player standing still may get no fixes from the watch: ask for one now. */
    ask() {
      if (watch !== null) navigator.geolocation.getCurrentPosition(deliver(generation), () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
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

/* Actual URLs from the build's map dependency graph plus the selected pack.
   The two mutable roots are scoped to the layout; the other data is immutable. */
const absolute = href => new URL(href, location.href).href;

export async function courseDownload(store, course, { extras, moduleUrl }) {
  if (!globalThis.caches || !navigator.serviceWorker || !moduleUrl.endsWith('.js')) throw new Error('Webbläsaren kan inte spara banan');
  const entry = document.querySelector('script[type="module"][src]')?.src;
  const shell = entry && new URL(entry).pathname.split('/').pop().replace(/\.js$/, '');
  if (!shell) throw new Error('Offlineappen saknas');
  const inventoryUrl = moduleUrl.replace(/\.js$/, `.${shell}.offline.json`);
  const cache = await caches.open(MAP_OFFLINE_CACHE);
  const held = await cache.match(inventoryUrl);
  const response = held || await fetch(inventoryUrl, { cache: 'no-cache' });
  if (!response.ok) throw new Error('Nedladdningslistan kunde inte hämtas');
  const inventory = await response.clone().json();
  if (inventory.version !== 1 || !inventory.files?.length) throw new Error('Ladda om för den aktuella banversionen');
  const base = new URL(import.meta.env.BASE_URL, location.href);
  const code = inventory.files.map(file => ({ ...file, href: new URL(file.url, base).href }));
  if (!code.some(file => file.href === moduleUrl)) throw new Error('Ladda om för den aktuella banversionen');
  if (!held) await cache.put(inventoryUrl, response);
  const terrain = offlineFiles(offlineTiles(store, course)).map(file => ({ ...file, href: store.fileUrl(file) }));
  const unique = new Map();
  for (const file of [...code, ...course.offlineRoots, ...course.offlineData, ...extras, ...terrain]) {
    const href = absolute(file.href);
    unique.set(href, { ...file, href });
  }
  const files = [...unique.values()];
  return { course, files, inventoryUrl, inventory, base, entry,
    identity: [inventoryUrl, ...course.offlineRoots.map(file => file.identity), ...extras.map(file => file.sha256)].join('|'),
    bytes: files.reduce((n, file) => n + (file.bytes || 0), 0) };
}

export const offlineStatus = pack => savedCourseStatus(pack.course.slug, { identity: pack.identity });

async function waitForOfflineShell(base) {
  const service = navigator.serviceWorker;
  const worker = new URL('sw.js', base);
  let timer, onControl;
  const controlled = () => service.controller?.scriptURL === worker.href;
  const active = new Promise(resolve => {
    onControl = () => { if (controlled()) resolve(); };
    service.addEventListener('controllerchange', onControl);
    onControl();
  });
  try {
    await Promise.race([
      (async () => {
        if (!controlled()) await service.register(worker.href, { scope: base.pathname });
        await active;
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Offlineappen är inte klar · försök igen')), 45000); }),
    ]);
  } finally {
    clearTimeout(timer);
    service.removeEventListener('controllerchange', onControl);
  }
}

async function validCopy(response, file, slug) {
  if (!response?.ok) return false;
  if (file.index) return validIndex(response, file, slug);
  if (!file.sha256) return true;
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength !== file.bytes) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('') === file.sha256;
}

export async function downloadCourse(pack, { onProgress } = {}) {
  await waitForOfflineShell(pack.base);
  const [cache, shell] = await Promise.all([caches.open(MAP_OFFLINE_CACHE), shellCache(pack.base)]);
  if (!await cache.match(pack.inventoryUrl)) await cache.put(pack.inventoryUrl, Response.json(pack.inventory));
  let done = 0, next = 0, failed = false;
  async function save() {
    while (!failed && next < pack.files.length) {
      const file = pack.files[next++];
      try {
        let held = await cache.match(file.href);
        if (!(await validCopy(held, file, pack.course.slug))) {
          held = isPrecached(file) && await shell.match(cacheKey(file));
          if (!(await validCopy(held, file, pack.course.slug))) {
            held = await fetch(file.href);
            if (!(await validCopy(held, file, pack.course.slug))) throw new Error('Banfiler saknas eller har ändrats · anslut och försök igen');
          }
          await cache.put(file.href, held.clone());
        }
        if (isPrecached(file) && !(await shell.match(cacheKey(file)))) await shell.put(cacheKey(file), held);
        done += file.bytes || 0;
        onProgress?.(done / pack.bytes);
      } catch (error) { failed = true; throw error; }
    }
  }
  const results = await Promise.allSettled(Array.from({ length: 6 }, save));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  const roots = pack.files.filter(file => file.index);
  // The app chooser opens the latest saved catalogue, while each individual
  // map always reopens its own versioned pack and ground index.
  const catalogue = roots.find(file => file.index === 'pack');
  const hubIndex = new URL('courses/index.json', pack.base).href;
  await cache.put(hubIndex, await cache.match(catalogue.href));
  await cache.put(receiptUrl(pack.course.slug, pack.base), Response.json({
    version: 1, identity: pack.identity, entry: pack.entry,
    files: [pack.inventoryUrl, hubIndex, ...pack.files.map(file => file.href)],
    shell: pack.files.filter(isPrecached).map(cacheKey), roots,
  }));
  localStorage.setItem(receiptKey(pack.course.slug), pack.identity);
  if (await offlineStatus(pack) !== 'ready') throw new Error('Nedladdningen är ofullständig · försök igen');
  return { files: pack.files.length, bytes: pack.bytes };
}
