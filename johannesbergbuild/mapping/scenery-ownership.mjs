import { geometrySha256 } from './apply-ortho-review.mjs';

export function holeScenery(holes) {
  return {
    greens: holes.map(h => h.green.ring),
    fairways: holes.flatMap(h => h.fairway.rings),
    tees: holes.flatMap(h => h.tees.pads.map(p => p.ring)),
    bunkers: holes.flatMap(h => h.bunkers.map(b => b.ring)),
  };
}

// Ownership follows the exact carried rings, independent of how far the next
// review moves them. Hash metadata contains no additional renderable geometry.
export function sceneryRingHashes(holes) {
  return Object.fromEntries(Object.entries(holeScenery(holes)).map(([kind, rings]) =>
    [kind, rings.map(geometrySha256)]));
}

export function excludeOwnedScenery(scenery, course) {
  const owner = scenery.ownerRingHashes?.[course];
  if (!owner) return scenery;
  const out = {...scenery};
  for (const kind of ['greens', 'fairways', 'tees', 'bunkers']) {
    if (!Array.isArray(owner[kind]) || owner[kind].some(hash => !/^[a-f0-9]{64}$/.test(hash))) {
      throw new Error(`Invalid ${course} scenery ownership for ${kind}`);
    }
    const owned = new Set(owner[kind]);
    const actual = new Set((scenery[kind] || []).map(geometrySha256));
    if ([...owned].some(hash => !actual.has(hash))) throw new Error(`Stale ${course} scenery ownership for ${kind}`);
    out[kind] = (scenery[kind] || []).filter(ring => !owned.has(geometrySha256(ring)));
  }
  return out;
}
