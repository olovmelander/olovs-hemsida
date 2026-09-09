/* Fixed-point depth spends most of its precision close to the near plane.
   A 1 m near plane cannot reliably separate Visby's sea from its laser plate
   at kilometre range. Reversed *fixed-point* depth has the same limitation.
   Raise near only above the entire measured world, with a 64 m allowance for
   scenery. Taking one eighth of that empty vertical space keeps the near
   rectangle well clear of the scene; the focus and absolute caps are extra
   guards for close targets and unusual camera poses. Ground-level views keep
   the original 1 m near plane. No water bias or source-height edits are needed. */
export function coastalCameraNear({ enabled, cameraHeight, terrainCeiling, focusDistance }) {
  if (!enabled || ![cameraHeight, terrainCeiling, focusDistance].every(Number.isFinite)) return 1;
  const emptyHeight = cameraHeight - terrainCeiling - 64;
  return Math.max(1, Math.min(128, emptyHeight / 8, focusDistance / 32));
}
