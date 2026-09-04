import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BS = String.fromCharCode(92);
const src = 'file:///' + process.argv[2].split(BS).join('/');
const jobs = JSON.parse(process.argv[3]);
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage();
await p.setContent('<img id="i" src="' + src + '">');
await p.waitForFunction('(() => { const i=document.getElementById("i"); return i && i.complete && i.naturalWidth>0; })()', null, { timeout: 180000 });
for (const j of jobs) {
  const url = await p.evaluate((j) => {
    const img = document.getElementById('i');
    const c = document.createElement('canvas');
    c.width = Math.round(j.w * j.scale); c.height = Math.round(j.h * j.scale);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, j.x, j.y, j.w, j.h, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }, j);
  fs.writeFileSync(j.out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(j.out, Math.round(j.w*j.scale), Math.round(j.h*j.scale));
}
await b.close();
