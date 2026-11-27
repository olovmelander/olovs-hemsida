/* Ängsö's tee decisions (27 November 2026): the file is what its maker writes from the model, every decided
   colour stands on the deck or fairway it names, and a decision that leaves its surface or gives no reason is
   refused. Reads only committed files, so CI can run it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyTeeDecisions } from './reviewed-orthophoto.mjs';
import { makeDecisions } from './make-tee-decisions.mjs';

const read = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
const model = read('../course-model.json');
const decisions = read('./tee-decisions.json');

test('the decision file is what make-tee-decisions.mjs writes from the model', () => {
  assert.equal(`${JSON.stringify(makeDecisions(model).decisions, null, 1)}\n`, fs.readFileSync(new URL('./tee-decisions.json', import.meta.url), 'utf8'));
});

test('every decided colour is in the model where its decision puts it, on the deck or fairway it names', () => {
  const names = model.card.teeNames;
  for (const d of decisions.marks) {
    const hole = model.holes.find(h => h.n === d.hole), mark = hole.tees.marks[names.indexOf(d.tee)];
    assert.equal(mark.orthophotoReference.decision?.file, 'angsobuild/mapping/tee-decisions.json', `H${d.hole} ${d.tee}`);
    assert.equal(mark.referenceSurfaceKind, d.surface, `H${d.hole} ${d.tee}`);
    assert.equal(mark.sourcePadId ?? null, d.deck, `H${d.hole} ${d.tee}`);
  }
  // hole 1's white tee is the new back deck, and the hole's line starts there
  const one = model.holes.find(h => h.n === 1);
  assert.equal(one.tees.marks[0].sourcePadId, 'lm-angso-01-physical-tee-01');
  assert.deepEqual(one.line[0], one.tees.marks[0].c);
});

test('a decision that leaves its deck, names an unknown tee or gives no reason is refused', () => {
  const base = structuredClone(model);
  const first = decisions.marks.find(d => d.surface === 'platform');
  const refuse = change => {
    const copy = structuredClone(decisions);
    change(copy.marks.find(d => d.hole === first.hole && d.tee === first.tee), copy);
    assert.throws(() => applyTeeDecisions(base, copy));
  };
  refuse(d => { d.at = [d.at[0] + 40, d.at[1]]; });
  refuse(d => { d.deck = 'no-such-deck'; });
  refuse(d => { d.tee = 'Svart'; });
  refuse(d => { d.why = 'card'; });
  refuse(d => { d.confidence = 'certain'; });
  refuse((d, copy) => { copy.marks.push({ ...d }); });
});
