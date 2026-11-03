/* The modelled bark's atlases (bark_atlas.py's renders) for the realistic catalogue: per species
   <out>/bark-<key>.png -- the near-neutral colour, opaque -- and <out>/bark-<key>-normal.png -- the
   normal in R and G, the relief's height in B -- and <out>/bark.json with their bytes, hashes, the
   colour's mean and the metres a repeat covers (realistic_trees.py BARK_TILE).

   node tools/blender-tree-study/realistic/pack_bark.mjs <renders> <out>                        */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decodePNG } from '../../../geobuild/png.mjs';
import { encodeRGBA } from './make_leaf_atlas.mjs';

const [renders, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const record = { tileMetres: 0.6, species: {} };
for (const key of ['björk', 'ek', 'al', 'tall', 'gran']) {
  const c = decodePNG(fs.readFileSync(path.join(renders, `bark-${key}-colour.png`)));
  const n = decodePNG(fs.readFileSync(path.join(renders, `bark-${key}-normal.png`)));
  const W = c.width, H = c.height, colour = new Uint8Array(W * H * 4), normal = new Uint8Array(W * H * 4);
  const mean = [0, 0, 0];
  for (let i = 0; i < W * H; i++) {
    for (let k = 0; k < 3; k++) { colour[i * 4 + k] = c.data[i * c.channels + k]; normal[i * 4 + k] = n.data[i * n.channels + k]; mean[k] += lin(c.data[i * c.channels + k]); }
    colour[i * 4 + 3] = 255; normal[i * 4 + 3] = 255;
  }
  const cb = encodeRGBA(W, H, colour), nb = encodeRGBA(W, H, normal);
  fs.writeFileSync(path.join(out, `bark-${key}.png`), cb);
  fs.writeFileSync(path.join(out, `bark-${key}-normal.png`), nb);
  record.species[key] = { colour: { bytes: cb.length, sha256: sha(cb) }, normal: { bytes: nb.length, sha256: sha(nb) },
    mean: mean.map(v => +(v / (W * H)).toFixed(4)) };
  console.log(key, record.species[key].mean, `${(cb.length / 1024).toFixed(0)} + ${(nb.length / 1024).toFixed(0)} kB`);
}
fs.writeFileSync(path.join(out, 'bark.json'), JSON.stringify(record, null, 2));
