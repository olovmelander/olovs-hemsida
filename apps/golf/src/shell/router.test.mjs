/* The legacy URL mapping, tested without a browser: every page name, every view
   key, and the shapes that must NOT be treated as legacy links. These are the
   links this project was shared with, so the mapping is a contract. */
import { describe, it, expect } from 'vitest';
import { legacyTarget, LEGACY_PAGES, VIEW_KEYS, courseUrl, detailedUrl, mapUrl, playUrl, parentHubRoute, previousCourseEntry } from './router.js';

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

  it('returns null for anything that is not one of the seven pages', () => {
    for (const p of ['/', '/index.html', '/unknown3d.html', '/courses/index.json'])
      expect(legacyTarget(p, '?hal=3')).toBeNull();
  });

  it('maps the 2023 viewer to the current championship course under the mount', () => {
    expect(legacyTarget('/olovs-hemsida/veckefjardensgc.html', '?hal=3&gl=1', '/olovs-hemsida/'))
      .toBe('/olovs-hemsida/?bana=veckefjarden&hal=3&gl=1');
  });

  it('takes the course from the filename and drops retired presentation flags', () => {
    expect(legacyTarget('/puttom3d.html', '?bana=visby&hal=3&v2=0&ghibli=0&det=1'))
      .toBe('/?bana=puttom&hal=3&det=1');
  });

  it('does not treat object prototype names as bookmarks', () => {
    for (const name of ['toString', 'constructor', '__proto__'])
      expect(legacyTarget('/' + name, '')).toBeNull();
  });
});

describe('courseUrl', () => {
  it('hands a layout, hole and tee between viewers without starting a real or simulated round', () => {
    const slug = 'bro-hof-castle', context = { hole: 8, tee: '3', preview: true };
    expect(q(detailedUrl(slug, context))).toEqual({ bana: slug, karta: '0', hal: '8', tee: '3' });
    expect(q(mapUrl(slug, context))).toEqual({ bana: slug, karta: '1', hal: '8', tee: '3', runda: 'visa' });
    expect(q(mapUrl(slug, { hole: 0, tee: null }))).toEqual({ bana: slug, karta: '1' });
    expect(q(playUrl(slug))).toEqual({ bana: slug, karta: '0', spela: '1' });
  });

  it('switches course while preserving quality settings and discarding retired modes', () => {
    expect(courseUrl('puttom', '?bana=angso&ghibli=1&hero=1')).toBe('?bana=puttom&hero=1');
    expect(courseUrl('puttom', '?bana=angso&ghibli=0')).toBe('?bana=puttom');
  });

  it('preserves other persistent engine flags while dropping stale course views', () => {
    const initial = '?bana=angso&hal=14&vy=tee&ljus=dag&q=lo&gl=1&ghibli=1';
    const target = courseUrl('visby', initial);
    expect(target).toBe('?bana=visby&gl=1&q=lo');
  });

  it('generates a clean course url when no search string is provided', () => {
    expect(courseUrl('puttom', '')).toBe('?bana=puttom');
  });
});

describe('hub returns', () => {
  it('walks shared round links and filter dialogs one level at a time', () => {
    expect(parentHubRoute('#statistik/upsala/42?filter=1')).toBe('statistik/upsala/42');
    expect(parentHubRoute('#statistik/upsala/42')).toBe('statistik/upsala');
    expect(parentHubRoute('#statistik/angso/1015?exempel=1')).toBe('statistik/angso?exempel=1');
    expect(parentHubRoute('#statistik/angso?exempel=1')).toBe('statistik?exempel=1');
    expect(parentHubRoute('#statistik?exempel=1')).toBe('');
    expect(parentHubRoute('#statistik/upsala')).toBe('statistik');
    expect(parentHubRoute('#/karta/upsala?hal=10&tee=2')).toBe('karta');
    expect(parentHubRoute('#karta/klubb/bro-hof')).toBe('karta');
    expect(parentHubRoute('#installningar/bag')).toBe('installningar');
    expect(parentHubRoute('#statistik')).toBe('');
  });

  it('recognizes previous viewer entries on this mount without leaving a direct link or new tab', () => {
    const href = 'https://example.org/golf/#installningar', base = '/golf/';
    const referrer = 'https://example.org/golf/?bana=upsala&karta=1';
    const visit = { href, base, referrer, historyLength: 2 };
    expect(previousCourseEntry(visit)).toBe(true);
    expect(previousCourseEntry({ ...visit, previousUrl: referrer + '#meny' })).toBe(true);
    expect(previousCourseEntry({ ...visit, referrer: 'https://example.org/?bana=upsala' })).toBe(false);
    expect(previousCourseEntry({ ...visit, referrer: 'https://elsewhere.org/golf/?bana=upsala' })).toBe(false);
    expect(previousCourseEntry({ ...visit, referrer: '' })).toBe(false);
    expect(previousCourseEntry({ ...visit, previousUrl: null })).toBe(false);
    expect(previousCourseEntry({ ...visit, previousUrl: href })).toBe(false);
    expect(previousCourseEntry({ ...visit, historyLength: 1 })).toBe(false);
  });
});
