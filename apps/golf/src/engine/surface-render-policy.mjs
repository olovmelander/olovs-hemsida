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
