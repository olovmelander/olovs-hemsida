import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocks, catalogueTable, groundFacts, merge, pictureList, picturePlan, practiceView, scaffold } from './course-walkthrough.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('a refresh replaces the generated parts and keeps every hand-written line', () => {
  const page = 'intro\n<!-- generated:summary -->\nold\n<!-- /generated:summary -->\nby hand $1 $&\n<!-- generated:holes -->\n<!-- /generated:holes -->\nend\n';
  const next = merge(page, new Map([['summary', 'new $& numbers'], ['holes', 'rows']]));
  assert.equal(next, 'intro\n<!-- generated:summary -->\nnew $& numbers\n<!-- /generated:summary -->\nby hand $1 $&\n<!-- generated:holes -->\nrows\n<!-- /generated:holes -->\nend\n');
  assert.equal(merge(next, new Map([['summary', 'new $& numbers'], ['holes', 'rows']])), next);
  assert.throws(() => merge('no markers', new Map([['summary', 'x']])), /no generated:summary part/);
});

test('a new walkthrough has every generated part and a prompt for each part only a person can write', () => {
  const facts = groundFacts('ribbingsfors'), page = scaffold(facts);
  assert.equal(merge(page, blocks(facts)), page);
  assert.equal(page.match(/_To write:/g).length, 6);
  for (const heading of ['## What is there', '## What is known not to be right', '## Hole by hole', '## How each fault was found', '## Checking it yourself']) assert.ok(page.includes(heading), heading);
  assert.equal(page.match(/^\| \d+ \|/gm).length, 9); // one row a hole
});

test('every walkthrough is current with the records it is written from, and has no prompt left', () => {
  const pages = fs.readdirSync(path.join(ROOT, 'docs/courses')).filter(name => name.endsWith('-walkthrough.md'));
  assert.ok(pages.includes('bro-hof-walkthrough.md'));
  for (const name of pages) {
    const groundId = name.replace(/-walkthrough\.md$/, ''), page = read(`docs/courses/${name}`);
    assert.equal(merge(page, blocks(groundFacts(groundId))), page, `${name} is stale: run node tools/course-walkthrough.mjs --ground ${groundId}`);
    assert.ok(!page.includes('_To write:'), `${name} still has a part to write`);
  }
});

test('the status of every ground in pipeline v2 is current', () => {
  const page = read('docs/pipeline-v2.md');
  assert.equal(merge(page, new Map([['catalogue', catalogueTable()]])), page, 'run node tools/course-walkthrough.mjs --catalogue');
});

test('the first pictures show each routing its first tee, last green, water, short holes and what is flagged', () => {
  const facts = groundFacts('bro-hof'), views = pictureList(facts);
  for (const routing of facts.routings) {
    const own = views.filter(view => view.slug === routing.slug);
    assert.ok(own.some(view => view.hole === 1 && view.vy === 'tee') && own.some(view => view.hole === routing.holes.length && view.vy === 'green'));
    assert.ok(own.some(view => /water/.test(view.why)) && own.some(view => /short hole/.test(view.why)));
    for (const hole of routing.holes.filter(h => h.flags.length).slice(0, 4)) assert.ok(own.some(view => view.hole === hole.n && /flagged/.test(view.why)), `hole ${hole.n}`);
  }
  assert.ok(views.some(view => /waste sand/.test(view.why)));
  assert.equal(new Set(views.map(view => `${view.slug}:${view.hole}:${view.vy}`)).size, views.length);
});

test('the first pictures include the practice ground, which no hole\'s view shows', () => {
  const square = (x, z, size) => [[x, z], [x + size, z], [x + size, z + size], [x, z + size]];
  assert.deepEqual(practiceView({ scenery: { range: [square(-300, -500, 200)], practiceGreens: [square(-20, -370, 20), square(40, -340, 15)] } }),
    { ranges: 1, greens: 2, setView: 'V3D.setView(-122, 284, -187, -122, 0, -400)' }, 'above its middle, from the south: north is -z');
  assert.equal(practiceView({ scenery: { range: [], practiceGreens: [] } }), null);
  assert.equal(practiceView({}), null);
  const plan = picturePlan(groundFacts('tjusta'));
  assert.match(plan, /# 5\. The practice ground\./);
  assert.match(plan, /\?bana=tjusta&hal=1 {3}V3D\.setView\(-?\d+, \d+, -?\d+, -?\d+, 0, -?\d+\) {3}\/\/ 1 range, 5 practice greens/);
});
