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
import { BAG_KEY, MAP_KEYS, readText, writeText } from './settings-store.mjs';

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
export function markRestoredDataDirty(storage, at = Date.now()) {
  const meta = readSyncMeta(storage);
  if (readText(storage, MAP_KEYS.handicap, null) !== null) {
    meta.handicapUpdatedAt = Math.max(at, meta.handicapUpdatedAt + 1);
  }
  if (readText(storage, BAG_KEY, null) !== null) {
    meta.bagUpdatedAt = Math.max(at, meta.bagUpdatedAt + 1);
  }
  for (const record of parseRounds(readText(storage, MAP_KEYS.rounds, null))) {
    const key = roundKey(record.course, record.id);
    meta.roundUpdatedAt[key] = Math.max(at, (meta.roundUpdatedAt[key] || 0) + 1);
    delete meta.roundDeletedAt[key];
  }
  const seenSets = new Set();
  for (const shot of parseHistory(readText(storage, MAP_KEYS.shots, null))) {
    if (!shot?.course || !shot?.round) continue;
    const key = roundKey(shot.course, shot.round);
    if (seenSets.has(key)) continue;
    seenSets.add(key);
    meta.shotsUpdatedAt[key] = Math.max(at, (meta.shotsUpdatedAt[key] || 0) + 1);
  }
  meta.dirty = true;
  writeSyncMeta(storage, meta);
  return meta;
}

/* Clears only the synced player record (never graphics/display settings).
   Used when switching to a different Google account on the same browser so the
   previous player's rounds never merge into the new account. */
export function clearUserSyncedData(storage) {
  writeText(storage, MAP_KEYS.rounds, null);
  writeText(storage, MAP_KEYS.shots, null);
  writeText(storage, MAP_KEYS.handicap, null);
  writeText(storage, BAG_KEY, null);
  writeSyncMeta(storage, emptyMeta());
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

/* Write the server's canonical merged state back into localStorage. */
export function applySyncResponse(storage, response, userId) {
  if (!response || typeof response !== 'object') return { changed: false, rounds: 0, shots: 0 };
  const prevRoundsText = readText(storage, MAP_KEYS.rounds, null);
  const prevShotsText = readText(storage, MAP_KEYS.shots, null);
  const prevHcpText = readText(storage, MAP_KEYS.handicap, null);
  const prevBagText = readText(storage, BAG_KEY, null);

  const profile = response.profile || {};
  if (Number(profile.handicapUpdatedAt) > 0) {
    if (profile.handicap === null || profile.handicap === undefined) {
      writeText(storage, MAP_KEYS.handicap, null);
    } else {
      writeText(storage, MAP_KEYS.handicap, String(profile.handicap));
    }
  }
  if (Number(profile.bagUpdatedAt) > 0 && profile.bag && Array.isArray(profile.bag.clubs)) {
    writeText(storage, BAG_KEY, JSON.stringify({ version: profile.bag.version ?? 3, clubs: profile.bag.clubs }));
  }

  const nextMeta = {
    version: 1,
    userId: userId ?? readSyncMeta(storage).userId,
    lastSyncedAt: Number(response.syncedAt) || Date.now(),
    handicapUpdatedAt: Number(profile.handicapUpdatedAt) || 0,
    bagUpdatedAt: Number(profile.bagUpdatedAt) || 0,
    roundUpdatedAt: {},
    roundDeletedAt: {},
    shotsUpdatedAt: {},
    dirty: false,
  };

  const activeRounds = [];
  for (const r of response.rounds || []) {
    const key = roundKey(r.course, r.id);
    if (r.deletedAt) {
      nextMeta.roundDeletedAt[key] = Number(r.deletedAt);
    } else if (r.record) {
      activeRounds.push(r.record);
      nextMeta.roundUpdatedAt[key] = Number(r.updatedAt) || Number(r.record.endedAt) || 1;
    }
  }

  const flatShots = [];
  for (const s of response.shotSets || []) {
    const key = roundKey(s.course, s.roundId);
    nextMeta.shotsUpdatedAt[key] = Number(s.updatedAt) || 1;
    if (!s.deletedAt && Array.isArray(s.shots)) {
      for (const shot of s.shots) flatShots.push(shot);
    }
  }

  const nextRoundsText = storeRounds(activeRounds);
  const nextShotsText = storeHistory(flatShots);

  if (activeRounds.length || prevRoundsText !== null) {
    writeText(storage, MAP_KEYS.rounds, nextRoundsText);
  }
  if (flatShots.length || prevShotsText !== null) {
    writeText(storage, MAP_KEYS.shots, nextShotsText);
  }

  writeSyncMeta(storage, nextMeta);

  const changed =
    readText(storage, MAP_KEYS.rounds, null) !== prevRoundsText ||
    readText(storage, MAP_KEYS.shots, null) !== prevShotsText ||
    readText(storage, MAP_KEYS.handicap, null) !== prevHcpText ||
    readText(storage, BAG_KEY, null) !== prevBagText;

  return { changed, rounds: activeRounds.length, shots: flatShots.length };
}
