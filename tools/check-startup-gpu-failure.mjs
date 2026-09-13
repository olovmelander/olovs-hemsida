#!/usr/bin/env node
// Exercise Three's real "log an async pipeline error and resolve" behavior.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { browserArgs } from './browser-args.mjs';

const base = process.argv[2] || 'http://127.0.0.1:8645';
const out = process.argv[3] || 'tools/reference/gpu-startup-failure.json';
await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: browserArgs() });
try {
  const page = await browser.newPage({ serviceWorkers: 'block' });
  await page.addInitScript(() => {
    window.__pipelineCalls = 0;
    const create = GPUDevice.prototype.createRenderPipelineAsync;
    GPUDevice.prototype.createRenderPipelineAsync = function(...values) {
      // The first pipeline belongs to the existing terrain preflight. Fail
      // the next one, inside the complete scene's preparation instead.
      if (++window.__pipelineCalls === 2) return Promise.reject(new Error('injected opening pipeline failure'));
      return Reflect.apply(create, this, values);
    };
  });
  const errors = [], messages = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) { messages.push(message.text()); console.log(message.text().slice(0, 600)); } });
  await page.goto(`${base}/?bana=veckefjarden&startup=1&ghibli=1&q=hi&det=1&qualitylock=1&vy=tee&hal=1&v2=require`,
    { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => /kunde inte visa banan|Could not prepare/.test(document.getElementById('bmsg')?.textContent || '') || document.getElementById('boot')?.classList.contains('done'), null, { timeout: 120000 });
  } catch (error) {
    await fs.writeFile(out, JSON.stringify({ passed: false, errors, messages, state: await page.evaluate(() => ({
      message: document.getElementById('bmsg')?.textContent, calls: window.__pipelineCalls, perf: window.V3D?.perf() })) }, null, 2));
    throw error;
  }
  const done = await page.locator('#boot').evaluate(element => element.classList.contains('done'));
  assert.equal(done, false, 'broken opening scene must not become ready');
  assert.match(await page.locator('#bmsg').textContent(), /kunde inte visa banan.*ladda om/, 'actionable retry message survives the shell error handler');
  assert.ok(messages.some(message => message.includes('injected opening pipeline failure')), 'injection was observed');
  assert.ok(messages.some(message => message.includes('Opening scene preparation:')), 'failure belongs to the new gate');
  await fs.writeFile(out, JSON.stringify({ passed: true, done, errors, messages }, null, 2));
  console.log('Rejected shader pipeline keeps the loading gate closed with a retry message.');
} finally { await browser.close(); }
