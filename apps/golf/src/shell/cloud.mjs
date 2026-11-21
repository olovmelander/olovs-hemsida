/* Frontend cloud account + offline-first sync controller for Banvy.
   Zero external dependencies: talks directly to our Cloudflare Worker's
   /api/auth/* (Better Auth) and /api/sync (D1) routes on the same origin.

   Degrades cleanly to pure local-only mode on static hosts (e.g. GitHub Pages)
   and when offline on the golf course. */
import {
  applySyncResponse,
  buildSyncPayload,
  clearUserSyncedData,
  markBagDirty,
  markHandicapDirty,
  markRestoredDataDirty,
  markRoundDeleted,
  markRoundDirty,
  markShotsDirty,
  readSyncMeta,
} from './sync-model.mjs';
import { readText, writeText } from './settings-store.mjs';

const CACHED_USER_KEY = 'banvy_sync_user_v1';
const API_BASE = '/api';

const storage = () => { try { return localStorage; } catch { return null; } };

function readCachedUser() {
  try {
    const raw = JSON.parse(readText(storage(), CACHED_USER_KEY, 'null'));
    return raw && typeof raw.id === 'string' ? raw : null;
  } catch { return null; }
}

function writeCachedUser(user) {
  writeText(storage(), CACHED_USER_KEY, user ? JSON.stringify({
    id: user.id,
    name: user.name ?? '',
    email: user.email ?? '',
    image: user.image ?? null,
  }) : null);
}

const listeners = new Set();
const state = {
  ready: false,
  available: false,
  google: false,
  devAuth: false,
  offline: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
  user: readCachedUser(),
  syncing: false,
  lastSyncedAt: readSyncMeta(storage()).lastSyncedAt,
  dirty: readSyncMeta(storage()).dirty,
  error: null,
};

function emit() {
  const snapshot = getCloudState();
  for (const fn of listeners) {
    try { fn(snapshot); } catch { /* subscriber errors never break sync */ }
  }
}

export function getCloudState() {
  return { ...state };
}

export function subscribeCloud(fn) {
  listeners.add(fn);
  fn(getCloudState());
  return () => listeners.delete(fn);
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    ...options,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  return { ok: res.ok, status: res.status, data, isJson: ct.includes('application/json') };
}

let initPromise = null;
let syncInFlight = null;
let syncQueued = false;
let syncTimer = 0;
let listenersBound = false;

function bindLifecycle() {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;
  window.addEventListener('online', () => {
    state.offline = false;
    emit();
    if (state.user) syncNow();
    else if (!state.available) initCloud(true);
  });
  window.addEventListener('offline', () => {
    state.offline = true;
    emit();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.user || state.offline) return;
    const stale = Date.now() - state.lastSyncedAt > 60_000;
    if (state.dirty || stale) syncNow();
  });
}

export function initCloud(force = false) {
  bindLifecycle();
  if (initPromise && !force) return initPromise;
  initPromise = (async () => {
    try {
      const health = await fetchJson('/health');
      if (!health.ok || !health.isJson || !health.data?.ok) {
        // Static host without Worker backend (e.g. GitHub Pages).
        state.available = false;
        state.google = false;
        state.devAuth = false;
        state.user = null;
        state.ready = true;
        emit();
        return getCloudState();
      }
      state.available = true;
      state.offline = false;
      state.google = Boolean(health.data.google);
      state.devAuth = Boolean(health.data.devAuth);

      const session = await fetchJson('/auth/get-session');
      if (session.ok && session.data?.user?.id) {
        state.user = {
          id: session.data.user.id,
          name: session.data.user.name ?? '',
          email: session.data.user.email ?? '',
          image: session.data.user.image ?? null,
        };
        writeCachedUser(state.user);
        state.error = null;
        state.ready = true;
        emit();
        // Pull cloud data & upload any local rounds silently in the background.
        syncNow();
      } else {
        state.user = null;
        writeCachedUser(null);
        state.ready = true;
        emit();
      }
    } catch {
      // Network unreachable (offline on the course): keep cached identity so UI
      // honestly reports offline/pending instead of looking signed out.
      state.offline = true;
      if (state.user) state.available = true;
      state.ready = true;
      emit();
    }
    return getCloudState();
  })();
  return initPromise;
}

