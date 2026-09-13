import fs from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { browserArgs } from '../../tools/browser-args.mjs';

const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/?bana=veckefjarden&hal=1&det=1&ljus=dag', { timeout: 120000 });
  await page.waitForFunction(() => window.V3D?.harness && document.querySelector('#boot.done'), null, { timeout: 240000 });
  const result = await page.evaluate(() => {
    const church = [-3278.4, -905.3], start = [1303.65, -493.1], end = [1385.95, -519.1];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const direction = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
    const samples = [];
    for (let s = -10; s <= 330; s += 2) {
      const row = [];
      for (let t = -40; t <= 40; t += 2) {
        const x = start[0] + direction[0] * s - direction[1] * t;
        const z = start[1] + direction[1] * s + direction[0] * t;
        row.push({ s, t, x, z, height: V3D.demH(x, z) });
      }
      samples.push(row);
    }
    return {
      course: 'veckefjarden', coordinateFrame: 'legacy-local',
      church: { anchor: church, ground: V3D.demH(...church), perimeter: Array.from({ length: 32 }, (_, i) => {
        const angle = i * Math.PI / 16, x = church[0] + Math.cos(angle) * 21, z = church[1] + Math.sin(angle) * 21;
        return { x, z, height: V3D.demH(x, z) };
      }) },
      jump: { start, end, length, direction, ground: V3D.demH(...start), samples },
    };
  });
  await fs.writeFile(new URL('./terrain-samples.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ church: result.church.ground, jumpLength: result.jump.length, jumpStart: result.jump.ground, samples: result.jump.samples.length }));
} finally { await browser.close(); }
