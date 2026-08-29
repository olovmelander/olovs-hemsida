/* Does the installed app actually work offline? Exits non-zero if not.

   usage: node tools/check-pwa.mjs [distDir] [port]

   This gate owns its own server on its own port, because the only honest way to
   test offline is to have NOTHING able to serve the files. Playwright's
   setOffline does not intercept fetches the service worker makes itself, so with
   a worker in control it proves nothing -- the first version of this test passed
   for a course that had never been downloaded, which is how that was found. So:
   prime a PERSISTENT browser profile (the caches have to survive the browser
   closing, exactly as they do for a person between rounds), kill the server, and
   only then ask what still opens.

   Two assertions, and the second matters as much as the first:
     - a course already opened must boot with nothing serving it, with its real
       card and geometry, not a shell;
     - a course never opened must fail with a sentence a golfer can act on, not
       a TypeError. Being offline is a normal state for an installed app; only
       one thing is genuinely impossible, and the app has to say which.        */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { ROOT } from '../geobuild/lib.mjs';

const DIST = process.argv[2] || path.join(ROOT, 'apps/golf/dist');
const PORT = +(process.argv[3] || 8631);
const BASE = `http://127.0.0.1:${PORT}`;
const PROFILE = path.join(ROOT, 'apps/golf/.pwa-profile');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

if (!fs.existsSync(path.join(DIST, 'sw.js'))) {
  console.error(`no service worker in ${DIST} -- run the build first`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'courses/index.json'), 'utf8'));
const HAVE = manifest.courses[0].slug;                     /* the one we prime */
const MISSING = (manifest.courses[1] || manifest.courses[0]).slug;  /* never opened */

let bad = 0;
const gate = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) bad++; };

fs.rmSync(PROFILE, { recursive: true, force: true });
const srv = spawn(process.execPath, [path.join(ROOT, 'tools/serve.mjs'), DIST, String(PORT)],
                  { stdio: 'ignore', detached: false });
const stop = () => { try { srv.kill('SIGKILL'); } catch {} };
process.on('exit', stop);
await new Promise(r => setTimeout(r, 1500));

const launch = () => chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  viewport: { width: 800, height: 500 },
});

/* ---- online: open the course twice. The second load is the one that caches the
   pack, because on a first-ever visit the worker is not yet controlling the page
   that fetches it -- which is a fact about the product, not just the test: a
   course becomes available offline on the visit AFTER the one that opened it. */
{
  const ctx = await launch();
  const p = ctx.pages()[0] || await ctx.newPage();
  p.setDefaultTimeout(300000);
  await p.goto(`${BASE}/?bana=${HAVE}`, { waitUntil: 'load', timeout: 120000 });
  await p.waitForSelector('#boot.done', { timeout: 300000 });
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload({ waitUntil: 'load' });
  await p.waitForSelector('#boot.done', { timeout: 300000 });
  await p.waitForTimeout(1500);
  const c = await p.evaluate(async () => {
    const o = {};
    for (const n of await caches.keys()) o[n] = (await (await caches.open(n)).keys()).length;
    return o;
  });
  const shell = Object.entries(c).find(([n]) => n.includes('precache'))?.[1] || 0;
  gate(shell > 10, `shell precached (${shell} entries)`);
  gate((c['banvy-packs'] || 0) >= 1, `${HAVE}'s pack is in the runtime cache`);
  gate((c['banvy-manifest'] || 0) === 1, 'the manifest is cached as an offline fallback');
  await ctx.close();
}

stop();
await new Promise(r => setTimeout(r, 1200));
let up = true;
try { await fetch(BASE + '/'); } catch { up = false; }
gate(!up, 'the server is stopped -- anything below comes from the cache');

/* ---- offline ---- */
{
  const ctx = await launch();
  const boot = async slug => {
    const p = await ctx.newPage();
    p.setDefaultTimeout(200000);
    await p.goto(`${BASE}/?bana=${slug}`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    let ok = false;
    try { await p.waitForSelector('#boot.done', { timeout: 150000 }); ok = true; } catch {}
    const info = ok ? await p.evaluate(() => ({
      slug: window.V3D.course().slug, holes: window.V3D.HOLES.length,
      par: window.V3D.HOLES.reduce((a, h) => a + h.par, 0), draws: window.V3D.stats.draws })) : null;
    const say = await p.evaluate(() =>
      document.getElementById('bmsg')?.textContent?.trim() || '');
    await p.close();
    return { ok, info, say };
  };

  const a = await boot(HAVE);
  const want = manifest.courses.find(c => c.slug === HAVE);
  gate(a.ok && a.info && a.info.slug === HAVE && a.info.holes === want.holes && a.info.par === want.par,
    `${HAVE} opens with nothing serving it` +
    (a.info ? ` -- ${a.info.holes} hål, par ${a.info.par}, ${a.info.draws} draws` : ` -- ${a.say}`));

  const b = await boot(MISSING);
  gate(!b.ok, `${MISSING} was never downloaded, so it does not open`);
  gate(/inte nedladdad/.test(b.say) && !/Error|Uncaught|fetch/i.test(b.say),
    `and it says why, in words: "${b.say.slice(0, 72)}"`);
  await ctx.close();
}

fs.rmSync(PROFILE, { recursive: true, force: true });
console.log(bad ? `\n${bad} failed` : '\nthe app works offline, and says so honestly when it cannot');
process.exit(bad ? 1 : 0);
