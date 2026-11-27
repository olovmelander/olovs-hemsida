import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyCard, deriveCard, expectedTables, groundCardErrors, groundCards, hasRow, literalOf, loadGroundCard, registration, withRow } from './ground-card.mjs';

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
  assert.deepEqual(published.filter(groundId => !grounds.includes(groundId)), [], 'a ground without a card: ground-card.mjs --ground <id> --derive --write');
  for (const groundId of grounds) {
    const card = loadGroundCard(groundId);
    assert.equal(card.groundId, groundId);
    assert.deepEqual(groundCardErrors(card), [], groundId);
    // A ground being built writes its card at stage 0 and joins the tables at stage 5 (pipeline-v2.md): until it is
    // published its card must be whole, and the tables are not asked to name it yet.
    if (!published.includes(groundId)) continue;
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

test('a row is added at the end of a table, and only where the ground has none', () => {
  const source = ['const PLAN = {', '  visby: { sig: 18 },   // the sea\'s holes', '};', 'export const VIEWS = [', '  { id: \'a-h1\', slug: \'a\', hole: 1 },', '];', 'const LAST = { a: 1 };', ''].join('\n');
  assert.ok(hasRow(source, 'PLAN', 'visby') && !hasRow(source, 'PLAN', 'nyby') && hasRow(source, 'VIEWS', 'a') && !hasRow(source, 'VIEWS', 'nyby'));
  const plan = withRow(source, 'PLAN', '/* The pond on 7. */\n  nyby: { sig: 7 },');
  assert.deepEqual(literalOf(plan, 'PLAN'), { visby: { sig: 18 }, nyby: { sig: 7 } });
  assert.equal(plan.replace('  /* The pond on 7. */\n  nyby: { sig: 7 },\n', ''), source, 'nothing else in the file moves');
  assert.deepEqual(literalOf(withRow(plan, 'VIEWS', '{ id: \'nyby-h7\', slug: \'nyby\', hole: 7 },'), 'VIEWS').map(view => view.slug), ['a', 'nyby']);
  assert.throws(() => withRow(source, 'LAST', 'b: 2,'), /closing bracket does not stand on a line of its own/);
  assert.throws(() => withRow(source.replace('{ sig: 18 },', '{ sig: 18 }'), 'PLAN', 'nyby: { sig: 7 },'), /no longer reads .*does its last row end in a comma/);
  assert.throws(() => withRow(source, 'POSTERS', 'nyby: [],'), /no table POSTERS/);
  assert.throws(() => hasRow(source, 'POSTERS', 'nyby'), /no table POSTERS/);
});

test('a new ground\'s rows are written into every table from its card, and a ground that has its rows is left alone', () => {
  const root = new URL('../../', import.meta.url);
  const read = file => { try { return fs.readFileSync(new URL(file, root), 'utf8'); } catch { return null; } };
  for (const groundId of groundCards()) assert.deepEqual(applyCard(loadGroundCard(groundId), read).edits, [], `${groundId} has every row already: nothing is added twice`);

  const card = { schemaVersion: 1, groundId: 'nyby', club: { id: 'nyby', name: 'Nyby Golfklubb' }, boot: 'Nyby · Skog',
    place: { lat: 59.9, lng: 17.1, region: 'Uppland', regionTag: 'Nyby · Skogsbana', city: 'Nyby', iconName: 'tree', basis: 'The clubhouse door on the orthophoto.' },
    search: { category: 'skog', places: 'Uppland Nyby' },
    routings: [
      { slug: 'nyby', build: 'nybybuild', name: 'Nyby GK', title: 'Nyby GK i 3D', tag: 'Stora', layoutLabel: 'Stora banan', tees: [{ name: 'Gul', colour: '#f0c93a' }, { name: 'Röd', colour: '#e0574a' }], teesHiddenFrom: 2,
        searchLabel: 'Nyby · Skogsbana', line: 'En skogsbana, och ett \'citat\'.', signature: { poster: 1, description: 'Dammen på hål 7' },
        posters: { holes: [7, 3, 18], why: 'The pond on 7.', framings: [1, 2, 3, 4].map(hole => ({ hole, cam: 'orbit', preset: 'golden' })) },
        gallery: [{ hole: 7, vy: 'tee', ljus: 'dag' }], mapGallery: [{ hole: 7 }, { course: true }] },
      { slug: 'nyby-9', build: 'nyby9build', name: 'Korthålsbanan', title: 'Nyby GK — Korthålsbanan', tag: 'Nio', layoutLabel: 'Korthålsbanan', tees: [{ name: 'Röd', colour: '#e0574a' }], teesHiddenFrom: 1,
        searchLabel: 'Nyby · Nio hål', line: 'Nio korta.', posters: { holes: [2, 5, 9], why: 'The only water.', framings: [1, 2, 3, 4].map(hole => ({ hole, cam: 'top', preset: 'noon' })) },
        gallery: [], mapGallery: [{ course: true }] }] };
  assert.deepEqual(groundCardErrors(card), []);
  // the scenery registry imports the ground's module: until that file is written its row waits, and nothing else does
  const early = applyCard(card, read);
  assert.deepEqual(early.waiting.map(row => `${row.slug} ${row.table}: ${row.why}`), ['nyby REGISTRY: write apps/golf/src/engine/scenery/nyby.js first', 'nyby-9 REGISTRY: write apps/golf/src/engine/scenery/nyby.js first']);
  assert.ok(!early.files.has('apps/golf/src/engine/scenery/index.js') && early.files.has('packages/course-pack/emit-manifest.mjs'));
  const written = file => (file === 'apps/golf/src/engine/scenery/nyby.js' ? 'export const houseKit = true;\n' : read(file));
  const { edits, files, waiting } = applyCard(card, written), want = expectedTables(card);
  assert.deepEqual(waiting, []);
  const added = (file, table) => edits.filter(edit => edit.file === file && edit.table === table).map(edit => edit.slug);
  const table = (file, name) => literalOf(files.get(file), name);
  assert.deepEqual(added('packages/course-pack/emit-manifest.mjs', 'COURSES'), ['nyby', 'nyby-9']);
  for (const [i, slug] of ['nyby', 'nyby-9'].entries()) {
    assert.deepEqual(table('packages/course-pack/emit-manifest.mjs', 'COURSES').find(row => row.slug === slug), want[i].catalogue);
    assert.deepEqual(table('apps/golf/src/shell/club-search.mjs', 'CATEGORIES')[slug], want[i].category);
    assert.equal(table('apps/golf/src/shell/club-search.mjs', 'COURSE_LINES')[slug], want[i].line);
    assert.deepEqual(table('tools/make-posters.mjs', 'PLAN')[slug], want[i].plan);
    assert.deepEqual(table('tools/make-posters.mjs', 'POSTERS')[slug], want[i].framings);
    assert.deepEqual(table('tools/map-gallery.mjs', 'VIEWS').filter(view => view.slug === slug).map(({ id, slug: s, hole, course }) => JSON.parse(JSON.stringify({ id, slug: s, hole, course }))), want[i].mapGallery);
    assert.equal(typeof table('apps/golf/src/engine/scenery/index.js', 'REGISTRY')[slug], 'function');
  }
  assert.deepEqual(table('apps/golf/src/shell/course-places.mjs', 'COURSE_LOCATIONS').nyby, want[0].location, 'the host routing has the place');
  assert.equal(table('apps/golf/src/shell/course-places.mjs', 'HOST_CLUB')['nyby-9'], 'nyby', 'the second routing has its host');
  assert.deepEqual(added('apps/golf/src/shell/course-clubs.mjs', 'LAYOUT_LABELS'), ['nyby'], 'a layout whose label is its name needs no row');
  assert.deepEqual(table('apps/golf/src/shell/club-picker.js', 'SIGNATURE_HOLES').nyby, want[0].signature);
  assert.deepEqual(added('tools/gfx-gallery.mjs', 'GALLERY'), ['nyby'], 'a routing without a graphics-review view adds none');
  assert.deepEqual(table('tools/gfx-gallery.mjs', 'GALLERY').filter(view => view.slug === 'nyby'), want[0].gallery);
  assert.ok(!files.has('package.json'), 'its builds have no tests yet: the suite is not touched');

  // lines are added and nothing else: every line that was there is still there, in its order; a second pass adds nothing
  for (const [file, text] of files) {
    const before = read(file).split('\n'), after = text.split('\n');
    assert.ok(after.length > before.length, file);
    let at = 0;
    for (const line of after) if (line === before[at]) at++;
    assert.equal(at, before.length, `${file}: a line that was there is gone or changed`);
  }
  assert.deepEqual(applyCard(card, file => files.get(file) ?? written(file)).edits, []);

  // a build's own tests join the suite at its end
  const withTests = file => (file === 'nybybuild/course.node-test.mjs' ? '// tests\n' : read(file));
  const suite = JSON.parse(applyCard(card, withTests).files.get('package.json')).scripts.test;
  assert.ok(suite.endsWith(' nybybuild/course.node-test.mjs') && suite.startsWith(JSON.parse(read('package.json')).scripts.test));
});
