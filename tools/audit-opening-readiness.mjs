#!/usr/bin/env node
// Functional opening gate with live animation. No hardware FPS claims.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { browserArgs, browserExecutable } from './browser-args.mjs';
const args = process.argv.slice(2), arg = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
const base = arg('--base', 'http://127.0.0.1:8662');
const out = arg('--out', 'output/performance-audit/reconstruction-2026-09-22/openings.json');
const report = { physicalPhone: false, hardwareFpsMeasured: false, mode: 'functional readiness; GL2; locked low quality; live until ready; SW blocked', results: [] };
const browser = await chromium.launch({ ...browserExecutable(), args: browserArgs() });
try {
  for (const course of arg('--courses', 'veckefjarden,puttom,visby').split(',')) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(course, e.message); });
    await page.addInitScript(() => {
      const attach = () => {
        const boot = document.getElementById('boot');
        if (!boot) return false;
        const ready = new MutationObserver(() => {
          if (!boot.classList.contains('done') || !window.V3D) return;
          // Stop immediately after the application's GPU-completed readiness
          // marker, before another expensive software-rendered frame queues.
          window.V3D.harness().renderer.setAnimationLoop(null);
          ready.disconnect();
        });
        ready.observe(boot, { attributes: true, attributeFilter: ['class'] });
        return true;
      };
      if (!attach()) { const find = new MutationObserver(() => { if (attach()) find.disconnect(); }); find.observe(document, { childList: true, subtree: true }); }
    });
    try {
      await page.goto(`${base}/?bana=${course}&q=lo&gl=1&qualitylock=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForSelector('#boot.done', { state: 'attached', timeout: 240000 });
      console.log(`${course}: GPU-completed opening ready; collecting fingerprints`);
      const result = await page.evaluate(async () => {
        const v = window.V3D, h = v.harness();
        const state = { perf: structuredClone(v.perf()), quality: structuredClone(v.quality()), terrain: structuredClone(v.v2Terrain()) };
        // Readiness is already satisfied. Stop software rendering before hashing
        // to avoid its next queued frame delaying each async digest.
        h.renderer.setAnimationLoop(null);
        const gl = h.renderer.backend.getContext(), ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return { ...state, adapter: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
          world: await v.startupWorldFingerprint(), water: await v.startupWaterFingerprint() };
      });
      assert.deepEqual(errors, [], course); assert.equal(result.perf.preparedTint, true, `${course}: tint`);
      assert.equal(result.quality.qualityLocked, true); assert.equal(result.terrain.backend, 'webgl2');
      // Keep complete-course readiness and the accepted prepared transport.
      const source = result.perf.courseData;
      assert.equal(source?.complete, true, `${course}: complete source`);
      assert.deepEqual(source.fallbackReasons, []);
      report.results.push({ course, ...result });
      await fs.mkdir(path.dirname(out), { recursive: true }); await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
      console.log(`${course}: fully ready, prepared tint, exact world fingerprint saved`);
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
