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
function bbox(rings) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const ring of rings) for (const [x, z] of ring) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return { x0, z0, x1, z1 };
}

/** Scanline-fill `ring` into `target` (1 where the cell centre is inside). */
function fillRing(ring, target, { width, height, x0, z0, spacing }) {
  const n = ring.length;
  for (let row = 0; row < height; row++) {
    const z = z0 + (row + 0.5) * spacing;
    const crossings = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > z) !== (b[1] > z)) crossings.push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    crossings.sort((p, q) => p - q);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((crossings[k] - x0) / spacing - 0.5));
      const c1 = Math.min(width - 1, Math.floor((crossings[k + 1] - x0) / spacing - 0.5));
      for (let c = c0; c <= c1; c++) target[row * width + c] = 1;
    }
  }
}

/** Label 4-connected components; returns { label: Int32Array, sizes: number[] } (label 0 = none). */
function labelComponents(mask, width, height) {
  const label = new Int32Array(width * height);
  const sizes = [0];
  const stack = [];
  for (let seed = 0; seed < mask.length; seed++) {
    if (!mask[seed] || label[seed]) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(seed); label[seed] = id;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const column = i % width, row = (i - column) / width;
      if (column > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = id; stack.push(i - 1); }
      if (column < width - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = id; stack.push(i + 1); }
      if (row > 0 && mask[i - width] && !label[i - width]) { label[i - width] = id; stack.push(i - width); }
      if (row < height - 1 && mask[i + width] && !label[i + width]) { label[i + width] = id; stack.push(i + width); }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

/** Trace the boundary loops of the cells labelled `id`, as lattice-corner
    loops. Each water cell contributes its four edges clockwise (x right,
    z down); interior edges cancel, and at a saddle corner the loop turns
    right so diagonally touching regions stay separate loops. Outer
    boundaries come out clockwise in screen space, holes anticlockwise. */
function traceLoops(label, id, width, height) {
  const key = (c, r) => r * (width + 1) + c;
  const out = new Map();  /* start corner -> [{to, dir}] */
  const isWater = (c, r) => c >= 0 && r >= 0 && c < width && r < height && label[r * width + c] === id;
  const add = (c0, r0, c1, r1, dir) => {
    const k = key(c0, r0);
    const list = out.get(k) || [];
    list.push({ to: key(c1, r1), c: c1, r: r1, dir });
    out.set(k, list);
  };
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
    if (label[r * width + c] !== id) continue;
    if (!isWater(c, r - 1)) add(c, r, c + 1, r, 0);          /* top: east */
    if (!isWater(c + 1, r)) add(c + 1, r, c + 1, r + 1, 1);  /* right: south */
    if (!isWater(c, r + 1)) add(c + 1, r + 1, c, r + 1, 2);  /* bottom: west */
    if (!isWater(c - 1, r)) add(c, r + 1, c, r, 3);          /* left: north */
  }
  const loops = [];
  for (const [startKey, edges] of out) {
    while (edges.length) {
      const first = edges.pop();
      const loop = [[startKey % (width + 1), Math.floor(startKey / (width + 1))]];
      let current = first;
      let guard = 0;
      while (current.to !== startKey) {
        loop.push([current.c, current.r]);
        const next = out.get(current.to);
        if (!next?.length) throw new Error('lake boundary does not close');
        /* prefer the right turn (dir + 1 mod 4), then straight, then left */
        let pick = -1;
        for (const want of [(current.dir + 1) % 4, current.dir, (current.dir + 3) % 4]) {
          pick = next.findIndex(edge => edge.dir === want);
          if (pick >= 0) break;
        }
        if (pick < 0) pick = 0;
        current = next.splice(pick, 1)[0];
        if (++guard > 50_000_000) throw new Error('lake boundary trace runaway');
      }
      loop.push([current.c, current.r]);
      loop.pop(); /* the closing corner repeats the start */
      loops.push(loop);
    }
  }
  return loops;
}

/** Douglas–Peucker on a closed ring with a position-dependent tolerance. */
function simplifyRing(ring, toleranceAt) {
  if (ring.length < 4) return ring;
  /* split the closed ring at its two most distant points */
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < ring.length; i += Math.max(1, Math.floor(ring.length / 400))) {
    for (let j = i + 1; j < ring.length; j += Math.max(1, Math.floor(ring.length / 400))) {
      const d = (ring[i][0] - ring[j][0]) ** 2 + (ring[i][1] - ring[j][1]) ** 2;
      if (d > best) { best = d; a = i; b = j; }
    }
  }
  const keep = new Uint8Array(ring.length);
  keep[a] = 1; keep[b] = 1;
  const segDist = (p, u, v) => {
    const dx = v[0] - u[0], dz = v[1] - u[1], l = dx * dx + dz * dz;
    let t = l ? ((p[0] - u[0]) * dx + (p[1] - u[1]) * dz) / l : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dz);
  };
  const run = (i0, i1) => {
    /* indices i0..i1 walking forward around the ring (wrapping) */
    const count = (i1 - i0 + ring.length) % ring.length;
    if (count < 2) return;
    const u = ring[i0], v = ring[i1];
    let worst = -1, at = -1;
    for (let k = 1; k < count; k++) {
      const i = (i0 + k) % ring.length;
      const d = segDist(ring[i], u, v);
      if (d > worst) { worst = d; at = i; }
    }
    const mid = ring[at];
    if (worst > toleranceAt(mid[0], mid[1])) { keep[at] = 1; run(i0, at); run(at, i1); }
  };
  run(a, b); run(b, a);
  return ring.filter((_, i) => keep[i]);
}

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
    const loops = traceLoops(label, id, width, height);
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
