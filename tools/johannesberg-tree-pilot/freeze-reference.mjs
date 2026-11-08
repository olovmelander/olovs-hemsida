#!/usr/bin/env node
/* Freeze the reference sample: annotations -> reference.geojson + reference-lock.json.

   usage: node tools/johannesberg-tree-pilot/freeze-reference.mjs

   Reads the declared windows (reference-windows.json), the interpreter's
   decisions (reference-annotations.json) and the numbered candidates the
   panels showed (ignored cache), and writes every reference crown with its
   window, role (calibration / evaluation), whether it is scored (inside the
   window rectangle and outside any ambiguity box) or only matchable (in the
   6 m margin), type, stratum, laser height and a reference-seeded crown
   segment. The lock records the hashes of all inputs and the freeze time; a
   benchmark refuses to run against a reference whose lock does not match.  */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PILOT, sampleFile } from './pilot-config.mjs';
import { ROOT, loadRaster } from './panels.mjs';
import { createRaster } from '../../packages/course-v2/vegetation/canopy-fields.mjs';
import { crownStatistics } from '../../packages/course-v2/vegetation/crown-detect.mjs';
import { growCrownsSimultaneous } from '../../packages/course-v2/vegetation/tree-detect-v2.mjs';
import { smoothChm } from '../../packages/course-v2/vegetation/pit-free-chm.mjs';

const reviewDir = path.join(ROOT, PILOT.reviewDir);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Reference-seeded crown segments: simultaneous Dalponte growth from the reference crowns only,
    then extended down to a fifth of each apex, so every reference keeps its own visible crown. */
export function referenceSegments(chm, crowns, margin = 14) {
  const g = chm.grid;
  const s = g.sampleSpacingMetres;
  const e0 = Math.min(...crowns.map(c => c.easting)) - margin, e1 = Math.max(...crowns.map(c => c.easting)) + margin;
  const n0 = Math.min(...crowns.map(c => c.northing)) - margin, n1 = Math.max(...crowns.map(c => c.northing)) + margin;
  const c0 = Math.max(0, Math.floor((e0 - g.minEasting) / s)), c1 = Math.min(g.width, Math.ceil((e1 - g.minEasting) / s));
  const r0 = Math.max(0, Math.floor((g.maxNorthing - n1) / s)), r1 = Math.min(g.height, Math.ceil((g.maxNorthing - n0) / s));
  const width = c1 - c0, height = r1 - r0;
  const values = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) values[r * width + c] = chm.values[(r0 + r) * g.width + c0 + c];
  const sub = { minEasting: g.minEasting + c0 * s, maxNorthing: g.maxNorthing - r0 * s, width, height, sampleSpacingMetres: s };
  const smooth = smoothChm(sub, values, 0.3);
  const raster = v => createRaster({ width, height, sampleSpacingMetres: s, originEasting: sub.minEasting, originNorthing: sub.maxNorthing, values: v });
  const detection = raster(smooth);
  const seeds = crowns.map(c => {
    const column = Math.min(width - 1, Math.max(0, Math.floor((c.easting - sub.minEasting) / s)));
    const row = Math.min(height - 1, Math.max(0, Math.floor((sub.maxNorthing - c.northing) / s)));
    return { column, row, index: row * width + column, height: Math.max(smooth[row * width + column] || 0, c.heightMetres) };
  });
  const order = seeds.map((seed, i) => i).sort((a, b) => seeds[b].height - seeds[a].height);
  const ordered = order.map(i => seeds[i]);
  const grid = { minEasting: sub.minEasting, maxNorthing: sub.maxNorthing, width, height, sampleSpacingMetres: s };
  const labels = growCrownsSimultaneous(grid, smooth, ordered, { seedFraction: 0.35, crownFraction: 0.5, maximumCrownRadiusMetres: 9, minimumHeightMetres: 2 });
  growCrownsSimultaneous(grid, smooth, ordered, { seedFraction: 0.2, crownFraction: 0, maximumCrownRadiusMetres: 9, minimumHeightMetres: 2, initialLabels: labels });
  const stats = crownStatistics(raster(values), labels, ordered);
  const out = new Array(crowns.length);
  order.forEach((original, k) => { out[original] = stats[k]; });
  return out;
}

