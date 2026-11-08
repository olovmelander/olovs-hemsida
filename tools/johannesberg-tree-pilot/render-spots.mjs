#!/usr/bin/env node
/* Review panels for representative spots: today's trees against the
   candidate set, on the pit-free CHM and (cache only) on the photos.

   usage: node tools/johannesberg-tree-pilot/render-spots.mjs

   Committed (review directory): laser-only panels -- CHM hillshade with
   today's trees (blue circles: published individual records; orange dots:
   stand trees at their runtime hash positions) beside the same CHM with the
   candidates (green retain, yellow adjust, cyan add, orange hold, red cross
   remove, purple cross merge (record retired into a neighbouring crown), grey cross not placed (reviewed felled or not a tree); a square marks a conifer, a circle a broadleaf or unknown).
   Ignored cache only: the same overlays on the 2025-06-14 colour infrared and
   the 2021-04-18 natural colour orthophotos, because the orthophoto licence
   review is pending in the source catalogue and its pixels are not
   redistributed. A 10 m grid is labelled in metres from the panel corner. */
import fs from 'node:fs';
import path from 'node:path';
import { PILOT } from './pilot-config.mjs';
import { Canvas, ROOT, drawGrid, loadMosaic, loadRaster, renderLayer, toPixel } from './panels.mjs';
import { publishedPopulation } from './published-population.mjs';

export const SPOTS = Object.freeze([
  { id: 'hole10-south', title: 'south of the 10th tee (owner example)', bbox: [679372, 6624468, 679439, 6624533] },
  { id: 'holes17-18', title: 'holes 17-18 (owner example)', bbox: [679200, 6625560, 679360, 6625720] },
  { id: 'hole16-spruce-edge', title: 'conifer edge between 3 and 16', bbox: [679420, 6625320, 679520, 6625420] },
  { id: 'hole4-meadow', title: 'scattered trees between 16 and 4', bbox: [679680, 6625230, 679800, 6625350] },
  { id: 'hole2-tee', title: 'groups by the 1st green and 2nd tee', bbox: [679310, 6625810, 679410, 6625910] },
  { id: 'nine5-6', title: '9-hole course 5th/6th', bbox: [678830, 6626075, 678930, 6626175] },
]);

const COLOURS = { retain: [60, 220, 60], adjust: [255, 230, 40], add: [0, 230, 255], hold: [255, 140, 0], remove: [255, 40, 40], merge: [190, 120, 255], 'not-placed': [160, 160, 160] };

function overlayOld(canvas, bbox, mpp, population) {
  for (const s of population.standTrees) { const [x, y] = toPixel(bbox, mpp, s.easting, s.northing); canvas.dot(x, y, 2, [255, 160, 40]); }
  for (const r of population.records) { const [x, y] = toPixel(bbox, mpp, r.easting, r.northing); canvas.circle(x, y, r.radiusMetres / mpp, [70, 160, 255]); canvas.dot(x, y, 2, [70, 160, 255]); }
}

function overlayNew(canvas, bbox, mpp, candidates) {
  for (const t of candidates) {
    const [x, y] = toPixel(bbox, mpp, t.easting, t.northing);
    const colour = COLOURS[t.decision];
    if (['remove', 'merge', 'not-placed'].includes(t.decision)) { canvas.cross(x, y, 5, colour); continue; }
    canvas.circle(x, y, t.radiusMetres / mpp, colour, { alpha: 0.9 });
    if (t.type === 'conifer') canvas.square(x, y, 3, colour); else canvas.dot(x, y, 2.5, colour);
  }
}

async function main() {
  const candidates = JSON.parse(fs.readFileSync(path.join(ROOT, PILOT.cacheDir, 'candidates', 'candidates-full.json'), 'utf8'));
  const chm = loadRaster('chm-pitfree-050');
  const m25 = loadMosaic('2025');
  const m21 = loadMosaic('2021');
  const committedDir = path.join(ROOT, PILOT.reviewDir, 'review');
  const cacheDir = path.join(ROOT, PILOT.cacheDir, 'review-panels');
  fs.mkdirSync(committedDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const index = [];
  for (const spot of SPOTS) {
    const { bbox } = spot;
    const size = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
    const mpp = Math.max(0.1, size / 600);
    const population = publishedPopulation({ bbox: [bbox[0] - 8, bbox[1] - 8, bbox[2] + 8, bbox[3] + 8] });
    const local = candidates.filter(t => t.easting >= bbox[0] - 8 && t.easting < bbox[2] + 8 && t.northing >= bbox[1] - 8 && t.northing < bbox[3] + 8);
    const panel = (kind, mosaic, overlay, label) => {
      const c = kind === 'hill' ? renderLayer({ kind: 'hill', raster: chm, bbox, metresPerPixel: mpp }) : renderLayer({ kind, mosaic, bbox, metresPerPixel: mpp });
      overlay(c);
      drawGrid(c, bbox, mpp, 10);
      c.text(4, c.height - 14, label, [255, 255, 255], 2);
      return c;
    };
    const old = panel('hill', null, c => overlayOld(c, bbox, mpp, population), 'TODAY');
    const neu = panel('hill', null, c => overlayNew(c, bbox, mpp, local), 'CANDIDATE');
    const sheet = new Canvas(old.width * 2 + 6, old.height, [40, 40, 40]);
    sheet.blit(old, 0, 0); sheet.blit(neu, old.width + 6, 0);
    fs.writeFileSync(path.join(committedDir, `${spot.id}.png`), sheet.png());
    const cir = panel('cir', m25, c => overlayNew(c, bbox, mpp, local), 'CIR 2025 CANDIDATE');
    const rgbOld = panel('rgb', m25, c => overlayOld(c, bbox, mpp, population), 'RGB 2025 TODAY');
    const apr = panel('rgb', m21, c => overlayNew(c, bbox, mpp, local), 'RGB 2021 APR CANDIDATE');
    const photo = new Canvas(old.width * 2 + 6, old.height * 2 + 6, [40, 40, 40]);
    photo.blit(rgbOld, 0, 0); photo.blit(cir, old.width + 6, 0); photo.blit(neu, 0, old.height + 6); photo.blit(apr, old.width + 6, old.height + 6);
    fs.writeFileSync(path.join(cacheDir, `${spot.id}-photo.png`), photo.png());
    const count = (list, key) => list.reduce((a, t) => { const k = key(t); a[k] = (a[k] || 0) + 1; return a; }, {});
    const inside = t => t.easting >= bbox[0] && t.easting < bbox[2] && t.northing >= bbox[1] && t.northing < bbox[3];
    index.push({ ...spot, laserPanel: `review/${spot.id}.png`, photoPanelCache: path.relative(ROOT, path.join(cacheDir, `${spot.id}-photo.png`)).replaceAll('\\', '/'), today: { records: population.records.filter(t => inside(t)).length, standTrees: population.standTrees.filter(inside).length }, candidates: count(local.filter(inside), t => t.decision) });
    console.log(spot.id, JSON.stringify(index.at(-1).today), JSON.stringify(index.at(-1).candidates));
  }
  fs.writeFileSync(path.join(committedDir, 'spots.json'), JSON.stringify({ legend: { today: 'blue circle = published individual record at its radius; orange dot = runtime stand tree', candidate: 'green retain, yellow adjust, cyan add, orange hold, red cross remove, purple cross merge, grey cross not placed; square = conifer, dot = broadleaf/unknown; circle = crown radius' }, spots: index }, null, 1) + '\n');
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
