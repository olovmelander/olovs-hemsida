/* How far tree-cover.json agrees with a crude leaf-on canopy read of the imagery, and
   WHERE it disagrees. The crude read (dark, textured, green) is the weaker of the two:
   it misses sunlit crowns and takes tree shadows on rough for canopy -- exactly the two
   lessons build-treecover.py learned -- so this measures the crude classifier as much as
   the raster. On Veckefjärden, release 27982: 72% agreement, 17.6% raster-trees/image-open
   (sunlit crowns inside dense forest), 10.2% image-canopy/raster-open (shadows on rough).
   Use it to LOOK: the PNG paints the two disagreement classes over the imagery.

   Usage: SAT_REL=27982 node geobuild/imagery/treecover-vs-imagery.mjs [out.png] [step=6]   */
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from '../png.mjs';
import { rgbAt, courseBox } from './wayback.mjs';
import { ROOT, BUILD, model, inRing } from './lib.mjs';

const tc = JSON.parse(fs.readFileSync(path.join(ROOT, BUILD, 'tree-cover.json'), 'utf8')); const raw = Buffer.from(tc.b64, 'base64');
const at = (x, z) => { const i = Math.floor((x - tc.x0) / tc.cell), j = Math.floor((z - tc.z0) / tc.cell); if (i < 0 || j < 0 || i >= tc.nx || j >= tc.nz) return 0; const k = j * tc.nx + i; return (raw[k >> 2] >> ((k & 3) * 2)) & 3; };
const m = model(); const wet = (x, z) => (m.water || []).some(w => inRing(x, z, w.ring));
function canopy(x, z) { const v = []; for (let dz = -1; dz <= 1; dz += 0.5) for (let dx = -1; dx <= 1; dx += 0.5) { const c = rgbAt(x + dx, z + dz); if (c) v.push(c); } if (v.length < 10) return null; const mu = v.reduce((a, c) => a + c[0] + c[1] + c[2], 0) / v.length; const g = v.map(c => c[1]), gm = g.reduce((a, b) => a + b, 0) / g.length; const sd = Math.sqrt(g.reduce((a, b) => a + (b - gm) ** 2, 0) / g.length); const rm = v.reduce((a, c) => a + c[0], 0) / v.length; return gm > rm + 6 && ((mu < 300 && sd > 12) || mu < 190); }
const out = process.argv[2], step = +(process.argv[3] || 6); const [X0, Z0, X1, Z1] = courseBox(); const cm = { tt: 0, to: 0, ot: 0, oo: 0 }; const TO = [], OT = []; let n = 0;
for (let z = Z0; z <= Z1; z += step) for (let x = X0; x <= X1; x += step) { const r = at(x, z); if (r !== 2 && r !== 3) continue; if (wet(x, z)) continue; const c = canopy(x, z); if (c === null) continue; n++; cm[(r === 3 ? 't' : 'o') + (c ? 't' : 'o')]++; if (r === 3 && !c) TO.push([x, z]); if (r !== 3 && c) OT.push([x, z]); }
console.log(`samples ${n}  agreement ${((cm.tt + cm.oo) / n * 100).toFixed(1)}%  raster trees where image open ${(cm.to / n * 100).toFixed(1)}%  image canopy where raster open ${(cm.ot / n * 100).toFixed(1)}%`);
if (out) { const ppm = 0.6, W = Math.round((X1 - X0) * ppm), H = Math.round((Z1 - Z0) * ppm); const rgb = new Uint8Array(W * H * 3); for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) { const v = rgbAt(X0 + px / ppm, Z0 + py / ppm) || [0, 0, 0]; const g = Math.round((v[0] + v[1] + v[2]) / 3 * 0.8); const i = (py * W + px) * 3; rgb[i] = rgb[i + 1] = rgb[i + 2] = g; } const dot = (x, z, col) => { const px = Math.round((x - X0) * ppm), py = Math.round((z - Z0) * ppm); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = px + dx, Y = py + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const i = (Y * W + X) * 3; rgb[i] = col[0]; rgb[i + 1] = col[1]; rgb[i + 2] = col[2]; } }; for (const [x, z] of TO) dot(x, z, [255, 60, 60]); for (const [x, z] of OT) dot(x, z, [60, 220, 255]); fs.writeFileSync(out, encodePNG(W, H, rgb)); console.log('wrote', out, '(red: raster trees / image open; cyan: image canopy / raster open)'); }
