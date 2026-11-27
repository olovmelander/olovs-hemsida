#!/usr/bin/env node
/* ONE CARD A GROUND.

   A new ground is named in some twenty-five files: the catalogue row, where it is on the map of Sweden, its club,
   its search words, its posters, its gallery views, its frames, its scenery, its tests. At Bro Hof the ones that
   were forgotten were found one at a time, by a red test or by a picture of the live site. The card
   (course-workflows/<ground>/ground.json) holds every fact a person chose for the ground, once, and this tool
   reads each table and says whether it agrees:

   node packages/course-workflow/ground-card.mjs --ground <id>            every table: agrees, differs or missing
   node packages/course-workflow/ground-card.mjs --ground <id> --check    the same, and fails unless all agree
   node packages/course-workflow/ground-card.mjs --ground <id> --apply    add the ground's row to every table it is missing from
   node packages/course-workflow/ground-card.mjs --ground <id> --rows     the rows, printed

   The tables stay where they are, in the app's and the tools' own files: other work edits them, and the app's
   bundles may not import from here. So the card does not generate them; it is the one place to write a ground's
   facts first, its rows are added from it (never changed: see applyCard), and a test holds every card to its tables. A table is read by
   importing it only when that runs nothing (the app's pure modules); a tool's table is read from its text, since
   importing a tool starts it. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const groundCardPath = groundId => `course-workflows/${groundId}/ground.json`;
const text = value => typeof value === 'string' && value.trim().length > 0;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, COLOUR = /^#[0-9a-f]{6}$/;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Why a card cannot be used (an empty list when it can). */
export function groundCardErrors(card) {
  const errors = [], need = (ok, what) => { if (!ok) errors.push(what); };
  if (card?.schemaVersion !== 1 || !SLUG.test(card.groundId ?? '')) return ['not a ground card (schemaVersion 1 and a groundId)'];
  need(SLUG.test(card.club?.id ?? '') && text(card.club?.name), 'club: an id and the club\'s full name');
  need(text(card.boot), 'boot: the line under the name while the course loads');
  const p = card.place ?? {};
  need(Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat > 55 && p.lat < 70 && p.lng > 10 && p.lng < 25, 'place: lat and lng in Sweden (WGS 84)');
  need(['region', 'regionTag', 'city', 'iconName', 'basis'].every(key => text(p[key])), 'place: region, regionTag, city, iconName, and the basis of the position');
  need(text(card.search?.category) && text(card.search?.places), 'search: a category and the place names that should find the club');
  if (!Array.isArray(card.routings) || !card.routings.length) return [...errors, 'routings: at least one'];
  const slugs = new Set();
  for (const r of card.routings) {
    const at = `routing ${r.slug ?? '?'}`;
    need(SLUG.test(r.slug ?? '') && !slugs.has(r.slug), `${at}: a slug of its own`);
    slugs.add(r.slug);
    need(text(r.build) && text(r.name) && text(r.title), `${at}: build, name and title`);
    need(Array.isArray(r.tees) && r.tees.length >= 1 && r.tees.every(t => text(t.name) && COLOUR.test(t.colour ?? '')), `${at}: tees, each a name and a #rrggbb colour, in the card's order`);
    need(Number.isInteger(r.teesHiddenFrom) && r.teesHiddenFrom >= 1, `${at}: teesHiddenFrom, the number of tees the menu shows before it folds the rest away`);
    need(text(r.searchLabel) && text(r.line), `${at}: a searchLabel and the line that describes it`);
    need(card.routings.length === 1 || (text(r.tag) && text(r.layoutLabel)), `${at}: a ground with several routings needs each one's tag and layoutLabel`);
    need(!r.signature || (Number.isInteger(r.signature.poster) && text(r.signature.description)), `${at}: signature is a poster number and a description`);
    const holes = r.posters?.holes;
    need(Array.isArray(holes) && holes.length === 3 && holes.every(Number.isInteger) && text(r.posters?.why), `${at}: posters.holes (signature hole, then two more) and why those`);
    need(Array.isArray(r.posters?.framings) && r.posters.framings.length >= 4, `${at}: posters.framings, one a poster`);
    need(Array.isArray(r.gallery) && r.gallery.every(v => Number.isInteger(v.hole) && text(v.vy) && text(v.ljus)), `${at}: gallery, its graphics-review views (hole, vy, ljus); an empty list when it has none`);
    need(Array.isArray(r.mapGallery) && r.mapGallery.length >= 1, `${at}: mapGallery, at least one view of the phone map`);
  }
  return errors;
}

