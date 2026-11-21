/* Pure server-side validation and last-write-wins merge for Banvy player sync.
   No D1 or Workers imports: tested directly in Vitest.

   What syncs: rounds, shot sets, caddie bag, and handicap.
   What never syncs: device graphics, frame cap, lighting, and map display toggles. */

export const MIN_HANDICAP = -10;
export const MAX_HANDICAP = 54;
export const MAX_ROUNDS_PER_USER = 500;
export const MAX_SHOTS_PER_ROUND = 400;
export const MAX_TOTAL_SHOTS = 6000;
export const MAX_CLUBS = 30;

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

export const roundKey = (course, id) => `${course}|${id}`;

function nonNegInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function normalizeHandicap(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(MIN_HANDICAP, Math.min(MAX_HANDICAP, Math.round(n)));
}

export function normalizeBag(bag) {
  if (bag === null || bag === undefined) return null;
  if (typeof bag !== 'object' || !Array.isArray(bag.clubs)) return null;
  const clubs = [];
  for (const club of bag.clubs.slice(0, MAX_CLUBS)) {
    if (!club || typeof club !== 'object') continue;
    const id = typeof club.id === 'string' ? club.id.trim().slice(0, 64) : '';
    const name = typeof club.name === 'string' ? club.name.trim().slice(0, 64) : '';
    const carry = Number(club.carry);
    if (!id || !name || !Number.isFinite(carry) || carry < 0 || carry > 500) continue;
    clubs.push({ ...club, id, name, carry: Math.round(carry) });
  }
  if (!clubs.length) return null;
  return { version: Number.isInteger(bag.version) ? bag.version : 3, clubs };
}

export function extractRoundColumns(record) {
  const holes = Array.isArray(record.holes) ? record.holes : [];
  const totals = record.totals && typeof record.totals === 'object' ? record.totals : {};
  return {
    courseName: String(record.courseName || record.course || '').slice(0, 120),
    playedDate: String(record.date || '').slice(0, 32),
    endedAt: Number.isFinite(Number(record.endedAt)) ? Math.floor(Number(record.endedAt)) : null,
    tee: typeof record.tee === 'string' ? record.tee.slice(0, 64) : null,
    handicap: normalizeHandicap(record.handicap),
    holeCount: nonNegInt(record.holeCount, holes.length || 18),
    holesPlayed: nonNegInt(totals.played, holes.length),
    strokes: nonNegInt(totals.strokes, 0),
    toPar: Number.isFinite(Number(totals.toPar)) ? Math.round(Number(totals.toPar)) : 0,
    points: totals.points === null || totals.points === undefined || !Number.isFinite(Number(totals.points))
      ? null : Math.round(Number(totals.points)),
    putts: nonNegInt(totals.putts, 0),
    fairwaysHit: nonNegInt(totals.fairways, 0),
    fairwaysTried: nonNegInt(totals.fairwaysTried, 0),
    greensHit: nonNegInt(totals.greens, 0),
    greensTried: nonNegInt(totals.greensTried, 0),
  };
}

export function normalizeRoundEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const course = typeof entry.course === 'string' ? entry.course.trim() : '';
  const id = Number(entry.id);
  if (!SLUG_RE.test(course) || !Number.isSafeInteger(id) || id <= 0) return null;
  const updatedAt = nonNegInt(entry.updatedAt, 0);
  const deletedAt = entry.deletedAt ? nonNegInt(entry.deletedAt, 0) : null;
  if (deletedAt && deletedAt >= updatedAt) {
    return { course, id, updatedAt: deletedAt, deletedAt, record: null };
  }
  const record = entry.record;
  if (!record || typeof record !== 'object' || !Array.isArray(record.holes)) return null;
  const normalizedRecord = {
    ...record,
    id,
    course,
    courseName: String(record.courseName || course).slice(0, 120),
    date: String(record.date || '').slice(0, 32),
  };
  return {
    course,
    id,
    updatedAt: updatedAt || nonNegInt(record.endedAt, 0) || 1,
    deletedAt: null,
    record: normalizedRecord,
  };
}

export function shotDistanceMetres(shot) {
  if (!Array.isArray(shot?.from) || !Array.isArray(shot?.to)) return null;
  if (shot.from.length < 2 || shot.to.length < 2) return null;
  const dx = Number(shot.from[0]) - Number(shot.to[0]);
  const dy = Number(shot.from[1]) - Number(shot.to[1]);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return Math.round(Math.hypot(dx, dy) * 10) / 10;
}

export function normalizeShotSetEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const course = typeof entry.course === 'string' ? entry.course.trim() : '';
  const roundId = Number(entry.roundId);
  if (!SLUG_RE.test(course) || !Number.isSafeInteger(roundId) || roundId <= 0) return null;
  const updatedAt = nonNegInt(entry.updatedAt, 0);
  const deletedAt = entry.deletedAt ? nonNegInt(entry.deletedAt, 0) : null;
  if (deletedAt && deletedAt >= updatedAt) {
    return { course, roundId, updatedAt: deletedAt, deletedAt, shots: [] };
  }
  if (!Array.isArray(entry.shots)) return null;
  const shots = [];
  for (const shot of entry.shots.slice(0, MAX_SHOTS_PER_ROUND)) {
    if (!shot || typeof shot !== 'object') continue;
    const hole = Number(shot.hole);
    const club = typeof shot.club === 'string' ? shot.club.trim().slice(0, 64) : '';
    const at = nonNegInt(shot.at, 0);
    if (!Number.isInteger(hole) || hole < 1 || hole > 36 || !club) continue;
    shots.push({
      ...shot,
      course,
      round: roundId,
      hole,
      club,
      at,
      outcome: typeof shot.outcome === 'string' ? shot.outcome.slice(0, 32) : 'played',
      penalty: nonNegInt(shot.penalty, 0),
    });
  }
  return {
    course,
    roundId,
    updatedAt: Math.max(updatedAt, 1),
    deletedAt: null,
    shots,
  };
}

