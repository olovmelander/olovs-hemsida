import { describe, expect, it } from 'vitest';
import { storeRounds, parseRounds } from '../map/map-rounds.mjs';
import { storeHistory, parseHistory } from '../map/map-shots.mjs';
import { BAG_KEY, MAP_KEYS, SETTINGS_KEY, exportBackup, readBackup, restoreBackup } from './settings-store.mjs';
import {
  SYNC_META_KEY,
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
  roundKey,
  restoredSyncEntries,
  selectSyncUser,
  writePlayerProfile,
} from './sync-model.mjs';
import { mergeSyncState, validateSyncPayload } from '../../../worker/src/sync-logic.mjs';

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    data,
  };
}

const sampleRound = (course, id, strokes = 82, endedAt = 1700000000000) => ({
  id,
  course,
  courseName: course === 'visby' ? 'Visby GK' : 'Veckefjärdens GC',
  date: '2026-06-15',
  endedAt,
  tee: '58',
  handicap: 14,
  holeCount: 18,
  pars: Array(18).fill(4),
  holes: [{ n: 1, par: 4, strokes: 4, putts: 2, fairway: 'hit', picked: false }],
  totals: { played: 1, strokes, par: 72, toPar: strokes - 72, putts: 32, points: 36, fairways: 8, fairwaysTried: 14, greens: 9, greensTried: 18 },
});

const sampleShot = (course, round, hole = 1, at = 1700000001000) => ({
  course, round, hole, club: 'driver', at,
  from: [0, 0], fromAccuracy: 5, fromLie: 'tee',
  to: [210, 0], toAccuracy: 5, toLie: 'fairway',
  outcome: 'played', penalty: 0, rise: 0, suspect: false,
});

const sampleBag = (carry = 215) => ({
  version: 3,
  clubs: [
    { id: 'driver', name: 'Driver', carry },
    { id: 'putter', name: 'Putter', carry: 0 },
  ],
});

const toHttp = step => ({ syncedAt: step.syncedAt, ...step.merged });

