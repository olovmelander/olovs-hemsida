#!/usr/bin/env node
/* AN OLDER GROUND'S OUTLINES, AS THE LOOKS OF PIPELINE V2 READ THEM.

   The ring sheets, the deck check, the sand audit and the ring review read a build's outlines from
   <build>/mapping/playing-surfaces.geojson in EPSG:3006, which the shared tracer writes. A ground built with its
   own older builder (Ängsö, Puttom, Visby and the rest) has its outlines in its course model, in a local frame,
   and keeps that builder for its fixes. Its migration record (`migrate-legacy.mjs --write`) holds the same model
   in EPSG:3006, converted by PROJ and tied to the model by its checksum. This writes that record's greens, tee
   decks, fairways and bunkers, and every tee mark, in the tracer's shape, so the looks work on the ground as it is
   published, and nothing about the outlines changes:

   node packages/course-geo/mapping/export-model-surfaces.mjs --build angsobuild --migration geo_data/course-v2/angso/migration/course-model.epsg3006.json --slug angso
   node packages/course-geo/mapping/export-model-surfaces.mjs ... --check        fail when the export is behind the model

   The export says what it is (`provenance.exportedFrom`): it is not a trace, writes no trace report, and the
   ground stays "own builder" in the catalogue. It refuses a migration record made from another model than the one
   in the build, so the looks never see outlines the game does not draw. Ring ids follow the tracer's
   (<slug>-green-01, <slug>-tee-01-2, <slug>-bunker-01-1, <slug>-fairway-01-1: the model's order within a hole);
   each keeps the model's own review id. Tee marks that stand on no deck (a fairway tee, a mark nobody could place)
   are points of kind `tee-mark`, so a look sees them too. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = file => fs.readFileSync(path.join(ROOT, file));
const json = file => JSON.parse(read(file).toString('utf8'));
const sha = file => createHash('sha256').update(read(file)).digest('hex');
const two = n => String(n).padStart(2, '0');
const closed = ring => (ring.length && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]) ? [...ring, ring[0]] : ring);
const polygon = ring => ({ type: 'Polygon', coordinates: [closed(ring.map(([e, n]) => [+e.toFixed(2), +n.toFixed(2)]))] });
const point = ([e, n]) => ({ type: 'Point', coordinates: [+e.toFixed(2), +n.toFixed(2)] });

/** The tee names of a mark's card column; a mark's deck is the one its review chose. */
const markDeck = mark => mark.sourcePadId ?? mark.orthophotoReference?.selectedPadReviewId ?? null;

