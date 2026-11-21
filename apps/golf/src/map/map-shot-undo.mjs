/* Each shot operation replaces immutable log entries. Save just its changed span
   and the score fields it derived, so later work on the card survives undo. */
export function shotUndo(before) {
  let span;
  const scoreFields = new Map();
  return {
    capture(after) {
      if (span) return;
      let start = 0, oldEnd = before.length, newEnd = after.length;
      while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
      while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      span = { start, removed: before.slice(start, oldEnd), added: after.slice(start, newEnd), left: before[start - 1] };
      before = null;
    },
    score(scores, number, change, derived) {
      const previous = scores[number] ?? {};
      const fields = scoreFields.get(number) ?? new Map();
      for (const key of Object.keys(change)) {
        if (!derived) fields.delete(key);
        else if (!fields.has(key)) fields.set(key, { existed: Object.hasOwn(previous, key), old: previous[key] });
        if (fields.has(key)) fields.get(key).value = change[key];
      }
      if (fields.size) scoreFields.set(number, fields);
      else scoreFields.delete(number);
    },
    restore(shots, scores) {
      if (!span) return shots;
      const { start, removed, added, left } = span;
      if ((start && shots[start - 1] !== left) || !added.every((shot, i) => shots[start + i] === shot)) return shots;
      for (const [number, fields] of scoreFields) {
        const row = scores[number];
        if (!row) continue;
        for (const [key, { existed, old, value }] of fields) {
          if (row[key] !== value) continue;
          if (existed) row[key] = old;
          else delete row[key];
        }
        if (!Object.keys(row).length) delete scores[number];
      }
      return [...shots.slice(0, start), ...removed, ...shots.slice(start + added.length)];
    },
  };
}
