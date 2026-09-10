// Compile the real app without copying its multi-gigabyte public terrain tree.
// Public model receipts and actual loading are checked by check-runtime-models.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../apps/golf/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const golf = path.join(root, 'apps/golf');
const out = path.join(root, 'geobuild/cache/facilities-model-2026-09-10/app-build');
const startedAt = new Date().toISOString();
await build({ root: golf, configFile: path.join(golf, 'vite.config.js'), logLevel: 'warn',
  build: { outDir: out, emptyOutDir: false, copyPublicDir: false } });
const chunks = fs.readdirSync(path.join(out, 'assets'));
if (!chunks.some(p => /^veckefjarden-.*\.js$/.test(p))) throw new Error('Veckefjarden scenery was not bundled');
fs.writeFileSync(path.join(out, 'facility-build-check.json'), JSON.stringify({ passed: true,
  startedAt, finishedAt: new Date().toISOString(), publicAssetsCopied: false,
  sceneryChunks: chunks.filter(p => /^veckefjarden-.*\.js$/.test(p)) }, null, 2) + '\n');
console.log('Real application build passed; public models are checked separately in the browser.');