export function validateSyncPayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Ogiltig synkdata.' };
  }
  const rawProfile = body.profile && typeof body.profile === 'object' ? body.profile : {};
  const profile = {
    handicap: normalizeHandicap(rawProfile.handicap),
    handicapUpdatedAt: nonNegInt(rawProfile.handicapUpdatedAt, 0),
    bag: normalizeBag(rawProfile.bag),
    bagUpdatedAt: nonNegInt(rawProfile.bagUpdatedAt, 0),
  };

  const rounds = [];
  if (Array.isArray(body.rounds)) {
    for (const item of body.rounds.slice(0, MAX_ROUNDS_PER_USER)) {
      const normalized = normalizeRoundEntry(item);
      if (normalized) rounds.push(normalized);
    }
  }

  const shotSets = [];
  let totalShots = 0;
  if (Array.isArray(body.shotSets)) {
    for (const item of body.shotSets.slice(0, MAX_ROUNDS_PER_USER)) {
      const normalized = normalizeShotSetEntry(item);
      if (!normalized) continue;
      if (totalShots + normalized.shots.length > MAX_TOTAL_SHOTS) {
        normalized.shots = normalized.shots.slice(0, Math.max(0, MAX_TOTAL_SHOTS - totalShots));
      }
      totalShots += normalized.shots.length;
      shotSets.push(normalized);
    }
  }

  return { ok: true, payload: { profile, rounds, shotSets } };
}

const versionOf = item => Math.max(item?.updatedAt || 0, item?.deletedAt || 0);

/* Merge incoming client state into existing server state (last-write-wins per
   profile field, per round, and per round shot set). Returns both the canonical
   merged state and only the dirty slices that need writing back to D1. */
export function mergeSyncState(serverState, clientPayload, now = Date.now()) {
  const existingProfile = serverState.profile || {
    handicap: null,
    handicapUpdatedAt: 0,
    bag: null,
    bagUpdatedAt: 0,
  };

  const mergedProfile = { ...existingProfile };
  let dirtyProfile = false;

  if (clientPayload.profile.handicapUpdatedAt > existingProfile.handicapUpdatedAt) {
    mergedProfile.handicap = clientPayload.profile.handicap;
    mergedProfile.handicapUpdatedAt = clientPayload.profile.handicapUpdatedAt;
    dirtyProfile = true;
  }
  if (clientPayload.profile.bagUpdatedAt > existingProfile.bagUpdatedAt) {
    mergedProfile.bag = clientPayload.profile.bag;
    mergedProfile.bagUpdatedAt = clientPayload.profile.bagUpdatedAt;
    dirtyProfile = true;
  }

  // Rounds: union by (course, id), newest version (updatedAt or deletedAt) wins.
  const roundMap = new Map();
  for (const r of serverState.rounds || []) {
    roundMap.set(roundKey(r.course, r.id), r);
  }
  const dirtyRounds = [];
  for (const incoming of clientPayload.rounds || []) {
    const key = roundKey(incoming.course, incoming.id);
    const current = roundMap.get(key);
    if (!current || versionOf(incoming) > versionOf(current)) {
      roundMap.set(key, incoming);
      dirtyRounds.push(incoming);
    }
  }

  // Shot sets: union by (course, roundId), newest version wins.
  const shotSetMap = new Map();
  for (const s of serverState.shotSets || []) {
    shotSetMap.set(roundKey(s.course, s.roundId), s);
  }
  const dirtyShotSetMap = new Map();
  for (const incoming of clientPayload.shotSets || []) {
    const key = roundKey(incoming.course, incoming.roundId);
    const current = shotSetMap.get(key);
    if (!current || versionOf(incoming) > versionOf(current)) {
      shotSetMap.set(key, incoming);
      dirtyShotSetMap.set(key, incoming);
    }
  }

  // If a round is tombstoned, tombstone its shot set unless the shot set is strictly newer.
  for (const [key, round] of roundMap) {
    if (!round.deletedAt) continue;
    const shotSet = shotSetMap.get(key);
    if (!shotSet || versionOf(shotSet) <= round.deletedAt) {
      const tomb = {
        course: round.course,
        roundId: round.id,
        updatedAt: round.deletedAt,
        deletedAt: round.deletedAt,
        shots: [],
      };
      const alreadyDeleted = shotSet && shotSet.deletedAt && shotSet.deletedAt >= round.deletedAt;
      shotSetMap.set(key, tomb);
      if (!alreadyDeleted) dirtyShotSetMap.set(key, tomb);
    }
  }

  const mergedRounds = [...roundMap.values()].sort(
    (a, b) => (a.record?.endedAt ?? a.updatedAt) - (b.record?.endedAt ?? b.updatedAt) || a.id - b.id,
  );
  const mergedShotSets = [...shotSetMap.values()].sort(
    (a, b) => a.roundId - b.roundId || a.course.localeCompare(b.course),
  );

  return {
    syncedAt: now,
    merged: {
      profile: mergedProfile,
      rounds: mergedRounds,
      shotSets: mergedShotSets,
    },
    dirty: {
      profile: dirtyProfile ? mergedProfile : null,
      rounds: dirtyRounds,
      shotSets: [...dirtyShotSetMap.values()],
    },
  };
}