export function exportSurfaces({ build, migration, slug }) {
  const record = json(migration), model = json(`${build}/course-model.json`);
  const modelSha256 = sha(`${build}/course-model.json`);
  if (record.source?.path !== `${build}/course-model.json` || record.source?.sha256 !== modelSha256) {
    throw new Error(`${migration} was made from another model than ${build}/course-model.json: run migrate-legacy.mjs --write first`);
  }
  if (record.target?.horizontalCrs !== 'EPSG:3006') throw new Error(`${migration} is not in EPSG:3006`);
  const geometry = record.geometry, names = geometry.card?.teeNames ?? model.card?.teeNames ?? [];
  const features = [], routes = [];
  const props = (kind, hole, part, extra = {}) => ({ kind, hole, sourceId: part.sourceIds?.join('+') ?? null,
    start: part.prov ?? 'model', reviewId: part.reviewId ?? null, ...extra });
  for (const hole of geometry.holes) {
    const n = hole.n, h = two(n);
    if (hole.green?.ring?.length >= 3) features.push({ type: 'Feature', id: `${slug}-green-${h}`, properties: props('green', n, hole.green), geometry: polygon(hole.green.ring) });
    const fairways = hole.fairway?.rings ?? (hole.fairway?.ring ? [hole.fairway.ring] : []);
    fairways.filter(r => r.length >= 3).forEach((ring, k) => features.push({ type: 'Feature', id: `${slug}-fairway-${h}-${k + 1}`, properties: props('fairway', n, hole.fairway), geometry: polygon(ring) }));
    const pads = Array.isArray(hole.tees) ? [] : hole.tees?.pads ?? [];
    const marks = Array.isArray(hole.tees) ? [] : hole.tees?.marks ?? [];
    pads.forEach((pad, k) => {
      const on = marks.map((mark, i) => ({ mark, name: names[i] ?? `tee${i}` })).filter(({ mark }) => pad.reviewId && markDeck(mark) === pad.reviewId);
      features.push({ type: 'Feature', id: `${slug}-tee-${h}-${k + 1}`,
        properties: props('tee', n, pad, { teeIds: on.map(t => t.name), teeMarks: Object.fromEntries(on.map(t => [t.name, t.mark.c.map(v => +v.toFixed(2))])) }),
        geometry: polygon(pad.ring) });
    });
    marks.forEach((mark, i) => {
      if (markDeck(mark) && pads.some(pad => pad.reviewId === markDeck(mark))) return;
      const ref = mark.orthophotoReference ?? {};
      features.push({ type: 'Feature', id: `${slug}-mark-${h}-${i + 1}`,
        properties: { kind: 'tee-mark', hole: n, tee: names[i] ?? `tee${i}`, surface: mark.referenceSurfaceKind ?? null,
          status: ref.identityStatus ?? null, confidence: ref.evidence?.confidence ?? null }, geometry: point(mark.c) });
    });
    (hole.bunkers ?? []).filter(b => b.ring?.length >= 3).forEach((bunker, k) => features.push({ type: 'Feature', id: `${slug}-bunker-${h}-${k + 1}`, properties: props('bunker', n, bunker), geometry: polygon(bunker.ring) }));
    if (hole.line?.length >= 2) {
      routes.push({ type: 'Feature', id: `${slug}-route-${h}`, properties: { kind: 'hole', hole: n, par: hole.par, card: Object.fromEntries((hole.t ?? []).map((m, i) => [names[i] ?? `tee${i}`, m])) },
        geometry: { type: 'LineString', coordinates: hole.line.map(([e, n2]) => [+e.toFixed(2), +n2.toFixed(2)]) } });
    }
  }
  // The record holds no checksum of the model: a change that leaves every outline and mark as it was (a stake, a level)
  // must not void the looks recorded against them. exportErrors() compares the content instead.
  const provenance = { exportedFrom: `${build}/course-model.json`, migration,
    note: 'The published outlines of a ground built with its own builder, in EPSG:3006 for the looks of pipeline v2. Not a trace: fix an outline in the builder\'s own records, rebuild the model, migrate it and export again.' };
  const crs = { type: 'name', properties: { name: 'EPSG:3006' } };
  return {
    surfaces: { type: 'FeatureCollection', crs, status: 'exported-from-model', slug, provenance, features },
    routes: { type: 'FeatureCollection', crs, status: 'exported-from-model', provenance, features: routes },
  };
}

export const exportedPaths = build => ({ surfaces: `${build}/mapping/playing-surfaces.geojson`, routes: `${build}/mapping/routes.geojson` });
const text = value => `${JSON.stringify(value, null, 1)}\n`;

/** Whether a build's playing surfaces are an export of its model (and so an older ground's, not a trace). */
export function isExported(build) {
  const file = path.join(ROOT, exportedPaths(build).surfaces);
  return fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).status === 'exported-from-model';
}

/** Why an export no longer matches its model, as a list (empty when it does). */
export function exportErrors(build) {
  const { surfaces } = exportedPaths(build), errors = [];
  const written = json(surfaces);
  try {
    const now = exportSurfaces({ build, migration: written.provenance.migration, slug: written.slug });
    if (text(now.surfaces) !== read(surfaces).toString('utf8')) errors.push(`${surfaces} is behind ${build}/course-model.json: migrate it and export again`);
  } catch (error) { errors.push(error.message); }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const build = flag('build'), migration = flag('migration'), slug = flag('slug');
  if (!build || !migration || !slug) throw new Error('usage: export-model-surfaces.mjs --build <build> --migration <...epsg3006.json> --slug <slug> [--check]');
  const out = exportSurfaces({ build, migration, slug }), paths = exportedPaths(build);
  if (argv.includes('--check')) {
    const stale = Object.entries(paths).filter(([key, file]) => !fs.existsSync(path.join(ROOT, file)) || read(file).toString('utf8') !== text(out[key]));
    for (const [, file] of stale) console.error(`${file} is behind ${build}/course-model.json: export again`);
    process.exitCode = stale.length ? 1 : 0;
  } else {
    for (const [key, file] of Object.entries(paths)) fs.writeFileSync(path.join(ROOT, file), text(out[key]));
    const kinds = {};
    for (const f of out.surfaces.features) kinds[f.properties.kind] = (kinds[f.properties.kind] ?? 0) + 1;
    console.log(JSON.stringify({ wrote: Object.values(paths), kinds, routes: out.routes.features.length }));
  }
}
