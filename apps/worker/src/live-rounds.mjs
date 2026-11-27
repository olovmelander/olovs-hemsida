import { MAX_SHOTS_PER_ROUND, normalizeShotSetEntry } from './sync-logic.mjs';

const slug = /^[a-z0-9-]{1,64}$/;
const token = /^[a-zA-Z0-9_-]{16,80}$/;
const holeNumber = n => Number.isInteger(n) && n >= 1 && n <= 36;
const validScore = score => score && typeof score === 'object'
  && !Array.isArray(score) && (score.picked == null || typeof score.picked === 'boolean')
  && [score.strokes, score.putts].every(n => n == null || (Number.isInteger(n) && n >= 0 && n <= 999));

export function liveMutation(input) {
  if (!input || typeof input.course !== 'string' || !slug.test(input.course) || !Number.isSafeInteger(input.id) || input.id <= 0
      || typeof input.device !== 'string' || !token.test(input.device)
      || typeof input.operation !== 'string' || !token.test(input.operation)
      || !Number.isSafeInteger(input.revision) || input.revision < 0
      || !['save', 'offer', 'claim', 'end', 'dismiss'].includes(input.action)) return null;
  if (['claim', 'end', 'dismiss'].includes(input.action)) return { ...input, snapshot: null };
  const snap = input.snapshot, card = snap?.card;
  if (!card || card.version !== 1 || card.id !== input.id || !Number.isSafeInteger(card.begunAt) || card.begunAt <= 0
      || card.endedAt || !holeNumber(card.playingHole)
      || !card.scores || Array.isArray(card.scores) || typeof card.scores !== 'object'
      || !Object.entries(card.scores).every(([hole, score]) => holeNumber(+hole) && validScore(score))
      || (snap.tee !== null && (!Number.isInteger(snap.tee) || snap.tee < 0 || snap.tee > 99))
      || !Array.isArray(snap.shots) || snap.shots.length > MAX_SHOTS_PER_ROUND) return null;
  const set = normalizeShotSetEntry({ course: input.course, roundId: input.id, shots: snap.shots });
  if (!set || set.shots.length !== snap.shots.length || snap.shots.some(s => s.course !== input.course || s.round !== input.id)) return null;
  return { ...input, snapshot: { card, tee: snap.tee, shots: set.shots } };
}

function publicRow(row) {
  return row && { course: row.course, id: row.round_id, revision: row.revision, device: row.writer,
    status: row.status, updatedAt: row.updated_at, snapshot: JSON.parse(row.snapshot) };
}

export async function listLiveRounds(db, user) {
  const rows = await db.prepare("SELECT * FROM live_rounds WHERE user_id=? AND status!='ended' ORDER BY updated_at DESC").bind(user).all();
  return rows.results.map(publicRow);
}

// Each transition is a single conditional SQLite write. A repeated request can
// recover an acknowledgement lost on the way back to the recording phone.
export async function changeLiveRound(db, user, input, now = Date.now()) {
  const { course, id, device, revision, action, operation } = input;
  const key = [user, course, id];
  const snapshot = JSON.stringify(input.snapshot);
  if (revision === 0 && action === 'save') {
    await db.prepare("INSERT INTO live_rounds (user_id,course,round_id,writer,revision,status,snapshot,updated_at,last_operation) VALUES (?,?,?,?,1,'recording',?,?,?) ON CONFLICT DO NOTHING")
      .bind(...key, device, snapshot, now, operation).run();
  } else if (action === 'dismiss') {
    // The golfer takes a round off the list from any of their devices: one begun and never
    // played, or one offered and never taken. It must still be the revision they were shown.
    await db.prepare("UPDATE live_rounds SET snapshot=NULL,status='ended',revision=revision+1,updated_at=?,last_operation=? WHERE user_id=? AND course=? AND round_id=? AND revision=? AND status IN ('recording','offered')")
      .bind(now, operation, ...key, revision).run();
  } else if (action === 'claim') {
    await db.prepare("UPDATE live_rounds SET writer=?,revision=revision+1,status='recording',updated_at=?,last_operation=? WHERE user_id=? AND course=? AND round_id=? AND revision=? AND status='offered'")
      .bind(device, now, operation, ...key, revision).run();
  } else {
    const status = { save: 'recording', offer: 'offered', end: 'ended' }[action];
    // The scorecard can legitimately reopen on the same phone. Its next save
    // must still match the exact ended revision and original writer.
    await db.prepare("UPDATE live_rounds SET snapshot=?,status=?,revision=revision+1,updated_at=?,last_operation=? WHERE user_id=? AND course=? AND round_id=? AND revision=? AND writer=? AND (status='recording' OR (status='ended' AND ?='save'))")
      .bind(action === 'end' ? null : snapshot, status, now, operation, ...key, revision, device, action).run();
  }
  const row = await db.prepare('SELECT * FROM live_rounds WHERE user_id=? AND course=? AND round_id=?').bind(...key).first();
  const ours = row?.last_operation === operation && (action === 'dismiss' || row?.writer === device);
  return { accepted: ours, row: publicRow(row) };
}
