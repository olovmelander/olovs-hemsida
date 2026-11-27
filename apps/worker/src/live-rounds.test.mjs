import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { changeLiveRound, listLiveRounds, liveMutation } from './live-rounds.mjs';

const deviceA = 'device-phone-0000001', deviceB = 'device-tablet-00002';
const snap = { card: { version: 1, id: 42, begunAt: 100, playingHole: 6, scores: { 5: { strokes: 5, putts: 2 } } }, tee: 1,
  shots: [{ course: 'upsala', round: 42, hole: 5, club: 'iron-7', at: 333, from: [30, 40] }] };
const change = (device, revision, action, snapshot = snap) => ({ course: 'upsala', id: 42, revision, device, action, snapshot, operation: crypto.randomUUID() });
function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec("CREATE TABLE user(id TEXT PRIMARY KEY); INSERT INTO user VALUES ('u'), ('v');");
  sql.exec(readFileSync(new URL('../migrations/0002_active_rounds.sql', import.meta.url), 'utf8'));
  return { prepare: q => ({ bind: (...args) => ({
    run: () => sql.prepare(q).run(...args),
    first: () => sql.prepare(q).get(...args) ?? null,
    all: () => ({ results: sql.prepare(q).all(...args) }),
  }) }) };
}
it('hands a complete card and shot log to one writer, even when requests are retried', async () => {
  const db = database();
  const send = input => changeLiveRound(db, 'u', liveMutation(input));
  const first = change(deviceA, 0, 'save');
  expect((await send(first)).row.revision).toBe(1);
  expect((await send(first)).accepted).toBe(true);
  expect(await listLiveRounds(db, 'v')).toEqual([]);
  expect((await send(change(deviceB, 1, 'claim'))).accepted).toBe(false);
  const offered = change(deviceA, 1, 'offer');
  expect((await send(offered)).row.status).toBe('offered');
  expect((await send(offered)).row.revision).toBe(2);
  const claim = change(deviceB, 2, 'claim');
  expect((await send(claim)).row.snapshot).toMatchObject(snap);
  expect((await send(claim)).row.revision).toBe(3);
  expect((await send(change(deviceA, 2, 'claim'))).accepted).toBe(false);
  expect((await send(change(deviceA, 3, 'save'))).accepted).toBe(false);
  expect((await send(change(deviceB, 3, 'end'))).row.status).toBe('ended');
  expect(await listLiveRounds(db, 'u')).toEqual([]);
  expect((await send(change(deviceA, 0, 'save'))).accepted).toBe(false);
  expect((await send(change(deviceB, 3, 'save'))).accepted).toBe(false);
  expect((await send(change(deviceB, 4, 'save'))).row.status).toBe('recording');
});
it('rejects a mismatched scorecard, a mixed shot log or an invalid hole', () => {
  expect(liveMutation(change(deviceA, 0, 'save', { ...snap, card: { ...snap.card, id: 99 } }))).toBeNull();
  expect(liveMutation(change(deviceA, 0, 'save', { ...snap, shots: [{ ...snap.shots[0], course: 'visby' }] }))).toBeNull();
  expect(liveMutation(change(deviceA, 0, 'save', { ...snap, card: { ...snap.card, playingHole: 0 } }))).toBeNull();
});

it('lets any device of the account take a round off the list, once, at the revision it was shown', async () => {
  const db = database();
  const send = input => changeLiveRound(db, 'u', liveMutation(input));
  await send(change(deviceA, 0, 'save'));
  /* Another device of the same golfer removes it; a stale revision changes nothing. */
  expect((await send(change(deviceB, 7, 'dismiss'))).accepted).toBe(false);
  expect(await listLiveRounds(db, 'u')).toHaveLength(1);
  const dismissed = await send(change(deviceB, 1, 'dismiss'));
  expect(dismissed.accepted).toBe(true);
  expect(dismissed.row.status).toBe('ended');
  expect(await listLiveRounds(db, 'u')).toEqual([]);
  /* The recording phone's stale save does not bring it back. */
  expect((await send(change(deviceA, 1, 'save'))).accepted).toBe(false);
  expect(await listLiveRounds(db, 'u')).toEqual([]);
  /* An offered round, which no device records, can be removed too. */
  const other = { ...change(deviceA, 0, 'save'), id: 43, snapshot: { ...snap, card: { ...snap.card, id: 43 }, shots: [] } };
  await send(other);
  await send({ ...other, revision: 1, action: 'offer', operation: crypto.randomUUID() });
  expect((await send({ ...change(deviceB, 2, 'dismiss'), id: 43 })).accepted).toBe(true);
  expect(await listLiveRounds(db, 'u')).toEqual([]);
  /* Another account's round is out of reach. */
  await changeLiveRound(db, 'v', liveMutation({ ...change(deviceA, 0, 'save'), id: 44, snapshot: { ...snap, card: { ...snap.card, id: 44 }, shots: [] } }));
  expect((await send({ ...change(deviceB, 1, 'dismiss'), id: 44 })).accepted).toBe(false);
  expect(await listLiveRounds(db, 'v')).toHaveLength(1);
});
