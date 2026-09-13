// Original vector needle sprays, rasterized once for glTF/Blender compatibility.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
const out = path.resolve('apps/golf/public/models/trees/foliage-study');
fs.mkdirSync(out, { recursive: true });
let seed = 4719;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const shapes = [];
for (let tile = 0; tile < 4; tile++) {
  const ox = (tile % 2) * 256, oy = Math.floor(tile / 2) * 256;
  for (let spray = 0; spray < 7; spray++) {
    const angle = (spray / 7) * Math.PI * 2 + rand() * .3;
    const cx = 128 + Math.cos(angle) * 48, cy = 128 + Math.sin(angle) * 48;
    for (let needle = 0; needle < 11; needle++) {
      const a = angle + (rand() - .5) * 2.2;
      const start = rand() * 28, len = 20 + rand() * 26, width = 2.3 + rand() * 2.7;
      const x = ox + cx + Math.cos(angle) * start, y = oy + cy + Math.sin(angle) * start;
      const dx = Math.cos(a), dy = Math.sin(a), shade = Math.round(210 + rand() * 45);
      shapes.push(`<path fill="rgb(${shade},${shade},${shade})" d="M${x},${y} Q${x+dx*len*.55-dy*width},${y+dy*len*.55+dx*width} ${x+dx*len},${y+dy*len} Q${x+dx*len*.55+dy*width},${y+dy*len*.55-dx*width} ${x},${y}Z"/>`);
    }
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${shapes.join('')}</svg>`;
fs.writeFileSync(path.join(out, 'needle-sprays.svg'), svg);
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  const data = await page.evaluate(async svg => {
    const image = new Image(); image.src = 'data:image/svg+xml;base64,' + btoa(svg); await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL('image/png').split(',')[1];
  }, svg);
  fs.writeFileSync(path.join(out, 'needle-sprays.png'), Buffer.from(data, 'base64'));
} finally { await browser.close(); }
console.log('Created original 512px needle atlas.');