describe('sync-model + server merge end-to-end', () => {
  it('excludes per-device sync metadata from manual JSON backups', () => {
    const st = memory({
      [SETTINGS_KEY]: JSON.stringify({ quality: 'hi' }),
      [MAP_KEYS.handicap]: '12',
    });
    markHandicapDirty(st, 1700000000000);
    const backup = exportBackup(st);
    expect(backup.data[SYNC_META_KEY]).toBeUndefined();
    expect(backup.data[MAP_KEYS.handicap]).toBe('12');
  });

  it('merges rounds, shots, bag, and handicap across two devices without touching device settings', () => {
    // Device A (phone): played round 1 on Visby, set handicap 14, custom bag, low 3D graphics
    const aim = { mode: 'auto', origin: [0, 0], target: [205, 5], distance: Math.hypot(205, 5), playsLike: 202, recommendedClub: 'driver', selectedClub: 'driver' };
    const phone = memory({
      [SETTINGS_KEY]: JSON.stringify({ quality: 'lo' }),
      [MAP_KEYS.handicap]: '14',
      [BAG_KEY]: JSON.stringify(sampleBag(220)),
      [MAP_KEYS.rounds]: storeRounds([sampleRound('visby', 1001, 80, 1700000010000)]),
      [MAP_KEYS.shots]: storeHistory([{ ...sampleShot('visby', 1001, 1, 1700000010500), aim }]),
    });

    // Phone signs in for the first time (legacy un-timestamped data gets uploaded to empty cloud)
    const phonePayload = validateSyncPayload(buildSyncPayload(phone));
    expect(phonePayload.ok).toBe(true);
    let server = { profile: { handicap: null, handicapUpdatedAt: 0, bag: null, bagUpdatedAt: 0 }, rounds: [], shotSets: [] };
    const step1 = mergeSyncState(server, phonePayload.payload, 1700000020000);
    server = step1.merged;
    applySyncResponse(phone, toHttp(step1), 'user-1');

    expect(server.profile.handicap).toBe(14);
    expect(server.profile.bag.clubs[0].carry).toBe(220);
    expect(server.rounds).toHaveLength(1);
    expect(server.shotSets[0].shots).toHaveLength(1);

    // Device B (laptop): high 3D graphics, brand-new round 2 on Veckefjärden, older unedited handicap 18
    const laptop = memory({
      [SETTINGS_KEY]: JSON.stringify({ quality: 'hi' }),
      [MAP_KEYS.handicap]: '18',
      [MAP_KEYS.rounds]: storeRounds([sampleRound('veckefjarden', 2002, 78, 1700000050000)]),
      [MAP_KEYS.shots]: storeHistory([sampleShot('veckefjarden', 2002, 1, 1700000050500)]),
    });
    markHandicapDirty(phone, 1700000030000);
    const step1b = mergeSyncState(server, validateSyncPayload(buildSyncPayload(phone)).payload, 1700000035000);
    server = step1b.merged;

    const laptopPayload = validateSyncPayload(buildSyncPayload(laptop));
    const step2 = mergeSyncState(server, laptopPayload.payload, 1700000060000);
    server = step2.merged;
    const applied = applySyncResponse(laptop, toHttp(step2), 'user-1');

    expect(applied.changed).toBe(true);
    // Laptop keeps its own high graphics setting, receives phone's newer handicap & bag + both rounds!
    expect(JSON.parse(laptop.getItem(SETTINGS_KEY))).toEqual({ quality: 'hi' });
    expect(laptop.getItem(MAP_KEYS.handicap)).toBe('14');
    expect(JSON.parse(laptop.getItem(BAG_KEY)).clubs[0].carry).toBe(220);
    expect(parseRounds(laptop.getItem(MAP_KEYS.rounds)).map(r => r.id)).toEqual([1001, 2002]);
    expect(parseHistory(laptop.getItem(MAP_KEYS.shots)).map(s => s.round)).toEqual([1001, 2002]);
    expect(parseHistory(laptop.getItem(MAP_KEYS.shots))[0].aim).toEqual(aim);
    const imported = memory();
    restoreBackup(imported, readBackup(JSON.stringify(exportBackup(laptop))).entries);
    expect(parseHistory(imported.getItem(MAP_KEYS.shots)).map(s => s.aim)).toEqual([aim, undefined]);
  });

  it('propagates round deletion and removes shots on other devices without resurrecting them', () => {
    const t0 = 1700000000000;
    let server = {
      profile: { handicap: 12, handicapUpdatedAt: t0, bag: null, bagUpdatedAt: 0 },
      rounds: [{ course: 'visby', id: 1001, updatedAt: t0, deletedAt: null, record: sampleRound('visby', 1001, 82, t0) }],
      shotSets: [{ course: 'visby', roundId: 1001, updatedAt: t0, deletedAt: null, shots: [sampleShot('visby', 1001, 1, t0)] }],
    };

    // Device A deletes round 1001
    const phone = memory({ [MAP_KEYS.rounds]: storeRounds([]), [MAP_KEYS.shots]: storeHistory([]) });
    markRoundDeleted(phone, 'visby', 1001, t0 + 5000);
    const delMerge = mergeSyncState(server, validateSyncPayload(buildSyncPayload(phone)).payload, t0 + 5001);
    server = delMerge.merged;
    expect(server.rounds[0].deletedAt).toBe(t0 + 5000);
    expect(server.shotSets[0].deletedAt).toBe(t0 + 5000);
    expect(server.shotSets[0].shots).toEqual([]);

    // Device B still had round 1001 locally from earlier (updatedAt t0) and syncs
    const laptop = memory({
      [MAP_KEYS.rounds]: storeRounds([sampleRound('visby', 1001, 82, t0)]),
      [MAP_KEYS.shots]: storeHistory([sampleShot('visby', 1001, 1, t0)]),
    });
    markRoundDirty(laptop, 'visby', 1001, t0);
    markShotsDirty(laptop, 'visby', 1001, t0);
    const pullMerge = mergeSyncState(server, validateSyncPayload(buildSyncPayload(laptop)).payload, t0 + 6000);
    applySyncResponse(laptop, toHttp(pullMerge), 'user-1');

    expect(parseRounds(laptop.getItem(MAP_KEYS.rounds))).toEqual([]);
    expect(parseHistory(laptop.getItem(MAP_KEYS.shots))).toEqual([]);
  });

  it('clears previous player synced data on account switch while preserving device preferences', () => {
    const st = memory({
      [SETTINGS_KEY]: JSON.stringify({ quality: 'lo', light: 'host' }),
      [MAP_KEYS.handicap]: '11',
      [BAG_KEY]: JSON.stringify(sampleBag(230)),
      [MAP_KEYS.rounds]: storeRounds([sampleRound('visby', 1001)]),
      [MAP_KEYS.shots]: storeHistory([sampleShot('visby', 1001)]),
    });
    markBagDirty(st, 2000);
    clearUserSyncedData(st);

    expect(st.getItem(MAP_KEYS.rounds)).toBeNull();
    expect(st.getItem(MAP_KEYS.shots)).toBeNull();
    expect(st.getItem(MAP_KEYS.handicap)).toBeNull();
    expect(st.getItem(BAG_KEY)).toBeNull();
    expect(readSyncMeta(st).userId).toBeNull();
    expect(JSON.parse(st.getItem(SETTINGS_KEY))).toEqual({ quality: 'lo', light: 'host' });
  });

  it('marks restored backup data dirty so it syncs to cloud', () => {
    const st = memory({
      [MAP_KEYS.handicap]: '9',
      [BAG_KEY]: JSON.stringify(sampleBag(240)),
      [MAP_KEYS.rounds]: storeRounds([sampleRound('visby', 3003)]),
      [MAP_KEYS.shots]: storeHistory([sampleShot('visby', 3003)]),
    });
    const meta = markRestoredDataDirty(st, 9000);
    expect(meta.dirty).toBe(true);
    expect(meta.handicapUpdatedAt).toBe(9000);
    expect(meta.bagUpdatedAt).toBe(9000);
    expect(meta.roundUpdatedAt[roundKey('visby', 3003)]).toBe(9000);
    expect(meta.shotsUpdatedAt[roundKey('visby', 3003)]).toBe(9000);
  });
});


