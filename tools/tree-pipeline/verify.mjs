/* Stage `verify`: the orthophotos registered against the laser on stable
   ground, and the credential-free source inventory (from the Johannesberg
   pilot's register-ortho and source-inventory).

   Treetops are never used: an orthophoto displaces anything elevated away
   from the image nadir. The laser side is the intensity of near-ground returns
   (height above ground < 0.3 m) on the CHM lattice, gap-filled by a 0.5 m
   Gaussian; the photo side is a band of the mosaic, bilinear at the same cell
   centres. Over 50 m patches on a 100 m lattice where at least 85% of cells
   are open ground (pit-free CHM < 0.5 m; the rest is masked) and the image
   has structure (roads, paths, bunkers, mown edges), the normalised
   cross-correlation is searched over +-4 m in 0.25 m steps with a parabolic
   sub-step refinement. The median shift is the systematic offset (photo
   minus laser); the spread of patch shifts about it is the residual. A
   campaign is registered directly against the laser when at least 30 patches
   agree, else chained through a photo-photo pair; a shift under 0.25 m (half
   a CHM cell) is recorded but not applied. Written to registration.json;
   --decide-only re-decides from it. The photos confirm and classify; the
   laser places.                                                          */
import fs from 'node:fs';
import path from 'node:path';
import { loadMosaic, loadRaster, mosaicAt } from './panels.mjs';
import { smoothChm } from '../../packages/course-v2/vegetation/pit-free-chm.mjs';
import { readCampaigns } from './acquire.mjs';
import { laserPolicyProblems, orthoPolicyProblems } from './source-policy.mjs';
import { sha256File, writeReceipt } from './receipts.mjs';
import { displacementField } from './relief.mjs';

/* pairs: moving[:band]@reference[:band]; reference 'laser' is the near-ground intensity */
export function parsePairs(list) {
  return list.map(text => {
    const [moving, reference] = text.split('@');
    const [key, band = 'nir'] = moving.split(':');
    const [refKey, refBand = 'nir'] = reference.split(':');
    return { text, key, band, refKey, refBand };
  });
}
const BAND = { red: px => px[0], green: px => px[1], blue: px => px[2], nir: px => px[3], bright: px => (px[0] + px[1] + px[2]) / 3 };
const round = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

export function loadPoints(ctx) {
  const dir = ctx.paths.rasters;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'points.json'), 'utf8'));
  const bytes = fs.readFileSync(path.join(dir, 'points.bin'));
  return { meta, bytes, count: meta.count, record: meta.recordBytes };
}

function laserIntensityImage(ctx, grid) {
  const { bytes, count, record } = loadPoints(ctx);
  const size = grid.width * grid.height;
  const sum = new Float64Array(size);
  const n = new Uint16Array(size);
  const s = grid.sampleSpacingMetres;
  for (let i = 0; i < count; i++) {
    const o = i * record;
    const hag = bytes.readFloatLE(o + 8);
    if (!(hag < 0.3)) continue;
    const column = Math.floor(bytes.readFloatLE(o) / s);
    const row = Math.floor(bytes.readFloatLE(o + 4) / s);
    if (column < 0 || row < 0 || column >= grid.width || row >= grid.height) continue;
    const index = row * grid.width + column;
    sum[index] += bytes.readUInt16LE(o + 16);
    n[index]++;
  }
  const image = new Float32Array(size).fill(Number.NaN);
  for (let i = 0; i < size; i++) if (n[i]) image[i] = sum[i] / n[i];
  /* fill gaps by a NaN-aware blur evaluated everywhere */
  const filledInput = new Float32Array(image);
  const blurred = smoothChm(grid, filledInput.map(v => (Number.isNaN(v) ? 0 : v)), 0.5);
  const weight = smoothChm(grid, image.map(v => (Number.isNaN(v) ? 0 : 1)), 0.5);
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = weight[i] > 0.05 ? blurred[i] / weight[i] : Number.NaN;
  return out;
}

function ncc(a, b, mask) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < a.length; i++) {
    if (!mask[i]) continue;
    const x = a[i], y = b[i];
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y;
  }
  if (n < 500) return { r: Number.NaN, n };
  const cov = sab - (sa * sb) / n;
  const va = saa - (sa * sa) / n;
  const vb = sbb - (sb * sb) / n;
  return { r: va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : Number.NaN, n };
}

