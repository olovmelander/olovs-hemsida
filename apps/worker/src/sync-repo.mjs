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
  const statements = [];

  if (dirty.profile) {
    statements.push(
      db.prepare(`
        INSERT INTO player_profile (user_id, handicap, handicap_updated_at, bag_json, bag_updated_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          handicap = excluded.handicap,
          handicap_updated_at = excluded.handicap_updated_at,
          bag_json = excluded.bag_json,
          bag_updated_at = excluded.bag_updated_at,
          updated_at = excluded.updated_at
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
    statements.push(
      db.prepare(`
        INSERT INTO round_shot_sets (user_id, course_slug, round_id, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, course_slug, round_id) DO UPDATE SET
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `).bind(userId, s.course, s.roundId, s.updatedAt, s.deletedAt),
    );
    statements.push(
      db.prepare('DELETE FROM shots WHERE user_id = ? AND course_slug = ? AND round_id = ?')
        .bind(userId, s.course, s.roundId),
    );
    if (!s.deletedAt) {
      for (let seq = 0; seq < s.shots.length; seq++) {
        const shot = s.shots[seq];
        const isPutt = shot.putt === true || shot.club === 'putter' ? 1 : 0;
        statements.push(
          db.prepare(`
            INSERT INTO shots (
              user_id, course_slug, round_id, seq, hole, club, at, length_m,
              outcome, penalty, is_putt, suspect, from_lie, to_lie, shot_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            userId,
            s.course,
            s.roundId,
            seq,
            shot.hole,
            shot.club,
            shot.at,
            shotDistanceMetres(shot),
            shot.outcome,
            shot.penalty || 0,
            isPutt,
            shot.suspect ? 1 : 0,
            typeof shot.fromLie === 'string' ? shot.fromLie : null,
            typeof shot.toLie === 'string' ? shot.toLie : null,
            JSON.stringify(shot),
          ),
        );
      }
    }
  }

  for (let i = 0; i < statements.length; i += BATCH_CHUNK) {
    await db.batch(statements.slice(i, i + BATCH_CHUNK));
  }
}
