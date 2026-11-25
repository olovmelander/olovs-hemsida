/* The species steps of the tree pipeline: pins, the truth, and the scoring of type and species rules. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { surfacePins } from './surface-models.mjs';
import { balanced, bestThreshold, evaluateTypes, matchOneToOne } from './type-evaluation.mjs';
import { SPECIES, speciesTruth, typeOf } from './species-check-page.mjs';
import { DRAWN_AS, evaluateSpecies } from './species-evaluation.mjs';
import { SUBTYPE_PUBLICATION } from './subtype.mjs';

test('surface-model items are pinned newest flight first, with their size and checksum', () => {
  const item = (id, year, day) => ({ id, properties: { flygar: year, datetime: `${day}T00:00:00Z`, insamlingsomrade: `${year}_O2`, upplosning: 0.25 },
    assets: { data: { href: `https://dl1.lantmateriet.se/hojd/data/grid/yhm/${year}_o2/y${id}_dsm.tif`, 'file:size': 100, 'file:checksum': `1220${'ab'.repeat(32)}` } } });
  const pins = surfacePins('demo', [item('2021_o2-1', 2021, '2021-04-16'), item('2025_o2-1', 2025, '2025-06-14'), item('2019_o2-1', 2019, '2019-07-19')], [17, 59, 18, 60], '2026-11-25');
  assert.deepEqual(pins.years, [2025, 2021, 2019]);
  assert.deepEqual(pins.items.map(i => [i.id, i.year, i.sha256]), [['2025_o2-1', 2025, 'ab'.repeat(32)], ['2021_o2-1', 2021, 'ab'.repeat(32)], ['2019_o2-1', 2019, 'ab'.repeat(32)]]);
  assert.equal(pins.collection, 'dsm-cog');
  assert.match(pins.allowedBy, /owner, 25 November 2026/);
});

test('conifer or broadleaf is scored on calibration and reported on evaluation, a crown not placed counting as unknown', () => {
  assert.deepEqual(matchOneToOne([{ easting: 0, northing: 0 }, { easting: 3, northing: 0 }], [{ easting: 2.5, northing: 0 }, { easting: 20, northing: 0 }]).map(p => p.d), [0.5]);
  const rows = [{ truth: 'conifer' }, { truth: 'conifer' }, { truth: 'broadleaf' }, { truth: 'broadleaf' }];
  assert.equal(balanced(rows, () => 'conifer').balanced, 0.5);
  assert.equal(balanced(rows, row => row.truth).balanced, 1);
  assert.equal(balanced(rows, () => 'unknown').unknownCalls, 4);
  const fit = bestThreshold([{ truth: 'conifer', x: 0.9 }, { truth: 'conifer', x: 0.8 }, { truth: 'broadleaf', x: 0.3 }, { truth: 'broadleaf', x: 0.2 }], 'x');
  assert.ok(fit.t > 0.3 && fit.t < 0.8 && fit.score === 1);
  const ref = (id, role, type, share, e) => ({ id, role, type, heightMetres: 12, leaflessShare: share, fillLeafy: 0.6, easting: e, northing: 0 });
  const reference = [ref('a', 'calibration', 'conifer', 0.95, 0), ref('b', 'calibration', 'broadleaf', 0.2, 10), ref('c', 'evaluation', 'conifer', 0.9, 20), ref('d', 'evaluation', 'broadleaf', 0.3, 30),
    ref('e', 'evaluation', 'broadleaf', 0.25, 40)];
  const placed = [{ easting: 0, northing: 0, type: 'conifer' }, { easting: 10, northing: 0, type: 'conifer' }, { easting: 20, northing: 0, type: 'conifer' }, { easting: 30, northing: 0, type: 'unknown' }];
  const result = evaluateTypes({ reference, placed });
  const by = Object.fromEntries(result.rules.map(r => [r.name, r.evaluation]));
  assert.equal(by['in use'].broadleafRecall, 0, 'one broadleaf called unknown, the other not placed');
  assert.equal(by['photo surfaces'].balanced, 1);
  assert.equal(by['in use, surfaces where it is unknown'].broadleafRecall, 1);
});

test('the species truth takes the owner\'s word over the agent\'s, and says whose each is', () => {
  assert.deepEqual(['pine', 'larch', 'oak', 'other-broadleaf', 'unknown'].map(typeOf), ['conifer', 'conifer', 'broadleaf', 'broadleaf', 'unknown']);
  assert.ok(SPECIES.includes('alder') && SPECIES.includes('unknown'));
  const sample = { groundId: 'demo', sample: [{ sampleId: 'S001', treeId: 't1', role: 'calibration' }, { sampleId: 'S002', treeId: 't2', role: 'evaluation' }, { sampleId: 'S003', treeId: 't3', role: 'evaluation' }] };
  const agent = { reviewer: 'agent', labels: { S001: { species: 'pine', confidence: 'high', reason: 'flat crown' }, S002: { species: 'birch', confidence: 'low', reason: 'fine crown' } } };
  const owner = { reviewer: 'Owner', savedAt: '2026-11-26T10:00:00Z', labels: { S002: { species: 'alder', note: 'by the pond' } } };
  const truth = speciesTruth(sample, owner, agent);
  assert.deepEqual(truth.trees.map(t => [t.sampleId, t.species, t.type, t.source]), [['S001', 'pine', 'conifer', 'agent'], ['S002', 'alder', 'broadleaf', 'owner'], ['S003', 'unknown', 'unknown', null]]);
  assert.deepEqual(truth.agreement, { trees: 1, sameSpecies: 0 });
  assert.throws(() => speciesTruth(sample, { labels: { S001: { species: 'palm' } } }, null), /not a species the check offers/);
});

test('pine or spruce must pass the pipeline\'s publication gate on evaluation trees; broadleaves are scored as the app can draw them', () => {
  const trees = [], evidence = [];
  const add = (id, role, species, e) => { trees.push({ sampleId: id, treeId: id, role, species, type: typeOf(species), source: 'agent' }); evidence.push({ id, type: typeOf(species), objectHeightMetres: '15', radiusMetres: '3', ...e }); };
  for (let i = 0; i < 40; i += 1) {
    const role = i % 2 ? 'evaluation' : 'calibration';
    add(`p${i}`, role, 'pine', { spire: '0.05', nmd_tall: '70', nmd_gran: '30', leaflessShare: '0.95', fillLeafy: '0.7', waterMetres: '80' });
    add(`s${i}`, role, 'spruce', { spire: '0.25', nmd_tall: '20', nmd_gran: '80', leaflessShare: '0.95', fillLeafy: '0.7', waterMetres: '80' });
  }
  for (let i = 0; i < 20; i += 1) {
    const role = i % 2 ? 'evaluation' : 'calibration';
    add(`a${i}`, role, 'alder', { leaflessShare: '0.3', fillLeafy: '0.7', waterMetres: '4', radiusMetres: '3' });
    add(`o${i}`, role, 'oak', { leaflessShare: '0.3', fillLeafy: '0.7', waterMetres: '90', radiusMetres: '7' });
    add(`b${i}`, role, 'birch', { leaflessShare: '0.3', fillLeafy: '0.7', waterMetres: '90', radiusMetres: '3' });
  }
  const result = evaluateSpecies({ truth: { trees }, evidence, typeThreshold: 0.6, mix: { birch: 0.32, alder: 0.13, oak: 0.55 } });
  assert.equal(result.pineOrSpruce.trees.evaluation, 40);
  assert.ok(result.pineOrSpruce.chosen.evaluation.accuracy === 1 && result.pineOrSpruce.publish, 'a clean separation passes');
  assert.ok(SUBTYPE_PUBLICATION.minimumHeldOut >= 30);
  const blr = result.whichBroadleaf;
  assert.equal(blr.context.evaluation.accuracy, 1);
  assert.ok(Math.abs(blr.statedMixExpectedAccuracy.evaluation - (0.32 + 0.13 + 0.55) / 3) < 1e-9);
  assert.equal(result.coniferOrBroadleaf.find(r => r.name === 'photo surfaces').evaluation.balanced, 1);
  assert.equal(DRAWN_AS.maple, 'oak');
  assert.equal(DRAWN_AS['other-broadleaf'], null, 'a broadleaf nobody could name is not scored as one the app draws');
});
