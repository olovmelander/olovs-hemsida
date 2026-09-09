#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { VISBY_FRAME, projected } from '../frame.mjs';
import { pointInPoly } from '../../geobuild/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TEES = ['63', '59', '55', '51', '46', '41'];
const intersects = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

// Snap OUTWARDS on the native image lattice, never on the local game origin.
// Pixel edges and centres are deliberately distinct from one another.
export function nativeWindow(points, discovery, margin = 40) {
  if (!points.length || points.some(p => p.length !== 2 || !p.every(Number.isFinite))) throw new Error('Window needs finite projected points');
  const resolution = discovery.orthophoto.resolutionMetres;
  const anchor = discovery.orthophoto.items[0].projBbox;
  if (!(resolution > 0) || !anchor) throw new Error('Native image grid is missing');
  const snap = (value, origin, upper) => +(origin + (upper ? Math.ceil : Math.floor)((value - origin) / resolution + (upper ? -1e-7 : 1e-7)) * resolution).toFixed(6);
  const box = [snap(Math.min(...points.map(p => p[0])) - margin, anchor[0], false),
    snap(Math.min(...points.map(p => p[1])) - margin, anchor[1], false),
    snap(Math.max(...points.map(p => p[0])) + margin, anchor[0], true),
    snap(Math.max(...points.map(p => p[1])) + margin, anchor[1], true)];
  const aoi = discovery.aoi.bboxEpsg3006;
  if (box[0] < aoi[0] || box[1] < aoi[1] || box[2] > aoi[2] || box[3] > aoi[3]) throw new Error('Review window exceeds discovered Visby coverage');
  return box;
}

