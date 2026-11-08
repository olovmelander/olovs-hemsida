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