async function main() {
  const windowsPath = path.join(reviewDir, sampleFile('reference-windows'));
  const annotationsPath = path.join(reviewDir, sampleFile('reference-annotations'));
  const windows = JSON.parse(fs.readFileSync(windowsPath, 'utf8'));
  const annotations = JSON.parse(fs.readFileSync(annotationsPath, 'utf8'));
  const chm = loadRaster('chm-pitfree-050');
  const features = [];
  const candidateHashes = {};
  const counts = {};
  for (const window of windows.windows) {
    const entry = annotations.windows.find(w => w.window === window.id);
    if (!entry) throw new Error(`no annotations for ${window.id}`);
    const candidatesPath = path.join(ROOT, PILOT.cacheDir, 'reference-panels', `${window.id}.candidates.json`);
    const { candidates } = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
    candidateHashes[window.id] = sha(candidatesPath);
    const byNumber = new Map(candidates.map(c => [c.number, c]));
    const [we, wn, ee, en] = window.bbox;
    const crowns = entry.crowns.map((crown, i) => {
      let easting, northing, height;
      /* an explicit crown centre wins over the tallest candidate's position;
         the candidates still give the height */
      if (crown.from) {
        const picked = crown.from.map(n => { const c = byNumber.get(n); if (!c) throw new Error(`${window.id}: candidate ${n} does not exist`); return c; });
        const top = picked.reduce((a, b) => (b.heightMetres > a.heightMetres ? b : a));
        easting = top.easting; northing = top.northing; height = top.heightMetres;
        if (crown.at) { easting = we + crown.at[0]; northing = wn + crown.at[1]; }
      } else if (crown.at) {
        easting = we + crown.at[0]; northing = wn + crown.at[1];
        const s = chm.grid.sampleSpacingMetres;
        let best = 0;
        for (let dy = -1; dy <= 1; dy += s) for (let dx = -1; dx <= 1; dx += s) {
          const c = Math.floor((easting + dx - chm.grid.minEasting) / s), r = Math.floor((chm.grid.maxNorthing - northing - dy) / s);
          const v = chm.values[r * chm.grid.width + c];
          if (v > best) best = v;
        }
        height = best;
      } else throw new Error(`${window.id}: crown ${i} has neither from nor at`);
      const inside = easting >= we && easting < ee && northing >= wn && northing < en;
      const ambiguous = (entry.ambiguous || []).some(a => easting >= we + a.box[0] && easting < we + a.box[2] && northing >= wn + a.box[1] && northing < wn + a.box[3]);
      return { id: `${window.id}-${String(i + 1).padStart(2, '0')}`, window: window.id, role: window.role, easting: round(easting), northing: round(northing), heightMetres: round(height), type: crown.type, stratum: crown.stratum, source: crown.from ? { candidates: crown.from } : { placedRelative: crown.at }, scored: inside && !ambiguous && height >= windows.minimumScoredHeightMetres, zone: inside ? (ambiguous ? 'ambiguous' : 'window') : 'margin', note: crown.note || null };
    });
    const segments = crowns.length ? referenceSegments(chm, crowns) : [];
    crowns.forEach((crown, i) => {
      const seg = segments[i];
      crown.segment = seg ? { areaSquareMetres: seg.areaSquareMetres, equivalentRadiusMetres: seg.equivalentRadiusMetres, centroid: seg.centroid } : null;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [crown.easting, crown.northing] }, properties: crown });
      const key = `${window.role}`;
      counts[key] = counts[key] || { scored: 0, window: 0, margin: 0, ambiguous: 0, smallUnder3m: 0 };
      counts[key][crown.zone]++;
      if (crown.scored) counts[key].scored++;
      if (crown.zone === 'window' && crown.heightMetres < windows.minimumScoredHeightMetres) counts[key].smallUnder3m++;
    });
    for (const [n, reason] of Object.entries(entry.rejected || {})) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [byNumber.get(Number(n))?.easting, byNumber.get(Number(n))?.northing] }, properties: { window: window.id, rejectedCandidate: Number(n), reason } });
    for (const a of entry.ambiguous || []) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[we + a.box[0], wn + a.box[1]], [we + a.box[2], wn + a.box[1]], [we + a.box[2], wn + a.box[3]], [we + a.box[0], wn + a.box[3]], [we + a.box[0], wn + a.box[1]]]] }, properties: { window: window.id, ambiguity: a.reason } });
    features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[we, wn], [ee, wn], [ee, en], [we, en], [we, wn]]] }, properties: { scoringWindow: window.id, role: window.role, holes: window.holes } });
  }
  const geojson = { type: 'FeatureCollection', name: 'johannesberg-reference-2026-11-08', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3006' } }, features };
  const referencePath = path.join(reviewDir, sampleFile('reference', 'geojson'));
  fs.writeFileSync(referencePath, JSON.stringify(geojson, null, 1) + '\n');
  const previous = fs.existsSync(path.join(reviewDir, sampleFile('reference-lock'))) ? JSON.parse(fs.readFileSync(path.join(reviewDir, sampleFile('reference-lock')), 'utf8')) : null;
  const lock = {
    schemaVersion: 1,
    kind: 'reference-lock',
    frozenAt: new Date().toISOString(),
    history: [...(previous?.history || []), ...(previous ? [{ frozenAt: previous.frozenAt, reference: previous.hashes.reference, annotations: previous.hashes.annotations }] : [])],
    refreezeNote: process.env.REFREEZE_NOTE || null,
    interpreter: 'agent-led interpretation (Claude), not a survey or human approval',
    evidence: 'pit-free CHM 0.5 m (2021-04-17 laser), 2025-06-14 RGBI (CIR and natural colour), 2021-04-18 RGBI (leaf-off natural colour); numbered over-segmentation candidates only save typing positions',
    matchingRule: windows.matchingRule,
    minimumScoredHeightMetres: windows.minimumScoredHeightMetres,
    counts,
    hashes: { windows: sha(windowsPath), annotations: sha(annotationsPath), reference: sha(referencePath), chm: loadRaster('chm-pitfree-050').sidecar.sha256, candidates: candidateHashes },
  };
  fs.writeFileSync(path.join(reviewDir, sampleFile('reference-lock')), JSON.stringify(lock, null, 2) + '\n');
  console.log(JSON.stringify(counts, null, 1));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
