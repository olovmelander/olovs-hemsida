import { finishPlayRound, getPlayStorage, PLAY_KEYS, readPlayCheckpoint, readPlayedRounds, savePlayedRound, writePlayCheckpoint } from './play-rules.mjs';
import { fencedPlayWrite } from './play-write-fence.mjs';

// All layouts share the history key. The lock must cover both the revision check
// and the writes to history and checkpoint, including partial hole results.
export const PLAY_WRITE_LOCK = 'banvy-simulator-write-v1';
const PENDING = 'banvy_sim_pending_v1:';
const MAX_PENDING_AGE = 30 * 24 * 60 * 60 * 1000;
const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

async function underLock(lockManager, storage, action) {
  try {
    const locks = lockManager();
    // Older/insecure browsers retain the existing synchronous revision-checked save.
    if (!locks?.request) return action();
    return await locks.request(PLAY_WRITE_LOCK, () => fencedPlayWrite(storage(), action));
  } catch { return 'unavailable'; }
}
const browserLocks = () => globalThis.navigator?.locks;

function writePosition(store, entry, base) {
  // A reload can have recovered this very write while its old page was frozen.
  const current = readPlayCheckpoint(store, entry.round.slug);
  if (current?.revision !== entry.nextRevision) {
    const result = writePlayCheckpoint(store, entry.round, entry.position, base, entry.nextRevision);
    if (result.error) return result.error;
  }
  return 'saved';
}

export function createPlayPersistence({ revision = null, ownsAccount = () => true, storage = getPlayStorage,
  lockManager = browserLocks } = {}) {
  const key = PENDING + id();
  let pending = null, journaled = false;
  function preservePending() {
    if (!pending || !ownsAccount()) return;
    try {
      storage().setItem(key, JSON.stringify({ version: 1, ...pending, revision, at: Date.now() }));
      journaled = true;
    } catch { /* A blocked or full store still gets a normal save retry. */ }
  }
  function clearJournal(store) {
    if (!journaled) return;
    try { store.removeItem(key); journaled = false; } catch { /* an already committed revision is safe to replay */ }
  }
  function submit(round, position, publish, finish) {
    // The animation advances immediately after a settled shot. A delayed lock
    // must save that lie with its own stroke count and hole.
    const entry = { round: structuredClone(round), position: structuredClone(position), nextRevision: id(), publish };
    pending = entry;
    return underLock(lockManager, storage, () => {
      if (!ownsAccount()) return 'account';
      const store = storage();
      if (finish && revision && readPlayedRounds(store).some(saved => saved.id === entry.round.id
          && saved.slug === entry.round.slug && saved.endedAt != null && saved.finishRevision === revision)) {
        if (pending === entry) pending = null;
        clearJournal(store);
        return finishPlayRound(store, entry.round, revision);
      }
      let result = writePosition(store, entry, revision);
      if (result === 'saved') {
        revision = entry.nextRevision;
        if (publish && !savePlayedRound(store, entry.round)) result = 'unavailable';
        if (finish) result = finishPlayRound(store, entry.round, revision);
      }
      // Keep the resumable checkpoint even when the separate history write failed.
      if (pending === entry && result !== 'unavailable') pending = null;
      if (journaled) {
        if (pending) preservePending();
        else clearJournal(store);
      }
      return result;
    });
  }
  return {
    save: (round, position, { publish = false } = {}) => submit(round, position, publish, false),
    finish: (round, position) => submit(round, position, false, true),
    preservePending,
  };
}

// pagehide cannot wait for an asynchronous lock. Only an interrupted document
// leaves a private recovery record. A newer writer always wins over that record.
export async function recoverPlayWrites(slug = null, { storage = getPlayStorage, lockManager = browserLocks,
  ownsAccount = () => true } = {}) {
  try {
    const store = storage(), keys = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(PENDING)) keys.push(key);
    }
    if (!keys.length) return;
    return await underLock(lockManager, storage, () => {
      if (!ownsAccount()) return 'account';
      for (const key of keys) {
        const raw = store.getItem(key);
        if (!raw) continue;
        let entry;
        try { entry = JSON.parse(raw); } catch { /* discard damaged recovery data */ }
        const course = entry?.round?.slug;
        if (typeof course !== 'string' || !Number.isFinite(entry.at) || Date.now() - entry.at > MAX_PENDING_AGE
            || typeof entry.nextRevision !== 'string' || !(entry.revision === null || typeof entry.revision === 'string')
            || !readPlayCheckpoint({ getItem: name => name === PLAY_KEYS.checkpoint + course ? raw : null }, course)) {
          store.removeItem(key);
          continue;
        }
        if (slug && slug !== course) continue;
        const result = writePosition(store, entry, entry.revision);
        if (result === 'unavailable') continue;
        if (result === 'saved' && entry.publish && !savePlayedRound(store, entry.round)) continue;
        // A freezing tab may replace its own record. Only remove the one we read.
        if (store.getItem(key) === raw) store.removeItem(key);
      }
    });
  } catch { /* The player can still open and offer retry when storage is unavailable. */ }
}
