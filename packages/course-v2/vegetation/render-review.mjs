#!/usr/bin/env node
/* Review overlays for the vegetation compiler: the canopy height model with
   every candidate drawn on it, whole ground and hole by hole.

   usage: node packages/course-v2/vegetation/render-review.mjs --ground puttom
            --rasters <dir> --candidates <candidates.json> [--out tools/goldens/<ground>-vegetation-review]

   Grey is canopy height (black 0 m, white 30 m), dark blue is void, the
   magenta line is the campaign seam, white lines are hole centre lines with
   the green ring in light green, and the candidates: green circles at their
   crown radius for individuals, small amber dots for stand crowns, red dots
   for exclusions. No text is rendered; `legend.json` beside the images says
   what each colour is. Pictures are review material, not evidence of
   correctness on their own.                                                  */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../../../geobuild/png.mjs';
import { readRawRaster } from './compile-vegetation.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const groundId = flag('ground');
const rasterDir = flag('rasters');
const candidatesPath = flag('candidates');
const outDir = path.resolve(ROOT, flag('out', `tools/goldens/${groundId}-vegetation-review`));
if (!groundId || !rasterDir || !candidatesPath) {
  console.error('usage: --ground <id> --rasters <dir> --candidates <file> [--out <dir>]');
  process.exit(2);
}
const dataDir = path.join(ROOT, 'geo_data/course-v2', groundId);
const campaigns = JSON.parse(fs.readFileSync(path.join(dataDir, 'acquisition/laser-campaigns.json'), 'utf8'));
const geometry = JSON.parse(fs.readFileSync(path.join(dataDir, 'migration/course-model.epsg3006.json'), 'utf8')).geometry;
const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));

/* merge the campaign rasters: each is NaN outside its own extent */
const rasters = [];
for (const item of campaigns.items) {
  if (item.role !== 'active') continue;
  const name = item.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const data = path.join(rasterDir, `chm-${name}.f32`);
  if (!fs.existsSync(data)) continue;
  rasters.push(readRawRaster(data, path.join(rasterDir, `chm-${name}.json`)));
}
if (!rasters.length) throw new Error('no campaign rasters found');
const base = rasters[0];
const merged = new Float32Array(base.values.length).fill(Number.NaN);
for (const raster of rasters) {
  if (raster.width !== base.width || raster.height !== base.height) throw new Error('campaign rasters differ in shape');
  for (let i = 0; i < merged.length; i++) if (Number.isNaN(merged[i]) && !Number.isNaN(raster.values[i])) merged[i] = raster.values[i];
}

