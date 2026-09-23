#!/usr/bin/env node
/* Publish the far vista's and the scatter's prepared plantings (far vista,
   reeds, ground cover, edge tufts) for every course and quality.

   Runs a built app against the published sources with ?bakeVista=1, which
   plants the far vista the ordinary way and records one bit per candidate
   (engine/prepared-vista.mjs), and runs on through the ground cover, whose
   three loops are recorded the same way (engine/prepared-scatter.mjs). Each
   record's bits go into a content-addressed, deflated file beside the course,
   and the records into courses/index.json.
   Like the tint and water bakes it refuses a build whose source revision is
   not the checkout's, and sources that change while it runs.

   usage: node tools/bake-vista.mjs [http://127.0.0.1:8629] [--public apps/golf/public]
            [--only slug,slug] [--report out.json] */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
import { courseSourceRevision } from './course-source-revision.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const base = args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:8629';
const publicRoot = path.resolve(flag('public', 'apps/golf/public'));
const only = flag('only', '').split(',').filter(Boolean);
const catalogPath = path.join(publicRoot, 'courses/index.json');
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
if (only.some(slug => !catalog.courses.some(c => c.slug === slug))) throw new Error('unknown course');
const revision = courseSourceRevision(process.cwd());
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
const records = new Map(), scatterRecords = new Map(), results = [];
try {
  for (const course of catalog.courses.filter(c => !only.length || only.includes(c.slug))) {
    for (const quality of ['hi', 'lo']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
      try {
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const query = new URLSearchParams({ bana: course.slug, v2: 'require', det: '1', qualitylock: '1',
          q: quality, ghibli: '1', startup: '1', bakeVista: '1' });
        await page.goto(`${base}/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForFunction(() => !!window.__VISTA_BAKE__, null, { timeout: 1800000 });
        if (errors.length) throw new Error(errors.join('\n'));
        const baked = await page.evaluate(() => {
          const b64 = bytes => { let binary = ''; for (let o = 0; o < bytes.length; o += 32768) binary += String.fromCharCode(...bytes.subarray(o, o + 32768)); return btoa(binary); };
          const data = window.__VISTA_BAKE__;
          const scatter = { ...data.scatter, payload: undefined, base64: b64(data.scatter.payload) };
          if (data.none) return { ...data, scatter };
          return { ...data, bits: undefined, base64: b64(data.bits), scatter };
        });
        if (baked.variant !== `vista-${quality}`) throw new Error('bake did not use the requested quality');
        if (baked.revision !== revision) throw new Error('bake server is not built from the current source revision');
        if (!/^[a-f0-9]{64}$/.test(baked.identity ?? '')) throw new Error(`${course.slug}: bake has no identity`);
        let record;
        if (baked.none) {
          record = { none: true, identity: baked.identity };
          console.log(`${course.slug} ${baked.variant}: no far vista on this course`);
        } else {
          const payload = Buffer.from(baked.base64, 'base64');
          if (payload.length !== (baked.candidates + 7) >> 3) throw new Error('bit count mismatch');
          const compressed = deflateRawSync(payload, { level: 9 });
          if (!inflateRawSync(compressed).equals(payload)) throw new Error('vista round trip failed');
          const hash = sha(compressed), url = `courses/${course.slug}/prepared/vista-${hash}.bin`;
          await fs.mkdir(path.join(publicRoot, 'courses', course.slug, 'prepared'), { recursive: true });
          await fs.writeFile(path.join(publicRoot, url), compressed);
          record = { identity: baked.identity, inputs: baked.inputs, url, bytes: compressed.length,
            decodedBytes: payload.length, sha256: hash, decodedSha256: sha(payload),
            candidates: baked.candidates, digest: baked.digest, skipped: baked.skipped, points: baked.points };
          console.log(`${course.slug} ${baked.variant}: ${baked.points} of ${baked.candidates} candidates, ${compressed.length} bytes`);
        }
        if (!records.has(course.slug)) records.set(course.slug, {});
        records.get(course.slug)[baked.variant] = record;
        results.push({ course: course.slug, variant: baked.variant, ...record });
        // The scatter record: reeds, ground cover and edge tufts, one file.
        const sc = baked.scatter;
        if (sc.variant !== `scatter-${quality}`) throw new Error('scatter bake did not use the requested quality');
        if (!/^[a-f0-9]{64}$/.test(sc.identity ?? '')) throw new Error(`${course.slug}: scatter bake has no identity`);
        let scatterRecord;
        const payload = Buffer.from(sc.base64, 'base64');
        if (Object.values(sc.sections).every(v => v === null)) {
          scatterRecord = { none: true, identity: sc.identity };
          console.log(`${course.slug} ${sc.variant}: no scatter loops on this course`);
        } else {
          const compressed = deflateRawSync(payload, { level: 9 });
          if (!inflateRawSync(compressed).equals(payload)) throw new Error('scatter round trip failed');
          const hash = sha(compressed), url = `courses/${course.slug}/prepared/scatter-${hash}.bin`;
          await fs.writeFile(path.join(publicRoot, url), compressed);
          scatterRecord = { identity: sc.identity, inputs: sc.inputs, url, bytes: compressed.length,
            decodedBytes: payload.length, sha256: hash, decodedSha256: sha(payload), sections: sc.sections };
          const kept = Object.entries(sc.sections).filter(([, v]) => v).map(([k, v]) => `${k} ${v.candidates}`).join(', ');
          console.log(`${course.slug} ${sc.variant}: ${kept} candidates, ${compressed.length} bytes`);
        }
        if (!scatterRecords.has(course.slug)) scatterRecords.set(course.slug, {});
        scatterRecords.get(course.slug)[sc.variant] = scatterRecord;
      } finally { await page.close(); }
    }
  }
  if (courseSourceRevision(process.cwd()) !== revision) throw new Error('source changed during publication; rebuild and retry');
  // Preserve catalog updates from independent work; only update baked records.
  const latest = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
  for (const [slug, variants] of records) {
    const current = latest.courses.find(c => c.slug === slug);
    const before = catalog.courses.find(c => c.slug === slug);
    if (current.sha256 !== before.sha256) throw new Error('course data changed during publication');
    current.preparedVista = { ...(current.preparedVista ?? {}), ...variants };
    current.preparedScatter = { ...(current.preparedScatter ?? {}), ...scatterRecords.get(slug) };
  }
  await fs.writeFile(catalogPath, JSON.stringify(latest, null, 1) + '\n');
  const report = flag('report', null);
  if (report) {
    await fs.mkdir(path.dirname(path.resolve(report)), { recursive: true });
    await fs.writeFile(report, JSON.stringify({ revision, results }, null, 2) + '\n');
  }
  console.log(`Published ${results.length} far-vista and ${results.length} scatter records for ${records.size} courses.`);
} finally { await browser.close(); }
