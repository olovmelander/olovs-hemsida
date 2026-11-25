/* Real Web Locks and localStorage shared by two tabs, without starting either 3D renderer.
   node tools/check-play-concurrency.mjs http://127.0.0.1:8787/ */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { addStroke, createRound } from '../apps/golf/src/play/play-rules.mjs';

const base = new URL((process.argv[2] || 'http://127.0.0.1:5173').replace(/\/?$/, '/'));
const harness = new URL('__simulator_persistence__/', base);
const source = new URL('../apps/golf/src/', import.meta.url);
const position = { phase: 'address', ball: [24, 38] };

function roundAt(slug, id, strokes) {
  const round = createRound({ slug, courseName: slug, holes: [{ n: 1, par: 4 }], now: id });
  for (let i = 0; i < strokes; i++) {
    addStroke(round, { club: 'iron-7', from: [i, 0], to: [i + 1, 0], lie: 'fairway', result: 'fairway', distance: 1 });
  }
  return round;
}

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  // Serve unchanged production modules to this browser context only. The release
  // needs no test route, public JS exports or assumptions about hashed chunk names.
  await context.route(harness.href + '**', async route => {
    const path = new URL(route.request().url()).pathname.slice(harness.pathname.length);
    if (!/^[\w/-]+\.mjs$/.test(path)) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL(path, source)) });
  });
  const tabs = await Promise.all([context.newPage(), context.newPage()]);
  for (const tab of tabs) {
    // Use a static document from the running app so its actual origin controls
    // storage, secure-context checks and the cross-tab lock manager.
    const response = await tab.goto(new URL('integritet.html', base).href);
    assert.ok(response?.ok(), 'the app must serve a same-origin document');
    await tab.evaluate(async modules => {
      const { PLAY_WRITE_LOCK, createPlayPersistence } = await import(modules + 'play/play-persistence.mjs');
      const { readPlayCheckpoint, readPlayedRounds } = await import(modules + 'play/play-rules.mjs');
      if (!navigator.locks) throw new Error('Web Locks require a secure context or localhost.');
      window.writeLock = PLAY_WRITE_LOCK;
      window.runWrite = ({ action, revision, round, position }) => {
        const persistence = createPlayPersistence({ revision });
        return action === 'save' ? persistence.save(round, position) : persistence.finish(round, position);
      };
      window.inspectRound = slug => ({ checkpoint: readPlayCheckpoint(localStorage, slug), history: readPlayedRounds(localStorage) });
    }, harness.href);
  }
  const [first, second] = tabs;
  const inspect = (tab, slug) => tab.evaluate(slug => window.inspectRound(slug), slug);
  const command = (action, round, revision) => ({ action, round, revision, position });
  async function seed(tab, round) {
    assert.equal(await tab.evaluate(request => window.runWrite(request), command('save', round, null)), 'saved');
    const { checkpoint } = await inspect(tab, round.slug);
    assert.ok(checkpoint?.revision);
    return checkpoint.revision;
  }

  // Hold the production lock while both real operations are submitted. Observing
  // both pending requests makes this deterministic even when Chromium schedules
  // the tabs serially or the two writes would usually complete milliseconds apart.
  async function overlap(requests) {
    await first.evaluate(() => new Promise((held, reject) => {
      navigator.locks.request(window.writeLock, () => new Promise(release => {
        window.releaseWriteLock = release;
        held();
      })).catch(reject);
    }));
    try {
      for (const [i, request] of requests.entries()) {
        await tabs[i].evaluate(request => { window.pendingWrite = window.runWrite(request); }, request);
        await first.waitForFunction(async count => {
          const { pending } = await navigator.locks.query();
          return pending.filter(lock => lock.name === window.writeLock && lock.mode === 'exclusive').length === count;
        }, i + 1, { polling: 20, timeout: 5000 });
      }
    } finally {
      await first.evaluate(() => window.releaseWriteLock());
    }
    return Promise.all(tabs.map(tab => tab.evaluate(() => window.pendingWrite)));
  }

  const one = roundAt('angso', 100, 1);
  const revision = await seed(first, one);
  const advanced = roundAt(one.slug, one.id, 2);
  assert.deepEqual(await overlap([command('save', advanced, revision), command('finish', one, revision)]), ['saved', 'conflict']);
  const playable = await inspect(second, one.slug);
  assert.equal(playable.checkpoint.round.holes[1].strokes, 2);
  assert.notEqual(playable.checkpoint.revision, revision);
  assert.equal(playable.history.filter(r => r.endedAt != null).length, 0);

  const next = playable.checkpoint.revision;
  const late = roundAt(one.slug, one.id, 3);
  assert.deepEqual(await overlap([command('finish', advanced, next), command('save', late, next)]), ['finished', 'conflict']);
  const finished = await inspect(second, one.slug);
  assert.equal(finished.checkpoint, null);
  assert.equal(finished.history.length, 1);
  assert.ok(finished.history[0].endedAt != null);
  assert.equal(finished.history[0].holes[1].strokes, 2);
  console.log('Same round · save-first retains the new lie, finish-first prevents a stale save from reopening its scorecard.');

  // Numeric round IDs can coincide at different layouts. Both finishes modify
  // the same archive key and must preserve one another AND the earlier round.
  const expected = [['angso', one.id, 2]];
  for (let attempt = 0; attempt < 12; attempt++) {
    const id = 101 + attempt;
    const castle = roundAt('bro-hof-castle', id, 4), stadium = roundAt('bro-hof-stadium', id, 5);
    const castleRevision = await seed(first, castle);
    const stadiumRevision = await seed(second, stadium);
    assert.deepEqual(await overlap([command('finish', castle, castleRevision), command('finish', stadium, stadiumRevision)]),
      ['finished', 'finished']);
    expected.push([castle.slug, id, 4], [stadium.slug, id, 5]);
    for (const [i, layout] of [castle, stadium].entries()) {
      // Cross-tab storage events are asynchronous. Verify the eventual reads
      // from both renderers, including all preceding independent archives.
      const tab = tabs[i];
      await tab.waitForFunction(({ slug, length }) => {
        const { checkpoint, history } = window.inspectRound(slug);
        return !checkpoint && history.length >= length;
      }, { slug: layout.slug, length: expected.length }, { polling: 30, timeout: 3000 }).catch(async error => {
        const history = (await inspect(tab, layout.slug)).history.map(r => [r.slug, r.id]);
        throw new Error(`Missing archive after simultaneous finishes at round ${id}: ${JSON.stringify(history)}`, { cause: error });
      });
      const { history } = await inspect(tab, layout.slug);
      assert.deepEqual(history.map(r => [r.slug, r.id, r.holes[1].strokes]).sort(), [...expected].sort());
      assert.ok(history.every(r => r.endedAt != null));
    }
  }
  console.log('Independent rounds · both Bro Hof archives survive overlapping finishes, with their original scores.');
} finally {
  await browser.close();
}
