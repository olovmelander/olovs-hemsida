/* The legacy URL mapping, tested without a browser: every page name, every view
   key, and the shapes that must NOT be treated as legacy links. These are the
   links this project was shared with, so the mapping is a contract. */
import { describe, it, expect } from 'vitest';
import { legacyTarget, LEGACY_PAGES, VIEW_KEYS } from './router.js';

const q = url => Object.fromEntries(new URLSearchParams(url.split('?')[1]));

describe('legacyTarget', () => {
  it('maps every standalone page to its course', () => {
    for (const [file, slug] of Object.entries(LEGACY_PAGES))
      expect(q(legacyTarget('/' + file, ''))).toEqual({ bana: slug });
  });

  it('carries every view key through, and only those', () => {
    const search = '?' + VIEW_KEYS.map((k, i) => `${k}=v${i}`).join('&') + '&bogus=1';
    const got = q(legacyTarget('/veckefjarden3d.html', search));
    expect(got.bana).toBe('veckefjarden');
    VIEW_KEYS.forEach((k, i) => expect(got[k]).toBe('v' + i));
    expect(got.bogus).toBeUndefined();
  });

  it('carries gl and q — the two an audit caught missing from the plan', () => {
    const got = q(legacyTarget('/angso3d.html', '?gl=1&q=lo'));
    expect(got).toEqual({ bana: 'angso', q: 'lo', gl: '1' });
  });

  it('omits keys the link did not set rather than inventing defaults', () => {
    expect(q(legacyTarget('/puttom3d.html', '?hal=7'))).toEqual({ bana: 'puttom', hal: '7' });
  });

  it('works from a nested path, since the page name is what carries the course', () => {
    expect(q(legacyTarget('/some/where/upsala3d.html', '?vy=top')).bana).toBe('upsala');
  });

  it('returns null for anything that is not one of the six pages', () => {
    for (const p of ['/', '/index.html', '/veckefjardensgc.html', '/courses/index.json'])
      expect(legacyTarget(p, '?hal=3')).toBeNull();
  });

  it('never claims the legacy viewer page, which is not part of the app', () => {
    expect(legacyTarget('/veckefjardensgc.html', '')).toBeNull();
  });
});
