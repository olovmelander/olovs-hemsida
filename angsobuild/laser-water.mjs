/* Mälaren, read off the laser ground.

   OpenStreetMap gives this course one ring of the lake -- the western bay,
   clipped at the extract's edge -- and nothing at all on the south and east
   shores, where the camping's beaches and piers stand. The 1 m DTM knows the
   whole lake: laser does not penetrate water, so Markhöjdmodell over Mälaren
   is the lake's SURFACE, flat to a few centimetres per flight strip, while
   the shore climbs away from it at once. This finds those flats in a raster
   sampled through the pack's own bridge, keeps the ones that are the lake and
   not a flat field beside it, and hands back three things:

     - the lake MASK on the 4 m lattice that HF0 and HF1 sit on, so
       build-heightfields can sink a bed under it (a laser plate under a water
       sheet at the same height is a lake that flickers, and a plate ABOVE a
       sheet is dry land -- the flight strips here sit 0.72 to 0.96 m);
     - the lake LEVEL, the median of the plate inside the course window;
     - shoreline RINGS for the near field, traced from the mask and simplified,
       so the page's shore benches, wet-sand bands, reeds and scatter tests all
       see a real shoreline. Rings are hole-free by measurement: the census
       counts 421 islands in the far field and none inside the HF0 box, and
       any island a ring does enclose is keyholed or reported.

   Which flats are the lake: every component within 0.2 m of the regulated
   level that is either large (>= 100 ha) or within 60 m of one that is --
   a flight-strip seam splits the plate into components 0.1 m apart, and a
   flat wet meadow at the same height does not touch the lake.              */
import { detectFlatWater } from '../apps/golf/src/engine/v2-flat-water.mjs';
import { squaredDistanceTransform } from '../packages/course-v2/distance-transform.mjs';
import { simplifyDP } from './lib.mjs';

export const MALAREN_REGULATED_LEVEL = 0.84;   /* m RH 2000, the OSM bay ring's interior median */
export const LEVEL_BAND = 0.20;
export const LARGE_HECTARES = 100;
export const SEAM_METRES = 60;

/** Sample the published ground onto the pack-frame lattice and find the lake. */
export function detectMalaren({ sampleAt, spacing = 4, half = 7520, courseBox, log = () => {} }) {
  const width = Math.round(2 * half / spacing) + 1, height = width;
  const x0 = -half, z0 = -half;
  const heights = new Float32Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const v = sampleAt(x0 + c * spacing, z0 + r * spacing);
      heights[r * width + c] = v == null ? Number.NaN : v;
    }
  }
  const flats = detectFlatWater({
    raster: { width, height, spacing, x0, z0, heights },
    knownBodies: [],
    flatToleranceMetres: 0.03,
    minimumCells: Math.round(10000 / (spacing * spacing)),
  });
  const inBand = flats.components.filter(c => Math.abs(c.surfaceHeight - MALAREN_REGULATED_LEVEL) <= LEVEL_BAND);
  const accepted = new Set(inBand.filter(c => c.hectares >= LARGE_HECTARES).map(c => c.id));
  /* grow across strip seams: a band component within SEAM_METRES of the lake is the lake */
  const seamCells = Math.ceil(SEAM_METRES / spacing);
  for (let pass = 0; pass < 4; pass++) {
    const before = accepted.size;
    const dist = squaredDistanceTransform(width, height, i => accepted.has(flats.label[i]));
    for (const c of inBand) {
      if (accepted.has(c.id)) continue;
      let near = false;
      for (let r = c.minRow; r <= c.maxRow && !near; r++) {
        for (let col = c.minColumn; col <= c.maxColumn; col++) {
          const i = r * width + col;
          if (flats.label[i] === c.id && dist[i] <= seamCells * seamCells) { near = true; break; }
        }
      }
      if (near) accepted.add(c.id);
    }
    if (accepted.size === before) break;
  }
  const rejected = inBand.filter(c => !accepted.has(c.id));
  const mask = new Uint8Array(width * height);
  let lakeCells = 0;
  for (let i = 0; i < mask.length; i++) if (accepted.has(flats.label[i])) { mask[i] = 1; lakeCells++; }

  /* the level: the plate's median inside the course window, where a visitor looks */
  const inWindow = [];
  for (let r = 0; r < height; r++) {
    const z = z0 + r * spacing;
    if (z < courseBox.z0 || z > courseBox.z1) continue;
    for (let c = 0; c < width; c++) {
      const x = x0 + c * spacing;
      if (x < courseBox.x0 || x > courseBox.x1) continue;
      const i = r * width + c;
      if (mask[i]) inWindow.push(heights[i]);
    }
  }
  inWindow.sort((a, b) => a - b);
  const level = inWindow.length ? inWindow[Math.floor(inWindow.length / 2)] : MALAREN_REGULATED_LEVEL;
  const mean = inWindow.reduce((s, v) => s + v, 0) / (inWindow.length || 1);
  const spread = Math.sqrt(inWindow.reduce((s, v) => s + (v - mean) ** 2, 0) / (inWindow.length || 1));
  log(`lake: ${accepted.size} components accepted (${(lakeCells * spacing * spacing / 1e4).toFixed(0)} ha), ` +
      `${rejected.length} in-band flats rejected as not the lake; level ${level.toFixed(3)} m over ${inWindow.length} window cells (sd ${spread.toFixed(3)})`);

  /* the bed: distance from the shore, in metres, for every lake cell */
  const shoreDist = squaredDistanceTransform(width, height, i => !mask[i]);
  return Object.freeze({
    raster: { width, height, spacing, x0, z0, heights },
    mask, level, spread, windowCells: inWindow.length,
    components: flats.components.filter(c => accepted.has(c.id)),
    rejected,
    /** metres of bed below the level at a lattice point; 0 off the lake */
    bedDepthAt(x, z) {
      const c = Math.round((x - x0) / spacing), r = Math.round((z - z0) / spacing);
      if (c < 0 || r < 0 || c >= width || r >= height) return 0;
      const i = r * width + c;
      if (!mask[i]) return 0;
      const d = Math.sqrt(shoreDist[i]) * spacing;
      const t = Math.min(1, Math.max(0, d / 55));
      return 0.15 + 3.35 * t * t * (3 - 2 * t);
    },
    isLakeAt(x, z) {
      const c = Math.round((x - x0) / spacing), r = Math.round((z - z0) / spacing);
      if (c < 0 || r < 0 || c >= width || r >= height) return false;
      return mask[r * width + c] === 1;
    },
  });
}