/**
 * The shift each campaign is sampled with. A direct laser pair counts when it
 * rests on at least 30 accepted patches; otherwise the campaign is chained
 * through a photo-photo pair to a campaign that has one. A shift under
 * 0.25 m (half a CHM cell) is recorded but not applied.
 */
export function decideShifts(result) {
  const pairs = Object.entries(result.pairs);
  const direct = new Map();
  for (const [, pair] of pairs) if (pair.reference.source && pair.patchesAccepted >= 30) direct.set(pair.moving.campaign, { dE: pair.medianShift.dE, dN: pair.medianShift.dN, via: 'laser', patches: pair.patchesAccepted, residualMedian: pair.residualAboutMedian.median, residualP90: pair.residualAboutMedian.p90 });
  const decisions = {};
  for (const [, pair] of pairs) {
    const key = pair.moving.campaign;
    if (direct.has(key)) { decisions[key] = direct.get(key); continue; }
    const base = pair.reference.campaign && direct.get(pair.reference.campaign);
    if (!base) continue;
    const candidate = { dE: base.dE + pair.medianShift.dE, dN: base.dN + pair.medianShift.dN, via: `${pair.moving.band} against ${pair.reference.campaign} ${pair.reference.band}, then laser`, patches: pair.patchesAccepted, residualMedian: pair.residualAboutMedian.median, residualP90: pair.residualAboutMedian.p90 };
    if (!decisions[key] || candidate.patches > decisions[key].patches) decisions[key] = candidate;
  }
  const applied = {};
  for (const [key, decision] of Object.entries(decisions)) {
    decision.magnitude = round(Math.hypot(decision.dE, decision.dN));
    decision.dE = round(decision.dE); decision.dN = round(decision.dN);
    applied[key] = decision.magnitude >= 0.25 ? { dE: decision.dE, dN: decision.dN } : null;
  }
  return { decisions, applied, rule: 'direct laser pair with >= 30 accepted patches, else chained through the photo-photo pair with most accepted patches; applied only when >= 0.25 m' };
}

