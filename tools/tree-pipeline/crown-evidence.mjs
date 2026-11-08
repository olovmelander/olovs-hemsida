/* Per-crown evidence (from the Johannesberg pilot): leaf-off return structure
   from the cached points, and orthophoto statistics from the 0.32 m mosaics.

   Photo sampling allows for relief displacement: a standard orthophoto shows
   a crown displaced radially from the image nadir by about h x d / H (height
   x ground distance from nadir / flying height), so the window searched for a
   crown's pixels is its laser radius plus 0.3 x height plus 1 m. The values are
   delivered 8-bit RGBI numbers, so (NIR - red) / (NIR + red) is a review
   contrast, not calibrated NDVI; zero denominators read 0.                */
import fs from 'node:fs';
import path from 'node:path';

export function displacementAllowance(heightMetres) {
  return 0.3 * Math.max(0, heightMetres) + 1;
}

/** Cached returns, decoded to typed arrays with lattice column/row for a grid. */
export function loadPointsFor(ctx, grid) {
  const dir = ctx.paths.rasters;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'points.json'), 'utf8'));
  const bytes = fs.readFileSync(path.join(dir, 'points.bin'));
  const n = meta.count;
  const out = { count: n, easting: new Float64Array(n), northing: new Float64Array(n), column: new Int32Array(n), row: new Int32Array(n), hag: new Float32Array(n), ground: new Uint8Array(n), returnNumber: new Uint8Array(n), intensity: new Uint16Array(n) };
  const s = grid.sampleSpacingMetres;
  for (let i = 0; i < n; i++) {
    const o = i * meta.recordBytes;
    const e = meta.originEasting + bytes.readFloatLE(o);
    const nn = meta.originNorthing - bytes.readFloatLE(o + 4);
    out.easting[i] = e; out.northing[i] = nn;
    out.column[i] = Math.floor((e - grid.minEasting) / s);
    out.row[i] = Math.floor((grid.maxNorthing - nn) / s);
    out.hag[i] = bytes.readFloatLE(o + 8);
    const cls = bytes[o + 12];
    out.ground[i] = cls === 2 || cls === 9 ? 1 : 0;
    out.returnNumber[i] = bytes[o + 13];
    out.intensity[i] = bytes.readUInt16LE(o + 16);
  }
  return out;
}

/** A coarse spatial index over points for radius queries. */
export function pointIndex(points, cellMetres = 4) {
  const buckets = new Map();
  for (let i = 0; i < points.count; i++) {
    const key = `${Math.floor(points.easting[i] / cellMetres)},${Math.floor(points.northing[i] / cellMetres)}`;
    let list = buckets.get(key);
    if (!list) { list = []; buckets.set(key, list); }
    list.push(i);
  }
  return {
    near(easting, northing, radius, visit) {
      const r = Math.ceil(radius / cellMetres);
      const bx = Math.floor(easting / cellMetres), by = Math.floor(northing / cellMetres);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        for (const i of buckets.get(`${bx + dx},${by + dy}`) || []) {
          const d = Math.hypot(points.easting[i] - easting, points.northing[i] - northing);
          if (d <= radius) visit(i, d);
        }
      }
    },
  };
}

const ndvi = (r, nir) => (nir + r > 0 ? (nir - r) / (nir + r) : 0);

/**
 * Photo statistics in a disc: share of vegetated pixels (contrast > t), the
 * 75th percentile contrast, mean brightness, the share of dark (shadow /
 * dark conifer) pixels, and NIR texture (mean absolute difference to the
 * right and lower neighbour), each over the pixels of the disc.
 */
