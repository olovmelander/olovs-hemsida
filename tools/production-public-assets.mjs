import { rmSync } from 'node:fs';
import path from 'node:path';

// These catalogues are read only by tree-study/foliage-study and their authoring
// tools. Keep their source URLs working locally without publishing the models.
export const STUDY_PUBLIC_DIRECTORIES = Object.freeze([
  'models/trees/refined',
  'models/trees/foliage-study',
]);

export function productionPublicAssetsPlugin() {
  let config;
  return {
    name: 'banvy-production-public-assets',
    apply: 'build',
    configResolved(value) { config = value; },
    // Vite copies public/ before writing bundles. Prune before PWA's closeBundle
    // generates its cache manifest. Explicit study builds keep both catalogues.
    writeBundle: {
      order: 'post',
      sequential: true,
      handler(options) {
        if (config.mode === 'study' || !config.publicDir || !config.build.copyPublicDir) return;
        const outDir = path.resolve(config.root, options.dir ?? config.build.outDir);
        for (const directory of STUDY_PUBLIC_DIRECTORIES) {
          rmSync(path.join(outDir, directory), { recursive: true, force: true });
        }
      },
    },
  };
}
