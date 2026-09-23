/* The 2026-05-02 national orthophoto as decoded pixels, through the same
   credential-free Min karta WMS ortho-crop.mjs uses, but as PNG so plain Node
   decodes it (lib/png.mjs) without a browser round-trip. Pieces cache under
   tortunabuild/cache/ortho/lm-0.16-png/ and are never redistributed: the
   imagery is a review and measurement source, not a runtime texture.
   WMS 1.1.1 with SRS=EPSG:3006 takes the bbox easting first; the service caps
   a request at 4096 px, so a window is mosaicked from pieces. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from './png.mjs';
import { TORTUNA_FRAME } from '../frame.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.resolve(HERE, '../cache/ortho/lm-0.16-png');

async function piece(minE, minN, columns, rows, metres) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${metres}_${minE.toFixed(2)}_${minN.toFixed(2)}_${columns}x${rows}.png`);
  if (!fs.existsSync(file)) {
    const url = `https://minkarta.lantmateriet.se/map/ortofoto?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=Ortofoto_0.16&STYLES=&SRS=EPSG:3006&BBOX=${minE},${minN},${minE + columns * metres},${minN + rows * metres}&WIDTH=${columns}&HEIGHT=${rows}&FORMAT=image/png`;
    let bytes = null;
    for (let attempt = 1; attempt <= 4 && !bytes; attempt++) {
      try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (response.ok) { const b = Buffer.from(await response.arrayBuffer()); if (b.length > 2048) bytes = b; }
      } catch { /* retried below */ }
      if (!bytes) await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
    }
    if (!bytes) throw new Error(`orthophoto piece ${columns}x${rows} at E${minE} N${minN} could not be fetched`);
    fs.writeFileSync(file, bytes);
  }
  return decodePng(fs.readFileSync(file));
}

/** RGB raster over a local-metre window [x0, z0, x1, z1] at `metres` per pixel, with local <-> pixel mappers. */
export async function orthoWindow([x0, z0, x1, z1], metres = 0.32) {
  const minE = TORTUNA_FRAME.easting + x0, maxN = TORTUNA_FRAME.northing - z0;
  const width = Math.round((x1 - x0) / metres), height = Math.round((z1 - z0) / metres);
  const data = new Uint8Array(width * height * 3);
  const MAX = 2000;
  for (let r0 = 0; r0 < height; r0 += MAX) for (let c0 = 0; c0 < width; c0 += MAX) {
    const columns = Math.min(MAX, width - c0), rows = Math.min(MAX, height - r0);
    const image = await piece(+(minE + c0 * metres).toFixed(2), +(maxN - (r0 + rows) * metres).toFixed(2), columns, rows, metres);
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const s = (y * columns + x) * image.channels, d = ((r0 + y) * width + c0 + x) * 3;
      data[d] = image.data[s]; data[d + 1] = image.data[s + 1]; data[d + 2] = image.data[s + 2];
    }
  }
  return {
    width, height, metres, data,
    toPixel: ([x, z]) => [(x - x0) / metres, (z - z0) / metres],
    toLocal: (col, row) => [x0 + (col + 0.5) * metres, z0 + (row + 0.5) * metres],
  };
}
