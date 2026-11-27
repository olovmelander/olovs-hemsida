/* GitHub Pages' last publication: Banvy has moved to Cloudflare (owner, 27 November
   2026). Every old address under /olovs-hemsida/ is answered by one page (index.html,
   and 404.html for every other path) that sends the visitor to the same place on
   the main site, with their own data in the URL fragment (shell/pages-move.mjs;
   received by shell/move-in.mjs). sw.js stands at the old app's worker address: an
   installed copy of the old app updates to it, and it deletes the old app's caches,
   unregisters and reloads its windows, so they reach the page.

   node tools/pages-moved-site.mjs <outDir> [--site <url>] [--base </path/>]  */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAIN_SITE, MOVE_LIMIT, MOVE_PARAM, PAGES_BASE, movedLocation } from '../apps/golf/src/shell/pages-move.mjs';
import { DEVICE_ONLY_KEYS, DEVICE_ONLY_PREFIXES, OWN_KEY_SOURCE } from '../apps/golf/src/shell/backup-keys.mjs';

const attribute = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const script = value => JSON.stringify(value).replaceAll('<', '\\u003c');

/* The old app's caches: the precache is named by its scope, the rest banvy-*. */
const ownedCache = base => `name => name.startsWith('banvy-') || name.includes(${script(base)})`;

/* What the page hands movedLocation, besides the moment. */
export const moveRules = ({ site = MAIN_SITE, base = PAGES_BASE } = {}) => ({ base, site, param: MOVE_PARAM, limit: MOVE_LIMIT,
  own: OWN_KEY_SOURCE, deviceKeys: [...DEVICE_ONLY_KEYS], devicePrefixes: [...DEVICE_ONLY_PREFIXES] });

export function movedPage({ site = MAIN_SITE, base = PAGES_BASE } = {}) {
  const rules = moveRules({ site, base });
  return `<!doctype html>
<html lang="sv">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Banvy har flyttat</title>
<link rel="canonical" href="${attribute(site)}">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f1d16; color: #eef3ee;
    font: 17px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 30rem; padding: 2rem 1.5rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .5rem; }
  a, button { color: #0f1d16; background: #cfe6b8; border: 0; border-radius: 999px; padding: .75rem 1.25rem;
    font: inherit; font-weight: 600; text-decoration: none; display: inline-block; min-height: 44px; box-sizing: border-box; cursor: pointer; }
  .alt { background: transparent; color: #cfe6b8; box-shadow: inset 0 0 0 1.5px #cfe6b8; }
  .row { display: flex; flex-wrap: wrap; gap: .75rem; margin-top: 1.25rem; }
  [hidden] { display: none; }
</style>
<main>
  <h1>Banvy har flyttat</h1>
  <p id="status">Banvy finns nu på <b>${attribute(new URL(site).host)}</b>. Du skickas vidare, med dina rundor och inställningar.</p>
  <p id="large" hidden>Dina uppgifter är för många för att följa med länken. Spara dem i en fil och läs in den under Inställningar, Konto och data, på den nya adressen.</p>
  <div class="row">
    <button id="save" type="button" hidden>Spara fil</button>
    <a id="onward" class="alt" href="${attribute(site)}">Fortsätt till Banvy</a>
  </div>
</main>
<script type="module">
const movedLocation = (${movedLocation.toString()});
const rules = { ...${script(rules)}, now: Date.now() };
const owned = ${ownedCache(base)};
/* This address's old app: its worker and its caches. Its player data stays. */
const cleared = (async () => {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(registrations.filter(r => new URL(r.scope).pathname.startsWith(rules.base)).map(r => r.unregister()));
    const names = (await globalThis.caches?.keys()) ?? [];
    await Promise.all(names.filter(owned).map(name => caches.delete(name)));
  } catch { /* nothing to clear */ }
})();
let storage = null;
try { storage = localStorage; } catch { /* the address still moves */ }
const moved = await movedLocation(location, storage ?? { length: 0, key: () => null, getItem: () => null }, rules);
await Promise.race([cleared, new Promise(resolve => setTimeout(resolve, 1500))]);
const onward = document.getElementById('onward');
onward.href = moved.url;
if (moved.tooLarge) {
  document.getElementById('large').hidden = false;
  const save = document.getElementById('save');
  save.hidden = false;
  save.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([moved.text], { type: 'application/json' }));
    link.download = 'banvy-flytt-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(link);
    link.click();
    link.remove();
  });
} else {
  location.replace(moved.url);
}
</script>
<noscript><p><a href="${attribute(site)}">Fortsätt till Banvy</a></p></noscript>
</html>
`;
}

export function movedWorker({ base = PAGES_BASE } = {}) {
  return `/* Banvy has moved from GitHub Pages. This worker takes the old app's place, deletes
   its caches, unregisters and reloads its windows, which then reach the page that
   moves the visitor and their data. */
const owned = ${ownedCache(base)};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(owned).map(name => caches.delete(name)));
  await self.registration.unregister();
  const windows = await self.clients.matchAll({ type: 'window' });
  await Promise.all(windows.map(client => client.navigate(client.url).catch(() => null)));
})()));
`;
}

export function writeMovedSite(outDir, options = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const page = movedPage(options);
  const files = { 'index.html': page, '404.html': page, 'sw.js': movedWorker(options), '.nojekyll': '' };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(outDir, name), text);
  return Object.keys(files);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const flag = name => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
  const outDir = args.find((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--'));
  if (!outDir) throw new Error('usage: pages-moved-site.mjs <outDir> [--site <url>] [--base </path/>]');
  const site = flag('--site') ?? MAIN_SITE, base = flag('--base') ?? PAGES_BASE;
  if (!/^https?:\/\/[^/]+\/$/.test(site.replace(/\/?$/, '/')) || !/^\/.*\/$/.test(base)) throw new Error('site must be an origin and base must start and end with /');
  console.log(`wrote ${writeMovedSite(outDir, { site: site.replace(/\/?$/, '/'), base }).join(', ')} to ${outDir}: ${base} moves to ${site}`);
}
