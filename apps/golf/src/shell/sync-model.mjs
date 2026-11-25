/* Offline-first sync state for Banvy's player data. Pure: no DOM or network,
   tested without a browser (sync-model.test.mjs).

   Only player record data syncs across devices:
     - completed rounds (banvy-map-rounds-v1)
     - GPS shot log     (banvy-map-shots-v1)
     - caddie bag       (banvy-caddie-bag-v1)
     - playing handicap (banvy-map-handicap-v1)

   Device preferences (3D quality, frame cap, lighting, map display toggles)
   never leave this browser.

   SYNC_META_KEY intentionally uses underscores instead of hyphens so
   settings-store.mjs exportBackup (/^banvy[-:]/) omits per-device sync state. */
import { parseRounds, storeRounds } from '../map/map-rounds.mjs';
import { parseHistory, storeHistory } from '../map/map-shots.mjs';
import { BAG_KEY, MAP_KEYS, ROUND_KEY, HOLE_KEY, readText, writeText, replaceStoredValues } from './settings-store.mjs';

export const SYNC_META_KEY = 'banvy_sync_meta_v1';
export const roundKey = (course, id) => `${course}|${id}`;

function splitRoundKey(key) {
  const sep = key.lastIndexOf('|');
  if (sep <= 0) return null;
  const course = key.slice(0, sep);
  const id = Number(key.slice(sep + 1));
  return course && Number.isSafeInteger(id) && id > 0 ? { course, id } : null;
}

const emptyMeta = () => ({
  version: 1,
  userId: null,
  lastSyncedAt: 0,
  handicapUpdatedAt: 0,
  bagUpdatedAt: 0,
  roundUpdatedAt: {},
  roundDeletedAt: {},
  shotsUpdatedAt: {},
  dirty: false,
});

export function readSyncMeta(storage) {
  let raw = null;
  try { raw = JSON.parse(readText(storage, SYNC_META_KEY, 'null')); } catch { raw = null; }
  if (!raw || raw.version !== 1) return emptyMeta();
  return {
    version: 1,
    userId: typeof raw.userId === 'string' ? raw.userId : null,
    lastSyncedAt: Number(raw.lastSyncedAt) || 0,
    handicapUpdatedAt: Number(raw.handicapUpdatedAt) || 0,
    bagUpdatedAt: Number(raw.bagUpdatedAt) || 0,
    roundUpdatedAt: raw.roundUpdatedAt && typeof raw.roundUpdatedAt === 'object' ? { ...raw.roundUpdatedAt } : {},
    roundDeletedAt: raw.roundDeletedAt && typeof raw.roundDeletedAt === 'object' ? { ...raw.roundDeletedAt } : {},
    shotsUpdatedAt: raw.shotsUpdatedAt && typeof raw.shotsUpdatedAt === 'object' ? { ...raw.shotsUpdatedAt } : {},
    dirty: Boolean(raw.dirty),
  };
}

export function writeSyncMeta(storage, meta) {
  writeText(storage, SYNC_META_KEY, JSON.stringify({ ...emptyMeta(), ...meta, version: 1 }));
}

export function markHandicapDirty(storage, at = Date.now()) {
  const meta = readSyncMeta(storage);
  meta.handicapUpdatedAt = Math.max(at, meta.handicapUpdatedAt + 1);
  meta.dirty = true;
  writeSyncMeta(storage, meta);
  return meta;
}

export function markBagDirty(storage, at = Date.now()) {
  const meta = readSyncMeta(storage);
  meta.bagUpdatedAt = Math.max(at, meta.bagUpdatedAt + 1);
  meta.dirty = true;
  writeSyncMeta(storage, meta);
  return meta;
}

export function markRoundDirty(storage, course, id, at = Date.now()) {
  if (!course || !Number.isSafeInteger(Number(id))) return readSyncMeta(storage);
  const key = roundKey(course, Number(id));
  const meta = readSyncMeta(storage);
  const prev = Math.max(meta.roundUpdatedAt[key] || 0, meta.roundDeletedAt[key] || 0);
  meta.roundUpdatedAt[key] = Math.max(at, prev + 1);
  delete meta.roundDeletedAt[key];
  meta.dirty = true;
  writeSyncMeta(storage, meta);
  return meta;
}

