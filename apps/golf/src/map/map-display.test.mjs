/* How the map shows itself, and the test round's diary. */
import { describe, expect, it } from 'vitest';
import { activeFrameMs, displayChoices } from './map-display.mjs';
import { diaryCounts, parseDiary, trimDiary } from './map-diary.mjs';

const plain = { contrast: false, textPixels: 16 };

describe('adaptive rendering frame times', () => {
  const drawn = { start: 100, end: 120 };

  it('counts a slow frame when the next one was already requested while drawing', () => {
    expect(activeFrameMs(drawn, 115, 430)).toBe(330);
    expect(activeFrameMs({ start: 100, end: 450 }, 445, 460)).toBe(360);
  });

  it('excludes waiting for input, an idle map, and the first frame after the tab wakes', () => {
    expect(activeFrameMs(drawn, 200, 215)).toBe(35);
    expect(activeFrameMs(drawn, 1500, 1510)).toBeNull();
    expect(activeFrameMs({ start: 100, end: null }, 115, 50000)).toBeNull();
  });
});

describe('the display choices', () => {
  it('start from the phone\'s own settings', () => {
    expect(displayChoices(null, plain)).toEqual({ sun: false, large: false, left: false });
    expect(displayChoices(null, { contrast: true, textPixels: 21 })).toEqual({ sun: true, large: true, left: false });
  });

  it('leave a system text size at its default alone', () => {
    expect(displayChoices(null, { contrast: false, textPixels: 17 }).large).toBe(false);
  });

  it('keep what the player chose over the phone', () => {
    const saved = JSON.stringify({ sun: false, large: false, left: true });
    expect(displayChoices(saved, { contrast: true, textPixels: 21 })).toEqual({ sun: false, large: false, left: true });
  });

  it('take a damaged store for no choice at all', () => {
    expect(displayChoices('{', plain)).toEqual({ sun: false, large: false, left: false });
    expect(displayChoices('null', plain)).toEqual({ sun: false, large: false, left: false });
  });
});

describe('the diary', () => {
  it('keeps the newest entries', () => {
    expect(trimDiary([1, 2, 3, 4], 2)).toEqual([3, 4]);
    const short = [1];
    expect(trimDiary(short, 2)).toBe(short);
  });

  it('reads a damaged store as empty', () => {
    expect(parseDiary('{')).toEqual([]);
    expect(parseDiary('{"a":1}')).toEqual([]);
    expect(parseDiary('[[1,"lock"]]')).toEqual([[1, 'lock']]);
  });

  it('counts by kind', () => {
    expect(diaryCounts([[1, 'lock'], [2, 'slip'], [3, 'lock', 'driver']])).toEqual({ lock: 2, slip: 1 });
  });
});
