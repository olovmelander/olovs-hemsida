#!/usr/bin/env node
/* THE SAND AUDIT'S RECORD, and what a person said of each thing it named.

   audit-sand.py reads the photo round every hole and writes <build>/mapping/sand-audit.json:

   - `areas`: bright sand on the photo that no bunker or waste area of the model holds, each with what the map has
     there (`on`: a road, a roof, a shore, a practice surface) or nothing (`on: null`);
   - `rings`: bunkers and waste areas of the model with little sand inside them, or sand joined to them outside
     their line.

   Every ring it names, and every area on nothing mapped, needs a person to have looked and said what it is:

   node packages/course-geo/mapping/sand-audit.mjs --build <build>                           what is open
   node packages/course-geo/mapping/sand-audit.mjs --build <build> --verdict id="what it is, or why the ring stands"
   node packages/course-geo/mapping/sand-audit.mjs --build <build> --fault id="what is wrong, and what will put it right"

   A verdict says the model is right to leave the area out, or that the ring stands. A fault says it is not right
   yet (a bunker that was missed, a ring on ground that is not sand); the walkthrough prints every fault. The record
   holds for the outlines it was measured against: a test fails when they change, and the audit is run again.
   What was said is carried over by audit-sand.py when the same area is still there. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const json = file => JSON.parse(read(file).toString('utf8'));
export const sandAuditPath = build => `${build}/mapping/sand-audit.json`;
const said = text => typeof text === 'string' && text.trim().length >= 20;

/** What of a record needs a person: every ring it names, and every area the map explains by nothing. */
export const needsAVerdict = record => [...(record.rings ?? []), ...(record.areas ?? []).filter(area => area.on === null)];

/** Why a record does not hold, given the current checksum of each routing's outlines (an empty list when it does). */
export function sandAuditErrors(record, surfaces, label = 'the sand audit') {
  const errors = [];
  if (record?.schemaVersion !== 1 || !Array.isArray(record.rings) || !Array.isArray(record.areas)) return [`${label}: not a sand audit record`];
  for (const [slug, sha] of Object.entries(surfaces)) if (record.surfaces?.[slug] !== sha) errors.push(`${label}: the outlines of ${slug} changed since the sand was measured; run audit-sand.py again`);
  const ids = new Set();
  for (const item of [...record.rings, ...record.areas]) {
    if (ids.has(item.id)) errors.push(`${label}: ${item.id} is listed twice`);
    ids.add(item.id);
    if (item.verdict && item.fault) errors.push(`${label}: ${item.id} both stands and is a fault; it is one or the other`);
  }
  for (const item of needsAVerdict(record)) {
    if (!said(item.verdict) && !said(item.fault)) {
      errors.push(item.sandShare !== undefined
        ? `${label}: ${item.id} holds ${Math.round(item.sandShare * 100)}% sand, with ${item.sandOutsideM2} m2 outside its line, and nobody has said why`
        : `${label}: ${item.areaM2} m2 of ${item.kind === 'bunker' ? 'bright sand' : 'tan sand'} at ${item.at.join(', ')} (${item.id}, ${item.metresFromHole} m from ${item.slug} ${item.hole}) is not in the model, and nobody has said what it is`);
    }
  }
  return errors;
}

/** A record in numbers, and its faults by id. */
export function sandAuditSummary(record) {
  if (!record) return null;
  const open = needsAVerdict(record);
  return { captured: record.imagery?.captured ?? null, modelled: Object.values(record.modelled ?? {}).reduce((sum, n) => sum + n, 0), ringsNamed: record.rings.length,
    areas: record.areas.length, onNothingMapped: record.areas.filter(area => area.on === null).length,
    faults: [...record.rings, ...record.areas].filter(item => item.fault).map(item => ({ id: item.id, slug: item.slug, hole: item.hole, fault: item.fault })),
    open: open.filter(item => !said(item.verdict) && !said(item.fault)).map(item => item.id),
    // what the older photo says of the model's bunkers: evidence of the ground's age, not a fault of an outline
    before: record.before ? { captured: record.before.captured ?? null, bunkers: record.before.bunkers, wasSand: record.before.wasSand, changed: record.before.changed, shaded: record.before.shaded } : null };
}

/** The outlines' checksums for the routings a record covers, from the catalogue's builds. */
export function currentSurfaces(record) {
  const index = json('apps/golf/public/courses/index.json').courses;
  return Object.fromEntries(Object.keys(record.surfaces ?? {}).map(slug => {
    const build = index.find(course => course.slug === slug)?.build;
    return [slug, build ? createHash('sha256').update(read(`${build}/mapping/playing-surfaces.geojson`)).digest('hex') : null];
  }));
}

/** The builds that hold a trace configuration, which is where a ground's sand audit is kept. */
export function auditedBuilds() {
  return [...new Set(json('apps/golf/public/courses/index.json').courses.map(course => course.build))].filter(build => fs.existsSync(path.join(ROOT, `${build}/mapping/trace-config.json`)));
}

export function sandAuditOf(build) {
  if (!fs.existsSync(path.join(ROOT, sandAuditPath(build)))) return { record: null, errors: [`${build}: the sand on the photo was not measured against the model (audit-sand.py)`] };
  const record = json(sandAuditPath(build));
  return { record, errors: sandAuditErrors(record, currentSurfaces(record), build) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const build = flag('build');
  if (!build) throw new Error('usage: sand-audit.mjs --build <build> [--verdict id="..."] [--fault id="..."]');
  if (flag('verdict') || flag('fault')) {
    const record = json(sandAuditPath(build));
    argv.forEach((arg, i) => {
      if (arg !== '--verdict' && arg !== '--fault') return;
      const [id, ...what] = argv[i + 1].split('='), item = [...record.rings, ...record.areas].find(x => x.id === id);
      if (!item) throw new Error(`the audit names no ${id}`);
      if (!said(what.join('='))) throw new Error(`${id}: say what it is in a sentence`);
      delete item.verdict; delete item.fault;
      item[arg.slice(2)] = what.join('=');
    });
    fs.writeFileSync(path.join(ROOT, sandAuditPath(build)), `${JSON.stringify(record, null, 1)}\n`);
  }
  const { record, errors } = sandAuditOf(build);
  console.log(JSON.stringify({ build, ...(record ? sandAuditSummary(record) : {}), errors }, null, 1));
  process.exitCode = errors.length ? 1 : 0;
}
