/* HOW MUCH WATER THE WIND HAS. A lake's chop, its 30 m run from shallows to deep
   and its broken line of wash all need open water to build over: a pond has
   none (main.js makeWater). The pack's isLake flag is not that: Tortuna flags
   all 56 of its ponds as lakes (the largest 7,141 m2), Visby 27 and Lidingo 3
   of theirs, and they drew a fjord's chop, foam rims and a shallow sheet from
   bank to bank, with too few mesh vertices inside the outline for the shore
   distance to leave zero. Every other course's flagged lakes are wider than
   this rule's limit and keep their treatment. So a body
   flagged a lake keeps the lake's treatment only when it is wide enough to have
   fetch; a narrower one is drawn and meshed as the pond it is. Nothing else
   changes: unflagged water stays a pond and the surroundings keep their own
   mesh. The water level, outline and every other use of isLake are untouched. */

/* 2A/P: a round pond's radius, about half a stream's width */
export function waterFetchRadius(ring) {
  let area = 0, perimeter = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % n];
    area += x0 * z1 - x1 * z0;
    perimeter += Math.hypot(x1 - x0, z1 - z0);
  }
  return perimeter > 0 ? Math.abs(area) / perimeter : 0;
}

/* the narrowest water that still has a lake's fetch: about 60 m across */
export const LAKE_FETCH_METRES = 30;

/** 1 for a lake's chop and wash, 0 for a pond's calm; `legacy` is the before (?pondfetch=lake) */
export function waterFetch(water, { legacy = false } = {}) {
  if (!water.isLake) return 0;
  return legacy || waterFetchRadius(water.ring) >= LAKE_FETCH_METRES ? 1 : 0;
}

/** the mesh step: a lake's normals need interior vertices every 34 m, a pond's
    shore distance every 9 m; the surroundings keep 30 m */
export function waterMeshStep(water, fetch) {
  return water.isLake && fetch ? 34 : water.surr ? 30 : 9;
}
