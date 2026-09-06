/* Optional georeferenced local imagery for every green tracer.
 * RASTER_MANIFEST=...json BUILD=upsalabuild node geobuild/imagery/green-tracers.mjs all
 * Manifest: {crs:'EPSG:3006',tiles:[{file,extent:[minE,minN,maxE,maxN]}],...provenance}
 * Extents are pixel EDGES. Pixel size is not absolute positional accuracy.
 * Without a manifest, the existing dated Wayback sampler is used.
 */
import fs from 'node:fs';
import path from 'node:path';
import { decodePNG } from '../png.mjs';
import { FRAME } from './lib.mjs';
import { rgbAt as waybackRgbAt } from './wayback.mjs';
import { latLonToSweref99Tm } from '../../packages/course-geo/chmv2/projection.mjs';

export function rasterSampler(manifest, directory, frame, decode = file => decodePNG(fs.readFileSync(file))) {
  if (manifest.crs !== 'EPSG:3006' || !manifest.tiles?.length) throw new Error('raster manifest requires EPSG:3006 tiles');
  for (const t of manifest.tiles) {
    if (!t.file || t.extent?.length !== 4 || !t.extent.every(Number.isFinite) || t.extent[2] <= t.extent[0] || t.extent[3] <= t.extent[1]) throw new Error('invalid raster tile extent');
  }
  const cache = new Map();
  return (x, z) => {
    const [e, n] = latLonToSweref99Tm(frame.lat - z / frame.mPerLat, frame.lon + x / frame.mPerLon);
    for (const t of manifest.tiles) {
      const [e0, n0, e1, n1] = t.extent;
      if (e < e0 || e >= e1 || n <= n0 || n > n1) continue;
      if (!cache.has(t.file)) cache.set(t.file, decode(path.resolve(directory, t.file)));
      const im = cache.get(t.file), channels = im.channels || im.data.length / (im.width * im.height);
      if (channels !== 3 && channels !== 4) throw new Error('source PNG must be RGB or RGBA');
      const col = Math.floor((e - e0) / (e1 - e0) * im.width), row = Math.floor((n1 - n) / (n1 - n0) * im.height);
      const i = (row * im.width + col) * channels;
      if (channels === 4 && im.data[i + 3] === 0) continue;
      return [im.data[i], im.data[i + 1], im.data[i + 2]];
    }
    return null;
  };
}
const file = process.env.RASTER_MANIFEST;
export const sourceDescription = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : { provider: 'Esri Wayback', release: process.env.SAT_REL || 'live mosaic' };
export const rgbAt = file ? rasterSampler(sourceDescription, path.dirname(path.resolve(file)), FRAME) : waybackRgbAt;
