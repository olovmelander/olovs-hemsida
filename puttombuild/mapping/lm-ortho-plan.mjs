#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';
import { bboxIntersects, bboxIntersection, rectangleUnionArea } from '../../packages/course-geo/acquisition/stac.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const finitePair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// The model is geographic local metres. Grid north differs from true north here;
// adding x/z to the EPSG:3006 origin would rotate geometry by about 3.5 degrees.
export function projectedPoint(model, [x, z]) {
  return latLonToSweref99Tm(model.origin.lat - z / model.mPerLat, model.origin.lon + x / model.mPerLon);
}

export function nativeWindow(points, discovery, margin = 40) {
  if (!points.length || !points.every(finitePair) || !Number.isFinite(margin) || margin < 0) throw new Error('Expected finite projected points and a nonnegative margin');
  const resolution = discovery.orthophoto.resolutionMetres;
  const anchor = discovery.orthophoto.items[0].projBbox;
  const snap = (v, axis, upper) => +(anchor[axis] + (upper ? Math.ceil : Math.floor)((v - anchor[axis]) / resolution + (upper ? -1e-7 : 1e-7)) * resolution).toFixed(6);
  const bounds = [snap(Math.min(...points.map(p => p[0])) - margin, 0, false), snap(Math.min(...points.map(p => p[1])) - margin, 1, false),
    snap(Math.max(...points.map(p => p[0])) + margin, 0, true), snap(Math.max(...points.map(p => p[1])) + margin, 1, true)];
  const aoi = discovery.aoi.bboxEpsg3006;
  if (bounds[0] < aoi[0] || bounds[1] < aoi[1] || bounds[2] > aoi[2] || bounds[3] > aoi[3]) throw new Error('Review window exceeds discovered Puttom coverage');
  return bounds;
}

function holePoints(hole) {
  return [...hole.line, ...hole.green.ring, ...hole.fairway.rings.flat(), ...hole.tees.pads.flatMap(p => p.ring),
    ...hole.tees.marks.map(m => m.c), ...hole.bunkers.flatMap(b => b.ring)];
}
function coordinatePairs(value) {
  if (finitePair(value)) return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(coordinatePairs);
}

