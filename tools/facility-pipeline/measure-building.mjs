#!/usr/bin/env node
/* A building's levels, read off the laser along its own axes: what an authored model is built from.

   node tools/facility-pipeline/measure-building.mjs --points <build>/cache/microterrain/<target>.points.json \
     --context <build>/mapping/context.geojson --building <feature id> [--cell 2] [--out <report.json>]

   A campus model starts from measured levels, not from a photograph: the ground at the walls, the eaves, the
   breaks in the roof, the ridge, a tower's top. The points come from packages/course-geo/intake/
   acquire-microterrain-laser.mjs (dense returns round a named target); the footprint is the mapped building's.
   This lays the returns on the building's own axes (u along its long side, v across it, origin at the footprint's
   centre) and prints:
   - the ground round the walls;
   - the levels the roof stands at (heights where many returns gather), from the eaves to the highest part;
   - the roof's height in cells, to read where each level is: wings, the main block, a tower.
   Laser returns are sparse on steep faces and absent under eaves: read a level off several cells, and take the
   order of a facade (windows, doors, a porch) from a photograph. The report names what it measured, never a shape. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] : NaN);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function inside(p, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function edgeGap(p, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t));
  }
  return best;
}

/** The footprint's own frame: the edge direction whose bounding rectangle is smallest, with u along the longer side. */
export function buildingFrame(ring) {
  const points = ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] ? ring.slice(0, -1) : ring;
  let best = null;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!(length > 0.5)) continue;
    const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length;
    const us = points.map(p => p[0] * ux + p[1] * uy), vs = points.map(p => -p[0] * uy + p[1] * ux);
    const w = Math.max(...us) - Math.min(...us), h = Math.max(...vs) - Math.min(...vs);
    if (!best || w * h < best.area - 1e-6) best = { area: w * h, ux, uy, w, h, u0: (Math.max(...us) + Math.min(...us)) / 2, v0: (Math.max(...vs) + Math.min(...vs)) / 2 };
  }
  let { ux, uy, w, h, u0, v0 } = best;
  let origin = [u0 * ux - v0 * uy, u0 * uy + v0 * ux];
  if (h > w) { [ux, uy] = [-uy, ux]; [w, h] = [h, w]; } // u along the longer side
  if (ux < 0 || (Math.abs(ux) < 1e-9 && uy < 0)) { ux = -ux; uy = -uy; } // and pointing east
  const u = [ux, uy], v = [-uy, ux];
  const toLocal = p => [(p[0] - origin[0]) * u[0] + (p[1] - origin[1]) * u[1], (p[0] - origin[0]) * v[0] + (p[1] - origin[1]) * v[1]];
  return { origin: origin.map(x => round(x)), u: u.map(x => round(x, 4)), v: v.map(x => round(x, 4)), length: round(w), width: round(h), points, toLocal,
    bearingDegrees: round((Math.atan2(u[0], u[1]) * 180 / Math.PI + 360) % 360, 1) };
}

