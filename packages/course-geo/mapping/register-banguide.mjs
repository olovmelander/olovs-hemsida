#!/usr/bin/env node
/* Control-point banguide / schematic diagram registration into EPSG:3006.
 *
 * Fits a 4-DOF similarity (scale, rotation, translation) or 6-DOF affine
 * transform using least squares + deterministic RANSAC outlier rejection,
 * reports leave-one-out (LOO) cross-validation residuals in metres, and
 * projects diagram pixel annotations into EPSG:3006 strictly tagged as a
 * corroboration layer (never treated as orthophoto or survey truth).
 *
 * Usage:
 *   node packages/course-geo/mapping/register-banguide.mjs \
 *     --controls control-points.json --out registered-banguide.json \
 *     [--model similarity|affine] [--ransac-threshold 12] [--annotations pixels.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function solveLinearSystem(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('Singular normal equations; control points are collinear or degenerate');
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const diag = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= diag;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map(row => row[n]);
}

function normalEquations(rows, rhs) {
  const cols = rows[0].length;
  const ATA = Array.from({ length: cols }, () => new Array(cols).fill(0));
  const ATb = new Array(cols).fill(0);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], y = rhs[i];
    for (let a = 0; a < cols; a++) {
      ATb[a] += r[a] * y;
      for (let b = 0; b < cols; b++) ATA[a][b] += r[a] * r[b];
    }
  }
  return solveLinearSystem(ATA, ATb);
}

/**
 * Fit a 4-DOF similarity transform from image pixels (u, v) to EPSG:3006 (E, N):
 *   E = a * u - b * v + tx   (for right-handed; image y-down uses flipped v so)
 *   E = a * u + b * v + tx
 *   N = b * u - a * v + ty   (preserves handedness when v grows downward in images!)
 */
export function fitSimilarity(controls) {
  if (controls.length < 2) throw new Error('Similarity registration requires at least 2 control points');
  const rows = [], rhs = [];
  for (const cp of controls) {
    const [u, v] = cp.pixel;
    const [e, n] = cp.epsg3006;
    rows.push([u, v, 1, 0]); rhs.push(e);
    rows.push([-v, u, 0, 1]); rhs.push(n);
  }
  const [a, b, tx, ty] = normalEquations(rows, rhs);
  const scale = Math.hypot(a, b);
  const rotationDeg = Math.atan2(b, a) * (180 / Math.PI);
  return {
    model: 'similarity',
    matrix: [
      [a, b, tx],
      [b, -a, ty],
    ],
    metresPerPixel: Math.round(scale * 10000) / 10000,
    rotationDeg: Math.round(rotationDeg * 100) / 100,
  };
}

/**
 * Fit a 6-DOF affine transform from image pixels (u, v) to EPSG:3006 (E, N):
 *   E = a0 * u + a1 * v + a2
 *   N = b0 * u + b1 * v + b2
 */
export function fitAffine(controls) {
  if (controls.length < 3) throw new Error('Affine registration requires at least 3 control points');
  const rows = controls.map(cp => [cp.pixel[0], cp.pixel[1], 1]);
  const eParams = normalEquations(rows, controls.map(cp => cp.epsg3006[0]));
  const nParams = normalEquations(rows, controls.map(cp => cp.epsg3006[1]));
  const sx = Math.hypot(eParams[0], nParams[0]);
  const sy = Math.hypot(eParams[1], nParams[1]);
  const rotationDeg = Math.atan2(nParams[0], eParams[0]) * (180 / Math.PI);
  return {
    model: 'affine',
    matrix: [eParams, nParams],
    metresPerPixel: Math.round(((sx + sy) / 2) * 10000) / 10000,
    scaleX: Math.round(sx * 10000) / 10000,
    scaleY: Math.round(sy * 10000) / 10000,
    rotationDeg: Math.round(rotationDeg * 100) / 100,
  };
}

export function transformPixelToEpsg3006(transform, [u, v]) {
  const [[a0, a1, a2], [b0, b1, b2]] = transform.matrix;
  return [
    Math.round((a0 * u + a1 * v + a2) * 1000) / 1000,
    Math.round((b0 * u + b1 * v + b2) * 1000) / 1000,
  ];
}

function residualMetres(transform, cp) {
  const [pe, pn] = transformPixelToEpsg3006(transform, cp.pixel);
  return Math.hypot(pe - cp.epsg3006[0], pn - cp.epsg3006[1]);
}

function combinations(n, k) {
  const result = [];
  const cur = [];
  function dfs(start) {
    if (cur.length === k) { result.push([...cur]); return; }
    for (let i = start; i <= n - (k - cur.length); i++) {
      cur.push(i);
      dfs(i + 1);
      cur.pop();
    }
  }
  dfs(0);
  return result;
}

/**
 * Deterministic RANSAC + least-squares refinement + leave-one-out validation.
 */
