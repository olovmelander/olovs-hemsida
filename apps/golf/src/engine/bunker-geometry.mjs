/* A bunker is sand inside the outer ring, excluding any grass islands.
 * Keep the same signed-distance convention as geom.js: negative inside. */
export function bunkerRings(bunker) {
  return [bunker.ring, ...(bunker.innerRings ?? [])];
}

export function bunkerSignedDistance(x, z, bunker, ringSD, cutoff) {
  let distance = ringSD(x, z, bunker.ring, cutoff);
  for (const island of bunker.innerRings ?? []) distance = Math.max(distance, -ringSD(x, z, island, cutoff));
  return distance;
}

export function pointInBunker(x, z, bunker, inRing) {
  return inRing(x, z, bunker.ring) && !(bunker.innerRings ?? []).some(ring => inRing(x, z, ring));
}
