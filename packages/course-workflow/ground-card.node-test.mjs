import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deriveCard, expectedTables, groundCardErrors, groundCards, literalOf, loadGroundCard, registration } from './ground-card.mjs';

test('a table is read from a tool\'s text without running the tool', () => {
  const source = [
    'import { chromium } from \'playwright\';',
    '/* the club\'s own picks { not a brace that counts */',
    'const PLAN = {',
    '  visby:            { sig: 18, s2: 6, s3: 1 },   // the sea\'s holes',
    '  \'bro-hof-castle\': { sig: 10, s2: 4, s3: 18 }, /* Castle\'s largest sand */',
    '  note: \'a } in a string, and an escaped \\\' too\',',
    '};',
    'export const VIEWS = [',
    '  { id: \'a-h1\', slug: \'a\', hole: 1 },',
    '  { id: \'a-bana\', slug: \'a\', course: true, do: page => page.click(\'#x\') },',
    '];',
    'const browser = await chromium.launch();',
  ].join('\n');
  assert.deepEqual(literalOf(source, 'PLAN'), { visby: { sig: 18, s2: 6, s3: 1 }, 'bro-hof-castle': { sig: 10, s2: 4, s3: 18 }, note: 'a } in a string, and an escaped \' too' });
  assert.deepEqual(literalOf(source, 'VIEWS').map(view => view.id), ['a-h1', 'a-bana']);
  assert.equal(literalOf(source, 'POSTERS'), undefined);
  assert.equal(literalOf('const PLAN = makePlan();', 'PLAN'), undefined, 'not a literal: not guessed at');
});

test('every published ground has a card, whole, and every table that names the ground agrees with it', async () => {
  const grounds = groundCards();
  const published = [...new Set(JSON.parse(fs.readFileSync(new URL('../../apps/golf/public/courses/v2-index.json', import.meta.url), 'utf8')).courses.map(course => course.groundId))].sort();
  assert.deepEqual(grounds, published, 'a ground without a card: ground-card.mjs --ground <id> --derive --write');
  for (const groundId of grounds) {
    const card = loadGroundCard(groundId);
    assert.equal(card.groundId, groundId);
    assert.deepEqual(groundCardErrors(card), [], groundId);
    const rows = await registration(card);
    assert.deepEqual(rows.filter(row => row.state !== 'agrees').map(row => `${row.slug}: ${row.table} ${row.state} in ${row.file}. ${row.detail}`), [],
      `${groundId}: change the card and the table together (ground-card.mjs --ground ${groundId} --rows prints the rows)`);
    assert.ok(rows.length >= 12 * card.routings.length);
  }
});

