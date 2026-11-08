#!/usr/bin/env node
/* Interpretation panels for the frozen reference sample.

   usage: node tools/johannesberg-tree-pilot/reference-panels.mjs --windows <reference-windows.json> [--only id,id] [--out <dir>]

   For each declared window: numbered candidate apexes from an over-segmenting
   local-maximum filter (1 m radius on the pit-free CHM lightly smoothed,
   sigma 0.3 m, at least 2 m tall) -- deliberately NOT any detector under test
   -- drawn on four co-registered panels: CHM hillshade, 2025-06-14 colour
   infrared, 2021-04-18 natural colour (leaf-off, the day after the laser) and
   2025-06-14 natural colour, with a 5 m grid labelled in metres from the
   window's south-west corner. The interpreter accepts, rejects, merges or adds
   crowns from these; the candidates only save typing positions. Panels and
   candidate lists go to the ignored cache (they hold source pixels).       */
import fs from 'node:fs';
import path from 'node:path';
import { PILOT } from './pilot-config.mjs';
import { Canvas, ROOT, drawGrid, loadMosaic, loadRaster, renderLayer, toPixel } from './panels.mjs';
import { createRaster } from '../../packages/course-v2/vegetation/canopy-fields.mjs';
import { detectLocalMaxima } from '../../packages/course-v2/vegetation/crown-detect.mjs';
import { smoothChm } from '../../packages/course-v2/vegetation/pit-free-chm.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const windowsPath = path.resolve(ROOT, flag('windows', `${PILOT.reviewDir}/reference-windows.json`));
const only = (flag('only', '') || '').split(',').filter(Boolean);
const outDir = path.resolve(ROOT, flag('out', `${PILOT.cacheDir}/reference-panels`));
const mpp = Number(flag('mpp', 0.12));
fs.mkdirSync(outDir, { recursive: true });

export function overSegmentCandidates(chm, bbox, marginMetres = 6) {
  const g = chm.grid;
  const s = g.sampleSpacingMetres;
  const c0 = Math.max(0, Math.floor((bbox[0] - marginMetres - g.minEasting) / s));
  const c1 = Math.min(g.width, Math.ceil((bbox[2] + marginMetres - g.minEasting) / s));
  const r0 = Math.max(0, Math.floor((g.maxNorthing - bbox[3] - marginMetres) / s));
  const r1 = Math.min(g.height, Math.ceil((g.maxNorthing - bbox[1] + marginMetres) / s));
  const width = c1 - c0;
  const height = r1 - r0;
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = chm.values[(r0 + r) * g.width + (c0 + c)];
  const sub = { minEasting: g.minEasting + c0 * s, maxNorthing: g.maxNorthing - r0 * s, width, height, sampleSpacingMetres: s };
  const smooth = smoothChm(sub, values, 0.3);
  const raster = createRaster({ width, height, sampleSpacingMetres: s, originEasting: sub.minEasting, originNorthing: sub.maxNorthing, values: smooth });
  const maxima = detectLocalMaxima(raster, { parameters: { windowBaseMetres: 1, windowSlope: 0, windowMinimumMetres: 1, windowMaximumMetres: 1, minimumCandidateHeightMetres: 2 } });
  return maxima.map(m => ({
    easting: Math.round((sub.minEasting + (m.column + 0.5) * s) * 100) / 100,
    northing: Math.round((sub.maxNorthing - (m.row + 0.5) * s) * 100) / 100,
    heightMetres: Math.round(values[m.index] * 100) / 100,
  })).sort((a, b) => b.northing - a.northing || a.easting - b.easting).map((c, i) => ({ number: i + 1, ...c }));
}

