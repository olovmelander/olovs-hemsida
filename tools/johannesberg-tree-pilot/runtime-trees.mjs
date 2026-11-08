#!/usr/bin/env node
/* What the player actually plants on a course: boots the built app and reads
   V3D.legacyTrees() -- species counts, zones and the v2 planner's stats
   (individuals, stand trees, woodland records thinned, records refused on
   played ground) -- at high and low quality, with the species split by who
   planted the tree (a registry individual or the stand field) and by zone
   (A within 90 m of a hole line, B within 300 m, else C).
   usage: node tools/serve.mjs apps/golf/dist 8662 &
          BANVY_GPU=1 node tools/johannesberg-tree-pilot/runtime-trees.mjs [--base http://127.0.0.1:8662] [--course johannesberg] [--quality hi,lo] [--out file.json] */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from '../browser-args.mjs';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const BASE = flag('base', 'http://127.0.0.1:8662').replace(/\/$/, '');
const courses = flag('course', 'johannesberg,johannesberg-9').split(',');
const qualities = flag('quality', 'hi,lo').split(',');
const out = [];
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  for (const slug of courses) for (const q of qualities) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    await page.goto(`${BASE}/?bana=${slug}&q=${q}&qualitylock=1&det=1&karta=0`, { waitUntil: 'domcontentloaded', timeout: 300000 });
    await page.waitForFunction(() => window.V3D?.legacyTrees && window.V3D.legacyTrees().total > 0, null, { timeout: 300000, polling: 1000 });
    const trees = await page.evaluate(() => {
      const t = window.V3D.legacyTrees({ instances: true });
      const names = Object.keys(t.species);
      const why = { 5: 'individual', 6: 'stand' };
      const split = {};
      for (const i of t.instances) {
        const key = `${why[i[6]] || 'legacy'}:${i[7]}`;
        const row = split[key] || (split[key] = Object.fromEntries(names.map(n => [n, 0])));
        row[names[i[5]]]++;
      }
      return { total: t.total, species: t.species, zones: t.zones, reasons: t.reasons, v2: t.v2, split };
    });
    out.push({ slug, quality: q, ...trees, errors });
    console.log(slug, q, JSON.stringify({ total: trees.total, species: trees.species, v2: trees.v2 && { individuals: trees.v2.individuals, standTrees: trees.v2.standTrees, woodlandThinned: trees.v2.woodlandThinned, excludedByGround: trees.v2.excludedByGround } }));
    for (const [key, row] of Object.entries(trees.split).sort()) console.log('  ', key.padEnd(14), JSON.stringify(row));
    await page.close();
  }
} finally { await browser.close(); }
if (flag('out', null)) fs.writeFileSync(flag('out', null), JSON.stringify(out, null, 1) + '\n');
