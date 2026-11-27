/* A ROUND'S OWN ACTIONS ON THE START PAGE (owner request, 27 November 2026: rounds begun and never
   played piled up on the start page, on every device, with no way to remove them).

   Every round card has a visible ⋯ button beside it; a long press on a touch screen and a right click
   open the same sheet. The sheet names the round and offers what can be done with it: end and keep
   it (when holes are played), hand it over, or remove it. Removing never asks twice: the card goes at
   once and a toast offers Ångra for a few seconds, and only then is the removal made (Material's and
   iOS Mail's pattern; a confirm dialog would be one tap more on every removal and protect nothing the
   undo does not). Leaving the page makes a pending removal at once. */

const LONG_PRESS_MS = 450;
const MOVE_SLOP = 10;
export const UNDO_MS = 6000;

const pending = new Map();
/** Is this round (course/id) on its way out? A card waiting for its undo is not drawn again. */
export const removalPending = key => pending.has(key);

/* The ⋯ button, a long press and a right click all open the round's sheet. */
export function bindRoundActions(target, open) {
  let timer = 0, start = null, pressed = false;
  const clear = () => { clearTimeout(timer); timer = 0; start = null; };
  target.addEventListener('pointerdown', event => {
    pressed = false;
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    start = [event.clientX, event.clientY];
    timer = setTimeout(() => {
      timer = 0;
      pressed = true;
      navigator.vibrate?.(12);
      open();
    }, LONG_PRESS_MS);
  });
  target.addEventListener('pointermove', event => {
    if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > MOVE_SLOP) clear();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) target.addEventListener(type, clear);
  target.addEventListener('contextmenu', event => {
    event.preventDefault();
    clear();
    open();
  });
  /* The press that opened the sheet is not also a tap on the card. */
  target.addEventListener('click', event => {
    if (!pressed) return;
    pressed = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

/* The start page's own element: the shell hides any other child of the body on the hub (index.html). */
const host = () => document.getElementById('home') ?? document.body;

let sheet = null;
function sheetElement() {
  if (sheet?.isConnected) return sheet;
  sheet = document.createElement('dialog');
  sheet.className = 'round-actions';
  sheet.setAttribute('aria-labelledby', 'roundActionsTitle');
  sheet.innerHTML = `<div class="ra-head"><h2 class="ra-title" id="roundActionsTitle"></h2><p class="ra-detail"></p></div>
    <div class="ra-list" role="group"></div>
    <button type="button" class="ra-cancel">Avbryt</button>`;
  sheet.querySelector('.ra-cancel').onclick = () => sheet.close();
  /* A tap outside the sheet closes it, as Escape does: one that begins and ends outside. The finger
     lifted after the long press that opened the sheet lands there too, and must not close it. */
  const outside = event => {
    const box = sheet.getBoundingClientRect();
    return event.target === sheet && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
  };
  let downOutside = false;
  sheet.addEventListener('pointerdown', event => { downOutside = outside(event); });
  sheet.addEventListener('click', event => {
    if (downOutside && outside(event)) sheet.close();
    downOutside = false;
  });
  host().append(sheet);
  return sheet;
}

/**
 * The round's sheet: a title, a line about the round, and its actions in order. An action is
 * { label, note?, danger?, run }; Avbryt is always last. Focus goes back to `returnFocus`.
 */
export function openRoundSheet({ title, detail = '', actions, returnFocus = null }) {
  const dialog = sheetElement();
  if (dialog.open) return;
  dialog.querySelector('.ra-title').textContent = title;
  dialog.querySelector('.ra-detail').textContent = detail;
  const list = dialog.querySelector('.ra-list');
  list.replaceChildren(...actions.map(action => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ra-action' + (action.danger ? ' is-danger' : '');
    const label = document.createElement('span');
    label.textContent = action.label;
    button.append(label);
    if (action.note) {
      const note = document.createElement('small');
      note.textContent = action.note;
      button.append(note);
    }
    button.onclick = () => {
      dialog.close();
      action.run();
    };
    return button;
  }));
  dialog.addEventListener('close', () => returnFocus?.isConnected && returnFocus.focus({ preventScroll: true }), { once: true });
  dialog.showModal();
  list.querySelector('button')?.focus();
}

let toast = null, toastTimer = 0;
function toastElement() {
  if (toast?.isConnected) return toast;
  toast = document.createElement('div');
  toast.className = 'round-toast';
  toast.setAttribute('role', 'status');
  toast.innerHTML = '<span class="rt-text"></span><button type="button" class="rt-undo" hidden>Ångra</button>';
  toast.hidden = true;
  host().append(toast);
  return toast;
}
function showToast(text, undo = null, ms = UNDO_MS) {
  const el = toastElement();
  clearTimeout(toastTimer);
  el.querySelector('.rt-text').textContent = text;
  const button = el.querySelector('.rt-undo');
  button.hidden = !undo;
  button.onclick = undo;
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
const hideToast = () => { clearTimeout(toastTimer); if (toast) toast.hidden = true; };

/**
 * Removes a round with an undo: `hide` takes the card away now, `commit` makes the removal when the
 * undo has gone by (or the page is left), and `restore` draws the card again after Ångra or a
 * failed commit. `key` is the round's course/id, so both its cards stay hidden meanwhile.
 */
export function removeWithUndo({ key, message, hide, restore, commit }) {
  for (const [other, entry] of pending) if (other !== key) entry.finish();
  const entry = {
    timer: setTimeout(() => { hideToast(); entry.finish(); }, UNDO_MS),
    finish: async () => {
      clearTimeout(entry.timer);
      if (pending.get(key) !== entry) return;
      pending.delete(key);
      try {
        await commit();
      } catch (error) {
        restore();
        showToast(error?.message || 'Rundan kunde inte tas bort. Försök igen.', null, 5000);
      }
    },
  };
  pending.set(key, entry);
  hide();
  showToast(message, () => {
    clearTimeout(entry.timer);
    if (pending.get(key) === entry) pending.delete(key);
    hideToast();
    restore();
  });
}

addEventListener('pagehide', () => { for (const entry of [...pending.values()]) entry.finish(); });

/* Both lists of rounds draw again: the start page's own card and the account's rounds. */
export function roundsChanged() {
  dispatchEvent(new Event('banvy-rounds-changed'));
  dispatchEvent(new Event('banvy-live-changed'));
}

export const MORE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="19" cy="12" r="2.1"/></svg>';