async function main() {
  const declared = JSON.parse(fs.readFileSync(windowsPath, 'utf8'));
  const chm = loadRaster('chm-pitfree-050');
  const m25 = loadMosaic('2025');
  const m21 = loadMosaic('2021');
  const registration = JSON.parse(fs.readFileSync(path.join(ROOT, PILOT.reviewDir, 'registration.json'), 'utf8'));
  const shiftOf = key => registration.applied?.[key] || null;
  for (const window of declared.windows.filter(w => !only.length || only.includes(w.id))) {
    const margin = 6;
    const bbox = [window.bbox[0] - margin, window.bbox[1] - margin, window.bbox[2] + margin, window.bbox[3] + margin];
    const candidates = overSegmentCandidates(chm, window.bbox, margin);
    const panels = [
      ['CHM', renderLayer({ kind: 'hill', raster: chm, bbox, metresPerPixel: mpp })],
      ['CIR 2025', renderLayer({ kind: 'cir', mosaic: m25, bbox, metresPerPixel: mpp, shift: shiftOf('2025') })],
      ['RGB 2021', renderLayer({ kind: 'rgb', mosaic: m21, bbox, metresPerPixel: mpp, shift: shiftOf('2021') })],
      ['RGB 2025', renderLayer({ kind: 'rgb', mosaic: m25, bbox, metresPerPixel: mpp, shift: shiftOf('2025') })],
    ];
    for (const [, canvas] of panels) {
      /* the scoring rectangle */
      const [ax, ay] = toPixel(bbox, mpp, window.bbox[0], window.bbox[3]);
      const [bx, by] = toPixel(bbox, mpp, window.bbox[2], window.bbox[1]);
      for (const [x0, y0, x1, y1] of [[ax, ay, bx, ay], [bx, ay, bx, by], [bx, by, ax, by], [ax, by, ax, ay]]) canvas.line(x0, y0, x1, y1, [255, 60, 255]);
      drawGridRelative(canvas, bbox, window.bbox, mpp, 5);
      for (const c of candidates) {
        const [x, y] = toPixel(bbox, mpp, c.easting, c.northing);
        canvas.cross(x, y, 3, [0, 255, 255]);
        canvas.text(x + 3, y - 12, String(c.number), [0, 255, 255], 2);
      }
    }
    const w = panels[0][1].width;
    const h = panels[0][1].height;
    const sheet = new Canvas(2 * w + 6, 2 * h + 6, [40, 40, 40]);
    panels.forEach(([label, canvas], i) => { canvas.text(4, canvas.height - 14, label, [255, 255, 255], 2); sheet.blit(canvas, (i % 2) * (w + 6), Math.floor(i / 2) * (h + 6)); });
    fs.writeFileSync(path.join(outDir, `${window.id}.png`), sheet.png());
    fs.writeFileSync(path.join(outDir, `${window.id}.candidates.json`), JSON.stringify({ window, candidates }, null, 1));
    console.log(`${window.id}: ${candidates.length} candidates -> ${path.join(outDir, `${window.id}.png`)} (${sheet.width} x ${sheet.height})`);
  }
}

/** Grid lines every `step` m labelled in metres east/north of the window's SW corner. */
function drawGridRelative(canvas, bbox, windowBbox, mpp, step) {
  const [we, wn] = [windowBbox[0], windowBbox[1]];
  for (let e = we + Math.ceil((bbox[0] - we) / step) * step; e <= bbox[2]; e += step) {
    const [x] = toPixel(bbox, mpp, e, bbox[3]);
    canvas.line(x, 0, x, canvas.height - 1, [255, 255, 255], 0.25);
    canvas.text(x + 2, 2, String(Math.round(e - we)), [255, 255, 0], 1);
  }
  for (let n = wn + Math.ceil((bbox[1] - wn) / step) * step; n <= bbox[3]; n += step) {
    const [, y] = toPixel(bbox, mpp, bbox[0], n);
    canvas.line(0, y, canvas.width - 1, y, [255, 255, 255], 0.25);
    canvas.text(2, y + 2, String(Math.round(n - wn)), [255, 255, 0], 1);
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