/** Where `const NAME = <object or array literal>` lies in a source text: the literal's first and one past its last character. */
export function literalSpan(source, name) {
  const found = new RegExp(`(?:^|\\n)(?:export )?const ${name} = `).exec(source);
  if (!found) return undefined;
  const start = found.index + found[0].length, open = source[start], close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) return undefined;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (c === '/' && next === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && next === '*') { i = source.indexOf('*/', i + 2) + 1; if (i < 1) break; continue; }
    if (c === '\'' || c === '"' || c === '`') { for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return { start, end: i + 1 }; }
  }
  return undefined;
}

/** The value of `const NAME = <object or array literal>` in a source text, without running the file it is in. */
export function literalOf(source, name) {
  const span = literalSpan(source, name);
  return span ? new Function(`return (${source.slice(span.start, span.end)});`)() : undefined;
}

/* WRITING THE ROWS. Until 27 November 2026 the rows were printed and pasted by hand, and at Tjusta the pasting was
   a script written for the day, outside the repository, with an anchor string for each of ten files. The tables
   still live in their own files, and other work still edits them: --apply only ever ADDS a ground's row at the end
   of a table it is missing from, never changes or removes one, and reads the table back to see that the row is
   there and says what the card says. A row that differs is a person's to settle. */
const TABLE_WITHOUT_A_NAME = { 'apps/golf/src/engine/scenery/index.js': 'REGISTRY' };
const tableOf = where => { const [file, name] = where.split(' '); return { file, name: name ?? TABLE_WITHOUT_A_NAME[file] }; };

/** Whether a table already has a row for a routing: its key in an object, an entry with its slug in a list. */
export function hasRow(source, name, slug) {
  const table = literalOf(source, name);
  if (table === undefined) throw new Error(`no table ${name} to read`);
  return Array.isArray(table) ? table.some(entry => entry?.slug === slug) : Object.hasOwn(table, slug);
}

/** A source text with a row added at the end of a table. */
export function withRow(source, name, row) {
  const span = literalSpan(source, name);
  if (!span) throw new Error(`no table ${name} to add a row to`);
  const close = span.end - 1, lineStart = source.lastIndexOf('\n', close) + 1;
  if (source.slice(lineStart, close).trim() !== '') throw new Error(`${name}: its closing bracket does not stand on a line of its own`);
  const next = `${source.slice(0, lineStart)}  ${row}\n${source.slice(lineStart)}`;
  try { literalOf(next, name); } catch (error) { throw new Error(`${name}: with the row added it no longer reads (${error.message}); does its last row end in a comma?`); }
  return next;
}

/** The files a card's ground is still missing from, with its rows added: { edits: [{ file, table, slug }], files: Map(file, text) }.
 * `read(file)` gives a file's text. Nothing is written here. */
