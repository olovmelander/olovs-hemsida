/* One lake, one ring.

   Skagern reaches the model from two records that describe the same water:
   Lantmäteriet's break geometry (laser-exact shorelines, but only inside the
   1 m item, where the two arms nearest the course are) and the OSM shoreline
   (the whole basin, but ±7 m and in places 65 m off the laser line, and it
   swallows a corner of the Gullspångsälven below the outlet). The first build
   kept all three polygons at one level "by design", and the app drew three
   coplanar sheets: a z-fight sawtooth where they overlapped, a foam line along
   the break polygons' straight item-edge chord, and OSM's over-reach carving
   laser land into water.

   This joins them on a raster and traces one boundary:
     water = breakGeometry
           | (osm & outside the break data's item)
           | (osm & inside the item & the DTM reads laser-flat at lake level)
   so the laser shoreline is the lake's wherever the laser drew one, OSM only
   fills what the break data cannot see, and land the OSM ring wrongly
   encloses (measured 0.5–7 m above the lake over ~6 ha) is refused. The
   boundary is traced from the cell lattice and simplified with a tolerance
   that grows with distance from the course, the same budget the slimmed OSM
   ring used: the shoreline the golfer stands on keeps 1 m fidelity, the far
   basin's costs nothing per terrain sample. */
import { bboxOfRings as bbox, fillRing as fillRingInto, labelComponents, traceLoops, simplifyRing } from './raster-shapes.mjs';

const fillRing = (ring, target, grid) => fillRingInto(ring, target, grid, 1);

/**
 * @param authoritative  rings whose interior is water wherever they say so
 * @param candidate      a ring trusted only outside `authoritativeScope` or
 *                       where `dtm` reads within `dtmTolerance` of `level`
 * @param authoritativeScope  (x, z) => boolean, where the authoritative data
 *                       describes the water (the laser item's footprint)
 * @param dtm            (x, z) => height | null
 * @returns { rings, cells, hectares, dropped: { osmOnlyLand, components } }
 */
export function uniteLakeRings({
  authoritative, candidate, level, authoritativeScope, dtm,
  dtmTolerance = 0.35, spacing = 2, minimumHectares = 0.5,
  toleranceAt = (x, z) => (Math.hypot(x, z) < 1400 ? 1.0 : 12),
}) {
  const box = bbox([candidate, ...authoritative]);
  const x0 = Math.floor(box.x0 / spacing) * spacing - 2 * spacing;
  const z0 = Math.floor(box.z0 / spacing) * spacing - 2 * spacing;
  const width = Math.ceil((box.x1 - x0) / spacing) + 3, height = Math.ceil((box.z1 - z0) / spacing) + 3;
  const grid = { width, height, x0, z0, spacing };
  const brk = new Uint8Array(width * height), osm = new Uint8Array(width * height);
  for (const ring of authoritative) fillRing(ring, brk, grid);
  fillRing(candidate, osm, grid);
  const mask = new Uint8Array(width * height);
  let osmOnlyLand = 0, osmOnlyKept = 0, osmOutside = 0;
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const i = row * width + column;
    if (brk[i]) { mask[i] = 1; continue; }
    if (!osm[i]) continue;
    const x = x0 + (column + 0.5) * spacing, z = z0 + (row + 0.5) * spacing;
    if (!authoritativeScope(x, z)) { mask[i] = 1; osmOutside++; continue; }
    const h = dtm(x, z);
    if (h === null || Math.abs(h - level) <= dtmTolerance) { mask[i] = 1; osmOnlyKept++; } else osmOnlyLand++;
  }
  const { label, sizes } = labelComponents(mask, width, height);
  const minimumCells = minimumHectares * 10000 / (spacing * spacing);
  const rings = [];
  let droppedComponents = 0, cells = 0;
  for (let id = 1; id < sizes.length; id++) {
    if (sizes[id] < minimumCells) { droppedComponents++; continue; }
    const loops = traceLoops(i => label[i] === id, width, height);
    /* the outer boundary is the loop with the largest (clockwise, screen-space) area */
    let outer = null, outerArea = -Infinity;
    for (const loop of loops) {
      let area = 0;
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) area += (loop[j][0] * loop[i][1] - loop[i][0] * loop[j][1]);
      if (area > outerArea) { outerArea = area; outer = loop; }
    }
    const world = outer.map(([c, r]) => [x0 + c * spacing, z0 + r * spacing]);
    rings.push({ ring: simplifyRing(world, toleranceAt), cells: sizes[id], hectares: +(sizes[id] * spacing * spacing / 10000).toFixed(1) });
    cells += sizes[id];
  }
  rings.sort((p, q) => q.cells - p.cells);
  return {
    rings,
    cells,
    hectares: +(cells * spacing * spacing / 10000).toFixed(1),
    spacing,
    dropped: { osmOnlyLandHectares: +(osmOnlyLand * spacing * spacing / 10000).toFixed(1), components: droppedComponents },
    kept: { osmOnlyInsideScopeHectares: +(osmOnlyKept * spacing * spacing / 10000).toFixed(1), osmOutsideScopeHectares: +(osmOutside * spacing * spacing / 10000).toFixed(1) },
  };
}