export function register(ctx, pairs) {
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const grid = chm.grid;
  const intensity = laserIntensityImage(ctx, grid);
  const inner = ctx.innerWindow;
  const patch = 50;
  const step = 0.25;
  const reach = 4;
  const result = { schemaVersion: 1, kind: 'orthophoto-registration', method: 'patchwise NCC on open ground (pit-free CHM < 0.5 m on >= 85% of a 50 m patch, the rest masked; patches on a 100 m lattice), +-4 m search in 0.25 m steps, parabolic refinement. Reference either the laser near-ground intensity (HAG < 0.3 m, 0.5 m cells, gap-filled) or another orthophoto band; shift = moving position minus reference position. Accepted: peak r >= 0.35, >= 0.15 above the patch median, not on the search border.', pairs: {} };
  const mosaics = new Map();
  const mosaicOf = key => { if (!mosaics.has(key)) mosaics.set(key, loadMosaic(ctx, key)); return mosaics.get(key); };
  for (const pair of pairs) {
    const key = pair.key;
    const mosaic = mosaicOf(key);
    const band = BAND[pair.band];
    const refMosaic = pair.refKey === 'laser' ? null : mosaicOf(pair.refKey);
    const refBand = BAND[pair.refBand];
    const patches = [];
    const px = new Float64Array(4);
    for (let e0 = inner.minEasting + 25; e0 + patch <= inner.maxEasting; e0 += 100) {
      for (let n0 = inner.minNorthing + 25; n0 + patch <= inner.maxNorthing; n0 += 100) {
        const c0 = Math.round((e0 - grid.minEasting) / grid.sampleSpacingMetres);
        const r0 = Math.round((grid.maxNorthing - (n0 + patch)) / grid.sampleSpacingMetres);
        const w = Math.round(patch / grid.sampleSpacingMetres);
        const a = new Float32Array(w * w);
        const mask = new Uint8Array(w * w);
        let open = 0;
        for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
          const index = (r0 + y) * grid.width + (c0 + x);
          const h = chm.values[index];
          if (refMosaic) {
            mosaicAt(refMosaic, grid.minEasting + (c0 + x + 0.5) * grid.sampleSpacingMetres, grid.maxNorthing - (r0 + y + 0.5) * grid.sampleSpacingMetres, px);
            a[y * w + x] = refBand(px);
          } else a[y * w + x] = intensity[index];
          if (h < 0.5) { mask[y * w + x] = 1; open++; }
        }
        if (open < 0.85 * w * w) continue;
        /* structure: the intensity image must vary over the open cells */
        let s1 = 0, s2 = 0, m = 0;
        for (let i = 0; i < a.length; i++) if (mask[i] && !Number.isNaN(a[i])) { s1 += a[i]; s2 += a[i] * a[i]; m++; }
        const sd = Math.sqrt(Math.max(0, s2 / m - (s1 / m) ** 2));
        if (!(sd > 0) || sd / (s1 / m) < 0.08) continue;
        const shifts = Math.round(reach / step);
        const surface = [];
        let best = { r: -Infinity };
        const b = new Float32Array(w * w);
        for (let iy = -shifts; iy <= shifts; iy++) {
          const row = [];
          for (let ix = -shifts; ix <= shifts; ix++) {
            const dE = ix * step, dN = iy * step;
            for (let y = 0; y < w; y++) {
              const n = grid.maxNorthing - (r0 + y + 0.5) * grid.sampleSpacingMetres;
              for (let x = 0; x < w; x++) {
                const e = grid.minEasting + (c0 + x + 0.5) * grid.sampleSpacingMetres;
                mosaicAt(mosaic, e + dE, n + dN, px);
                b[y * w + x] = band(px);
              }
            }
            const { r } = ncc(a, b, mask);
            row.push(r);
            if (r > best.r) best = { r, ix, iy };
          }
          surface.push(row);
        }
        if (!Number.isFinite(best.r)) continue;
        const atBorder = Math.abs(best.ix) === shifts || Math.abs(best.iy) === shifts;
        const at = (ix, iy) => surface[iy + shifts]?.[ix + shifts];
        const parabola = (m1, c, p1) => { const d = m1 - 2 * c + p1; return Number.isFinite(d) && d < 0 ? 0.5 * (m1 - p1) / d : 0; };
        const fx = atBorder ? 0 : parabola(at(best.ix - 1, best.iy), best.r, at(best.ix + 1, best.iy));
        const fy = atBorder ? 0 : parabola(at(best.ix, best.iy - 1), best.r, at(best.ix, best.iy + 1));
        /* the peak must stand clear of the patch's flat correlation */
        const flat = surface.flat().filter(Number.isFinite).sort((p, q) => p - q);
        const median = flat[Math.floor(flat.length / 2)];
        patches.push({ centre: [e0 + patch / 2, n0 + patch / 2], openFraction: round(open / (w * w)), peakR: round(best.r), medianR: round(median), atBorder, dE: round((best.ix + fx) * step), dN: round((best.iy + fy) * step) });
      }
    }
    const accepted = patches.filter(p => !p.atBorder && p.peakR >= 0.35 && p.peakR - p.medianR >= 0.15);
    const med = values => { const s = [...values].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const dE = med(accepted.map(p => p.dE));
    const dN = med(accepted.map(p => p.dN));
    const residuals = accepted.map(p => Math.hypot(p.dE - dE, p.dN - dN)).sort((x, y) => x - y);
    const magnitudes = accepted.map(p => Math.hypot(p.dE, p.dN)).sort((x, y) => x - y);
    result.pairs[pair.text] = {
      moving: { campaign: key, date: mosaic.date, band: pair.band },
      reference: pair.refKey === 'laser' ? { source: `laser ${ctx.config.laser.capturedOn} near-ground intensity` } : { campaign: pair.refKey, date: refMosaic.date, band: pair.refBand },
      patchesTried: patches.length,
      patchesAccepted: accepted.length,
      medianShift: { dE: round(dE), dN: round(dN), magnitude: round(Math.hypot(dE, dN)) },
      residualAboutMedian: { median: round(med(residuals)), p90: round(residuals[Math.floor(0.9 * (residuals.length - 1))]), max: round(residuals.at(-1)) },
      shiftMagnitude: { median: round(med(magnitudes)), p90: round(magnitudes[Math.floor(0.9 * (magnitudes.length - 1))]) },
      applied: Math.hypot(dE, dN) >= 0.25 ? { dE: round(dE), dN: round(dN) } : null,
      patches,
    };
    console.log(pair.text, JSON.stringify({ ...result.pairs[pair.text], patches: undefined }));
  }
  return result;
}

