import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
const file = process.argv[2];
const jobs = JSON.parse(process.argv[3]);
const buf = fs.readFileSync(file);
const srv = http.createServer((q, r) => {
  if (q.url.startsWith('/img')) { r.writeHead(200, {'content-type':'image/png','content-length':buf.length}); r.end(buf); }
  else { const h = '<html><body style="margin:0"><img id="i" src="/img.png"></body></html>'; r.writeHead(200, {'content-type':'text/html','content-length':Buffer.byteLength(h)}); r.end(h); }
});
await new Promise(res => srv.listen(8791, '127.0.0.1', res));
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage();
await p.goto('http://127.0.0.1:8791/');
await p.waitForFunction('(() => { const i=document.getElementById("i"); return i && i.complete && i.naturalWidth>0; })()', null, { timeout: 180000 });
console.log('natural', await p.evaluate('[document.getElementById("i").naturalWidth, document.getElementById("i").naturalHeight]'));
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
await b.close(); srv.close();
