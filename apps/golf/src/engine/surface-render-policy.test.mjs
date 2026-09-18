import { describe, expect, it } from 'vitest';
import {
  requestedCutTone,
  requestedSurfaceDebugMode,
  requestedSurfaceEdges,
  shouldRenderLegacySurfaceOverlays,
} from './surface-render-policy.mjs';

describe('surface render policy', () => {
  it.each([false, true])(
    'keeps atlas mode on one terrain surface while v2 active is %s',
    v2Active => {
      expect(shouldRenderLegacySurfaceOverlays({
        groundMode: 'atlas', v2Active,
      })).toBe(false);
    },
  );

  it('keeps legacy vector surfaces only for the explicit mesh fallback', () => {
    expect(shouldRenderLegacySurfaceOverlays({
      groundMode: 'mesh', v2Active: false,
    })).toBe(true);
  });

  it('forbids vector surfaces once v2 terrain is ready, even in mesh mode', () => {
    expect(shouldRenderLegacySurfaceOverlays({
      groundMode: 'mesh', v2Active: true,
    })).toBe(false);
  });

  it('rejects an unknown ground mode instead of guessing a fallback', () => {
    expect(() => shouldRenderLegacySurfaceOverlays({
      groundMode: 'unknown', v2Active: true,
    })).toThrow(/unknown ground mode/);
  });

  it('rejects an ambiguous v2 state instead of enabling a second surface', () => {
    expect(() => shouldRenderLegacySurfaceOverlays({
      groundMode: 'mesh', v2Active: undefined,
    })).toThrow(/v2Active must be a boolean/);
  });
});

describe('surface debug mode', () => {
  it('activates only the explicit normalized-weight diagnostic', () => {
    expect(requestedSurfaceDebugMode('?surfaceDebug=weights')).toBe('weights');
    expect(requestedSurfaceDebugMode('?surfaceDebug=colour')).toBe('off');
    expect(requestedSurfaceDebugMode('')).toBe('off');
  });
});

describe('which field draws the cut lines', () => {
  it('is the exact one unless the old path is asked for by name', () => {
    expect(requestedSurfaceEdges('')).toBe('exact');
    expect(requestedSurfaceEdges('?edges=pair')).toBe('pair');
    /* a shared link must still open: an unknown value is the default, not an error */
    expect(requestedSurfaceEdges('?edges=soft')).toBe('exact');
  });
});

describe('height of cut as tone', () => {
  it('defaults to the authored table, and 0 is the palette as it was', () => {
    expect(requestedCutTone('')).toBe(1);
    expect(requestedCutTone('?cuts=')).toBe(1);
    expect(requestedCutTone('?cuts=0')).toBe(0);
    expect(requestedCutTone('?cuts=1.5')).toBe(1.5);
  });

  it('never leaves the range the material accepts', () => {
    expect(requestedCutTone('?cuts=9')).toBe(2);
    expect(requestedCutTone('?cuts=-3')).toBe(0);
    expect(requestedCutTone('?cuts=strong')).toBe(1);
  });
});