test('a card derived from the tables is the card, and says what the tables do not hold instead of making it up', async () => {
  const written = loadGroundCard('bro-hof'), derived = await deriveCard('bro-hof', { on: '2026-11-25' });
  assert.match(derived.place.basis, /^Carried over from the app's tables on 2026-11-25; how the position was chosen was not recorded there\.$/);
  assert.match(derived.routings[0].posters.why, /why these holes was not recorded there/);
  const facts = card => { const copy = structuredClone(card); delete copy.place.basis; for (const routing of copy.routings) delete routing.posters.why; return copy; };
  assert.deepEqual(facts(derived), facts(written));
  assert.deepEqual(groundCardErrors(derived), []);
  const nine = await deriveCard('johannesberg');
  assert.deepEqual(nine.routings.map(routing => routing.slug), ['johannesberg', 'johannesberg-9'], 'the host routing first');
  assert.deepEqual(nine.routings[1].gallery, [], 'a routing without a graphics-review view has an empty list, not an invented view');
  await assert.rejects(deriveCard('nowhere'), /no published routing/);
});

test('a card that says something else than a table is caught, table by table', async () => {
  const card = loadGroundCard('bro-hof');
  const off = async change => { const copy = structuredClone(card); change(copy); return (await registration(copy)).filter(row => row.state !== 'agrees').map(row => `${row.slug} ${row.file} ${row.state}`); };
  assert.deepEqual(await off(c => { c.routings[0].tees[2].colour = '#ffd400'; }), ['bro-hof-stadium packages/course-pack/emit-manifest.mjs COURSES differs']);
  assert.deepEqual(await off(c => { c.place.lat = 59.5; }), ['bro-hof-stadium apps/golf/src/shell/course-places.mjs COURSE_LOCATIONS differs']);
  assert.deepEqual(await off(c => { c.routings[1].line = 'En annan rad.'; }), ['bro-hof-castle apps/golf/src/shell/club-search.mjs COURSE_LINES differs']);
  assert.deepEqual(await off(c => { c.routings[1].posters.holes[0] = 11; }), ['bro-hof-castle tools/make-posters.mjs PLAN differs']);
  assert.deepEqual(await off(c => { c.routings[0].posters.framings[3].cam = 'green'; }), ['bro-hof-stadium tools/make-posters.mjs POSTERS differs']);
  assert.deepEqual(await off(c => { c.routings[0].gallery.push({ hole: 9, vy: 'tee', ljus: 'dis' }); }), ['bro-hof-stadium tools/gfx-gallery.mjs GALLERY differs']);
  assert.deepEqual(await off(c => { c.routings[1].mapGallery = [{ hole: 12 }]; }), ['bro-hof-castle tools/map-gallery.mjs VIEWS missing']);
  assert.deepEqual(await off(c => { c.routings[1].signature.description = 'Dammen på hål 18'; }), ['bro-hof-castle apps/golf/src/shell/club-picker.js SIGNATURE_HOLES differs']);
  assert.deepEqual(await off(c => { c.club.id = 'bro'; }), ['bro-hof-stadium apps/golf/src/shell/course-clubs.mjs clubIdFor differs', 'bro-hof-castle apps/golf/src/shell/course-clubs.mjs clubIdFor differs']);
});

test('a new ground\'s card names every table it is missing from, with the row to paste', async () => {
  const card = { schemaVersion: 1, groundId: 'nyby', club: { id: 'nyby', name: 'Nyby Golfklubb' }, boot: 'Nyby · Skog',
    place: { lat: 59.9, lng: 17.1, region: 'Uppland', regionTag: 'Nyby · Skogsbana', city: 'Nyby', iconName: 'tree', basis: 'The clubhouse door on the orthophoto.' },
    search: { category: 'skog', places: 'Uppland Nyby' },
    routings: [{ slug: 'nyby', build: 'nybybuild', name: 'Nyby GK', title: 'Nyby GK i 3D', tees: [{ name: 'Gul', colour: '#f0c93a' }, { name: 'Röd', colour: '#e0574a' }], teesHiddenFrom: 2,
      searchLabel: 'Nyby · Skogsbana', line: 'En skogsbana.', posters: { holes: [7, 3, 18], why: 'The pond on 7.', framings: [1, 2, 3, 4].map(hole => ({ hole, cam: 'orbit', preset: 'golden' })) },
      gallery: [{ hole: 7, vy: 'tee', ljus: 'dag' }], mapGallery: [{ hole: 7 }, { course: true }] }] };
  assert.deepEqual(groundCardErrors(card), []);
  const rows = await registration(card), missing = rows.filter(row => row.state === 'missing').map(row => row.file);
  for (const file of ['packages/course-pack/emit-manifest.mjs COURSES', 'apps/golf/src/shell/course-places.mjs COURSE_LOCATIONS', 'apps/golf/src/shell/club-search.mjs CATEGORIES',
    'apps/golf/src/shell/club-search.mjs COURSE_LINES', 'tools/make-posters.mjs PLAN', 'tools/make-posters.mjs POSTERS', 'tools/gfx-gallery.mjs GALLERY', 'tools/map-gallery.mjs VIEWS',
    'apps/golf/src/engine/scenery/index.js', 'apps/golf/src/engine/v2-frontier-configs.mjs', 'course-workflows/nyby/workflow.json', 'course-workflows/nyby/review.json']) assert.ok(missing.includes(file), file);
  assert.ok(!rows.some(row => row.file.includes('SIGNATURE_HOLES')), 'one routing: no picture to choose between in the club picker');
  const paste = expectedTables(card)[0].paste;
  assert.equal(paste['apps/golf/src/shell/club-search.mjs COURSE_LINES'], 'nyby: \'En skogsbana.\',');
  assert.equal(paste['tools/make-posters.mjs PLAN'], '/* The pond on 7. */\n  nyby: { sig: 7, s2: 3, s3: 18 },');
  assert.match(paste['packages/course-pack/emit-manifest.mjs COURSES'], /cols: \[0xf0c93a, 0xe0574a\], hideFrom: 2 \} \},$/);
  assert.equal(paste['tools/map-gallery.mjs VIEWS'], '{ id: \'nyby-h7\', slug: \'nyby\', hole: 7 },\n  { id: \'nyby-bana\', slug: \'nyby\', course: true },');

  const broken = change => { const copy = structuredClone(card); change(copy); return groundCardErrors(copy).join('\n'); };
  assert.match(broken(c => { c.place.lat = 17.1; c.place.lng = 59.9; }), /lat and lng in Sweden/);
  assert.match(broken(c => { delete c.place.basis; }), /the basis of the position/);
  assert.match(broken(c => { c.routings[0].tees[0].colour = 'yellow'; }), /a #rrggbb colour/);
  assert.match(broken(c => { c.routings[0].teesHiddenFrom = 0; }), /teesHiddenFrom, the number of tees the menu shows/);
  assert.match(broken(c => { c.routings[0].posters.holes = [7, 3]; }), /signature hole, then two more/);
  assert.match(broken(c => { c.routings.push({ ...c.routings[0], slug: 'nyby-9' }); }), /several routings needs each one's tag and layoutLabel/);
  assert.match(broken(c => { c.routings.push({ ...c.routings[0] }); }), /a slug of its own/);
  assert.deepEqual(groundCardErrors({ groundId: 'nyby' }), ['not a ground card (schemaVersion 1 and a groundId)']);
});
