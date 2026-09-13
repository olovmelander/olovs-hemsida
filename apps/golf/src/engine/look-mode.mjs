/* ===========================================================================
   Visual Look Mode (Ghibli painted style vs. Realistic)

   Ghibli painted style is the standard default mode across desktop and mobile:
   authored trees, painted palette and ground, warm lighting,
   and painterly world grade. Both looks share the atmosphere and clouds.

   Priority:
   1. Explicit URL parameter (?ghibli=1 / ?ghibli=0 / ?look=real / ?look=ghibli)
   2. Stored preference in localStorage ('banvy:ghibli-look')
   3. Standard default: true (Ghibli look)
   =========================================================================== */

export const LOOK_STORAGE_KEY = 'banvy:ghibli-look';
export const LOOK_PARAM = 'ghibli';

/**
 * Reads the active look mode configuration.
 * @param {Object} options
 * @param {string} [options.search=''] - URL search string (e.g. location.search)
 * @param {Storage|null} [options.storage=null] - Web Storage instance (e.g. localStorage)
 * @returns {{ ghibli: boolean, source: 'url'|'storage'|'default' }}
 */
export function readLookMode({ search = '', storage = null } = {}) {
  let ghibliVal = null;
  let lookVal = null;

  try {
    const sp = new URLSearchParams(search);
    ghibliVal = sp.get(LOOK_PARAM);
    lookVal = sp.get('look');
  } catch {
    ghibliVal = null;
    lookVal = null;
  }

  // URL query parameter takes precedence
  if (ghibliVal !== null) {
    const v = ghibliVal.trim().toLowerCase();
    if (v === '0' || v === 'false' || v === 'off') {
      return { ghibli: false, source: 'url' };
    }
    if (v === '1' || v === 'true' || v === 'on' || v === '') {
      return { ghibli: true, source: 'url' };
    }
  }

  if (lookVal !== null) {
    const lv = lookVal.trim().toLowerCase();
    if (lv === 'real' || lv === 'realistic' || lv === '0' || lv === 'off') {
      return { ghibli: false, source: 'url' };
    }
    if (lv === 'ghibli' || lv === 'painted' || lv === '1' || lv === 'on') {
      return { ghibli: true, source: 'url' };
    }
  }

  // Next check localStorage
  try {
    if (storage) {
      const stored = storage.getItem(LOOK_STORAGE_KEY);
      if (stored !== null) {
        const s = stored.trim().toLowerCase();
        if (s === '0' || s === 'false' || s === 'real') {
          return { ghibli: false, source: 'storage' };
        }
        if (s === '1' || s === 'true' || s === 'ghibli') {
          return { ghibli: true, source: 'storage' };
        }
      }
    }
  } catch {
    /* private browsing / access denied */
  }

  // Default: Ghibli is standard mode on desktop and phone
  return { ghibli: true, source: 'default' };
}

/**
 * Persists the user's look mode choice to storage.
 * @param {boolean} ghibli - true for Ghibli look, false for realistic look
 * @param {Storage|null} [storage=null]
 * @returns {boolean}
 */
export function persistLookMode(ghibli, storage = null) {
  try {
    if (!storage) return false;
    storage.setItem(LOOK_STORAGE_KEY, ghibli ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