/** Heights where the roof's returns gather: peaks of a 0.25 m histogram holding at least `share` of the roof's returns. */
export function roofLevels(heights, { bin = 0.25, share = 0.02 } = {}) {
  if (!heights.length) return [];
  const lo = Math.floor(Math.min(...heights) / bin) * bin, counts = new Map();
  for (const z of heights) { const k = Math.round((z - lo) / bin); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const at = k => counts.get(k) ?? 0, peaks = [];
  for (const [k, n] of counts) if (n >= share * heights.length && n >= at(k - 1) && n > at(k + 1)) peaks.push({ height: round(lo + k * bin), returns: n });
  return peaks.sort((a, b) => a.height - b.height);
}

export function measureBuilding(points, ring, { cell = 2, margin = 3 } = {}) {
  const frame = buildingFrame(ring), footprint = frame.points;
  const ground = [], roof = [];
  for (const [e, n, z, kind] of points) {
    const p = [e, n], within = inside(p, footprint), gap = edgeGap(p, footprint);
    if (within && gap > 0.4) roof.push([e, n, z]);
    else if (!within && gap > 1 && gap < 8 && (kind === 2 || kind === undefined)) ground.push(z);
  }
  if (!roof.length) throw new Error('no laser returns on this footprint: is it inside the target\'s window?');
  const groundSorted = ground.slice().sort((a, b) => a - b), groundLevel = quantile(groundSorted, 0.5);
  const heights = roof.map(p => p[2]).filter(z => z > groundLevel + 1.5).sort((a, b) => a - b);
  const halfU = frame.length / 2 + margin, halfV = frame.width / 2 + margin, columns = Math.ceil(2 * halfU / cell), rows = Math.ceil(2 * halfV / cell);
  const cells = Array.from({ length: rows }, () => Array.from({ length: columns }, () => []));
  for (const [e, n, z] of points) {
    const [u, v] = frame.toLocal([e, n]), c = Math.floor((u + halfU) / cell), r = Math.floor((halfV - v) / cell);
    if (r >= 0 && r < rows && c >= 0 && c < columns) cells[r][c].push(z);
  }
  const grid = cells.map(row => row.map(zs => (zs.length ? round(Math.max(...zs), 1) : null)));
  return {
    frame: { originEpsg3006: frame.origin, u: frame.u, v: frame.v, lengthMetres: frame.length, widthMetres: frame.width, uBearingDegrees: frame.bearingDegrees },
    groundRh2000: { median: round(groundLevel), low: round(quantile(groundSorted, 0.1)), high: round(quantile(groundSorted, 0.9)), returns: ground.length },
    roofRh2000: { returns: heights.length, eavesAbout: round(quantile(heights, 0.1)), median: round(quantile(heights, 0.5)), high: round(quantile(heights, 0.98)), top: round(heights.at(-1) ?? NaN),
      levels: roofLevels(heights) },
    cells: { metres: cell, uFrom: round(-halfU), vFrom: round(halfV), highestReturn: grid },
  };
}

export function printable(report) {
  const { frame, groundRh2000: g, roofRh2000: r, cells } = report;
  const head = [
    `frame   origin E ${frame.originEpsg3006[0]} N ${frame.originEpsg3006[1]}, u = (${frame.u.join(', ')}) at bearing ${frame.uBearingDegrees} deg, ${frame.lengthMetres} x ${frame.widthMetres} m`,
    `ground  ${g.median} m RH 2000 at the walls (${g.low} to ${g.high}, ${g.returns} returns)`,
    `roof    eaves about ${r.eavesAbout}, most of it ${r.median}, high parts ${r.high}, top ${r.top} (${r.returns} returns)`,
    `levels  ${r.levels.map(l => `${l.height} (${l.returns})`).join('  ')}`,
    `cells   ${cells.metres} m, highest return in each, u from ${cells.uFrom} rightwards, v from ${cells.vFrom} downwards:`,
  ];
  const rows = cells.highestReturn.map((row, i) => `${String(round(cells.vFrom - (i + 0.5) * cells.metres, 1)).padStart(6)} ${row.map(z => (z === null ? '    .' : String(z.toFixed(1)).padStart(5))).join('')}`);
  return [...head, ...rows].join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  if (!flag('points') || !flag('context') || !flag('building')) throw new Error('usage: measure-building.mjs --points <points.json> --context <context.geojson> --building <feature id> [--cell 2] [--out <report.json>]');
  const feature = JSON.parse(fs.readFileSync(flag('context'), 'utf8')).features.find(f => String(f.id) === flag('building'));
  if (!feature) throw new Error(`no feature ${flag('building')} in ${flag('context')}`);
  const ring = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates[0][0] : feature.geometry.coordinates[0];
  const report = { building: flag('building'), points: flag('points'), ...measureBuilding(JSON.parse(fs.readFileSync(flag('points'), 'utf8')).points, ring, { cell: Number(flag('cell') ?? 2) }) };
  if (flag('out')) fs.writeFileSync(flag('out'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(printable(report));
}
