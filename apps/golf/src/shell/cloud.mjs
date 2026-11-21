/* Frontend cloud account + offline-first sync controller for Banvy.
   Zero external dependencies: talks directly to our Cloudflare Worker's
   /api/auth/* (Better Auth) and /api/sync (D1) routes on the same origin.

   Degrades cleanly to pure local-only mode on static hosts (e.g. GitHub Pages)
   and when offline on the golf course. */
import {
  applySyncResponse,
  buildSyncPayload,
  selectSyncUser,
  writePlayerProfile,
  markBagDirty,
  markHandicapDirty,
  markRestoredDataDirty,
  markRoundDeleted,
  markRoundDirty,
  markShotsDirty,
  readSyncMeta,
} from './sync-model.mjs';
import { readText } from './settings-store.mjs';

const CACHED_USER_KEY = 'banvy_sync_user_v1';
const API_BASE = '/api';

const storage = () => { try { return localStorage; } catch { return null; } };

function readCachedUser() {
  try {
    const raw = JSON.parse(readText(storage(), CACHED_USER_KEY, 'null'));
    return raw && typeof raw.id === 'string' ? raw : null;
  } catch { return null; }
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
let identityRevision = 0;
let sessionRequest = 0;

function announce(type, detail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new window.CustomEvent(type, { detail }));
}

function useIdentity(user, changedInAnotherTab = false) {
  const st = storage();
  const userId = user?.id ?? null;
  const previousUserId = state.user?.id ?? null;
  const meta = readSyncMeta(st);
  // Another tab may already have switched the shared cache to this identity.
  // Legacy installations only tracked the owner after their first sync.
  const owner = meta.userId ?? readCachedUser()?.id ?? null;
  let cacheReplaced = false;
  if (st) cacheReplaced = selectSyncUser(st, userId, owner, CACHED_USER_KEY, user);
  else if (userId || previousUserId) throw new Error('Spelarens lokala data kunde inte öppnas.');
  state.user = user;
  const next = readSyncMeta(st);
  state.dirty = next.dirty;
  state.lastSyncedAt = next.lastSyncedAt;
  if (previousUserId !== userId) {
    identityRevision++;
    clearTimeout(syncTimer);
    announce('banvy-account-changed', { previousUserId, userId, cacheReplaced: cacheReplaced || changedInAnotherTab });
    announce('banvy-sync-changed', { accountChanged: true });
  }
}

function bindLifecycle() {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;
  window.addEventListener('online', () => {
    state.offline = false;
    emit();
    initCloud(true);
  });
  window.addEventListener('offline', () => {
    state.offline = true;
    emit();
  });
  window.addEventListener('storage', event => {
    if (event.key !== CACHED_USER_KEY && event.key !== null) return;
    const cached = readCachedUser();
    if ((cached?.id ?? null) === (state.user?.id ?? null)) return;
    sessionRequest++;
    useIdentity(cached, true);
    emit();
    initCloud(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state.user || state.offline) return;
    const stale = Date.now() - state.lastSyncedAt > 60_000;
    if (state.dirty || stale) syncNow();
  });
}

