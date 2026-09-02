/* Stable tree identity across rebuilds and re-flights: Stage 6 of the plan.

   An id is a sequence number handed out once, in a deterministic order, and
   then PRESERVED by matching: a tree that moved a few decimetres because the
   compiler changed, or because a new flight measured it again, keeps its id.
   An id is never a hash of a coordinate or a capture date, because either
   would replace every tree after a new flight and make the registry diff
   meaningless. A previous record with no match is reported as missing and
   needs review; it is not silently felled.                                   */

const ID = /^tree-([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{6})$/;

export function treeId(groundId, sequence) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(groundId)) throw new TypeError('groundId must be kebab-case');
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999999) throw new RangeError('sequence must be 1..999999');
  return `tree-${groundId}-${String(sequence).padStart(6, '0')}`;
}

export function parseTreeId(id) {
  const match = ID.exec(id || '');
  return match ? { groundId: match[1], sequence: Number(match[2]) } : null;
}

function byPosition(left, right) {
  return left.easting - right.easting || left.northing - right.northing;
}

/**
 * Match previous records to new candidates, one-to-one, nearest first,
 * within `matchRadiusMetres` and `heightToleranceMetres`. Both inputs carry
 * { easting, northing, objectHeightMetres }; candidates get `id` assigned.
 */
export function assignStableIds({
  groundId,
  previous = [],
  candidates,
  matchRadiusMetres = 2.5,
  heightToleranceMetres = 5,
  movedThresholdMetres = 0.5,
}) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  for (const record of previous) {
    const parsed = parseTreeId(record.id);
    if (!parsed || parsed.groundId !== groundId) throw new Error(`previous record ${record.id} does not belong to ${groundId}`);
  }
  const ordered = candidates.map((candidate, index) => ({ candidate, index })).sort((a, b) => byPosition(a.candidate, b.candidate));
  /* every candidate/previous pair inside the radius, closest first, then one-to-one */
  const pairs = [];
  for (const entry of ordered) {
    for (const record of previous) {
      const distance = Math.hypot(record.easting - entry.candidate.easting, record.northing - entry.candidate.northing);
      if (distance > matchRadiusMetres) continue;
      if (Math.abs((record.objectHeightMetres ?? 0) - (entry.candidate.objectHeightMetres ?? 0)) > heightToleranceMetres) continue;
      pairs.push({ entry, record, distance });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance || a.record.id.localeCompare(b.record.id) || a.entry.index - b.entry.index);
  const takenRecords = new Set();
  const takenCandidates = new Set();
  const assignments = new Map();
  const matched = [];
  for (const pair of pairs) {
    if (takenRecords.has(pair.record.id) || takenCandidates.has(pair.entry.index)) continue;
    takenRecords.add(pair.record.id);
    takenCandidates.add(pair.entry.index);
    assignments.set(pair.entry.index, pair.record.id);
    matched.push({
      id: pair.record.id,
      displacementMetres: Math.round(pair.distance * 1000) / 1000,
      moved: pair.distance > movedThresholdMetres,
    });
  }
  let sequence = previous.reduce((max, record) => Math.max(max, parseTreeId(record.id).sequence), 0);
  const added = [];
  for (const entry of ordered) {
    if (assignments.has(entry.index)) continue;
    sequence++;
    const id = treeId(groundId, sequence);
    assignments.set(entry.index, id);
    added.push(id);
  }
  const missing = previous.filter(record => !takenRecords.has(record.id)).map(record => ({ id: record.id, status: 'missing-needs-review' }));
  const records = candidates
    .map((candidate, index) => ({ ...candidate, id: assignments.get(index) }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({
    records,
    matched: Object.freeze(matched.sort((a, b) => a.id.localeCompare(b.id))),
    moved: Object.freeze(matched.filter(entry => entry.moved).map(entry => entry.id).sort()),
    added: Object.freeze(added.sort()),
    missing: Object.freeze(missing.sort((a, b) => a.id.localeCompare(b.id))),
    nextSequence: sequence + 1,
  });
}

/** The diff a review reads: what a rebuild added, kept, moved and lost. */
export function registryDiff(previous, next, { movedThresholdMetres = 0.5 } = {}) {
  const before = new Map(previous.map(record => [record.id, record]));
  const after = new Map(next.map(record => [record.id, record]));
  const added = [];
  const removed = [];
  const kept = [];
  const moved = [];
  const changed = [];
  for (const [id, record] of after) {
    const old = before.get(id);
    if (!old) { added.push(id); continue; }
    const displacement = Math.hypot(record.easting - old.easting, record.northing - old.northing);
    if (displacement > movedThresholdMetres) moved.push({ id, displacementMetres: Math.round(displacement * 1000) / 1000 });
    else kept.push(id);
    const fields = ['objectHeightMetres', 'radiusMetres', 'confidence', 'truthZone', 'sourceId', 'capturedAt', 'subtype', 'placementMethod'];
    for (const field of fields) {
      if (JSON.stringify(old[field]) !== JSON.stringify(record[field])) changed.push({ id, field, before: old[field] ?? null, after: record[field] ?? null });
    }
  }
  for (const id of before.keys()) if (!after.has(id)) removed.push(id);
  return Object.freeze({
    added: added.sort(),
    removed: removed.sort(),
    kept: kept.sort(),
    moved: moved.sort((a, b) => a.id.localeCompare(b.id)),
    changed: changed.sort((a, b) => a.id.localeCompare(b.id) || a.field.localeCompare(b.field)),
  });
}