export function buildOrthoReviewPlan(model, discovery, { fullCourse = false } = {}) {
  if (discovery.groundId !== 'visby' || !discovery.orthophoto?.coverage?.complete || model.holes?.length !== 18 ||
      model.frame !== VISBY_FRAME.text) {
    throw new Error('Expected complete Visby discovery and the grid-authored eighteen-hole model');
  }
  const windows = [];
  const resolution = discovery.orthophoto.resolutionMetres;
  const add = (id, purpose, points, detail = {}, margin = 40) => {
    const bounds = nativeWindow(points.map(projected), discovery, margin);
    const width = Math.round((bounds[2] - bounds[0]) / resolution), height = Math.round((bounds[3] - bounds[1]) / resolution);
    if (width * height > 16e6) throw new Error(`${id} exceeds the 16 Mpx window budget`);
    const sources = discovery.orthophoto.items.filter(item => intersects(bounds, item.projBbox));
    if (!sources.length) throw new Error(`${id} has no intersecting source image`);
    windows.push({ id, purpose, ...detail, boundsEpsg3006: bounds, width, height,
      megapixels: +(width * height / 1e6).toFixed(3), sourceIds: sources.map(s => s.id) });
  };
  // Begin with the disputed tee area, not a crop of the already-known turf.
  for (const n of [12, 3, 9, ...model.holes.map(h => h.n).filter(n => ![12, 3, 9].includes(n))]) {
    const hole = model.holes.find(h => h.n === n);
    const pads = hole.tees.pads || [], marks = hole.tees.marks || [];
    const unresolvedTees = marks.flatMap((m, i) => pads.some(p => pointInPoly(...m.c, p.ring)) ? [] : [TEES[i]]);
    const points = [...pads.flatMap(p => p.ring), ...marks.map(m => m.c), hole.line[0]];
    // H12's documented virtual start is north of the possible physical start.
    // A wider search is a review extent, never a replacement tee coordinate.
    add(`hole-${String(n).padStart(2, '0')}-tees`, 'physical platforms and numbered tee associations', points,
      { hole: n, unresolvedTees, mappedPlatforms: pads.length, priority: n === 12 || n === 3 ? 'high' : unresolvedTees.length ? 'high' : 'check' }, n === 12 ? 150 : 45);
  }
  for (const n of [9, 3, ...(fullCourse ? model.holes.map(h => h.n).filter(n => ![9, 3].includes(n)) : [])]) {
    const hole = model.holes.find(h => h.n === n);
    add(`hole-${String(n).padStart(2, '0')}-green`, n === 9 ? 'putting surface versus approach complex' : n === 3 ? 'post-2022 rebuilt green and surrounds' : 'current putting surface, collar and bunkers',
      [...hole.green.ring, ...(hole.bunkers || []).flatMap(b => b.ring || b)], { hole: n, priority: 'high' }, 45);
  }
  if (model.scenery.range?.length) add('range-practice', 'range boundary, practice greens and visible facilities', model.scenery.range.flat(), { priority: 'high' }, 65);
  add('clubhouse-finish', 'clubhouse, putting green, finish and coastal access',
    [...model.holes.find(h => h.n === 18).green.ring, ...model.holes.find(h => h.n === 1).tees.pads.flatMap(p => p.ring)], { priority: 'check' }, 65);
  if (fullCourse) {
    // Cover the entire authorized discovery AOI, including the surrounding
    // woodland and buildings, on a gap-free native grid. Trim <1 source pixel
    // at the outside boundary instead of requesting beyond that AOI.
    const anchor = discovery.orthophoto.items[0].projBbox, aoi = discovery.aoi.bboxEpsg3006;
    const pixel = (v, axis, upper) => anchor[axis] + (upper ? Math.floor : Math.ceil)((v - anchor[axis]) / resolution) * resolution;
    const box = [pixel(aoi[0], 0, false), pixel(aoi[1], 1, false), pixel(aoi[2], 0, true), pixel(aoi[3], 1, true)];
    const side = 3200 * resolution;
    for (let row = 0, north = box[3]; north > box[1] + 1e-6; row++, north -= side) {
      for (let col = 0, west = box[0]; west < box[2] - 1e-6; col++, west += side) {
        const east = Math.min(west + side, box[2]), south = Math.max(north - side, box[1]);
        const local = ([e,n]) => [e - VISBY_FRAME.easting, VISBY_FRAME.northing - n];
        add(`context-${row}-${col}`, 'complete AOI: playing surfaces, trees, woodland, buildings and access',
          [[west,south],[east,north]].map(local), { priority:'context', row, col }, 0);
      }
    }
  }
  return {
    schemaVersion: 1, groundId: 'visby', kind: 'authenticated-orthophoto-review-plan',
    collection: discovery.orthophoto.collection, horizontalCrs: 'EPSG:3006', resolutionMetres: resolution,
    frame: VISBY_FRAME, captureRange: discovery.orthophoto.captureRange,
    pixelConvention: 'bounds are pixel edges; centre E=minE+(column+0.5)*resolution, N=maxN-(row+0.5)*resolution',
    modelSha256: createHash('sha256').update(JSON.stringify(model)).digest('hex'),
    sources: discovery.orthophoto.items.map(i => ({ id: i.id, href: i.assets.data.href, boundsEpsg3006: i.projBbox,
      width: i.assets.data.projShape[1], height: i.assets.data.projShape[0], capturedAt: i.capturedAt, bytes: i.assets.data.bytes })),
    windows, summary: { windows: windows.length, fullCourse, contextWindows: windows.filter(w => w.priority === 'context').length,
      teeReferences: 108, unresolvedTeeReferences: windows.reduce((n, w) => n + (w.unresolvedTees?.length || 0), 0),
      totalMegapixels: +windows.reduce((n, w) => n + w.megapixels, 0).toFixed(3) },
    limitations: ['Review extents do not establish a feature boundary or numbered tee identity.', 'The April flight and 2024 terrain/laser are different epochs.',
      'Raw imagery stays in the ignored cache; this plan changes no runtime geometry.'],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(a => a.startsWith('--') && a !== '--full-course')) throw new Error('Unknown orthophoto planning option');
  const plan = buildOrthoReviewPlan(JSON.parse(fs.readFileSync(path.join(ROOT, 'visbybuild/course-model.json'))),
    JSON.parse(fs.readFileSync(path.join(ROOT, 'geo_data/course-v2/visby/acquisition/d2-discovery.json'))), { fullCourse: args.includes('--full-course') });
  const output = args.find(a => !a.startsWith('--')) || path.join(ROOT, 'visbybuild/cache/lm-ortho/plan.json');
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(plan, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...plan.summary }));
}
