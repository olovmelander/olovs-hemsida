/* GitHub Pages' last publication: the moving page and the worker that clears the
   old app. tools/check-pages-move.mjs runs them in a browser. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { movedPage, movedWorker, writeMovedSite } from './pages-moved-site.mjs';

describe('pages-moved-site', () => {
  it('answers every old address with the same moving page, and stands a worker at the old one\'s address', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banvy-moved-'));
    try {
      expect(writeMovedSite(dir).sort()).toEqual(['.nojekyll', '404.html', 'index.html', 'sw.js']);
      const index = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      expect(fs.readFileSync(path.join(dir, '404.html'), 'utf8')).toBe(index);
      expect(index).toContain('https://banvy.olovmelander.workers.dev/');
      expect(index).toContain('"base":"/olovs-hemsida/"');
      expect(index).toContain('location.replace(moved.url)');
      /* no asset of its own: 404.html is served at any depth */
      expect(index).not.toMatch(/\b(?:src|href)="(?!https?:)[^"#]/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('takes a test site and base', () => {
    const page = movedPage({ site: 'http://127.0.0.1:9/', base: '/old/' });
    expect(page).toContain('"site":"http://127.0.0.1:9/"');
    expect(page).toContain('"base":"/old/"');
  });

  it('clears only the old app: its precache and banvy- caches, then itself', () => {
    const worker = movedWorker();
    expect(worker).toContain("name.startsWith('banvy-') || name.includes(\"/olovs-hemsida/\")");
    expect(worker).toContain('self.registration.unregister()');
    expect(worker).toContain('client.navigate(client.url)');
    expect(worker).not.toMatch(/addEventListener\('fetch'/);
    expect(() => new Function(worker)).not.toThrow();
  });

  it('embeds a page script that parses', () => {
    const page = movedPage();
    const body = page.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
    /* top-level await: parse it as an async function body */
    expect(() => new (Object.getPrototypeOf(async () => {}).constructor)(body)).not.toThrow();
  });
});
