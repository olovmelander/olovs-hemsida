import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuPassPlan } from './gpu-pass.mjs';

const ids = plan => plan.map(s => s.id);

test('the app is rebuilt between bakes, and the checks read the last build', () => {
  const plan = gpuPassPlan();
  assert.deepEqual(ids(plan).slice(0, 7), ['build', 'water', 'build', 'tints', 'build', 'vista', 'build']);
  for (const step of plan) if (step.serves) assert(step.command.some(a => a.includes('127.0.0.1')), step.id);
  assert(plan.slice(0, 7).every(s => s.bake) && !plan.slice(7).some(s => s.bake), 'only a bake stops the run');
});

test('a late start still builds first, and a filter keeps the order', () => {
  assert.deepEqual(ids(gpuPassPlan({ from: 'vista' })).slice(0, 3), ['build', 'vista', 'build']);
  assert.deepEqual(ids(gpuPassPlan({ from: 'prepared' })).slice(0, 2), ['build', 'prepared']);
  assert.deepEqual(ids(gpuPassPlan({ steps: ['boot-lo', 'water'] })), ['water', 'boot-lo']);
  assert.throws(() => gpuPassPlan({ from: 'nothing' }), /no step/);
});

test('one course narrows the bakes and the boots', () => {
  const plan = gpuPassPlan({ only: ['bro-hof-castle'] });
  for (const id of ['water', 'tints', 'vista', 'boot-hi']) assert(plan.find(s => s.id === id).command.includes('bro-hof-castle'), id);
});
