import { SURFACE } from './surface.js';

// Keep the parking compiler's existing material contract in the fallback too.
export function parkingSurface(item) {
  return /\b(asphalt|paved)\b/i.test(item?.surface || '') ? SURFACE.ASPHALT : SURFACE.GRAVEL;
}

// Shared by the terrain surface compiler and road ribbons. Untagged local
// access roads use the generic gravel display; unknown does not mean asphalt.
export function roadSurface(item) {
  const value = (item?.surface || '').toLowerCase();
  if (/\b(asphalt|paved|concrete)\b/.test(value)) return SURFACE.ASPHALT;
  if (/mud/.test(value)) return SURFACE.MUD;
  if (/dirt|ground|earth|soil/.test(value)) return SURFACE.DIRT;
  if (/gravel|unpaved|compacted|pebble|sand/.test(value)) return SURFACE.GRAVEL;
  if (/^(trunk|secondary|tertiary|cycleway)$/.test(item?.kind || '')) return SURFACE.ASPHALT;
  return SURFACE.GRAVEL;
}

/** Partition even long sparse segments at the terrain's surface coverage.
 * A strip must stop at the boundary instead of spanning from a distant source
 * vertex over ground that already renders the same road. */
export function splitRoadCoverage(line, coveredAt, step = 3) {
  const result = { covered: [], uncovered: [] };
  if (line.length < 2) return result;
  const points = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 1; j <= n; j++) points.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
  }
  let covered = coveredAt(...points[0]), run = [points[0]];
  const finish = () => { if (run.length >= 2) result[covered ? 'covered' : 'uncovered'].push(run); };
  for (let i = 1; i < points.length; i++) {
    const next = coveredAt(...points[i]);
    if (next !== covered) {
      let a = points[i - 1], b = points[i];
      for (let j = 0; j < 12; j++) {
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (coveredAt(...mid) === covered) a = mid; else b = mid;
      }
      const boundary = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      run.push(boundary); finish(); covered = next; run = [boundary];
    }
    run.push(points[i]);
  }
  finish();
  // Preserve the source segmentation in uniform coverage. Distant roads can
  // then retain their coarser mesh sampling instead of acquiring 3 m vertices.
  if (!result.covered.length) result.uncovered = [line];
  else if (!result.uncovered.length) result.covered = [line];
  return result;
}
