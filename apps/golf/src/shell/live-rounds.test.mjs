import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MAP_KEYS, ROUND_KEY, exportBackup, readBackup, restoreBackup } from './settings-store.mjs';
import { storeHistory } from '../map/map-shots.mjs';
import { liveFrozen, offerLive, prepareLiveBackup, reconcileLocalRounds, recordingDevice, takeLive } from './live-rounds.mjs';

const cloud = vi.hoisted(() => ({ user: { id: 'alice' }, dirty: false }));
vi.mock('./cloud.mjs', () => ({ getCloudState: () => cloud, syncNow: async () => ({ ok: true }) }));
const course = 'upsala', id = 50, cardKey = ROUND_KEY + ':' + course;
const card = { id, version: 1, begunAt: 1000, touchedAt: 1200, playingHole: 2, scores: { 1: { strokes: 4 } } };
const shot = { course, hole: 1, at: 1100, round: id, club: 'driver' };
const snapshot = { card, tee: 2, shots: [shot] };
let row;
beforeEach(() => {
  const entries = new Map();
  vi.stubGlobal('localStorage', {
    get length() { return entries.size; },
    key: i => Array.from(entries.keys())[i],
    getItem: k => entries.get(k) ?? null,
    setItem: (k, v) => entries.set(k, String(v)),
    removeItem: k => entries.delete(k),
  });
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('window', new EventTarget());
  cloud.user = { id: 'alice' };
  cloud.dirty = false;
  row = { course, id, device: 'other-recording-device', revision: 3, status: 'offered', snapshot };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('recovers a confirmed claim after a failed local write without losing or duplicating any shots', async () => {
  const other = { ...shot, at: 300, round: 12 };
  localStorage.setItem(MAP_KEYS.shots, storeHistory([other]));
  const device = recordingDevice();
  let claims = 0;
  vi.stubGlobal('fetch', async (_url, options) => {
    expect(options.headers['X-Banvy-User']).toBe('alice');
    if (options.method !== 'POST') return Response.json({ rounds: [row] });
    expect(JSON.parse(options.body).action).toBe('claim');
    row = { ...row, revision: 4, status: 'recording', device };
    claims++;
    return Response.json({ accepted: true, row });
  });
  const original = localStorage.setItem;
  const quota = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    if (key === cardKey) throw Error('quota');
    return original(key, value);
  });
  await expect(takeLive(row)).rejects.toThrow();
  expect(localStorage.getItem(cardKey)).toBeNull();
  expect(localStorage.getItem('banvy-map-tee-v1:' + course)).toBeNull();
  expect(localStorage.getItem(MAP_KEYS.shots)).toBe(storeHistory([other]));
  quota.mockRestore();
  await takeLive(row);
  expect(claims).toBe(1);
  expect(JSON.parse(localStorage.getItem(cardKey))).toMatchObject(cardWithNewTouch());
  expect(localStorage.getItem(MAP_KEYS.shots)).toBe(storeHistory([other, shot]));
});

function cardWithNewTouch() {
  return { ...card, touchedAt: expect.any(Number) };
}

it('keeps the phone playable if the shared scores have pending edits before an offer', async () => {
  localStorage.setItem(cardKey, JSON.stringify(card));
  cloud.dirty = true;
  const requests = [];
  vi.stubGlobal('fetch', async (_url, options) => {
    const { action, device } = JSON.parse(options.body);
    requests.push(action);
    return Response.json({ accepted: true, row: { ...row, device, status: 'recording', revision: 1 } });
  });
  await expect(offerLive(course, id)).rejects.toThrow();
  expect(requests).toEqual(['save']);
  expect(liveFrozen(course, id)).toBe(false);
  expect(JSON.parse(localStorage.getItem(cardKey))).toEqual(card);
});

it('freezes an obsolete card after an offered transfer, preserving any other local course', () => {
  localStorage.setItem(cardKey, JSON.stringify(card));
  localStorage.setItem(ROUND_KEY + ':visby', JSON.stringify({ id: 101 }));
  reconcileLocalRounds([row]);
  expect(liveFrozen(course, id)).toBe(true);
  expect(localStorage.getItem(cardKey)).toBeNull();
  expect(localStorage.getItem(ROUND_KEY + ':visby')).toBe('{"id":101}');
});

it('imports history offline without making a second writer or replacing its current copy of live shots', async () => {
  localStorage.setItem('banvy_sync_meta_v1', JSON.stringify({ version: 1, userId: 'alice' }));
  localStorage.setItem(cardKey, JSON.stringify(card));
  const historical = { ...shot, round: 23, from: [0, 10], at: 100 };
  localStorage.setItem(MAP_KEYS.shots, storeHistory([historical, { ...shot, from: [0, 20] }]));
  const backup = readBackup(JSON.stringify(exportBackup(localStorage)));
  expect(backup.accountRounds).toBe(true);
  localStorage.removeItem(cardKey);
  const newer = { ...shot, from: [0, 25], club: 'pw' };
  localStorage.setItem(MAP_KEYS.shots, storeHistory([newer]));
  navigator.onLine = false;
  const result = await prepareLiveBackup(backup.entries, backup.accountRounds);
  expect(result.courses).toEqual([course]);
  restoreBackup(localStorage, result.entries);
  expect(localStorage.getItem(cardKey)).toBeNull();
  expect(localStorage.getItem(MAP_KEYS.shots)).toBe(storeHistory([historical, newer]));
});

it('lets the recording phone restore its own card offline, and a guest restore an independent local round', async () => {
  const entries = [[cardKey, JSON.stringify(card)]];
  navigator.onLine = false;
  localStorage.setItem(cardKey, JSON.stringify(card));
  expect((await prepareLiveBackup(entries, true)).entries).toEqual(entries);
  localStorage.removeItem(cardKey);
  cloud.user = null;
  expect((await prepareLiveBackup(entries, false)).entries).toEqual(entries);
  expect((await prepareLiveBackup(entries, true)).entries).toEqual([]);
});

it('reconciles an old backup without provenance against the actual recording device', async () => {
  const entries = [[cardKey, JSON.stringify(card)]];
  vi.stubGlobal('fetch', async () => Response.json({ rounds: [row] }));
  row = { ...row, status: 'recording' };
  expect((await prepareLiveBackup(entries, false)).courses).toEqual([course]);
  row.device = recordingDevice();
  expect((await prepareLiveBackup(entries, false)).entries).toEqual(entries);
});
