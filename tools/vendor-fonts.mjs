/* Self-host the two faces. Google's css2 endpoint serves woff2 @font-face rules
   to a modern UA; this downloads that css, pulls every woff2 it references into
   apps/golf/public/fonts/, and rewrites the urls to local paths. Run once (and
   again only to change weights). The app then makes no third-party requests.  */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps/golf/public/fonts');
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

fs.mkdirSync(OUT, { recursive: true });
const css = await (await fetch(CSS_URL, { headers: { 'user-agent': UA } })).text();
if (!/@font-face/.test(css)) throw new Error('css2 did not return font-face rules');

const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2/g))];
let local = css;
for (const u of urls) {
  const name = u.split('/').slice(-3).join('-');            /* family-version-file.woff2 */
  const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
  fs.writeFileSync(path.join(OUT, name), buf);
  local = local.split(u).join(`/fonts/${name}`);
  console.log(`  ${name}  ${(buf.length / 1024).toFixed(0)} KB`);
}
fs.writeFileSync(path.join(OUT, 'fonts.css'), local);
console.log(`${urls.length} woff2 files + fonts.css -> apps/golf/public/fonts/`);
