import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { inspectBuildingGlb } from '../../apps/golf/src/engine/authored-buildings.mjs';

const refined = process.argv.includes('--refined');
const root = path.resolve(`apps/golf/public/models/trees/${refined ? 'refined' : 'atelier'}`);
const out = path.resolve('docs/graphics/tree-atelier-2026-09-13');
const manifest = JSON.parse(fs.readFileSync(path.join(root, refined ? 'ghibli-v3.json' : 'ghibli-v2.json'), 'utf8'));
const report = { assets: [], browserErrors: [], views: [], course: [] };
for (const species of manifest.species) for (const variant of species.variants) for (const [tier, rec] of Object.entries(variant.tiers)) {
  const bytes = fs.readFileSync(path.join(root, rec.file));
  if (bytes.length !== rec.bytes || createHash('sha256').update(bytes).digest('hex') !== rec.sha256) throw new Error(`Corrupt ${rec.file}`);
  inspectBuildingGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  report.assets.push({ species: species.key, seed: variant.seed, tier, triangles: rec.tris.crown + rec.tris.trunk, bytes: bytes.length });
}
console.log(`Verified ${report.assets.length} GLBs, hashes and runtime safety inspector.`);
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox', '--use-angle=d3d11', '--enable-gpu', '--force_high_performance_gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1560, height: 1000 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  page.on('pageerror', e => report.browserErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.browserErrors.push(`${m.text()} ${m.location().url}`); });
  page.on('response', response => { if (response.status() >= 400) report.browserErrors.push(`HTTP ${response.status()} ${response.url()}`); });
  await page.goto('http://localhost:5173/tree-study.html');
  await page.waitForFunction(() => window.treeStudy?.current, { timeout: 120000 });
  for (const key of refined ? ['tall'] : ['gran', 'tall', 'björk', 'al', 'ek']) {
    await page.selectOption('#species', key);
    await page.waitForTimeout(350);
    const file = `${refined ? 'refined' : 'comparison'}-${key === 'björk' ? 'bjork' : key}.png`;
    await page.screenshot({ path: path.join(out, file) });
    report.views.push(await page.evaluate(() => ({ ...treeStudy.current, stats: [...document.querySelectorAll('.stats')].map(x => x.textContent) })));
  }
  // Exercise all authored tier/variant combinations, including hero variants
  // that were absent from the original catalogue.
  report.meshChecks = await page.evaluate(() => {
    const issues = [];
    for (const view of treeStudy.views) for (const s of view.catalogue.species) for (const v of s.variants) {
      for (const tier of ['hero', 'full', 'decimated']) for (const part of ['crown', 'trunk']) {
        const g = v[tier][part];
        for (const attr of ['position', 'normal', 'color']) if (![...g.attributes[attr].array].every(Number.isFinite)) issues.push(`${view.design}/${s.key}/${v.variant}/${tier}/${part}/${attr}`);
        g.computeBoundingBox();
        if (g.boundingBox.max.y < 0 || g.boundingBox.min.y < -.5) issues.push(`Invalid base ${s.key}`);
      }
    }
    return issues;
  });
  await page.selectOption('#species', refined ? 'tall' : 'gran');
  await page.selectOption('#tier', 'full');
  await page.screenshot({ path: path.join(out, refined ? 'refined-pine-middle.png' : 'comparison-gran-middle.png') });
  await page.selectOption('#tier', 'decimated');
  await page.screenshot({ path: path.join(out, refined ? 'refined-pine-distant.png' : 'comparison-gran-distant.png') });
  if (refined) for (const variant of ['1', '2', '3']) {
    await page.selectOption('#variant', variant);
    await page.selectOption('#tier', 'hero');
    await page.screenshot({ path: path.join(out, `refined-pine-variant-${+variant + 1}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  report.mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.screenshot({ path: path.join(out, 'comparison-mobile.png'), fullPage: true });
  if (process.argv.includes('--course')) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    for (const design of ['original', refined ? 'refined' : 'atelier']) {
      const url = `http://localhost:5173/?bana=upsala&ghibli=1&hero=1&hal=2&vy=tee&ljus=kvall&det=1&q=hi&qualitylock=1&treeart=${design}`;
      console.log(`Booting course: ${design}`);
      await page.goto(url, { waitUntil: 'load', timeout: 240000 });
      await page.waitForSelector('#boot.done', { timeout: 240000 });
      await page.waitForFunction(() => window.V3D?.settled(), { timeout: 120000 });
      await page.evaluate(() => V3D.prepareCapture());
      await page.screenshot({ path: path.join(out, `upsala-hole2-${design}.png`) });
      report.course.push(await page.evaluate(design => ({ design, backend: V3D.stats.backend,
        audit: V3D.treeTierAudit(), renderer: V3D.rendererInfo(), tiers: V3D.treeTiers(), camera: V3D.cameraInfo() }), design));
      console.log(`${design} course captured.`);
    }
  }
} finally {
  await browser.close();
  fs.writeFileSync(path.join(out, refined ? 'refined-validation.json' : 'validation.json'), JSON.stringify(report, null, 2) + '\n');
}
if (report.browserErrors.length || report.meshChecks?.length || report.mobileOverflow) throw new Error(JSON.stringify({ errors: report.browserErrors, mesh: report.meshChecks, mobileOverflow: report.mobileOverflow }));
console.log(`Passed. Saved ${report.views.length} species comparisons; ${report.course.length} course views.`);
