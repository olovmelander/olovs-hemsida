/* A course's scorecard: par, stroke index and each tee's length, hole by hole.

   The course page (course-sheet.js) shows it before the round, as a golfer reads
   the club's card at the first tee, and the length of the tee chosen there.

   The holes come from the course's own pack, the record the map and the player
   read. Nothing is copied into the manifest, so a republished course's card
   follows by itself. The pack is fetched by its one URL (packRequestUrl), so the
   round started from the page reads the same bytes from the cache. */
import { inflate } from '../engine/codec.js';
import { fetchPack, packRequestUrl } from '../loader/pack.js';

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

/* One fetch per course and visit; a failed one is tried again next time. */
const cards = new Map();
export function loadScorecard(meta) {
  if (!cards.has(meta.slug)) {
    const card = (async () => {
      const pack = await fetchPack(packRequestUrl(meta), meta.sha256);
      const vectors = JSON.parse(new TextDecoder().decode(await inflate(pack.sv)));
      return scorecardOf(vectors, meta.tees?.names?.length ?? 0);
    })();
    card.catch(() => cards.delete(meta.slug));
    cards.set(meta.slug, card);
  }
  return cards.get(meta.slug);
}
