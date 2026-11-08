/* Stage `detect`: a detector-neutral treetop census and the ground's strata.

   Before any detector is tuned, the reference sample has to be chosen, and it
   must cover every kind of canopy the ground has: isolated trees, groups,
   edges and closed stands, conifer and broadleaf, near play and in the woods.
   This stage finds every local maximum of the lightly smoothed pit-free CHM
   (the same over-segmenting 1 m filter the reference panels number, never a
   detector under test), and for each one reads how closed the canopy round
   it is (share of CHM >= 3 m in a 16 m square) and how vegetated its crown is
   in the leaf-off photo (evergreen needles are green in April, bare twigs are
   not). The result, strata.json, counts apexes per stratum, type and play
   zone over the inner window and per 100 m cell, and lists the cells where
   each stratum is commonest: candidates for reference windows. These are
   apexes, not trees (an over-segmenting filter splits broad crowns), and the
   strata are guidance for choosing windows, not scores.

   It also states the Johannesberg lesson up front: in a leaf-off scan of
   about 2 first returns/m2, touching spruces in closed stands share one
   maximum, and the 90% held-out gate failed there (closed recall 17/23). A
   ground whose canopy is mostly closed should expect the same.            */
import fs from 'node:fs';
import path from 'node:path';
import { createRaster } from '../../packages/course-v2/vegetation/canopy-fields.mjs';
import { detectLocalMaxima } from '../../packages/course-v2/vegetation/crown-detect.mjs';
import { smoothChm } from '../../packages/course-v2/vegetation/pit-free-chm.mjs';
import { closedness, photoDisc } from './crown-evidence.mjs';
import { nearPlay, playGeometry } from './geometry.mjs';
import { loadMosaic, loadRaster, renderLayer, toPixel } from './panels.mjs';
import { writeReceipt } from './receipts.mjs';

export const STRATA = Object.freeze([
  Object.freeze({ id: 'isolated', below: 0.2 }),
  Object.freeze({ id: 'group', below: 0.45 }),
  Object.freeze({ id: 'edge', below: 0.75 }),
  Object.freeze({ id: 'closed', below: Infinity }),
]);
export const LEAF_OFF = Object.freeze({ conifer: 0.5, leafless: 0.2 });
const CELL = 100;
const STRATUM_COLOUR = { isolated: [0, 230, 255], group: [60, 220, 60], edge: [255, 230, 40], closed: [255, 60, 60] };

export function stratumOf(closed) {
  return STRATA.find(s => closed < s.below).id;
}

export function leafOffClass(share) {
  if (!Number.isFinite(share)) return 'unknown';
  return share >= LEAF_OFF.conifer ? 'conifer-like' : share < LEAF_OFF.leafless ? 'leafless' : 'mixed';
}

/** Warnings the census raises before any reference window is drawn. */
export function strataWarnings({ closedShare, firstReturnsPerSquareMetre, leafOffDaysFromLaser, laserLeafState }) {
  const warnings = [];
  if (closedShare > 0.3 && firstReturnsPerSquareMetre < 4) {
    warnings.push(`closed canopy holds ${Math.round(100 * closedShare)}% of the apexes and the scan has ${firstReturnsPerSquareMetre} first returns/m2: touching crowns in closed stands will share maxima (Johannesberg: 1.8/m2 leaf-off, closed recall 17/23 and the 90% gate failed there). Put closed windows in the reference sample anyway, and record the stratified result.`);
  }
  if (Number.isFinite(leafOffDaysFromLaser) && leafOffDaysFromLaser > 60) {
    warnings.push(`the leaf-off photo is ${leafOffDaysFromLaser} days from the laser: trees felled or grown between them will disagree; prefer the leaf-off campaign nearest the laser date`);
  }
  if (laserLeafState !== 'leaf-off') {
    warnings.push(`the laser is ${laserLeafState}: the conifer/broadleaf rule reads the leaf-off PHOTO, so it still applies, but broadleaf crowns will look denser in the CHM than at Johannesberg`);
  }
  return warnings;
}

