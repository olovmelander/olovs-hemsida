/* Run against the golf Vite dev server for deterministic penalty and practice
   cases. The real golfer, swing animation, physics, scoring, HUD and storage run
   on a flat test hole. Only terrain and the outer rendering loop are fixtures.
   node tools/check-play-lies.mjs http://127.0.0.1:5173 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserExecutable } from './browser-args.mjs';

const base = process.argv[2] || 'http://127.0.0.1:5173';
const key = 'banvy-play-checkpoint-v1:test';
const testUrl = new URL('/test-lie?spela=1', base);
const browser = await chromium.launch({ ...browserExecutable(), args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce' });
  await page.route('**/test-lie*', route => route.fulfill({ contentType: 'text/html',
    body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><canvas></canvas>' }));
  const open = async intent => {
    testUrl.searchParams.set('sim', intent);
    await page.goto(testUrl.href);
    await page.evaluate(async () => {
      const { mountPlay } = await import('/src/play/play-mode.mjs');
      const THREE = await import('/node_modules/three/build/three.webgpu.js');
      const holes = [{ n: 1, par: 4, name: 'Testhålet', pin: [0, 300], line: [[0, 0], [0, 300]], t: [300], tees: { marks: [{ c: [0, 0] }] } }];
      const lieAt = (_x, z) => window.testHazard === 'water' && z > 8 ? 'vatten' : z > 287 ? 'green' : 'fairway';
      window.game = await mountPlay({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
        controls: { target: new THREE.Vector3() }, renderer: { domElement: document.querySelector('canvas') },
        slug: 'test', courseName: 'Testbanan', holes, hole: () => 1, tee: () => 0,
        wind: () => ({ x: 0, z: 0 }), releaseCamera() {},
        bag: () => [{ id: 'driver', name: 'Driver', carry: 210 }, { id: 'wedge-pw', name: 'PW', carry: 90 }],
        trees: () => ({ lists: [], species: [] }), boundaries: () => [], cups: () => [],
        heightAt: () => 0, lieAt, classify: (_x, z) => ({ inBounds: window.testHazard !== 'out' || z <= 8, fringe: 0, green: 0 }),
      });
    });
  };
  const state = () => page.evaluate(() => {
    const { ball, lie, club, yaw, targetDist, setup, quality, strokes, hole, round, practice } = game.state();
    return { ball, lie, club, yaw, targetDist, setup, quality, strokes, id: round.id, card: round.holes[hole], attempts: practice?.attempts };
  });
  const stroke = async () => {
    await page.evaluate(() => {
      game.swing({ power: .65, face: 0, path: 0 });
      for (let frame = 0; frame < 3200 && game.state().state !== 'address'; frame++) game.update(1 / 45);
    });
    await page.waitForFunction(() => game.state().state === 'address');
  };
  const stored = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);

  await open('ny');
  for (const hazard of ['water', 'out']) {
    const prior = await state();
    await page.evaluate(h => { window.testHazard = h; }, hazard);
    await stroke();
    const landed = await state();
    assert.equal(landed.strokes, prior.strokes + 2);
    assert.equal(landed.card.penalties, prior.card.penalties + 1);
    if (hazard === 'out') assert.deepEqual(landed.ball, prior.ball);
    else { assert.notDeepEqual(landed.ball, prior.ball); assert.ok(landed.ball[2] <= 8); }
    await open('fortsatt'); assert.deepEqual(await state(), landed);
  }
  // Seed the same scored round's approach or putting lie, then use its public
  // resume and practice entry points; a practice swing must never advance it.
  for (const [z, expectedLie] of [[248, 'fairway'], [295, 'green']]) {
    const checkpoint = await stored();
    checkpoint.position = { phase: 'address', ball: [0, z] };
    await page.goto(new URL('/test-lie', base).href);
    await page.evaluate(({ key, checkpoint }) => localStorage.setItem(key, JSON.stringify(checkpoint)), { key, checkpoint });
    await open('traning');
    const prior = await state();
    assert.equal(prior.lie, expectedLie);
    await stroke();
    assert.deepEqual(await state(), { ...prior, attempts: 1 });
    assert.deepEqual(await stored(), checkpoint);
    await page.getByRole('button', { name: 'Till rundan', exact: true }).tap();
    assert.deepEqual(await state(), { ...prior, attempts: undefined });
  }
  await page.evaluate(key => {
    window.dispatchEvent(new CustomEvent('banvy-account-changed', { detail: { previousUserId: null, userId: 'returning', cacheReplaced: true } }));
    localStorage.removeItem(key); window.dispatchEvent(new Event('pagehide'));
  }, key);
  assert.equal(await stored(), null);
  await open('traning'); await stroke();
  await page.route(new URL('/', base).href, route => route.fulfill({ body: 'Spela', contentType: 'text/html' }));
  await page.getByRole('button', { name: 'Avsluta träningen' }).tap();
  await page.waitForURL('**/#spela');
  assert.equal(await stored(), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('banvy-play-rounds-v1')), null);
  console.log('Water and OB relief, resume, repeated approach and putt, standalone practice and account replacement passed.');
} finally { await browser.close(); }
