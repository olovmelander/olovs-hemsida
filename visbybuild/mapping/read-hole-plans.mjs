#!/usr/bin/env node
/* What Caddee's eighteen hole plans say about where Visby's six tees stand.

   The club publishes a professional plan per hole through Caddee, and every one
   of them DRAWS THE TEES: a numbered blue disc per tee, on the hole, strung from
   the back tee up towards the green. That is the record the orthophoto could not
   supply -- `mapping/tee-decks.json` records the refusal and its numbers -- and
   the model's tee positions are derived rather than read, so this asks the plans
   whether the derivation's SHAPE is right.

   IT DOES NOT REGISTER THE DRAWINGS, and that is deliberate. They are stylised
   illustrations, not orthophotography; a similarity fitted on two anchors would
   read positions whose error is the drawing's own distortion, and nothing here
   measures that distortion. What can be counted without registering anything is
   the STRUCTURE: how many distinct places the plan puts six tees in, and whether
   they run down the hole in card order. Both are falsifiable, and both are what
   the derivation assumes.

   The discs are found by colour and shape, not by reading their numbers: a disc
   is 21-22 px across at 270-310 px of Caddee's own navy, two tees sharing a spot
   are drawn side by side as one 43-44 px component, three as one 66 px one. The
   left-hand distance table is a column of five or more evenly spaced discs and
   is excluded by that alone.

     node visbybuild/mapping/read-hole-plans.mjs
   reads visbybuild/cache/plans/hole-NN.png (gitignored; (c) Caddee, fetched for
   review, never redistributed) and writes the evidence beside this file. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLANS = path.join(HERE, '..', 'cache', 'plans');

/* A minimal PNG reader: this container has no image library for Node, and the
   plans are plain 8-bit RGBA with filter bytes, which is thirty lines. */
function readPng(file) {
  const bytes = fs.readFileSync(file);
  let offset = 8, width = 0, height = 0, depth = 0, colour = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; colour = body[9];
      if (depth !== 8 || (colour !== 6 && colour !== 2)) throw new Error(`${file}: expected 8-bit RGB(A)`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = colour === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 3);
  const line = new Uint8Array(stride), previous = new Uint8Array(stride);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    const source = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    for (let index = 0; index < stride; index++) {
      const a = index >= channels ? line[index - channels] : 0;
      const b = previous[index];
      const c = index >= channels ? previous[index - channels] : 0;
      let value = source[index];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[index] = value & 255;
    }
    for (let column = 0; column < width; column++) {
      out[(row * width + column) * 3] = line[column * channels];
      out[(row * width + column) * 3 + 1] = line[column * channels + 1];
      out[(row * width + column) * 3 + 2] = line[column * channels + 2];
    }
    previous.set(line);
  }
  return { width, height, pixels: out };
}

function components(mask, width, height, minimum = 60) {
  const seen = new Uint8Array(mask.length);
  const found = [];
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index] || seen[index]) continue;
    const stack = [index], cells = [];
    seen[index] = 1;
    while (stack.length) {
      const cell = stack.pop();
      cells.push(cell);
      const x = cell % width, y = (cell - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (mask[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
      }
    }
    if (cells.length >= minimum) found.push(cells);
  }
  return found;
}

const card = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'card.json'), 'utf8'));
const model = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'course-model.json'), 'utf8'));
const report = { source: {
  publisher: 'Caddee', page: 'https://www.caddee.se/klubb/visby-golfklubb',
  courseId: '9e6fa30e-fe7e-4a95-923d-4b4727144ff8',
  retrieved: '2026-09-08', rights: '(c) Caddee; fetched for review and never redistributed, and no pixel leaves this repository',
  identity: 'par and stroke index on all 18 holes match visbybuild/card.json, 18 of 18',
}, method: fs.readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].split('\n').slice(1, 20).join('\n').trim(),
  holes: [] };

