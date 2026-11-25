const finite = value => (Number.isFinite(value) ? value : null);

/* The card from the pack's vectors: the holes in order, each nine with its
   sums (Ut and In on an eighteen, one total on a nine), and the course's.
   A tee's sum is null where any of its holes has no length. */
export function scorecardOf(vectors, teeCount = 0) {
  const raw = (vectors?.holes ?? []).filter(hole => Number.isFinite(hole?.n) && Number.isFinite(hole?.par));
  const tees = teeCount || Math.max(0, ...raw.map(hole => hole.t?.length ?? 0));
  const holes = raw
    .sort((a, b) => a.n - b.n)
    .map(hole => ({
      n: hole.n,
      par: hole.par,
      index: finite(hole.idx),
      name: hole.name ?? null,
      note: hole.note ?? null,
      lengths: Array.from({ length: tees }, (_, i) => finite(hole.t?.[i] ?? hole.tees?.marks?.[i]?.m)),
    }));
  return cardFromHoles(holes, tees);
}

export function cardFromHoles(holes, tees) {
  const sums = list => ({
    par: list.reduce((sum, hole) => sum + hole.par, 0),
    lengths: Array.from({ length: tees }, (_, i) => (list.length && list.every(hole => hole.lengths[i] !== null)
      ? list.reduce((sum, hole) => sum + hole.lengths[i], 0) : null)),
  });
  const chunks = [];
  for (let i = 0; i < holes.length; i += 9) chunks.push(holes.slice(i, i + 9));
  const labels = chunks.length === 2 ? ['Ut', 'In'] : chunks.map(() => 'Tot');
  return {
    holes,
    nines: chunks.map((list, i) => ({ label: labels[i], holes: list, ...sums(list) })),
    indexed: holes.some(hole => hole.index !== null),
    /* the course's own words for its holes: the page's hole guide */
    described: holes.some(hole => hole.name || hole.note),
    ...sums(holes),
  };
}
