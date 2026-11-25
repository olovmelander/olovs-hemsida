/* Bro Hof has two independent sessions at different tees on sibling layouts. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createRound, holeCard, savePlayCheckpoint } from '../apps/golf/src/play/play-rules.mjs';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const base = (process.argv[2] || 'http://127.0.0.1:5173').replace(/\/$/, '');
const castle = 'bro-hof-castle', stadium = 'bro-hof-stadium';
const now = Date.now();
const saved = new Map();
saved.set('banvy-map-round-v1:' + castle, JSON.stringify({
  id: 91, begunAt: now - 35000, touchedAt: now, playingHole: 4, scores: { 3: { strokes: 5 } },
}));
saved.set('banvy-map-tee-v1:' + castle, '3');
// A preview at a different hole must never replace the GPS hole being played.
saved.set('banvy-map-hole-v1:' + castle, JSON.stringify({ value: 16, at: now }));
const round = createRound({ slug: stadium, courseName: 'Bro Hof Stadium', tee: 1, startHole: 12,
  holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4 })), now: now - 3000 });
holeCard(round, 12);
assert.ok(savePlayCheckpoint({ getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
  round, { phase: 'address', ball: [35, 42] }));

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  for (const phone of [true, false]) {
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 768 },
      isMobile: phone, hasTouch: phone, reducedMotion: 'reduce', serviceWorkers: 'block' });
    try {
      await context.addInitScript(entries => {
        for (const [key, value] of entries) localStorage.setItem(key, value);
      }, [...saved]);
      const page = await context.newPage();
      // Capture the actual document navigations from both resume actions.
      await page.route(url => url.searchParams.has('bana') && !url.pathname.includes('/courses/'),
        route => route.fulfill({ contentType: 'text/html', body: '<title>Course launch</title>' }));
      for (const selected of ['map', 'play']) {
        await page.goto(base + '/');
        const resumes = page.locator('.home-resume-slot.has-multiple [data-resume]');
        await resumes.first().waitFor();
        assert.deepEqual(await resumes.evaluateAll(nodes => nodes.map(n => n.dataset.resume)),
          phone ? ['map', 'play'] : ['play', 'map']);
        const gps = page.locator('[data-resume="map"]');
        const sim = page.locator('[data-resume="play"]');
        assert.match(await gps.innerText(), /Bro Hof Slott Golf Club · The Castle Course/);
        assert.match(await gps.innerText(), /Hål 4 · Tee Röd/);
        assert.match(await sim.innerText(), /Bro Hof Slott Golf Club · The Stadium Course/);
        assert.match(await sim.innerText(), /Hål 12 · Tee Vit/);
        await (selected === 'map' ? gps : sim).click();
        await page.waitForURL(url => url.searchParams.has('bana'));
        const params = new URL(page.url()).searchParams;
        assert.equal(params.get('bana'), selected === 'map' ? castle : stadium);
        if (selected === 'map') {
          assert.equal(params.get('runda'), 'fortsatt');
          assert.equal(params.get('hal'), null);
        } else {
          assert.equal(params.get('sim'), 'fortsatt');
          assert.equal(params.get('hal'), '12');
          assert.equal(params.get('tee'), '2');
        }
      }
      for (const [route, active, status, position] of [
        ['karta', castle, 'GPS-runda pågår', 'Hål 4 · Tee Röd'],
        ['spela', stadium, 'Simulering pågår', 'Hål 12 · Tee Vit'],
        ['3d', null, null, null],
      ]) {
        await page.goto(base + '/#' + route);
        const card = page.locator('#chooser button[data-club-id="bro-hof"]');
        await card.waitFor();
        if (active) {
          const expected = active === castle ? 'The Castle Course' : 'The Stadium Course';
          assert.ok((await card.locator('.club-state').innerText()).includes([status, expected, position].join(' · ')));
        } else assert.doesNotMatch(await card.innerText(), /(?:GPS-runda|Simulering) pågår/);
        await card.click();
        /* the club page opens on the layout with this mode's game under way, and each
           layout says how it stands in this mode */
        const clubPage = page.locator('#courseSheet[open]');
        await clubPage.waitFor();
        if (active) assert.equal(await clubPage.locator('input[name="cs-layout"]:checked').inputValue(), active);
        for (const slug of [castle, stadium]) {
          const words = await clubPage.locator(`label.cs-layout:has(input[value="${slug}"])`).innerText();
          if (active === slug) assert.ok(words.includes(status + ' · ' + position));
          else assert.doesNotMatch(words, /(?:GPS-runda|Simulering) pågår/);
        }
        await clubPage.locator('[data-close]').click();
        await clubPage.waitFor({ state: 'hidden' });
      }
      console.log(`${phone ? '390×844' : '1366×768'} · both Home resume links, exact layout/tee/hole, mode-specific club and layout status`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