export function applyCard(card, read) {
  const files = new Map(), edits = [], waiting = [];
  const text = file => { if (!files.has(file)) { const source = read(file); if (source === null) throw new Error(`${file} is not there`); files.set(file, source); } return files.get(file); };
  const scenery = `apps/golf/src/engine/scenery/${card.groundId}.js`;
  for (const x of expectedTables(card)) {
    for (const [where, row] of Object.entries(x.paste)) {
      const { file, name } = tableOf(where);
      if (!row || hasRow(text(file), name, x.slug)) continue;
      // the registry's row imports the ground's scenery module: before that file is written, the row would break the build
      if (name === 'REGISTRY' && read(scenery) === null) { waiting.push({ file, table: name, slug: x.slug, why: `write ${scenery} first` }); continue; }
      files.set(file, withRow(text(file), name, row));
      if (!hasRow(files.get(file), name, x.slug)) throw new Error(`${file} ${name}: the row for ${x.slug} was added and is not there`);
      edits.push({ file, table: name, slug: x.slug });
    }
    // the build's own tests join the suite: package.json names every node test file, at the end of one line
    const tests = `${x.catalogue.build}/course.node-test.mjs`;
    if (read(tests) !== null && !JSON.parse(text('package.json')).scripts.test.includes(tests)) {
      const source = text('package.json'), at = source.indexOf('"test": "'), end = source.indexOf('",\n', at);
      if (at < 0 || end < 0) throw new Error('package.json: no test script on a line of its own');
      files.set('package.json', `${source.slice(0, end)} ${tests}${source.slice(end)}`);
      if (!JSON.parse(files.get('package.json')).scripts.test.endsWith(` ${tests}`)) throw new Error('package.json: the test file was added and is not at the end of the suite');
      edits.push({ file: 'package.json', table: 'scripts.test', slug: x.slug });
    }
  }
  for (const file of [...files.keys()]) if (!edits.some(edit => edit.file === file)) files.delete(file);
  return { edits, files, waiting };
}

