#!/usr/bin/env node
/* Tjusta's hole notes, written from what was measured and what the club states.

   node tjustabuild/make-guide-notes.mjs       writes tjustabuild/guide-notes.json

   Each note is built from facts, never from a hole description (the club publishes none):
   - par and lengths from the card (Golf i Sverige's and Caddee's, identical);
   - the rise or fall from the yellow tee to the green, read on the 1 m laser terrain;
   - the bunkers by the green and in the fairway, from the traced sand;
   - water within 25 m of the hole's line, from the measured water;
   - out of bounds from the club's local rules (2023, valid from 2025).
   Only the short names are editorial. Run it after the trace and the layers. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const card = read('tjustabuild/reference/club-scorecard.json');
const routes = read('tjustabuild/mapping/routes.geojson').features;
const surfaces = read('tjustabuild/mapping/playing-surfaces.geojson').features;
const water = fs.existsSync(path.join(ROOT, 'tjustabuild/mapping/water.geojson')) ? read('tjustabuild/mapping/water.geojson').features : [];
const trace = read('tjustabuild/mapping/trace-config.json');
const t = trace.terrain;
const heights = new Float32Array(fs.readFileSync(path.join(ROOT, t.path)).buffer.slice(0));
const heightAt = ([e, n]) => heights[Math.round(t.firstNorthing - n) * t.side + Math.round(e - t.firstEasting)];

const NAMES = {
  1: 'Längs Kimstavägen', 2: 'Över vägen norrut', 3: 'Gläntan', 4: 'Över dungen', 5: 'Långa rakan', 6: 'Vid gårdsvägen',
  7: 'Ängen', 8: 'Över fältet', 9: 'Västra gången', 10: 'Runt dammen', 11: 'Utmed diket', 12: 'Över dammkanten',
  13: 'Uppför längs diket', 14: 'Tillbaka över fältet', 15: 'Ut ur fältet', 16: 'Mittgången', 17: 'Rundgreenen', 18: 'Hem runt gårdsdammen',
};
// Out of bounds by the local rules (lokala regler 2023, gäller tillsvidare från 2025): rule 1b-1f.
const OB = {
  1: 'Out of bounds till vänster längs vägen.',
  6: 'Out of bounds till vänster om gårdsvägen.',
  7: 'Out of bounds till vänster längs vägen.',
  11: 'Out of bounds till höger, utanför åkern.',
  13: 'Out of bounds till höger om diket och åkern.',
};

const centroid = ring => ring.reduce((s, p) => [s[0] + p[0] / ring.length, s[1] + p[1] / ring.length], [0, 0]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return dist(p, [a[0] + u * dx, a[1] + u * dy]);
};
const lineDist = (p, line) => Math.min(...line.slice(1).map((b, i) => segDist(p, line[i], b)));
const number = n => ['ingen', 'en', 'två', 'tre', 'fyra', 'fem'][n] ?? String(n);

const holes = card.holes.map(hole => {
  const route = routes.find(f => f.properties.hole === hole.number).geometry.coordinates;
  const green = surfaces.find(f => f.properties.kind === 'green' && f.properties.hole === hole.number);
  const greenAt = centroid(green.geometry.coordinates[0]);
  const rise = heightAt(greenAt) - heightAt(route[0]);
  const bunkers = surfaces.filter(f => f.properties.kind === 'bunker' && f.properties.hole === hole.number)
    .map(f => centroid(f.geometry.coordinates[0]));
  // On a par 3 every bunker guards the green: there is no fairway for one to lie in.
  const greenside = hole.par === 3 ? bunkers.length : bunkers.filter(b => dist(b, greenAt) < 35).length;
  const fairway = bunkers.length - greenside;
  const wet = water.some(f => (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : [])
    .some(p => lineDist(p, route) < 25));
  const parts = [`Par ${hole.par}, ${hole.lengths.gul} m från gul och ${hole.lengths.rod} m från röd.`];
  if (Math.abs(rise) >= 2) parts.push(`Spelas ${Math.round(Math.abs(rise))} m ${rise < 0 ? 'nedför' : 'uppför'}.`);
  if (greenside) parts.push(`${number(greenside).replace(/^./, c => c.toUpperCase())} bunk${greenside > 1 ? 'rar' : 'er'} vid greenen.`);
  if (fairway) parts.push(`${number(fairway).replace(/^./, c => c.toUpperCase())} fairwaybunk${fairway > 1 ? 'rar' : 'er'}.`);
  if (wet) parts.push('Vatten nära spellinjen.');
  if (OB[hole.number]) parts.push(OB[hole.number]);
  if (hole.number === 9) parts.push('Kaffepaus efter nian.');
  return {
    n: hole.number,
    name: NAMES[hole.number],
    note: parts.join(' '),
    basis: 'Golf i Sverige/Caddee-scorekort + Lantmäteriet 1 m DTM + 2025 0.16 m RGBI' + (OB[hole.number] || hole.number === 9 ? ' + Lokala regler 2023' : ''),
  };
});
const out = {
  schemaVersion: 1,
  groundId: 'tjusta',
  slug: 'tjusta',
  editorialNote: 'Hole names (`name`) are short Banvy editorial titles. Each note is built by tjustabuild/make-guide-notes.mjs from the card, the 1 m laser terrain (rise or fall from the yellow tee to the green), the traced bunkers and water, and the club\'s local rules; the club publishes no hole descriptions.',
  holes,
};
fs.writeFileSync(path.join(ROOT, 'tjustabuild/guide-notes.json'), `${JSON.stringify(out, null, 2)}\n`);
for (const h of holes) console.log(`${String(h.n).padStart(2)} ${h.name}: ${h.note}`);