export function markRoundDeleted(storage, course, id, at = Date.now()) {
  if (!course || !Number.isSafeInteger(Number(id))) return readSyncMeta(storage);
  const key = roundKey(course, Number(id));
  const meta = readSyncMeta(storage);
  const prev = Math.max(meta.roundUpdatedAt[key] || 0, meta.roundDeletedAt[key] || 0, meta.shotsUpdatedAt[key] || 0);
  const stamp = Math.max(at, prev + 1);
  meta.roundDeletedAt[key] = stamp;
  delete meta.roundUpdatedAt[key];
  meta.shotsUpdatedAt[key] = stamp;
  meta.dirty = true;
  writeSyncMeta(storage, meta);
  return meta;
}

export function markShotsDirty(storage, course, id, at = Date.now()) {
  if (!course || !Number.isSafeInteger(Number(id))) return readSyncMeta(storage);
  const key = roundKey(course, Number(id));
  const meta = readSyncMeta(storage);
  const prev = meta.shotsUpdatedAt[key] || 0;
  meta.shotsUpdatedAt[key] = Math.max(at, prev + 1);
  meta.dirty = true;
  writeSyncMeta(storage, meta);
  return meta;
}

/* After a manual JSON backup restore, bump timestamps on restored player data
   so the next sync uploads it to the signed-in account. */
function restoredMeta(storage, at, keys, previous) {
  const meta = readSyncMeta(storage);
  const restored = key => !keys || keys.includes(key);
  const hasBefore = key => Object.hasOwn(previous, key);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const [field, key] of [['handicap', MAP_KEYS.handicap], ['bag', BAG_KEY]]) {
    if (!restored(key) || readText(storage, key, null) === (hasBefore(key) ? previous[key] : null)) continue;
    const stamp = field + 'UpdatedAt';
    meta[stamp] = Math.max(at, meta[stamp] + 1);
    meta.dirty = true;
  }
  if (restored(MAP_KEYS.rounds)) {
    const before = new Map(parseRounds(previous[MAP_KEYS.rounds]).map(record => [roundKey(record.course, record.id), record]));
    const after = new Map(parseRounds(readText(storage, MAP_KEYS.rounds, null)).map(record => [roundKey(record.course, record.id), record]));
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      if (same(before.get(key), after.get(key))) continue;
      const stamp = Math.max(at, (meta.roundUpdatedAt[key] || 0) + 1, (meta.roundDeletedAt[key] || 0) + 1, (meta.shotsUpdatedAt[key] || 0) + 1);
      if (after.has(key)) {
        meta.roundUpdatedAt[key] = stamp;
        delete meta.roundDeletedAt[key];
      } else {
        meta.roundDeletedAt[key] = stamp;
        delete meta.roundUpdatedAt[key];
      }
      meta.dirty = true;
    }
  }
  if (restored(MAP_KEYS.shots)) {
    const group = text => {
      const sets = new Map();
      for (const shot of parseHistory(text)) {
        if (!shot?.course || !shot.round) continue;
        const key = roundKey(shot.course, shot.round);
        if (!sets.has(key)) sets.set(key, []);
        sets.get(key).push(shot);
      }
      return sets;
    };
    const before = group(previous[MAP_KEYS.shots]), after = group(readText(storage, MAP_KEYS.shots, null));
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      if (same(before.get(key), after.get(key))) continue;
      meta.shotsUpdatedAt[key] = Math.max(at, (meta.shotsUpdatedAt[key] || 0) + 1, meta.roundDeletedAt[key] || 0);
      meta.dirty = true;
    }
  }
  return meta;
}

export function restoredSyncEntries(storage, changes, previous, at = Date.now()) {
  const overlay = { getItem: key => changes.has(key) ? changes.get(key) : storage.getItem(key) };
  const next = restoredMeta(overlay, at, [...changes.keys()], previous);
  return JSON.stringify(next) === JSON.stringify(readSyncMeta(storage)) ? [] : [[SYNC_META_KEY, JSON.stringify(next)]];
}

