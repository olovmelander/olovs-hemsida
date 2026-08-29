/* eslint no-undef over the app's module sources -- the same gate lint-page.mjs
   runs on the pages' extracted bodies, pointed at real files. The strict-module
   rule stays the cheapest tripwire this repo has: the class of bug that once
   deleted nine identifiers from an init block is caught in seconds here.      */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['apps/golf/src/main.js'];

const cfg = path.join(ROOT, 'tools/.lint-app-config.mjs');
fs.writeFileSync(cfg, `export default [{
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: {
    window:'readonly', document:'readonly', navigator:'readonly', console:'readonly',
    fetch:'readonly', atob:'readonly', btoa:'readonly', performance:'readonly',
    requestAnimationFrame:'readonly', TextDecoder:'readonly', TextEncoder:'readonly',
    DecompressionStream:'readonly', Response:'readonly', Blob:'readonly', URL:'readonly',
    URLSearchParams:'readonly', location:'readonly', setTimeout:'readonly',
    clearTimeout:'readonly', devicePixelRatio:'readonly', innerWidth:'readonly',
    innerHeight:'readonly', addEventListener:'readonly', OffscreenCanvas:'readonly',
    ImageData:'readonly', Image:'readonly', history:'readonly', localStorage:'readonly', DataView:'readonly',
    crypto:'readonly',
  } },
  rules: { 'no-undef': 'error' },
}];\n`);

/* On Windows npx is npx.cmd, and Node refuses to spawn a .cmd without a shell */
const win = process.platform === 'win32';
try {
  execFileSync(win ? 'npx.cmd' : 'npx', ['--yes', 'eslint', '--config', cfg, ...files],
    { stdio: 'inherit', cwd: ROOT, shell: win });
  console.log('no-undef clean: ' + files.join(', '));
} catch (e) {
  if (!e.status) console.error('eslint could not run: ' + e.message);
  process.exit(1);
}