function render({ bbox, metresPerPixel }) {
  const width = Math.round((bbox[2] - bbox[0]) / metresPerPixel);
  const height = Math.round((bbox[3] - bbox[1]) / metresPerPixel);
  const rgb = Buffer.alloc(width * height * 3);
  const put = (px, py, r, g, b) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const o = (py * width + px) * 3;
    rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
  };
  const toPixel = (easting, northing) => [Math.floor((easting - bbox[0]) / metresPerPixel), Math.floor((bbox[3] - northing) / metresPerPixel)];
  /* canopy */
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const easting = bbox[0] + (px + 0.5) * metresPerPixel;
      const northing = bbox[3] - (py + 0.5) * metresPerPixel;
      const column = Math.floor((easting - base.originEasting) / base.sampleSpacingMetres);
      const row = Math.floor((base.originNorthing - northing) / base.sampleSpacingMetres);
      let value = Number.NaN;
      if (column >= 0 && row >= 0 && column < base.width && row < base.height) value = merged[row * base.width + column];
      if (Number.isNaN(value)) put(px, py, 12, 18, 48);
      else { const v = Math.round(20 + Math.min(1, value / 30) * 235); put(px, py, v, v, v); }
    }
  }
  const line = (points, r, g, b) => {
    for (let i = 0; i + 1 < points.length; i++) {
      const [x0, y0] = toPixel(points[i][0], points[i][1]);
      const [x1, y1] = toPixel(points[i + 1][0], points[i + 1][1]);
      const steps = Math.max(1, Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let s = 0; s <= steps; s++) put(Math.round(x0 + (x1 - x0) * s / steps), Math.round(y0 + (y1 - y0) * s / steps), r, g, b);
    }
  };
  const circle = (easting, northing, radiusMetres, r, g, b) => {
    const [cx, cy] = toPixel(easting, northing);
    const radius = Math.max(1, radiusMetres / metresPerPixel);
    const steps = Math.max(8, Math.round(radius * 6));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      put(Math.round(cx + Math.cos(a) * radius), Math.round(cy + Math.sin(a) * radius), r, g, b);
    }
    put(cx, cy, r, g, b);
  };
  for (const seam of campaigns.seams) {
    if (seam.axis === 'northing') line([[bbox[0], seam.value], [bbox[2], seam.value]], 255, 0, 255);
    else line([[seam.value, bbox[1]], [seam.value, bbox[3]]], 255, 0, 255);
  }
  for (const hole of geometry.holes || []) {
    line(hole.line, 255, 255, 255);
    for (const ring of hole.fairway?.rings || []) if (ring.length) line([...ring, ring[0]], 170, 170, 170);
    for (const pad of hole.tees?.pads || []) if (pad.ring?.length) line([...pad.ring, pad.ring[0]], 200, 200, 255);
    if (hole.green?.ring?.length) line([...hole.green.ring, hole.green.ring[0]], 140, 255, 140);
    for (const bunker of hole.bunkers || []) if (bunker.ring?.length) line([...bunker.ring, bunker.ring[0]], 240, 220, 120);
  }
  for (const body of geometry.water || []) if (body.ring?.length) line([...body.ring, body.ring[0]], 80, 160, 255);
  for (const candidate of candidates) {
    const { easting, northing } = candidate.centroid;
    if (easting < bbox[0] || easting > bbox[2] || northing < bbox[1] || northing > bbox[3]) continue;
    if (candidate.representation === 'individual') circle(easting, northing, candidate.radiusMetres, 40, 255, 60);
    else if (candidate.representation === 'excluded') { const [px, py] = toPixel(easting, northing); put(px, py, 255, 40, 40); put(px + 1, py, 255, 40, 40); }
    else { const [px, py] = toPixel(easting, northing); put(px, py, 255, 170, 40); }
  }
  return encodePNG(width, height, rgb);
}

fs.mkdirSync(outDir, { recursive: true });
const ground = [base.originEasting, base.originNorthing - base.height * base.sampleSpacingMetres, base.originEasting + base.width * base.sampleSpacingMetres, base.originNorthing];
fs.writeFileSync(path.join(outDir, 'overview-2m.png'), render({ bbox: ground, metresPerPixel: 2 }));
console.log(`overview-2m.png  ${ground.map(v => v.toFixed(1)).join(',')}`);
const index = [];
for (const hole of geometry.holes || []) {
  const points = [...hole.line, ...(hole.green?.ring || [])];
  if (!points.length) continue;
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const margin = 90;
  let bbox = [Math.min(...xs) - margin, Math.min(...ys) - margin, Math.max(...xs) + margin, Math.max(...ys) + margin];
  bbox = [Math.max(bbox[0], ground[0]), Math.max(bbox[1], ground[1]), Math.min(bbox[2], ground[2]), Math.min(bbox[3], ground[3])];
  if (bbox[2] - bbox[0] < 50 || bbox[3] - bbox[1] < 50) continue;
  const file = `hole-${String(hole.n).padStart(2, '0')}.png`;
  fs.writeFileSync(path.join(outDir, file), render({ bbox, metresPerPixel: 1 }));
  index.push({ hole: hole.n, file, bboxEpsg3006: bbox.map(v => Math.round(v * 10) / 10) });
  console.log(`${file}  ${Math.round(bbox[2] - bbox[0])} x ${Math.round(bbox[3] - bbox[1])} m`);
}
fs.writeFileSync(path.join(outDir, 'legend.json'), JSON.stringify({
  canopy: 'grey: canopy height, black 0 m to white 30 m; dark blue: no return',
  seam: 'magenta: campaign seam',
  course: 'white: hole centre lines; grey: fairway rings; pale blue: tee pads; light green: green rings; pale yellow: bunker rings; blue: water rings',
  candidates: 'green circle at crown radius: individual; amber dot: stand crown; red dot: excluded (reason in candidates.json)',
  overview: 'overview-2m.png at 2 m per pixel over the published ground',
  holes: index,
  candidatesFile: path.relative(ROOT, candidatesPath),
}, null, 2) + '\n');
console.log(`wrote ${index.length + 1} images and legend.json to ${path.relative(ROOT, outDir)}`);
