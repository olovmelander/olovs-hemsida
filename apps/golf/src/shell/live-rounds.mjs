/* A live card stays playable offline on its recording device. Offering it
   freezes that local copy first, then sends the complete card and shot log
   together. Claiming changes the writer at the server before local play opens. */
import { getCloudState, syncNow } from './cloud.mjs';
import { HOLE_KEY, MAP_KEYS, ROUND_KEY, TEE_KEY, activeBackupRounds, replaceStoredValues } from './settings-store.mjs';
import { parseHistory, storeHistory } from '../map/map-shots.mjs';
import { parseRounds } from '../map/map-rounds.mjs';

const guardPrefix = 'banvy-live-owner-v1:';
const endpoint = '/api/active-rounds';
const guardKey = (user, course, id) => guardPrefix + JSON.stringify([user, course, id]);
const who = () => getCloudState().user?.id;
const event = () => window.dispatchEvent(new Event('banvy-live-changed'));
const queues = new Map();
const retryMessage = 'Rundan är sparad på enheten. Anslut till nätet och försök igen.';
function read(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function write(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
export function recordingDevice() {
  const key = 'banvy-device-id-v1';
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}
export function liveFrozen(course, id, user = who()) {
  return Boolean(user && read(guardKey(user, course, id))?.frozen);
}
export function liveGuardChange(key) { return key?.startsWith(guardPrefix); }

function localSnapshot(course, id) {
  const card = read(ROUND_KEY + ':' + course);
  if (card?.id !== id || !card.begunAt) return null;
  const shots = parseHistory(localStorage.getItem(MAP_KEYS.shots)).filter(shot => shot.course === course && shot.round === id);
  // An absent preference means the course's default tee, which can be any index.
  const tee = localStorage.getItem('banvy-map-tee-v1:' + course);
  return { card, shots, tee: tee === null ? null : Number(tee) };
}
async function json(user, options = {}) {
  let response;
  try {
    response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { ...options.headers, 'X-Banvy-User': user } });
  } catch { throw Error(retryMessage); }
  if (response.status === 401) throw Error('Logga in igen för att synka rundan. Din lokala runda finns kvar.');
  if (!response.ok && response.status !== 409) {
    const problem = await response.json().catch(() => null);
    throw Error(problem?.error || retryMessage);
  }
  const result = await response.json();
  if (result.error) throw Error(result.error);
  return result;
}
export async function remoteRounds() {
  const user = who();
  if (!user) return [];
  const result = await json(user);
  return who() === user ? result.rounds : [];
}

// A portable backup can restore history, but only the recording device can
// resume an account card. Keep both copies of a protected shot set untouched.
export async function prepareLiveBackup(entries, accountRounds) {
  const user = who();
  const pending = [], protectedCards = [];
  for (const { course, id } of activeBackupRounds(entries)) {
    const guard = user && read(guardKey(user, course, id));
    const local = read(ROUND_KEY + ':' + course);
    if (guard?.frozen) protectedCards.push({ course, id });
    else {
      const startedHere = (user || !accountRounds) && local?.id === id && local.begunAt && !local.endedAt;
      if (guard?.status !== 'recording' && !startedHere) pending.push({ course, id });
    }
  }
  if (pending.length && user) {
    let rows;
    if (navigator.onLine !== false) {
      try { rows = await remoteRounds(); } catch { /* keep uncertain cards out of this restore */ }
    }
    if (user !== who()) throw Error('Kontot har ändrats. Välj säkerhetskopian igen.');
    for (const item of pending) {
      const row = rows?.find(r => r.course === item.course && r.id === item.id);
      if (!rows || (row ? row.device !== recordingDevice() || row.status !== 'recording' : accountRounds)) protectedCards.push(item);
    }
  } else if (accountRounds) protectedCards.push(...pending);
  if (!protectedCards.length) return { entries, courses: [] };

  const courses = [...new Set(protectedCards.map(card => card.course))];
  const skip = new Set(courses.flatMap(course => [ROUND_KEY, HOLE_KEY, TEE_KEY].map(prefix => prefix + ':' + course)));
  // A different round currently active on this course keeps its own shots too.
  const protectedLogs = [...protectedCards];
  for (const course of courses) {
    const local = read(ROUND_KEY + ':' + course);
    if (local?.begunAt && !local.endedAt) protectedLogs.push({ course, id: local.id });
  }
  const retained = entries.filter(([key]) => !skip.has(key)).map(([key, value]) => {
    const field = key === MAP_KEYS.shots ? 'shots' : key === MAP_KEYS.rounds ? 'rounds' : null;
    if (!field) return [key, value];
    const idKey = field === 'shots' ? 'round' : 'id';
    const protect = item => protectedLogs.some(card => card.course === item.course && card.id === item[idKey]);
    const file = JSON.parse(value), existing = read(key)?.[field] ?? [];
    const list = [...file[field].filter(item => !protect(item)), ...existing.filter(protect)];
    if (field === 'shots') list.sort((a, b) => a.at - b.at);
    return [key, JSON.stringify({ ...file, [field]: list })];
  });
  return { entries: retained, courses };
}

