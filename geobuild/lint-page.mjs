/* The static check CLAUDE.md prescribes, as one runnable command.

   The page is a single module in a 500 KB file; an identifier deleted from the init
   block once took the whole render down silently. Extracting the module body and
   running eslint's no-undef over it catches that class of mistake in seconds,
   without a browser.

   Run:  node geobuild/lint-page.mjs [page.html]     (default veckefjarden3d.html)   */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib.mjs';

const page = process.argv[2] || path.join(ROOT, 'veckefjarden3d.html');
const html = fs.readFileSync(page, 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('no module script found in ' + page); process.exit(2); }

const dir = path.join(ROOT, 'geobuild/cache');
fs.mkdirSync(dir, { recursive: true });
const body = path.join(dir, 'page-module.mjs');
fs.writeFileSync(body, m[1]);

const cfg = path.join(dir, 'lint-config.mjs');
fs.writeFileSync(cfg, `export default [{
  files: ['**/page-module.mjs'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: {
    window:'readonly', document:'readonly', navigator:'readonly', console:'readonly',
    fetch:'readonly', atob:'readonly', btoa:'readonly', performance:'readonly',
    requestAnimationFrame:'readonly', TextDecoder:'readonly', TextEncoder:'readonly',
    DecompressionStream:'readonly', Response:'readonly', Blob:'readonly', URL:'readonly',
    URLSearchParams:'readonly', location:'readonly', setTimeout:'readonly',
    clearTimeout:'readonly', devicePixelRatio:'readonly', innerWidth:'readonly',
    innerHeight:'readonly', addEventListener:'readonly', OffscreenCanvas:'readonly',
    ImageData:'readonly', history:'readonly', localStorage:'readonly',
  } },
  rules: { 'no-undef': 'error' },
}];\n`);

try {
  /* npx is npx.cmd on Windows, which Node refuses to spawn without a shell; before this
     the catch below swallowed that EINVAL and the gate exited 1 with no message. */
  execFileSync('npx', ['--yes', 'eslint', '--config', cfg, body], { stdio: 'inherit', cwd: ROOT, shell: process.platform === 'win32' });
  console.log('no-undef clean: ' + path.basename(page));
} catch (e) {
  if (!/Command failed/.test(String(e.message))) console.error('lint-page: ' + e.message.split(String.fromCharCode(10))[0]);
  process.exit(1);
}