/** Trace the lake mask inside a clip box into simple rings (outer loops), with
    islands above `keyholeHectares` keyholed into their outer ring and smaller
    ones left to the water mesh (their ground stands above the level anyway). */
export function traceShore(lake, { clip, tolerance = 2, keyholeHectares = 1, forbidKeyholeBox = null, mask = null, label = 'shore', log = () => {} }) {
  const { width, height, spacing, x0, z0 } = lake.raster;
  const cells = mask || lake.mask;
  const c0 = Math.max(0, Math.ceil((clip.x0 - x0) / spacing)), c1 = Math.min(width - 1, Math.floor((clip.x1 - x0) / spacing));
  const r0 = Math.max(0, Math.ceil((clip.z0 - z0) / spacing)), r1 = Math.min(height - 1, Math.floor((clip.z1 - z0) / spacing));
  const inside = (c, r) => c >= c0 && c <= c1 && r >= r0 && r <= r1 && cells[r * width + c] === 1;
  /* directed boundary edges with the water on the left, keyed by start corner */
  const key = (c, r) => r * (width + 1) + c;
  const next = new Map();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!inside(c, r)) continue;
      if (!inside(c, r - 1)) next.set(key(c, r), key(c + 1, r));         /* north side: west -> east */
      if (!inside(c + 1, r)) next.set(key(c + 1, r), key(c + 1, r + 1)); /* east side: north -> south */
      if (!inside(c, r + 1)) next.set(key(c + 1, r + 1), key(c, r + 1)); /* south side: east -> west */
      if (!inside(c - 1, r)) next.set(key(c, r + 1), key(c, r));         /* west side: south -> north */
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let k = start;
    while (!seen.has(k)) {
      seen.add(k);
      const c = k % (width + 1), r = (k - c) / (width + 1);
      loop.push([x0 + (c - 0.5) * spacing, z0 + (r - 0.5) * spacing]);
      k = next.get(k);
      if (k === undefined) break;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  const area = ring => { let a = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  /* outer or hole by CONTAINMENT, not by winding -- a loop inside an odd number
     of larger loops is a hole (an island), inside an even number an outer (a
     lake, or a pond on an island). Orientation-free, so a z-south frame cannot
     invert it. Slivers under 0.05 ha are the clip box cutting a one-cell arm. */
  loops.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  /* Ask the containment question at a point that is genuinely INSIDE the loop.
     These loops are marched along cell edges, so every vertex sits exactly on a
     cell corner that the neighbouring loop shares -- point-in-polygon on such a
     point is a coin flip, and one bad toss makes an island read as an outer.
     That is how a 0.3 ha ring came to be drawn over the strait it lies in, two
     coplanar sheets over one water. A scanline-span midpoint is inside by
     construction (the same rule the bunker probes use, for the same reason). */
  const insidePoint = loop => {
    let z0 = Infinity, z1 = -Infinity;
    for (const [, z] of loop) { if (z < z0) z0 = z; if (z > z1) z1 = z; }
    const z = (z0 + z1) / 2;
    const xs = [];
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, zi] = loop[i], [xj, zj] = loop[j];
      if ((zi > z) !== (zj > z)) xs.push((xj - xi) * (z - zi) / (zj - zi) + xi);
    }
    xs.sort((a, b) => a - b);
    if (xs.length < 2) return loop[0];
    /* the widest span at this scanline, so a thin arm cannot supply the point */
    let best = 0, bw = -1;
    for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] - xs[k] > bw) { bw = xs[k + 1] - xs[k]; best = k; }
    return [(xs[best] + xs[best + 1]) / 2, z];
  };
  const probe = loops.map(insidePoint);
  const depth = loops.map((loop, index) => {
    let d = 0;
    for (let j = 0; j < index; j++) if (pointInRing(probe[index][0], probe[index][1], loops[j])) d++;
    return d;
  });
  const outers = loops.filter((loop, i) => depth[i] % 2 === 0 && Math.abs(area(loop)) >= 500);
  const holes = loops.filter((loop, i) => depth[i] % 2 === 1);
  const rings = outers.map(loop => ({ ring: simplifyClosed(loop, tolerance), area: Math.abs(area(loop)), islands: [] }));
  let flooded = 0, keyholed = 0, skipped = 0;
  for (const hole of holes) {
    const ha = Math.abs(area(hole)) / 1e4;
    const cx = hole.reduce((s, p) => s + p[0], 0) / hole.length, cz = hole.reduce((s, p) => s + p[1], 0) / hole.length;
    const owner = rings.find(r => pointInRing(cx, cz, r.ring));
    if (!owner) continue;
    if (ha < keyholeHectares) { flooded++; owner.islands.push({ hectares: +ha.toFixed(2), x: Math.round(cx), z: Math.round(cz), treatment: 'flooded-by-mesh' }); continue; }
    const island = simplifyClosed(hole, tolerance);
    /* slit to the nearest outer vertex whose slit stays out of the carved box:
       inside it the slit's two coincident edges would read as a shoreline to
       ringSD and raise a bank across the lake bed */
    const pairs = [];
    for (let i = 0; i < owner.ring.length; i++) {
      for (let j = 0; j < island.length; j++) {
        pairs.push({ d: Math.hypot(owner.ring[i][0] - island[j][0], owner.ring[i][1] - island[j][1]), i, j });
      }
    }
    pairs.sort((p, q) => p.d - q.d);
    const best = pairs.find(p => !forbidKeyholeBox || !segmentMeetsBox(owner.ring[p.i], island[p.j], forbidKeyholeBox)) || null;
    if (!best) { skipped++; owner.islands.push({ hectares: +ha.toFixed(2), x: Math.round(cx), z: Math.round(cz), treatment: 'flooded-by-mesh (every keyhole would cross the carved box)' }); continue; }
    const rotated = [...island.slice(best.j), ...island.slice(0, best.j)];
    owner.ring = [...owner.ring.slice(0, best.i + 1), ...rotated, island[best.j], ...owner.ring.slice(best.i)];
    owner.islands.push({ hectares: +ha.toFixed(2), x: Math.round(cx), z: Math.round(cz), treatment: 'keyholed', slitMetres: +best.d.toFixed(1) });
    keyholed++;
  }
  rings.sort((a, b) => b.area - a.area);
  log(`${label}: ${outers.length} rings from ${loops.length} loops in the clip box, ${rings.reduce((s, r) => s + r.ring.length, 0)} points after ${tolerance} m simplification; islands ${keyholed} keyholed, ${flooded} small flooded, ${skipped} skipped`);
  return rings;
}

