#!/usr/bin/env node
/* Publish the grass-card strip rendered by grass_cards.py: a hash-named PNG in
   apps/golf/public/models/props/, its JSON record (with the mean blade colour,
   linear, that the shader sets the cards on the ground's colour by), and the
   GRASS_CARDS_ASSET constant in apps/golf/src/engine/grass-cards.mjs.
   usage: node tools/blender-props/publish-grass-cards.mjs <rendered.png> */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { decodePNG } from '../../geobuild/png.mjs';
const src = process.argv[2];
const bytes = fs.readFileSync(src), sha = createHash('sha256').update(bytes).digest('hex');
const dir = 'apps/golf/public/models/props', url = `models/props/grass-cards-${sha}.png`;
const old = fs.existsSync(`${dir}/grass-cards.json`) ? JSON.parse(fs.readFileSync(`${dir}/grass-cards.json`, 'utf8')) : null;
if (old && old.asset.sha256 !== sha && fs.existsSync(`apps/golf/public/${old.asset.url}`)) fs.rmSync(`apps/golf/public/${old.asset.url}`);
fs.writeFileSync(`apps/golf/public/${url}`, bytes);
const img = decodePNG(bytes);
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const s = [0, 0, 0]; let n = 0;
for (let i = 0; i < img.width * img.height; i++) if (img.data[i * 4 + 3] > 127) { for (let c = 0; c < 3; c++) s[c] += lin(img.data[i * 4 + c]); n++; }
const mean = s.map(v => +(v / n).toFixed(5));
const record = { schemaVersion: 1, kind: 'banvy-texture', id: 'grass-cards',
  asset: { url, sha256: sha, bytes: bytes.length },
  layout: { width: img.width, height: img.height, tiles: 4, tileMetres: [1.0, 0.5] },
  meanLinear: mean, coverage: +(n / (img.width * img.height)).toFixed(4),
  tiles: ['rough: dense, 20-35 cm', 'fescue: wispy, 30-48 cm, some straw', 'short and dense, 10-24 cm', 'mixed green and dry, 16-38 cm'],
  source: 'tools/blender-props/grass_cards.py, Blender 5.2.2 LTS, Eevee, rendered through the Blender MCP on 3 November 2026 (scene BanvyGrassCards)',
  notes: "Curved, tapered blades painted by vertex colour and rendered through emission: the texture is the grass's own colour; the game lights it and sets it on the ground's colour by meanLinear." };
fs.writeFileSync(`${dir}/grass-cards.json`, JSON.stringify(record, null, 2) + '\n');
const mod = 'apps/golf/src/engine/grass-cards.mjs';
let m = fs.readFileSync(mod, 'utf8');
m = m.replace(/grass-cards-[0-9a-f]{64}\.png/, `grass-cards-${sha}.png`).replace(/sha256: '[0-9a-f]{64}'/, `sha256: '${sha}'`)
  .replace(/(GRASS_CARDS_ASSET = Object\.freeze\(\{[\s\S]*?bytes: )\d+/, `$1${bytes.length}`)
  .replace(/meanLinear: Object\.freeze\(\[[^\]]*\]\)/, `meanLinear: Object.freeze([${mean.join(', ')}])`);
fs.writeFileSync(mod, m);
console.log(JSON.stringify({ sha: sha.slice(0, 12), bytes: bytes.length, mean, coverage: record.coverage }));