export function buildOrthoReviewPlan(model, discovery, { fullAoi = false } = {}) {
  if (discovery.groundId !== 'puttom' || !discovery.orthophoto?.coverage?.complete || model.holes?.length !== 18 ||
      model.frame !== 'local metres about ORIGIN; north -z, east +x' || !(model.mPerLat > 0 && model.mPerLon > 0)) throw new Error('Expected the eighteen-hole Puttom model and complete discovery');
  const resolution = discovery.orthophoto.resolutionMetres;
  const anchor = discovery.orthophoto.items[0].projBbox;
  if (!(resolution > 0) || discovery.orthophoto.items.some(i => i.projCode !== 'EPSG:3006' || i.spectralType !== 'rgbi' ||
      i.resolutionMetres !== resolution || i.projBbox.some((v, j) => Math.abs((v - anchor[j % 2]) / resolution - Math.round((v - anchor[j % 2]) / resolution)) > 1e-6))) throw new Error('Source images do not share one RGBI pixel lattice');
  const windows = [];
  const addBounds = (id, purpose, bounds, detail = {}) => {
    const width = Math.round((bounds[2] - bounds[0]) / resolution), height = Math.round((bounds[3] - bounds[1]) / resolution);
    if (!(width > 0 && height > 0) || width * height > 16e6) throw new Error(`${id} exceeds the 16 Mpx window budget`);
    const sources = discovery.orthophoto.items.filter(i => bboxIntersects(bounds, i.projBbox));
    const covered = rectangleUnionArea(sources.map(i => bboxIntersection(bounds, i.projBbox)));
    if (covered < (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) - 0.01) throw new Error(`${id} has incomplete source coverage`);
    windows.push({ id, purpose, ...detail, boundsEpsg3006: bounds, width, height,
      megapixels: +(width * height / 1e6).toFixed(3), sourceIds: sources.map(i => i.id) });
  };
  const add = (id, purpose, points, detail, margin = 45) => addBounds(id, purpose, nativeWindow(points.map(p => projectedPoint(model, p)), discovery, margin), detail);
  for (const h of model.holes) {
    add(`hole-${String(h.n).padStart(2, '0')}-tees`, 'physical tee platforms and current tee associations',
      [...h.tees.pads.flatMap(p => p.ring), ...h.tees.marks.map(m => m.c), h.line[0]], { hole: h.n, priority: 'detail' }, 65);
    add(`hole-${String(h.n).padStart(2, '0')}-green`, 'putting surface, collar and surrounding bunkers',
      h.green.ring, { hole: h.n, priority: 'detail' }, 65);
  }
  const coursePoints = [...model.holes.flatMap(holePoints), ...coordinatePairs(model.scenery)];
  let courseBounds = nativeWindow(coursePoints.map(p => projectedPoint(model, p)), discovery, 120);
  if (fullAoi) {
    const a = discovery.aoi.bboxEpsg3006;
    const inner = (v, axis, upper) => +(anchor[axis] + (upper ? Math.floor : Math.ceil)((v - anchor[axis]) / resolution) * resolution).toFixed(6);
    courseBounds = [inner(a[0], 0, false), inner(a[1], 1, false), inner(a[2], 0, true), inner(a[3], 1, true)];
  }
  const side = 3200 * resolution;
  for (let row = 0, north = courseBounds[3]; north > courseBounds[1] + 1e-6; row++, north -= side) {
    for (let col = 0, west = courseBounds[0]; west < courseBounds[2] - 1e-6; col++, west += side) {
      addBounds(`context-${row}-${col}`, 'continuous whole-course coverage: playing surfaces, trees, water, buildings and access',
        [west, Math.max(north - side, courseBounds[1]), Math.min(west + side, courseBounds[2]), north].map(v => +v.toFixed(6)), { row, col, priority: 'context' });
    }
  }
  return {
    schemaVersion: 1, groundId: 'puttom', kind: 'authenticated-orthophoto-review-plan',
    collection: discovery.orthophoto.collection, horizontalCrs: 'EPSG:3006', resolutionMetres: resolution,
    captureRange: discovery.orthophoto.captureRange,
    frame: { source: model.frame, origin: model.origin, mPerLat: model.mPerLat, mPerLon: model.mPerLon,
      transformation: 'declared legacy local frame inverse to WGS84 then repository GRS80 SWEREF99TM projection; no fitted translation or rotation' },
    pixelConvention: 'bounds are pixel edges; centre E=minE+(column+0.5)*resolution, N=maxN-(row+0.5)*resolution',
    modelSha256: hash(JSON.stringify(model)), discoverySha256: hash(JSON.stringify(discovery)), courseBoundsEpsg3006: courseBounds,
    sources: discovery.orthophoto.items.map(i => ({ id: i.id, href: i.assets.data.href, boundsEpsg3006: i.projBbox,
      width: i.assets.data.projShape[1], height: i.assets.data.projShape[0], capturedAt: i.capturedAt, bytes: i.assets.data.bytes })),
    windows, summary: { windows: windows.length, fullAoi, contextWindows: windows.filter(w => w.priority === 'context').length,
      coveredHoles: model.holes.map(h => h.n), totalMegapixels: +windows.reduce((n, w) => n + w.megapixels, 0).toFixed(3) },
    limitations: ['Pixel spacing is not positional accuracy. Independent controls are required to quantify absolute alignment.',
      '2024 imagery and 2023/2026 laser represent different dates.', 'The default context covers all eighteen holes and facilities plus 120 m; distant scenery is outside this review.',
      'Review extents do not establish feature boundaries or tee identity. Raw imagery stays in the ignored cache.'],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(a => a.startsWith('--') && a !== '--full-aoi') || args.filter(a => !a.startsWith('--')).length > 1) throw new Error('Usage: node puttombuild/mapping/lm-ortho-plan.mjs [output.json] [--full-aoi]');
  const plan = buildOrthoReviewPlan(JSON.parse(fs.readFileSync(path.join(root, 'puttombuild/course-model.json'))),
    JSON.parse(fs.readFileSync(path.join(root, 'puttombuild/mapping/lm-ortho-discovery.json'))), { fullAoi: args.includes('--full-aoi') });
  const output = path.resolve(args.find(a => !a.startsWith('--')) || path.join(root, 'puttombuild/mapping/lm-ortho-plan.json'));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(plan, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...plan.summary }));
}
