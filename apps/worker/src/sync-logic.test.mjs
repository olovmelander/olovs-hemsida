import { describe, expect, it } from 'vitest';
import {
  extractRoundColumns,
  mergeSyncState,
  normalizeBag,
  normalizeHandicap,
  shotDistanceMetres,
  validateSyncPayload,
} from './sync-logic.mjs';

describe('worker sync validation & normalization', () => {
  it('clamps handicap to valid golf bounds and rejects garbage', () => {
    expect(normalizeHandicap(14.4)).toBe(14);
    expect(normalizeHandicap(-20)).toBe(-10);
    expect(normalizeHandicap(99)).toBe(54);
    expect(normalizeHandicap('')).toBeNull();
    expect(normalizeHandicap('abc')).toBeNull();
  });

  it('validates bag clubs and drops malformed entries', () => {
    const bag = normalizeBag({
      version: 3,
      clubs: [
        { id: 'driver', name: 'Driver', carry: 215.4 },
        { id: '', name: 'Bad', carry: 100 },
        { id: 'rocket', name: 'Rocket', carry: 9999 },
        { id: 'putter', name: 'Putter', carry: 0 },
      ],
    });
    expect(bag).toEqual({
      version: 3,
      clubs: [
        { id: 'driver', name: 'Driver', carry: 215 },
        { id: 'putter', name: 'Putter', carry: 0 },
      ],
    });
  });

  it('computes shot distance metres from local coordinates', () => {
    expect(shotDistanceMetres({ from: [0, 0], to: [30, 40] })).toBe(50);
    expect(shotDistanceMetres({ from: [0, 0], to: null })).toBeNull();
  });

  it('extracts normalized SQL summary columns from a round record', () => {
    const cols = extractRoundColumns({
      id: 1,
      course: 'visby',
      courseName: 'Visby GK',
      date: '2026-07-01',
      endedAt: 1700000000000,
      tee: '58',
      handicap: 12,
      holeCount: 18,
      holes: [{ n: 1, par: 4, strokes: 4 }],
      totals: { played: 18, strokes: 84, toPar: 12, points: 34, putts: 33, fairways: 7, fairwaysTried: 14, greens: 8, greensTried: 18 },
    });
    expect(cols).toMatchObject({
      courseName: 'Visby GK',
      playedDate: '2026-07-01',
      strokes: 84,
      toPar: 12,
      points: 34,
      putts: 33,
      fairwaysHit: 7,
      greensHit: 8,
    });
  });

  it('rejects non-object sync payloads and ignores invalid slugs/ids', () => {
    expect(validateSyncPayload(null).ok).toBe(false);
    const res = validateSyncPayload({
      profile: { handicap: 16, handicapUpdatedAt: 100 },
      rounds: [
        { course: '../evil', id: 1, updatedAt: 10, record: { holes: [] } },
        { course: 'visby', id: -5, updatedAt: 10, record: { holes: [] } },
      ],
      shotSets: [],
    });
    expect(res.ok).toBe(true);
    expect(res.payload.rounds).toEqual([]);
  });

  it('rejects oversized sets instead of acknowledging and replacing a truncated log', () => {
    const shotSet = { course: 'visby', roundId: 1, updatedAt: 1, shots: Array(401).fill({ hole: 1, club: 'iron' }) };
    expect(validateSyncPayload({ shotSets: [shotSet] })).toMatchObject({ ok: false, error: expect.stringContaining('lokala slag') });
  });

  it('only marks dirty slices when incoming timestamps are strictly newer', () => {
    const server = {
      profile: { handicap: 14, handicapUpdatedAt: 500, bag: null, bagUpdatedAt: 0 },
      rounds: [],
      shotSets: [],
    };
    const res = mergeSyncState(server, {
      profile: { handicap: 20, handicapUpdatedAt: 400, bag: null, bagUpdatedAt: 0 },
      rounds: [],
      shotSets: [],
    }, 1000);
    expect(res.dirty.profile).toBeNull();
    expect(res.merged.profile.handicap).toBe(14);
  });
});
