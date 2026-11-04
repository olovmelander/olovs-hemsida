import { describe, expect, it } from 'vitest';
import { courseUrl, detailedUrl, mapUrl } from './router.js';
import { isPhone, opensMap } from './map-default.mjs';

const device = (touch, width, height) => ({ matchMedia: () => ({ matches: touch }), screen: { width, height } });

describe('which program a course link opens', () => {
  it('opens the map on a phone, for a plain link', () => {
    expect(opensMap('?bana=visby', true)).toBe(true);
    expect(opensMap('?bana=visby&hal=7', true)).toBe(true);
  });

  it('opens the detailed course everywhere else', () => {
    expect(opensMap('?bana=visby', false)).toBe(false);
    expect(opensMap('?bana=visby&hal=7', false)).toBe(false);
  });

  it('leaves the chooser alone', () => {
    expect(opensMap('', true)).toBe(false);
  });

  it('keeps a link that asks for the player on the player', () => {
    for (const link of ['?bana=visby&q=lo', '?bana=visby&det=1', '?bana=visby&vy=tee', '?bana=visby&ljus=dag',
      '?bana=visby&kiosk=1', '?bana=lidingo&view=sources', '?bana=visby&gl=1&qualitylock=1']) {
      expect(opensMap(link, true), link).toBe(false);
    }
  });

  it('lets karta decide on any device', () => {
    expect(opensMap('?bana=visby&karta=1', false)).toBe(true);
    expect(opensMap('?bana=visby&karta=0', true)).toBe(false);
    expect(opensMap(mapUrl('visby'), false)).toBe(true);
    expect(opensMap(detailedUrl('visby'), true)).toBe(false);
  });

  it('stays in the detailed course when a phone changes course there', () => {
    expect(opensMap(courseUrl('angso', detailedUrl('visby')), true)).toBe(false);
    expect(opensMap(courseUrl('angso', ''), true)).toBe(true);
  });
});

describe('what counts as a phone', () => {
  it('is a touch-first screen with a phone-sized short side', () => {
    expect(isPhone(device(true, 390, 844))).toBe(true);
    expect(isPhone(device(true, 844, 390))).toBe(true);
  });

  it('is not a tablet, a laptop or a touch laptop', () => {
    expect(isPhone(device(true, 1024, 1366))).toBe(false);
    expect(isPhone(device(false, 390, 844))).toBe(false);
    expect(isPhone({})).toBe(false);
  });
});
