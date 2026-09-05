/* The published 1 m laser terrain of this ground, read in Node.

   Ribbingsfors is authored in the grid frame, so a tile's easting minus the
   origin IS local x and the origin's northing minus a northing IS local z:
   no bridge, no datum step (heights are RH 2000 in both). The 64 level-0
   tiles cover x, z in [-1024, 1024]. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChunk } from '../packages/course-v2/chunk-node.mjs';
import { decodeTerrainGrid } from '../packages/course-v2/terrain-grid.mjs';
import { encodePNG } from '../geobuild/png.mjs';
import { FRAME } from './frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.resolve(HERE, '..', 'apps/golf/public');

export function loadTerrain(slug = 'ribbingsfors') {
  const root = JSON.parse(fs.readFileSync(path.join(PUB, 'courses/v2-index.json'), 'utf8'));
  const entry = root.courses.find(c => c.slug === slug);
  if (!entry) throw new Error(`no v2 course ${slug}`);
  const course = JSON.parse(fs.readFileSync(path.join(PUB, entry.manifest.url), 'utf8'));
  const ground = JSON.parse(fs.readFileSync(path.join(PUB, course.groundManifest.url), 'utf8'));
  const frame = ground.ground?.frame ?? ground.frame;
  if (Math.abs(frame.origin.easting - FRAME.easting) > 1e-6 || Math.abs(frame.origin.northing - FRAME.northing) > 1e-6) {
    throw new Error('the published ground frame is not the build frame');
  }
  const l0 = ground.tiles.filter(t => t.id.startsWith('l0/'));
  let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
  for (const t of l0) { minE = Math.min(minE, t.bounds.minEasting); maxE = Math.max(maxE, t.bounds.maxEasting); minN = Math.min(minN, t.bounds.minNorthing); maxN = Math.max(maxN, t.bounds.maxNorthing); }
  const W = Math.round(maxE - minE) + 1, H = Math.round(maxN - minN) + 1;
  const dem = new Float32Array(W * H).fill(NaN);
  for (const t of l0) {
    const chunk = readChunk(fs.readFileSync(path.join(PUB, t.layers.terrain.url)));
    const grid = chunk.header.grid, heights = decodeTerrainGrid(chunk.payload, grid);
    const c0 = Math.round(t.bounds.minEasting - minE), r0 = Math.round(maxN - t.bounds.maxNorthing);
    for (let r = 0; r < grid.height; r++) for (let c = 0; c < grid.width; c++) dem[(r0 + r) * W + c0 + c] = heights[r * grid.width + c];
  }
  const x0 = minE - FRAME.easting, z0 = FRAME.northing - maxN;   /* west / north edges, sample centres on integers */
  const hAt = (x, z) => {
    const c = x - x0, r = z - z0, c0 = Math.floor(c), r0 = Math.floor(r);
    if (c0 < 0 || r0 < 0 || c0 + 1 >= W || r0 + 1 >= H) return NaN;
    const tx = c - c0, tz = r - r0, at = (cc, rr) => dem[rr * W + cc];
    const a = at(c0, r0), b = at(c0 + 1, r0), d = at(c0, r0 + 1), e = at(c0 + 1, r0 + 1);
    return (a + (b - a) * tx) * (1 - tz) + (d + (e - d) * tx) * tz;
  };
  const cellOf = (x, z) => { const c = Math.round(x - x0), r = Math.round(z - z0); return (c < 0 || r < 0 || c >= W || r >= H) ? -1 : r * W + c; };
  return { dem, W, H, x0, z0, tiles: l0.length, hAt, cellOf, worldOf: i => [x0 + i % W, z0 + Math.floor(i / W)] };
}

/** 10–90 percentile spread of the heights in a (2r+1) m square: a mown deck reads under 0.10 m. */
export function spreadAt(T, x, z, r = 2) {
  const hs = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { const h = T.hAt(x + dx, z + dz); if (Number.isFinite(h)) hs.push(h); }
  if (hs.length < 5) return NaN;
  hs.sort((a, b) => a - b);
  return hs[Math.floor(hs.length * 0.9)] - hs[Math.floor(hs.length * 0.1)];
}

/** Residual from the best-fit plane over a (2r+1) m square: how bumpy the ground is at metre scale. */
export function planeResidualAt(T, x, z, r = 2) {
  let n = 0, sx = 0, sz = 0, sh = 0, sxx = 0, szz = 0, sxz = 0, sxh = 0, szh = 0;
  const pts = [];
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const h = T.hAt(x + dx, z + dz); if (!Number.isFinite(h)) continue;
    pts.push([dx, dz, h]); n++; sx += dx; sz += dz; sh += h; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; sxh += dx * h; szh += dz * h;
  }
  if (n < 6) return NaN;
  /* symmetric window: sx = sz = sxz = 0, so the slopes decouple */
  const a = sxh / sxx, b = szh / szz, c = sh / n;
  let ss = 0; for (const [dx, dz, h] of pts) { const e = h - (a * dx + b * dz + c); ss += e * e; }
  return Math.sqrt(ss / n);
}

/** Hillshade PNG of a box for review (sun from the north-west, 45° elevation). */
export function writeHillshade(T, box, file, { scale = 4, sunAz = 315, sunEl = 45 } = {}) {
  const w = Math.round((box.x1 - box.x0) * scale), h = Math.round((box.z1 - box.z0) * scale);
  const rgb = new Uint8Array(w * h * 3);
  const az = sunAz * Math.PI / 180, el = sunEl * Math.PI / 180;
  const lx = Math.sin(az) * Math.cos(el), lz = -Math.cos(az) * Math.cos(el), ly = Math.sin(el);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const x = box.x0 + c / scale, z = box.z0 + r / scale;
    const dx = (T.hAt(x + 0.5, z) - T.hAt(x - 0.5, z)), dz = (T.hAt(x, z + 0.5) - T.hAt(x, z - 0.5));
    let shade = 128;
    if (Number.isFinite(dx) && Number.isFinite(dz)) {
      const nx = -dx, nz = -dz, ny = 1, len = Math.hypot(nx, ny, nz);
      shade = Math.max(0, Math.min(255, Math.round(255 * Math.max(0, (nx * lx + ny * ly + nz * lz) / len))));
    }
    const o = (r * w + c) * 3; rgb[o] = rgb[o + 1] = rgb[o + 2] = shade;
  }
  fs.writeFileSync(file, encodePNG(w, h, rgb));
  return { w, h };
}