/** The reed belt: shore ground the laser reads just above the lake -- within
    `bandMetres` of the level and `reachMetres` of open water, not itself a
    flat plate -- which on Mälaren is vass standing on its own litter mat. The
    imagery shows exactly that band along every shore the course meets. */
export function detectReeds(lake, { bandMetres = 0.9, reachMetres = 120 } = {}) {
  const { width, height, spacing, heights } = lake.raster;
  const near = squaredDistanceTransform(width, height, i => lake.mask[i] === 1);
  const reach = (reachMetres / spacing) ** 2;
  const mask = new Uint8Array(width * height);
  let cells = 0;
  for (let i = 0; i < mask.length; i++) {
    if (lake.mask[i]) continue;
    const h = heights[i];
    if (!Number.isFinite(h) || h <= lake.level || h > lake.level + bandMetres) continue;
    if (near[i] > reach) continue;
    mask[i] = 1; cells++;
  }
  return { mask, hectares: +(cells * spacing * spacing / 1e4).toFixed(1) };
}

function simplifyClosed(loop, tolerance) {
  /* DP on a closed loop: split at the two farthest-apart vertices so no seam is privileged */
  let far = 0, fi = 0;
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if (d > far) { far = d; fi = i; }
  }
  const a = simplifyDP(loop.slice(0, fi + 1), tolerance);
  const b = simplifyDP([...loop.slice(fi), loop[0]], tolerance);
  const ring = [...a.slice(0, -1), ...b.slice(0, -1)];
  return ring.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segmentMeetsBox(a, b, box) {
  const insideBox = p => p[0] > box.x0 && p[0] < box.x1 && p[1] > box.z0 && p[1] < box.z1;
  if (insideBox(a) || insideBox(b)) return true;
  const steps = 64;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (insideBox([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])) return true;
  }
  return false;
}
