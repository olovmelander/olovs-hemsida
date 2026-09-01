import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
const ROOT = resolve('apps/golf/dist');
const MIME = new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],
  ['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],
  ['.bvch','application/vnd.banvy.chunk-v2'],['.png','image/png'],['.webp','image/webp'],
  ['.woff2','font/woff2'],['.bin','application/octet-stream'],['.svg','image/svg+xml']]);
const server = createServer(async (req,res)=>{
  const p = decodeURIComponent(new URL(req.url,'http://l').pathname);
  const t = resolve(ROOT, p==='/'?'index.html':p.replace(/^\/+/,''));
  try { if(!(await stat(t)).isFile()) throw 0; const b=await readFile(t);
    res.writeHead(200,{'content-type':MIME.get(extname(t))||'application/octet-stream',
      'content-length':String(b.byteLength),'cache-control':'no-store'}); res.end(b);
  } catch { res.writeHead(404).end('nf'); }
});
await new Promise(a=>server.listen(0,'127.0.0.1',a));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium', headless:true,
  args:['--no-sandbox','--headless=new','--enable-unsafe-swiftshader','--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport:{width:800,height:500} });
page.on('pageerror', e=>console.log('[pageerror]', String(e).slice(0,300)));
await page.goto(`${origin}/?bana=puttom&v2=1&q=lo&det=1`, { waitUntil:'domcontentloaded' });
await page.waitForFunction(()=>document.getElementById('boot')?.classList.contains('done'), null, { timeout:300000 });
const out = await page.evaluate(() => {
  const V = globalThis.V3D, b = V.v2Terrain().bounds, br = V.v2Terrain().bridge;
  const toLegacy = (gx,gz) => { const c=Math.cos(br.rotationRadians), s=Math.sin(br.rotationRadians);
    return [br.scaleX*(gx*c-gz*s), br.scaleZ*(gx*s+gz*c)]; };
  const rows = [];
  /* walk across the western edge of the pilot, in grid space, and read the
     ground the app actually renders on each side */
  for (const gz of [-300, 0, 300]) {
    for (const d of [-30, -12, -2, 2, 12, 30]) {
      const [x,z] = toLegacy(b.x0 + d, gz);
      rows.push({ side: d<0?'outside':'inside', d, x:+x.toFixed(1), z:+z.toFixed(1),
                  probeH:+V.probeH(x,z).toFixed(2), demH:+V.demH(x,z).toFixed(2), terrainH:+V.terrainH(x,z).toFixed(2) });
    }
  }
  const t = V.v2Terrain();
  return { bounds:b, rows, renderer: t.adapter?.renderer || null, status: t.status,
           badge: document.querySelector('#v2TerrainBadge')?.textContent?.trim() };
});
console.log(JSON.stringify(out.bounds));
console.log('status', out.status, '|', out.badge);
console.log('renderer', JSON.stringify(out.renderer && {status:out.renderer.status, error:out.renderer.error,
  mesh:out.renderer.meshResolutionMetres, skipped:out.renderer.skippedBasePoints,
  emitted:out.renderer.emittedBasePoints, total:out.renderer.totalBasePoints,
  removed:out.renderer.removedTriangles, draws:out.renderer.drawCalls,
  tiles:out.renderer.renderedTiles, tris:out.renderer.triangles}));
for (const r of out.rows) console.log(`${r.side.padEnd(8)} d=${String(r.d).padStart(4)}  (${String(r.x).padStart(8)},${String(r.z).padStart(8)})  probeH ${String(r.probeH).padStart(7)}  demH ${String(r.demH).padStart(7)}  terrainH ${String(r.terrainH).padStart(7)}`);
await browser.close(); server.close();