export function markRestoredDataDirty(storage, at = Date.now(), keys = null, previous = {}) {
  const next = restoredMeta(storage, at, keys, previous);
  writeSyncMeta(storage, next);
  return next;
}

const personalKeys = new Set([MAP_KEYS.rounds, MAP_KEYS.shots, MAP_KEYS.handicap, BAG_KEY, SYNC_META_KEY, 'banvy-map-diary-v1', 'banvy-play-rounds-v1']);
const personalPrefixes = [`${ROUND_KEY}:`, `${HOLE_KEY}:`, 'banvy-map-gps-v1:', 'banvy-live-owner-v1:', 'banvy-play-checkpoint-v1:', 'banvy_sim_pending_v1:'];
const isPersonalKey = key => personalKeys.has(key) || personalPrefixes.some(prefix => key?.startsWith(prefix));
const accountCacheKey = userId => 'banvy_sync_cache_v1:' + (userId ? 'user:' + encodeURIComponent(userId) : 'guest');

function playerEntries(storage) {
  const entries = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (isPersonalKey(key)) entries.push([key, storage.getItem(key)]);
  }
  return entries;
}

export function clearUserSyncedData(storage) {
  replaceStoredValues(storage, playerEntries(storage).map(([key]) => [key, null]));
}

/* Keep each previous player's unsent work for their return to this browser.
   Anonymous data joins a first sign-in. A returning account restores its own
   cache and leaves separately played guest rounds available after sign-out. */
export function selectSyncUser(storage, userId, previousUserId = readSyncMeta(storage).userId, identityKey = null, user = null) {
  if (!storage) throw new Error('Webbläsarens lagring är inte tillgänglig.');
  const changes = new Map();
  if (identityKey) changes.set(identityKey, user ? JSON.stringify(user) : null);
  if (previousUserId === userId) {
    const meta = readSyncMeta(storage);
    if (meta.userId !== userId) changes.set(SYNC_META_KEY, JSON.stringify({ ...meta, userId }));
    replaceStoredValues(storage, changes);
    return false;
  }
  const outgoing = playerEntries(storage);
  const target = storage.getItem(accountCacheKey(userId));
  const adoptGuest = !previousUserId && userId && target === null;
  let meta = readSyncMeta(storage);
  if (!adoptGuest) {
    for (const [key] of outgoing) changes.set(key, null);
    // The recording guard travels with its own card, so a lost transfer
    // acknowledgement cannot unfreeze an already offered round on re-login.
    if (outgoing.length) changes.set(accountCacheKey(previousUserId), JSON.stringify(outgoing));
    if (target !== null) {
      const incoming = JSON.parse(target);
      if (!Array.isArray(incoming) || incoming.some(entry => !Array.isArray(entry) || !isPersonalKey(entry[0]) || typeof entry[1] !== 'string')) {
        throw new Error('Spelarens lokala kopia kunde inte läsas.');
      }
      for (const [key, value] of incoming) changes.set(key, value);
      changes.set(accountCacheKey(userId), null);
    }
    meta = changes.get(SYNC_META_KEY) ? JSON.parse(changes.get(SYNC_META_KEY)) : emptyMeta();
  }
  changes.set(SYNC_META_KEY, JSON.stringify({ ...meta, userId }));
  replaceStoredValues(storage, changes);
  return !adoptGuest;
}

export function writePlayerProfile(storage, field, value, at = Date.now(), writeValue = null) {
  if (field !== 'handicap' && field !== 'bag') throw new Error('Okänt spelarval.');
  const key = field === 'handicap' ? MAP_KEYS.handicap : BAG_KEY;
  const text = value === null ? null : field === 'bag' ? JSON.stringify({ version: 3, clubs: value }) : String(value);
  if (storage && storage.getItem(key) === text) return false;
  const meta = readSyncMeta(storage);
  const stamp = field + 'UpdatedAt';
  meta[stamp] = Math.max(at, meta[stamp] + 1);
  meta.dirty = true;
  // The detailed viewer already has a synchronous writer which updates its
  // scene and its raw bag together. Verify that write inside the same rollback
  // boundary as the revision; direct storage handles any rollback.
  const destination = writeValue ? {
    getItem: name => storage.getItem(name),
    removeItem: name => storage.removeItem(name),
    setItem(name, next) {
      if (name === key && next === text) writeValue(value);
      else storage.setItem(name, next);
    },
  } : storage;
  replaceStoredValues(destination, [[key, text], [SYNC_META_KEY, JSON.stringify(meta)]]);
  return true;
}

