/* D1 persistence for Banvy player profiles, rounds, and shot sets. */
import { extractRoundColumns, roundKey, shotDistanceMetres } from './sync-logic.mjs';

function safeJson(text, fallback = null) {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

export async function loadUserState(db, userId) {
  const [profileRes, roundsRes, setsRes, shotsRes] = await db.batch([
    db.prepare(
      'SELECT handicap, handicap_updated_at, bag_json, bag_updated_at FROM player_profile WHERE user_id = ?',
    ).bind(userId),
    db.prepare(
      'SELECT course_slug, round_id, record_json, updated_at, deleted_at FROM rounds WHERE user_id = ? ORDER BY ended_at ASC, round_id ASC',
    ).bind(userId),
    db.prepare(
      'SELECT course_slug, round_id, updated_at, deleted_at FROM round_shot_sets WHERE user_id = ?',
    ).bind(userId),
    db.prepare(
      'SELECT course_slug, round_id, shot_json FROM shots WHERE user_id = ? ORDER BY course_slug ASC, round_id ASC, seq ASC',
    ).bind(userId),
  ]);

  const row = profileRes.results?.[0];
  const profile = row ? {
    handicap: row.handicap ?? null,
    handicapUpdatedAt: Number(row.handicap_updated_at) || 0,
    bag: safeJson(row.bag_json, null),
    bagUpdatedAt: Number(row.bag_updated_at) || 0,
  } : {
    handicap: null,
    handicapUpdatedAt: 0,
    bag: null,
    bagUpdatedAt: 0,
  };

  const rounds = (roundsRes.results || []).map(r => ({
    course: r.course_slug,
    id: Number(r.round_id),
    updatedAt: Number(r.updated_at) || 0,
    deletedAt: r.deleted_at ? Number(r.deleted_at) : null,
    record: r.deleted_at ? null : safeJson(r.record_json, null),
  }));

  const shotsByKey = new Map();
  for (const s of shotsRes.results || []) {
    const key = roundKey(s.course_slug, Number(s.round_id));
    const parsed = safeJson(s.shot_json, null);
    if (!parsed) continue;
    if (!shotsByKey.has(key)) shotsByKey.set(key, []);
    shotsByKey.get(key).push(parsed);
  }

  const shotSets = (setsRes.results || []).map(set => {
    const key = roundKey(set.course_slug, Number(set.round_id));
    const deletedAt = set.deleted_at ? Number(set.deleted_at) : null;
    return {
      course: set.course_slug,
      roundId: Number(set.round_id),
      updatedAt: Number(set.updated_at) || 0,
      deletedAt,
      shots: deletedAt ? [] : (shotsByKey.get(key) || []),
    };
  });

  return { profile, rounds, shotSets };
}

/* Flush dirty slices to D1 in batched transactions (chunked so large first-time
   imports of many shots never hit D1 per-batch statement limits). */
const BATCH_CHUNK = 80;

export async function persistDirtyState(db, userId, dirty, now = Date.now()) {
  const groups = new Map();
  function group(key) {
    if (!groups.has(key)) groups.set(key, []);
    return groups.get(key);
  }

  if (dirty.profile) {
    group('profile').push(
      db.prepare(`
        INSERT INTO player_profile (user_id, handicap, handicap_updated_at, bag_json, bag_updated_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          handicap = CASE WHEN excluded.handicap_updated_at > handicap_updated_at THEN excluded.handicap ELSE handicap END,
          handicap_updated_at = MAX(handicap_updated_at, excluded.handicap_updated_at),
          bag_json = CASE WHEN excluded.bag_updated_at > bag_updated_at THEN excluded.bag_json ELSE bag_json END,
          bag_updated_at = MAX(bag_updated_at, excluded.bag_updated_at),
          updated_at = MAX(updated_at, excluded.updated_at)
      `).bind(
        userId,
        dirty.profile.handicap,
        dirty.profile.handicapUpdatedAt,
        dirty.profile.bag ? JSON.stringify(dirty.profile.bag) : null,
        dirty.profile.bagUpdatedAt,
        now,
      ),
    );
  }

  for (const r of dirty.rounds || []) {
    const statements = group(roundKey(r.course, r.id));
    if (r.deletedAt) {
      statements.push(
        db.prepare(`
          INSERT INTO rounds (
            user_id, course_slug, round_id, course_name, played_date, ended_at, tee, handicap,
            hole_count, holes_played, strokes, to_par, points, putts,
            fairways_hit, fairways_tried, greens_hit, greens_tried,
            record_json, updated_at, deleted_at
          ) VALUES (?, ?, ?, '', '', NULL, NULL, NULL, 0, 0, 0, 0, NULL, 0, 0, 0, 0, 0, '{}', ?, ?)
          ON CONFLICT(user_id, course_slug, round_id) DO UPDATE SET
            record_json = '{}',
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at
          WHERE excluded.updated_at > rounds.updated_at
        `).bind(userId, r.course, r.id, r.updatedAt, r.deletedAt),
      );
    } else {
      const cols = extractRoundColumns(r.record);
      statements.push(
        db.prepare(`
          INSERT INTO rounds (
            user_id, course_slug, round_id, course_name, played_date, ended_at, tee, handicap,
            hole_count, holes_played, strokes, to_par, points, putts,
            fairways_hit, fairways_tried, greens_hit, greens_tried,
            record_json, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
          ON CONFLICT(user_id, course_slug, round_id) DO UPDATE SET
            course_name = excluded.course_name,
            played_date = excluded.played_date,
            ended_at = excluded.ended_at,
            tee = excluded.tee,
            handicap = excluded.handicap,
            hole_count = excluded.hole_count,
            holes_played = excluded.holes_played,
            strokes = excluded.strokes,
            to_par = excluded.to_par,
            points = excluded.points,
            putts = excluded.putts,
            fairways_hit = excluded.fairways_hit,
            fairways_tried = excluded.fairways_tried,
            greens_hit = excluded.greens_hit,
            greens_tried = excluded.greens_tried,
            record_json = excluded.record_json,
            updated_at = excluded.updated_at,
            deleted_at = NULL
          WHERE excluded.updated_at > rounds.updated_at
        `).bind(
          userId,
          r.course,
          r.id,
          cols.courseName,
          cols.playedDate,
          cols.endedAt,
          cols.tee,
          cols.handicap,
          cols.holeCount,
          cols.holesPlayed,
          cols.strokes,
          cols.toPar,
          cols.points,
          cols.putts,
          cols.fairwaysHit,
          cols.fairwaysTried,
          cols.greensHit,
          cols.greensTried,
          JSON.stringify(r.record),
          r.updatedAt,
        ),
      );
    }
  }

  for (const s of dirty.shotSets || []) {
    const statements = group(roundKey(s.course, s.roundId));
    const id = [userId, s.course, s.roundId];
    // Compare against the pre-transaction revision for both child operations.
    // A round deletion also retires a live set at exactly the same revision.
    const currentWins = `SELECT 1 FROM round_shot_sets
      WHERE user_id = ? AND course_slug = ? AND round_id = ?
      AND (updated_at > ? OR (updated_at = ? AND (deleted_at IS NOT NULL OR ? IS NULL)))`;
    const guard = [...id, s.updatedAt, s.updatedAt, s.deletedAt];
    statements.push(db.prepare(`DELETE FROM shots WHERE user_id = ? AND course_slug = ? AND round_id = ?
      AND NOT EXISTS (${currentWins})`).bind(...id, ...guard));

    if (!s.deletedAt && s.shots.length) {
      const rows = s.shots.map(shot => [shot, shotDistanceMetres(shot)]);
      statements.push(db.prepare(`
        INSERT INTO shots (user_id, course_slug, round_id, seq, hole, club, at, length_m,
          outcome, penalty, is_putt, suspect, from_lie, to_lie, shot_json)
        SELECT ?, ?, ?, key, value ->> '$[0].hole', value ->> '$[0].club', value ->> '$[0].at',
          value ->> '$[1]', value ->> '$[0].outcome', COALESCE(value ->> '$[0].penalty', 0),
          CASE WHEN value ->> '$[0].putt' = 1 OR value ->> '$[0].club' = 'putter' THEN 1 ELSE 0 END,
          COALESCE(value ->> '$[0].suspect', 0), value ->> '$[0].fromLie', value ->> '$[0].toLie', value -> '$[0]'
        FROM json_each(?) WHERE NOT EXISTS (${currentWins})
      `).bind(...id, JSON.stringify(rows), ...guard));
    }
    statements.push(db.prepare(`
      INSERT INTO round_shot_sets (user_id, course_slug, round_id, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, course_slug, round_id) DO UPDATE SET
        updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
      WHERE excluded.updated_at > round_shot_sets.updated_at OR
        (excluded.updated_at = round_shot_sets.updated_at AND excluded.deleted_at IS NOT NULL AND round_shot_sets.deleted_at IS NULL)
    `).bind(...id, s.updatedAt, s.deletedAt));
  }

  let batch = [];
  for (const statements of groups.values()) {
    if (batch.length + statements.length > BATCH_CHUNK) {
      await db.batch(batch);
      batch = [];
    }
    batch.push(...statements);
  }
  if (batch.length) await db.batch(batch);
}
