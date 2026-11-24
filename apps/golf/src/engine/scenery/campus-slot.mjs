/** The state one scenery module keeps for its campus: the newest load wins, and an older one that finishes late is disposed. */
export function campusSlot(load) {
  let active = null, generation = 0;
  return {
    isFacilityInterior: (x, z, margin) => active?.isFacilityInterior(x, z, margin) ?? false,
    status: () => ({ status: active?.report.status ?? 'fallback', assetSha256: active?.report.assetSha256 ?? null,
      buildings: active?.replacedBuildingIds.size ?? 0, facilities: active?.report.facilities.length ?? 0 }),
    async load(context) {
      const own = ++generation;
      active?.dispose();
      active = null;
      const result = await load({ ...context, isCurrentCourse: () => own === generation && (context.isCurrentCourse?.() ?? true) });
      if (own !== generation) { result.dispose(); return result; }
      active = result;
      const dispose = result.dispose;
      result.dispose = () => { dispose(); if (active === result) active = null; };
      return result;
    },
  };
}
