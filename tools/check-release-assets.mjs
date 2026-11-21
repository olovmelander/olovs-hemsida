/* Read-only smoke check of the deployed build. Use the just-built local dist
   to distinguish the new application from a healthy, previously cached one. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const base = new URL(process.argv[2] || 'https://banvy.olovmelander.workers.dev/');
const dist = new URL('../apps/golf/dist/', import.meta.url);
const sha = data => createHash('sha256').update(data).digest('hex');
const entry = html => {
  const script = html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/i);
  assert.ok(script, 'The hub must serve its JavaScript entry');
  return script[1];
};
const localHtml = await readFile(new URL('index.html', dist), 'utf8');
const expectedEntry = entry(localHtml);
const catalogue = JSON.parse(await readFile(new URL('courses/index.json', dist), 'utf8'));
const startup = catalogue.courses.find(c => typeof c.startup?.url === 'string')?.startup.url;
assert.ok(startup, 'A prepared startup manifest must be available');

async function get(path) {
  const url = new URL(path, base);
  assert.equal(url.origin, base.origin);
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
  assert.equal(response.status, 200, `GET ${url.pathname}`);
  return response;
}
async function verify() {
  const health = await (await get('api/health')).json();
  assert.equal(health.ok, true, 'Worker health');
  if (!['localhost', '127.0.0.1'].includes(base.hostname)) assert.equal(health.devAuth, false, 'Public development login is disabled');
  const html = await (await get('./')).text();
  assert.equal(entry(html), expectedEntry, 'Hub serves the candidate entry');
  for (const asset of [expectedEntry, 'sw.js', 'courses/index.json', 'courses/v2-index.json', 'course-startup-build.json', startup]) {
    const path = asset.replace(/^\/+/, '');
    const [expected, remote] = await Promise.all([readFile(new URL(path, dist)), get(path)]);
    assert.equal(sha(Buffer.from(await remote.arrayBuffer())), sha(expected), path);
  }
}

/* An edge can still be serving the previous release immediately after deploy. */
for (let attempt = 1; ; attempt++) {
  try { await verify(); break; }
  catch (error) {
    if (attempt === 6) throw error;
    console.warn(`Release smoke attempt ${attempt}: ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
}
console.log(`Verified Worker health, hub entry, service worker and prepared course assets at ${base.origin}.`);