// Leaving the course screen can interrupt a debounced save. Reconcile the
// stored card (including an offline finish) when Home next has a connection.
export function reconcileLocalRounds(rows) {
  const user = who();
  if (!user) return;
  const device = recordingDevice();
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    .filter(key => key?.startsWith(ROUND_KEY + ':'));
  for (const key of keys) {
    const course = key.slice(ROUND_KEY.length + 1), card = read(key);
    if (!card?.id || !card.begunAt) continue;
    const remote = rows.find(r => r.course === course && r.id === card.id);
    const ownership = guardKey(user, course, card.id);
    const guard = read(ownership);
    if (remote && remote.revision >= (guard?.revision ?? 0)) {
      if (remote.status === 'offered' || remote.device !== device) {
        write(ownership, { revision: remote.revision, frozen: true, status: remote.status });
        clearLocalCard(course, card.id);
        continue;
      }
      if (!guard) write(ownership, { revision: remote.revision, frozen: false, status: remote.status });
    }
    if (guard?.frozen) continue;
    if (!remote && !card.endedAt || remote?.device === device && remote.status === 'recording' &&
        (card.endedAt || card.touchedAt > (remote.snapshot?.card.touchedAt ?? 0))) publishLive(course, card.id);
  }
  const archived = parseRounds(localStorage.getItem(MAP_KEYS.rounds));
  for (const row of rows) {
    if (row.device !== recordingDevice() || row.status !== 'recording') continue;
    if (read(ROUND_KEY + ':' + row.course)?.id === row.id) continue;
    if (archived.some(r => r.course === row.course && r.id === row.id && r.endedAt)) {
      serial(guardKey(user, row.course, row.id), () => mutate(user, row.course, row.id, 'end', null, row.revision)).catch(() => {});
    }
  }
}
function serial(key, task) {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  queues.set(key, next);
  return next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
}

async function mutate(user, course, id, action, snapshot, revision, operation = crypto.randomUUID()) {
  if (who() !== user || navigator.onLine === false) throw Error(retryMessage);
  const device = recordingDevice();
  const result = await json(user, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ course, id, device, revision, operation, action, snapshot }) });
  if (who() !== user) throw Error('Kontot har ändrats.');
  const row = result.row;
  if (row) {
    const key = guardKey(user, course, id);
    const current = read(key);
    // Responses from another tab can arrive in a different order.
    if (!current || current.revision <= row.revision) {
      const pendingOffer = action === 'save' && row.device === device && row.status === 'recording' && current?.offer;
      write(key, { revision: row.revision, frozen: Boolean(pendingOffer) || row.device !== device || row.status === 'offered',
        status: row.status, ...(pendingOffer && { offer: pendingOffer }) });
    }
  }
  if (!result.accepted) throw Error('Rundan har ändrats. Uppdatera rundan och försök igen.');
  return row;
}

