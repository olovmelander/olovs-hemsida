import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const APP = join(ROOT, 'apps/golf');

export async function buildRendererProof(outputDirectory, { emptyOutDir = true } = {}) {
  if (typeof outputDirectory !== 'string' || !outputDirectory) {
    throw new TypeError('outputDirectory must be a non-empty string');
  }
  const output = resolve(outputDirectory);
  const viteEntry = join(APP, 'node_modules/vite/dist/node/index.js');
  const { build } = await import(pathToFileURL(viteEntry));
  await build({
    root: APP,
    configFile: false,
    logLevel: 'error',
    build: {
      outDir: output,
      emptyOutDir,
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
  if (!source.includes('rgba16ui-height-parent-octnormal-v1') ||
      !source.includes('banvy-terrain-preview-v1')) {
    throw new Error('renderer proof did not bundle the terrain or retained-preview contracts');
  }
  const bytes = (await stat(chunkPath)).size;
  if (bytes > 1_500_000) throw new Error(`renderer proof bundle exceeds 1.5 MB: ${bytes}`);
  return Object.freeze({ outputDirectory: output, htmlPath: join(output, 'v2-terrain-proof.html'), chunkPath, bytes });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const output = process.argv[2];
  if (!output) {
    console.error('usage: node packages/course-v2/build-renderer-proof.mjs <output-directory>');
    process.exitCode = 2;
  } else {
    buildRendererProof(output).then(result => {
      console.log(`built Three r185 terrain proof: ${result.bytes} bytes`);
    }).catch(error => {
      console.error(`terrain proof build failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
