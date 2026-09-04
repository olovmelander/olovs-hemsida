import { chromium } from 'playwright-core';
const BS = String.fromCharCode(92);
const src = 'file:///' + process.argv[2].split(BS).join('/');
const jobs = JSON.parse(process.argv[3]);
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage();
for (const j of jobs) {
  const s = j.scale || 1;
  const W = Math.round(j.w * s), H = Math.round(j.h * s);
  await p.setViewportSize({ width: Math.min(W, 3800), height: Math.min(H, 3800) });
  await p.setContent('<style>html,body{margin:0;background:#fff;overflow:hidden}img{position:absolute;left:' + (-j.x*s) + 'px;top:' + (-j.y*s) + 'px;width:' + (4678*s) + 'px}</style><img src="' + src + '">');
  await p.waitForFunction('(() => { const i=document.querySelector("img"); return i && i.complete && i.naturalWidth>0; })()', null, { timeout: 180000 });
  await p.screenshot({ path: j.out, timeout: 300000 });
  console.log(j.out, W, H);
}
await b.close();
