/* Does the app still work when it is NOT at the root of a domain?
   Exits non-zero if not.

   usage: node tools/check-basepath.mjs [base] [port]      (default /olovs-hemsida/)

   Cloudflare would serve Banvy from a domain root; GitHub Pages serves it from
   /<repo>/. Almost everything survives that automatically -- Vite rewrites the
   tags in index.html and every asset it processes -- which is exactly why this
   gate is needed: the handful of things it does NOT rewrite fail SILENTLY.

   The one that proves the point is fonts.css. It is copied verbatim out of
   public/, so Vite rewrites the <link> pointing at it and not one url inside it.
   Absolute font urls then resolve to the host's root, every face 404s, and the
   page renders in a fallback font with nothing in the console. No amount of
   reading the source finds that; loading the page at the real mount point does,
   which is what this does: build for the base, assemble the site the way the
   Pages workflow assembles it, serve it AT that path, and drive it.          */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { ROOT } from '../geobuild/lib.mjs';

const BASE = process.argv[2] || '/olovs-hemsida/';
const PORT = +(process.argv[3] || 8641);
const MOUNT = BASE.replace(/\/$/, '');
const URLB = `http://127.0.0.1:${PORT}${MOUNT}`;
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PAGES = ['veckefjarden', 'norrfallsviken', 'puttom', 'angso', 'upsala', 'johannesberg'];

let bad = 0;
const gate = (ok, m) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${m}`); if (!ok) bad++; };

console.log(`  building with base ${BASE}`);
execFileSync('pnpm', ['--filter', '@banvy/golf', 'build'],
  { cwd: ROOT, env: { ...process.env, BANVY_BASE: BASE }, stdio: 'ignore' });

/* assemble exactly as .github/workflows/pages.yml does */
const site = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-base-'));
const mount = path.join(site, MOUNT.replace(/^\//, ''));
fs.mkdirSync(mount, { recursive: true });
fs.cpSync(path.join(ROOT, 'apps/golf/dist'), mount, { recursive: true });
for (const p of [...PAGES.map(s => `${s}3d.html`), 'veckefjardensgc.html'])
  fs.copyFileSync(path.join(ROOT, p), path.join(mount, p));

const srv = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), site, String(PORT)], { stdio: 'ignore' });
const cleanup = () => { try { srv.kill('SIGKILL'); } catch {} fs.rmSync(site, { recursive: true, force: true }); };
process.on('exit', cleanup);
await new Promise(r => setTimeout(r, 1500));

const browser = await chromium.launch({ executablePath: CHROME,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 620 } });
const p = await ctx.newPage();
p.setDefaultTimeout(300000);
const errs = [], four = [];
p.on('pageerror', e => errs.push(String(e).split('\n')[0].slice(0, 120)));
p.on('response', r => { if (r.status() >= 400) four.push(`${r.status()} ${new URL(r.url()).pathname}`); });

await p.goto(`${URLB}/?bana=veckefjarden&hal=14&vy=green`, { waitUntil: 'load', timeout: 120000 });
await p.waitForSelector('#boot.done', { timeout: 300000 });
const info = await p.evaluate(() => ({
  slug: window.V3D.course().slug, holes: window.V3D.HOLES.length,
  par: window.V3D.HOLES.reduce((a, h) => a + h.par, 0), draws: window.V3D.stats.draws,
  hole: document.getElementById('cno')?.textContent,
  header: document.getElementById('hdName')?.textContent }));
gate(info.slug === 'veckefjarden' && info.holes === 18 && info.par === 72,
  `boots at ${BASE} -- ${info.header}, ${info.holes} hål, par ${info.par}, ${info.draws} draws`);
gate(info.hole === '14', `the deep link still opens hole ${info.hole}`);
gate(four.length === 0, `nothing 404s${four.length ? ' -- ' + four.slice(0, 4).join(' | ') : ''}`);
gate(errs.length === 0, `no page errors${errs.length ? ' -- ' + errs[0] : ''}`);

/* the fonts are the whole reason this gate exists: a 404 here is invisible */
const fonts = await p.evaluate(async () => {
  const css = await (await fetch(new URL('fonts/fonts.css', document.baseURI))).text();
  const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map(m => m[1].replace(/['"]/g, ''));
  const res = await Promise.all(urls.slice(0, 4).map(async u => {
    try { return (await fetch(new URL(u, new URL('fonts/', document.baseURI)))).status; }
    catch { return 0; } }));
  return { n: urls.length, statuses: [...new Set(res)] };
});
gate(fonts.n > 0 && fonts.statuses.every(s => s === 200),
  `all ${fonts.n} font faces resolve (sampled ${fonts.statuses.join(',')})`);
gate(await p.evaluate(() => document.fonts.check('12px Outfit')), 'the real Outfit face is loaded, not a fallback');

const man = await p.evaluate(async () => (await (await fetch(new URL('manifest.webmanifest', document.baseURI))).json()));
gate(man.start_url === BASE && man.scope === BASE,
  `the installed app opens ${man.start_url} (scope ${man.scope}), not the host root`);
gate(man.icons.every(i => i.src.startsWith(BASE)), 'its icons are under the base too');

const sw = await p.evaluate(async () => {
  await navigator.serviceWorker.ready;
  return (await navigator.serviceWorker.getRegistration())?.scope || null; });
gate(!!sw && sw.endsWith(BASE), `service worker scope is ${sw}`);

/* the route patterns must still fire; an anchored ^/courses/ would silently
   never match here, and offline would stop working with no error anywhere */
await p.reload({ waitUntil: 'load' });
await p.waitForSelector('#boot.done', { timeout: 300000 });
await p.waitForTimeout(2000);
const cached = await p.evaluate(async () => {
  const o = {};
  for (const n of await caches.keys())
    o[n] = (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname);
  return o; });
const packs = cached['banvy-packs'] || [];
gate(packs.length >= 1 && packs[0].startsWith(BASE), `the pack caches under the base: ${packs[0] || '(none)'}`);
gate((cached['banvy-manifest'] || []).length === 1, 'and so does the manifest');

/* the bookmarked standalone pages sit beside the app, as real files */
const q = await ctx.newPage();
q.setDefaultTimeout(300000);
await q.goto(`${URLB}/veckefjarden3d.html?hal=3`, { waitUntil: 'load', timeout: 120000 });
await q.waitForSelector('#boot.done', { timeout: 300000 });
const legacy = await q.evaluate(() => ({ t: document.title, h: document.getElementById('cno')?.textContent }));
gate(/Veckefj/.test(legacy.t) && legacy.h === '3', `a bookmarked page still opens itself on hole ${legacy.h}`);

await browser.close();
console.log(bad ? `\n${bad} failed at base ${BASE}` : `\nthe app works mounted at ${BASE}`);
process.exit(bad ? 1 : 0);