export async function signInWithGoogle(callbackURL = `${location.pathname}${location.search}${location.hash || '#installningar'}`) {
  state.error = null;
  emit();
  const res = await fetchJson('/auth/sign-in/social', {
    method: 'POST',
    body: JSON.stringify({ provider: 'google', callbackURL }),
  });
  if (!res.ok || !res.data?.url) {
    state.error = res.data?.message || res.data?.error || 'Kunde inte starta Google-inloggning.';
    emit();
    return { ok: false, error: state.error };
  }
  location.assign(res.data.url);
  return { ok: true };
}

export async function signInDevLocal(name = 'Testgolfare') {
  state.error = null;
  emit();
  const res = await fetchJson('/dev-login', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    state.error = res.data?.message || res.data?.error || 'Kunde inte logga in lokalt.';
    emit();
    return { ok: false, error: state.error };
  }
  await initCloud(true);
  return { ok: true };
}

export async function signOutCloud() {
  state.error = null;
  clearTimeout(syncTimer);
  try {
    await fetchJson('/auth/sign-out', { method: 'POST', body: '{}' });
  } catch { /* clear client state regardless */ }
  state.user = null;
  writeCachedUser(null);
  emit();
}

export async function syncNow() {
  if (!state.user) return { ok: false, reason: 'signed-out' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    state.offline = true;
    emit();
    return { ok: false, reason: 'offline' };
  }
  if (syncInFlight) {
    syncQueued = true;
    return syncInFlight;
  }

  const st = storage();
  if (!st) return { ok: false, reason: 'no-storage' };

  state.syncing = true;
  state.error = null;
  emit();

  syncInFlight = (async () => {
    try {
      // Account switch protection: never merge User A's synced cache into User B.
      const meta = readSyncMeta(st);
      if (meta.userId && meta.userId !== state.user.id) {
        clearUserSyncedData(st);
      }

      const payload = buildSyncPayload(st);
      const res = await fetchJson('/sync', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        state.user = null;
        writeCachedUser(null);
        state.syncing = false;
        emit();
        return { ok: false, reason: 'unauthorized' };
      }
      if (!res.ok || !res.data) {
        state.error = res.data?.error || 'Synkningen misslyckades. Försöker igen senare.';
        state.syncing = false;
        emit();
        return { ok: false, reason: 'server-error' };
      }

      const applied = applySyncResponse(st, res.data, state.user.id);
      state.offline = false;
      state.syncing = false;
      state.lastSyncedAt = Number(res.data.syncedAt) || Date.now();
      state.dirty = false;
      state.error = null;
      emit();

      if (applied.changed && typeof window !== 'undefined') {
        window.dispatchEvent(new window.CustomEvent('banvy-sync-changed', { detail: applied }));
      }
      return { ok: true, ...applied };
    } catch {
      state.offline = true;
      state.syncing = false;
      emit();
      return { ok: false, reason: 'offline' };
    } finally {
      syncInFlight = null;
      if (syncQueued) {
        syncQueued = false;
        syncNow();
      }
    }
  })();

  return syncInFlight;
}

function scheduleSync(delayMs = 400) {
  if (!state.user) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = 0; syncNow(); }, delayMs);
}

/* Called synchronously right after localStorage writes for synced player data.
   Always records the local timestamp immediately (100% offline-safe), then
   debounces a background sync when signed in. */
export function notifyLocalChange(kind, detail = {}) {
  const st = storage();
  if (!st) return;
  const now = Date.now();
  if (kind === 'handicap') markHandicapDirty(st, now);
  else if (kind === 'bag') markBagDirty(st, now);
  else if (kind === 'round') markRoundDirty(st, detail.course, detail.id, now);
  else if (kind === 'round-deleted') markRoundDeleted(st, detail.course, detail.id, now);
  else if (kind === 'shots') markShotsDirty(st, detail.course, detail.id, now);
  else if (kind === 'backup-restored') markRestoredDataDirty(st, now);
  state.dirty = true;
  emit();
  scheduleSync(kind === 'shots' ? 1800 : 350);
}
