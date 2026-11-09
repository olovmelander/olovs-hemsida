/* The ground's playing geometry for the tree pipeline: every routing's hole
   lines and practice areas (driving range and practice greens), merged, and
   the play zone round them (from the Johannesberg pilot's build-candidates). */
import { loadGroundCourseGeometries, mergeCourseGeometries } from '../../packages/course-v2/vegetation/compile-vegetation.mjs';

/** Every routing of the ground, its merged geometry, hole lines and practice rings. */
export function playGeometry(ctx) {
  const groundCourses = loadGroundCourseGeometries(ctx.paths.geometryDir, ctx.groundId);
  const geometry = mergeCourseGeometries(groundCourses.map(c => c.geometry));
  const holeLines = groundCourses.flatMap(c => (c.geometry.holes || []).map(h => h.line).filter(l => Array.isArray(l) && l.length >= 2));
  const practiceRings = groundCourses.flatMap(c => {
    const sc = c.geometry.scenery || {};
    const range = Array.isArray(sc.range?.[0]?.[0]) ? sc.range : Array.isArray(sc.range) && sc.range.length ? [sc.range] : [];
    return [...range, ...(sc.practiceGreens || [])];
  }).filter(r => Array.isArray(r) && r.length >= 3);
  return { groundCourses, geometry, holeLines, practiceRings };
}

/** Is a point within `reach` metres of a polyline or inside / within reach of a ring? */
export function nearPlay(e, n, lines, rings, reach) {
  const segment = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - ay) * dy) / l2));
    return Math.hypot(ax + dx * t - e, ay + dy * t - n);
  };
  for (const line of lines) for (let i = 1; i < line.length; i++) if (segment(line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]) <= reach) return true;
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > n) !== (yj > n) && e < ((xj - xi) * (n - yi)) / (yj - yi) + xi) inside = !inside;
      if (segment(xi, yi, xj, yj) <= reach) return true;
    }
    if (inside) return true;
  }
  return false;
}

/** Shortest distance from a point to a polyline. */
export function lineDistance(e, n, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((e - ax) * dx + (n - ay) * dy) / l2));
    best = Math.min(best, Math.hypot(ax + dx * t - e, ay + dy * t - n));
  }
  return best;
}

/** Every mapped building footprint ring of the ground's routings (semantic exclusions' buildings). */
export function buildingRings(geometry) {
  return (geometry.infra?.buildings || []).map(b => b.ring).filter(r => Array.isArray(r) && r.length >= 3);
}

/**
 * A mask over a grid (minEasting, maxNorthing, width, height,
 * sampleSpacingMetres): 1 where a cell centre lies inside a building ring or
 * within bufferMetres of its edge. Round 6's width split never takes a top
 * there: the pit-free CHM keeps roofs as canopy.
 */
export function buildingMask(grid, rings, bufferMetres = 0.5) {
  const s = grid.sampleSpacingMetres;
  const mask = new Uint8Array(grid.width * grid.height);
  const maxE = grid.minEasting + grid.width * s, minN = grid.maxNorthing - grid.height * s;
  for (const ring of rings) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    x0 -= bufferMetres; y0 -= bufferMetres; x1 += bufferMetres; y1 += bufferMetres;
    if (x1 < grid.minEasting || x0 > maxE || y1 < minN || y0 > grid.maxNorthing) continue;
    const closed = [...ring, ring[0]];
    const c0 = Math.max(0, Math.floor((x0 - grid.minEasting) / s)), c1 = Math.min(grid.width - 1, Math.floor((x1 - grid.minEasting) / s));
    const r0 = Math.max(0, Math.floor((grid.maxNorthing - y1) / s)), r1 = Math.min(grid.height - 1, Math.floor((grid.maxNorthing - y0) / s));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const i = r * grid.width + c;
      if (mask[i]) continue;
      const e = grid.minEasting + (c + 0.5) * s, n = grid.maxNorthing - (r + 0.5) * s;
      let inside = false;
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [xa, ya] = ring[a], [xb, yb] = ring[b];
        if ((ya > n) !== (yb > n) && e < ((xb - xa) * (n - ya)) / (yb - ya) + xa) inside = !inside;
      }
      if (inside || lineDistance(e, n, closed) <= bufferMetres) mask[i] = 1;
    }
  }
  return mask;
}
