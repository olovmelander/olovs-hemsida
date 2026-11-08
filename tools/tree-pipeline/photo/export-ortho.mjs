/* Round 4: the presence photo (June 2025, 0.16 m RGBI) as one raw RGB raster
   over the inner window plus a halo, for the learned crown detector
   (detect.py), and the calibration training crops (boxes from the frozen
   reference, at each crown's relief-displaced position in the photo).

   Photo pixels stay in the ignored cache; nothing here is committed.

   node tools/tree-pipeline/photo/export-ortho.mjs --raw <pilot cache> [--round r4] [--halo 64] [--skip-raster]
   Writes <cache>/photo/ortho-<key>.rgb (+ .json) and <cache>/photo/train-<round>.json */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { openCampaignPacks } from '../panels.mjs';
import { readMosaic } from '../ortho-store.mjs';
import { fieldAt } from '../relief.mjs';
import { loadReference } from '../benchmark.mjs';

const { values: args } = parseArgs({ options: { ground: { type: 'string', default: 'johannesberg' }, raw: { type: 'string' }, round: { type: 'string', default: 'r4' }, halo: { type: 'string', default: '64' }, 'skip-raster': { type: 'boolean', default: false }, fraction: { type: 'string', default: '0.8' } } });
const ctx = loadGroundConfig(ROOT, args.ground, { raw: args.raw, round: args.round });
const outDir = path.join(ctx.paths.cacheDir, 'photo');
fs.mkdirSync(outDir, { recursive: true });
const key = ctx.presence.key;
const W = ctx.config.window.inner;
const halo = Number(args.halo);
const bbox = [W.minEasting - halo, W.minNorthing - halo, W.maxEasting + halo, W.maxNorthing + halo];

if (!args['skip-raster']) {
  const packs = openCampaignPacks(ctx, key);
  const probe = readMosaic(packs, [bbox[0], bbox[3] - 1, bbox[0] + 1, bbox[3]]);
  const p = probe.pixelMetres;
  const minE = probe.minEasting, maxN = probe.maxNorthing;
  const width = Math.ceil((bbox[2] - minE) / p), height = Math.ceil((maxN - bbox[1]) / p);
  const file = path.join(outDir, `ortho-${key}.rgb`);
  const fd = fs.openSync(file, 'w');
  const hash = crypto.createHash('sha256');
  const stripRows = 800;
  for (let r0 = 0; r0 < height; r0 += stripRows) {
    const rows = Math.min(stripRows, height - r0);
    const strip = readMosaic(packs, [minE + p / 4, maxN - (r0 + rows) * p + p / 4, minE + width * p - p / 4, maxN - r0 * p - p / 4]);
    if (strip.width < width || strip.height < rows || Math.abs(strip.minEasting - minE) > 0.01 || Math.abs(strip.maxNorthing - (maxN - r0 * p)) > 0.01) throw new Error(`strip at row ${r0} misaligned: ${strip.width}x${strip.height} at ${strip.minEasting},${strip.maxNorthing} want ${width}x${rows} at ${minE},${maxN - r0 * p}`);
    const rgb = Buffer.alloc(width * rows * 3);
    for (let r = 0; r < rows; r++) for (let c = 0; c < width; c++) {
      const s = (r * strip.width + c) * 4, t = (r * width + c) * 3;
      rgb[t] = strip.data[s]; rgb[t + 1] = strip.data[s + 1]; rgb[t + 2] = strip.data[s + 2];
    }
    fs.writeSync(fd, rgb, 0, rgb.length, r0 * width * 3);
    hash.update(rgb);
    process.stdout.write(`\r${Math.min(height, r0 + rows)}/${height} rows`);
  }
  fs.closeSync(fd);
  for (const pk of packs) pk.close();
  const meta = { campaign: key, date: ctx.presence.date, bands: 'RGB (of RGBI)', dtype: 'uint8', layout: 'row-major, north-up, H x W x 3', minEasting: minE, maxNorthing: maxN, pixelMetres: p, width, height, sha256: hash.digest('hex'), note: 'photo pixels: ignored cache only, never committed or redistributed' };
  fs.writeFileSync(path.join(outDir, `ortho-${key}.json`), JSON.stringify(meta, null, 1));
  console.log(`\n${file}: ${width} x ${height} at ${p} m`);
}

/* calibration training crops: never a held-out window */
const reference = loadReference(ctx);
const relief = JSON.parse(fs.readFileSync(ctx.reviewFile('relief-displacement.json'), 'utf8'));
const field = relief.campaigns[key].field;
const f = Number(args.fraction);
const crops = [];
for (const w of reference.windows.windows.filter(x => x.role === 'calibration')) {
  const crowns = reference.crowns.filter(c => c.window === w.id);
  const displaced = crowns.map(c => {
    const k = fieldAt(field, c.easting, c.northing) || { kx: 0, ky: 0 };
    const h = c.heightMetres;
    const e = c.easting + f * (k.kx ?? 0) * h, n = c.northing + f * (k.ky ?? 0) * h;
    const r = Math.max(1.2, c.segment?.equivalentRadiusMetres || 1.5) + 0.1 * Math.hypot(k.kx ?? 0, k.ky ?? 0) * h;
    return { id: c.id, scored: c.scored, zone: c.zone, easting: e, northing: n, half: r, height: h };
  });
  /* the crop: the window plus 4 m, moved by the window's mean displacement (the reference lists crowns 6 m round the window) */
  const inWindow = displaced.filter((d, i) => crowns[i].zone === 'window');
  const meanShift = inWindow.length ? [inWindow.reduce((a, d, i) => a + d.easting - crowns.filter(c => c.zone === 'window')[i].easting, 0) / inWindow.length, inWindow.reduce((a, d, i) => a + d.northing - crowns.filter(c => c.zone === 'window')[i].northing, 0) / inWindow.length] : [0, 0];
  const cb = [w.bbox[0] - 4 + meanShift[0], w.bbox[1] - 4 + meanShift[1], w.bbox[2] + 4 + meanShift[0], w.bbox[3] + 4 + meanShift[1]];
  const boxes = displaced.filter(d => d.easting > cb[0] && d.easting < cb[2] && d.northing > cb[1] && d.northing < cb[3]).map(d => ({ id: d.id, xmin: d.easting - d.half, ymin: d.northing - d.half, xmax: d.easting + d.half, ymax: d.northing + d.half }));
  /* canopy the interpreter could not split (ambiguity boxes) is not background: masked out of training, moved like the crop and grown 2 m */
  const masks = reference.ambiguity.filter(a => a.window === w.id).map(a => { const xs = a.ring.map(q => q[0]), ys = a.ring.map(q => q[1]); return [Math.min(...xs) + meanShift[0] - 2, Math.min(...ys) + meanShift[1] - 2, Math.max(...xs) + meanShift[0] + 2, Math.max(...ys) + meanShift[1] + 2]; });
  crops.push({ window: w.id, bbox: cb, shift: meanShift, boxes, masks });
}
fs.writeFileSync(path.join(outDir, `train-${ctx.round.id}.json`), JSON.stringify({ round: ctx.round.id, referenceLockSha256: reference.lockSha256, role: 'calibration only', projectionFraction: f, boxRule: 'centre at the laser crown + f x k x h (relief field of the presence photo); half-size max(1.2, crown radius) + 0.1 x |k| x h', crops }, null, 1));
console.log(`training crops: ${crops.length}, boxes ${crops.reduce((a, c) => a + c.boxes.length, 0)}`);
