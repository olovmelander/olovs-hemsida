const GROUND_MODES = new Set(['atlas', 'mesh']);
const SURFACE_DEBUG_MODES = new Set(['off', 'weights']);

export function requestedSurfaceDebugMode(search = globalThis.location?.search || '') {
  const requested = new URLSearchParams(search).get('surfaceDebug') || 'off';
  return SURFACE_DEBUG_MODES.has(requested) ? requested : 'off';
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
