import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadUserState, persistDirtyState } from './sync-repo.mjs';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
  sql.exec("INSERT INTO user (id,name,email,created_at,updated_at) VALUES ('u','Golfer','u@example.com',1,1)");
  return {
    sql, sizes: [],
    prepare(query) { return { bind(...args) { return { query, args }; } }; },
    batch(statements) {
      this.sizes.push(statements.length);
      sql.exec('BEGIN');
      try {
        const result = statements.map(({ query, args }) => ({ results: sql.prepare(query).all(...args) }));
        sql.exec('COMMIT');
        return result;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
}

const profile = (hcp, hpRevision, bagRevision) => ({
  handicap: hcp, handicapUpdatedAt: hpRevision, bag: { clubs: [{ id: 'iron', carry: bagRevision }] }, bagUpdatedAt: bagRevision,
});
const set = (updatedAt, count, id = 8) => ({
  course: 'visby', roundId: id, updatedAt, deletedAt: null,
  shots: Array.from({ length: count }, (_, i) => ({ hole: 1, club: 'iron', at: updatedAt + i, outcome: 'played', from: [0, 0], to: [0, i] })),
});
const round = updatedAt => ({ course: 'visby', id: 8, updatedAt, deletedAt: null, record: { holes: [], date: String(updatedAt) } });

describe('D1 concurrent sync writes', () => {
  it('checks independent revisions when requests computed against the same read arrive out of order', async () => {
    const db = fixture();
    await persistDirtyState(db, 'u', { profile: profile(11, 30, 1), rounds: [round(30)], shotSets: [set(30, 2)] });
    await persistDirtyState(db, 'u', { profile: profile(14, 10, 35), rounds: [round(10)], shotSets: [set(10, 12), set(30, 11)] });
    const data = await loadUserState(db, 'u');
    expect(data.profile).toEqual(profile(11, 30, 35));
    expect(data.rounds).toEqual([round(30)]);
    expect(data.shotSets).toEqual([set(30, 2)]);
  });

  it('commits a 400-shot replacement with its revision or rolls it back as a unit', async () => {
    const db = fixture();
    const old = set(10, 100);
    await persistDirtyState(db, 'u', { shotSets: [old] });
    const next = set(20, 400);
    db.sql.exec("CREATE TRIGGER interrupt BEFORE UPDATE ON round_shot_sets BEGIN SELECT RAISE(ABORT, 'interrupted'); END");
    await expect(persistDirtyState(db, 'u', { shotSets: [next] })).rejects.toThrow('interrupted');
    expect((await loadUserState(db, 'u')).shotSets).toEqual([old]);
    db.sql.exec('DROP TRIGGER interrupt');
    await persistDirtyState(db, 'u', { shotSets: [next] });
    expect((await loadUserState(db, 'u')).shotSets).toEqual([next]);
    expect(db.sizes).toEqual([3, 3, 4, 3, 4]);
  });

  it('keeps the round tombstone and all its shots in the same D1 batch, including a tied live revision', async () => {
    const db = fixture();
    await persistDirtyState(db, 'u', { rounds: [round(4)], shotSets: [set(10, 2)] });
    const tomb = { course: 'visby', roundId: 8, updatedAt: 10, deletedAt: 10, shots: [] };
    const deleted = { course: 'visby', id: 8, updatedAt: 10, deletedAt: 10, record: null };
    await persistDirtyState(db, 'u', { rounds: [deleted], shotSets: [tomb] });
    await persistDirtyState(db, 'u', { rounds: [round(9)], shotSets: [set(10, 2)] });
    expect(await loadUserState(db, 'u')).toMatchObject({ rounds: [deleted], shotSets: [tomb] });
    expect(db.sql.prepare('SELECT count(*) AS count FROM shots').get().count).toBe(0);
  });
});
