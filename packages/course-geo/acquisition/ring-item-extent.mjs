/* Which rectangle a DTM item actually publishes.
 *
 * A ring level is filled from every 10 km item it touches, and the reads are
 * indexed from that item's raster origin. It is tempting to take the origin as
 * the nominal square's north-west corner, and for an inland item it IS: the
 * raster fills its square. A COASTAL item does not. Lantmäteriet clips it to
 * the ground it has, on whichever edges the sea is on — Norrfällsviken's are
 * clipped south and east, which leaves the north-west corner intact and hides
 * the problem, while Visby's 636_68 and 637_68 are clipped on their WEST edge
 * and start 5,000 m east of their square.
 *
 * So the property the reads depend on is weaker than "the origin is the
 * corner": the published rectangle must lie inside the nominal square, and its
 * pixel centres must sit on the same metre lattice the square's would. That is
 * what this measures and asserts, and the rectangle it returns is what every
 * clip and pixel index downstream must use.                                   */

/** The nominal square an item id names, in EPSG:3006 metres. */
export function itemSquare(item) {
  return { minEasting: item.minEasting, maxEasting: item.maxEasting, minNorthing: item.minNorthing, maxNorthing: item.maxNorthing };
}

/**
 * The rectangle `cog` publishes, validated against the square `item` names.
 * Throws when the raster escapes its square or is offset from the square by a
 * fraction of a sample, either of which would silently misplace every read.
 */
export function publishedItemExtent(cog, item) {
  const published = Object.freeze({
    minEasting: cog.originX,
    maxNorthing: cog.originY,
    maxEasting: cog.originX + cog.width * cog.pixelScaleX,
    minNorthing: cog.originY - cog.height * cog.pixelScaleY,
  });
  if (published.minEasting < item.minEasting - 1e-6 || published.maxEasting > item.maxEasting + 1e-6
    || published.minNorthing < item.minNorthing - 1e-6 || published.maxNorthing > item.maxNorthing + 1e-6) {
    throw new Error(`${item.id} publishes ${published.minEasting},${published.minNorthing}..${published.maxEasting},${published.maxNorthing}, which is not inside its item square`);
  }
  for (const [name, offset] of [['minEasting', published.minEasting - item.minEasting], ['maxNorthing', item.maxNorthing - published.maxNorthing]]) {
    if (Math.abs(offset - Math.round(offset)) > 1e-6) {
      throw new Error(`${item.id} ${name} is offset ${offset} m from its square, which is not a whole number of samples`);
    }
  }
  return published;
}

/** How far the published rectangle is cropped from its square, per edge. */
export function croppedFromSquare(published, item) {
  return Object.freeze({
    west: published.minEasting - item.minEasting,
    east: item.maxEasting - published.maxEasting,
    north: item.maxNorthing - published.maxNorthing,
    south: published.minNorthing - item.minNorthing,
  });
}
