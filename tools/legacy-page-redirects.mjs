import { LEGACY_PAGES, VIEW_KEYS, mapLegacyLocation } from '../apps/golf/src/shell/legacy-links.mjs';

const htmlAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const scriptJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c');

export function legacyRedirectPage(file, base) {
  if (!Object.hasOwn(LEGACY_PAGES, file)) throw new Error(`Unknown legacy page: ${file}`);
  const target = base + '?bana=' + LEGACY_PAGES[file];
  return `<!doctype html>
<html lang="sv">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Öppna banan i Banvy</title>
<link rel="canonical" href="${htmlAttribute(target)}">
<p><a id="destination" href="${htmlAttribute(target)}">Öppna banan i Banvy</a></p>
<script>
const target = (${mapLegacyLocation.toString()})(location.pathname, location.search,
  ${scriptJSON(base)}, ${scriptJSON(LEGACY_PAGES)}, ${scriptJSON(VIEW_KEYS)});
if (target) {
  document.getElementById('destination').href = target + location.hash;
  location.replace(target + location.hash);
}
</script>
</html>
`;
}

export function legacyPageRedirectsPlugin() {
  let base;
  return {
    name: 'banvy-legacy-page-redirects',
    configResolved(config) { base = config.base; },
    generateBundle() {
      for (const file of Object.keys(LEGACY_PAGES)) {
        this.emitFile({ type: 'asset', fileName: file, source: legacyRedirectPage(file, base) });
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        // Vite may already have stripped the base before a middleware runs.
        const local = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.slice(1);
        if (!Object.hasOwn(LEGACY_PAGES, local)) return next();
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(request.method === 'HEAD' ? undefined : legacyRedirectPage(local, base));
      });
    },
  };
}