export async function run(ctx) {
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const leafOff = loadMosaic(ctx, ctx.leafOff.key);
  const g = chm.grid, s = g.sampleSpacingMetres;
  const W = ctx.innerWindow;
  /* the inner window of the CHM, lightly smoothed, then 1 m local maxima >= 3 m */
  const c0 = Math.round((W.minEasting - g.minEasting) / s), r0 = Math.round((g.maxNorthing - W.maxNorthing) / s);
  const width = Math.round((W.maxEasting - W.minEasting) / s), height = Math.round((W.maxNorthing - W.minNorthing) / s);
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = chm.values[(r0 + r) * g.width + c0 + c];
  const sub = { minEasting: W.minEasting, maxNorthing: W.maxNorthing, width, height, sampleSpacingMetres: s };
  const smooth = smoothChm(sub, values, 0.3);
  const raster = createRaster({ width, height, sampleSpacingMetres: s, originEasting: sub.minEasting, originNorthing: sub.maxNorthing, values: smooth });
  const maxima = detectLocalMaxima(raster, { parameters: { windowBaseMetres: 1, windowSlope: 0, windowMinimumMetres: 1, windowMaximumMetres: 1, minimumCandidateHeightMetres: 3 } });
  const { holeLines, practiceRings } = playGeometry(ctx);
  const reach = ctx.config.playZone.nearMetres;
  const totals = Object.fromEntries(STRATA.map(t => [t.id, { apexes: 0, near: 0, 'conifer-like': 0, mixed: 0, leafless: 0, unknown: 0 }]));
  const cells = new Map();
  const apexes = [];
  for (const m of maxima) {
    const e = sub.minEasting + (m.column + 0.5) * s, n = sub.maxNorthing - (m.row + 0.5) * s;
    const h = values[m.index];
    const stratum = stratumOf(closedness(chm, e, n));
    const disc = photoDisc(leafOff, e, n, 1.5 + 0.15 * h);
    const type = leafOffClass(disc?.vegetatedShare);
    const near = nearPlay(e, n, holeLines, practiceRings, reach);
    const t = totals[stratum];
    t.apexes++; t[type]++; if (near) t.near++;
    const key = `${Math.floor((e - W.minEasting) / CELL)},${Math.floor((n - W.minNorthing) / CELL)}`;
    let cell = cells.get(key);
    if (!cell) {
      const [ci, cj] = key.split(',').map(Number);
      cell = { bbox: [W.minEasting + ci * CELL, W.minNorthing + cj * CELL, W.minEasting + (ci + 1) * CELL, W.minNorthing + (cj + 1) * CELL], near: 0, apexes: 0, ...Object.fromEntries(STRATA.map(x => [x.id, 0])), 'conifer-like': 0, leafless: 0 };
      cells.set(key, cell);
    }
    cell.apexes++; cell[stratum]++; if (near) cell.near++;
    if (type === 'conifer-like' || type === 'leafless') cell[type]++;
    apexes.push({ e, n, stratum });
  }
  const canopy = JSON.parse(fs.readFileSync(ctx.reviewFile('canopy-rasters.json'), 'utf8'));
  const total = maxima.length;
  const closedShare = total ? totals.closed.apexes / total : 0;
  const days = Math.round(Math.abs(Date.parse(ctx.leafOff.date) - Date.parse(ctx.config.laser.capturedOn)) / 86400000);
  const cellList = [...cells.values()].sort((a, b) => b.bbox[1] - a.bbox[1] || a.bbox[0] - b.bbox[0]);
  /* where each stratum is commonest, near play first: candidate reference windows */
  const suggestions = Object.fromEntries(STRATA.map(t => [t.id, [...cellList]
    .filter(c => c[t.id] >= 5)
    .sort((a, b) => (b.near > 0) - (a.near > 0) || b[t.id] / b.apexes - a[t.id] / a.apexes || b[t.id] - a[t.id])
    .slice(0, 6).map(c => ({ bbox: c.bbox, apexes: c.apexes, [t.id]: c[t.id], near: c.near > 0, conifer: c['conifer-like'], leafless: c.leafless }))]));
  const warnings = strataWarnings({ closedShare, firstReturnsPerSquareMetre: canopy.innerDensity.firstReturnsPerSquareMetre, leafOffDaysFromLaser: days, laserLeafState: ctx.config.laser.leafState });
  const out = {
    schemaVersion: 1,
    kind: 'tree-strata-census',
    groundId: ctx.groundId,
    reviewId: ctx.config.reviewId,
    note: 'detector-neutral: 1 m local maxima >= 3 m of the pit-free CHM smoothed by 0.3 m (the reference panels\' numbering filter). Apexes, not trees; strata guide the choice of reference windows and are never scores.',
    innerWindowEpsg3006: [W.minEasting, W.minNorthing, W.maxEasting, W.maxNorthing],
    laser: { label: ctx.config.laser.label, firstReturnsPerSquareMetre: canopy.innerDensity.firstReturnsPerSquareMetre, emptyCellFraction050: canopy.innerDensity.emptyCellFraction050 },
    leafOffPhoto: { campaign: ctx.leafOff.key, date: ctx.leafOff.date, daysFromLaser: days },
    rules: { stratum: 'share of CHM >= 3 m in a 16 m square round the apex: isolated < 0.2, group < 0.45, edge < 0.75, closed otherwise', leafOff: `vegetated share of the leaf-off crown disc (1.5 + 0.15 h m): conifer-like >= ${LEAF_OFF.conifer}, leafless < ${LEAF_OFF.leafless}, mixed between`, play: `near within ${reach} m of any hole line or practice area of ${ctx.config.courseSlugs.join(', ')}` },
    apexes: total,
    closedShare: Math.round(closedShare * 1000) / 1000,
    byStratum: totals,
    suggestions,
    warnings,
    cells: cellList,
  };
  const file = ctx.reviewFile('strata.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
  /* a laser-only picture of the strata over the CHM, for choosing windows (cache) */
  const bbox = [W.minEasting, W.minNorthing, W.maxEasting, W.maxNorthing];
  const mpp = Math.max(1, (W.maxEasting - W.minEasting) / 2048);
  const picture = renderLayer({ kind: 'hill', raster: chm, bbox, metresPerPixel: mpp });
  for (const a of apexes) { const [x, y] = toPixel(bbox, mpp, a.e, a.n); picture.set(x, y, STRATUM_COLOUR[a.stratum]); }
  for (const line of holeLines) for (let i = 1; i < line.length; i++) {
    const [x0, y0] = toPixel(bbox, mpp, ...line[i - 1]), [x1, y1] = toPixel(bbox, mpp, ...line[i]);
    picture.line(x0, y0, x1, y1, [255, 255, 255]);
  }
  for (const c of cellList) {
    const [x0, y0] = toPixel(bbox, mpp, c.bbox[0], c.bbox[3]);
    picture.text(x0 + 2, y0 + 2, `${Math.round(c.bbox[0] - W.minEasting)} ${Math.round(c.bbox[1] - W.minNorthing)}`, [200, 200, 200], 1, null);
  }
  picture.text(6, picture.height - 16, 'CYAN ISOLATED  GREEN GROUP  YELLOW EDGE  RED CLOSED  WHITE HOLE LINES  LABELS E N FROM SW CORNER', [255, 255, 255], 2);
  fs.mkdirSync(ctx.paths.cacheDir, { recursive: true });
  const picturePath = path.join(ctx.paths.cacheDir, 'strata.png');
  fs.writeFileSync(picturePath, picture.png());
  writeReceipt(ctx, 'detect', { inputs: [path.join(ctx.paths.rasters, 'chm-pitfree-050.bin'), path.join(ctx.paths.ortho, ctx.leafOff.key, `mosaic-${ctx.leafOff.key}-032.rgbi`), ctx.reviewFile('canopy-rasters.json')], outputs: [file, picturePath], result: { apexes: total, closedShare: out.closedShare, byStratum: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.apexes])), warnings } });
  const lines = STRATA.map(t => `${t.id} ${totals[t.id].apexes} (${totals[t.id].near} near play)`).join(', ');
  return { status: 'done', message: `${total} apexes: ${lines}${warnings.length ? `\nWARNING: ${warnings.join('\nWARNING: ')}` : ''}\nChoose reference windows from strata.json suggestions and ${ctx.rel(picturePath)} (laser only).` };
}

