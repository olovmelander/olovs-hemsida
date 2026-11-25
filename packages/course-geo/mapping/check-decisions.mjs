#!/usr/bin/env node
/* Check a ground's decision files before the tracer reads them.

   node packages/course-geo/mapping/check-decisions.mjs --config <build>/mapping/trace-config.json

   The tracer takes two minutes and stops at the first decision it cannot use. This reads the same files in a
   second and lists everything at once: a hole without a deck for one of the card's tees, a tee named twice, an OSM
   way that is not in the extract, a ring outside the ground's box, a sand decision for another course. It needs
   no photo and no Python, so it also runs in CI, where a decision edited by hand is otherwise first read by the
   next person to trace. It checks that the decisions can be used; whether they are right is the ring review's. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PAD_SOURCES = { osm: ['id'], ellipse: ['c', 'size', 'rot'], platform: ['at'], ring: ['ring'] };
const SAND_KINDS = ['bunker', 'waste_sand'];

const pair = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const area = ring => Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

/** Everything in one ground's decision files that the tracer could not use. `files` maps a path to its parsed JSON. */
export function decisionErrors(config, files) {
  const errors = [], box = config.box;
  const say = (where, what) => errors.push(`${where}: ${what}`);
  const inBox = p => pair(p) && p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];
  const ring = (where, value, least = 3, inside = true) => {
    if (!Array.isArray(value) || value.length < least || !value.every(pair)) return say(where, `needs at least ${least} [easting, northing] points`);
    if (inside && !value.every(inBox)) say(where, 'leaves the ground\'s box (are the coordinates EPSG:3006, easting first?)');
    else if (least >= 3 && area(value) < 4) say(where, `encloses ${area(value).toFixed(1)} m2`);
  };
  if (!Array.isArray(box) || box.length !== 4 || !(box[0] < box[2] && box[1] < box[3])) return ['trace-config: box must be [minE, minN, maxE, maxN]'];
  const osm = new Map((files[config.osm]?.features ?? []).map(f => [String(f.id), f]));
  if (!osm.size) say(config.osm, 'the OSM extract is missing or empty');
  const slugs = config.courses.map(c => c.slug);

  for (const course of config.courses) {
    const decisions = files[course.decisions], card = files[course.card], at = course.decisions;
    if (!decisions || !card) { say(course.slug, `cannot read ${!decisions ? course.decisions : course.card}`); continue; }
    if (decisions.schemaVersion !== 1 || decisions.groundId !== config.groundId || decisions.slug !== course.slug) say(at, 'belongs to another ground or routing');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(decisions.reviewedOn ?? '') || !decisions.reviewer) say(at, 'needs reviewedOn and reviewer');
    const tees = card.tees.map(t => t.id), numbers = card.holes.map(h => h.number);
    for (const n of numbers) if (!decisions.holes?.[n]) say(at, `hole ${n} of the card has no decisions`);
    for (const [key, hole] of Object.entries(decisions.holes ?? {})) {
      const where = `${at} hole ${key}`;
      if (!numbers.includes(Number(key))) { say(where, 'is not on the card'); continue; }
      for (const [i, bend] of (hole.bends ?? []).entries()) if (!inBox(bend)) say(where, `bend ${i + 1} is not a point inside the box`);
      const green = hole.green ?? {};
      if (typeof green.ring === 'string') { if (!osm.has(green.ring.replace(/^osm:/, ''))) say(where, `green ${green.ring} is not in the OSM extract`); }
      else if (green.ring) ring(`${where} green`, green.ring);
      else if (!inBox(green.seed)) say(where, 'the green needs a ring, an OSM way ("osm:w…") or a seed point');
      const given = new Map();
      for (const [i, pad] of (hole.pads ?? []).entries()) {
        const padAt = `${where} deck ${i + 1}`, needs = PAD_SOURCES[pad.src];
        if (!needs) { say(padAt, `src "${pad.src}" is not one of ${Object.keys(PAD_SOURCES).join(', ')}`); continue; }
        for (const key2 of needs) if (pad[key2] === undefined) say(padAt, `a ${pad.src} deck needs "${key2}"`);
        if (pad.src === 'osm' && pad.id !== undefined && !osm.has(String(pad.id))) say(padAt, `${pad.id} is not in the OSM extract`);
        if (pad.src === 'ring' && pad.ring) ring(padAt, pad.ring);
        if (pad.src === 'ellipse' && pad.c && (!inBox(pad.c) || !pair(pad.size) || !(pad.size[0] > 0 && pad.size[1] > 0))) say(padAt, 'needs a centre inside the box and a [length, width]');
        if (pad.src === 'platform' && pad.at && !inBox(pad.at)) say(padAt, 'needs a point inside the box');
        if (pad.reach !== undefined && !(pad.reach >= 0 && pad.reach <= 6)) say(padAt, 'reach is 0 to 6 metres');
        if (!Array.isArray(pad.tees)) { say(padAt, 'needs "tees" (empty for a deck no card colour uses)'); continue; }
        for (const tee of pad.tees) {
          if (!tees.includes(tee)) say(padAt, `"${tee}" is not a tee of the card (${tees.join(', ')})`);
          else if (given.has(tee)) say(padAt, `"${tee}" is already on deck ${given.get(tee)}`);
          else given.set(tee, i + 1);
        }
      }
      for (const tee of tees) if (!given.has(tee)) say(where, `no deck for the card's "${tee}" tee`);
    }
  }

  const sand = files[config.sandDecisions];
  if (!sand) say(config.sandDecisions, 'cannot be read');
  else {
    for (const [i, rule] of (sand.keep ?? []).entries()) {
      const where = `${config.sandDecisions} keep ${i + 1}`;
      if (!inBox(rule.at)) say(where, 'needs "at", a point inside the box');
      if (!SAND_KINDS.includes(rule.kind)) say(where, `kind is one of ${SAND_KINDS.join(', ')}`);
      if (rule.course !== undefined && rule.course !== null && !slugs.includes(rule.course)) say(where, `course "${rule.course}" is not a routing of this ground`);
    }
    for (const [i, rule] of (sand.add ?? []).entries()) {
      ring(`${config.sandDecisions} add ${i + 1}`, rule.ring);
      if (!SAND_KINDS.includes(rule.kind)) say(`${config.sandDecisions} add ${i + 1}`, `kind is one of ${SAND_KINDS.join(', ')}`);
    }
  }
  for (const [i, ringValue] of (config.fairwayExclude ?? []).entries()) ring(`trace-config fairwayExclude ${i + 1}`, ringValue, 3, false); // a mask may reach past the box
  return errors;
}