describe('offline writes while a sync is pending', () => {
  it('keeps changed profile fields, an edited round, a deletion and shots made after the request', () => {
    const base = 1700000020000;
    const course = 'visby';
    const oldRecords = [1, 2].map(id => sampleRound(course, id));
    const st = memory({ [MAP_KEYS.rounds]: storeRounds(oldRecords), [MAP_KEYS.shots]: storeHistory([sampleShot(course, 1)] ) });
    writePlayerProfile(st, 'bag', sampleBag().clubs, base);
    writePlayerProfile(st, 'handicap', 17, base);
    const sent = buildSyncPayload(st);
    const remote = structuredClone(sent);
    remote.profile.bag = sampleBag(250);
    remote.profile.bagUpdatedAt = base + 900;
    remote.rounds.push({ course: 'upsala', id: 3, record: sampleRound('upsala', 3), updatedAt: base, deletedAt: null });

    writePlayerProfile(st, 'bag', sampleBag(180).clubs, base + 1);
    writePlayerProfile(st, 'handicap', 11, base + 2);
    st.setItem(MAP_KEYS.rounds, storeRounds([sampleRound(course, 1, 76)]));
    markRoundDirty(st, course, 1, base + 3);
    markRoundDeleted(st, course, 2, base + 3);
    st.setItem(MAP_KEYS.shots, storeHistory([sampleShot(course, 1), sampleShot(course, 1, 2)]));
    markShotsDirty(st, course, 1, base + 4);

    expect(applySyncResponse(st, remote, 'a', sent).dirty).toBe(true);
    const next = buildSyncPayload(st);
    expect(next.profile).toMatchObject({ bag: sampleBag(180), handicap: 11, bagUpdatedAt: base + 901 });
    expect(next.rounds).toContainEqual(expect.objectContaining({ id: 1, record: expect.objectContaining({ totals: expect.objectContaining({ strokes: 76 }) }) }));
    expect(next.rounds).toContainEqual(expect.objectContaining({ id: 2, deletedAt: base + 3 }));
    expect(next.rounds).toContainEqual(expect.objectContaining({ course: 'upsala', id: 3 }));
    expect(next.shotSets.find(s => s.roundId === 1).shots).toHaveLength(2);
    expect(next.shotSets.find(s => s.roundId === 2).deletedAt).toBe(base + 3);
    expect(applySyncResponse(st, next, 'a', next).dirty).toBe(false);
  });

  it('verifies the existing viewer bag writer and rolls back its revision when the write is refused', () => {
    const st = memory(), raw = sampleBag(175);
    const writes = [];
    writePlayerProfile(st, 'bag', raw.clubs, 120, clubs => {
      writes.push(clubs);
      st.setItem(BAG_KEY, JSON.stringify({ version: 3, clubs }));
    });
    expect(writes).toEqual([raw.clubs]);
    expect(readSyncMeta(st).bagUpdatedAt).toBe(120);
    expect(() => writePlayerProfile(st, 'bag', sampleBag(200).clubs, 125, () => {})).toThrow();
    expect(JSON.parse(st.getItem(BAG_KEY))).toEqual(raw);
    expect(readSyncMeta(st).bagUpdatedAt).toBe(120);
  });

  it('isolates active cards, simulator and unsent data, preserving each player and installation preferences', () => {
    const card = 'banvy-map-round-v1:visby', hole = 'banvy-map-hole-v1:visby';
    const sim = 'banvy-play-checkpoint-v1:upsala', guard = 'banvy-live-owner-v1:visby';
    const st = memory({ [card]: 'alice', [hole]: '8', [sim]: 'simulation', [guard]: 'claim', 'banvy-device-id-v1': 'phone' });
    selectSyncUser(st, 'alice');
    writePlayerProfile(st, 'handicap', 9, 100);
    selectSyncUser(st, 'bob');
    for (const key of [card, hole, sim, guard, MAP_KEYS.handicap]) expect(st.getItem(key)).toBeNull();
    expect(st.getItem('banvy-device-id-v1')).toBe('phone');
    st.setItem(card, 'bob');
    selectSyncUser(st, null);
    st.setItem(card, 'guest');
    selectSyncUser(st, 'alice');
    expect(st.getItem(card)).toBe('alice');
    expect(st.getItem(sim)).toBe('simulation');
    expect(st.getItem(guard)).toBe('claim');
    expect(st.getItem(hole)).toBe('8');
    expect(readSyncMeta(st)).toMatchObject({ userId: 'alice', dirty: true, handicapUpdatedAt: 100 });
    selectSyncUser(st, null);
    expect(st.getItem(card)).toBe('guest');
    selectSyncUser(st, 'bob');
    expect(st.getItem(card)).toBe('bob');
  });

  it('restores or undoes a replacement with precise revisions, including removed shot sets and rounds', () => {
    const key = MAP_KEYS.rounds, shots = MAP_KEYS.shots;
    const one = sampleRound('visby', 1), two = sampleRound('upsala', 2);
    const previous = { [key]: storeRounds([one, two]), [shots]: storeHistory([sampleShot('upsala', 2)]) };
    const st = memory(previous);
    const changes = new Map([[key, storeRounds([one])], [shots, storeHistory([])]]);
    const [[, raw]] = restoredSyncEntries(st, changes, previous, 123);
    const meta = JSON.parse(raw);
    expect(meta.roundDeletedAt).toEqual({ 'upsala|2': 123 });
    expect(meta.shotsUpdatedAt).toEqual({ 'upsala|2': 123 });
    expect(meta.roundUpdatedAt).toEqual({});
    expect(st.getItem(SYNC_META_KEY)).toBeNull();
  });
});
