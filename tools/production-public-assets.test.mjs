import { afterEach, describe, expect, it } from 'vitest';
import { build } from '../apps/golf/node_modules/vite/dist/node/index.js';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { productionPublicAssetsPlugin } from './production-public-assets.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

async function fixture(mode) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'banvy-public-'));
  roots.push(root);
  writeFileSync(path.join(root, 'index.html'), '<p>build fixture</p>');
  for (const file of ['models/trees/refined/tree.glb', 'models/trees/foliage-study/atlas.png',
    'models/trees/ghibli-fluffy/hero.glb', 'models/trees/visby-pine/pine.glb', 'courses/index.json']) {
    const target = path.join(root, 'public', file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file);
  }
  let atClose;
  await build({ root, configFile: false, mode, base: '/olovs-hemsida/', logLevel: 'silent',
    build: { outDir: 'published' }, plugins: [productionPublicAssetsPlugin(), {
      name: 'observe-pwa-stage',
      closeBundle() { atClose = existsSync(path.join(root, 'published/models/trees/refined/tree.glb')); },
    }] });
  return { root, atClose, output: path.join(root, 'published') };
}

describe('production public assets', () => {
  it('omits study models before PWA generation while preserving playable assets and source files', async () => {
    const { root, output, atClose } = await fixture('production');
    expect(atClose).toBe(false);
    for (const directory of ['refined', 'foliage-study']) {
      expect(existsSync(path.join(output, 'models/trees', directory))).toBe(false);
      expect(existsSync(path.join(root, 'public/models/trees', directory))).toBe(true);
    }
    for (const file of ['models/trees/ghibli-fluffy/hero.glb', 'models/trees/visby-pine/pine.glb', 'courses/index.json']) {
      expect(readFileSync(path.join(output, file), 'utf8')).toBe(file);
    }
  });

  it('keeps comparison models in an explicit study build', async () => {
    const { output, atClose } = await fixture('study');
    expect(atClose).toBe(true);
    expect(readFileSync(path.join(output, 'models/trees/foliage-study/atlas.png'), 'utf8'))
      .toBe('models/trees/foliage-study/atlas.png');
  });
});
