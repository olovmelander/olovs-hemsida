#!/usr/bin/env node
// Diagnostic A/B control only: original implementations with the same assets.
// Prepared identities describe the current build; never publish this directory.
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const root = process.cwd(), app = path.join(root, 'apps/golf');
const requireApp = createRequire(path.join(app, 'package.json'));
const { build } = await import(requireApp.resolve('vite'));
const baseline = process.argv[2] || 'f5f1e18840d83088c9f30f113a347178b8464dc6';
const out = path.resolve(process.argv[3] || 'output/performance-audit/reconstruction-2026-09-22/baseline-dist');
const files = ['apps/golf/src/engine/atlas.js', 'apps/golf/src/engine/exact-class-sdf.mjs',
  'apps/golf/src/engine/ring-index.mjs', 'apps/golf/src/engine/ghibli-trees.mjs',
  'apps/golf/src/engine/hole-marker.mjs', 'packages/course-v2/runtime/course-chunk-source.mjs'];
const sources = new Map(files.map(file => [path.join(root, file), execFileSync('git', ['show', `${baseline}:${file}`], { encoding: 'utf8' })]));
await build({ root: app, configFile: path.join(app, 'vite.config.js'), build: { outDir: out, emptyOutDir: true },
  plugins: [{ name: 'reconstruction-original-control', enforce: 'pre', transform(_source, id) { return sources.get(id); } }] });
await fs.writeFile(path.join(out, 'DIAGNOSTIC-ONLY.json'), JSON.stringify({ baseline,
  purpose: 'Exact output control; original modules with candidate prepared assets, whose equivalence must be checked independently. Not for deployment or boot-time comparison.',
  sources: Object.fromEntries([...sources].map(([file, source]) => [path.relative(root, file), createHash('sha256').update(source).digest('hex')])) }, null, 2));
