import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { DEFAULT_PORT, freePort, gpuPassPlan } from './gpu-pass.mjs';

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

test('a pass on its own port tells every step that port, and only that one', () => {
  const plan = gpuPassPlan({ port: 8693 });
  for (const step of plan) if (step.serves) {
    assert(step.command.some(a => a.includes('127.0.0.1:8693')), step.id);
    assert(!step.command.some(a => a.includes('127.0.0.1:8641')), step.id);
  }
});

test('a pass takes the first port nothing holds, so two sessions never share one', async t => {
  assert.equal(await freePort(DEFAULT_PORT, 5, async port => port >= DEFAULT_PORT + 2), DEFAULT_PORT + 2, 'the first two are another session\'s');
  await assert.rejects(freePort(DEFAULT_PORT, 3, async () => false), /no free port from 8641 to 8643/);
  // against a real socket: a port that is held is passed over
  const held = net.createServer();
  const port = await new Promise(resolve => held.listen(0, '127.0.0.1', () => resolve(held.address().port)));
  t.after(() => held.close());
  assert.notEqual(await freePort(port, 20), port);
});
