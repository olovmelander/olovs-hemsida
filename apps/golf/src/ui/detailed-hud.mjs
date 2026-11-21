/** The detailed viewer owns opening its panels. Mirror that actual state for
    assistive technology, including when a shortcut or another tool closes one. */
export function installDetailedHud() {
  const panels = [
    ['mini', 'mobileMiniToggle', 'miniCloseBtn'],
    ['note', 'mobileNoteToggle', 'noteCloseBtn'],
  ].map(ids => ids.map(id => document.getElementById(id)));
  for (const [panel, launcher, close] of panels) {
    const sync = () => launcher.setAttribute('aria-expanded', String(panel.classList.contains('mobile-open')));
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    sync();
    close.addEventListener('click', () => queueMicrotask(() => launcher.focus({ preventScroll: true })));
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const [panel, launcher] of panels) {
      if (panel.classList.contains('mobile-open')) queueMicrotask(() => {
        if (!panel.classList.contains('mobile-open')) launcher.focus({ preventScroll: true });
      });
    }
  }, true);

  const exit = document.getElementById('cleanExit');
  let clean = false, returnTo = null;
  document.addEventListener('focusin', event => {
    if (!document.body.classList.contains('clean') && event.target !== exit) returnTo = event.target;
  });
  function syncClean() {
    const on = document.body.classList.contains('clean');
    if (on === clean) return;
    clean = on;
    if (on) {
      exit.textContent = document.body.classList.contains('tour') ? 'Avsluta rundturen' : 'Visa reglage';
      exit.focus({ preventScroll: true });
    } else {
      const back = returnTo?.checkVisibility?.({ visibilityProperty: true }) && !returnTo.closest('[inert],[aria-hidden="true"]')
        ? returnTo : document.getElementById('menuToggle');
      back?.focus({ preventScroll: true });
    }
  }
  new MutationObserver(syncClean).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  syncClean();
}
