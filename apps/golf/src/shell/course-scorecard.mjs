/* Course setup reads a lightweight, verified publication keyed to its layout
   and pack. Previously saved packs still work if their summary is unavailable. */
import { inflate } from '../engine/codec.js';
import { fetchPack, fetchSidecar, packRequestUrl } from '../loader/pack.js';
import { cardFromHoles, scorecardOf } from './scorecard-model.mjs';

export { scorecardOf } from './scorecard-model.mjs';

async function fromPackUrl(meta, url) {
  const pack = await fetchPack(url, meta.sha256);
  if (pack.H.slug !== meta.slug) throw new Error('Fel bana i scorekortet.');
  const vectors = JSON.parse(new TextDecoder().decode(await inflate(pack.sv)));
  return scorecardOf(vectors, meta.tees.names.length);
}

async function fromSavedPack(meta) {
  // The saved-map bucket and Workbox pack cache both use this versioned URL.
  const saved = await globalThis.caches?.match(packRequestUrl(meta));
  if (!saved?.ok) throw new Error('Inget sparat scorekort finns på enheten.');
  const url = URL.createObjectURL(await saved.blob());
  try {
    return await fromPackUrl(meta, url);
  } finally { URL.revokeObjectURL(url); }
}

async function readCard(meta) {
  // Earlier catalogues published only the pack. Keep their original source available.
  if (!meta.scorecard) {
    try { return await fromSavedPack(meta); }
    catch { return fromPackUrl(meta, packRequestUrl(meta)); }
  }
  try {
    const record = await fetchSidecar(import.meta.env.BASE_URL + meta.scorecard.url, meta.scorecard.sha256, 'scorekort');
    if (record.version !== 1 || record.slug !== meta.slug || record.packSha256 !== meta.sha256 ||
        record.holes?.length !== meta.holes) throw new Error('Fel version av scorekortet.');
    const card = cardFromHoles(record.holes, meta.tees.names.length);
    if (card.par !== meta.par) throw new Error('Fel par i scorekortet.');
    return card;
  } catch {
    // Cached binary fallback is deliberately local, including after a bad network response.
    return fromSavedPack(meta);
  }
}

const cards = new Map();
export function loadScorecard(meta) {
  const key = [meta.slug, meta.sha256, meta.scorecard?.sha256].join('/');
  if (!cards.has(key)) {
    const pending = readCard(meta);
    cards.set(key, pending);
    pending.catch(() => cards.delete(key));
  }
  return cards.get(key);
}
