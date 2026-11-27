/* Preserve the historical field order and bytes when source shoreline evidence
 * is absent. Optional source boundaries are separate from render partitions.
 * An island the outline holds (`innerRings`, as compile-grid-course.mjs keeps it
 * and as a bunker carries its grass islands) travels with the water: without it
 * the engine drew Bro Hof's island in Malaren under the lake (27 November 2026).
 * Water without islands keeps its bytes. */
export function runtimeWater(water) {
  return {
    ring: water.ring, level: water.level, isLake: water.isLake,
    isSea: !!water.isSea, area: water.area,
    ...(water.shoreline ? { shoreline: water.shoreline } : {}),
    ...(water.innerRings?.length ? { innerRings: water.innerRings } : {}),
  };
}