/** The decision files of a trace configuration, read from the repository. */
export function loadDecisionFiles(configPath, root = ROOT) {
  const read = file => { try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch { return null; } };
  const config = read(configPath);
  if (!config) throw new Error(`cannot read ${configPath}`);
  const names = [config.osm, config.sandDecisions, ...config.courses.flatMap(c => [c.decisions, c.card])];
  return { config, files: Object.fromEntries(names.map(name => [name, read(name)])) };
}

/** Every trace configuration of a published build. */
export function traceConfigs(root = ROOT) {
  const builds = JSON.parse(fs.readFileSync(path.join(root, 'apps/golf/public/courses/index.json'), 'utf8')).courses.map(c => c.build);
  return [...new Set(builds)].map(build => `${build}/mapping/trace-config.json`).filter(file => fs.existsSync(path.join(root, file)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--config');
  if (i < 0 || !process.argv[i + 1]) throw new Error('usage: check-decisions.mjs --config <build>/mapping/trace-config.json');
  const { config, files } = loadDecisionFiles(process.argv[i + 1]);
  const errors = decisionErrors(config, files);
  const decks = config.courses.map(c => `${c.slug}: ${Object.values(files[c.decisions]?.holes ?? {}).reduce((n, h) => n + (h.pads?.length ?? 0), 0)} decks`);
  console.log(errors.length ? errors.join('\n') : `decisions can be traced (${decks.join(', ')}, ${files[config.sandDecisions]?.keep?.length ?? 0} sand decisions)`);
  process.exitCode = errors.length ? 1 : 0;
}