export function registerBanguide(controls, {
  model = 'similarity',
  ransacThresholdMetres = 15,
} = {}) {
  const minPts = model === 'affine' ? 3 : 2;
  const fit = model === 'affine' ? fitAffine : fitSimilarity;
  if (!Array.isArray(controls) || controls.length < minPts) {
    throw new Error(`${model} registration requires at least ${minPts} control points`);
  }

  // Deterministic subset search (exact for <= 24 control points, strided sample if larger)
  let subsets;
  if (controls.length <= 20) {
    subsets = combinations(controls.length, minPts);
  } else {
    subsets = [];
    const stride = Math.max(1, Math.floor(controls.length / 18));
    const idx = [];
    for (let i = 0; i < controls.length; i += stride) idx.push(i);
    for (const c of combinations(idx.length, minPts)) subsets.push(c.map(k => idx[k]));
  }

  let bestInliers = [];
  let bestErrSum = Infinity;
  for (const sub of subsets) {
    try {
      const candidate = fit(sub.map(i => controls[i]));
      const inliers = [];
      let errSum = 0;
      for (let i = 0; i < controls.length; i++) {
        const err = residualMetres(candidate, controls[i]);
        if (err <= ransacThresholdMetres) {
          inliers.push(i);
          errSum += err * err;
        }
      }
      if (inliers.length > bestInliers.length || (inliers.length === bestInliers.length && errSum < bestErrSum)) {
        bestInliers = inliers;
        bestErrSum = errSum;
      }
    } catch {
      // Degenerate subset; skip
    }
  }

  if (bestInliers.length < minPts) {
    bestInliers = controls.map((_, i) => i);
  }
  const inlierSet = new Set(bestInliers);
  const inlierControls = bestInliers.map(i => controls[i]);
  const transform = fit(inlierControls);

  // Full residuals and leave-one-out cross-validation over inliers
  const pointReports = controls.map((cp, idx) => {
    const predicted = transformPixelToEpsg3006(transform, cp.pixel);
    const fitErrorM = Math.round(residualMetres(transform, cp) * 1000) / 1000;
    const isInlier = inlierSet.has(idx);
    let looErrorM = null;
    if (isInlier && inlierControls.length > minPts) {
      const without = inlierControls.filter(c => c !== cp);
      try {
        const subFit = fit(without);
        looErrorM = Math.round(residualMetres(subFit, cp) * 1000) / 1000;
      } catch {
        looErrorM = null;
      }
    }
    return {
      id: cp.id || `cp-${idx + 1}`,
      label: cp.label || null,
      pixel: cp.pixel,
      epsg3006: cp.epsg3006,
      predictedEpsg3006: predicted,
      inlier: isInlier,
      fitErrorMetres: fitErrorM,
      leaveOneOutErrorMetres: looErrorM,
    };
  });

  const inlierErrors = pointReports.filter(p => p.inlier).map(p => p.fitErrorMetres);
  const looErrors = pointReports.filter(p => p.leaveOneOutErrorMetres !== null).map(p => p.leaveOneOutErrorMetres);
  const rmse = arr => arr.length ? Math.round(Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length) * 1000) / 1000 : null;

  return {
    schemaVersion: 1,
    provenance: 'registered-banguide-corroboration-not-survey',
    crs: 'EPSG:3006',
    transform,
    diagnostics: {
      totalControlPoints: controls.length,
      inlierCount: inlierControls.length,
      outlierCount: controls.length - inlierControls.length,
      ransacThresholdMetres,
      fitRmseMetres: rmse(inlierErrors),
      maxFitErrorMetres: inlierErrors.length ? Math.max(...inlierErrors) : null,
      leaveOneOutRmseMetres: rmse(looErrors),
      maxLeaveOneOutErrorMetres: looErrors.length ? Math.max(...looErrors) : null,
    },
    controlPoints: pointReports,
  };
}

export function projectPixelAnnotations(transform, annotations) {
  return {
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:3006' } },
    provenance: 'registered-banguide-corroboration-not-survey',
    features: annotations.map((ann, idx) => {
      const id = ann.id || `ann-${idx + 1}`;
      const geomType = ann.geometryType || (ann.points?.length === 1 ? 'Point' : ann.closed ? 'Polygon' : 'LineString');
      const projected = (ann.points || []).map(pt => transformPixelToEpsg3006(transform, pt));
      let geometry;
      if (geomType === 'Point') geometry = { type: 'Point', coordinates: projected[0] };
      else if (geomType === 'Polygon') {
        const ring = [...projected];
        if (ring.length >= 3 && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) ring.push([...ring[0]]);
        geometry = { type: 'Polygon', coordinates: [ring] };
      } else {
        geometry = { type: 'LineString', coordinates: projected };
      }
      return {
        type: 'Feature',
        id,
        properties: {
          kind: ann.kind || 'annotation',
          hole: ann.hole ?? null,
          label: ann.label || null,
          provenance: 'registered-banguide-corroboration-not-survey',
        },
        geometry,
      };
    }),
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`Unexpected argument: ${k}`);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${k} requires a value`);
    opts[k.slice(2)] = v;
    i++;
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.controls || !opts.out) {
    throw new Error('Usage: register-banguide.mjs --controls FILE --out FILE [--model similarity|affine] [--ransac-threshold 15] [--annotations FILE] [--geojson-out FILE]');
  }
  const spec = JSON.parse(fs.readFileSync(path.resolve(opts.controls), 'utf8'));
  const controls = Array.isArray(spec) ? spec : spec.controlPoints;
  const result = registerBanguide(controls, {
    model: opts.model || spec.model || 'similarity',
    ransacThresholdMetres: opts['ransac-threshold'] ? Number(opts['ransac-threshold']) : 15,
  });
  const outPath = path.resolve(opts.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ ...result, sourceImage: spec.sourceImage || null }, null, 2) + '\n', 'utf8');

  if (opts.annotations && opts['geojson-out']) {
    const anns = JSON.parse(fs.readFileSync(path.resolve(opts.annotations), 'utf8'));
    const fc = projectPixelAnnotations(result.transform, Array.isArray(anns) ? anns : anns.annotations);
    const geoPath = path.resolve(opts['geojson-out']);
    fs.mkdirSync(path.dirname(geoPath), { recursive: true });
    fs.writeFileSync(geoPath, JSON.stringify(fc, null, 2) + '\n', 'utf8');
  }
  console.log(JSON.stringify({ model: result.transform.model, diagnostics: result.diagnostics, out: outPath }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