export function photoDisc(mosaic, easting, northing, radius, { vegetated = 0.12, dark = 45 } = {}) {
  const p = mosaic.pixelMetres;
  const c0 = Math.max(0, Math.floor((easting - radius - mosaic.minEasting) / p));
  const c1 = Math.min(mosaic.width - 2, Math.ceil((easting + radius - mosaic.minEasting) / p));
  const r0 = Math.max(0, Math.floor((mosaic.maxNorthing - northing - radius) / p));
  const r1 = Math.min(mosaic.height - 2, Math.ceil((mosaic.maxNorthing - northing + radius) / p));
  const values = [];
  let n = 0, veg = 0, darkCount = 0, bright = 0, texture = 0;
  const d = mosaic.data, w = mosaic.width;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const e = mosaic.minEasting + (c + 0.5) * p, nn = mosaic.maxNorthing - (r + 0.5) * p;
    if (Math.hypot(e - easting, nn - northing) > radius) continue;
    const o = (r * w + c) * 4;
    const v = ndvi(d[o], d[o + 3]);
    const b = (d[o] + d[o + 1] + d[o + 2]) / 3;
    values.push(v);
    n++;
    if (v > vegetated) veg++;
    if (b < dark) darkCount++;
    bright += b;
    texture += (Math.abs(d[o + 3] - d[o + 7]) + Math.abs(d[o + 3] - d[o + 3 + w * 4])) / 2;
  }
  if (!n) return null;
  values.sort((a, b) => a - b);
  return { pixels: n, vegetatedShare: veg / n, contrastP75: values[Math.floor(0.75 * (n - 1))], contrastP90: values[Math.floor(0.9 * (n - 1))], brightness: bright / n, darkShare: darkCount / n, nirTexture: texture / n };
}

/* The sun at each photo flight (azimuth from north, clockwise, and
   elevation) is per campaign in the ground's config (orthophotos.campaigns[].sun):
   a tree's shadow falls away from the sun, about height / tan(elevation) long. */

/** Median four-band brightness of open ground (CHM below 0.5 m) on a sample lattice: the photo's own scale for "dark".
    Near infrared is included because it falls furthest in shadow (to about 0.4 of sunlit grass). */