function readRawBag(storage) {
  const text = readText(storage, BAG_KEY, null);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && Array.isArray(parsed.clubs) && parsed.clubs.length) return parsed;
  } catch { /* ignore damaged bag */ }
  return null;
}

function readRawHandicap(storage) {
  const text = readText(storage, MAP_KEYS.handicap, null);
  if (text === null || text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* Assemble the client payload for POST /api/sync.
   Legacy local data created before cloud sync existed gets timestamp 1 (or
   record.endedAt for rounds) so it uploads cleanly to a fresh account without
   overwriting newer edits made on another device. */
export function buildSyncPayload(storage) {
  const meta = readSyncMeta(storage);
  const handicap = readRawHandicap(storage);
  const bag = readRawBag(storage);

  const profile = {
    handicap,
    handicapUpdatedAt: meta.handicapUpdatedAt || (handicap !== null ? 1 : 0),
    bag,
    bagUpdatedAt: meta.bagUpdatedAt || (bag !== null ? 1 : 0),
  };

  const localRounds = parseRounds(readText(storage, MAP_KEYS.rounds, null));
  const activeRoundKeys = new Set();
  const rounds = [];

  for (const record of localRounds) {
    if (!record?.course || !Number.isSafeInteger(Number(record.id))) continue;
    const id = Number(record.id);
    const key = roundKey(record.course, id);
    activeRoundKeys.add(key);
    rounds.push({
      course: record.course,
      id,
      updatedAt: meta.roundUpdatedAt[key] || Number(record.endedAt) || 1,
      deletedAt: null,
      record,
    });
  }

  for (const [key, deletedAt] of Object.entries(meta.roundDeletedAt)) {
    if (activeRoundKeys.has(key) || !deletedAt) continue;
    const parts = splitRoundKey(key);
    if (!parts) continue;
    rounds.push({
      course: parts.course,
      id: parts.id,
      updatedAt: Number(deletedAt),
      deletedAt: Number(deletedAt),
      record: null,
    });
  }

  const localShots = parseHistory(readText(storage, MAP_KEYS.shots, null));
  const shotsByKey = new Map();
  for (const shot of localShots) {
    if (!shot?.course || !Number.isSafeInteger(Number(shot.round))) continue;
    const key = roundKey(shot.course, Number(shot.round));
    if (!shotsByKey.has(key)) shotsByKey.set(key, []);
    shotsByKey.get(key).push(shot);
  }

  const shotSetKeys = new Set([
    ...shotsByKey.keys(),
    ...Object.keys(meta.shotsUpdatedAt),
    ...Object.keys(meta.roundDeletedAt),
  ]);
  const shotSets = [];

  for (const key of shotSetKeys) {
    const parts = splitRoundKey(key);
    if (!parts) continue;
    const deletedAt = Number(meta.roundDeletedAt[key]) || 0;
    const list = shotsByKey.get(key) || [];
    const latestShotAt = list.reduce((max, s) => Math.max(max, Number(s.at) || 0), 0);
    const updatedAt = Number(meta.shotsUpdatedAt[key]) || latestShotAt || 1;
    if (deletedAt && deletedAt >= updatedAt && !list.length) {
      shotSets.push({
        course: parts.course,
        roundId: parts.id,
        updatedAt: deletedAt,
        deletedAt,
        shots: [],
      });
    } else {
      shotSets.push({
        course: parts.course,
        roundId: parts.id,
        updatedAt,
        deletedAt: null,
        shots: list,
      });
    }
  }

  return { profile, rounds, shotSets };
}

const revision = entry => Math.max(entry?.updatedAt || 0, entry?.deletedAt || 0);

/* A reply acknowledges the request snapshot. A shot logged during its trip
   stays on the phone and is sent next, even if another device advanced the
   remote clock while the request was in flight. Unrelated remote edits apply. */
function reconcileReply(response, sent, current, dirty) {
  let pending = false;
  const profile = { ...response.profile };
  for (const field of ['handicap', 'bag']) {
    const stamp = field + 'UpdatedAt';
    if (current.profile[stamp] <= sent.profile[stamp]) continue;
    // A different tab may already have applied a newer canonical response.
    if (!dirty && current.profile[stamp] <= profile[stamp]) continue;
    if (current.profile[stamp] === profile[stamp] && JSON.stringify(current.profile[field]) === JSON.stringify(profile[field])) continue;
    profile[field] = current.profile[field];
    profile[stamp] = dirty ? Math.max(current.profile[stamp], (profile[stamp] || 0) + 1) : current.profile[stamp];
    pending ||= dirty;
  }
  function entries(type, id) {
    const key = item => roundKey(item.course, item[id]);
    const base = new Map(sent[type].map(item => [key(item), item]));
    const next = new Map(response[type].map(item => [key(item), item]));
    for (const item of current[type]) {
      const k = key(item), remote = next.get(k);
      if (revision(item) <= revision(base.get(k))) continue;
      if (!dirty && revision(item) <= revision(remote)) continue;
      if (JSON.stringify(item) === JSON.stringify(remote)) continue;
      const updatedAt = dirty ? Math.max(revision(item), revision(remote) + 1) : revision(item);
      next.set(k, { ...item, updatedAt, deletedAt: item.deletedAt ? updatedAt : null });
      pending ||= dirty;
    }
    return [...next.values()];
  }
  const rounds = entries('rounds', 'id');
  const shotSets = entries('shotSets', 'roundId');
  return { profile, rounds, shotSets, pending };
}

export function applySyncResponse(storage, response, userId, sent = null) {
  if (!response?.profile || !Array.isArray(response.rounds) || !Array.isArray(response.shotSets)) {
    throw new Error('Kunde inte läsa kontots synksvar.');
  }
  const { profile, rounds, shotSets, pending = false } = sent ? reconcileReply(response, sent, buildSyncPayload(storage), readSyncMeta(storage).dirty) : response;
  const nextMeta = {
    ...emptyMeta(), userId, lastSyncedAt: Number(response.syncedAt) || Date.now(),
    handicapUpdatedAt: Number(profile.handicapUpdatedAt) || 0, bagUpdatedAt: Number(profile.bagUpdatedAt) || 0,
    dirty: pending,
  };
  const changes = new Map();
  if (nextMeta.handicapUpdatedAt) changes.set(MAP_KEYS.handicap, profile.handicap == null ? null : String(profile.handicap));
  if (nextMeta.bagUpdatedAt) changes.set(BAG_KEY, profile.bag ? JSON.stringify({ version: profile.bag.version ?? 3, clubs: profile.bag.clubs }) : null);

  const activeRounds = [];
  for (const r of rounds) {
    const key = roundKey(r.course, r.id);
    if (r.deletedAt) nextMeta.roundDeletedAt[key] = Number(r.deletedAt);
    else if (r.record) {
      activeRounds.push(r.record);
      nextMeta.roundUpdatedAt[key] = Number(r.updatedAt) || Number(r.record.endedAt) || 1;
    }
  }
  activeRounds.sort((a, b) => (a.endedAt ?? a.id) - (b.endedAt ?? b.id));
  const flatShots = [];
  for (const set of shotSets) {
    nextMeta.shotsUpdatedAt[roundKey(set.course, set.roundId)] = Number(set.updatedAt) || 1;
    if (!set.deletedAt && Array.isArray(set.shots)) flatShots.push(...set.shots);
  }
  flatShots.sort((a, b) => a.at - b.at);
  if (activeRounds.length || storage.getItem(MAP_KEYS.rounds) !== null) changes.set(MAP_KEYS.rounds, storeRounds(activeRounds));
  if (flatShots.length || storage.getItem(MAP_KEYS.shots) !== null) changes.set(MAP_KEYS.shots, storeHistory(flatShots));
  const changed = [...changes].some(([key, value]) => storage.getItem(key) !== value);
  changes.set(SYNC_META_KEY, JSON.stringify(nextMeta));
  replaceStoredValues(storage, changes);
  return { changed, dirty: pending, rounds: activeRounds.length, shots: flatShots.length };
}
