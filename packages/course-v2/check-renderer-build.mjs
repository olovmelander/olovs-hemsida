import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const APP = join(ROOT, 'apps/golf');
const output = await mkdtemp(join(tmpdir(), 'banvy-v2-renderer-'));

try {
  const viteEntry = join(APP, 'node_modules/vite/dist/node/index.js');
  const { build } = await import(pathToFileURL(viteEntry));
  await build({
    root: APP,
    configFile: false,
    logLevel: 'error',
    build: {
      outDir: output,
      emptyOutDir: true,
      rollupOptions: { input: 'v2-terrain-proof.html' },
    },
  });
  const html = await readFile(join(output, 'v2-terrain-proof.html'), 'utf8');
  const files = await readdir(join(output, 'assets'));
  const chunks = files.filter(file => /^v2-terrain-proof-.*\.js$/.test(file));
  if (chunks.length !== 1) throw new Error(`expected one renderer proof chunk, found ${chunks.length}`);
  if (!html.includes(chunks[0])) throw new Error('renderer proof HTML does not reference its module');
  const chunkPath = join(output, 'assets', chunks[0]);
  const source = await readFile(chunkPath, 'utf8');
  if (!source.includes('rgba16ui-height-parent-octnormal-v1')) {
    throw new Error('renderer proof did not bundle the compact terrain layout');
  }
  const bytes = (await stat(chunkPath)).size;
  if (bytes > 1_500_000) throw new Error(`renderer proof bundle exceeds 1.5 MB: ${bytes}`);
  console.log(`course-v2 renderer build passed: Three r185 proof ${bytes} bytes`);
} finally {
  await rm(output, { recursive: true, force: true });
}