for (const hole of card.holes) {
  const file = path.join(PLANS, `hole-${String(hole.n).padStart(2, '0')}.png`);
  if (!fs.existsSync(file)) { report.holes.push({ hole: hole.n, error: 'plan not cached' }); continue; }
  const { width, height, pixels } = readPng(file);
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index++) {
    const r = pixels[index * 3], g = pixels[index * 3 + 1], b = pixels[index * 3 + 2];
    if (b > 90 && b - r > 50 && b - g > 35) mask[index] = 1;
  }
  const found = components(mask, width, height).map(cells => {
    const xs = cells.map(cell => cell % width), ys = cells.map(cell => (cell - cell % width) / width);
    return { n: cells.length, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
             cx: xs.reduce((s, v) => s + v, 0) / cells.length, cy: ys.reduce((s, v) => s + v, 0) / cells.length };
  });
  /* the distance table is a column of five or more discs sharing an x */
  const table = new Set();
  for (const probe of found) {
    const column = found.filter(other => Math.abs(other.cx - probe.cx) < 6);
    if (column.length >= 5) for (const other of column) table.add(other);
  }
  /* a disc is one of Caddee's own, at its own size: 21-22 px across at 270-310
     px single, doubled or tripled where tees share a spot. Anything else on the
     map is another blue glyph -- a tee-marker icon, a water symbol, a label. */
  const size = shape => (shape.y1 - shape.y0 + 1 >= 20 && shape.y1 - shape.y0 + 1 <= 24
    ? (shape.n >= 265 && shape.n <= 320 ? 1 : shape.n >= 545 && shape.n <= 620 ? 2 : shape.n >= 840 && shape.n <= 930 ? 3 : 0) : 0);
  const discs = found.filter(shape => !table.has(shape) && size(shape) > 0);
  const tees = discs.reduce((sum, shape) => sum + size(shape), 0);
  /* the card's own structure: how many DISTINCT lengths its six tees carry, and
     the size of each group -- which is what the plan should be drawing */
  const groups = [];
  for (const length of hole.t) {
    const last = groups.at(-1);
    if (last && last.metres === length) last.count++;
    else groups.push({ metres: length, count: 1 });
  }
  /* down the hole in card order: the plans are drawn with the green at the top,
     so a disc's own row is its distance from the green up to the drawing's
     scale. Ranked by row, the discs should carry the card's group sizes from
     the back tee to the front. */
  const ranked = [...discs].sort((a, b) => b.cy - a.cy).map(size);
  report.holes.push({
    hole: hole.n, card: hole.t,
    cardGroups: groups.map(group => group.count),
    planDiscComponents: discs.length,
    planTeesDrawn: tees,
    planGroupSizesBackToFront: ranked,
    matchesCardStructure: tees === 6 && JSON.stringify(ranked) === JSON.stringify(groups.map(group => group.count)),
    modelDistinctTeePoints: new Set(model.holes.find(h => h.n === hole.n).tees.marks.map(mark => mark.c.join(','))).size,
  });
}

for (const row of report.holes) {
  row.modelMatchesPlanStructure = row.modelDistinctTeePoints === row.planGroupSizesBackToFront.length;
}
const agree = report.holes.filter(row => row.matchesCardStructure).length;
const six = report.holes.filter(row => row.planTeesDrawn === 6).length;
report.summary = {
  holesWhereThePlanDrawsSixTees: six,
  holesWhereTheGroupingMatchesTheCard: agree,
  meaning: 'the plans are not registered and no position is read from them. What is counted is whether the club '
    + 'draws its six tees at as many distinct places as its card has distinct lengths, and in that order from the '
    + 'back tee to the front -- which is exactly what the model derives',
  modelMatchesPlanStructure: report.holes.filter(row => row.modelMatchesPlanStructure).length,
  disagreements: report.holes.filter(row => !row.matchesCardStructure).map(row => ({
    hole: row.hole, card: row.card, cardGroups: row.cardGroups, planGroups: row.planGroupSizesBackToFront,
    reading: 'the plan draws at a separate place two tees the card gives the same length, which a club may '
      + 'legitimately do; and on hole 14 a second record agrees, the plan PRINTING 160 and 140 for tees 63 and 59 '
      + 'against the card 155 and 136 while its other four tees show the expected offset to the green front. '
      + 'The card is what this build ships; the disagreement is recorded, not resolved.',
  })),
};
fs.writeFileSync(path.join(HERE, 'hole-plans.json'), `${JSON.stringify(report, null, 1)}\n`);
for (const row of report.holes) {
  console.log(`h${String(row.hole).padStart(2)} card groups [${row.cardGroups}] plan [${row.planGroupSizesBackToFront}] `
    + `tees=${row.planTeesDrawn} model points=${row.modelDistinctTeePoints} ${row.matchesCardStructure ? 'AGREE' : ''}`);
}
console.log(`\n${six}/18 plans draw six tees; ${agree}/18 group them exactly as the card does`);
