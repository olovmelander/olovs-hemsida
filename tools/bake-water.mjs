#!/usr/bin/env node
// Publish exact water fields once per course, shared by both looks/all modes.
// Catalog records are written last, only after each bake survives a round trip.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';
import { courseSourceRevision } from './course-source-revision.mjs';
import { decodePreparedWater } from '../apps/golf/src/engine/prepared-water.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const base = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8641';
const publicRoot = path.resolve(flag('public', 'apps/golf/public'));
const catalogPath = path.join(publicRoot, 'courses/index.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
const only = flag('only', '').split(',').filter(Boolean);
if (only.some(slug => !catalog.courses.some(c => c.slug === slug))) throw new Error('unknown course');
const snapshot = flag('snapshot', null);
const revision = snapshot ? JSON.parse(await fs.readFile(snapshot, 'utf8')).revision : courseSourceRevision(process.cwd());
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
const results = [];
try {
  for (const course of catalog.courses.filter(c => !only.length || only.includes(c.slug))) {
    const page = await browser.newPage({ serviceWorkers: 'block' });
    try {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const query = new URLSearchParams({ bana: course.slug, v2: 'require', det: '1', startup: '1', bakeWater: '1' });
      await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction(() => !!window.__WATER_BAKE__, null, { timeout: 120000 });
      if (errors.length) throw new Error(errors.join('\n'));
      const baked = await page.evaluate(async () => {
        const data = window.__WATER_BAKE__;
        if (data.supported === false) return { revision: data.revision, supported: false };
        // Compress before crossing CDP so a 60 MB field never becomes 80 MB of
        // JSON traffic. Node recompresses the verified bytes for publication.
        const bytes = data.bytes();
        const compressed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
        let binary = '';
        for (let i = 0; i < compressed.length; i += 32768) binary += String.fromCharCode(...compressed.subarray(i, i + 32768));
        return { revision: data.revision, identity: data.identity, base64: btoa(binary),
          fingerprint: await data.fingerprint(), levels: data.levels, spans: data.spans };
      });
      if (baked.revision !== revision) throw new Error('bake server source revision mismatch');
      if (baked.supported === false) {
        delete course.preparedWater;
        results.push({ course: course.slug, supported: false });
        console.log(`${course.slug}: retains existing measured/frontier water path`);
        continue;
      }
      const payload = inflateRawSync(Buffer.from(baked.base64, 'base64'), { maxOutputLength: 128 * 1024 * 1024 });
      decodePreparedWater(new Uint8Array(payload), baked.identity);
      const compressed = deflateRawSync(payload, { level: 9 });
      if (compressed.length > 8 * 1024 * 1024 || !inflateRawSync(compressed).equals(payload)) throw new Error('water round trip/budget failed');
      const hash = sha(compressed), url = `courses/${course.slug}/prepared/water-${hash}.bin`;
      await fs.mkdir(path.dirname(path.join(publicRoot, url)), { recursive: true });
      await fs.writeFile(path.join(publicRoot, url), compressed);
      course.preparedWater = { identity: baked.identity, url, bytes: compressed.length,
        decodedBytes: payload.length, sha256: hash, decodedSha256: sha(payload) };
      results.push({ course: course.slug, supported: true, bytes: compressed.length, decodedBytes: payload.length,
        sha256: sha(payload), fingerprint: baked.fingerprint, levels: baked.levels, spans: baked.spans });
      console.log(`${course.slug}: ${compressed.length} bytes, exact ${sha(payload).slice(0, 16)}`);
    } finally { await page.close(); }
  }
  if (!snapshot && courseSourceRevision(process.cwd()) !== revision) throw new Error('source changed during publication; rebuild and retry');
  const latest = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  for (const result of results) {
    const current = latest.courses.find(c => c.slug === result.course), baked = catalog.courses.find(c => c.slug === result.course);
    if (!current || current.sha256 !== baked.sha256 || JSON.stringify(current.startup) !== JSON.stringify(baked.startup) ||
        JSON.stringify(current.surroundings) !== JSON.stringify(baked.surroundings)) throw new Error('course changed during publication');
    if (baked.preparedWater) current.preparedWater = baked.preparedWater;
    else delete current.preparedWater;
  }
  await fs.writeFile(catalogPath, JSON.stringify(latest, null, 1) + '\n');
  const report = flag('report', 'tools/reference/prepared-water-publication.json');
  await fs.mkdir(path.dirname(path.resolve(report)), { recursive: true });
  await fs.writeFile(report, JSON.stringify({ revision, results }, null, 2) + '\n');
  console.log(`Published water for ${results.filter(r => r.supported).length} courses.`);
} finally { await browser.close(); }
