/* The latest bunker ledger runs LAST: historical overlays can reintroduce
 * superseded contours or scenery rings when rebuilding an already adopted model. */
import fs from 'node:fs';
import { applyReviewedOrthophoto } from './reviewed-orthophoto.mjs';

const defaultReview = JSON.parse(fs.readFileSync(new URL('./bunker-review-2026-09-21.json', import.meta.url)));
const sameRing = (a, b) => a.length === b.length && a.every((p, i) => p.every((v, k) => Math.abs(v - b[i][k]) < 1e-7));

export function applyReviewedBunkers(input, review = defaultReview) {
  const geometry = applyReviewedOrthophoto(input, review);
  const ids = new Set();
  for (const transfer of review.ownershipTransfers) {
    const hole = geometry.holes.find(h => h.n === transfer.hole);
    if (!hole || !transfer.id || ids.has(transfer.id) || !transfer.sourceIds?.length) throw new Error('Invalid bunker ownership transfer');
    ids.add(transfer.id);
    geometry.scenery.bunkers = geometry.scenery.bunkers.filter(r => !sameRing(r, transfer.ring));
    hole.bunkers = hole.bunkers.filter(b => b.reviewId !== transfer.id && !sameRing(b.ring, transfer.ring));
    hole.bunkers.push({ ring: structuredClone(transfer.ring), sourceIds: transfer.sourceIds, reviewId: transfer.id });
  }
  return geometry;
}
