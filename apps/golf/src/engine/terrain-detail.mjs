/* Terrain detail does not depend on quality, device or backend (owner request,
   24 September): a phone refines the same 1 m ground as the owner's WebGPU
   desktop. Every tile is drawn at its native density, a coarser level only
   where it stays within one pixel of the finer surface on screen, with the
   desktop tile budget. The pixel is the screen's own, up to two per CSS pixel
   as on a high-quality desktop (terrainDetailHeight in render-resolution.mjs),
   not the low-quality canvas's. Low quality on WebGL2 used to draw the
   refinable levels at half density within 1.5 px of its canvas, and WebGL2
   desktops also accepted 1.5 px. ?terrainStride=2 still draws that reduced
   grid for a matched comparison. */
export const TERRAIN_TARGET_ERROR_PIXELS = 1;
export const TERRAIN_OUTSIDE_COURSE_TARGET_ERROR_PIXELS = 3;
export const TERRAIN_MAXIMUM_SELECTED_TILES = 128;
const OFF_COURSE_COMPARISONS = [1, 2, 3, 4, 6, 8];

export function playerTerrainDetail(search = '') {
  const params = new URLSearchParams(search);
  const offCourse = Number(params.get('offcourse'));
  return Object.freeze({
    renderStride: params.get('terrainStride') === '2' ? 2 : 1,
    profile: Object.freeze({
      targetErrorPixels: TERRAIN_TARGET_ERROR_PIXELS,
      outsideCourseTargetErrorPixels: OFF_COURSE_COMPARISONS.includes(offCourse)
        ? offCourse : TERRAIN_OUTSIDE_COURSE_TARGET_ERROR_PIXELS,
      maximumSelectedTiles: TERRAIN_MAXIMUM_SELECTED_TILES,
    }),
  });
}
