/* The authored-tree prototype, looked at and counted. Boots Puttom three ways
   -- procedural trees, ?trees=ghibli, ?trees=ghibli&hero=1 -- shoots the 5th
   tee and a close look at the nearest pine from each, and prints the tree
   triangle table, the draw count and any console warning the loader raised.
     BANVY_GPU=1 node tools/goldens/ghibli-look.mjs [url] [--bana=puttom] [--hole=5] [--preset=noon] [--modes=procedural,ghibli,ghibli-hero] [--out=tools/goldens/flicker] */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { browserArgs } from '../browser-args.mjs';
const argv = process.argv.slice(2);
const BASE = argv.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8623';
const HOLE = +(argv.find(a => a.startsWith('--hole='))?.slice(7) || 5);
const BANA = argv.find(a => a.startsWith('--bana='))?.slice(7) || 'puttom';
const MODES = (argv.find(a => a.startsWith('--modes='))?.slice(8) || 'procedural,ghibli,ghibli-hero').split(',');
const PRESET = argv.find(a => a.startsWith('--preset='))?.slice(9) || 'noon';
const OUT = argv.find(a => a.startsWith('--out='))?.slice(6) || 'tools/goldens/flicker';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const modes = [['procedural', '&ghibli=0'], ['ghibli', '&trees=ghibli'], ['ghibli-hero', '&trees=ghibli&hero=1'], ['look', '&ghibli=1&hero=1']];
for (const [name, flag] of modes.filter(([n]) => MODES.includes(n))) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(600000);
  const warnings = [];
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/?bana=${BANA}&det=1&v2=require&ren=1&hal=${HOLE}${flag}`, { waitUntil: 'load' });
  await page.waitForSelector('#boot.done');
  const ev = (fn, a) => page.evaluate(fn, a);
  await ev(([h, preset]) => { const V = window.V3D; V.setPreset(preset); V.goHole(h, true, true); V.setCam('tee', true); }, [HOLE, PRESET]);
  const settle = () => page.waitForFunction(() => (window.V3D.v2Terrain().adapter?.stream?.loadingTiles ?? 0) === 0 && window.V3D.settled(), null, { polling: 50 });
  await settle(); await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${BANA}-${HOLE}-${name}-tee.png`, timeout: 300000 });
  const pick = await ev(() => {
    const V = window.V3D, cam = V.camExact().pos, ex = V.legacyTrees({ instances: true });
    let best = null;
    for (const t of ex.instances) {
      if (t[5] !== 1 || t[7] === 'C' || t[3] < 1.0) continue;
      const d = Math.hypot(t[0] - cam[0], t[2] - cam[2]);
      if (!best || d < best.d) best = { d, x: t[0], y: t[1], z: t[2], sy: t[3] };
    }
    return best;
  });
  if (pick) {
    await ev(({ x, y, z, sy }) => {
      const V = window.V3D, cam = V.camExact().pos;
      const dx = cam[0] - x, dz = cam[2] - z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
      V.setFov(48); V.placeCamera([x + ux * 22 * sy, y + 5 * sy, z + uz * 22 * sy], [x, y + 9 * sy, z]);
    }, pick);
    await settle(); await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${BANA}-${HOLE}-${name}-pine.png`, timeout: 300000 });
  }
  const stats = await ev(() => { const V = window.V3D, s = typeof V.stats === 'function' ? V.stats() : V.stats;
    return { tri: V.treeTriangles(), lod: V.treeLodPx(), draws: s?.draws ?? null }; });
  console.log(`${name}: tris per species [hero, full, far] ${JSON.stringify(stats.tri)} zoneTiers ${JSON.stringify(stats.lod.zoneTiers)} draws ${stats.draws}`);
  if (warnings.length) console.log(`  warnings: ${warnings.join(' | ')}`);
  await page.close();
}
await browser.close();
