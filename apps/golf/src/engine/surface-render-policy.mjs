const GROUND_MODES = new Set(['atlas', 'mesh']);
const SURFACE_DEBUG_MODES = new Set(['off', 'weights']);

export function requestedSurfaceDebugMode(search = globalThis.location?.search || '') {
  const requested = new URLSearchParams(search).get('surfaceDebug') || 'off';
  return SURFACE_DEBUG_MODES.has(requested) ? requested : 'off';
}

const SURFACE_EDGE_MODES = new Set(['exact', 'pair']);

/** Which field draws the cut lines on the v2 ground: `exact` (the default) is one
 *  exact distance channel per class built from the curve-fitted vectors, `pair`
 *  the older single field grown from the 1 m class raster. An unknown value is
 *  the default, never an error: a shared link must still open. */
export function requestedSurfaceEdges(search = globalThis.location?.search || '') {
  const requested = new URLSearchParams(search).get('edges') || 'exact';
  return SURFACE_EDGE_MODES.has(requested) ? requested : 'exact';
}

/** How strongly height of cut is drawn as TONE (material.js CUT_TONE) and as the
 *  contact line on the taller side: 1 is the authored table, 0 the palette as it
 *  was, up to 2 for judging it by eye. Anything unreadable is the default. */
export function requestedCutTone(search = globalThis.location?.search || '') {
  const raw = new URLSearchParams(search).get('cuts');
  const value = raw === null || raw.trim() === '' ? 1 : Number(raw);
  return Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1;
}

/** The mowing patterns: `?mow=classic` is the soft waves and green rings as they
 *  were, a number scales the new stripes (1 the authored strength, up to 2).
 *  Anything unreadable is the default. */
export function requestedMowing(search = globalThis.location?.search || '') {
  const raw = (new URLSearchParams(search).get('mow') || '').trim().toLowerCase();
  if (raw === 'classic') return { strength: 0 };
  const value = raw === '' ? 1 : Number(raw);
  return { strength: Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : 1 };
}

/**
 * The vector meshes are a legacy-only fallback. A ready v2 terrain already
 * carries the course surfaces in its own material and must remain the sole
 * physical ground representation.
 */
export function shouldRenderLegacySurfaceOverlays({ groundMode, v2Active }) {
  if (!GROUND_MODES.has(groundMode)) {
    throw new TypeError(`unknown ground mode: ${groundMode}`);
  }
  if (typeof v2Active !== 'boolean') {
    throw new TypeError('v2Active must be a boolean');
  }
  return groundMode === 'mesh' && !v2Active;
}