const int = colour => parseInt(colour.slice(1), 16), hex = colour => `0x${colour.slice(1)}`;
const quote = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
const key = slug => (/^[a-z_$][\w$]*$/i.test(slug) ? slug : quote(slug));
const flat = value => JSON.stringify(value).replace(/"([a-zA-Z_$][\w$]*)":/g, '$1: ').replace(/"/g, '\'').replace(/,(?=\S)/g, ', ').replace(/^\{/, '{ ').replace(/\}$/, ' }');

/** What each table should hold for this card: rows to compare and, as text, rows to paste. */
export function expectedTables(card) {
  const host = card.routings[0], several = card.routings.length > 1;
  const place = (({ lat, lng, region, regionTag, city, iconName }) => ({ lat, lng, region, regionTag, city, iconName }))(card.place);
  return card.routings.map(r => ({
    slug: r.slug,
    catalogue: { slug: r.slug, build: r.build, name: r.name, club: card.club.name, title: r.title, ...(r.tag ? { tag: r.tag } : {}), boot: card.boot,
      tees: { names: r.tees.map(t => t.name), cols: r.tees.map(t => int(t.colour)), hideFrom: r.teesHiddenFrom } },
    location: r === host ? place : null, hostClub: r === host ? null : host.slug, clubId: card.club.id, layoutLabel: r.layoutLabel ?? r.name,
    category: { id: card.search.category, label: r.searchLabel, iconName: card.place.iconName, places: card.search.places }, line: r.line,
    signature: several ? r.signature ?? null : null,
    plan: { sig: r.posters.holes[0], s2: r.posters.holes[1], s3: r.posters.holes[2] }, framings: r.posters.framings,
    gallery: r.gallery.map(v => ({ id: `${r.slug}-h${v.hole}-${v.vy}-${v.ljus}`, slug: r.slug, hole: v.hole, vy: v.vy, ljus: v.ljus })),
    mapGallery: r.mapGallery.map(v => (v.course ? { id: `${r.slug}-bana`, slug: r.slug, course: true } : { id: `${r.slug}-h${v.hole}`, slug: r.slug, hole: v.hole })),
    paste: {
      'packages/course-pack/emit-manifest.mjs COURSES': `{ slug: ${quote(r.slug)}, build: ${quote(r.build)}, name: ${quote(r.name)}, club: ${quote(card.club.name)},\n    title: ${quote(r.title)},${r.tag ? ` tag: ${quote(r.tag)},` : ''} boot: ${quote(card.boot)},\n    tees: { names: [${r.tees.map(t => quote(t.name)).join(', ')}], cols: [${r.tees.map(t => hex(t.colour)).join(', ')}], hideFrom: ${r.teesHiddenFrom} } },`,
      ...(r === host ? { 'apps/golf/src/shell/course-places.mjs COURSE_LOCATIONS': `${key(r.slug)}: {\n    // ${card.place.basis}\n    lat: ${place.lat}, lng: ${place.lng}, region: ${quote(place.region)},\n    regionTag: ${quote(place.regionTag)}, city: ${quote(place.city)}, iconName: ${quote(place.iconName)},\n  },` }
        : { 'apps/golf/src/shell/course-places.mjs HOST_CLUB': `${key(r.slug)}: ${quote(host.slug)},` }),
      // a layout whose label is its name needs no row: the table falls back on the name
      ...(r.layoutLabel && r.layoutLabel !== r.name ? { 'apps/golf/src/shell/course-clubs.mjs LAYOUT_LABELS': `${key(r.slug)}: ${quote(r.layoutLabel)},` } : {}),
      'apps/golf/src/shell/club-search.mjs CATEGORIES': `${key(r.slug)}: ${flat({ id: card.search.category, label: r.searchLabel, iconName: card.place.iconName, places: card.search.places })},`,
      'apps/golf/src/shell/club-search.mjs COURSE_LINES': `${key(r.slug)}: ${quote(r.line)},`,
      ...(several && r.signature ? { 'apps/golf/src/shell/club-picker.js SIGNATURE_HOLES': `${key(r.slug)}: ${flat(r.signature)},` } : {}),
      'tools/make-posters.mjs PLAN': `/* ${r.posters.why} */\n  ${key(r.slug)}: ${flat({ sig: r.posters.holes[0], s2: r.posters.holes[1], s3: r.posters.holes[2] })},`,
      'tools/make-posters.mjs POSTERS': `${key(r.slug)}: [\n${r.posters.framings.map(f => `    ${flat(f)},`).join('\n')}\n  ],`,
      'tools/gfx-gallery.mjs GALLERY': r.gallery.map(v => `${flat({ id: `${r.slug}-h${v.hole}-${v.vy}-${v.ljus}`, slug: r.slug, hole: v.hole, vy: v.vy, ljus: v.ljus })},`).join('\n  '),
      'tools/map-gallery.mjs VIEWS': r.mapGallery.map(v => `${flat(v.course ? { id: `${r.slug}-bana`, slug: r.slug, course: true } : { id: `${r.slug}-h${v.hole}`, slug: r.slug, hole: v.hole })},`).join('\n  '),
      'apps/golf/src/engine/scenery/index.js': `${key(r.slug)}: () => import('./${card.groundId}.js'),`,
    },
  }));
}

/** Every table against the card: [{ table, file, slug, state: 'agrees' | 'differs' | 'missing', detail }]. */
export async function registration(card, { root = ROOT } = {}) {
  const read = file => (fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : null);
  const load = file => import(pathToFileURL(path.join(root, file)).href);
  const rows = [], row = (table, file, slug, have, want, { subset = false } = {}) => {
    const missing = have === undefined || have === null || (subset && want.every(w => !have.some(h => same(h, w))));
    const agrees = !missing && (subset ? want.every(w => have.some(h => same(h, w))) : same(have, want));
    rows.push({ table, file, slug, state: agrees ? 'agrees' : missing ? 'missing' : 'differs', detail: agrees ? '' : missing ? 'not there' : `has ${JSON.stringify(have).slice(0, 200)}, the card says ${JSON.stringify(want).slice(0, 200)}` });
  };
  const pick = (object, keys) => (object ? Object.fromEntries(keys.filter(k => k in object).map(k => [k, object[k]])) : object);
  const index = JSON.parse(read('apps/golf/public/courses/index.json') ?? '{"courses":[]}').courses;
  const places = await load('apps/golf/src/shell/course-places.mjs'), clubs = await load('apps/golf/src/shell/course-clubs.mjs'), search = await load('apps/golf/src/shell/club-search.mjs');
  const { loadRegistryState, checkRegistries } = await load('tools/sync-course-registries.mjs');
  const registries = await loadRegistryState(root); // the frontier configurations, and Puttom's pilot beside them
  const posters = read('tools/make-posters.mjs') ?? '', plan = literalOf(posters, 'PLAN') ?? {}, framings = literalOf(posters, 'POSTERS') ?? {};
  const gallery = literalOf(read('tools/gfx-gallery.mjs') ?? '', 'GALLERY') ?? [], mapViews = (literalOf(read('tools/map-gallery.mjs') ?? '', 'VIEWS') ?? []).map(v => pick(v, ['id', 'slug', 'hole', 'course']));
  const signatures = literalOf(read('apps/golf/src/shell/club-picker.js') ?? '', 'SIGNATURE_HOLES') ?? {};
  const scenery = read('apps/golf/src/engine/scenery/index.js') ?? '', suite = JSON.parse(read('package.json') ?? '{}').scripts?.test ?? '';
  for (const x of expectedTables(card)) {
    const published = index.find(c => c.slug === x.slug);
    row('the catalogue row', 'packages/course-pack/emit-manifest.mjs COURSES', x.slug,
      published ? { ...pick(published, ['slug', 'build', 'name', 'club', 'title', 'tag', 'boot']), tees: pick(published.tees, ['names', 'cols', 'hideFrom']) } : null,
      { ...pick(x.catalogue, ['slug', 'build', 'name', 'club', 'title', 'tag', 'boot']), tees: x.catalogue.tees });
    if (x.location) row('where it is', 'apps/golf/src/shell/course-places.mjs COURSE_LOCATIONS', x.slug, pick(places.COURSE_LOCATIONS[x.slug], Object.keys(x.location)), x.location);
    else row('its host routing', 'apps/golf/src/shell/course-places.mjs HOST_CLUB', x.slug, places.HOST_CLUB[x.slug], x.hostClub);
    row('its club', 'apps/golf/src/shell/course-clubs.mjs clubIdFor', x.slug, clubs.clubIdFor(x.slug) === x.slug && x.clubId !== x.slug ? null : clubs.clubIdFor(x.slug), x.clubId);
    row('its name among the club\'s layouts', 'apps/golf/src/shell/course-clubs.mjs LAYOUT_LABELS', x.slug, clubs.layoutLabel({ slug: x.slug, name: x.catalogue.name }), x.layoutLabel);
    row('its search words', 'apps/golf/src/shell/club-search.mjs CATEGORIES', x.slug, search.CATEGORIES[x.slug], x.category);
    row('its describing line', 'apps/golf/src/shell/club-search.mjs COURSE_LINES', x.slug, search.COURSE_LINES[x.slug], x.line);
    if (x.signature) row('its picture in the club picker', 'apps/golf/src/shell/club-picker.js SIGNATURE_HOLES', x.slug, signatures[x.slug], x.signature);
    row('its poster holes', 'tools/make-posters.mjs PLAN', x.slug, plan[x.slug], x.plan);
    row('its poster framings', 'tools/make-posters.mjs POSTERS', x.slug, framings[x.slug], x.framings);
    if (x.gallery.length) row('its graphics-review views', 'tools/gfx-gallery.mjs GALLERY', x.slug, gallery, x.gallery, { subset: true });
    row('its phone-map views', 'tools/map-gallery.mjs VIEWS', x.slug, mapViews, x.mapGallery, { subset: true });
    row('its scenery module', 'apps/golf/src/engine/scenery/index.js', x.slug, new RegExp(`['"]?${x.slug}['"]?: \\(\\) => import\\(`).test(scenery) || null, true);
    row('its terrain configuration', 'apps/golf/src/engine/v2-frontier-configs.mjs', x.slug, registries.allConfigs.find(config => config.slug === x.slug)?.groundId, card.groundId);
    const tests = `${x.catalogue.build}/course.node-test.mjs`;
    if (read(tests) !== null) row('its build\'s tests in the suite', 'package.json scripts.test', x.slug, suite.includes(tests) || null, true);
  }
  const drift = checkRegistries(registries, root).drift.filter(d => JSON.stringify(d).includes(card.groundId) || card.routings.some(r => JSON.stringify(d).includes(r.slug)));
  rows.push({ table: 'its frames and ground lists', file: 'tools/sync-course-registries.mjs --check', slug: card.groundId, state: drift.length ? 'differs' : 'agrees', detail: drift.map(d => `${d.file}: ${d.kind}`).join('; ') });
  // A production profile and a walkthrough are not registration: a ground built before them has neither (the doctor says so).
  for (const [what, file] of [['its workflow', `course-workflows/${card.groundId}/workflow.json`], ['its release review', `course-workflows/${card.groundId}/review.json`]]) {
    rows.push({ table: what, file, slug: card.groundId, state: read(file) !== null ? 'agrees' : 'missing', detail: read(file) !== null ? '' : 'not there' });
  }
  return rows;
}

/** A ground's card as its tables state it today: how a ground registered before the cards gets one. What the tables do
 * not hold (why a position or a poster hole was chosen) is said to be unrecorded, not made up. */
export async function deriveCard(groundId, { root = ROOT, on = new Date().toISOString().slice(0, 10) } = {}) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8'), load = file => import(pathToFileURL(path.join(root, file)).href);
  const index = JSON.parse(read('apps/golf/public/courses/index.json')).courses;
  const slugs = JSON.parse(read('apps/golf/public/courses/v2-index.json')).courses.filter(course => course.groundId === groundId).map(course => course.slug);
  const places = await load('apps/golf/src/shell/course-places.mjs'), clubs = await load('apps/golf/src/shell/course-clubs.mjs'), search = await load('apps/golf/src/shell/club-search.mjs');
  const rows = index.filter(row => slugs.includes(row.slug)).sort((a, b) => Number(Boolean(places.HOST_CLUB[a.slug])) - Number(Boolean(places.HOST_CLUB[b.slug])));
  if (!rows.length) throw new Error(`${groundId}: no published routing`);
  const host = rows[0], location = places.COURSE_LOCATIONS[host.slug], category = search.CATEGORIES[host.slug];
  if (!location || !category) throw new Error(`${groundId}: ${host.slug} has no place or no search words in the app's tables`);
  for (const row of rows) {
    if (row.club !== host.club || row.boot !== host.boot) throw new Error(`${groundId}: ${row.slug} has another club or boot line than ${host.slug}; a card holds one of each`);
    if (search.CATEGORIES[row.slug]?.id !== category.id || search.CATEGORIES[row.slug]?.places !== category.places) throw new Error(`${groundId}: ${row.slug} has other search words than ${host.slug}`);
  }
  const posters = read('tools/make-posters.mjs'), plan = literalOf(posters, 'PLAN') ?? {}, framings = literalOf(posters, 'POSTERS') ?? {};
  const gallery = literalOf(read('tools/gfx-gallery.mjs'), 'GALLERY') ?? [], mapViews = literalOf(read('tools/map-gallery.mjs'), 'VIEWS') ?? [];
  const signatures = literalOf(read('apps/golf/src/shell/club-picker.js'), 'SIGNATURE_HOLES') ?? {};
  const unrecorded = what => `Carried over from the app's tables on ${on}; ${what} was not recorded there.`;
  const colour = value => `#${value.toString(16).padStart(6, '0')}`;
  return {
    schemaVersion: 1, groundId, club: { id: clubs.clubIdFor(host.slug), name: host.club }, boot: host.boot,
    place: { lat: location.lat, lng: location.lng, region: location.region, regionTag: location.regionTag, city: location.city, iconName: location.iconName, basis: unrecorded('how the position was chosen') },
    search: { category: category.id, places: category.places },
    routings: rows.map(row => ({
      slug: row.slug, build: row.build, name: row.name, title: row.title, ...(row.tag ? { tag: row.tag } : {}),
      ...(rows.length > 1 || clubs.layoutLabel(row) !== row.name ? { layoutLabel: clubs.layoutLabel(row) } : {}),
      tees: row.tees.names.map((name, i) => ({ name, colour: colour(row.tees.cols[i]) })), teesHiddenFrom: row.tees.hideFrom,
      searchLabel: search.CATEGORIES[row.slug].label, line: search.COURSE_LINES[row.slug],
      ...(signatures[row.slug] ? { signature: signatures[row.slug] } : {}),
      posters: { holes: [plan[row.slug]?.sig, plan[row.slug]?.s2, plan[row.slug]?.s3], why: unrecorded('why these holes'), framings: framings[row.slug] ?? [] },
      gallery: gallery.filter(view => view.slug === row.slug).map(({ hole, vy, ljus }) => ({ hole, vy, ljus })),
      mapGallery: mapViews.filter(view => view.slug === row.slug && (view.course || Number.isInteger(view.hole))).map(view => (view.course ? { course: true } : { hole: view.hole })),
    })),
  };
}

