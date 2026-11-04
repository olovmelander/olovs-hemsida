#!/usr/bin/env node
/* Bakes the map mode's tree atlases from the simulator's own trees.
 *
 * The player renders each species from the 64 vertices of a hemi-octahedron into
 * an albedo and a normal atlas at boot (engine/tree-impostor.mjs). The map cannot
 * do that: it has no three.js and no tree meshes. So this runs the real player on
 * the owner's GPU, reads those atlases out, finishes them the way its impostor
 * material does, and publishes them as content-addressed images. The trees on the
 * map are then the simulator's trees, to the pixel of their atlas.
 *
 *   pnpm --filter @banvy/golf dev --port 8631     (or any dev server)
 *   BANVY_GPU=1 node tools/bake-map-trees.mjs [--url http://localhost:8631/]
 *
 * Rerun it after any change to a tree catalogue. It writes
 * apps/golf/public/models/map-trees/ and map-trees.json, replacing the set.
 *
 * The frames are baked larger than the player's: its 128 px are for trees far away,
 * and a map zooms in on them. The size is changed by serving the harness a patched
 * tree-impostor.mjs, not by editing the engine, which would expire the prepared
 * startup data of every course. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable, GPU } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const BASE = flag('url', 'http://localhost:8631/');
const FRAME = Number(flag('frame', 192));
/* The catalogue order the player builds its SPECIES table in. */
const CATALOGUE_FILES = { realistic: 'realistic-v2.json', visby: 'realistic-visby.json' };
const SPECIES_KEYS = ['gran', 'tall', 'björk', 'al', 'ek'];
const OUT = path.resolve('apps/golf/public/models/map-trees');
if (!GPU) throw new Error('bake on the real GPU: BANVY_GPU=1');

/* One course per catalogue. Angsö draws the five realistic species' first three
   and Veckefjärden the extended set; Visby has its own coastal pine. */
const CATALOGUES = [
  { key: 'realistic', course: 'veckefjarden', grounds: null },
  { key: 'visby', course: 'visby', grounds: ['visby'] },
];

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });

async function bake({ key, course }) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  page.setDefaultTimeout(240000);
  await page.route('**/src/engine/tree-impostor.mjs*', async route => {
    const response = await route.fetch();
    const text = await response.text();
    if (!text.includes('REALISTIC_IMPOSTOR_FRAME = 128')) throw new Error('the impostor frame constant moved');
    await route.fulfill({ response, body: text.replace('REALISTIC_IMPOSTOR_FRAME = 128', `REALISTIC_IMPOSTOR_FRAME = ${FRAME}`) });
  });
  await page.goto(`${BASE}?bana=${course}&gl=1&q=hi&det=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.V3D?.treeTemplates && globalThis.V3D.treeAtlas, null, { polling: 500 });
  await page.waitForFunction(async () => Boolean(await globalThis.V3D.treeAtlas(0, 'albedo', 0, 0)), null, { polling: 1000 });

  /* All the composing happens in the page: 64 frames of 192 px is too much to
     cross into Node as numbers, and the browser has the WebP encoder. */
  const baked = await page.evaluate(async frameQuality => {
    const templates = V3D.treeTemplates();
    const out = [];
    const toByte = value => Math.max(0, Math.min(255, Math.round(value * 255)));
    const srgb = value => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);
    const encode = (canvas, quality) => new Promise(done => canvas.toBlob(blob => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    }, 'image/webp', quality));
    for (let s = 0; s < templates.length; s++) {
      const first = await V3D.treeAtlas(s, 'albedo', 0, 0);
      const { frameSize, framesPerSide, size, radius, centreY, height } = first;
      const colour = new ImageData(size, size), normal = new ImageData(size, size);
      const hex = templates[s].cc;
      const crownBase = [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255].map(c => c ** 2.2);
      for (let j = 0; j < framesPerSide; j++) for (let i = 0; i < framesPerSide; i++) {
        const albedo = (await V3D.treeAtlas(s, 'albedo', i, j)).data;
        const normals = (await V3D.treeAtlas(s, 'normal', i, j)).data;
        for (let y = 0; y < frameSize; y++) for (let x = 0; x < frameSize; x++) {
          const k = (y * frameSize + x) * 4;
          const target = ((j * frameSize + y) * size + i * frameSize + x) * 4;
          const coverage = albedo[k + 3];
          if (!(coverage > 0.02)) continue;
          /* The crown keeps its colour's tint here, as the impostor material
             applies it at draw time: the map has one season. */
          const crown = Math.min(normals[k + 3] / coverage, 1);
          for (let c = 0; c < 3; c++) {
            const value = albedo[k + c] / coverage;
            colour.data[target + c] = toByte(srgb(value * (1 - crown + crown * crownBase[c])));
          }
          colour.data[target + 3] = toByte(coverage);
          for (let c = 0; c < 3; c++) normal.data[target + c] = toByte(normals[k + c] / coverage);
          normal.data[target + 3] = toByte(crown);
        }
      }
      const draw = image => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = image.width;
        canvas.getContext('2d').putImageData(image, 0, 0);
        return canvas;
      };
      const half = source => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = source.width >> 1;
        const c = canvas.getContext('2d');
        c.imageSmoothingQuality = 'high';
        /* Up-facing behind the normals, so a filtered edge never leans black. */
        c.fillStyle = 'rgb(128,255,128)';
        c.fillRect(0, 0, canvas.width, canvas.height);
        c.drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas;
      };
      out.push({
        species: s,
        frameSize, framesPerSide, size, radius, centreY, height,
        templateHeight: templates[s].height,
        colour: await encode(draw(colour), frameQuality),
        normal: await encode(half(draw(normal)), 0.82),
      });
    }
    return out;
  }, 0.9);
  await page.context().close();

  const row = [];
  for (const species of baked) {
    const write = (base64, suffix) => {
      const bytes = Buffer.from(base64, 'base64');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      fs.writeFileSync(path.join(OUT, `${sha256}.webp`), bytes);
      console.log(`  ${key} species ${species.species} ${suffix}: ${(bytes.length / 1024).toFixed(0)} KB`);
      return { file: `models/map-trees/${sha256}.webp`, bytes: bytes.length, sha256 };
    };
    const { colour, normal, ...shape } = species;
    const source = JSON.parse(fs.readFileSync(path.resolve('apps/golf/public/models/trees', CATALOGUE_FILES[key]), 'utf8'));
    const template = source.species.find(entry => entry.key === SPECIES_KEYS[species.species]).variants[0];
    row.push({ ...shape, templateRadius: template.templateRadius, colour: write(colour, 'colour'), normal: write(normal, 'normal') });
  }
  return { key, species: row };
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const catalogues = {};
for (const catalogue of CATALOGUES) {
  console.log(`baking ${catalogue.key} from ${catalogue.course}`);
  catalogues[catalogue.key] = { grounds: catalogue.grounds, species: (await bake(catalogue)).species };
}
fs.writeFileSync(path.resolve('apps/golf/public/models/map-trees.json'), `${JSON.stringify({ schemaVersion: 1, catalogues }, null, 1)}\n`);
await browser.close();
