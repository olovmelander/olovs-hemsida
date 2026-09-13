import path from 'node:path';
import { build } from '../../apps/golf/node_modules/vite/dist/node/index.js';

// Compile the actual application and comparison entry without copying the
// course data archive. Browser checks use the local course server separately.
await build({
  configFile: path.resolve('apps/golf/vite.config.js'),
  root: path.resolve('apps/golf'),
  publicDir: false,
  build: {
    outDir: path.resolve('output/tree-study-build'),
    emptyOutDir: true,
    rollupOptions: { input: {
      app: path.resolve('apps/golf/index.html'),
      study: path.resolve('apps/golf/tree-study.html'),
      foliage: path.resolve('apps/golf/foliage-study.html'),
    } },
  },
});
