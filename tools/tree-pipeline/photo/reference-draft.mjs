/* Interpretation aid for a reference round (round 4): a DRAFT of each
   window's crowns by the round-3 protocol's written grouping rule, with large
   single panels to check it on. It is not a detector under test and never
   scores anything; the interpreter checks every draft crown on the panels and
   records the changes in the annotations file.

   Draft rule (reference-annotations-r3.json protocol): a numbered candidate
   within 2 m of a taller kept one, or less than 0.6 m above the dip toward a
   taller kept one within 3 m, is part of that crown (for a leafless crown in
   the April photo: within 3.5 m). Type from the April 2021 photo at the
   crown's displaced position (vegetated share >= 0.5 conifer, < 0.2
   broadleaf, else unknown); stratum from the share of CHM >= 3 m in a 16 m
   square (the detect census rule).

   node tools/tree-pipeline/photo/reference-draft.mjs [--ground <id>] --raw <cache> --round r4 --only W1,W2 [--mpp 0.06]
   Writes <cache>/reference-panels/<id>.draft.json and <id>.draft-{chm,rgbP,cirP,rgbL}.png, P and L the
   last two digits of the presence and leaf-off photo years (Johannesberg: rgb25, cir25, rgb21). */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadGroundConfig, ROOT } from '../config.mjs';
import { Canvas, loadNativeMosaic, loadRaster, openCampaignPacks, rasterAt, renderLayer, toPixel } from '../panels.mjs';
import { photoDisc } from '../crown-evidence.mjs';
import { smoothChm } from '../../../packages/course-v2/vegetation/pit-free-chm.mjs';

const { values: args } = parseArgs({ options: { ground: { type: 'string', default: 'johannesberg' }, raw: { type: 'string' }, round: { type: 'string', default: 'r4' }, only: { type: 'string', default: '' }, mpp: { type: 'string', default: '0.06' } } });
const ctx = loadGroundConfig(ROOT, args.ground, { ...(args.raw ? { raw: args.raw } : {}), round: args.round });
const mpp = Number(args.mpp);
const windows = JSON.parse(fs.readFileSync(ctx.reviewFile(ctx.sampleFile('reference-windows')), 'utf8')).windows
  .filter(w => !args.only || args.only.split(',').some(p => w.id.startsWith(p)));
const chm = loadRaster(ctx, 'chm-pitfree-050');
const presence = ctx.presence.key, leafOff = ctx.leafOff.key;
const packs = { [presence]: openCampaignPacks(ctx, presence), [leafOff]: openCampaignPacks(ctx, leafOff) };

function dipBetween(sm, a, b) {
  const n = Math.max(2, Math.ceil(Math.hypot(a.easting - b.easting, a.northing - b.northing) / 0.25));
  let low = Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    low = Math.min(low, rasterAt(sm, a.easting + (b.easting - a.easting) * t, a.northing + (b.northing - a.northing) * t));
  }
  return low;
}