export function openGroundBrightness(mosaic, chm, step = 7) {
  const values = [];
  const p = mosaic.pixelMetres;
  for (let r = 0; r < mosaic.height; r += step) for (let c = 0; c < mosaic.width; c += step) {
    const e = mosaic.minEasting + (c + 0.5) * p, n = mosaic.maxNorthing - (r + 0.5) * p;
    const g = chm.grid;
    const cc = Math.floor((e - g.minEasting) / g.sampleSpacingMetres), rr = Math.floor((g.maxNorthing - n) / g.sampleSpacingMetres);
    if (cc < 0 || rr < 0 || cc >= g.width || rr >= g.height || !(chm.values[rr * g.width + cc] < 0.5)) continue;
    const o = (r * mosaic.width + c) * 4;
    values.push((mosaic.data[o] + mosaic.data[o + 1] + mosaic.data[o + 2] + mosaic.data[o + 3]) / 4);
  }
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/**
 * Share of dark pixels in the band where the crown's own shadow must fall:
 * from 0.35 to 0.9 of the shadow length away from the sun, as wide as the
 * crown. A tree standing at the flight casts it; a felled one does not. In a
 * closed stand every band is shaded, so the probe says nothing there.
 */
export function shadowProbe(mosaic, easting, northing, heightMetres, radiusMetres, sun, darkThreshold) {
  const length = heightMetres / Math.tan((sun.elevationDegrees * Math.PI) / 180);
  const away = ((sun.azimuthDegrees + 180) * Math.PI) / 180;
  const ux = Math.sin(away), uy = Math.cos(away);
  const half = Math.max(1, 0.7 * radiusMetres);
  const p = mosaic.pixelMetres;
  let n = 0, dark = 0;
  for (let t = 0.35 * length; t <= 0.9 * length; t += p) {
    for (let s = -half; s <= half; s += p) {
      const e = easting + ux * t - uy * s, nn = northing + uy * t + ux * s;
      const c = Math.floor((e - mosaic.minEasting) / p), r = Math.floor((mosaic.maxNorthing - nn) / p);
      if (c < 0 || r < 0 || c >= mosaic.width || r >= mosaic.height) continue;
      const o = (r * mosaic.width + c) * 4;
      n++;
      if ((mosaic.data[o] + mosaic.data[o + 1] + mosaic.data[o + 2] + mosaic.data[o + 3]) / 4 < darkThreshold) dark++;
    }
  }
  return n ? dark / n : null;
}

/** Share of canopy (CHM >= 3 m) in a square around a point: how closed the stand is. */
export function closedness(chm, easting, northing, halfMetres = 8) {
  let n = 0, c = 0;
  for (let dy = -halfMetres; dy <= halfMetres; dy += 1) for (let dx = -halfMetres; dx <= halfMetres; dx += 1) {
    const g = chm.grid;
    const cc = Math.floor((easting + dx - g.minEasting) / g.sampleSpacingMetres), rr = Math.floor((g.maxNorthing - northing - dy) / g.sampleSpacingMetres);
    if (cc < 0 || rr < 0 || cc >= g.width || rr >= g.height) continue;
    n++;
    if (chm.values[rr * g.width + cc] >= 3) c++;
  }
  return n ? c / n : null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** A photo campaign by its month and year, as the review texts name it: 'April 2021'. */
export function photoLabel(campaign) {
  const month = MONTHS[Number(campaign.date.slice(5, 7)) - 1];
  return `${month[0].toUpperCase()}${month.slice(1)} ${campaign.date.slice(0, 4)}`;
}

/** The per-crown evidence key of a photo campaign: 'april2021'. */
export function photoEvidenceKey(campaign) {
  return `${MONTHS[Number(campaign.date.slice(5, 7)) - 1]}${campaign.date.slice(0, 4)}`;
}

/** The per-crown shadow-probe key of a photo campaign: 'shadow2021' (with the
    month as well when the other photo is from the same year: 'shadowmay2023'). */
export function shadowEvidenceKey(campaign, other = null) {
  return other && other.date.slice(0, 4) === campaign.date.slice(0, 4) ? `shadow${photoEvidenceKey(campaign)}` : `shadow${campaign.date.slice(0, 4)}`;
}

/**
 * First returns of at least `minimumHag` bucketed into 1 m cells over a grid
 * (typed arrays, no per-point objects): apexReturns(easting, northing,
 * radius, minimumHeight) counts those within `radius` metres reaching
 * `minimumHeight`. The refined detector's point test of a treetop.
 */
export function firstReturnIndex(points, grid, { minimumHag = 1, cellMetres = 1 } = {}) {
  const width = Math.ceil((grid.width * grid.sampleSpacingMetres) / cellMetres), height = Math.ceil((grid.height * grid.sampleSpacingMetres) / cellMetres);
  const cellOf = i => {
    const c = Math.floor((points.easting[i] - grid.minEasting) / cellMetres), r = Math.floor((grid.maxNorthing - points.northing[i]) / cellMetres);
    return c < 0 || r < 0 || c >= width || r >= height ? -1 : r * width + c;
  };
  const counts = new Uint32Array(width * height + 1);
  for (let i = 0; i < points.count; i++) {
    if (points.returnNumber[i] !== 1 || !(points.hag[i] >= minimumHag)) continue;
    const k = cellOf(i); if (k >= 0) counts[k + 1]++;
  }
  for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
  const fill = counts.slice(0, -1);
  const order = new Uint32Array(counts[counts.length - 1]);
  for (let i = 0; i < points.count; i++) {
    if (points.returnNumber[i] !== 1 || !(points.hag[i] >= minimumHag)) continue;
    const k = cellOf(i); if (k >= 0) order[fill[k]++] = i;
  }
  return {
    apexReturns(easting, northing, radius, minimumHeight) {
      const c0 = Math.floor((easting - radius - grid.minEasting) / cellMetres), c1 = Math.floor((easting + radius - grid.minEasting) / cellMetres);
      const r0 = Math.floor((grid.maxNorthing - northing - radius) / cellMetres), r1 = Math.floor((grid.maxNorthing - northing + radius) / cellMetres);
      let n = 0;
      for (let r = Math.max(0, r0); r <= Math.min(height - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(width - 1, c1); c++) {
        const k = r * width + c;
        for (let j = counts[k]; j < counts[k + 1]; j++) {
          const i = order[j];
          if (points.hag[i] >= minimumHeight && Math.hypot(points.easting[i] - easting, points.northing[i] - northing) <= radius) n++;
        }
      }
      return n;
    },
  };
}
