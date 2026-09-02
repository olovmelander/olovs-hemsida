import { describe, expect, it } from 'vitest';
import {
  requestedSurfaceDebugMode,
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