for (const window of windows) {
  const dir = ctx.paths.referencePanels;
  const { candidates } = JSON.parse(fs.readFileSync(path.join(dir, `${window.id}.candidates.json`), 'utf8'));
  const relief = JSON.parse(fs.readFileSync(path.join(dir, `${window.id}.relief.json`), 'utf8')).relief;
  const margin = 6;
  const bbox = [window.bbox[0] - margin, window.bbox[1] - margin, window.bbox[2] + margin, window.bbox[3] + margin];
  const pad = [bbox[0] - 24, bbox[1] - 24, bbox[2] + 24, bbox[3] + 24];
  const m25 = loadNativeMosaic(ctx, presence, pad, { packs: packs[presence] });
  const m21 = loadNativeMosaic(ctx, leafOff, pad, { packs: packs[leafOff] });
  /* a smoothed CHM crop for the dips */
  const g = chm.grid, s = g.sampleSpacingMetres;
  const c0 = Math.floor((pad[0] - g.minEasting) / s), c1 = Math.ceil((pad[2] - g.minEasting) / s);
  const r0 = Math.floor((g.maxNorthing - pad[3]) / s), r1 = Math.ceil((g.maxNorthing - pad[1]) / s);
  const width = c1 - c0, height = r1 - r0, vals = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) vals[r * width + c] = chm.values[(r0 + r) * g.width + c0 + c];
  const sub = { minEasting: g.minEasting + c0 * s, maxNorthing: g.maxNorthing - r0 * s, width, height, sampleSpacingMetres: s };
  const sm = { grid: sub, values: smoothChm(sub, vals, 0.3) };
  const k21 = relief[leafOff], k25 = relief[presence];
  const typeAt = c => {
    const kx = k21.kx ?? 0, ky = k21.ky ?? 0;
    const d = photoDisc(m21, c.easting + 0.75 * kx * c.heightMetres, c.northing + 0.75 * ky * c.heightMetres, Math.min(3, 1 + 0.12 * c.heightMetres));
    const share = d ? d.vegetatedShare : null;
    return { share, type: share === null ? 'unknown' : share >= 0.5 ? 'conifer' : share < 0.2 ? 'broadleaf' : 'unknown' };
  };
  const strat = c => {
    let k = 0, t = 0;
    for (let y = -8; y < 8; y += 0.5) for (let x = -8; x < 8; x += 0.5) { t++; if (rasterAt(chm, c.easting + x + 0.25, c.northing + y + 0.25) >= 3) k++; }
    const v = k / t;
    return v < 0.2 ? 'isolated' : v < 0.45 ? 'group' : v < 0.75 ? 'edge' : 'closed';
  };
  const ordered = candidates.filter(c => c.heightMetres >= 2).slice().sort((a, b) => b.heightMetres - a.heightMetres);
  const crowns = [];
  for (const c of ordered) {
    const t = typeAt(c);
    const reach = t.type === 'broadleaf' ? 3.5 : 2;
    let owner = null;
    for (const k of crowns) {
      const d = Math.hypot(k.top.easting - c.easting, k.top.northing - c.northing);
      if (d < reach) { owner = k; break; }
      if (d < 3 && c.heightMetres - dipBetween(sm, c, k.top) < 0.6) { owner = k; break; }
    }
    if (owner) owner.members.push(c.number);
    else crowns.push({ top: c, members: [c.number], ...t, stratum: strat(c) });
  }
  const inside = c => c.easting >= window.bbox[0] && c.easting < window.bbox[2] && c.northing >= window.bbox[1] && c.northing < window.bbox[3];
  crowns.sort((a, b) => b.top.northing - a.top.northing || a.top.easting - b.top.easting);
  crowns.forEach((k, i) => { k.label = `D${i + 1}`; k.inside = inside(k.top); });
  const draft = crowns.map(k => ({ label: k.label, from: k.members.sort((a, b) => a - b), top: k.top.number, height: k.top.heightMetres, type: k.type, aprilShare: k.share === null ? null : Math.round(k.share * 100) / 100, stratum: k.stratum, inside: k.inside, at: [Math.round((k.top.easting - window.bbox[0]) * 10) / 10, Math.round((k.top.northing - window.bbox[1]) * 10) / 10] }));
  fs.writeFileSync(path.join(dir, `${window.id}.draft.json`), JSON.stringify({ window: window.id, rule: 'round-3 protocol grouping (2 m, 0.6 m dip within 3 m; leafless 3.5 m), April vegetated-share type, 16 m census stratum', crowns: draft }, null, 1));
  const shift = key => relief[key].shift;
  const P = String(presence).slice(-2), L = String(leafOff).slice(-2);
  const layers = [
    ['chm', renderLayer({ kind: 'hill', raster: chm, bbox, metresPerPixel: mpp })],
    [`rgb${P}`, renderLayer({ kind: 'rgb', mosaic: m25, bbox, metresPerPixel: mpp, shift: shift(presence) })],
    [`cir${P}`, renderLayer({ kind: 'cir', mosaic: m25, bbox, metresPerPixel: mpp, shift: shift(presence) })],
    [`rgb${L}`, renderLayer({ kind: 'rgb', mosaic: m21, bbox, metresPerPixel: mpp, shift: shift(leafOff) })],
  ];
  for (const [name, canvas] of layers) {
    const [ax, ay] = toPixel(bbox, mpp, window.bbox[0], window.bbox[3]);
    const [bx, by] = toPixel(bbox, mpp, window.bbox[2], window.bbox[1]);
    for (const [x0, y0, x1, y1] of [[ax, ay, bx, ay], [bx, ay, bx, by], [bx, by, ax, by], [ax, by, ax, ay]]) canvas.line(x0, y0, x1, y1, [255, 60, 255]);
    for (let e = window.bbox[0] - 5; e <= bbox[2]; e += 5) { const [x] = toPixel(bbox, mpp, e, bbox[3]); canvas.line(x, 0, x, canvas.height - 1, [255, 255, 255], 0.2); canvas.text(x + 2, 2, String(Math.round(e - window.bbox[0])), [255, 255, 0], 2); }
    for (let n = window.bbox[1] - 5; n <= bbox[3]; n += 5) { const [, y] = toPixel(bbox, mpp, bbox[0], n); canvas.line(0, y, canvas.width - 1, y, [255, 255, 255], 0.2); canvas.text(2, y + 2, String(Math.round(n - window.bbox[1])), [255, 255, 0], 2); }
    for (const c of candidates) {
      const [x, y] = toPixel(bbox, mpp, c.easting, c.northing);
      canvas.cross(x, y, 3, [0, 255, 255]);
      canvas.text(x + 4, y + 3, String(c.number), [0, 230, 230], 1);
    }
    for (const k of crowns) {
      const [x, y] = toPixel(bbox, mpp, k.top.easting, k.top.northing);
      const col = k.type === 'conifer' ? [255, 140, 0] : k.type === 'broadleaf' ? [80, 160, 255] : [255, 255, 255];
      canvas.circle(x, y, 1.2 / mpp, col, { thickness: 2 });
      canvas.text(x - 8, y - 22, k.label, col, 2);
    }
    canvas.text(4, canvas.height - 14, `${window.id} ${name}`, [255, 255, 255], 2);
    fs.writeFileSync(path.join(dir, `${window.id}.draft-${name}.png`), canvas.png());
  }
  const counts = draft.filter(d => d.inside).reduce((o, d) => { o[d.stratum] = (o[d.stratum] || 0) + 1; o[d.type] = (o[d.type] || 0) + 1; return o; }, {});
  console.log(window.id, 'draft crowns', draft.length, 'inside', draft.filter(d => d.inside).length, JSON.stringify(counts));
}
for (const list of Object.values(packs)) for (const p of list) p.close();
