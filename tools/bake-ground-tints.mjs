#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { courseSourceRevision } from './course-source-revision.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const base = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8628';
const publicRoot = path.resolve(flag('public', 'apps/golf/public'));
const only = flag('only', '').split(',').filter(Boolean);
const catalogPath = path.join(publicRoot, 'courses/index.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const snapshot = flag('snapshot', null);
const revision = snapshot ? JSON.parse(await fs.readFile(snapshot, 'utf8')).revision : courseSourceRevision(process.cwd());
if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error('invalid source revision');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const results = [];
try {
  for (const course of catalog.courses) {
    if (only.length && !only.includes(course.slug)) continue;
    for (const quality of ['hi', 'lo']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
      try {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const query = new URLSearchParams({ bana: course.slug, v2: 'require', det: '1', qualitylock: '1',
          q: quality, ghibli: '1', startup: '1', bakeTint: '1' });
        await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForFunction(() => !!window.__GROUND_TINT_BAKE__, null, { timeout: 120000 });
        if (errors.length) throw new Error(errors.join('\n'));
        const baked = await page.evaluate(() => {
          const data = window.__GROUND_TINT_BAKE__;
          return { ...data, layers: data.layers.map(layer => {
            let binary = '';
            for (let offset = 0; offset < layer.bytes.length; offset += 32768) binary += String.fromCharCode(...layer.bytes.subarray(offset, offset + 32768));
            return { ...layer, bytes: undefined, base64: btoa(binary) };
          }) };
        });
        if (baked.variant !== `painted-${quality}`) throw new Error('bake did not use the supported visual setup');
        if (baked.revision !== revision) throw new Error('bake server is not built from the current source revision');
        let offset = 0;
        const parts = [], layers = [];
        for (const layer of baked.layers) {
          const bytes = Buffer.from(layer.base64, 'base64'); parts.push(bytes);
          layers.push({ n: layer.n, dx: layer.dx, bounds: layer.bounds, offset, bytes: bytes.length });
          offset += bytes.length;
        }
        const payload = Buffer.concat(parts), compressed = deflateRawSync(payload, { level: 9 });
        if (!inflateRawSync(compressed).equals(payload)) throw new Error('ground tint round trip failed');
        const hash = sha(compressed), url = `courses/${course.slug}/prepared/tint-${hash}.bin`;
        await fs.mkdir(path.join(publicRoot, 'courses', course.slug, 'prepared'), { recursive: true });
        await fs.writeFile(path.join(publicRoot, url), compressed);
        course.preparedTint ??= {};
        course.preparedTint[baked.variant] = { identity: baked.identity, url, bytes: compressed.length,
          decodedBytes: payload.length, sha256: hash, decodedSha256: sha(payload), layers };
        results.push({ course: course.slug, variant: baked.variant, bytes: compressed.length, sha256: sha(payload) });
        console.log(`${course.slug} ${baked.variant}: ${compressed.length} bytes, exact ${sha(payload).slice(0, 16)}`);
      } finally { await page.close(); }
    }
  }
  if (!snapshot && courseSourceRevision(process.cwd()) !== revision) throw new Error('source changed during publication; rebuild and retry');
  // Preserve catalog updates from independent work; only update baked records.
  const latest = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  for (const course of catalog.courses.filter(c => results.some(r => r.course === c.slug))) {
    const current = latest.courses.find(c => c.slug === course.slug);
    if (current.sha256 !== course.sha256 || JSON.stringify(current.startup) !== JSON.stringify(course.startup)) throw new Error('course data changed during publication');
    current.preparedTint = course.preparedTint;
  }
  await fs.writeFile(catalogPath, JSON.stringify(latest, null, 1) + '\n');
  const report = flag('report', null);
  if (report) {
    await fs.mkdir(path.dirname(path.resolve(report)), { recursive: true });
    await fs.writeFile(report, JSON.stringify({ revision, results }, null, 2) + '\n');
  }
  console.log(`Published ${results.length} exact tint variants for ${new Set(results.map(r => r.course)).size} courses.`);
} finally { await browser.close(); }
