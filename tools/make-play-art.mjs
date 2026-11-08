#!/usr/bin/env node
/* The start menu's Spela card: the golfer at address on a first tee, shot from
   the game itself with its screen hidden, encoded in the browser as the course
   posters are (tools/make-posters.mjs: 800 px, WebP q90).

     node tools/make-play-art.mjs http://127.0.0.1:5173 [--course veckefjarden] [--hole 1] [--golfer female]

   Writes apps/golf/public/play/spela-card.webp. Run it against a dev server or a
   preview of a build; the GPU must be the real one (see CLAUDE.md). */
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const base = (args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:5173').replace(/\/$/, '');
const course = flag('course', 'veckefjarden'), hole = flag('hole', '1'), golfer = flag('golfer', 'female');
const out = flag('out', 'apps/golf/public/play/spela-card.webp');

const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/?bana=${course}&karta=0&spela=1&hal=${hole}&golfare=${golfer}&ljus=kvall&q=hi&qualitylock=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.BANVY_PLAY?.state?.().state === 'address', null, { timeout: 180000 });
  // Down the line, behind the golfer: she stands in the middle of the picture,
  // the hole opening beyond her. (r is the aim's right; the golfer stands on its left.)
  await page.evaluate(() => {
    const P = window.BANVY_PLAY, s = P.state(), [bx, by, bz] = s.ball, yaw = s.yaw;
    const f = [Math.sin(yaw), Math.cos(yaw)], r = [-Math.cos(yaw), Math.sin(yaw)];
    const gx = bx - r[0] * .75, gz = bz - r[1] * .75;             // the golfer's feet
    // At her waist, pitched 6 degrees down: her head and shoulders stand in the
    // sky in the picture's upper half (the card's words cover its foot).
    P.look([gx - f[0] * 3.1 - r[0] * .15, by + .95, gz - f[1] * 3.1 - r[1] * .15], [gx + f[0] * 20, by - 1.15, gz + f[1] * 20]);
    document.querySelector('.pl-hud').style.display = 'none';
  });
  await page.waitForFunction(() => (window.V3D?.v2Terrain?.().adapter?.stream?.loadingTiles ?? 0) === 0, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const png = await page.screenshot();
  const b64 = await page.evaluate(async src => {
    const img = new Image();
    await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = src; });
    const c = document.createElement('canvas');
    c.width = 800; c.height = Math.round(img.height * 800 / img.width);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/webp', .9).split(',')[1];
  }, 'data:image/png;base64,' + png.toString('base64'));
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log(JSON.stringify({ out, bytes: fs.statSync(out).size, errors }));
} finally { await browser.close(); }