export function initCloud(force = false, refreshFromUser = null) {
  bindLifecycle();
  if (initPromise && !force) return initPromise;
  const request = ++sessionRequest;
  initPromise = (async () => {
    try {
      const health = await fetchJson('/health');
      if (request !== sessionRequest) return getCloudState();
      if (!health.ok || !health.isJson || !health.data?.ok) {
        // Static host without Worker backend (e.g. GitHub Pages).
        state.available = false;
        state.google = false;
        state.devAuth = false;
        state.ready = true;
        emit();
        return getCloudState();
      }
      state.available = true;
      state.offline = false;
      state.google = Boolean(health.data.google);
      state.devAuth = Boolean(health.data.devAuth);

      const session = await fetchJson('/auth/get-session');
      if (request !== sessionRequest) return getCloudState();
      if ((session.ok && session.isJson) || session.status === 401) {
        const source = session.data?.user;
        try {
          useIdentity(source?.id ? { id: source.id, name: source.name ?? '', email: source.email ?? '', image: source.image ?? null } : null);
          state.error = null;
        } catch (error) {
          // Do not expose or upload the outgoing player's data under the new account.
          state.error = error.message;
          state.ready = true;
          emit();
          return getCloudState();
        }
        state.ready = true;
        emit();
        if (state.user && state.user.id !== refreshFromUser) syncNow();
      } else {
        state.ready = true;
        state.error = 'Kontot kunde inte verifieras. Försök igen.';
        emit();
      }
    } catch {
      if (request !== sessionRequest) return getCloudState();
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
  const generation = identityRevision;
  clearTimeout(syncTimer);
  try {
    const result = await fetchJson('/auth/sign-out', { method: 'POST', body: '{}' });
    if (!result.ok || result.data?.success !== true) throw new Error('Utloggningen kunde inte bekräftas. Försök igen när du har kontakt.');
    if (generation !== identityRevision) return { ok: false, reason: 'account-changed' };
    sessionRequest++;
    useIdentity(null);
    state.error = null;
    emit();
    return { ok: true };
  } catch (error) {
    state.error = error instanceof TypeError ? 'Utloggningen kunde inte bekräftas. Kontrollera anslutningen och försök igen.' : error.message;
    emit();
    return { ok: false, error: state.error };
  }
}

export async function syncNow() {
  if (!state.ready) await initCloud();
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
  const userId = state.user.id;
  const generation = identityRevision;
  const ownsCache = () => generation === identityRevision && readSyncMeta(st).userId === userId && readCachedUser()?.id === userId;
  if (!st || !ownsCache()) return { ok: false, reason: 'account-unverified' };
  clearTimeout(syncTimer);
  state.syncing = true;
  state.error = null;
  emit();

  const work = async () => {
    const payload = buildSyncPayload(st);
    let res;
    try {
      res = await fetchJson('/sync', { method: 'POST', body: JSON.stringify({ ...payload, expectedUserId: userId }) });
    } catch {
      if (ownsCache()) state.offline = true;
      return { ok: false, reason: 'offline' };
    }
    if (!ownsCache()) return { ok: false, reason: 'account-changed' };
    if (res.status === 401 || res.status === 409) {
      initCloud(true, userId);
      return { ok: false, reason: 'account-unverified' };
    }
    if (!res.ok || !res.data) {
      state.error = res.data?.error || 'Synkningen misslyckades. Försöker igen senare.';
      return { ok: false, reason: 'server-error' };
    }
    const applied = applySyncResponse(st, res.data, userId, payload);
    state.offline = false;
    state.lastSyncedAt = readSyncMeta(st).lastSyncedAt;
    state.dirty = applied.dirty;
    if (applied.changed) announce('banvy-sync-changed', applied);
    return { ok: true, ...applied };
  };
  const flush = async () => {
    let result;
    do {
      clearTimeout(syncTimer);
      syncQueued = false;
      result = await work();
      // Hold the manual sync / handoff promise through the outstanding edit.
      // A sign-in that superseded this request has its own pending sync.
      if (!result.ok || !ownsCache()) break;
    } while (result.dirty || syncQueued);
    return result;
  };
  syncInFlight = flush().catch(error => {
    state.error = error.message || 'Synksvaret kunde inte sparas på den här enheten.';
    return { ok: false, reason: 'storage' };
  }).finally(() => {
    syncInFlight = null;
    state.syncing = false;
    emit();
    if (syncQueued) {
      syncQueued = false;
      if (state.user) scheduleSync(0);
    }
  });
  return syncInFlight;
}

export function savePlayerProfile(field, value, writeValue = null) {
  try {
    if ((state.user?.id ?? null) !== (readCachedUser()?.id ?? null)) return false;
    if (writePlayerProfile(storage(), field, value, Date.now(), writeValue)) {
      state.dirty = true;
      emit();
      scheduleSync();
    }
    return true;
  } catch {
    state.error = 'Ändringen kunde inte sparas på enheten.';
    emit();
    return false;
  }
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
  else if (kind === 'backup-restored' && !detail.durable) markRestoredDataDirty(st, now, detail.keys, detail.previous);
  state.dirty = readSyncMeta(st).dirty;
  emit();
  scheduleSync(kind === 'shots' ? 1800 : 350);
}