const pending = new Map();
export function publishLive(course, id) {
  const user = who();
  if (!user || !id || liveFrozen(course, id, user)) return;
  const key = guardKey(user, course, id);
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => {
    pending.delete(key);
    serial(key, async () => {
      const guard = read(key), snapshot = localSnapshot(course, id);
      if (who() !== user || guard?.frozen || !snapshot) return;
      const action = snapshot.card.endedAt ? 'end' : 'save';
      if (action === 'end' && (!guard || guard.status === 'ended')) return;
      await mutate(user, course, id, action, snapshot, guard?.revision ?? 0);
      event();
    }).catch(() => {}); // The local card remains authoritative until a confirmed offer.
  }, 650));
}

export async function offerLive(course, id) {
  const user = who();
  if (!user || navigator.onLine === false) throw Error(retryMessage);
  const key = guardKey(user, course, id);
  return serial(key, async () => {
    let guard = read(key);
    const snapshot = localSnapshot(course, id);
    if (!snapshot || snapshot.card.endedAt) throw Error('Rundan är redan avslutad.');
    if (!guard) {
      await mutate(user, course, id, 'save', snapshot, 0);
      guard = read(key);
    }
    if (guard.frozen && !guard.offer) throw Error('Rundan har redan lämnats över.');
    // An unanswered request may already have committed. Keep the same token
    // and the local freeze until the server confirms its outcome.
    const operation = guard.offer || crypto.randomUUID();
    write(key, { ...guard, frozen: true, offer: operation });
    const synced = await syncNow();
    if (!synced.ok || who() !== user || getCloudState().dirty) {
      if (!guard.offer && who() === user) write(key, guard);
      throw Error(retryMessage);
    }
    const latest = localSnapshot(course, id);
    const row = await mutate(user, course, id, 'offer', latest, guard.revision, operation);
    clearLocalCard(course, id);
    event();
    return row;
  });
}

function clearLocalCard(course, id) {
  if (read(ROUND_KEY + ':' + course)?.id !== id) return;
  localStorage.removeItem(ROUND_KEY + ':' + course);
  localStorage.removeItem('banvy-map-gps-v1:' + course);
  window.dispatchEvent(new Event('banvy-sync-changed'));
}

function install(row) {
  const { course, id, snapshot: { card, shots, tee } } = row;
  const current = read(ROUND_KEY + ':' + course);
  if (current?.begunAt && !current.endedAt && current.id !== id) throw Error('Avsluta rundan som redan spelas på den här banan först.');
  const history = parseHistory(localStorage.getItem(MAP_KEYS.shots)).filter(s => s.course !== course || s.round !== id);
  // Reuse the verified all-or-nothing write used for restoring a backup.
  replaceStoredValues(localStorage, [
    [MAP_KEYS.shots, storeHistory([...history, ...shots].sort((a,b) => a.at - b.at))],
    ['banvy-map-tee-v1:' + course, tee == null ? null : String(tee)],
    [ROUND_KEY + ':' + course, JSON.stringify({ ...card, touchedAt: Date.now() })],
  ]);
  event();
}

export async function takeLive(row) {
  const user = who();
  if (!user) throw Error('Logga in för att fortsätta.');
  const current = read(ROUND_KEY + ':' + row.course);
  if (current?.id === row.id && current.endedAt) throw Error('Rundan är avslutad på den här enheten.');
  if (current?.begunAt && !current.endedAt && current.id !== row.id) throw Error('Avsluta rundan som redan spelas på den här banan först.');
  // Re-read before resuming a claim whose HTTP reply or local save was lost.
  const latest = (await remoteRounds()).find(r => r.course === row.course && r.id === row.id);
  if (!latest || who() !== user) throw Error('Rundan är inte tillgänglig för övertagande.');
  let owned = latest;
  if (latest.status === 'offered') owned = await mutate(user, row.course, row.id, 'claim', null, latest.revision);
  else if (latest.device !== recordingDevice()) throw Error('Lämna över från enheten som för rundan först.');
  else write(guardKey(user, row.course, row.id), { revision: latest.revision, frozen: false, status: 'recording' });
  install(owned);
}