/** The credential-free evidence ledger: what was read, from where, captured when, with which checksums and over what coverage. */
export function sourceInventory(ctx) {
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const campaignsPath = path.join(ctx.root, ctx.config.laser.campaigns);
  const campaigns = readCampaigns(ctx);
  const canopy = read(ctx.reviewFile('canopy-rasters.json'));
  const ortho = read(path.join(ctx.paths.ortho, 'ledger.json'));
  const registration = read(ctx.reviewFile('registration.json'));
  const w = ctx.haloWindow;
  const policy = [...laserPolicyProblems(campaigns, ctx.config.laser.items), ...orthoPolicyProblems(ctx.config.orthophotos.campaigns)];
  return {
    schemaVersion: 1,
    kind: 'source-inventory',
    reviewId: ctx.config.reviewId,
    groundId: ctx.groundId,
    observedOn: ctx.reviewDate,
    frame: 'EPSG:3006 horizontal, RH2000 (EPSG:5613) heights, compound EPSG:5845',
    windowEpsg3006: { inner: ctx.innerWindow, analysed: w },
    provider: 'Lantmäteriet only (Skogsstyrelsen not used; the surface model matched from aerial photos not used)',
    sourcePolicy: { checked: 'tools/tree-pipeline/source-policy.mjs', problems: policy },
    laser: {
      collection: campaigns.collection,
      discovery: campaigns.discovery,
      campaign: ctx.config.laser.campaign,
      capturedOn: ctx.config.laser.capturedOn,
      leafState: ctx.config.laser.leafState,
      label: ctx.config.laser.label,
      note: ctx.config.laser.note ?? null,
      pin: { file: ctx.config.laser.campaigns, sha256: sha256File(campaignsPath) },
      items: campaigns.items.filter(i => ctx.config.laser.items.includes(i.id)).map(i => ({ id: i.id, href: i.assets.data.href, bytes: i.assets.data.bytes, sha256: i.assets.data.sha256, projBbox: i.projBbox, pointCount: i.statistics?.pointCount ?? null, allReturnDensityPerSquareMetre: i.statistics?.allReturnDensityPerSquareMetre ?? null, updatedAt: i.updatedAt ?? null })),
      licence: campaigns.terms,
      measured: canopy.innerDensity,
      groundCheck: canopy.groundCheck,
    },
    orthophotos: Object.fromEntries(Object.entries(ortho.campaigns).map(([key, c]) => [key, {
      collection: c.collection, date: c.date, season: c.season, bands: c.items[0].bands,
      bandEvidence: 'TIFF photometric RGB (2) with one unspecified extra sample (ExtraSamples 0, not alpha), 4 x 8 bit, pixel-interleaved',
      items: c.items.map(i => ({ id: i.id, href: i.href, captureStart: i.captureStart, captureEnd: i.captureEnd, sourceBytes: i.sourceBytes, stacSha256: i.stacSha256, software: i.tiffTags.software, tilesCached: i.tilesCached, tileHashDigest: i.tileHashDigest })),
      windowEpsg3006: c.windowEpsg3006,
      mosaic: { pixelMetres: c.mosaic.pixelMetres, width: c.mosaic.width, height: c.mosaic.height, validFraction: c.mosaic.validFraction, sha256: c.mosaic.sha256 },
      registration: registration.decisions?.[key] || null,
      applied: registration.applied?.[key] ?? null,
    }])),
    orthophotosAvailableNotFetched: ctx.config.orthophotos.notFetched ?? {},
    terrain: { baselineGroundManifest: ctx.config.published.baselineGroundManifest, note: 'tree bases sample the published terrain the app draws (createGroundHeightLookup over the finest tiles)' },
    rawCaches: { copc: ctx.rel(ctx.paths.copc), ortho: ctx.rel(ctx.paths.ortho), rasters: ctx.rel(ctx.paths.rasters), note: 'ignored by git; never committed' },
  };
}

/**
 * The relief displacement of the canopy in every photo campaign (relief.mjs),
 * as a field of 64 m blocks over the halo window: where each photo draws a
 * crown top of a given height. Registration above aligns the ground; this
 * aligns the canopy, which the photo-referee detector and per-crown photo
 * evidence need. Written to relief-displacement.json (evidence: k per block,
 * its correlation and state; no pixels).
 */
