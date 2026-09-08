/* Preserve the historical field order and bytes when source shoreline evidence
 * is absent. Optional source boundaries are separate from render partitions. */
export function runtimeWater(water) {
  return {
    ring: water.ring, level: water.level, isLake: water.isLake,
    isSea: !!water.isSea, area: water.area,
    ...(water.shoreline ? { shoreline: water.shoreline } : {}),
  };
}
