import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAP_KEYS } from './settings-store.mjs';
import { readSyncMeta } from './sync-model.mjs';

function memory() {
  const entries = new Map();
  return {
    get length() { return entries.size; },
    key: index => [...entries.keys()][index] ?? null,
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
  };
}
const json = (value, status = 200) => Response.json(value, { status });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { resolve, promise };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  const win = new EventTarget();
  win.CustomEvent = CustomEvent;
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('localStorage', memory());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('sends the pending edit on the next request and uses only the acknowledged revision', async () => {
  const flight = deferred(), started = deferred();
  const payloads = [];
  vi.stubGlobal('fetch', async (url, options) => {
    if (url.endsWith('/health')) return json({ ok: true });
    if (url.endsWith('/get-session')) return json({ user: { id: 'alice' } });
    const p = JSON.parse(options.body);
    payloads.push(p);
    if (payloads.length === 1) { started.resolve(); await flight.promise; }
    return json({ ...p, syncedAt: 12345 });
  });
  const cloud = await import('./cloud.mjs');
  cloud.savePlayerProfile('handicap', 17);
  await cloud.initCloud();
  await started.promise;
  expect(cloud.savePlayerProfile('handicap', 11)).toBe(true);
  flight.resolve();
  const first = await cloud.syncNow();
  expect(first).toMatchObject({ ok: true, dirty: false });
  expect(localStorage.getItem(MAP_KEYS.handicap)).toBe('11');
  await vi.runAllTimersAsync();
  expect(payloads.map(p => [p.expectedUserId, p.profile.handicap])).toEqual([['alice', 17], ['alice', 11]]);
  expect(cloud.getCloudState()).toMatchObject({ dirty: false, syncing: false });
});

it('reports refused sign-out and keeps local credentials and a live card until the server confirms', async () => {
  let signOutStatus = 500;
  let flight = null;
  vi.stubGlobal('fetch', async (url, options) => {
    if (url.endsWith('/health')) return json({ ok: true });
    if (url.endsWith('/get-session')) return json({ user: { id: 'alice' } });
    if (url.endsWith('/sign-out')) return json({ success: signOutStatus === 200 }, signOutStatus);
    const p = JSON.parse(options.body);
    if (flight) await flight.promise;
    return json({ ...p, syncedAt: 120 });
  });
  const cloud = await import('./cloud.mjs');
  await cloud.initCloud();
  await cloud.syncNow();
  await vi.runAllTimersAsync();
  const card = 'banvy-map-round-v1:visby';
  localStorage.setItem(card, 'alice-h8');
  expect((await cloud.signOutCloud()).ok).toBe(false);
  expect(cloud.getCloudState().user.id).toBe('alice');
  expect(localStorage.getItem(card)).toBe('alice-h8');

  flight = deferred();
  const pending = cloud.syncNow();
  const changes = [];
  window.addEventListener('banvy-account-changed', event => changes.push(event.detail));
  signOutStatus = 200;
  expect(await cloud.signOutCloud()).toEqual({ ok: true });
  expect(localStorage.getItem(card)).toBeNull();
  flight.resolve();
  expect(await pending).toMatchObject({ ok: false, reason: 'account-changed' });
  expect(cloud.getCloudState().user).toBeNull();
  expect(readSyncMeta(localStorage).userId).toBeNull();
  expect(changes).toEqual([{ previousUserId: 'alice', userId: null, cacheReplaced: true }]);
});

it('preserves the existing owner on a temporary session-service error', async () => {
  let bad = false;
  vi.stubGlobal('fetch', async (url, options) => {
    if (url.endsWith('/health')) return json({ ok: true });
    if (url.endsWith('/get-session')) return bad ? json({ error: 'unavailable' }, 503) : json({ user: { id: 'alice' } });
    return json(JSON.parse(options.body));
  });
  const cloud = await import('./cloud.mjs');
  await cloud.initCloud();
  await cloud.syncNow();
  bad = true;
  await cloud.initCloud(true);
  expect(cloud.getCloudState()).toMatchObject({ user: { id: 'alice' }, error: expect.stringContaining('verifieras') });
  expect(readSyncMeta(localStorage).userId).toBe('alice');
});
