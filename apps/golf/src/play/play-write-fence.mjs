/* Web Locks order the callbacks, but a renderer can still see an older
   localStorage cache. IndexedDB holds only the last commit token. A matching
   token in this renderer proves it received the preceding storage mutations. */
const MARK = 'banvy_sim_write_fence_v1';
const observed = new WeakMap();
let opening;
function database() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(MARK, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('commits');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    }).catch(error => { opening = null; throw error; });
  }
  return opening;
}
function commitRecord(db, next) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('commits', next ? 'readwrite' : 'readonly');
    const table = tx.objectStore('commits');
    const request = next ? table.put(next, 'last') : table.get('last');
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}
function mirror(store) {
  const raw = store.getItem(MARK);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return { token: raw }; }
}
function received(store, previous) {
  function arrived(current) {
    if (!previous) return true;
    const known = observed.get(store);
    // This same document saw the last token. Its subsequent absence proves a
    // clear, unlike an isolated renderer that is still waiting for a storage event.
    if (!current && known && (known === previous.token || known === previous.pending)) return true;
    return previous.pending ? current?.token === previous.pending && current.parent === previous.token
      : (current?.token ?? null) === previous.token;
  }
  const first = mirror(store);
  if (arrived(first)) return first;
  return new Promise(resolve => {
    function finish(value) {
      clearTimeout(timer);
      globalThis.removeEventListener('storage', changed);
      resolve(value);
    }
    function changed(event) {
      if (event.key !== MARK && event.key !== null) return;
      const current = mirror(store);
      if (arrived(current)) finish(current);
    }
    const timer = setTimeout(() => {
      const current = mirror(store);
      // A new document after a deliberate localStorage clear has no token,
      // even though IndexedDB can retain its small non-personal record.
      const cleared = current === null && performance.timeOrigin > previous.at;
      // The previous holder can disappear after reserving a turn, before doing
      // any work. Only its recorded parent or exact successor may continue.
      const interrupted = previous.pending && (current?.token ?? null) === previous.token;
      finish(arrived(current) || cleared || interrupted ? current : undefined);
    }, 2000);
    globalThis.addEventListener('storage', changed);
    const current = mirror(store);
    if (arrived(current)) finish(current);
  });
}

export async function fencedPlayWrite(store, action, records = null) {
  if (!store) return 'unavailable';
  if (!records) {
    if (!globalThis.indexedDB) return action();
    const db = await database();
    records = next => commitRecord(db, next);
  }
  const previous = await records();
  const latest = await received(store, previous);
  if (latest === undefined) return 'unavailable';
  const parent = latest?.token ?? null;
  const next = { token: crypto.randomUUID(), at: Date.now() };
  // Reserve the successor before writing any player data. If this tab exits
  // before the final IDB acknowledgement, the next holder knows both tokens.
  await records({ token: parent, pending: next.token, at: next.at });
  const result = action();
  // Both successful and interrupted actions can change storage.
  store.setItem(MARK, JSON.stringify({ token: next.token, parent }));
  observed.set(store, next.token);
  await records(next);
  return result;
}
