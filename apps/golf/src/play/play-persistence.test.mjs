import { describe, it, expect } from 'vitest';
import { createPlayPersistence, PLAY_WRITE_LOCK, recoverPlayWrites } from './play-persistence.mjs';
import { createRound, holeCard, PLAY_KEYS, readPlayedRounds, readPlayCheckpoint } from './play-rules.mjs';
import { fencedPlayWrite } from './play-write-fence.mjs';

function memory() {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
function deferredLock() {
  const requests = [];
  return {
    request: (name, callback) => {
      expect(name).toBe(PLAY_WRITE_LOCK);
      return new Promise(resolve => requests.push(() => resolve(callback())));
    },
    release: () => requests.shift()(),
  };
}
const ready = { phase: 'address', ball: [4, 8] };
function newRound(slug = 'castle') {
  const round = createRound({ slug, holes: [{ n: 1, par: 4 }], now: 23 });
  holeCard(round, 1);
  return round;
}

describe('serialized Simulator storage', () => {
  it('writes the originally submitted lie and score, and compares the competing revision inside the lock', async () => {
    const store = memory(), gate = deferredLock();
    const options = { storage: () => store, lockManager: () => gate };
    const first = createPlayPersistence(options), second = createPlayPersistence(options);
    const round = newRound(), point = { phase: 'address', ball: [2, 3] };
    const save = first.save(round, point);
    round.holes[1].strokes = 8; point.ball[0] = 20;
    const other = second.finish(round, point);
    expect(store.length).toBe(0);
    gate.release(); expect(await save).toBe('saved');
    gate.release(); expect(await other).toBe('conflict');
    expect(readPlayCheckpoint(store, round.slug)).toMatchObject({ position: { ball: [2, 3] },
      savedAt: expect.any(Number), round: { holes: { 1: { strokes: 0 } } } });
    expect(readPlayedRounds(store)).toEqual([]);
  });

  it('recovers a settled shot after pagehide before lock delivery, suppressing duplicate replay and stale overwrite', async () => {
    const store = memory(), gate = deferredLock(), storage = () => store;
    const original = createPlayPersistence({ storage, lockManager: () => gate });
    const round = newRound();
    round.holes[1].strokes = 2;
    const save = original.save(round, ready, { publish: true });
    original.preservePending();
    expect(store.length).toBe(1);
    const privateKey = store.key(0), interrupted = store.getItem(privateKey);
    await recoverPlayWrites('castle', { storage, lockManager: () => null });
    const saved = readPlayCheckpoint(store, 'castle');
    expect(saved.round.holes[1].strokes).toBe(2);
    expect(store.getItem(privateKey)).toBeNull();
    gate.release(); expect(await save).toBe('saved');
    expect(readPlayCheckpoint(store, 'castle').revision).toBe(saved.revision);
    expect(readPlayedRounds(store)).toHaveLength(1);
    const live = createPlayPersistence({ storage, revision: saved.revision, lockManager: () => null });
    round.holes[1].strokes++;
    expect(await live.save(round, { phase: 'address', ball: [30, 40] })).toBe('saved');
    store.setItem(privateKey, interrupted);
    await recoverPlayWrites('castle', { storage, lockManager: () => null });
    expect(readPlayCheckpoint(store, 'castle').position.ball).toEqual([30, 40]);
    expect(store.getItem(privateKey)).toBeNull();
  });

  it('checks account ownership when the lock arrives, keeps unavailable finishes recoverable, and retries', async () => {
    const store = memory(), gate = deferredLock();
    let owner = true;
    const session = createPlayPersistence({ storage: () => store, lockManager: () => gate, ownsAccount: () => owner });
    const round = newRound(), first = session.save(round, ready);
    owner = false; session.preservePending(); gate.release();
    expect(await first).toBe('account');
    expect(store.length).toBe(0);
    const write = store.setItem;
    store.setItem = (key, value) => { if (key === PLAY_KEYS.rounds) throw Error('full'); write(key, value); };
    const retry = createPlayPersistence({ storage: () => store, lockManager: () => null });
    expect(await retry.finish(round, ready)).toBe('unavailable');
    expect(readPlayCheckpoint(store, 'castle').position).toEqual(ready);
    store.setItem = write;
    expect(await retry.finish(round, ready)).toBe('finished');
    expect(readPlayCheckpoint(store, 'castle')).toBeNull();
    expect(readPlayedRounds(store)).toHaveLength(1);
  });

  it('recognizes an archived finish after an interrupted IDB acknowledgement and can write again', async () => {
    const store = memory(), round = newRound();
    let last, failAck = true;
    const records = async record => {
      if (!record) return last;
      if (!record.pending && failAck) { failAck = false; throw Error('IDB transaction aborted'); }
      last = record;
    };
    const session = createPlayPersistence({ storage: () => store, lockManager: () => null });
    await expect(fencedPlayWrite(store, () => session.finish(round, ready), records)).rejects.toThrow('aborted');
    const committed = readPlayedRounds(store);
    expect(committed).toHaveLength(1);
    expect(last.pending).toBeTypeOf('string');
    expect(await fencedPlayWrite(store, () => session.finish(round, ready), records)).toBe('finished');
    expect(readPlayedRounds(store)).toEqual(committed);
    expect(last.pending).toBeUndefined();
    expect(await fencedPlayWrite(store, () => 'next writer', records)).toBe('next writer');
  });

  it('applies recovery only in its player cache and removes damaged or expired pending writes', async () => {
    let store = memory();
    const user = store, guest = memory(), gate = deferredLock();
    const options = { storage: () => store, lockManager: () => null };
    const writer = createPlayPersistence({ ...options, lockManager: () => gate });
    writer.save(newRound(), ready);
    writer.preservePending();
    const key = user.key(0), valid = JSON.parse(user.getItem(key));
    store = guest;
    await recoverPlayWrites('castle', options);
    expect(guest.length).toBe(0);
    store = user;
    user.setItem(key + '-damaged', 'malformed');
    user.setItem(key + '-expired', JSON.stringify({ ...valid, at: Date.now() - 31 * 86400000 }));
    await recoverPlayWrites('castle', options);
    expect(user.length).toBe(1);
    expect(readPlayCheckpoint(user, 'castle').position).toEqual(ready);
  });
});