export function reliefDisplacement(ctx) {
  const chm = loadRaster(ctx, 'chm-pitfree-050');
  const H = ctx.haloWindow;
  const bbox = [H.minEasting, H.minNorthing, H.maxEasting, H.maxNorthing];
  const campaigns = {};
  for (const c of ctx.config.orthophotos.campaigns) {
    const mosaic = loadMosaic(ctx, c.key);
    const field = displacementField(chm, mosaic, c.sun, bbox);
    const states = field.blocks.reduce((a, b) => ((a[b.state] = (a[b.state] || 0) + 1), a), {});
    const measured = field.blocks.filter(b => b.state === 'measured');
    const q = (v, f) => { const s = [...v].sort((a, b) => a - b); return s.length ? Math.round(s[Math.floor(f * (s.length - 1))] * 1000) / 1000 : null; };
    const magnitude = measured.map(b => Math.hypot(b.kx, b.ky));
    campaigns[c.key] = { date: c.date, collection: c.collection, sun: c.sun, states, magnitude: { p10: q(magnitude, 0.1), median: q(magnitude, 0.5), p90: q(magnitude, 0.9) }, field };
    console.log(`relief ${c.key}: ${JSON.stringify(states)}; |k| median ${q(magnitude, 0.5)} (p10 ${q(magnitude, 0.1)}, p90 ${q(magnitude, 0.9)})`);
  }
  const out = {
    schemaVersion: 1,
    kind: 'canopy-relief-displacement',
    groundId: ctx.groundId,
    note: 'Where each orthophoto draws a crown top: k (metres of horizontal displacement per metre of height above ground; the photo shows a top of height h at E + kx h, N + ky h), per 64 m block, from the photo correlated with a hillshade of the pit-free CHM lit from the flight’s own sun over canopy cells (relief.mjs). Ground registration (registration.json) cannot see this; standard orthophotos are rectified on the ground model.',
    chmSha256: chm.sidecar.sha256,
    campaigns,
  };
  const file = ctx.reviewFile('relief-displacement.json');
  fs.writeFileSync(file, `${JSON.stringify(out)}\n`);
  return { file, out };
}

export async function run(ctx, options) {
  if (options.relief) {
    const { file, out } = reliefDisplacement(ctx);
    writeReceipt(ctx, 'verify-relief', { inputs: [path.join(ctx.paths.rasters, 'chm-pitfree-050.bin'), ...ctx.config.orthophotos.campaigns.map(c => path.join(ctx.paths.ortho, c.key, `mosaic-${c.key}-032.rgbi`))], outputs: [file], result: Object.fromEntries(Object.entries(out.campaigns).map(([k, v]) => [k, { states: v.states, magnitude: v.magnitude }])) });
    return { status: 'done', message: `relief displacement written: ${ctx.rel(file)}` };
  }
  const file = ctx.reviewFile('registration.json');
  let result;
  if (options['decide-only']) {
    result = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    result = register(ctx, parsePairs(options.pairs ? options.pairs.split(',') : ctx.config.registration.pairs));
  }
  Object.assign(result, decideShifts(result));
  fs.writeFileSync(file, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify({ decisions: result.decisions, applied: result.applied }, null, 1));
  const inventory = sourceInventory(ctx);
  const inventoryPath = ctx.reviewFile('source-inventory.json');
  fs.writeFileSync(inventoryPath, JSON.stringify(inventory, null, 2) + '\n');
  const missing = ctx.config.orthophotos.campaigns.filter(c => !result.decisions?.[c.key]).map(c => c.key);
  writeReceipt(ctx, 'verify', {
    inputs: [path.join(ctx.paths.rasters, 'chm-pitfree-050.bin'), path.join(ctx.paths.rasters, 'points.bin'), ...ctx.config.orthophotos.campaigns.map(c => path.join(ctx.paths.ortho, c.key, `mosaic-${c.key}-032.rgbi`))],
    outputs: [file, inventoryPath], options: { decideOnly: Boolean(options['decide-only']) },
    result: { decisions: result.decisions, applied: result.applied, unregistered: missing, sourcePolicyProblems: inventory.sourcePolicy.problems },
  });
  if (inventory.sourcePolicy.problems.length) return { status: 'stop', message: `source policy problems: ${inventory.sourcePolicy.problems.join('; ')}` };
  if (missing.length) {
    return { status: 'stop', message: `no registration decision for ${missing.join(', ')}: too few open-ground patches agree. Inspect registration.json and the panels; ask the owner before using an unregistered photo for review.` };
  }
  return { status: 'done', message: `registration: ${Object.entries(result.decisions).map(([k, d]) => `${k} ${d.magnitude} m via ${d.via} (${result.applied[k] ? 'applied' : 'not applied'})`).join('; ')}; source-inventory.json written` };
}
