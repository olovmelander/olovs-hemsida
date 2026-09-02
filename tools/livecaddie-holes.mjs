#!/usr/bin/env node
/* Pull a club's per-hole banguide text out of a LiveCaddie course guide.

   Many Swedish clubs publish their banguide as an embedded LiveCaddie page
   (puttom.se/banguide is an iframe of courses.livecaddie.com, course 658);
   the per-hole text the club wrote sits on course-graphics.php behind a
   hole=N parameter and nowhere else. This drives real Chrome because the
   guide is JS-rendered and the club sites 403 a plain fetch.

     node tools/livecaddie-holes.mjs <courseId> [out.json]

   Find the id in the iframe src on the club's banguide page. Output: one
   entry per hole with the par/hcp the guide shows and the text verbatim. */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const course = process.argv[2], out = process.argv[3] || `livecaddie-${course}.json`;
if (!course) { console.error('usage: node tools/livecaddie-holes.mjs <courseId> [out.json]'); process.exit(2); }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ locale: 'sv-SE' });
const page = await ctx.newPage();
const res = {};
for (let n = 1; n <= 18; n++) {
  const url = `https://courses.livecaddie.com/course-graphics.php?course=${course}&lang=sv-SE&embedded&hole=${n}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(800);
  const t = await page.evaluate(() => document.body.innerText);
  /* the hole's block runs from the Prev/Next pager to the video/tracker buttons */
  const m = t.match(/Next\s*\n([\s\S]*?)\n\s*SE VIDEO/) || t.match(/Next\s*\n([\s\S]*?)\n\s*SE SPELARE/);
  const par = (t.match(/Par:\s*(\d)/) || [])[1], hcp = (t.match(/HCP:\s*(\d+)/) || [])[1];
  res[n] = { par: par ? +par : null, hcp: hcp ? +hcp : null, text: (m ? m[1] : '').trim().replace(/\s+/g, ' ') };
  console.log(`== HÅL ${n}  par ${par} hcp ${hcp}\n${res[n].text}\n`);
}
fs.writeFileSync(out, JSON.stringify(res, null, 1) + '\n');
await browser.close();
