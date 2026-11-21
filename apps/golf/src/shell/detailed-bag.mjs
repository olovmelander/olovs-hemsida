import { parseBag } from '../engine/caddie.js';
import { BAG_KEY, writeText } from './settings-store.mjs';
import { initCloud, savePlayerProfile } from './cloud.mjs';

/* Detailed 3D's original callback writes the bag and rebuilds the rendered
   strategy. Keep that single writer, with a verified revision and recovery. */
export function bindDetailedBag(getBag, applyBag) {
  function refresh() {
    let raw;
    try { raw = localStorage.getItem(BAG_KEY); } catch { return; }
    const next = parseBag(raw);
    if (JSON.stringify(next) === JSON.stringify(getBag())) return;
    applyBag(next);
    // A remote reset has no stored bag. Applying the default to the renderer
    // must preserve that reset (and older supported bag formats) on disk.
    if (localStorage.getItem(BAG_KEY) !== raw) writeText(localStorage, BAG_KEY, raw);
  }
  addEventListener('banvy-account-changed', event => {
    if (event.detail?.cacheReplaced || event.detail?.previousUserId) location.reload();
  });
  addEventListener('banvy-sync-changed', event => { if (!event.detail?.accountChanged) refresh(); });
  addEventListener('storage', event => { if (event.key === BAG_KEY) refresh(); });
  initCloud();
  return clubs => {
    const saved = savePlayerProfile('bag', clubs, applyBag);
    if (!saved) {
      // The viewer may have shown its success toast before our readback failed.
      const toast = document.getElementById('toast');
      if (toast) toast.textContent = 'Bagen kunde inte sparas på enheten.';
    }
    return saved;
  };
}