/** The grounds that have a card. */
export function groundCards(root = ROOT) {
  const dir = path.join(root, 'course-workflows');
  return fs.readdirSync(dir).filter(id => fs.existsSync(path.join(dir, id, 'ground.json'))).sort();
}
export const loadGroundCard = (groundId, root = ROOT) => JSON.parse(fs.readFileSync(path.join(root, groundCardPath(groundId)), 'utf8'));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), flag = name => { const i = argv.indexOf(`--${name}`); return i < 0 ? null : argv[i + 1]; };
  const groundId = flag('ground');
  if (!groundId) throw new Error('usage: ground-card.mjs --ground <id> [--check | --rows | --apply [--dry-run] | --derive [--write]]');
  if (argv.includes('--derive')) {
    const derived = await deriveCard(groundId), text = `${JSON.stringify(derived, null, 1)}\n`;
    const wrong = groundCardErrors(derived);
    if (wrong.length) { console.error(wrong.join('\n')); process.exit(1); }
    if (!argv.includes('--write')) { process.stdout.write(text); process.exit(0); }
    if (fs.existsSync(path.join(ROOT, groundCardPath(groundId)))) throw new Error(`${groundCardPath(groundId)} exists: a card that was written is not overwritten by a derived one`);
    fs.writeFileSync(path.join(ROOT, groundCardPath(groundId)), text);
  }
  const card = loadGroundCard(groundId), errors = groundCardErrors(card);
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  if (argv.includes('--rows')) {
    for (const x of expectedTables(card)) for (const [where, row] of Object.entries(x.paste)) console.log(`// ${where}\n  ${row}\n`);
  } else {
    if (argv.includes('--apply')) {
      const dry = argv.includes('--dry-run');
      const { edits, files, waiting } = applyCard(card, file => (fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), 'utf8') : null));
      for (const edit of edits) console.log(`${dry ? 'would add' : 'added'}    ${edit.slug.padEnd(18)} ${edit.file} ${edit.table}`);
      for (const row of waiting) console.log(`waits     ${row.slug.padEnd(18)} ${row.file} ${row.table}: ${row.why}`);
      if (!dry) for (const [file, source] of files) fs.writeFileSync(path.join(ROOT, file), source);
      console.log(edits.length ? `${edits.length} rows ${dry ? 'to add' : 'added'} in ${files.size} files.\n` : 'Every table that takes a row from the card has this ground\'s.\n');
      if (dry) process.exit(0);
    }
    const rows = await registration(card), open = rows.filter(r => r.state !== 'agrees');
    for (const r of rows) console.log(`${r.state.padEnd(8)} ${r.slug.padEnd(18)} ${r.table.padEnd(36)} ${r.file}${r.detail ? `\n         ${r.detail}` : ''}`);
    console.log(`\n${rows.length - open.length} of ${rows.length} agree with ${groundCardPath(groundId)}.${open.length ? ' Add the rows a table is missing with --apply (--rows prints them); a row that differs is settled by hand.' : ''}`);
    if (argv.includes('--check') && open.length) process.exitCode = 1;
  }
}
